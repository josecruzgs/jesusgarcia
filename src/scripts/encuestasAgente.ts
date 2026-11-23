import { config } from "dotenv";
config({ path: ".env.local" });

import mongoose from "mongoose";
import EncuestaCuestionarioModel from "../lib/models/EncuestaCuestionario";
import { leerCampana, campanaPorOmision } from "../lib/encuestas/llamadas";
import { asegurarCampanas } from "../lib/encuestas/campanas";
import { armarAgente, sincronizarAgente } from "../lib/encuestas/guion";

/**
 * LA ASISTENTE VIRTUAL DE UNA CAMPAÑA, ARMADA DESDE MONGO.
 *
 * Es lo mismo que hace «Guardar» en el guion o en la configuración de una campaña, para usarlo desde la terminal: enseñar
 * lo que dice la asistente y, con --aplicar, mandárselo a su agente de ElevenLabs (o crearlo si la campaña no tiene).
 *
 *   npm run encuestas:agente                          # la campaña por omisión: enseña el guion
 *   npm run encuestas:agente -- <idCampaña>           # esa campaña
 *   npm run encuestas:agente -- <idCampaña> --aplicar # lo manda al agente (y guarda el agente nuevo en la campaña)
 */
async function main() {
  await asegurarCampanas();
  const id = process.argv.slice(2).find((x) => !x.startsWith("--"));
  const c = id ? await leerCampana(id) : await campanaPorOmision();
  if (!c) return console.log("No hay esa campaña.");
  const { primerMensaje, prompt, datos } = armarAgente(c);
  console.log(`Campaña: ${c.nombre} (${c.id}) · agente ${c.agenteId ?? "sin crear"}\n\nPrimer mensaje: ${primerMensaje}\n\n${prompt}\n\nCampos: ${Object.keys(datos).join(", ")}`);
  if (!process.argv.includes("--aplicar")) return console.log("\nPara mandarlo al agente: agrega -- --aplicar");
  const r = await sincronizarAgente(c);
  if (!r.ok) return console.log(`\nNo se pudo: ${r.error}`);
  if (r.creado) await EncuestaCuestionarioModel.updateOne({ _id: c.id }, { $set: { agenteId: r.agenteId } });
  console.log(r.creado ? `\nCreado el agente ${r.agenteId} y guardado en la campaña.` : `\nActualizado el agente ${r.agenteId}.`);
}

main().finally(() => mongoose.disconnect());
