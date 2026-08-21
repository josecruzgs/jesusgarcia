import type { MentionProvider, ProviderId } from "../types";
import { googleNewsProvider } from "./googleNews";
import { gdeltProvider } from "./gdelt";
import { rssProvider } from "./rss";
import { youtubeProvider } from "./youtube";
import { brightDataProvider } from "./brightData";

export const PROVIDERS: Record<ProviderId, MentionProvider> = {
  googleNews: googleNewsProvider,
  gdelt: gdeltProvider,
  rss: rssProvider,
  youtube: youtubeProvider,
  brightData: brightDataProvider,
};

export const PROVIDER_ORDER: ProviderId[] = ["googleNews", "gdelt", "rss", "youtube", "brightData"];

/** Estado de credenciales, para que la UI diga qué falta configurar. */
export function providerStatus() {
  return PROVIDER_ORDER.map((id) => {
    const provider = PROVIDERS[id];
    return {
      id,
      label: provider.label,
      credentialEnv: provider.credentialEnv ?? null,
      configured: provider.isConfigured(),
    };
  });
}
