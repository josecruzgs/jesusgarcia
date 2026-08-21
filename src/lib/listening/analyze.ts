import Anthropic from "@anthropic-ai/sdk";
import { dbConnect } from "@/lib/mongodb";
import MentionModel from "@/lib/models/Mention";
import ListeningProjectModel from "@/lib/models/ListeningProject";
import ExecutiveBriefModel, { type ExecutiveBriefDoc } from "@/lib/models/ExecutiveBrief";

const MODEL = "claude-opus-5";

// Las menciones se clasifican de a lotes en un solo request. Una llamada por
// mención multiplicaría el costo por el prompt de sistema repetido, que es la
// parte más cara cuando el texto a clasificar son titulares cortos.
const BATCH_SIZE = 20;

// Fallback del lado del servidor: los clasificadores de seguridad pueden
// declinar un request (llega HTTP 200 con stop_reason "refusal"). Con esto la
// API reintenta sola en otro modelo en vez de devolvernos la negativa.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Falta ANTHROPIC_API_KEY en .env.local — el análisis con IA está apagado");
  }
  return new Anthropic();
}

/** Extrae el texto de la respuesta, distinguiendo una negativa de un error. */
function textFrom(response: { stop_reason: string | null; content: unknown[] }): string {
  if (response.stop_reason === "refusal") {
    throw new Error("Claude declinó analizar este contenido");
  }
  const block = response.content.find(
    (b): b is { type: "text"; text: string } =>
      typeof b === "object" && b !== null && (b as { type?: string }).type === "text",
  );
  if (!block) throw new Error("Claude no devolvió texto");
  return block.text;
}

const SENTIMENT_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          relevant: { type: "boolean" },
          irrelevantReason: { type: "string" },
          sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
          score: { type: "integer" },
          topics: { type: "array", items: { type: "string" } },
          summary: { type: "string" },
        },
        required: ["id", "relevant", "irrelevantReason", "sentiment", "score", "topics", "summary"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
} as const;

type SentimentResult = {
  id: string;
  relevant: boolean;
  irrelevantReason: string;
  sentiment: "positive" | "neutral" | "negative";
  score: number;
  topics: string[];
  summary: string;
};

const SENTIMENT_SYSTEM = `Analizas menciones en prensa y redes sobre figuras públicas para una sala de inteligencia política en Sonora, México.

Para cada mención devuelve:
- relevant: si la mención habla REALMENTE de la figura indicada. Este es el juicio más importante. Muchas menciones llegan solo porque coincide una palabra: "Marina" trae la Secretaría de Marina, tortugas marinas, energía eólica marina y el municipio de Soto la Marina; un apellido común trae homónimos. Si el texto no se refiere a esa persona, marca false.
- irrelevantReason: si relevant es false, una frase corta de por qué (ej. "se refiere a la Armada, no a la persona"). Si es true, cadena vacía.
- sentiment: cómo queda parada la figura mencionada. No es el tono general de la nota — una nota neutra que reporta una acusación en su contra es "negative".
- score: entero de -100 (demoledor) a 100 (muy favorable). 0 es estrictamente informativo.
- topics: 1 a 3 temas en minúsculas, en español, del vocabulario del asunto público (agua, seguridad, salud, empleo, corrupción, obra pública, educación, energía…). No inventes temas que la mención no toca.
- summary: una sola oración en español, máximo 20 palabras, que diga qué se dice de la figura.

Cuando relevant es false, igual completa los demás campos con valores neutros (sentiment "neutral", score 0, topics []).

Si el texto es demasiado corto o ambiguo para juzgar, usa sentiment "neutral" y score 0. No adivines.`;

