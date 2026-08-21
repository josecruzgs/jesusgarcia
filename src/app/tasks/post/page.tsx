"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Megaphone, CheckCircle2, ExternalLink, Download, SlidersHorizontal } from "lucide-react";
import { apiFetch } from "@/lib/api";
import StatusBadge from "@/components/StatusBadge";
import Card from "@/components/Card";
import Meter from "@/components/Meter";
import Modal from "@/components/Modal";
import PlatformPicker from "@/components/PlatformPicker";
import ProfilePicker, { type PickerGroup, type PickerProfile } from "@/components/ProfilePicker";
import ExistingCampaignPicker from "@/components/ExistingCampaignPicker";

type CreatedTask = {
  _id: string;
  name: string;
  status: string;
  content: string;
  profile: { _id: string; name: string };
};

type CreatedCampaign = {
  _id: string;
  name: string;
  status: string;
  taskCount: number;
};

type PoolPost = { _id: string; text: string };

type PostPlatformPreset = {
  label: string;
  homeUrl: string;
  openSelector: string;
  dismissSelectors: string;
  textSelector: string;
  submitSelector: string;
  note: string;
};

const PLATFORM_PRESETS: Record<string, PostPlatformPreset> = {
  facebook: {
    label: "Facebook",
    homeUrl: "https://www.facebook.com/",
    openSelector: "text=/Qué estás pensando|What's on your mind/",
    dismissSelectors: 'div[role="dialog"] >> text=/Continuar|Continue/ || div[role="dialog"] >> text=/Guardar|Save/',
    textSelector: 'div[role="dialog"] div[role="textbox"][contenteditable="true"]',
    submitSelector: 'div[role="dialog"] >> text=/Publicar|Post/',
    note: "Verificado a mano: el cuadro del feed de inicio abre el modal \"Crear publicación\"/\"Create post\" directo (no hay botón aparte para abrirlo). La primera vez que se usa una cuenta, Facebook puede pedir confirmar la audiencia de futuras publicaciones (\"Continuar\"/\"Guardar\") — esos 2 clics son opcionales, no rompen la tarea si no aparecen. El texto de los botones cambia según el idioma de la cuenta, así que cada selector trae inglés y español juntos. El cuadro de texto usa un editor enriquecido (Lexical): hay que apuntar al div[role=\"textbox\"] real, no al texto de placeholder que se ve encima.",
  },
  instagram: {
    label: "Instagram",
    homeUrl: "https://www.instagram.com/",
    openSelector: 'svg[aria-label="Nueva publicación"], svg[aria-label="New post"]',
    dismissSelectors: "",
    textSelector: 'textarea[aria-label="Escribe un pie de foto..."], textarea[aria-label="Write a caption..."]',
    submitSelector: '[role="button"]:has-text("Compartir"), [role="button"]:has-text("Share")',
    note: "Sin verificar a mano todavía — ajusta si falla.",
  },
  tiktok: {
    label: "TikTok",
    homeUrl: "https://www.tiktok.com/upload",
    openSelector: "",
    dismissSelectors: "",
    textSelector: '[data-e2e="video-caption"]',
    submitSelector: '[data-e2e="post-button"]',
    note: "Sin verificar a mano todavía — ajusta si falla.",
  },
  x: {
    label: "X / Twitter",
    homeUrl: "https://x.com/home",
    openSelector: "",
    dismissSelectors: "",
    textSelector: '[data-testid="tweetTextarea_0"]',
    submitSelector: '[data-testid="tweetButtonInline"]',
    note: "Sin verificar a mano todavía — ajusta si falla.",
  },
  custom: {
    label: "Personalizado",
    homeUrl: "",
    openSelector: "",
    dismissSelectors: "",
    textSelector: "",
    submitSelector: "",
    note: "",
  },
};

const DEFAULT_SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTzzx5DnFIa_EHw5ucYoXekgKGHT2ivqDHPoE6VimoqOIA0ZD1yAz7qFDM5aXEqxTGV0Fsb8bZbbzzf/pub?gid=0&single=true&output=csv";

