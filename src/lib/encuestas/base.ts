import { Types } from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import EncuestaContactoModel from "@/lib/models/EncuestaContacto";
import EncuestaLlamadaModel from "@/lib/models/EncuestaLlamada";
import { cifrar, descifrar, huella, finDe, esHuella } from "./cifrado";

/**
 * LA BASE A LA QUE SE LE VA A LLAMAR.
 *
 * Entra como venga: Excel, CSV (con coma, punto y coma o tabulador) o la columna de teléfonos copiada y pegada. Lo que no
 * trae un celular válido no entra, y lo repetido no se duplica (se cuenta y se dice): un número que aparece dos veces se
 * llama dos veces, y eso es lo que hace que la gente cuelgue.
 *
 * Todo entra cifrado y con dueño (ver cifrado.ts y el modelo EncuestaContacto): solo quien subió la base ve los nombres
 * y los números; los demás, admins incluidos, ven los últimos 4 dígitos y cómo le fue a cada quien.
 */
export function celularValido(entrada: string | null | undefined): string | null {
  const t = (entrada ?? "").replace(/\D/g, "").replace(/^521(?=\d{10}$)/, "").replace(/^52(?=\d{10}$)/, "");
  if (t.length !== 10 || /^[01]/.test(t)) return null;
  if (new Set(t).size < 3) return null; // 5555555555, 6666660000…
  const sube = "0123456789012345678901234567890";
  if (sube.includes(t) || [...sube].reverse().join("").includes(t)) return null;
  return t;
}

/** Las columnas de la base: ID, Teléfono, Municipio, Distrito, Sección electoral y Otro (la plantilla está en /encuestas/plantilla). */
const SINONIMOS: Record<string, string[]> = {
  telefono: ["telefono", "tel", "celular", "cel", "movil", "numero", "phone", "whatsapp", "telefonocelular", "numerodetelefono"],
  id: ["id", "folio", "clave", "identificador", "idcontacto", "idpersona", "consecutivo", "registro"],
  municipio: ["municipio", "mpio", "mun", "ciudad"],
  distrito: ["distrito", "dto", "dist", "distritoelectoral", "distritolocal", "distritofederal"],
  seccion: ["seccion", "seccionelectoral", "secc", "sec", "seccional"],
  otro: ["otro", "otros", "otrodato", "otrosdatos", "dato", "datoadicional", "extra", "notas", "observaciones", "comentarios"],
};
const limpio = (x: string) => x.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

/** Parte una línea de CSV respetando las comillas. */
function partir(linea: string, sep: string): string[] {
  const out: string[] = [];
  let actual = "", dentro = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') { if (dentro && linea[i + 1] === '"') { actual += '"'; i++; } else dentro = !dentro; }
    else if (c === sep && !dentro) { out.push(actual); actual = ""; }
    else actual += c;
  }
  out.push(actual);
  return out.map((x) => x.trim());
}

export function textoAFilas(texto: string): string[][] {
  const lineas = texto.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lineas.length) return [];
  const sep = [",", ";", "\t", "|"].map((s) => ({ s, n: lineas[0].split(s).length })).sort((a, b) => b.n - a.n)[0].s;
  return lineas.map((l) => partir(l, sep));
}

/** `huellas`: las de todos los teléfonos válidos del archivo (nuevos y los que ya estaban), para meterlos a una campaña. */
export type ResumenCarga = { leidas: number; cargadas: number; repetidas: number; sinTelefono: number; columna: string | null; huellas: string[] };

