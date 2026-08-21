import { HttpError } from "@/lib/apiHandler";
import { findUsableProfiles } from "@/lib/auth/profiles";
import type { SessionUser } from "@/lib/auth/dal";
import { loginIfNeededSteps } from "@/lib/automation/loginSteps";
import {
  COMMENT_PRESETS,
  REACTION_PRESETS,
  reactionSelectorFor,
} from "@/lib/automation/socialSelectors";
import { createCampaignWithTasks, readCampaignName } from "@/lib/campaigns";
import ActionPlayModel from "@/lib/models/ActionPlay";

type PlayDoc = {
  _id: unknown;
  kind: "comment" | "like";
  reaction?: string;
  headline: string;
  comments: string[];
  target: { url: string; platform?: string | null };
};

export type DispatchOptions = {
  profileIds: string[];
  autoRun: boolean;
  staggerSeconds: number;
  waitMs: number;
  campaignName?: string;
  /** Sobrescribe el selector del preset cuando la red le cambió el árbol. */
  selector?: string;
};

/**
 * Convierte una jugada aprobada en una campaña de Agua.
 *
 * Arma exactamente los mismos steps que los wizards de `/tasks/like` y
 * `/tasks/comment` —mismo preset de selectores, mismo login opcional, mismo
 * escalonado— porque las tareas las ejecuta el mismo runner. Esto no es un
 * camino paralelo de automatización: es el atajo que evita copiar a mano la
 * URL y los textos de una recomendación al wizard.
 */
export async function dispatchPlay(
  user: SessionUser,
  play: PlayDoc,
  options: DispatchOptions,
) {
  const profiles = await findUsableProfiles(user, options.profileIds);
  if (profiles.length === 0) {
    throw new HttpError(400, "Elegí al menos un perfil para ejecutar la jugada");
  }

  const platform = play.target.platform ?? "facebook";
  const url = play.target.url;
  const staggerSeconds = Math.max(0, options.staggerSeconds);
  const waitMs = options.waitMs > 0 ? options.waitMs : 3000;
  const now = Date.now();

  const docs =
    play.kind === "like"
      ? likeTasks({ play, platform, url, profiles, waitMs, autoRun: options.autoRun, staggerSeconds, now, selector: options.selector })
      : commentTasks({ play, platform, url, profiles, waitMs, autoRun: options.autoRun, staggerSeconds, now, selector: options.selector });

  const { campaign, tasks } = await createCampaignWithTasks({
    ownerId: user.objectId,
    name: readCampaignName(
      { campaignName: options.campaignName },
      play.kind,
      play.headline.slice(0, 40),
    ),
    type: play.kind,
    autoRun: options.autoRun,
    docs,
  });

  await ActionPlayModel.updateOne(
    { _id: play._id },
    {
      $set: {
        status: "dispatched",
        campaignId: campaign._id,
        taskCount: tasks.length,
        dispatchedAt: new Date(),
      },
    },
  );

  return { campaign, tasks, profiles };
}

type TaskArgs = {
  play: PlayDoc;
  platform: string;
  url: string;
  profiles: { _id: unknown; name: string }[];
  waitMs: number;
  autoRun: boolean;
  staggerSeconds: number;
  now: number;
  selector?: string;
};

function likeTasks({ play, platform, url, profiles, waitMs, autoRun, staggerSeconds, now, selector }: TaskArgs) {
  const trigger = selector || REACTION_PRESETS[platform]?.selector;
  if (!trigger) {
    throw new HttpError(400, `No hay selector de reacción para "${platform}". Cargalo a mano.`);
  }

  const reaction = platform === "facebook" ? (play.reaction ?? "like") : "like";
  const reactionSelector = reactionSelectorFor(reaction);

  // Cualquier reacción que no sea "me gusta" necesita primero el hover que
  // revela el picker de Facebook; el like sale de un solo clic.
  const reactionSteps =
    reaction === "like" || !reactionSelector
      ? [{ action: "click" as const, selector: trigger }]
      : [
          { action: "hover" as const, selector: trigger, ms: 15000 },
          { action: "waitForTimeout" as const, ms: 800 },
          { action: "waitForSelector" as const, selector: reactionSelector, ms: 5000 },
          { action: "click" as const, selector: reactionSelector },
        ];

  return profiles.map((profile, i) => ({
    name: `viento · ${profile.name}`,
    profileId: profile._id,
    type: "like" as const,
    steps: [
      { action: "goto" as const, url },
      { action: "waitForTimeout" as const, ms: waitMs },
      ...loginIfNeededSteps(),
      { action: "waitForSelector" as const, selector: trigger, ms: 15000 },
      ...reactionSteps,
      { action: "waitForTimeout" as const, ms: 1500 },
    ],
    status: autoRun ? ("queued" as const) : ("pending" as const),
    scheduledAt: new Date(now + i * staggerSeconds * 1000),
  }));
}

function commentTasks({ play, platform, url, profiles, waitMs, autoRun, staggerSeconds, now, selector }: TaskArgs) {
  const preset = COMMENT_PRESETS[platform];
  const box = selector || preset?.selector;
  if (!box) {
    throw new HttpError(400, `No hay selector de comentario para "${platform}". Cargalo a mano.`);
  }
  if (play.comments.length === 0) {
    throw new HttpError(400, "La jugada no tiene textos de comentario");
  }
  // Último candado de la regla "un texto por cuenta". Los otros dos están en
  // la generación y en la edición; éste es el que importa, porque es el único
  // que ve la selección real de perfiles.
  if (profiles.length > play.comments.length) {
    throw new HttpError(
      400,
      `Elegiste ${profiles.length} cuentas y hay ${play.comments.length} textos. Dos cuentas publicarían el mismo comentario en la misma publicación: agregá textos o elegí menos cuentas.`,
    );
  }

  const submitStep =
    preset?.submitMethod === "button" && preset.submitSelector
      ? { action: "click" as const, selector: preset.submitSelector }
      : { action: "press" as const, selector: box, key: "Enter" };

  return profiles.map((profile, i) => ({
    name: `viento · ${profile.name}`,
    profileId: profile._id,
    type: "comment" as const,
    steps: [
      { action: "goto" as const, url },
      { action: "waitForTimeout" as const, ms: waitMs },
      ...loginIfNeededSteps(),
      { action: "waitForSelector" as const, selector: box, ms: 15000 },
      { action: "click" as const, selector: box },
      // Un texto por cuenta, sin rotar: la guarda de arriba ya garantizó que
      // hay al menos tantos textos como perfiles.
      { action: "type" as const, selector: box, value: play.comments[i] },
      { action: "waitForTimeout" as const, ms: 800 },
      submitStep,
      { action: "waitForTimeout" as const, ms: 1500 },
    ],
    status: autoRun ? ("queued" as const) : ("pending" as const),
    scheduledAt: new Date(now + i * staggerSeconds * 1000),
  }));
}
