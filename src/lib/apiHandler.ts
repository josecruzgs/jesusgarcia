import { NextResponse } from "next/server";
import { currentUser, isAdmin, type SessionUser } from "@/lib/auth/dal";

/**
 * Error con código HTTP propio. Sirve para que un helper compartido —validar
 * permisos sobre unos perfiles, por ejemplo— corte la ejecución con el status
 * correcto sin que cada ruta tenga que repetir el chequeo y armar la respuesta.
 * `withApiErrors` lo reconoce; cualquier otro error sigue siendo un 500.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * Envuelve un route handler para que cualquier error (AdsPower caído,
 * rate-limit, Mongo, etc.) siempre termine en una respuesta JSON válida
 * en vez de que Next.js devuelva su página de error HTML por defecto
 * (que rompe `res.json()` en el cliente).
 */
export function withApiErrors<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse>,
) {
  return async (...args: Args): Promise<NextResponse> => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      console.error("[api]", err);
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}

/**
 * Igual que `withApiErrors`, pero además exige sesión y le pasa el usuario al
 * handler como PRIMER argumento (así los de Next —`req`, `ctx`— quedan atrás y
 * TypeScript los sigue infiriendo solo):
 *
 *     export const GET = withAuth(async (user, req: NextRequest) => { ... });
 *
 * Toda ruta bajo /api que no sea pública tiene que pasar por acá. El redirect
 * de proxy.ts es solo una comodidad para el navegador: no protege nada por sí
 * mismo, porque un cliente que no siga redirects llegaría igual al handler.
 */
export function withAuth<Args extends unknown[]>(
  handler: (user: SessionUser, ...args: Args) => Promise<NextResponse>,
) {
  return withApiErrors(async (...args: Args): Promise<NextResponse> => {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    return handler(user, ...args);
  });
}

/** Como `withAuth`, y además exige rol admin. */
export function withAdmin<Args extends unknown[]>(
  handler: (user: SessionUser, ...args: Args) => Promise<NextResponse>,
) {
  return withAuth(async (user: SessionUser, ...args: Args): Promise<NextResponse> => {
    if (!isAdmin(user)) {
      return NextResponse.json({ error: "Requiere rol de administrador" }, { status: 403 });
    }
    return handler(user, ...args);
  });
}
