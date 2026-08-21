import Anthropic from "@anthropic-ai/sdk";
import { dbConnect } from "@/lib/mongodb";
import MentionModel from "@/lib/models/Mention";
import ListeningProjectModel from "@/lib/models/ListeningProject";
import ExecutiveBriefModel from "@/lib/models/ExecutiveBrief";
import ActionPlayModel, {
  PLAY_KINDS,
  PLAY_PRIORITIES,
  type ActionPlay,
} from "@/lib/models/ActionPlay";
import { platformFromUrl, REACTIONS } from "@/lib/automation/socialSelectors";
import { BRIEF_ICONS } from "./analyze";

const MODEL = "claude-opus-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Cuántas jugadas propone una corrida, sumando likes y comentarios.
 *
 * Diez y no veinte: la lista se revisa a mano una por una antes de activar
 * nada, y con veinte tarjetas la revisión se convierte en scroll. Es un techo,
 * no una cuota — el prompt pide explícitamente devolver menos si solo unas
 * pocas publicaciones ameritan acción.
 */
export const DEFAULT_PLAY_COUNT = 10;

/**
 * Ventana de la que salen los candidatos. Comentar una nota de hace dos meses
 * no mueve nada —nadie la está leyendo— y likear un post viejo desde diez
 * perfiles a la vez es exactamente el patrón que Facebook marca como
 * inauténtico.
 */
const LOOKBACK_DAYS = 21;

/** Techo de menciones que se le muestran al modelo para elegir. */
const CANDIDATE_LIMIT = 60;

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

