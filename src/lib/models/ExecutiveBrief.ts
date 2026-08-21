import { Schema, models, model, type InferSchemaType } from "mongoose";
import { dropStaleModel } from "./staleModel";

/**
 * Un resumen ejecutivo guardado, con el período que analizó.
 *
 * Se persiste en vez de generarse al vuelo porque el valor está en la serie:
 * comparar la lectura de esta semana contra la de la anterior, y poder volver
 * a las recomendaciones que se dieron entonces para ver si se siguieron y qué
 * pasó. Un informe que desaparece al recargar no permite nada de eso.
 */
const ExecutiveBriefSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: "ListeningProject", required: true },

    // Período analizado. Se guarda junto al texto porque un resumen sin su
    // ventana es incomparable con cualquier otro.
    from: { type: Date, required: true },
    to: { type: Date, required: true },

    /**
     * Día de inicio de la ventana de tres días a la que pertenece (ver
     * `briefWindows.ts`). Es la clave de idempotencia: mientras esté puesta,
     * el informe se reescribe en su lugar en vez de crear otro, y por eso un
     * período ya analizado no se vuelve a mandar a Claude.
     *
     * Va vacía en los informes de rango libre —los de "investigar un episodio
     * puntual"— y en todos los generados antes de que existiera la grilla.
     */
    windowStart: { type: Date, default: null },

    /**
     * El informe se hizo sobre una ventana que todavía no terminaba, así que
     * le faltan días. Es lo único que se puede regenerar: cuando la ventana
     * cierra, se reemplaza por el definitivo.
     */
    partial: { type: Boolean, default: false },

    headline: { type: String, required: true },
    narrative: { type: String, required: true },
    /**
     * Cada punto lleva su icono temático. `Schema.Types.Mixed` y no un
     * subesquema porque los informes generados antes de esta versión son
     * arrays de strings: la lectura los normaliza en el cliente en vez de
     * migrar la colección.
     */
    risks: { type: [Schema.Types.Mixed], default: [] },
    opportunities: { type: [Schema.Types.Mixed], default: [] },
    recommendations: { type: [Schema.Types.Mixed], default: [] },

    /**
     * Foto de las métricas al momento de generarlo. Sin esto no se puede
     * saber si el informe cambió porque cambió la realidad o porque el
     * período tenía otro volumen.
     */
    snapshot: {
      mentions: { type: Number, default: 0 },
      avgScore: { type: Number },
      negative: { type: Number, default: 0 },
      entities: { type: [String], default: [] },
    },
  },
  { timestamps: true },
);

ExecutiveBriefSchema.index({ projectId: 1, createdAt: -1 });

// Parcial (`sparse`) porque los informes de rango libre dejan `windowStart` en
// null y son varios por proyecto: sin el filtro, el único índice los tomaría
// como duplicados entre sí. Único para que dos corridas simultáneas —el worker
// y el botón, por ejemplo— no puedan dejar dos informes de la misma ventana.
ExecutiveBriefSchema.index(
  { projectId: 1, windowStart: 1 },
  { unique: true, partialFilterExpression: { windowStart: { $type: "date" } } },
);

export type ExecutiveBriefDoc = InferSchemaType<typeof ExecutiveBriefSchema>;

dropStaleModel("ExecutiveBrief", ["windowStart"]);

export default models.ExecutiveBrief ?? model("ExecutiveBrief", ExecutiveBriefSchema);
