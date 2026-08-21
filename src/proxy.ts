import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, readSessionToken } from "@/lib/auth/session";

// Rutas que quedan fuera del gate de sesión: el dashboard público compartido
// (/share/[token] + la API que consume) y la propia pantalla de login. Todo lo
// demás (el panel interno) exige una cookie de sesión válida.
const PUBLIC_PREFIXES = ["/share", "/api/public", "/login", "/api/auth/login", "/api/auth/logout"];

function isPublicPath(pathname: string) {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Chequeo OPTIMISTA, como recomienda la guía de Next: acá solo se verifica la
 * firma de la cookie para mandar al login a quien no tenga sesión. Ni se
 * consulta Mongo ni se decide nada de permisos — eso vive en `withAuth` y en la
 * capa de acceso a datos (src/lib/auth/dal.ts), pegado a los datos.
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const session = await readSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();

  // A la API se le contesta con 401 en vez de mandarla al HTML del login: el
  // cliente hace res.json() y una redirección le llegaría como basura.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)"],
};
