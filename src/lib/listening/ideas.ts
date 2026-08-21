import Anthropic from "@anthropic-ai/sdk";
import { dbConnect } from "@/lib/mongodb";
import MentionModel from "@/lib/models/Mention";
import ListeningProjectModel from "@/lib/models/ListeningProject";
import ExecutiveBriefModel from "@/lib/models/ExecutiveBrief";
import ImageIdeaModel, { IDEA_KINDS, IDEA_PRIORITIES, type ImageIdea } from "@/lib/models/ImageIdea";
import { BRIEF_ICONS } from "./analyze";

const MODEL = "claude-opus-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Cuántas ideas de cada tipo propone una corrida. Es una columna cada una. */
export const DEFAULT_IDEA_COUNT = 10;

/**
 * Ventana del análisis. Más larga que la de las jugadas (21 días): una jugada
 * tiene que caer sobre una publicación que todavía se esté leyendo, pero una
 * idea de imagen sale de la tendencia del período, y un mes es lo que hace
 * falta para verla.
 */
const LOOKBACK_DAYS = 30;

/** Techo de menciones que se le muestran al modelo. */
const CORPUS_LIMIT = 70;

function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Falta ANTHROPIC_API_KEY en .env.local — las recomendaciones están apagadas");
  }
  return new Anthropic();
}

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

const IDEAS_SCHEMA = {
  type: "object",
  properties: {
    ideas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...IDEA_KINDS] },
          title: { type: "string" },
          detail: { type: "string" },
          icon: { type: "string", enum: [...BRIEF_ICONS] },
          priority: { type: "string", enum: [...IDEA_PRIORITIES] },
          draft: { type: "string" },
          platform: { type: "string" },
          format: { type: "string" },
        },
        required: ["kind", "title", "detail", "icon", "priority", "draft", "platform", "format"],
        additionalProperties: false,
      },
    },
  },
  required: ["ideas"],
  additionalProperties: false,
} as const;

type RawIdea = {
  kind: (typeof IDEA_KINDS)[number];
  title: string;
  detail: string;
  icon: string;
  priority: (typeof IDEA_PRIORITIES)[number];
  draft: string;
  platform: string;
  format: string;
};

const SYSTEM = `Eres el estratega de imagen pública de una sala de inteligencia política en Sonora, México. Recibes lo que el monitoreo encontró sobre las figuras que se cuidan —publicaciones de redes, notas de prensa, el sentimiento del período— y propones qué hacer para mejorar cómo se les percibe.

Devuelves dos tipos de idea, y la diferencia entre los dos es dura:

- "accion": algo que la figura o su equipo HACE en el terreno. Una gira, una mesa de trabajo, una ventanilla, una auditoría abierta, una reunión con quien está inconforme, un cambio operativo. NO es una publicación y no se resuelve publicando: si la idea se puede ejecutar desde un teléfono escribiendo un texto, no va acá. Deja el "draft", "platform" y "format" en cadena vacía.
- "publicacion": algo que se publica. Acá sí devuelve el borrador listo en "draft" —el texto tal cual iría, no una descripción de qué publicar—, la red en "platform" (Facebook, Instagram, TikTok, X, o varias) y el formato en "format" (foto, carrusel, video corto, en vivo, texto, historia).

Para cada idea:
- title: qué es, en una línea, en imperativo. Ej. "Abrir una mesa semanal con comerciantes del centro".
- detail: por qué conviene AHORA, anclado en lo que el monitoreo encontró — el tema que está pesando, la queja que se repite, la oportunidad que nadie tomó. Una o dos oraciones. Nada genérico: si la idea serviría igual para cualquier político del país, no sirve.
- icon: de qué trata el asunto, del vocabulario cerrado de abajo.
- priority: "alta" si atiende algo que está haciendo daño o creciendo ahora, "baja" si es de fondo.

Iconos disponibles: audio, legal, dinero, seguridad, salud, prensa, partido, eleccion, obra, ambiente, educacion, internacional, comunicacion, datos, tiempo, alerta, oportunidad, personas.

Criterio general: cada idea tiene que salir de algo que está en los datos, no del manual de campaña. Prefiere lo concreto y ejecutable esta semana sobre lo aspiracional. Nada de negar hechos verificables ni de atacar personas: la imagen se mueve con obra, presencia y contexto.`;

/**
 * Recorte del período que se le pasa al modelo: las menciones que más pesan,
 * más el conteo de temas.
 *
 * A diferencia de las jugadas, acá NO se filtra a redes sociales. Una nota de
 * prensa no se puede comentar ni likear, pero sí puede ser justamente lo que
 * amerita una acción en el terreno — y muchas veces es donde está el daño.
 */