export default function PostCampaignPage() {
  const [profiles, setProfiles] = useState<PickerProfile[]>([]);
  const [groups, setGroups] = useState<PickerGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [homeUrl, setHomeUrl] = useState(PLATFORM_PRESETS.facebook.homeUrl);
  const [platformPreset, setPlatformPreset] = useState("facebook");
  const [openSelector, setOpenSelector] = useState(PLATFORM_PRESETS.facebook.openSelector);
  const [dismissSelectors, setDismissSelectors] = useState(PLATFORM_PRESETS.facebook.dismissSelectors);
  const [textSelector, setTextSelector] = useState(PLATFORM_PRESETS.facebook.textSelector);
  const [submitSelector, setSubmitSelector] = useState(PLATFORM_PRESETS.facebook.submitSelector);
  const [waitMs, setWaitMs] = useState(3000);
  const [staggerSeconds, setStaggerSeconds] = useState(300);
  const [autoRun, setAutoRun] = useState(true);
  const [namePrefix, setNamePrefix] = useState("post");
  const [campaignName, setCampaignName] = useState("");
  const [campaignMode, setCampaignMode] = useState<"new" | "existing">("new");
  const [existingCampaignId, setExistingCampaignId] = useState("");

  const [platformNote, setPlatformNote] = useState(PLATFORM_PRESETS.facebook.note);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<CreatedTask[] | null>(null);
  const [createdCampaign, setCreatedCampaign] = useState<CreatedCampaign | null>(null);

  // Banco de publicaciones
  const [poolTotal, setPoolTotal] = useState(0);
  const [poolAvailable, setPoolAvailable] = useState(0);
  const [poolPreview, setPoolPreview] = useState<PoolPost[]>([]);
  const [sheetUrl, setSheetUrl] = useState("");
  const [manualPosts, setManualPosts] = useState("");
  const [importing, setImporting] = useState(false);
  const [poolBusy, setPoolBusy] = useState(false);
  const [poolMessage, setPoolMessage] = useState<string | null>(null);

  async function loadProfiles() {
    setLoading(true);
    setError(null);
    try {
      const [p, g] = await Promise.all([
        apiFetch<{ profiles: PickerProfile[] }>("/api/profiles?all=true"),
        apiFetch<{ groups: PickerGroup[] }>("/api/groups?all=true"),
      ]);
      setProfiles(p.profiles);
      setGroups(g.groups);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadPool() {
    try {
      const data = await apiFetch<{ total: number; available: number; posts: PoolPost[] }>(
        "/api/posts?used=false&limit=8",
      );
      setPoolTotal(data.total);
      setPoolAvailable(data.available);
      setPoolPreview(data.posts);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    loadProfiles();
    loadPool();
  }, []);

  // Deep-link desde el modal de /campanas ("Agregar tareas"): preselecciona
  // el modo "agregar a campaña existente" con esa campaña ya elegida.
  useEffect(() => {
    const cid = new URLSearchParams(window.location.search).get("campaignId");
    if (cid) {
      setCampaignMode("existing");
      setExistingCampaignId(cid);
    }
  }, []);

  function applyPlatformPreset(key: string) {
    const preset = PLATFORM_PRESETS[key];
    setPlatformPreset(key);
    setHomeUrl(preset?.homeUrl ?? "");
    setOpenSelector(preset?.openSelector ?? "");
    setDismissSelectors(preset?.dismissSelectors ?? "");
    setTextSelector(preset?.textSelector ?? "");
    setSubmitSelector(preset?.submitSelector ?? "");
    setPlatformNote(preset?.note ?? "");
  }

  async function importSheetUrl(sourceUrl: string) {
    if (!sourceUrl.trim()) return;
    setImporting(true);
    setPoolMessage(null);
    setError(null);
    try {
      const data = await apiFetch<{ imported: number; skipped: number }>("/api/posts", {
        method: "POST",
        body: JSON.stringify({ sheetUrl: sourceUrl }),
      });
      setPoolMessage(`Importadas ${data.imported} publicación(es) nuevas (${data.skipped} ya estaban en el banco).`);
      await loadPool();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  function importFromSheet(e: React.FormEvent) {
    e.preventDefault();
    importSheetUrl(sheetUrl);
  }

  async function importManual(e: React.FormEvent) {
    e.preventDefault();
    const posts = manualPosts.split("\n").map((l) => l.trim()).filter(Boolean);
    if (posts.length === 0) return;
    setImporting(true);
    setPoolMessage(null);
    setError(null);
    try {
      const data = await apiFetch<{ imported: number; skipped: number }>("/api/posts", {
        method: "POST",
        body: JSON.stringify({ posts }),
      });
      setPoolMessage(`Importadas ${data.imported} publicación(es) nuevas (${data.skipped} ya estaban en el banco).`);
      setManualPosts("");
      await loadPool();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  async function deletePost(id: string) {
    setPoolBusy(true);
    try {
      await apiFetch(`/api/posts/${id}`, { method: "DELETE" });
      await loadPool();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPoolBusy(false);
    }
  }

  async function resetPool() {
    if (!confirm("¿Marcar todas las publicaciones del banco como disponibles de nuevo?")) return;
    setPoolBusy(true);
    try {
      await apiFetch("/api/posts/reset-used", { method: "POST" });
      await loadPool();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPoolBusy(false);
    }
  }

  async function clearPool() {
    if (!confirm("¿Borrar TODAS las publicaciones del banco? Esto no se puede deshacer.")) return;
    setPoolBusy(true);
    try {
      await apiFetch("/api/posts", { method: "DELETE" });
      await loadPool();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPoolBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setResult(null);
    setCreatedCampaign(null);
    try {
      const { campaign, tasks } = await apiFetch<{ campaign: CreatedCampaign; tasks: CreatedTask[] }>("/api/tasks/post-campaign", {
        method: "POST",
        body: JSON.stringify({
          campaignName: campaignMode === "new" ? campaignName : undefined,
          campaignId: campaignMode === "existing" ? existingCampaignId : undefined,
          homeUrl,
          openSelector,
          dismissSelectors,
          textSelector,
          submitSelector,
          profileIds: Array.from(selected),
          waitMs,
          staggerSeconds,
          autoRun,
          namePrefix,
        }),
      });
      setResult(tasks);
      setCreatedCampaign(campaign);
      setSelected(new Set());
      await loadPool();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  const count = selected.size;
  const notEnough = count > poolAvailable;

  return (
    <div className="flex animate-fade-in-up flex-col gap-6">
      <div>
        <Link href="/tasks" className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Tareas
        </Link>
        <div className="mt-2 flex items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-series-7/55 bg-series-7/12 text-series-7">
            <Megaphone className="h-4.5 w-4.5" />
          </span>
          <h1 className="text-2xl font-semibold text-ink">Campaña de publicaciones</h1>
        </div>
        <p className="mt-2 text-sm text-ink-secondary">
          Elige los perfiles: cada uno publica un texto distinto y sin repetir del banco.
        </p>
      </div>

      {error && <p className="rounded-xl bg-critical/10 p-3 text-sm text-critical">{error}</p>}

      {result && (
        <Card className="flex animate-fade-in-up flex-col gap-3 border-success/20 bg-success/5 p-4 text-sm">
          <p className="flex items-center gap-2 font-medium text-success">
            <CheckCircle2 className="h-4 w-4" />
            {createdCampaign ? (
              <>
                {campaignMode === "existing" ? "Se agregaron tareas a la campaña" : "Se creó la campaña"}{" "}
                <Link href={`/campanas?campaignId=${createdCampaign._id}`} className="underline">
                  {createdCampaign.name}
                </Link>{" "}
                ({result.length} nueva{result.length === 1 ? "" : "s"}).
              </>
            ) : (
              <>Se crearon {result.length} tarea{result.length === 1 ? "" : "s"} de publicación.</>
            )}
          </p>
          <div className="flex flex-col gap-1.5">
            {result.map((t) => (
              <div key={t._id} className="flex items-center justify-between gap-3">
                <Link href={`/tasks/${t._id}`} className="text-ink hover:text-primary hover:underline">
                  {t.profile.name}
                </Link>
                <span className="flex-1 truncate text-xs text-ink-muted" title={t.content}>
                  &quot;{t.content}&quot;
                </span>
                <StatusBadge status={t.status} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-xs">
            {createdCampaign && (
              <Link href={`/campanas?campaignId=${createdCampaign._id}`} className="w-fit text-primary underline">
                Abrir campaña →
              </Link>
            )}
            <Link href="/tasks" className="w-fit text-primary underline">Ver todas las tareas →</Link>
          </div>
        </Card>
      )}

      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">Banco de publicaciones</h2>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={poolBusy || poolTotal === 0}
              onClick={resetPool}
              className="text-xs text-ink-muted underline disabled:opacity-40"
            >
              reiniciar banco
            </button>
            <button
              type="button"
              disabled={poolBusy || poolTotal === 0}
              onClick={clearPool}
              className="text-xs text-critical underline disabled:opacity-40"
            >
              vaciar banco
            </button>
          </div>
        </div>

        <Meter label="Disponibles" value={poolAvailable} total={poolTotal} />

        {poolMessage && <p className="text-xs text-success">{poolMessage}</p>}

        <div className="grid gap-4 sm:grid-cols-2">
          <form onSubmit={importFromSheet} className="flex flex-col gap-2">
            <label className="text-xs text-ink-muted">
              Importar desde Google Sheets (Archivo → Compartir → Publicar en la web → CSV)
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={importing}
                onClick={() => importSheetUrl(DEFAULT_SHEET_CSV_URL)}
                className="glow-btn inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-fg shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md disabled:pointer-events-none disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                Importar sheet por defecto
              </button>
              <a
                href={DEFAULT_SHEET_CSV_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-2 text-sm font-medium text-ink-secondary transition-colors hover:bg-page hover:text-ink"
              >
                <ExternalLink className="h-4 w-4" />
                Ver sheet
              </a>
            </div>
            <div className="flex gap-2">
              <input
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
                placeholder="O pega otro link (https://docs.google.com/spreadsheets/d/.../pub?output=csv)"
                className="flex-1 rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
              />
              <button
                disabled={importing || !sheetUrl.trim()}
                className="rounded-lg border border-hairline px-3 py-2 text-sm font-medium transition-colors hover:bg-page disabled:opacity-50"
              >
                {importing ? "..." : "Importar"}
              </button>
            </div>
            <p className="text-xs text-ink-muted">Toma la primera columna de cada fila como texto de la publicación.</p>
          </form>

          <form onSubmit={importManual} className="flex flex-col gap-2">
            <label className="text-xs text-ink-muted">O pega publicaciones a mano (una por línea)</label>
            <textarea
              value={manualPosts}
              onChange={(e) => setManualPosts(e.target.value)}
              rows={2}
              placeholder={"Buenos días, gente bonita!!!\nQue tengan un excelente día 🙌"}
              className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
            />
            <button
              disabled={importing || !manualPosts.trim()}
              className="w-fit rounded-lg border border-hairline px-3 py-2 text-sm font-medium transition-colors hover:bg-page disabled:opacity-50"
            >
              {importing ? "..." : "Agregar al banco"}
            </button>
          </form>
        </div>

        {poolPreview.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-hairline pt-3">
            <span className="text-xs text-ink-muted">Próximos en usarse:</span>
            <ul className="flex flex-col gap-1">
              {poolPreview.map((p) => (
                <li key={p._id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-ink-secondary">{p.text}</span>
                  <button
                    type="button"
                    disabled={poolBusy}
                    onClick={() => deletePost(p._id)}
                    className="shrink-0 text-critical hover:underline disabled:opacity-50"
                  >
                    quitar
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <form onSubmit={submit} className="card-surface flex flex-col gap-5 p-5">
        <ExistingCampaignPicker
          type="post"
          mode={campaignMode}
          onModeChange={setCampaignMode}
          campaignId={existingCampaignId}
          onCampaignIdChange={setExistingCampaignId}
        />

        {campaignMode === "new" && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-ink-muted">Nombre de campaña</label>
            <input
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              placeholder="Ej. Publicaciones"
              className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
            />
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs text-ink-muted">Plataforma</label>
          <PlatformPicker
            options={Object.entries(PLATFORM_PRESETS).map(([key, p]) => ({ key, label: p.label }))}
            value={platformPreset}
            onChange={applyPlatformPreset}
          />
          {platformNote && <p className="mt-1 text-xs text-ink-muted">{platformNote}</p>}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-ink-muted">Espaciado entre tareas (minutos)</label>
            <input
              type="number"
              min={0}
              step={0.5}
              value={staggerSeconds / 60}
              onChange={(e) => setStaggerSeconds(Math.max(0, Math.round(Number(e.target.value) * 60)))}
              className="w-40 rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowAdvanced(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-2 text-sm font-medium text-ink-secondary transition-colors hover:bg-page hover:text-ink"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Ver ajustes adicionales
          </button>
        </div>

        <label className="flex w-fit items-center gap-2 text-sm text-ink-secondary">
          <input type="checkbox" checked={autoRun} onChange={(e) => setAutoRun(e.target.checked)} className="h-4 w-4 accent-primary" />
          Encolar y ejecutar automáticamente al crear
        </label>
        {!autoRun && (
          <p className="-mt-3 text-xs text-ink-muted">
            Las tareas quedan en &quot;pending&quot;; las ejecutas manualmente desde Tareas.
          </p>
        )}

        <div className="border-t border-hairline pt-4">
          <ProfilePicker profiles={profiles} groups={groups} loading={loading} selected={selected} onChange={setSelected} />
        </div>

        {notEnough && (
          <p className="text-xs text-warning">
            Elegiste {count} candidato(s) pero solo hay {poolAvailable} publicación(es) disponibles en el banco. Importa más o elige menos candidatos.
          </p>
        )}

        <button
          disabled={
            creating ||
            count === 0 ||
            !homeUrl ||
            !textSelector ||
            !submitSelector ||
            notEnough ||
            (campaignMode === "existing" && !existingCampaignId)
          }
          className="glow-btn w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md disabled:pointer-events-none disabled:opacity-50"
        >
          {creating
            ? "Creando..."
            : campaignMode === "existing"
              ? `Agregar tareas de publicación (${count || 0})`
              : `Crear campaña de publicación (${count || 0})`}
        </button>
      </form>

      <Modal open={showAdvanced} onClose={() => setShowAdvanced(false)} title="Ajustes adicionales">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-ink-muted">URL de inicio de la plataforma</label>
            <input
              required
              value={homeUrl}
              onChange={(e) => setHomeUrl(e.target.value)}
              placeholder="https://www.facebook.com/"
              className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-ink-muted">Selector para abrir el compositor (opcional)</label>
            <input
              value={openSelector}
              onChange={(e) => setOpenSelector(e.target.value)}
              placeholder="selector CSS (déjalo vacío si el cuadro de texto ya está visible)"
              className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-ink-muted">
              Selector(es) para cerrar diálogos de una sola vez (opcional)
            </label>
            <input
              value={dismissSelectors}
              onChange={(e) => setDismissSelectors(e.target.value)}
              placeholder='selector1 || selector2 (no rompe la tarea si no aparecen)'
              className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-ink-muted">Selector del cuadro de texto</label>
            <input
              required
              value={textSelector}
              onChange={(e) => setTextSelector(e.target.value)}
              placeholder="selector CSS"
              className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-ink-muted">Selector del botón de publicar</label>
            <input
              required
              value={submitSelector}
              onChange={(e) => setSubmitSelector(e.target.value)}
              placeholder="selector CSS"
              className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
            />
          </div>

          <p className="text-xs text-ink-muted">
            Los selectores son un punto de partida: las plataformas cambian su HTML seguido, ajústalos si la publicación falla.
          </p>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-ink-muted">Espera antes de buscar el compositor (ms)</label>
            <input
              type="number"
              min={0}
              value={waitMs}
              onChange={(e) => setWaitMs(Number(e.target.value))}
              className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-ink-muted">Prefijo de nombre</label>
            <input
              value={namePrefix}
              onChange={(e) => setNamePrefix(e.target.value)}
              className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
