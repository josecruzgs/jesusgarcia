const NON_PROFILE_PATHS = new Set([
  "about",
  "bookmarks",
  "business",
  "events",
  "friends",
  "gaming",
  "groups",
  "hashtag",
  "help",
  "home",
  "login",
  "marketplace",
  "messages",
  "notifications",
  "pages",
  "photo",
  "photos",
  "reel",
  "reels",
  "saved",
  "search",
  "settings",
  "share",
  "stories",
  "story",
  "watch",
]);

/**
 * La forma canónica del perfil: `https://www.facebook.com/<usuario>/`,
 * `profile.php?id=<id>` o `people/<nombre>/<id>/`.
 *
 * Se acepta también un link a algo dentro del perfil (`/usuario/posts/...`,
 * `?sk=about`) y se recorta al perfil. El usuario va en minúsculas porque
 * Facebook no distingue mayúsculas, y así dos links a la misma cuenta se
 * reconocen como la misma al buscar tareas previas.
 */
export function canonicalizeFacebookProfileUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!/(^|\.)(facebook|fb)\.com$/i.test(url.hostname)) return null;

    if (url.pathname.replace(/\/+$/, "").toLowerCase() === "/profile.php") {
      const id = url.searchParams.get("id")?.trim();
      return id ? `https://www.facebook.com/profile.php?id=${encodeURIComponent(id)}` : null;
    }

    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length >= 3 && segments[0].toLowerCase() === "people") {
      return `https://www.facebook.com/${segments.slice(0, 3).join("/")}/`;
    }
    const user = segments[0]?.toLowerCase();
    if (!user || user.endsWith(".php") || NON_PROFILE_PATHS.has(user)) return null;
    return `https://www.facebook.com/${user}/`;
  } catch {
    return null;
  }
}