async function corpus(projectId: string) {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);

  const mentions = await MentionModel.find({
    projectId,
    relevant: { $ne: false },
    publishedAt: { $gte: since },
  })
    .sort({ publishedAt: -1 })
    .limit(500)
    .select("entity title text aiSummary author domain platform sentiment sentimentScore topics engagement reach publishedAt")
    .lean();

  const topics = new Map<string, { count: number; score: number }>();
  for (const mention of mentions) {
    for (const topic of mention.topics ?? []) {
      const row = topics.get(topic) ?? { count: 0, score: 0 };
      row.count += 1;
      row.score += mention.sentimentScore ?? 0;
      topics.set(topic, row);
    }
  }

  const ranked = mentions
    .map((mention) => {
      const engagement =
        (mention.engagement?.likes ?? 0) +
        (mention.engagement?.comments ?? 0) +
        (mention.engagement?.shares ?? 0);

      // Mismo criterio que en las jugadas: pesa lo que se movió, sin importar
      // el signo — lo muy adverso pide respuesta y lo muy favorable pide que se
      // repita lo que se hizo bien.
      const weight =
        Math.abs(mention.sentimentScore ?? 0) * 2 +
        Math.log10(1 + engagement) * 40 +
        Math.log10(1 + (mention.reach ?? 0)) * 15;

      return { mention, engagement, weight };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, CORPUS_LIMIT)
    .map(({ mention, engagement }) => ({
      red: mention.platform,
      figura: mention.entity,
      autor: mention.author || mention.domain || mention.platform,
      fecha: mention.publishedAt?.toISOString().slice(0, 10),
      sentimiento: mention.sentiment ?? "sin analizar",
      score: mention.sentimentScore ?? null,
      temas: mention.topics ?? [],
      interacciones: engagement,
      texto: (mention.aiSummary || mention.title || mention.text || "").slice(0, 400),
    }));

  return {
    total: mentions.length,
    publicaciones: ranked,
    temas: [...topics.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 20)
      .map(([tema, row]) => ({
        tema,
        menciones: row.count,
        sentimientoPromedio: Math.round(row.score / row.count),
      })),
  };
}

/**
 * Propone ideas para mover la imagen pública: acciones de terreno y
 * publicaciones nuevas.
 *
 * Reemplaza el lote anterior salvo lo que se haya marcado como guardado. Si se
 * acumularan, cada corrida dejaría veinte tarjetas más en pantalla y la lista
 * dejaría de leerse; lo guardado sobrevive y además se le pasa al modelo para
 * que no vuelva a proponer lo mismo con otras palabras.
 */
export async function generateImageIdeas(
  projectId: string,
  { count = DEFAULT_IDEA_COUNT }: { count?: number } = {},
): Promise<ImageIdea[]> {
  await dbConnect();

  const project = await ListeningProjectModel.findById(projectId).lean();
  if (!project) throw new Error("Proyecto no encontrado");

  const period = await corpus(projectId);
  if (period.total === 0) {
    throw new Error(
      "No hay menciones del último mes de las que sacar ideas. Corre la escucha del proyecto primero.",
    );
  }

  const brief = await ExecutiveBriefModel.findOne({ projectId })
    .sort({ createdAt: -1 })
    .select("headline narrative risks opportunities recommendations")
    .lean();

  const kept = await ImageIdeaModel.find({ projectId, kept: true })
    .select("kind title")
    .lean();

  const anthropic = client();

  const response = await anthropic.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    system: SYSTEM,
    // Pensar qué hacer en el terreno a partir de un mes de menciones es
    // síntesis pura: el effort alto se nota, igual que en las jugadas.
    output_config: {
      effort: "high",
      format: { type: "json_schema", schema: IDEAS_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: `Proyecto: ${project.name}
Figuras que se cuidan: ${((project.entities ?? []) as { name: string }[]).map((e) => e.name).join(", ")}

Propón EXACTAMENTE ${count} ideas de tipo "accion" y ${count} de tipo "publicacion".

${
  brief
    ? `Lectura vigente del período:
${brief.headline}
${brief.narrative}
Riesgos: ${JSON.stringify(brief.risks)}
Oportunidades: ${JSON.stringify(brief.opportunities)}
Recomendaciones: ${JSON.stringify(brief.recommendations)}
`
    : "No hay resumen ejecutivo todavía: decide solo con las menciones.\n"
}
${
  kept.length > 0
    ? `Ideas que el equipo ya guardó y sigue trabajando — NO las repitas ni las reformules:
${kept.map((idea) => `- (${idea.kind}) ${idea.title}`).join("\n")}
`
    : ""
}
Temas del último mes, por cuántas veces salieron:
${JSON.stringify(period.temas)}

Menciones del último mes (${period.total} en total, van las ${period.publicaciones.length} que más pesan):
${JSON.stringify(period.publicaciones)}`,
      },
    ],
  } as Parameters<typeof anthropic.beta.messages.create>[0]);

  const parsed = JSON.parse(textFrom(response as never)) as { ideas: RawIdea[] };

  const docs = [];
  const perKind: Record<string, number> = { accion: 0, publicacion: 0 };

  for (const idea of parsed.ideas ?? []) {
    if (!IDEA_KINDS.includes(idea.kind)) continue;
    const title = String(idea.title ?? "").trim();
    const detail = String(idea.detail ?? "").trim();
    if (!title || !detail) continue;
    // El schema JSON no sabe contar: pide "exactamente N de cada tipo" en el
    // prompt y se recorta acá, para que un lote de más no desbalancee las
    // columnas.
    if (perKind[idea.kind] >= count) continue;
    perKind[idea.kind] += 1;

    docs.push({
      projectId,
      ownerId: project.ownerId,
      kind: idea.kind,
      title,
      detail,
      icon: idea.icon,
      priority: idea.priority,
      // Los tres campos del borrador solo existen para las publicaciones. Si el
      // modelo los llenó en una acción se descartan: la distinción entre las
      // dos columnas es justamente que una no se resuelve publicando.
      draft: idea.kind === "publicacion" ? String(idea.draft ?? "").trim() : "",
      platform: idea.kind === "publicacion" ? String(idea.platform ?? "").trim() : "",
      format: idea.kind === "publicacion" ? String(idea.format ?? "").trim() : "",
      kept: false,
    });
  }

  if (docs.length === 0) throw new Error("Claude no propuso ninguna idea con estas menciones");

  // Recién acá se borra el lote viejo: si la llamada falla, la pantalla se
  // queda con las ideas anteriores en vez de vaciarse.
  await ImageIdeaModel.deleteMany({ projectId, kept: { $ne: true } });

  return (await ImageIdeaModel.insertMany(docs)) as unknown as ImageIdea[];
}
