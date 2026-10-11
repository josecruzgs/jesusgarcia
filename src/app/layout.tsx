import type { Metadata } from "next";
import { Space_Grotesk, Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import ThemeScript from "@/components/ThemeScript";
import AppShell from "@/components/AppShell";
import { currentUser } from "@/lib/auth/dal";
import { SessionProvider, type ClientSession } from "@/lib/session";
import { accentStyle } from "@/lib/theme";
import "./globals.css";

// Tres familias con roles fijos: display para titulares, sans para UI y
// cuerpo, mono para etiquetas de instrumentación y cifras.
//
// La tríada cambió entera respecto del proyecto del que salió este código
// (Fraunces + Inter + IBM Plex Mono). El cambio de fondo está en el rol de
// display: era una SERIF editorial y ahora es una grotesca técnica, que es lo
// que más rápido registra el ojo al comparar dos pantallas. Inter y Plex Mono
// son además las dos tipografías más reconocibles de cualquier panel, así que
// mientras siguieran ahí el parecido se sostenía por sí solo.
const spaceGrotesk = Space_Grotesk({
  variable: "--font-grotesk",
  subsets: ["latin"],
});

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sender",
  description: "Panel para automatizar cuentas de redes sociales",
  // favicon.png es el isotipo recortado y bajado a 128 px: el isotipo.png
  // original pesa casi 1 MB, demasiado para algo que se pide en cada pestaña.
  // Es verde sobre transparente y se lee igual en barras claras y oscuras.
  icons: { icon: "/media/favicon.png" },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // La sesión se resuelve acá arriba y baja por contexto: es lo que permite que
  // el acento, la foto y los textos del menú ya vengan bien en la primera
  // pintura, en vez de aparecer por defecto y corregirse un instante después.
  // En /login y /share no hay usuario y todo cae en los valores de la casa.
  const user = await currentUser();
  const session: ClientSession | null = user
    ? {
        id: user.id,
        username: user.username,
        role: user.role,
        groupIds: user.groupIds,
        preferences: user.preferences,
      }
    : null;

  return (
    <html
      lang="es"
      style={accentStyle(session?.preferences.accentColor)}
      className={`${jakarta.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} h-full antialiased`}
      // ThemeScript toggles the "dark" class on this element before React
      // hydrates (to avoid a flash of the wrong theme); that intentional,
      // out-of-band mutation is exactly what this flag exists to allow.
      suppressHydrationWarning
    >
      <body className="relative flex min-h-full overflow-hidden bg-page text-ink">
        <ThemeScript />
        <SessionProvider value={session}>
          <AppShell>{children}</AppShell>
        </SessionProvider>
      </body>
    </html>
  );
}
