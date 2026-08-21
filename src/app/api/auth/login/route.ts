import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import UserModel from "@/lib/models/User";
import { withApiErrors } from "@/lib/apiHandler";
import { verifyPassword } from "@/lib/auth/password";
import {
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
} from "@/lib/auth/session";
import { rateLimit, rateLimitReset, clientIp } from "@/lib/rateLimit";

// Ocho intentos cada quince minutos y después media hora de espera. Alcanza de
// sobra para quien tipeó mal la contraseña y hace inviable probarla a ciegas.
const LIMIT = { limit: 8, windowMs: 15 * 60_000, blockMs: 30 * 60_000 };

// Un hash con forma válida y contraseña imposible. Si el usuario no existe,
// igual se corre el scrypt: sin esto, un usuario inexistente responde al
// instante y uno real tarda, lo que permite enumerar cuentas cronometrando.
const DUMMY_HASH = `scrypt$${"0".repeat(32)}$${"0".repeat(128)}`;

export const POST = withApiErrors(async (req: NextRequest) => {
  const ip = clientIp(req);
  const gate = rateLimit(`login:${ip}`, LIMIT);
  if (!gate.ok) {
    return NextResponse.json(
      { error: `Demasiados intentos. Probá de nuevo en ${Math.ceil(gate.retryAfterSec / 60)} minutos.` },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } },
    );
  }

  const body = await req.json();
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  // Un solo mensaje para usuario inexistente, contraseña incorrecta y cuenta
  // dada de baja: distinguirlos le diría a quien prueba cuáles usuarios existen.
  const invalid = NextResponse.json({ error: "Usuario o contraseña incorrectos" }, { status: 401 });

  if (!username || !password) return invalid;

  await dbConnect();
  const user = await UserModel.findOne({ username }).select("passwordHash active");

  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok || user.active === false) return invalid;

  rateLimitReset(`login:${ip}`);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(String(user._id)), {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return res;
});