const PLAYS_SCHEMA = {
  type: "object",
  properties: {
    plays: {
      type: "array",
      items: {
        type: "object",
        properties: {
          mentionId: { type: "string" },
          kind: { type: "string", enum: [...PLAY_KINDS] },
          reaction: { type: "string", enum: REACTIONS.map((r) => r.key) },
          headline: { type: "string" },
          rationale: { type: "string" },
          icon: { type: "string", enum: [...BRIEF_ICONS] },
          priority: { type: "string", enum: [...PLAY_PRIORITIES] },
          suggestedCount: { type: "integer" },
          comments: { type: "array", items: { type: "string" } },
        },
        required: [
          "mentionId",
          "kind",
          "reaction",
          "headline",
          "rationale",
          "icon",
          "priority",
          "suggestedCount",
          "comments",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["plays"],
  additionalProperties: false,
} as const;

type RawPlay = {
  mentionId: string;
  kind: (typeof PLAY_KINDS)[number];
  reaction: string;
  headline: string;
  rationale: string;
  icon: string;
  priority: (typeof PLAY_PRIORITIES)[number];
  suggestedCount: number;
  comments: string[];
};

const SYSTEM = `Eres el estratega de reacción de una sala de inteligencia política en Sonora, México. Recibes publicaciones de redes sociales que el monitoreo encontró sobre las figuras que se cuidan, y decides sobre cuáles conviene actuar y cómo.

Solo existen dos jugadas, porque son las dos únicas que el sistema sabe ejecutar:

- "comment": publicar N comentarios de cuentas distintas en esa publicación. Es la jugada para lo ADVERSO — defender con hechos, dar contexto que la nota omite, o desactivar una acusación. También sirve en publicaciones favorables para sumarle testimonio.
- "like": mandar N reacciones a la publicación. Es la jugada para AMPLIFICAR lo que ya juega a favor: subirle señal a un post favorable que está pasando desapercibido.

Para cada jugada devuelve:
- mentionId: el id EXACTO de la publicación de la lista. No inventes ids ni repitas uno.
- kind y reaction. "reaction" solo importa cuando kind es "like"; si no tienes motivo para otra, usa "like".
- headline: qué hacer, en una línea, en imperativo. Ej. "Responder con las cifras del operativo en la nota de Latinus".
- rationale: por qué conviene, anclado en lo que dice ESA publicación. Una o dos oraciones.
- icon: de qué trata el asunto, del vocabulario cerrado que se lista abajo.
- priority: "alta" si el post está creciendo o el daño es directo, "baja" si es marginal.
- suggestedCount: cuántas cuentas participan. Entre 3 y 15. Sé conservador: veinte comentarios en un post chico se leen como operación y hacen más daño que la nota.
- comments: si kind es "comment", EXACTAMENTE tantos textos como cuentas pusiste en suggestedCount — uno por cuenta, porque ninguna campaña puede repetir un comentario en la misma publicación. Todos distintos entre sí, cada uno como lo escribiría una persona real de la zona: voz propia, largo desigual, sin hashtags de campaña, sin la misma frase con sinónimos. Nada de insultos ni de negar hechos verificables: se defiende con contexto y datos, no peleando. Si no te salen tantos textos genuinamente distintos, baja suggestedCount — es preferible a repetir. Si kind es "like", devuelve una lista vacía.

Iconos disponibles: audio, legal, dinero, seguridad, salud, prensa, partido, eleccion, obra, ambiente, educacion, internacional, comunicacion, datos, tiempo, alerta, oportunidad, personas.

Criterio general: propón jugadas solo donde muevan algo. Una publicación sin interacción y sin alcance no vale una campaña. Si de la lista solo unas pocas ameritan acción, devuelve solo esas — es preferible a rellenar.`;

/**
 * Publicaciones sobre las que se puede actuar: solo redes sociales, porque el
 * runner opera un navegador contra la publicación. En una nota de prensa no
 * hay nada que likear ni una caja de comentario que el sistema sepa encontrar.
 */
async function candidateMentions(projectId: string) {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);

  const busy = await ActionPlayModel.find({
    projectId,
    status: { $in: ["suggested", "approved", "dispatched"] },
  })
    .select("mentionId")
    .lean();
  const taken = new Set(busy.map((play) => String(play.mentionId)));

  const mentions = await MentionModel.find({
    projectId,
    relevant: { $ne: false },
    publishedAt: { $gte: since },
    url: { $ne: null },
  })
    .sort({ publishedAt: -1 })
    .limit(400)
    .select("entity title text aiSummary author url domain platform sentiment sentimentScore engagement reach publishedAt")
    .lean();

  return mentions
    .filter((mention) => !taken.has(String(mention._id)))
    .map((mention) => ({
      mention,
      platform: platformFromUrl(mention.url ?? ""),
    }))
    .filter((row): row is { mention: (typeof mentions)[number]; platform: string } =>
      Boolean(row.platform),
    )
    .map(({ mention, platform }) => {
      const engagement =
        (mention.engagement?.likes ?? 0) +
        (mention.engagement?.comments ?? 0) +
        (mention.engagement?.shares ?? 0);

      // Ordena por "cuánto importa", no por fecha: la carga es el sentimiento
      // desplazado del cero (da igual el signo — lo muy favorable se amplifica
      // y lo muy adverso se contesta) pesado por la tracción que ya tiene.
      const weight =
        Math.abs(mention.sentimentScore ?? 0) * 2 +
        Math.log10(1 + engagement) * 40 +
        Math.log10(1 + (mention.reach ?? 0)) * 15;

      return { mention, platform, engagement, weight };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, CANDIDATE_LIMIT);
}

/**
 * Propone jugadas de acción sobre lo que la escucha encontró.
 *
 * Las ideas salen de dos lados: las publicaciones concretas del período (qué
 * se está diciendo y dónde tiene tracción) y el último resumen ejecutivo, que
 * aporta la línea —sus recomendaciones y oportunidades son la estrategia que
 * estas jugadas ejecutan en el terreno.
 */
export async function generateActionPlays(
  projectId: string,
  { count = DEFAULT_PLAY_COUNT }: { count?: number } = {},
): Promise<ActionPlay[]> {
  await dbConnect();

  const project = await ListeningProjectModel.findById(projectId).lean();
  if (!project) throw new Error("Proyecto no encontrado");

  const candidates = await candidateMentions(projectId);
  if (candidates.length === 0) {
    throw new Error(
      "No hay publicaciones de redes sobre las que actuar. Las notas de prensa no se pueden comentar ni reaccionar: hacen falta menciones de Facebook, Instagram, TikTok o X (se traen con Bright Data).",
    );
  }

  // El último informe da la línea. Sin él las jugadas salen igual, solo que
  // reaccionando post por post en vez de dentro de una estrategia.
  const brief = await ExecutiveBriefModel.findOne({ projectId })
    .sort({ createdAt: -1 })
    .select("headline narrative risks opportunities recommendations")
    .lean();

  const corpus = candidates.map(({ mention, platform, engagement }) => ({
    id: String(mention._id),
    red: platform,
    figura: mention.entity,
    autor: mention.author || mention.domain || platform,
    fecha: mention.publishedAt?.toISOString().slice(0, 10),
    sentimiento: mention.sentiment ?? "sin analizar",
    score: mention.sentimentScore ?? null,
    interacciones: engagement,
    alcance: mention.reach ?? 0,
    texto: (mention.aiSummary || mention.title || mention.text || "").slice(0, 400),
  }));

  const anthropic = client();

  const response = await anthropic.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    system: SYSTEM,
    // Elegir sobre qué publicación actuar y redactar comentarios que no suenen
    // a plantilla es síntesis, no clasificación: el effort alto se nota.
    output_config: {
      effort: "high",
      format: { type: "json_schema", schema: PLAYS_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: `Proyecto: ${project.name}
Figuras que se cuidan: ${((project.entities ?? []) as { name: string }[]).map((e) => e.name).join(", ")}
Propón hasta ${count} jugadas.

${
  brief
    ? `Lectura vigente del período:
${brief.headline}
${brief.narrative}
Riesgos: ${JSON.stringify(brief.risks)}
Oportunidades: ${JSON.stringify(brief.opportunities)}
Recomendaciones: ${JSON.stringify(brief.recommendations)}
`
    : "No hay resumen ejecutivo todavía: decide solo con las publicaciones.\n"
}
Publicaciones candidatas (${corpus.length}), ordenadas por cuánto importan:
${JSON.stringify(corpus)}`,
      },
    ],
  } as Parameters<typeof anthropic.beta.messages.create>[0]);

  const parsed = JSON.parse(textFrom(response as never)) as { plays: RawPlay[] };

  const byId = new Map(candidates.map((row) => [String(row.mention._id), row]));
  const used = new Set<string>();
  const docs = [];

  for (const play of parsed.plays ?? []) {
    const candidate = byId.get(play.mentionId);
    // Un id inventado o repetido se descarta en silencio: el resto de las
    // jugadas es válido y no tiene por qué perderse con él.
    if (!candidate || used.has(play.mentionId)) continue;
    used.add(play.mentionId);

    const { mention, platform, engagement } = candidate;

    // El Set no es paranoia: el modelo a veces devuelve dos textos idénticos
    // cuando se queda sin ángulos, y acá abajo la cantidad de textos ES la
    // cantidad de cuentas — un duplicado se convertiría en una cuenta de menos
    // sin que nadie se entere.
    const comments =
      play.kind === "comment"
        ? [...new Set((play.comments ?? []).map((text) => String(text).trim()).filter(Boolean))].slice(0, 15)
        : [];
    if (play.kind === "comment" && comments.length === 0) continue;

    docs.push({
      projectId,
      ownerId: project.ownerId,
      mentionId: mention._id,
      target: {
        url: mention.url,
        platform,
        domain: mention.domain,
        title: mention.title,
        excerpt: (mention.aiSummary || mention.text || "").slice(0, 300),
        author: mention.author,
        entity: mention.entity,
        publishedAt: mention.publishedAt,
        sentiment: mention.sentiment,
        sentimentScore: mention.sentimentScore,
        engagement,
        reach: mention.reach ?? 0,
      },
      kind: play.kind,
      // El picker de reacciones solo existe en Facebook; en el resto cualquier
      // otra reacción no tendría dónde clickearse.
      reaction: platform === "facebook" ? play.reaction || "like" : "like",
      headline: play.headline,
      rationale: play.rationale,
      icon: play.icon,
      priority: play.priority,
      // Una cuenta por texto. Si el modelo pidió seis cuentas pero solo le
      // salieron cuatro comentarios genuinamente distintos, mandan los textos:
      // repetir el mismo comentario en la misma publicación es exactamente la
      // huella que delata una operación. Para "like" no hay texto que repetir,
      // así que ahí sí manda el número (el schema JSON no puede acotar rangos,
      // por eso se acota acá).
      suggestedCount:
        play.kind === "comment"
          ? comments.length
          : Math.max(1, Math.min(30, Math.round(play.suggestedCount || 5))),
      comments,
      status: "suggested" as const,
    });

    if (docs.length >= count) break;
  }

  if (docs.length === 0) throw new Error("Claude no propuso ninguna jugada sobre estas publicaciones");

  return (await ActionPlayModel.insertMany(docs)) as unknown as ActionPlay[];
}
