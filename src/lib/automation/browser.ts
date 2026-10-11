import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { adsPower } from "@/lib/adspower/client";

/**
 * Tope para la parte de Playwright al abrir el perfil.
 *
 * `startBrowser` ya trae el suyo (120 s) para lo que tarda AdsPower en levantar
 * el Chromium. Lo que viene DESPUÉS —conectar por CDP, pedir el contexto, dejar
 * una pestaña en blanco— no tenía ninguno, y ese hueco es el que colgaba tareas.
 *
 * Está medido, no supuesto: las seis tareas colgadas del 5/9/2026 tenían una
 * sola línea de log ("Iniciando tarea…") y después silencio hasta el tope de 20
 * minutos del worker. Esa línea se escribe justo antes de llamar acá y la
 * siguiente sería "Step 1/N", así que se quedaban dentro de esta función.
 *
 * Que no hubiera tope acá no era solo una tarea perdida: al vencer el tope del
 * worker, este se mata para soltar el navegador, y con varios motores se lleva
 * puestas las otras tareas en vuelo. Acotado, pasa a ser una tarea fallida con
 * un mensaje que dice en qué paso se quedó, y los demás motores ni se enteran.
 *
 * Noventa segundos porque nada de esto es trabajo: es abrir un socket y pedir
 * una pestaña vacía. Si tarda más, no va a terminar.
 */
const CONNECT_TIMEOUT_MS = Number(process.env.ADSPOWER_CONNECT_TIMEOUT_MS ?? 90_000);

/**
 * Corre `promesa` con tope, diciendo qué se quedó esperando si lo pasa.
 *
 * El nombre del paso va en el error a propósito: sin él, el mensaje sería otra
 * vez "no terminó" y habría que volver a averiguar dónde.
 */
async function conTope<T>(promesa: Promise<T>, que: string): Promise<T> {
  // Si gana el tope, la promesa perdedora sigue viva y su rechazo posterior se
  // quedaría sin dueño: Node mata el proceso por `unhandledRejection`. Este
  // catch le pone dueño sin tocar la carrera de abajo.
  promesa.catch(() => {});

  let temporizador: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promesa,
      new Promise<never>((_, reject) => {
        temporizador = setTimeout(
          () => reject(new Error(`${que}: sin respuesta tras ${Math.round(CONNECT_TIMEOUT_MS / 1000)}s`)),
          CONNECT_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(temporizador);
  }
}

/** Espera a que una limpieza termine, pero sin colgarse en ella. */
async function soltar(promesa: Promise<unknown>, ms: number) {
  const tragada = promesa.catch(() => {});
  let temporizador: NodeJS.Timeout | undefined;
  try {
    await Promise.race([tragada, new Promise((r) => (temporizador = setTimeout(r, ms)))]);
  } finally {
    clearTimeout(temporizador);
  }
}

/**
 * Abre (si no está abierto) el perfil en AdsPower y se conecta al Chromium
 * resultante vía CDP usando playwright-core. Devuelve el browser conectado
 * y una única página en blanco, lista para que la tarea navegue.
 */
export async function connectToProfile(profileId: string): Promise<{ browser: Browser; page: Page }> {
  const { ws } = await adsPower.startBrowser(profileId);

  let browser: Browser | undefined;
  try {
    // playwright-core habla el protocolo CDP; el endpoint "puppeteer" de
    // AdsPower expone justamente un WS de CDP.
    browser = await conTope(chromium.connectOverCDP(ws.puppeteer), "conectar por CDP");

    const context = browser.contexts()[0] ?? (await conTope(browser.newContext(), "abrir el contexto"));
    await conTope(concederNotificaciones(context), "conceder permisos");
    const page = await conTope(dejarUnaSolaPestaña(context), "abrir la pestaña");

    return { browser, page };
  } catch (err) {
    // El navegador puede haber quedado abierto pero inservible. Soltarlo no es
    // cortesía: con el filtro por perfil de los motores, una instancia colgada
    // deja a ese perfil sin poder avanzar hasta que alguien la cierre a mano.
    //
    // La limpieza va acotada también: si el Chromium no contesta, `close()`
    // tampoco vuelve, y colgarse limpiando sería repetir el problema que esta
    // función viene a resolver.
    if (browser) await soltar(browser.close(), 10_000);
    await soltar(adsPower.stopBrowser(profileId), 15_000);
    throw err;
  }
}

/**
 * Da por respondido el "www.facebook.com quiere mostrar notificaciones".
 *
 * Ese cartel es del navegador, no de la página: vive fuera del DOM, así que
 * Playwright no lo ve ni lo puede cerrar, y en un perfil recién abierto —que
 * nunca contestó— aparece encima de la publicación en cuanto carga Facebook.
 * Hasta ahora había que ir al visor y darle "Allow" a mano, perfil por perfil.
 *
 * Esto contesta lo mismo que contestaba la mano, pero por CDP y antes de
 * navegar: Chrome guarda el permiso como concedido y ya no vuelve a preguntar.
 * Se concede para todos los orígenes y no solo para Facebook porque las tareas
 * también entran a Instagram, y Facebook además pregunta desde varios dominios
 * (www., web., m.); enumerarlos era garantizarse olvidar uno.
 *
 * Nunca tira: que un perfil se quede sin el permiso es un cartel de más en la
 * pantalla, no un motivo para tumbar la tarea.
 */
async function concederNotificaciones(context: BrowserContext) {
  await context.grantPermissions(["notifications"]).catch(() => {});
}

/**
 * Deja el navegador con una sola pestaña, la que devuelve, y cierra el resto.
 *
 * `startBrowser` ya pide que no se restaure la sesión anterior, pero eso solo
 * vale cuando el navegador arranca de cero: si el perfil ya estaba abierto
 * —lo dejó abierto alguien por el visor, o una tarea anterior no llegó a
 * cerrarlo— AdsPower devuelve la instancia que hay, con todas sus pestañas.
 *
 * Y esas pestañas no son gratis: son publicaciones de Facebook vivas, cada una
 * con su video y su proxy, compitiendo por la CPU y el ancho de banda del VPS
 * justo mientras la tarea intenta cargar la suya.
 *
 * El orden importa. Primero se abre la pestaña nueva y recién después se
 * cierran las viejas: cerrar la última pestaña de un Chromium lo termina, y
 * ahí se caería la conexión CDP entera.
 */
async function dejarUnaSolaPestaña(context: BrowserContext): Promise<Page> {
  const previas = context.pages();
  const page = await context.newPage();

  for (const vieja of previas) {
    await vieja.close().catch(() => {});
  }

  return page;
}

export async function disconnectProfile(browser: Browser, profileId: string) {
  await browser.close().catch(() => {});
  await adsPower.stopBrowser(profileId).catch(() => {});
}
