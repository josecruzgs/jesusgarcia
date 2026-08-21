"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, RotateCcw, Upload, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import Card from "@/components/Card";
import { useSession } from "@/lib/session";
import { CITIES, findCity } from "@/lib/timezones";

const HOUSE_ACCENT = "#8a6a28";
const HOUSE_TITLE = "Jesús García";

const AVATAR_SIZE = 256;

/**
 * Reduce la foto a un cuadrado de 256px antes de subirla.
 *
 * Se hace en el navegador y no en el servidor por una razón práctica: la foto
 * que sale de un teléfono pesa varios megas, y mandarla entera para recortarla
 * después sería subir cien veces lo que se va a guardar.
 */
async function toAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("El navegador no pudo procesar la imagen");

  // Recorte "cover": se llena el cuadrado y se centra, en vez de deformar.
  const scale = Math.max(AVATAR_SIZE / bitmap.width, AVATAR_SIZE / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (AVATAR_SIZE - w) / 2, (AVATAR_SIZE - h) / 2, w, h);
  bitmap.close();

  const webp = canvas.toDataURL("image/webp", 0.85);
  // Safari viejo devuelve un PNG cuando no soporta webp; ahí se fuerza JPEG,
  // que pesa mucho menos que ese PNG de respaldo.
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.85);
}

export default function AjustesPage() {
  const session = useSession();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [accentColor, setAccentColor] = useState("");
  const [sidebarColor, setSidebarColor] = useState("");
  const [city, setCity] = useState("");
  const [avatar, setAvatar] = useState("");
  const [brandTitle, setBrandTitle] = useState("");
  const [brandSubtitle, setBrandSubtitle] = useState("");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // La sesión llega por contexto desde el layout; el formulario arranca con lo
  // que ya esté guardado.
  useEffect(() => {
    if (!session) return;
    const p = session.preferences;
    setAccentColor(p.accentColor ?? "");
    setSidebarColor(p.sidebarColor ?? "");
    setCity(p.city ?? "");
    setAvatar(p.avatar ?? "");
    setBrandTitle(p.brandTitle ?? "");
    setBrandSubtitle(p.brandSubtitle ?? "");
  }, [session]);

  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setError(null);
    try {
      setAvatar(await toAvatarDataUrl(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await apiFetch("/api/preferences", {
        method: "PUT",
        body: JSON.stringify({ accentColor, sidebarColor, city, avatar, brandTitle, brandSubtitle }),
      });
      // Vuelve a pedir el layout al servidor: es lo que hace que el acento, el
      // menú y el reloj se actualicen en el acto, sin recargar la página.
      router.refresh();
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const selectedCity = findCity(city);

  return (
    <form onSubmit={save} className="flex animate-fade-in-up flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Ajustes</h1>
        <p className="label-mono-sm mt-1">
          Personal · solo cambia cómo ves vos el panel, nadie más lo nota
        </p>
      </div>

      {error && <p className="rounded-xl bg-critical/10 p-3 text-sm text-critical">{error}</p>}

      <Card className="flex flex-col gap-5 p-5">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">Colores</h2>
          <p className="mt-1 text-[13px] text-ink-secondary">
            El acento reemplaza el oro de la casa en botones, cifras y enlaces. Los cuatro elementos
            —Agua, Viento, Tierra y Fuego— conservan su color en sus propias pantallas: es la señal de
            en qué sección estás.
          </p>
        </div>

        <ColorField
          label="Acento del sistema"
          value={accentColor}
          onChange={setAccentColor}
          fallback={HOUSE_ACCENT}
          hint="Botones, enlaces y métricas generales."
        />

        <ColorField
          label="Color del menú lateral"
          value={sidebarColor}
          onChange={setSidebarColor}
          fallback="#0d131c"
          hint="Se pinta sólido. El texto y los bordes se ajustan solos para seguir legibles."
        />
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">Tu hora</h2>
          <p className="mt-1 text-[13px] text-ink-secondary">
            El servidor corre en otra zona. Elegí tu ciudad y la barra de arriba muestra tu hora local,
            para confrontarla con tu reloj de un vistazo.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-ink-muted">Ciudad</label>
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
            >
              {CITIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label} · {c.state}
                </option>
              ))}
            </select>
          </div>
          <p className="pb-2 font-mono text-[11px] text-ink-muted">
            {selectedCity.timeZone} · ahora{" "}
            <span className="tabular-nums text-ink-secondary">
              <LiveTime timeZone={selectedCity.timeZone} />
            </span>
          </p>
        </div>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">Tu marca</h2>
          <p className="mt-1 text-[13px] text-ink-secondary">
            Sustituyen al logo y a los textos de arriba del menú. Vacío deja lo de la casa.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt="" className="h-14 w-14 rounded-full border border-hairline object-cover" />
            ) : (
              <div className="grid h-14 w-14 place-items-center rounded-full border border-dashed border-hairline text-[10px] text-ink-muted">
                logo
              </div>
            )}
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-xs transition-colors hover:bg-page"
              >
                <Upload className="h-3.5 w-3.5" /> Subir foto
              </button>
              {avatar && (
                <button
                  type="button"
                  onClick={() => setAvatar("")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-xs text-ink-muted transition-colors hover:bg-critical/10 hover:text-critical"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Quitar
                </button>
              )}
            </div>
            <input ref={fileInput} type="file" accept="image/*" onChange={pickFile} className="hidden" />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-ink-muted">Título</label>
            <input
              value={brandTitle}
              onChange={(e) => setBrandTitle(e.target.value)}
              maxLength={40}
              placeholder={HOUSE_TITLE}
              className="w-56 rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-ink-muted">Subtítulo</label>
            <input
              value={brandSubtitle}
              onChange={(e) => setBrandSubtitle(e.target.value)}
              maxLength={60}
              placeholder="Equipo Jesús García"
              className="w-72 rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <button
          disabled={saving}
          className="glow-btn inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-fg shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md disabled:opacity-50"
        >
          <Check className="h-4 w-4" />
          {saving ? "Guardando..." : "Guardar ajustes"}
        </button>
        {saved && <span className="text-[13px] text-ok">Guardado. Ya se ve aplicado.</span>}
      </div>
    </form>
  );
}

function ColorField({
  label,
  value,
  onChange,
  fallback,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  fallback: string;
  hint: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        type="color"
        value={value || fallback}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="h-9 w-12 cursor-pointer rounded-lg border border-hairline bg-page p-1"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="text-xs text-ink-muted">{hint}</p>
      </div>
      <span className="font-mono text-[11px] text-ink-muted">{value || "de la casa"}</span>
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          title="Volver al color de la casa"
          className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-xs text-ink-muted transition-colors hover:bg-page hover:text-ink"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Restablecer
        </button>
      )}
    </div>
  );
}

/** Hora de la ciudad elegida, para confirmar la elección sin guardar. */
function LiveTime({ timeZone }: { timeZone: string }) {
  const [now, setNow] = useState<string | null>(null);

  useEffect(() => {
    const paint = () =>
      setNow(new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }));
    paint();
    const id = setInterval(paint, 15000);
    return () => clearInterval(id);
  }, [timeZone]);

  return <>{now ?? "--:--"}</>;
}
