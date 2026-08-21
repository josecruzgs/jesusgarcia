import { Schema, models, model, type InferSchemaType } from "mongoose";
import { dropStaleModel } from "./staleModel";

// Un "personaje" a monitorear. Los alias son cómo lo nombra la gente en la
// práctica (apodos, apellido solo, cuenta de X) — sin ellos se pierde la
// mayoría de las menciones reales, que casi nunca usan el nombre completo.
const EntitySchema = new Schema(
  {
    /**
     * Identidad estable de la figura, asignada al crearla y nunca reescrita.
     *
     * Las menciones se deduplican contra esta clave y no contra el nombre: sin
     * ella, corregir el nombre visible cambiaba la clave de todo el historial y
     * la corrida siguiente reingresaba cada nota que ya estaba guardada.
     */
    key: { type: String, required: true },
    name: { type: String, required: true },
    aliases: { type: [String], default: [] },
    /**
     * URLs de cuentas a vigilar en redes (x.com/…, instagram.com/…). Van por
     * figura y no por proyecto porque las menciones se atribuyen a quien
     * publica: un post de la cuenta de Marina del Pilar es de ella.
     *
     * Existen porque los scrapers de X y Facebook de Bright Data NO buscan
     * por palabra clave — solo descubren posts a partir de un perfil. Sin
     * esta lista, esas dos plataformas no se pueden monitorear.
     */
    profiles: { type: [String], default: [] },
  },
  { _id: false },
);

const ListeningProjectSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true },
    description: { type: String },

    entities: { type: [EntitySchema], default: [] },

    // Filtros de texto sobre la mención ya traída. `includeTerms` exige que
    // aparezca al menos uno (además del personaje); `excludeTerms` descarta
    // — sirve para desambiguar homónimos.
    includeTerms: { type: [String], default: [] },
    excludeTerms: { type: [String], default: [] },

    languages: { type: [String], default: ["es"] },

    // Whitelist con contenido = SOLO esos dominios. Vacía = todos menos los
    // de la blacklist. Es el mismo criterio de Brand24: la whitelist es un
    // modo restrictivo, no una lista de favoritos.
    whitelistDomains: { type: [String], default: [] },
    blacklistDomains: { type: [String], default: [] },

    rssFeeds: { type: [String], default: [] },

    sources: {
      googleNews: { type: Boolean, default: true },
      gdelt: { type: Boolean, default: true },
      rss: { type: Boolean, default: true },
      youtube: { type: Boolean, default: false },
      brightData: { type: Boolean, default: false },
    },

    // Plataformas de Bright Data habilitadas (x, instagram, tiktok,
    // facebook, linkedin). Cada una es un dataset distinto de su lado.
    brightDataPlatforms: { type: [String], default: [] },

    // Si está en true, cada mención nueva pasa por Claude para sentimiento y
    // temas. Se puede apagar para ahorrar tokens en proyectos de alto volumen.
    autoAnalyze: { type: Boolean, default: true },

    // El worker cierra solo las ventanas de tres días del resumen ejecutivo a
    // medida que van venciendo (ver briefWindows.ts). Apagarlo deja la grilla
    // igual, solo que las ventanas se generan a mano desde el panel.
    autoBrief: { type: Boolean, default: true },

    status: { type: String, enum: ["active", "paused"], default: "active" },
    intervalMinutes: { type: Number, default: 60 },

    lastRunAt: { type: Date },
    lastRunError: { type: String },
    mentionCount: { type: Number, default: 0 },

    /**
     * Scrapes de Bright Data disparados que todavía no terminaron.
     *
     * Sin esto, un scrape que tarda más que el techo de espera deja su
     * snapshot huérfano y la corrida siguiente dispara uno nuevo desde cero —
     * pagando dos veces por el mismo dato. Guardando el id, la próxima
     * corrida retoma el que ya está en marcha en vez de facturar otro.
     */
    pendingSnapshots: {
      type: [
        new Schema(
          {
            // `figura|plataforma` — un scrape en vuelo por combinación.
            key: { type: String, required: true },
            snapshotId: { type: String, required: true },
            triggeredAt: { type: Date, default: () => new Date() },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true },
);

// Sin ownerId adelante: lo usa findDueProjects, que barre los proyectos
// vencidos de todos los usuarios (src/lib/listening/ingest.ts).
ListeningProjectSchema.index({ status: 1, lastRunAt: 1 });
ListeningProjectSchema.index({ ownerId: 1, createdAt: -1 });

dropStaleModel("ListeningProject", ["ownerId", "autoBrief"]);

export type ListeningProject = InferSchemaType<typeof ListeningProjectSchema>;

export default models.ListeningProject ?? model("ListeningProject", ListeningProjectSchema);