export async function cargarFilas(filas: string[][], origen: string, subidoPor: string | null): Promise<ResumenCarga> {
  if (!filas.length) return { leidas: 0, cargadas: 0, repetidas: 0, sinTelefono: 0, columna: null, huellas: [] };
  // ¿El primer renglón es encabezado? Si trae una columna que se llama «teléfono» (o parecido), sí.
  const enc = filas[0].map(limpio);
  const idx = (campo: string) => enc.findIndex((h) => SINONIMOS[campo].includes(h));
  let iTel = idx("telefono");
  const conEncabezado = iTel >= 0;
  const cuerpo = conEncabezado ? filas.slice(1) : filas;
  // Sin encabezado: la columna de teléfonos es la que más celulares válidos trae.
  if (!conEncabezado) {
    const ancho = Math.max(...cuerpo.map((f) => f.length));
    let mejor = -1, cuenta = 0;
    for (let k = 0; k < ancho; k++) {
      const n = cuerpo.slice(0, 200).filter((f) => celularValido(f[k])).length;
      if (n > cuenta) { cuenta = n; mejor = k; }
    }
    iTel = mejor;
  }
  if (iTel < 0) return { leidas: cuerpo.length, cargadas: 0, repetidas: 0, sinTelefono: cuerpo.length, columna: null, huellas: [] };
  const iId = conEncabezado ? idx("id") : -1, iMun = conEncabezado ? idx("municipio") : -1, iDis = conEncabezado ? idx("distrito") : -1;
  const iSec = conEncabezado ? idx("seccion") : -1, iOtro = conEncabezado ? idx("otro") : -1;
  const celda = (f: string[], k: number, largo = 120) => (k >= 0 ? (f[k] ?? "").trim().slice(0, largo) || null : null);

  await dbConnect();
  await migrarACifrado();
  const dueno = subidoPor && Types.ObjectId.isValid(subidoPor) ? new Types.ObjectId(subidoPor) : null;
  const origenCifrado = cifrar(origen);
  const vistos = new Set<string>();
  const nuevos: { telefono: string; [k: string]: unknown }[] = [];
  let repetidas = 0, sinTelefono = 0;
  for (const f of cuerpo) {
    const tel = celularValido(f[iTel]);
    if (!tel) { sinTelefono++; continue; }
    if (vistos.has(tel)) { repetidas++; continue; }
    vistos.add(tel);
    nuevos.push({
      telefono: huella(tel), telCifrado: cifrar(tel), telFin: finDe(tel),
      idCifrado: cifrar(celda(f, iId)), municipioCifrado: cifrar(celda(f, iMun)), distritoCifrado: cifrar(celda(f, iDis)),
      seccionCifrada: cifrar(celda(f, iSec)), otroCifrado: cifrar(celda(f, iOtro, 500)),
      origenCifrado, subidoPor: dueno,
    });
  }
  // Lo que ya estaba de una carga anterior no se toca: lo que ya se llamó, ya se llamó. Por eso es $setOnInsert y
  // no un insert a secas: el número que ya existe se queda como estaba (y con su dueño) y solo cuenta como repetido.
  let cargadas = 0;
  for (let k = 0; k < nuevos.length; k += 500) {
    const r = await EncuestaContactoModel.bulkWrite(
      nuevos.slice(k, k + 500).map((c) => ({
        updateOne: { filter: { telefono: c.telefono }, update: { $setOnInsert: c }, upsert: true },
      })),
      { ordered: false },
    );
    cargadas += r.upsertedCount;
  }
  repetidas += nuevos.length - cargadas;
  return { leidas: cuerpo.length, cargadas, repetidas, sinTelefono, columna: conEncabezado ? filas[0][iTel] : null, huellas: nuevos.map((c) => c.telefono) };
}

export type ContactoDoc = {
  _id: Types.ObjectId; telefono: string; telCifrado?: string | null; telFin?: string | null;
  idCifrado?: string | null; municipioCifrado?: string | null; distritoCifrado?: string | null; seccionCifrada?: string | null; otroCifrado?: string | null; origenCifrado?: string | null; subidoPor?: Types.ObjectId | null;
  estado: string; intentos: number; ultimoIntento: Date | null; createdAt?: Date;
};

/** De quién es un contacto, visto por `yo`: «mio», «compartida» (sin dueño) o «ajena» (la subió otro usuario). */
export function duenoDe(c: Pick<ContactoDoc, "subidoPor">, yo: string): "mio" | "compartida" | "ajena" {
  if (!c.subidoPor) return "compartida";
  return String(c.subidoPor) === yo ? "mio" : "ajena";
}

