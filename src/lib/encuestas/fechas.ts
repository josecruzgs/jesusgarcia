/** La encuesta es de Baja California: todas las horas del tablero y del horario de llamadas van en su hora (Tijuana). */
export const ZONA = "America/Tijuana";

export const fechaHoraCorta = (f: Date) =>
  f.toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: ZONA });

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
