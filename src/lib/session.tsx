"use client";

import { createContext, useContext } from "react";
import type { Preferences } from "@/lib/models/User";

/**
 * La sesión tal como la ve el navegador. Es lo mismo que `SessionUser` del
 * servidor menos el ObjectId de mongoose, que no cruza la frontera limpio y
 * acá no hace falta.
 */
export type ClientSession = {
  id: string;
  username: string;
  role: "admin" | "operador";
  groupIds: string[];
  preferences: Preferences;
};

const SessionContext = createContext<ClientSession | null>(null);

/**
 * El layout —que es Server Component— resuelve la sesión y la baja por acá.
 *
 * Antes cada componente la pedía por fetch a /api/auth/me, y eso significaba
 * pintar primero con los valores por defecto y corregir después: se veía el
 * logo de la casa cambiando a la foto del usuario, y el oro cambiando a su
 * color. Sirviéndola desde el servidor, la primera pintura ya es la correcta.
 */
export function SessionProvider({
  value,
  children,
}: {
  value: ClientSession | null;
  children: React.ReactNode;
}) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): ClientSession | null {
  return useContext(SessionContext);
}