/** Un contacto como lo puede ver `yo`: en claro si es suyo (o compartido), y si no, solo los últimos 4 dígitos. */
export function contactoVisible(c: ContactoDoc, yo: string) {
  const de = duenoDe(c, yo);
  const abierto = de !== "ajena";
  const tel = abierto ? descifrar(c.telCifrado) : null;
  return {
    id: String(c._id), de, abierto,
    telefono: tel,
    telFin: c.telFin ?? (tel ? finDe(tel) : null),
    idExterno: abierto ? descifrar(c.idCifrado) : null,
    municipio: abierto ? descifrar(c.municipioCifrado) : null,
    distrito: abierto ? descifrar(c.distritoCifrado) : null,
    seccion: abierto ? descifrar(c.seccionCifrada) : null,
    otro: abierto ? descifrar(c.otroCifrado) : null,
    origen: abierto ? descifrar(c.origenCifrado) : null,
    estado: c.estado, intentos: c.intentos, ultimoIntento: c.ultimoIntento,
  };
}

/** Lo que un usuario puede ver en claro: lo suyo y lo compartido. */
export const filtroVisible = (yo: string) => ({ subidoPor: { $in: [null, ...(Types.ObjectId.isValid(yo) ? [new Types.ObjectId(yo)] : [])] } });

/**
 * FILTRAR LOS RESULTADOS POR MUNICIPIO, DISTRITO Y SECCIÓN ELECTORAL.
 *
 * Municipio, distrito y sección están cifrados, así que no se pueden agrupar en Mongo: se descifran aquí, y solo los de las bases
 * que `yo` puede ver en claro (lo suyo y lo compartido). Así las opciones del filtro nunca enseñan los municipios de una
 * base ajena. Devuelve las opciones con cuántas personas tiene cada una y, si se eligió algo, los contactos que entran,
 * para filtrar las llamadas por su `contactoId`.
 *
 * Se agrupa sin distinguir mayúsculas, acentos ni espacios («Tijuana», «TIJUANA », «tijuána» son uno) y se enseña la
 * forma más común.
 */
export async function segmentos(yo: string, elegido: { municipio?: string; distrito?: string; seccion?: string }) {
  await dbConnect();
  const clave = (x: string) => x.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
  const filas = (await EncuestaContactoModel.find({ ...filtroVisible(yo), $or: [{ municipioCifrado: { $ne: null } }, { distritoCifrado: { $ne: null } }, { seccionCifrada: { $ne: null } }] })
    .select("municipioCifrado distritoCifrado seccionCifrada")
    .lean<{ _id: Types.ObjectId; municipioCifrado?: string | null; distritoCifrado?: string | null; seccionCifrada?: string | null }[]>())
    .map((c) => ({
      _id: c._id,
      municipio: descifrar(c.municipioCifrado)?.trim() || null,
      distrito: descifrar(c.distritoCifrado)?.trim() || null,
      seccion: descifrar(c.seccionCifrada)?.trim() || null,
    }));

  const contar = (valores: (string | null)[]) => {
    const grupos = new Map<string, { n: number; formas: Map<string, number> }>();
    for (const v of valores) {
      if (!v) continue;
      const g = grupos.get(clave(v)) ?? { n: 0, formas: new Map() };
      g.n++; g.formas.set(v, (g.formas.get(v) ?? 0) + 1);
      grupos.set(clave(v), g);
    }
    return [...grupos].map(([k, g]) => ({ clave: k, valor: [...g.formas].sort((a, b) => b[1] - a[1])[0][0], n: g.n }))
      .sort((a, b) => a.valor.localeCompare(b.valor, "es", { numeric: true }));
  };
  const mun = elegido.municipio ? clave(elegido.municipio) : "", dis = elegido.distrito ? clave(elegido.distrito) : "";
  const sec = elegido.seccion ? clave(elegido.seccion) : "";
  const es = (v: string | null, k: string) => !k || (!!v && clave(v) === k);
  // Cada lista ofrece solo lo que cabe en lo elegido arriba: los distritos del municipio, las secciones del distrito.
  const delMunicipio = filas.filter((c) => es(c.municipio, mun));
  const delDistrito = delMunicipio.filter((c) => es(c.distrito, dis));
  return {
    municipios: contar(filas.map((c) => c.municipio)),
    distritos: contar(delMunicipio.map((c) => c.distrito)),
    secciones: contar(delDistrito.map((c) => c.seccion)),
    contactoIds: mun || dis || sec ? delDistrito.filter((c) => es(c.seccion, sec)).map((c) => c._id) : null,
  };
}