/** Clasifica las menciones sin analizar de un proyecto. Devuelve cuántas procesó. */
export async function analyzeMentions(
  projectId: string,
  limit = 200,
  { reanalyze = false }: { reanalyze?: boolean } = {},
): Promise<number> {
  await dbConnect();

  // Al reanalizar se limpia la marca para que vuelvan a entrar en la cola:
  // hace falta cuando cambia el criterio (p. ej. al estrenar el juicio de
  // relevancia, que las menciones viejas no tienen).
  if (reanalyze) {
    await MentionModel.updateMany({ projectId }, { $set: { analyzedAt: null } });
  }

  const pending = await MentionModel.find({ projectId, analyzedAt: null })
    .sort({ publishedAt: -1 })
    .limit(limit)
    .select("_id title text entity")
    .lean();

  if (pending.length === 0) return 0;

  const anthropic = client();
  let analyzed = 0;

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);

    const payload = batch.map((m) => ({
      id: String(m._id),
      figura: m.entity,
      // El texto se recorta: los cuerpos largos no mejoran la clasificación
      // de sentimiento y sí inflan el costo de forma lineal.
      texto: `${m.title ?? ""}\n${m.text ?? ""}`.trim().slice(0, 1200),
    }));

    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      system: SENTIMENT_SYSTEM,
      // Clasificar titulares no requiere razonamiento profundo, y el effort
      // es la palanca de costo real en este modelo.
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: SENTIMENT_SCHEMA },
      },
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    } as Parameters<typeof anthropic.beta.messages.create>[0]);

    const parsed = JSON.parse(textFrom(response as never)) as { results: SentimentResult[] };

    for (const result of parsed.results ?? []) {
      await MentionModel.findByIdAndUpdate(result.id, {
        $set: {
          relevant: result.relevant,
          irrelevantReason: result.relevant ? undefined : result.irrelevantReason,
          sentiment: result.sentiment,
          // El schema no puede acotar rangos numéricos, así que se acota acá.
          sentimentScore: Math.max(-100, Math.min(100, Math.round(result.score))),
          topics: (result.topics ?? []).slice(0, 3),
          aiSummary: result.summary,
          analyzedAt: new Date(),
        },
      });
      analyzed += 1;
    }
  }

  return analyzed;
}

/**
 * Vocabulario cerrado de iconos. Es cerrado a propósito: si el modelo pudiera
 * inventar nombres, la mitad no tendría componente que los dibuje.
 */
export const BRIEF_ICONS = [
  "audio",
  "legal",
  "dinero",
  "seguridad",
  "salud",
  "prensa",
  "partido",
  "eleccion",
  "obra",
  "ambiente",
  "educacion",
  "internacional",
  "comunicacion",
  "datos",
  "tiempo",
  "alerta",
  "oportunidad",
  "personas",
] as const;

export type BriefIcon = (typeof BRIEF_ICONS)[number];

export type BriefPoint = { text: string; icon: BriefIcon };

export type ExecutiveBrief = {
  headline: string;
  narrative: string;
  risks: BriefPoint[];
  opportunities: BriefPoint[];
  recommendations: BriefPoint[];
};

const POINT_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      text: { type: "string" },
      icon: { type: "string", enum: [...BRIEF_ICONS] },
    },
    required: ["text", "icon"],
    additionalProperties: false,
  },
} as const;

const BRIEF_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    narrative: { type: "string" },
    risks: POINT_SCHEMA,
    opportunities: POINT_SCHEMA,
    recommendations: POINT_SCHEMA,
  },
  required: ["headline", "narrative", "risks", "opportunities", "recommendations"],
  additionalProperties: false,
} as const;

/**
 * Resumen ejecutivo del período: qué se está diciendo y qué hacer al respecto.
 *
 * Con `windowStart` el informe queda anclado a una ventana de la grilla de
 * tres días y se guarda con `findOneAndUpdate`, no con `create`: la ventana es
 * la clave de idempotencia, así que regenerarla reemplaza el informe en vez de
 * ensuciar el historial con dos lecturas del mismo período. Sin `windowStart`
 * es un informe de rango libre y siempre se agrega uno nuevo.
 *
 * Devuelve el documento guardado (y no solo lo que dijo el modelo) porque la
 * interfaz necesita su `_id`, su período y su `snapshot` para pintarlo sin
 * tener que ir a buscarlo de nuevo.
 */
