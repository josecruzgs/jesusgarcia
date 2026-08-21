"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, MessageSquare, CheckCircle2, ExternalLink, Download, SlidersHorizontal } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { COMMENT_PRESETS as PLATFORM_PRESETS } from "@/lib/automation/socialSelectors";
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
  comment: string;
  profile: { _id: string; name: string };
};

type CreatedCampaign = {
  _id: string;
  name: string;
  status: string;
  taskCount: number;
};

type PoolComment = { _id: string; text: string };

const DEFAULT_SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSbUfu9pvyPULSSFWDN7F7qxs0Y8jfZJZ5U0xoSL-QZKxItYrWjyRVdn2QhTtLoG3o65EDVerPgo4XI/pub?gid=0&single=true&output=csv";
const DEFAULT_SHEET_EDIT_URL = "https://docs.google.com/spreadsheets/d/1Aq8kLsSuas4vWP6aQ-jgQhWHAyt_lki5-Vqup-1EkKc/edit?usp=sharing";

export default function CommentCampaignPage() {
  const [profiles, setProfiles] = useState<PickerProfile[]>([]);
  const [groups, setGroups] = useState<PickerGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [url, setUrl] = useState("");
  const [platformPreset, setPlatformPreset] = useState("facebook");
  const [selector, setSelector] = useState(PLATFORM_PRESETS.facebook.selector);
  const [submitMethod, setSubmitMethod] = useState<"enter" | "button">(PLATFORM_PRESETS.facebook.submitMethod);
  const [submitSelector, setSubmitSelector] = useState(PLATFORM_PRESETS.facebook.submitSelector);
  const [waitMs, setWaitMs] = useState(3000);
  const [staggerSeconds, setStaggerSeconds] = useState(300);
  const [autoRun, setAutoRun] = useState(true);
  const [namePrefix, setNamePrefix] = useState("comment");
  const [campaignName, setCampaignName] = useState("");
  const [campaignMode, setCampaignMode] = useState<"new" | "existing">("new");
  const [existingCampaignId, setExistingCampaignId] = useState("");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<CreatedTask[] | null>(null);
  const [createdCampaign, setCreatedCampaign] = useState<CreatedCampaign | null>(null);

  // Banco de comentarios
  const [poolTotal, setPoolTotal] = useState(0);
  const [poolAvailable, setPoolAvailable] = useState(0);
  const [poolPreview, setPoolPreview] = useState<PoolComment[]>([]);
  const [sheetUrl, setSheetUrl] = useState("");
  const [manualComments, setManualComments] = useState("");
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
      const data = await apiFetch<{ total: number; available: number; comments: PoolComment[] }>(
        "/api/comments?used=false&limit=8",
      );
      setPoolTotal(data.total);
      setPoolAvailable(data.available);
      setPoolPreview(data.comments);
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
    setSelector(preset?.selector ?? "");
    setSubmitMethod(preset?.submitMethod ?? "enter");
    setSubmitSelector(preset?.submitSelector ?? "");
  }

  async function importSheetUrl(sourceUrl: string) {
    if (!sourceUrl.trim()) return;
    setImporting(true);
    setPoolMessage(null);
    setError(null);
    try {
      const data = await apiFetch<{ imported: number; skipped: number }>("/api/comments", {
        method: "POST",
        body: JSON.stringify({ sheetUrl: sourceUrl }),
      });
      setPoolMessage(`Importados ${data.imported} comentario(s) nuevos (${data.skipped} ya estaban en el banco).`);
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
    const comments = manualComments.split("\n").map((l) => l.trim()).filter(Boolean);
    if (comments.length === 0) return;
    setImporting(true);
    setPoolMessage(null);
    setError(null);
    try {
      const data = await apiFetch<{ imported: number; skipped: number }>("/api/comments", {
        method: "POST",
        body: JSON.stringify({ comments }),
      });
      setPoolMessage(`Importados ${data.imported} comentario(s) nuevos (${data.skipped} ya estaban en el banco).`);
      setManualComments("");
      await loadPool();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  async function deleteComment(id: string) {
    setPoolBusy(true);
    try {
      await apiFetch(`/api/comments/${id}`, { method: "DELETE" });
      await loadPool();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPoolBusy(false);
    }
  }

  async function resetPool() {
    if (!confirm("¿Marcar todos los comentarios del banco como disponibles de nuevo?")) return;
    setPoolBusy(true);
    try {
      await apiFetch("/api/comments/reset-used", { method: "POST" });
      await loadPool();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPoolBusy(false);
    }
  }

  async function clearPool() {
    if (!confirm("¿Borrar TODOS los comentarios del banco? Esto no se puede deshacer.")) return;
    setPoolBusy(true);
    try {
      await apiFetch("/api/comments", { method: "DELETE" });
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
      const { campaign, tasks } = await apiFetch<{ campaign: CreatedCampaign; tasks: CreatedTask[] }>("/api/tasks/comment-campaign", {
        method: "POST",
        body: JSON.stringify({
          campaignName: campaignMode === "new" ? campaignName : undefined,
          campaignId: campaignMode === "existing" ? existingCampaignId : undefined,
          url,
          selector,
          submitMethod,
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
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-series-5/55 bg-series-5/12 text-series-5">
            <MessageSquare className="h-4.5 w-4.5" />
          </span>
          <h1 className="text-2xl font-semibold text-ink">Campaña de comentarios</h1>
        </div>
        <p className="mt-2 text-sm text-ink-secondary">
          Pega un link, elige los candidatos y cada uno comenta un texto distinto del banco (sin repetir).
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
              <>Se crearon {result.length} tarea{result.length === 1 ? "" : "s"} de comentario.</>
            )}
          </p>
          <div className="flex flex-col gap-1.5">
            {result.map((t) => (
              <div key={t._id} className="flex items-center justify-between gap-3">
                <Link href={`/tasks/${t._id}`} className="text-ink hover:text-primary hover:underline">
                  {t.profile.name}
                </Link>
                <span className="flex-1 truncate text-xs text-ink-muted" title={t.comment}>
                  &quot;{t.comment}&quot;
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
          <h2 className="text-sm font-semibold text-ink">Banco de comentarios</h2>
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
                href={DEFAULT_SHEET_EDIT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-2 text-sm font-medium text-ink-secondary transition-colors hover:bg-page hover:text-ink"
              >
                <ExternalLink className="h-4 w-4" />
                Editar comentarios en Sheets
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
            <p className="text-xs text-ink-muted">Toma la primera columna de cada fila como texto del comentario.</p>
          </form>

          <form onSubmit={importManual} className="flex flex-col gap-2">
            <label className="text-xs text-ink-muted">O pega comentarios a mano (uno por línea)</label>
            <textarea
              value={manualComments}
              onChange={(e) => setManualComments(e.target.value)}
              rows={2}
              placeholder={"Qué buena publicación!\nMe encantó esto 🙌"}
              className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
            />
            <button
              disabled={importing || !manualComments.trim()}
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
              {poolPreview.map((c) => (
                <li key={c._id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-ink-secondary">{c.text}</span>
                  <button
                    type="button"
                    disabled={poolBusy}
                    onClick={() => deleteComment(c._id)}
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
          type="comment"
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
              placeholder="Ej. Comentarios Reel"
              className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
            />
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs text-ink-muted">Link a comentar</label>
          <input
            required
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.facebook.com/..."
            className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-ink-muted">Plataforma</label>
          <PlatformPicker
            options={Object.entries(PLATFORM_PRESETS).map(([key, p]) => ({ key, label: p.label }))}
            value={platformPreset}
            onChange={applyPlatformPreset}
          />
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
            Elegiste {count} candidato(s) pero solo hay {poolAvailable} comentario(s) disponibles en el banco. Importa más o elige menos candidatos.
          </p>
        )}

        <button
          disabled={
            creating ||
            count === 0 ||
            !url ||
            !selector ||
            notEnough ||
            (submitMethod === "button" && !submitSelector) ||
            (campaignMode === "existing" && !existingCampaignId)
          }
          className="glow-btn w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md disabled:pointer-events-none disabled:opacity-50"
        >
          {creating
            ? "Creando..."
            : campaignMode === "existing"
              ? `Agregar tareas de comentario (${count || 0})`
              : `Crear campaña de comentario (${count || 0})`}
        </button>
      </form>

      <Modal open={showAdvanced} onClose={() => setShowAdvanced(false)} title="Ajustes adicionales">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-ink-muted">Selector del cuadro de comentario</label>
            <input
              required
              value={selector}
              onChange={(e) => setSelector(e.target.value)}
              placeholder="selector CSS"
              className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-ink-muted">Enviar con</label>
            <select
              value={submitMethod}
              onChange={(e) => setSubmitMethod(e.target.value as "enter" | "button")}
              className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="enter">tecla Enter</option>
              <option value="button">botón (selector aparte)</option>
            </select>
          </div>

          {submitMethod === "button" && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-ink-muted">Selector del botón de enviar</label>
              <input
                required
                value={submitSelector}
                onChange={(e) => setSubmitSelector(e.target.value)}
                placeholder="selector CSS"
                className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
              />
            </div>
          )}

          <p className="text-xs text-ink-muted">
            Los selectores son un punto de partida: las plataformas cambian su HTML seguido, ajústalos si el comentario falla.
          </p>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-ink-muted">Espera antes de buscar el cuadro (ms)</label>
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
