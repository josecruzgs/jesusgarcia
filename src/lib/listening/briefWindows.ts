/**
 * La grilla de ventanas del resumen ejecutivo.
 *
 * El informe dejó de colgarse del selector de período de la página: ahora el
 * proyecto se corta en ventanas fijas y contiguas de tres días, y cada una se
 * analiza UNA sola vez. Es lo que hace que la serie sea comparable —dos
 * informes de 30 días que se solapan en 27 no dicen nada sobre qué cambió— y
 * lo que evita volver a pagarle a Claude por un período que ya está cerrado y
 * cuyo resultado no puede cambiar.
 *
 * Las ventanas son deterministas: salen del día de la primera mención del
 * proyecto (el ancla) más un múltiplo de tres días. Nunca dependen de cuándo
 * se apretó el botón, así que dos corridas distintas producen exactamente los
 * mismos cortes.
 *
 * Todo se resuelve en días UTC, por la misma razón que `range.ts`: en México
 * el offset negativo corría el rango un día hacia atrás.
 */

export const BRIEF_WINDOW_DAYS = 3;

/**
 * Techo de ventanas a enumerar. Un proyecto con menciones de hace tres años
 * daría cientos de ventanas vacías; sin este tope, un `publishedAt` corrupto
 * (una fecha de 1970, que los feeds RSS producen más seguido de lo que
 * parece) haría un bucle de decenas de miles de iteraciones.
 */
const MAX_WINDOWS = 400;

export type BriefWindow = {
  /** Posición en la grilla, contada desde el ancla. */
  index: number;
  startDay: string;
  endDay: string;
  start: Date;
  end: Date;
  /** El período ya terminó por completo: su informe es definitivo. */
  closed: boolean;
};

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addUtcDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return utcDay(date);
}

export function buildWindow(anchorDay: string, index: number, now: Date): BriefWindow {
  const startDay = addUtcDays(anchorDay, index * BRIEF_WINDOW_DAYS);
  const endDay = addUtcDays(startDay, BRIEF_WINDOW_DAYS - 1);

  return {
    index,
    startDay,
    endDay,
    start: new Date(`${startDay}T00:00:00.000Z`),
    end: new Date(`${endDay}T23:59:59.999Z`),
    closed: new Date(`${endDay}T23:59:59.999Z`).getTime() < now.getTime(),
  };
}

/** En qué ventana de la grilla cae un día. */
export function windowIndexFor(anchorDay: string, day: string): number {
  const days = Math.floor(
    (Date.parse(`${day}T00:00:00.000Z`) - Date.parse(`${anchorDay}T00:00:00.000Z`)) / 86_400_000,
  );
  return Math.floor(days / BRIEF_WINDOW_DAYS);
}

/**
 * Todas las ventanas desde el ancla hasta la que contiene a `now`, inclusive.
 * La última suele estar abierta (todavía le faltan días por transcurrir).
 *
 * Al pasar el techo se recortan las MÁS VIEJAS, no las más nuevas. Es la
 * diferencia entre degradar y romper: una sola mención con `publishedAt`
 * corrupto (los feeds RSS mandan fechas de 1970 más seguido de lo que parece)
 * ancla la grilla décadas atrás, y recortando por el otro lado el período en
 * curso quedaría fuera de la lista y no se generaría ningún informe nunca.
 * Los cortes siguen calculándose desde el ancla, así que las ventanas que sí
 * se enumeran caen exactamente donde caerían sin el recorte.
 */
export function enumerateWindows(anchorDay: string, now: Date): BriefWindow[] {
  const last = windowIndexFor(anchorDay, utcDay(now));
  if (last < 0) return [];

  const windows: BriefWindow[] = [];
  for (let index = Math.max(0, last - MAX_WINDOWS + 1); index <= last; index += 1) {
    windows.push(buildWindow(anchorDay, index, now));
  }
  return windows;
}
