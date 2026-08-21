import { Schema, models, model, type InferSchemaType } from "mongoose";

const MentionSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: "ListeningProject", required: true },

    /**
     * Qué personaje del proyecto disparó esta mención. Una misma nota puede
     * entrar dos veces si habla de dos personajes distintos — es intencional:
     * el share of voice se cuenta por personaje.
     *
     * `entity` es el nombre visible y se reescribe si la figura se renombra;
     * `entityKey` es la identidad estable y es la que entra en el hash. Separar
     * ambos es lo que evita que un cambio de nombre duplique el historial.
     */
    entity: { type: String, required: true },
    entityKey: { type: String, default: "" },

    provider: { type: String, required: true },
    platform: { type: String, required: true },
    sourceType: {
      type: String,
      enum: ["news", "social", "video", "forum", "blog", "review"],
      default: "news",
    },

    domain: { type: String },
    url: { type: String, required: true },
    title: { type: String },
    text: { type: String, default: "" },
    author: { type: String },
    authorFollowers: { type: Number },

    publishedAt: { type: Date, required: true },
    lang: { type: String },

    engagement: {
      likes: { type: Number },
      comments: { type: Number },
      shares: { type: Number },
      views: { type: Number },
    },
    // Alcance estimado. En redes sale de seguidores; en noticias no hay dato
    // confiable, así que queda nulo en vez de inventar un número.
    reach: { type: Number },

    /**
     * ¿La mención habla realmente de la figura, o solo coincide el texto?
     * Lo decide la IA durante el análisis. Un alias corto como "Marina" trae
     * la Armada, tortugas marinas y Soto la Marina; sin este campo esa basura
     * contamina el sentimiento promedio y el conteo.
     *
     * null = todavía no evaluada.
     */
    relevant: { type: Boolean, default: null },
    /** Por qué se descartó, para poder auditar el criterio de la IA. */
    irrelevantReason: { type: String },

    sentiment: { type: String, enum: ["positive", "neutral", "negative"] },
    // -100 a 100. Guardar el escalar además de la etiqueta permite promediar
    // sin tener que mapear categorías a números en cada consulta.
    sentimentScore: { type: Number },
    topics: { type: [String], default: [] },
    aiSummary: { type: String },
    analyzedAt: { type: Date },

    // sha1 de (proyecto + entityKey + url normalizada). Es la clave real de
    // deduplicación: el mismo artículo reaparece en cada corrida y en varios
    // proveedores a la vez.
    hash: { type: String, required: true },
  },
  { timestamps: true },
);

MentionSchema.index({ projectId: 1, hash: 1 }, { unique: true });
MentionSchema.index({ projectId: 1, publishedAt: -1 });
MentionSchema.index({ projectId: 1, sentiment: 1, publishedAt: -1 });
MentionSchema.index({ projectId: 1, entity: 1, publishedAt: -1 });
// Menciones pendientes de análisis, para que el worker las encuentre barato.
MentionSchema.index({ projectId: 1, analyzedAt: 1 });

export type Mention = InferSchemaType<typeof MentionSchema>;

export default models.Mention ?? model("Mention", MentionSchema);
