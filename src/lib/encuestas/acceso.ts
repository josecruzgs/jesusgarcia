import { redirect } from "next/navigation";
import { currentUser, type SessionUser } from "@/lib/auth/dal";
import { dbConnect } from "@/lib/mongodb";
import EncuestaConfigModel from "@/lib/models/EncuestaConfig";

/**
 * Quién entra a Encuestas. Ya no hay login propio: es la sesión del panel.
 *
 * El admin siempre. El operador solo si el admin abrió Encuestas a los usuarios desde Ajustes (apagado de fábrica):
 * llamar cuesta dinero y suena el teléfono de una persona de verdad, así que es el admin quien decide cuándo lo usan
 * los demás. Con el switch encendido, el operador hace lo mismo que el admin: llamar, mandar la encuesta a un número,
 * subir la base y editar el guion. Con el switch apagado no lo ve en el menú, y si escribe la URL vuelve al inicio.
 */
export type SesionEncuestas = { id: string; nombre: string; admin: boolean };

const CLAVE_ABIERTAS = "abiertas_a_usuarios";

/** ¿El admin abrió Encuestas a los usuarios que no son admin? No, si nadie lo ha tocado. */
export async function encuestasAbiertas(): Promise<boolean> {
  await dbConnect();
  const f = await EncuestaConfigModel.findById(CLAVE_ABIERTAS).lean<{ valor: string }>();
  return f?.valor === "1";
}

export async function abrirEncuestas(abiertas: boolean) {
  await dbConnect();
  await EncuestaConfigModel.updateOne({ _id: CLAVE_ABIERTAS }, { $set: { valor: abiertas ? "1" : "0" } }, { upsert: true });
}

/** Si esta persona puede ver y operar Encuestas. Lo usan las páginas, las rutas y el menú. */
export async function puedeUsarEncuestas(user: Pick<SessionUser, "role"> | null): Promise<boolean> {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (user.role !== "operador") return false;
  return encuestasAbiertas();
}

export async function requireSesion(): Promise<SesionEncuestas> {
  const user = await currentUser();
  if (!user) redirect("/login?next=/encuestas");
  if (!(await puedeUsarEncuestas(user))) redirect("/");
  // `admin` aquí quiere decir «puede operar Encuestas», no el rol del panel.
  return { id: user.id, nombre: user.username, admin: true };
}

export async function requireAdmin(): Promise<SesionEncuestas> {
  const s = await requireSesion();
  if (!s.admin) redirect("/encuestas?error=" + encodeURIComponent("Esa acción solo la puede hacer un administrador u operador."));
  return s;
}
