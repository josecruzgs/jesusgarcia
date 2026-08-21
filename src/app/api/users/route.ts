import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import UserModel, { USER_ROLES, toPublicUser, type UserRole } from "@/lib/models/User";
import { withAdmin } from "@/lib/apiHandler";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { knownGroupIds } from "@/lib/auth/groups";

// Nunca se devuelve passwordHash: no le sirve a la interfaz y sacarlo del
// servidor solo abre la puerta a que termine en un log o en el caché del
// navegador.
const PUBLIC_FIELDS = "username role groupIds active createdAt updatedAt";

export const GET = withAdmin(async () => {
  await dbConnect();
  const users = await UserModel.find().select(PUBLIC_FIELDS).sort({ username: 1 }).lean();
  return NextResponse.json({ users });
});

export const POST = withAdmin(async (_admin, req: NextRequest) => {
  const body = await req.json();
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const role: UserRole = USER_ROLES.includes(body.role) ? body.role : "operador";

  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    return NextResponse.json(
      { error: "El usuario debe tener entre 3 y 32 caracteres: letras, números, punto, guion o guion bajo" },
      { status: 400 },
    );
  }

  const problem = passwordProblem(password);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  await dbConnect();

  if (await UserModel.exists({ username })) {
    return NextResponse.json({ error: "Ese usuario ya existe" }, { status: 409 });
  }

  const user = await UserModel.create({
    username,
    passwordHash: await hashPassword(password),
    role,
    groupIds: role === "admin" ? [] : await knownGroupIds(body.groupIds),
    active: true,
  });

  return NextResponse.json({ user: toPublicUser(user) }, { status: 201 });
});
