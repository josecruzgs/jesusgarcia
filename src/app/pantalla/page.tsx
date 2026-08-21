import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MonitorOff } from "lucide-react";
import { currentUser, isAdmin } from "@/lib/auth/dal";
import { isRelative, vncIsUp, vncUrl } from "@/lib/vnc";

export const metadata: Metadata = {
  title: "Pantalla del servidor · AdsPower en vivo",
};

/**
 * La pantalla del VPS, en vivo y sin nada alrededor.
 *
 * Sirve para mirar lo que hace la automatización de verdad —qué navegador
 * abrió AdsPower, en qué se trabó, qué está pidiendo Facebook— sin abrir un
 * túnel SSH ni levantar nada a mano. Se abre en pestaña aparte desde el ícono
 * de la barra superior.
 *
 * No lleva encabezado, ni menú, ni marca: es una ventana al escritorio del
 * servidor y nada más. AppShell ya la deja fuera del chrome del panel; lo que
 * queda acá ocupa el alto entero, porque un visor de escritorio con barras
 * alrededor obliga a hacer scroll dentro de algo que no scrollea.
 *
 * Solo admin, y no por prolijidad: el escritorio del servidor tiene la sesión
 * de AdsPower abierta, con todos los perfiles y sus cookies. El chequeo de
 * verdad para el marco lo hace nginx contra /api/vnc/authorize; este redirect
 * es el que evita que un operador llegue siquiera a la página.
 */
export default async function PantallaPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!isAdmin(user)) redirect("/");

  const url = vncUrl();

  // Una ruta relativa la sirve nginx, y en `npm run dev` no hay nginx: el marco
  // terminaría cargando el 404 de Next —que se pinta con el panel entero
  // adentro, menú incluido— y parecería un bug de la página. Se corta antes.
  const sinNginx = isRelative(url) && process.env.NODE_ENV !== "production";
  if (sinNginx || !(await vncIsUp(url))) return <NoHayVisor sinNginx={sinNginx} url={url} />;

  return (
    <iframe
      src={url}
      title="Pantalla del servidor por VNC"
      className="h-full w-full border-0 bg-black"
      // El escritorio se maneja con teclado y se copia y pega en él: sin este
      // allow, el navegador le niega el portapapeles al marco.
      allow="clipboard-read; clipboard-write"
    />
  );
}

/**
 * Los dos motivos por los que el visor no está, con lo que hay que hacer en
 * cada caso. Son distintos: en el VPS falta levantar servicios, y en una
 * máquina de escritorio falta el túnel, porque el 6080 nunca sale a internet.
 */
function NoHayVisor({ sinNginx, url }: { sinNginx: boolean; url: string }) {
  return (
    <div className="grid min-h-full place-items-center px-6 py-10">
      <div className="card-surface flex w-full max-w-2xl flex-col gap-4 rounded-2xl p-6">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-hairline text-ink-muted">
            <MonitorOff className="h-4 w-4" />
          </span>
          <div>
            <p className="font-display text-[15px] font-semibold text-ink">
              {sinNginx ? "En esta máquina no hay visor" : "El visor no está respondiendo"}
            </p>
            <p className="label-mono-sm">
              {sinNginx ? "npm run dev · sin nginx delante" : `sin respuesta en ${url}`}
            </p>
          </div>
        </div>

        {sinNginx ? (
          <>
            <p className="text-[13px] leading-relaxed text-ink-secondary">
              La pantalla vive en el VPS, y en producción la sirve nginx en <code className="font-mono">/vnc/</code>.
              Corriendo la app en tu máquina ese camino no existe. Para verla desde acá, abrí el túnel:
            </p>
            <pre className="overflow-x-auto rounded-xl border border-hairline bg-page p-3 font-mono text-[11px] leading-relaxed text-ink-secondary">
ssh -N -L 6080:127.0.0.1:6080 godeye@177.7.53.246
            </pre>
            <p className="text-[13px] leading-relaxed text-ink-secondary">
              y poné esto en tu <code className="font-mono">.env.local</code>, reiniciando el server:
            </p>
            <pre className="overflow-x-auto rounded-xl border border-hairline bg-page p-3 font-mono text-[11px] leading-relaxed text-ink-secondary">
VNC_URL=http://127.0.0.1:6080/vnc.html?autoconnect=1&resize=scale
            </pre>
          </>
        ) : (
          <>
            <p className="text-[13px] leading-relaxed text-ink-secondary">
              La pantalla virtual o su visor no están corriendo en el servidor. En el VPS:
            </p>
            <pre className="overflow-x-auto rounded-xl border border-hairline bg-page p-3 font-mono text-[11px] leading-relaxed text-ink-secondary">
systemctl status xvfb x11vnc websockify
sudo systemctl restart x11vnc websockify
            </pre>
            <p className="text-[13px] leading-relaxed text-ink-secondary">
              Si esos servicios todavía no existen, están en la sección 6 de <code className="font-mono">DEPLOY.md</code>.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
