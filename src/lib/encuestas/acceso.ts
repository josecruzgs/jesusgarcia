import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/dal";

/**
 * Quién entra a Encuestas. No hay login propio: es la sesión del panel.
 *
 * Admin y operador hacen todo lo que en el sistema original hacía ADMIN: llamar, mandar la encuesta a un número, subir
 * la base y editar el guion. Es la gente que opera el panel; llamar cuesta dinero y suena el teléfono de una persona de
 * verdad, y por eso sigue cerrado a quien no tenga sesión.
 */
export type SesionEncuestas = { id: string; nombre: string; admin: boolean };

export async function requireSesion(): Promise<SesionEncuestas> {
  const user = await currentUser();
  if (!user) redirect("/login?next=/encuestas");
  // `admin` aquí quiere decir «puede operar Encuestas», no el rol del panel.
  return { id: user.id, nombre: user.username, admin: user.role === "admin" || user.role === "operador" };
}

export async function requireAdmin(): Promise<SesionEncuestas> {
  const s = await requireSesion();
  if (!s.admin) redirect("/encuestas?error=" + encodeURIComponent("Esa acción solo la puede hacer un administrador u operador."));
  return s;
}
