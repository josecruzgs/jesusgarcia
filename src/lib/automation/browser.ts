import { chromium, type Browser, type Page } from "playwright-core";
import { adsPower } from "@/lib/adspower/client";

/**
 * Abre (si no está abierto) el perfil en AdsPower y se conecta al Chromium
 * resultante vía CDP usando playwright-core. Devuelve el browser conectado
 * y la primera página disponible.
 */
export async function connectToProfile(profileId: string): Promise<{ browser: Browser; page: Page }> {
  const { ws } = await adsPower.startBrowser(profileId);

  // playwright-core habla el protocolo CDP; el endpoint "puppeteer" de
  // AdsPower expone justamente un WS de CDP.
  const browser = await chromium.connectOverCDP(ws.puppeteer);

  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());

  return { browser, page };
}

export async function disconnectProfile(browser: Browser, profileId: string) {
  await browser.close().catch(() => {});
  await adsPower.stopBrowser(profileId).catch(() => {});
}
