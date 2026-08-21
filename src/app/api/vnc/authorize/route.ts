import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/apiHandler";

/**
 * Portero de la pantalla del servidor. No lo llama el navegador: lo consulta
 * nginx con `auth_request` antes de dejar pasar cualquier cosa bajo /vnc/ (ver
 * deploy/nginx.conf).
 *
 * Hace falta porque x11vnc corre con `-nopw`: quien alcance ese puerto tiene el
 * escritorio del VPS entero, con la sesión de AdsPower abierta. Mientras estuvo
 * atado al loopback lo protegía la falta de camino; al publicarlo en el dominio
 * el camino existe, y lo único que lo cierra es este 403.
 *
 * 204 y no 200 con cuerpo: nginx solo mira el código, y el cuerpo lo descarta.
 */
export const GET = withAdmin(async () => new NextResponse(null, { status: 204 }));
