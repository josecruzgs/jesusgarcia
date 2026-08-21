import { Schema, models, model, type InferSchemaType } from "mongoose";
import { dropStaleModel } from "./staleModel";

export const IDEA_KINDS = ["accion", "publicacion"] as const;
export const IDEA_PRIORITIES = ["alta", "media", "baja"] as const;

/**
 * Una idea para mover la imagen pública de la figura, sacada del análisis de la
 * escucha pero SIN colgar de una publicación concreta.
 *
 * Es la contraparte de ActionPlay. Una jugada actúa sobre algo que ya se
 * publicó —comentar acá, reaccionar allá— y termina en una campaña que el
 * runner ejecuta. Una idea no tiene a dónde apuntar el navegador: "abrir una
 * ventanilla en la colonia" o "publicar un carrusel con el avance de la obra"
 * los hace un humano. Por eso no comparte colección con las jugadas: no tiene
 * target, no tiene despacho, y mezclarlas obligaría a que media docena de
 * campos vivieran vacíos en la mitad de los documentos.
 *
 * Dos tipos, que son las dos columnas de la pantalla:
 * - "accion": qué hacer en el terreno. No es una publicación.
 * - "publicacion": qué publicar, con un borrador del texto listo para editar.
 */
const ImageIdeaSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: "ListeningProject", required: true },
    // Igual que ActionPlay: dueño propio, porque las ideas se listan y se
    // borran por usuario sin pasar siempre por el proyecto.
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },

    kind: { type: String, enum: IDEA_KINDS, required: true },

    /** Qué hacer o qué publicar, en una línea. Es el título de la tarjeta. */
    title: { type: String, required: true },
    /** Por qué conviene, anclado en lo que el análisis encontró. */
    detail: { type: String, required: true },
    /** Del vocabulario cerrado de iconos del brief (ver analyze.ts). */
    icon: { type: String, default: "oportunidad" },
    priority: { type: String, enum: IDEA_PRIORITIES, default: "media" },

    /** Solo en "publicacion": el texto propuesto, listo para copiar y ajustar. */
    draft: { type: String, default: "" },
    /** Solo en "publicacion": dónde va y en qué formato. Libres a propósito. */
    platform: { type: String, default: "" },
    format: { type: String, default: "" },

    /**
     * Ideas marcadas para conservar. Generar de nuevo borra el lote anterior
     * —si no, cada corrida acumularía veinte tarjetas más— y esta bandera es la
     * forma de salvar las que sí sirvieron. Además se le pasan al modelo para
     * que no vuelva a proponer lo mismo.
     */
    kept: { type: Boolean, default: false },
  },
  { timestamps: true },
);

ImageIdeaSchema.index({ projectId: 1, kind: 1, createdAt: -1 });

export type ImageIdea = InferSchemaType<typeof ImageIdeaSchema>;

dropStaleModel("ImageIdea", ["kind", "title", "detail", "draft", "kept"]);

export default models.ImageIdea ?? model("ImageIdea", ImageIdeaSchema);