/** Cómo va la base. */
export async function estadoBase() {
  await dbConnect();
  await migrarACifrado();
  const g = await EncuestaContactoModel.aggregate<{ _id: string; n: number }>([{ $group: { _id: "$estado", n: { $sum: 1 } } }]);
  const porEstado = Object.fromEntries(g.map((x) => [x._id, x.n])) as Record<string, number>;
  const total = g.reduce((a, x) => a + x.n, 0);
  return { total, porEstado };
}

/**
 * PASAR A CIFRADO LO QUE YA ESTABA. Las bases cargadas antes de cifrar tienen el número, el nombre y la colonia en claro;
 * aquí se cifran y quedan como base compartida (sin dueño: ya no se sabe quién las subió). Las llamadas de verdad se
 * quedan con su huella y sus últimos 4 dígitos. Corre una vez por proceso y no hace nada si ya no queda nada en claro.
 */
let migrando: Promise<void> | null = null;
export function migrarACifrado() {
  migrando ??= hacerMigracion().catch((e) => { migrando = null; throw e; });
  return migrando;
}
async function hacerMigracion() {
  await dbConnect();
  type Viejo = { _id: Types.ObjectId; telefono: string; nombre?: string | null; colonia?: string | null; origen?: string | null; estado: string };
  const viejos = (await EncuestaContactoModel.collection
    .find({ telefono: { $not: /^h1:/ } }, { projection: { telefono: 1, nombre: 1, colonia: 1, origen: 1, estado: 1 } })
    .toArray()) as unknown as Viejo[];
  for (const v of viejos) {
    const tel = (v.telefono ?? "").replace(/\D/g, "").slice(-10);
    if (tel.length !== 10 || esHuella(v.telefono)) continue;
    const campos = {
      telefono: huella(tel), telCifrado: cifrar(tel), telFin: finDe(tel),
      nombreCifrado: cifrar(v.nombre ?? null), coloniaCifrada: cifrar(v.colonia ?? null), origenCifrado: cifrar(v.origen ?? null),
      subidoPor: null,
    };
    try {
      await EncuestaContactoModel.collection.updateOne({ _id: v._id }, { $set: campos, $unset: { nombre: "", colonia: "", origen: "" } });
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e;
      // Ese número ya se volvió a subir cifrado: se queda el nuevo, y si el viejo pidió no ser llamado, el nuevo también.
      if (v.estado === "NO_LLAMAR") await EncuestaContactoModel.collection.updateOne({ telefono: campos.telefono }, { $set: { estado: "NO_LLAMAR" } });
      await EncuestaContactoModel.collection.deleteOne({ _id: v._id });
    }
  }
  const llamadas = (await EncuestaLlamadaModel.collection
    .find({ telefono: { $ne: null }, huella: null }, { projection: { telefono: 1, prueba: 1 } })
    .toArray()) as unknown as { _id: Types.ObjectId; telefono: string; prueba?: boolean }[];
  for (let k = 0; k < llamadas.length; k += 500) {
    await EncuestaLlamadaModel.collection.bulkWrite(llamadas.slice(k, k + 500).map((l) => {
      const tel = (l.telefono ?? "").replace(/\D/g, "").slice(-10);
      return { updateOne: { filter: { _id: l._id }, update: { $set: { huella: huella(tel), telFin: finDe(tel), telefono: l.prueba ? tel : null } } } };
    }), { ordered: false });
  }
  if (viejos.length || llamadas.length) console.log(`[encuestas] cifrado: ${viejos.length} contactos y ${llamadas.length} llamadas pasados a cifrado.`);
}
