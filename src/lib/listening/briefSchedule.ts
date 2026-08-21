import { Types } from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import MentionModel from "@/lib/models/Mention";
import ExecutiveBriefModel from "@/lib/models/ExecutiveBrief";
import { buildExecutiveBrief } from "./analyze";
import {
  BRIEF_WINDOW_DAYS,
  enumerateWindows,
  utcDay,
  type BriefWindow,
} from "./briefWindows";

export type ScheduledWindow = BriefWindow & {
  /** Menciones relevantes que caen adentro. Sin ellas no hay nada que leer. */
  mentions: number;
  briefId: string | null;
  partial: boolean;
  /** Falta generarla (o la que hay es un adelanto de una ventana ya cerrada). */
  pending: boolean;
};

export type BriefSchedule = {
  anchorDay: string | null;
  windowDays: number;
  windows: ScheduledWindow[];
  /** Solo las cerradas que faltan, de la más vieja a la más nueva. */
  pending: ScheduledWindow[];
  /** La que está en curso, si todavía no cerró y ya tiene menciones. */
  current: ScheduledWindow | null;
};

/**
 * Estado de la grilla de informes de un proyecto: qué ventanas existen, cuáles
 * ya se analizaron y cuáles faltan.
 *
 * El ancla es el día de la PRIMERA mención relevante del proyecto, no la fecha
 * de creación ni "hoy menos N". Así los cortes quedan pegados a los datos —la
 * primera ventana arranca donde arranca el historial, sin un tramo inicial
 * vacío— y no se mueven nunca: mientras esa mención exista, toda la grilla es
 * la misma corrida tras corrida.
 */
export async function briefSchedule(
  projectId: string,
  now: Date = new Date(),
): Promise<BriefSchedule> {
  await dbConnect();

  const first = await MentionModel.findOne({
    projectId,
    relevant: { $ne: false },
    publishedAt: { $ne: null },
  })
    .sort({ publishedAt: 1 })
    .select("publishedAt")
    .lean();

  const empty: BriefSchedule = {
    anchorDay: null,
    windowDays: BRIEF_WINDOW_DAYS,
    windows: [],
    pending: [],
    current: null,
  };

  if (!first?.publishedAt) return empty;

  const anchorDay = utcDay(first.publishedAt);
  const windows = enumerateWindows(anchorDay, now);
  if (windows.length === 0) return empty;

  const [counts, briefs] = await Promise.all([
    // Un solo agregado por día en vez de una consulta por ventana: son decenas
    // de ventanas y cada una costaría su propio round-trip.
    MentionModel.aggregate<{ _id: string; count: number }>([
      {
        $match: {
          projectId: new Types.ObjectId(projectId),
          relevant: { $ne: false },
          publishedAt: { $gte: windows[0].start, $lte: windows[windows.length - 1].end },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$publishedAt", timezone: "UTC" } },
          count: { $sum: 1 },
        },
      },
    ]),
    ExecutiveBriefModel.find({ projectId, windowStart: { $type: "date" } })
      .select("_id windowStart partial")
      .lean(),
  ]);

  const countByDay = new Map(counts.map((row) => [row._id, row.count]));
  const briefByWindow = new Map(
    briefs.map((brief) => [utcDay(brief.windowStart as Date), brief]),
  );

  const scheduled: ScheduledWindow[] = windows.map((window) => {
    const mentions = Array.from({ length: BRIEF_WINDOW_DAYS }, (_, offset) => {
      const day = new Date(window.start);
      day.setUTCDate(day.getUTCDate() + offset);
      return countByDay.get(utcDay(day)) ?? 0;
    }).reduce((sum, count) => sum + count, 0);

    const brief = briefByWindow.get(window.startDay) ?? null;
    const partial = Boolean(brief?.partial);

    return {
      ...window,
      mentions,
      briefId: brief ? String(brief._id) : null,
      partial,
      // Una ventana sin menciones no está pendiente: no hay corpus del cual
      // sacar una lectura, y marcarla como pendiente dejaría el contador
      // clavado en un número que nunca baja.
      pending: mentions > 0 && window.closed && (!brief || partial),
    };
  });

  const openWindow = scheduled.find((window) => !window.closed) ?? null;

  return {
    anchorDay,
    windowDays: BRIEF_WINDOW_DAYS,
    windows: scheduled,
    pending: scheduled.filter((window) => window.pending),
    current: openWindow && openWindow.mentions > 0 ? openWindow : null,
  };
}

/**
 * Genera el informe de la ventana cerrada más vieja que falte.
 *
 * De a una por llamada a propósito: el brief corre con `effort: "high"` sobre
 * cientos de menciones, y encadenar diez en un mismo request HTTP se lleva
 * puesto cualquier timeout. Quien llama repite mientras `remaining > 0`.
 */
export async function generateNextBriefWindow(projectId: string) {
  const schedule = await briefSchedule(projectId);
  const target = schedule.pending[0];
  if (!target) return null;

  const brief = await buildExecutiveBrief(projectId, target.start, target.end, {
    windowStart: target.start,
    partial: false,
  });

  return { brief, window: target, remaining: schedule.pending.length - 1 };
}

/**
 * Adelanto de la ventana en curso. Queda marcado `partial`, que es lo que
 * habilita a reemplazarlo cuando el período cierre — es el único informe que
 * se regenera solo.
 */
export async function generateCurrentBriefWindow(projectId: string) {
  const schedule = await briefSchedule(projectId);
  const target = schedule.current;
  if (!target) return null;

  const brief = await buildExecutiveBrief(projectId, target.start, target.end, {
    windowStart: target.start,
    partial: true,
  });

  return { brief, window: target, remaining: schedule.pending.length };
}

/** Rehace una ventana puntual de la grilla, tenga informe o no. */
export async function regenerateBriefWindow(projectId: string, startDay: string) {
  const schedule = await briefSchedule(projectId);
  const target = schedule.windows.find((window) => window.startDay === startDay);
  if (!target) return null;

  const brief = await buildExecutiveBrief(projectId, target.start, target.end, {
    windowStart: target.start,
    partial: !target.closed,
  });

  return {
    brief,
    window: target,
    remaining: schedule.pending.length - (target.pending ? 1 : 0),
  };
}
