/**
 * Rango de fechas a partir de dos `YYYY-MM-DD`.
 *
 * Todo se resuelve en días UTC a propósito. El bug que esto arregla:
 * `new Date("2026-08-06")` se parsea como medianoche UTC, y aplicarle
 * `setHours(23,59,59)` —que es hora LOCAL— corría el rango un día hacia atrás
 * en cualquier zona con offset negativo (México lo tiene), dejando fuera las
 * menciones del día en curso. Fijar ambos extremos en UTC hace que el
 * agrupado por día, el relleno de la serie y el filtro coincidan.
 */
export function parseDayRange(
  fromRaw: string | null,
  toRaw: string | null,
  defaultDays = 30,
): { from: Date; to: Date } {
  const to = toRaw
    ? new Date(`${toRaw}T23:59:59.999Z`)
    : endOfUtcDay(new Date());

  const from = fromRaw
    ? new Date(`${fromRaw}T00:00:00.000Z`)
    : new Date(to.getTime() - (defaultDays - 1) * 86400000 - 86_399_999);

  return { from, to };
}

function endOfUtcDay(date: Date): Date {
  return new Date(`${date.toISOString().slice(0, 10)}T23:59:59.999Z`);
}

/** Todos los días UTC del rango, inclusive, como `YYYY-MM-DD`. */
export function utcDayKeys(from: Date, to: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(`${from.toISOString().slice(0, 10)}T00:00:00.000Z`);

  while (cursor <= to) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return keys;
}
