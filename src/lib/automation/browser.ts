import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { adsPower } from "@/lib/adspower/client";

/**
 * Abre (si no está abierto) el perfil en AdsPower y se conecta al Chromium
 * resultante vía CDP usando playwright-core. Devuelve el browser conectado
 * y una única página en blanco, lista para que la tarea navegue.
 */
export async function connectToProfile(profileId: string): Promise<{ browser: Browser; page: Page }> {
  const { ws } = await adsPower.startBrowser(profileId);

  // playwright-core habla el protocolo CDP; el endpoint "puppeteer" de
  // AdsPower expone justamente un WS de CDP.
  const browser = await chromium.connectOverCDP(ws.puppeteer);

  const context = browser.contexts()[0] ?? (await browser.newContext());
  await concederNotificaciones(context);
  const page = await dejarUnaSolaPestaña(context);

  return { browser, page };
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
