"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, GitBranch, CheckCircle2, AlertTriangle } from "lucide-react";
import { apiFetch } from "@/lib/api";
import StatusBadge from "@/components/StatusBadge";
import Card from "@/components/Card";
import ProfilePicker, { type PickerGroup, type PickerProfile } from "@/components/ProfilePicker";

type TareaCreada = {
  _id: string;
  name: string;
  status: string;
  comment: string;
  profile: { _id: string; name: string };
};

type Resultado = {
  campaign: { _id: string; name: string; status: string; taskCount: number };
  padre: TareaCreada;
  ramas: TareaCreada[];
};

export default function RamificacionCampaignPage() {
  const [profiles, setProfiles] = useState<PickerProfile[]>([]);
  const [groups, setGroups] = useState<PickerGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [url, setUrl] = useState("");
  const [parentProfileId, setParentProfileId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [staggerSeconds, setStaggerSeconds] = useState(120);
  const [autoRun, setAutoRun] = useState(true);
  const [namePrefix, setNamePrefix] = useState("rama");
  const [campaignName, setCampaignName] = useState("");

  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<Resultado | null>(null);
  const [poolCount, setPoolCount] = useState<number | null>(null);

  // Los textos se escriben acá. Vacíos, el servidor los toma del banco; el
  // botón "Traer del banco" los trae para poder editarlos antes de mandar.
  const [parentText, setParentText] = useState("");
  const [childTexts, setChildTexts] = useState<Record<string, string>>({});
  const [trayendo, setTrayendo] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [p, g, c] = await Promise.all([
          apiFetch<{ profiles: PickerProfile[] }>("/api/profiles?all=true"),
          apiFetch<{ groups: PickerGroup[] }>("/api/groups?all=true"),
          // `available` son los que quedan sin usar; `total` incluye los ya
          // consumidos por campañas anteriores.
          apiFetch<{ available?: number }>("/api/comments?pageSize=1"),
        ]);
        setProfiles(p.profiles);
        setGroups(g.groups);
        setPoolCount(c.available ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // El padre no puede ser también hijo: se respondería a sí mismo. Se saca de
  // la selección apenas se lo elige, en vez de rechazarlo al enviar.
  const hijos = [...selected].filter((id) => id !== parentProfileId);
  const necesarios = hijos.length + 1;

  // Con todos los textos escritos el banco no se toca; sin ninguno, el servidor
  // los saca de ahí. A medio llenar no se puede crear: sería adivinar de dónde
  // sale cada uno.
  const escritos = Boolean(parentText.trim()) && hijos.length > 0 && hijos.every((id) => childTexts[id]?.trim());
  const vacios = !parentText.trim() && hijos.every((id) => !childTexts[id]?.trim());
  const alcanzan = escritos || (vacios && (poolCount === null || poolCount >= necesarios));

  async function traerDelBanco() {
    setTrayendo(true);
    setError(null);
    try {
      const { comments } = await apiFetch<{ comments: { _id: string; text: string }[] }>(
        `/api/comments?pageSize=${necesarios}`,
      );
      const libres = comments.map((c) => c.text);
      if (!libres.length) throw new Error("El banco no tiene comentarios disponibles.");
      setParentText(libres[0] ?? "");
      setChildTexts(Object.fromEntries(hijos.map((id, i) => [id, libres[i + 1] ?? ""])));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTrayendo(false);
    }
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setResult(null);
    try {
      const data = await apiFetch<Resultado>("/api/tasks/ramificacion-campaign", {
        method: "POST",
        body: JSON.stringify({
          url,
          parentProfileId,
          childProfileIds: hijos,
          // Vacíos, el servidor los toma del banco.
          parentText: parentText.trim() || undefined,
          childTexts: escritos ? hijos.map((id) => childTexts[id].trim()) : undefined,
          staggerSeconds,
          autoRun,
          namePrefix,
          campaignName: campaignName.trim() || undefined,
        }),
      });
      setResult(data);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  const perfilPadre = profiles.find((p) => p._id === parentProfileId);

  return (
    <div className="flex animate-fade-in-up flex-col gap-6">
      <div>
        <Link href="/tasks" className="inline-flex items-center gap-1.5 text-sm text-ink-secondary hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Volver a tareas
        </Link>
        <h1 className="font-display mt-2 flex items-center gap-2 text-2xl font-semibold text-ink">
          <GitBranch className="h-6 w-6" /> Campaña de ramificaciones
        </h1>
        <p className="mt-1 text-sm text-ink-secondary">
          Un perfil deja el comentario padre en la publicación. Cuando se confirma, cada perfil hijo le da like
          y le responde, colgando la rama de ese comentario.
        </p>
      </div>

      {error && <p className="rounded-xl bg-critical/10 p-3 text-sm text-critical">{error}</p>}

      <Card className="flex items-start gap-3 border-warning/30 bg-warning/5 p-4">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <p className="text-[13px] text-ink-secondary">
          Las ramas dependen de que Facebook le dé un enlace propio al comentario padre. En publicaciones
          normales lo hace; <strong className="text-ink">en reels muchas veces no</strong>, y ahí las ramas se
          cancelan solas con el motivo. Para ramificaciones conviene usar posts.
        </p>
      </Card>

      <form onSubmit={crear} className="flex flex-col gap-6">
        <Card className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-ink-muted">Publicación</label>
            <input
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.facebook.com/pagina/posts/..."
              className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-ink-muted">Perfil del comentario padre</label>
            {/* Los colores van explícitos en el <select> y en cada <option>:
                el desplegable nativo los pinta con lo que herede, y sobre el
                tema oscuro quedaba texto negro sobre fondo negro — la lista se
                veía vacía aunque tuviera los 131 perfiles. */}
            <select
              required
              value={parentProfileId}
              onChange={(e) => setParentProfileId(e.target.value)}
              className="w-96 rounded-lg border border-hairline bg-page px-3 py-2 text-sm text-ink outline-none focus:border-primary"
            >
              <option value="" className="bg-page text-ink">Elegí un perfil...</option>
              {profiles.map((p) => (
                <option key={p._id} value={p._id} className="bg-page text-ink">
                  {p.name}
                  {p.groupId ? ` — ${groups.find((g) => g.adsPowerGroupId === p.groupId)?.name ?? p.groupId}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-ink-muted">Espaciado entre ramas (segundos)</label>
              <input
                type="number"
                min={0}
                value={staggerSeconds}
                onChange={(e) => setStaggerSeconds(Number(e.target.value))}
                className="w-40 rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-ink-muted">Prefijo del nombre</label>
              <input
                value={namePrefix}
                onChange={(e) => setNamePrefix(e.target.value)}
                className="w-40 rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-ink-muted">Nombre de la campaña</label>
              <input
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="(automático)"
                className="w-56 rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm text-ink-secondary">
              <input type="checkbox" checked={autoRun} onChange={(e) => setAutoRun(e.target.checked)} />
              Encolar el padre al crear
            </label>
          </div>
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">Perfiles que responden (ramas hijas)</h2>
            <p className="label-mono-sm">
              {hijos.length} rama(s) · {necesarios} comentario(s) del banco
              {poolCount !== null && ` · ${poolCount} disponibles`}
            </p>
          </div>
          {perfilPadre && selected.has(parentProfileId) && (
            <p className="text-xs text-warning">
              {perfilPadre.name} es el padre: no se cuenta como rama aunque esté marcado.
            </p>
          )}
          {!alcanzan && (
            <p className="rounded-lg bg-critical/10 p-2 text-xs text-critical">
              {vacios
                ? `No alcanzan los comentarios del banco: hacen falta ${necesarios} y hay ${poolCount}. Escribilos arriba a mano.`
                : "Faltan textos por completar: llenalos todos arriba, o vaciálos todos para tomarlos del banco."}
            </p>
          )}
          <ProfilePicker
            profiles={profiles}
            groups={groups}
            loading={loading}
            selected={selected}
            onChange={setSelected}
          />
        </Card>

        <Card className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">Textos</h2>
            <div className="flex items-center gap-3">
              <p className="label-mono-sm">
                {escritos ? "escritos a mano · no consume el banco" : vacios ? "se toman del banco al crear" : "faltan textos por completar"}
              </p>
              <button
                type="button"
                onClick={traerDelBanco}
                disabled={trayendo || hijos.length === 0}
                className="rounded-lg border border-hairline px-2.5 py-1 text-xs font-medium transition-colors hover:bg-page disabled:opacity-40"
              >
                {trayendo ? "Trayendo..." : "Traer del banco"}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-ink-muted">
              Comentario padre {perfilPadre ? `· ${perfilPadre.name}` : ""}
            </label>
            <textarea
              rows={2}
              value={parentText}
              onChange={(e) => setParentText(e.target.value)}
              placeholder="Dejalo vacío para tomarlo del banco"
              className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm text-ink outline-none focus:border-primary"
            />
          </div>

          {hijos.length === 0 ? (
            <p className="text-xs text-ink-muted">Elegí perfiles hijos abajo para escribir sus respuestas.</p>
          ) : (
            hijos.map((id) => {
              const perfil = profiles.find((p) => p._id === id);
              return (
                <div key={id} className="flex flex-col gap-1">
                  <label className="text-xs text-ink-muted">Respuesta · {perfil?.name ?? id}</label>
                  <textarea
                    rows={2}
                    value={childTexts[id] ?? ""}
                    onChange={(e) => setChildTexts((prev) => ({ ...prev, [id]: e.target.value }))}
                    placeholder="Dejalo vacío para tomarlo del banco"
                    className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm text-ink outline-none focus:border-primary"
                  />
                </div>
              );
            })
          )}
        </Card>

        <div>
          <button
            disabled={creating || !url || !parentProfileId || hijos.length === 0 || !alcanzan}
            className="glow-btn inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-fg shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md disabled:opacity-50"
          >
            <GitBranch className="h-4 w-4" />
            {creating ? "Creando..." : `Crear ramificación (1 padre + ${hijos.length} ramas)`}
          </button>
        </div>
      </form>

      {result && (
        <Card className="flex flex-col gap-3 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-ok">
            <CheckCircle2 className="h-4 w-4" /> {result.campaign.name} · {result.campaign.taskCount} tareas
          </p>

          <div className="rounded-lg border border-hairline p-3">
            <p className="label-mono-sm mb-1">COMENTARIO PADRE</p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <StatusBadge status={result.padre.status} />
              <span className="text-ink">{result.padre.profile.name}</span>
              <span className="text-ink-secondary">— {result.padre.comment}</span>
            </div>
          </div>

          <div className="rounded-lg border border-hairline p-3">
            <p className="label-mono-sm mb-2">
              RAMAS · esperan a que el padre se confirme antes de entrar en cola
            </p>
            <div className="flex flex-col gap-1.5">
              {result.ramas.map((r) => (
                <div key={r._id} className="flex flex-wrap items-center gap-2 text-sm">
                  <StatusBadge status={r.status} />
                  <span className="text-ink">{r.profile.name}</span>
                  <span className="text-ink-secondary">— {r.comment}</span>
                </div>
              ))}
            </div>
          </div>

          <Link href="/tasks" className="text-sm text-primary hover:underline">
            Ver en la lista de tareas →
          </Link>
        </Card>
      )}
    </div>
  );
}
