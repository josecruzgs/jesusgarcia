import { dbConnect } from "@/lib/mongodb";
import WorkerSettingsModel, { WORKER_SETTINGS_ID } from "@/lib/models/WorkerSettings";
import { motoresConfigurados } from "@/lib/motores";

/**
 * Lectura y escritura del número de motores.
 *
 * Está en su propio archivo y no en src/lib/motores.ts porque aquel lo importa
 * el componente de la sala, que corre en el navegador: meterle acá un import de
 * mongoose arrastraría el driver entero al bundle del cliente.
 */

export type MotoresDeseados = {
  /** Los motores que el worker tiene que mantener encendidos. Siempre 1..5. */
  engines: number;
  /** `false` cuando nadie lo configuró todavía y el valor sale de la semilla. */
  configurado: boolean;
  updatedAt: Date | null;
  updatedBy: string | null;
};

/**
 * Qué número manda ahora mismo.
 *
 * `semilla` es lo que vale si nadie configuró nada: en el worker es
 * `WORKER_ENGINES` (o el default), y en la web es solo el default, porque el
 * servidor de Next no tiene por qué compartir el env del worker —en un deploy
 * partido ni siquiera corren en la misma máquina—.
 */
export async function leerMotoresDeseados(semilla: number): Promise<MotoresDeseados> {
  await dbConnect();
  const doc = await WorkerSettingsModel.findById(WORKER_SETTINGS_ID).lean();

  // El valor guardado también pasa por `motoresConfigurados`: el tope de la
  // sala puede bajar en un deploy futuro y un 5 viejo en la base dejaría al
  // worker encendiendo motores que la pantalla ya no sabe dibujar.
  if (!doc || typeof doc.engines !== "number") {
    return { engines: motoresConfigurados(String(semilla)), configurado: false, updatedAt: null, updatedBy: null };
  }

  return {
    engines: motoresConfigurados(String(doc.engines)),
    configurado: true,
    updatedAt: doc.updatedAt ?? null,
    updatedBy: doc.updatedBy ?? null,
  };
}

/** Deja escrito el número nuevo. Devuelve lo que quedó guardado, ya acotado. */
export async function guardarMotoresDeseados(engines: number, updatedBy: string): Promise<MotoresDeseados> {
  const valor = motoresConfigurados(String(engines));

  await dbConnect();
  const doc = await WorkerSettingsModel.findByIdAndUpdate(
    WORKER_SETTINGS_ID,
    { $set: { engines: valor, updatedBy } },
    { upsert: true, returnDocument: "after" },
  ).lean();

  return {
    engines: valor,
    configurado: true,
    updatedAt: doc?.updatedAt ?? null,
    updatedBy: doc?.updatedBy ?? updatedBy,
  };
}