export async function buildExecutiveBrief(
  projectId: string,
  since: Date,
  until: Date,
  { windowStart = null, partial = false }: { windowStart?: Date | null; partial?: boolean } = {},
): Promise<ExecutiveBriefDoc & { _id: unknown }> {
  await dbConnect();

  const project = await ListeningProjectModel.findById(projectId).lean();
  if (!project) throw new Error("Proyecto no encontrado");

  const mentions = await MentionModel.find({
    projectId,
    publishedAt: { $gte: since, $lte: until },
    // Lo que la IA marcó como ajeno a la figura no entra al informe: haría
    // que el analista razonara sobre tortugas marinas.
    relevant: { $ne: false },
  })
    .sort({ publishedAt: -1 })
    .limit(300)
    .select("entity title aiSummary sentiment sentimentScore topics domain platform publishedAt")
    .lean();

  if (mentions.length === 0) {
    throw new Error("No hay menciones en el período seleccionado");
  }

  const corpus = mentions.map((m) => ({
    figura: m.entity,
    fecha: m.publishedAt?.toISOString().slice(0, 10),
    medio: m.domain || m.platform,
    sentimiento: m.sentiment ?? "sin analizar",
    score: m.sentimentScore ?? null,
    temas: m.topics ?? [],
    resumen: m.aiSummary || m.title || "",
  }));

  const anthropic = client();

  const response = await anthropic.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    system: `Eres el analista de una sala de inteligencia política en Sonora, México. Recibes el corpus de menciones de un período y escribes el informe para quien toma decisiones.

Escribe en español, directo y sin relleno. Nada de "es importante notar que".

- headline: una oración con la lectura del período. Lo que la persona diría si le preguntaran "¿cómo venimos?".
- narrative: dos o tres párrafos. Qué se movió, por qué, y de dónde salió. Nombra medios y temas concretos que estén en los datos.
- risks: entre 2 y 5 riesgos concretos, cada uno anclado en algo que aparece en el corpus.
- opportunities: entre 2 y 5, mismo criterio.
- recommendations: entre 3 y 5 acciones. Accionables y específicas, no genéricas.

Cada punto de esas tres listas lleva un "icon" que resume de qué trata, elegido de esta lista:
audio (grabaciones, filtraciones, entrevistas), legal (fiscalía, juicios, denuncias, extradición),
dinero (patrimonio, presupuesto, contratos, recaudación), seguridad (delito, policía, operativos),
salud (hospitales, servicios médicos), prensa (medios, cobertura, titulares),
partido (interna, dirigencia, alianzas), eleccion (candidaturas, sucesión, votos),
obra (infraestructura, pavimentación, transporte), ambiente (agua, reforestación, clima),
educacion (escuelas, becas), internacional (visa, Estados Unidos, relaciones exteriores),
comunicacion (vocería, mensajes, estrategia de comunicación), datos (cifras, mediciones),
tiempo (plazos, calendario, urgencia), alerta (riesgo general sin tema claro),
oportunidad (ventaja sin tema claro), personas (ciudadanía, grupos, colectivos).

Elige el que mejor describa el punto. Si ninguno encaja, usa alerta para riesgos, oportunidad para
oportunidades y comunicacion para recomendaciones.

No afirmes nada que el corpus no sustente. Si el volumen es bajo para concluir, dilo en la narrativa.`,
    // Acá sí conviene el razonamiento profundo: es síntesis sobre cientos de
    // menciones, no clasificación de una.
    output_config: {
      effort: "high",
      format: { type: "json_schema", schema: BRIEF_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: `Proyecto: ${project.name}
Figuras monitoreadas: ${((project.entities ?? []) as { name: string }[]).map((e) => e.name).join(", ")}
Período: ${since.toISOString().slice(0, 10)} a ${until.toISOString().slice(0, 10)}
Menciones en el corpus: ${mentions.length}

${JSON.stringify(corpus)}`,
      },
    ],
  } as Parameters<typeof anthropic.beta.messages.create>[0]);

  const brief = JSON.parse(textFrom(response as never)) as ExecutiveBrief;

  const scored = mentions.filter((m) => typeof m.sentimentScore === "number");
  const avgScore =
    scored.length > 0
      ? Math.round(scored.reduce((sum, m) => sum + (m.sentimentScore ?? 0), 0) / scored.length)
      : undefined;

  const fields = {
    from: since,
    to: until,
    partial,
    ...brief,
    snapshot: {
      mentions: mentions.length,
      avgScore,
      negative: mentions.filter((m) => m.sentiment === "negative").length,
      entities: [...new Set(mentions.map((m) => m.entity).filter(Boolean))],
    },
  };

  if (windowStart) {
    return (await ExecutiveBriefModel.findOneAndUpdate(
      { projectId, windowStart },
      { $set: fields, $setOnInsert: { projectId, windowStart } },
      { new: true, upsert: true },
    ).lean()) as ExecutiveBriefDoc & { _id: unknown };
  }

  const created = await ExecutiveBriefModel.create({ projectId, windowStart: null, ...fields });
  return created.toObject() as ExecutiveBriefDoc & { _id: unknown };
}
