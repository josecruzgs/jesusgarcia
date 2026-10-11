/**
 * Motores: cuántas tareas puede tener el worker en vuelo a la vez.
 *
 * Hasta ahora el worker corría estrictamente de a una —el bucle hacía
 * `await tick()` y no volvía hasta que la tarea terminaba—, así que "1 tarea
 * simultánea" no era una decisión sino la forma del código. Un motor es cada
 * una de esas ranuras de ejecución.
 *
 * `TOTALES` es lo que dibuja la UI y lo que el worker puede llegar a encender:
 * la sala muestra siempre los cinco huecos y los que sobran salen apagados,
 * para que subir el número sea encender un hueco que ya existe y no rediseñar
 * la pantalla. El worker informa cuántos tiene vivos en su latido y la UI
 * ilumina esos; no hay un segundo lugar donde el número tenga que coincidir.
 *
 * Este archivo es deliberadamente puro —constantes y una función— porque lo
 * importa el componente de la sala, que corre en el navegador. El número que
 * manda de verdad se lee y se escribe en src/lib/workerSettings.ts, que sí
 * toca Mongo.
 */
export const MOTORES_TOTALES = 5;

/**
 * Uno y no cinco a propósito: es lo que esta instalación corría antes de que
 * existieran los motores, y cada motor de más abre su propio navegador en
 * AdsPower sobre la pantalla virtual del VPS, que cuesta RAM y disco. Subirlo
 * es una decisión que se toma desde Ajustes, mirando cómo aguanta la máquina.
 *
 * Es el suelo de toda la cadena, no el valor que manda: el número lo decide
 * Ajustes y vive en Mongo. Este se usa cuando nadie lo configuró todavía y
 * tampoco hay `WORKER_ENGINES`, y tiene que valer por sí solo porque PM2 no
 * relee el env en un `reload`.
 */
export const MOTORES_POR_DEFECTO = 1;

/**
 * Acota cualquier número que venga de afuera —la variable de entorno, el
 * documento de Mongo, el cuerpo de un PUT— a lo que la sala sabe dibujar.
 *
 * Todo lo que pueda terminar encendiendo motores pasa por acá: es el único
 * lugar donde se decide que el mínimo es 1 y el máximo `MOTORES_TOTALES`.
 */
export function motoresConfigurados(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return MOTORES_POR_DEFECTO;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return MOTORES_POR_DEFECTO;
  return Math.min(Math.floor(n), MOTORES_TOTALES);
}
