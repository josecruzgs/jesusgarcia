import { NextResponse } from "next/server";
import { withApiErrors } from "@/lib/apiHandler";
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "@/lib/auth/session";

// No exige sesión: cerrarla cuando ya venció o quedó inválida tiene que
// funcionar igual, o el navegador se queda con una cookie que no puede tirar.
export const POST = withApiErrors(async () => {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
  return res;
});
