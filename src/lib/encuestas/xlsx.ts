import { inflateRawSync } from "node:zlib";

/**
 * LEER UN EXCEL (.xlsx) SIN LIBRERÍAS.
 *
 * Las bases de teléfonos llegan en Excel, y pedirle a alguien que lo «guarde como CSV» es justo el paso donde se pierden
 * los ceros, se cambia el separador o se corta la columna. Un .xlsx es un zip con XML adentro: aquí se abre el zip, se lee
 * la primera hoja y se devuelve como renglones de texto. Solo lo necesario para una lista: textos y números.
 */
function archivosDelZip(buf: Buffer) {
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  if (fin < 0) throw new Error("El archivo no es un Excel válido (.xlsx).");
  const total = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  const salida = new Map<string, Buffer>();
  for (let k = 0; k < total && buf.readUInt32LE(p) === 0x02014b50; k++) {
    const metodo = buf.readUInt16LE(p + 10), comprimido = buf.readUInt32LE(p + 20);
    const nLargo = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), coment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nombre = buf.toString("utf8", p + 46, p + 46 + nLargo);
    const inicio = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const datos = buf.subarray(inicio, inicio + comprimido);
    if (/^xl\/(sharedStrings|workbook|worksheets\/[^/]+)\.xml$|^xl\/_rels\/workbook\.xml\.rels$/.test(nombre))
      salida.set(nombre, metodo === 8 ? inflateRawSync(datos) : datos);
    p += 46 + nLargo + extra + coment;
  }
  return salida;
}

const entidades = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");
const textos = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => entidades(m[1])).join("");
const columna = (ref: string) => [...ref.replace(/\d+/g, "")].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;

export function leerXlsx(buf: Buffer): string[][] {
  const zip = archivosDelZip(buf);
  const compartidos = [...(zip.get("xl/sharedStrings.xml")?.toString("utf8") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textos(m[1]));

  // La primera hoja del libro (no la primera del zip): workbook.xml dice cuál es y rels dónde está.
  const wb = zip.get("xl/workbook.xml")?.toString("utf8") ?? "";
  const rid = wb.match(/<sheet\b[^>]*r:id="([^"]+)"/)?.[1];
  const rels = zip.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const destino = rid ? rels.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`))?.[1] ?? rels.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`))?.[1] : undefined;
  const ruta = destino ? `xl/${destino.replace(/^\/?xl\//, "")}` : [...zip.keys()].filter((k) => k.startsWith("xl/worksheets/")).sort()[0];
  const hoja = (ruta && zip.get(ruta)?.toString("utf8")) || "";
  if (!hoja) throw new Error("No encontré ninguna hoja en el Excel.");

  const filas: string[][] = [];
  for (const r of hoja.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const fila: string[] = [];
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], cuerpo = c[2] ?? "";
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const tipo = attrs.match(/\bt="([^"]+)"/)?.[1];
      const v = cuerpo.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
      const valor = tipo === "s" ? compartidos[Number(v)] ?? "" : tipo === "inlineStr" ? textos(cuerpo) : entidades(v);
      fila[ref ? columna(ref) : fila.length] = valor.trim();
    }
    filas.push(Array.from(fila, (x) => x ?? ""));
  }
  return filas;
}
