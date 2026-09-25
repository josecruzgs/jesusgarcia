"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, UsersRound, CheckCircle2, SlidersHorizontal, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/api";
import StatusBadge from "@/components/StatusBadge";
import Card from "@/components/Card";
import Modal from "@/components/Modal";
import ProfilePicker, { type PickerGroup, type PickerProfile } from "@/components/ProfilePicker";
import ExistingCampaignPicker from "@/components/ExistingCampaignPicker";

type CreatedTask = {
  _id: string;
  name: string;
  status: string;
  profile: { _id: string; name: string };
};

type CreatedCampaign = {
  _id: string;
  name: string;
  status: string;
  taskCount: number;
};

const GROUP_URL = /^https?:\/\/([a-z0-9-]+\.)?facebook\.com\/groups\/[^/?#]+/i;

export default function JoinGroupCampaignPage() {
  const [profiles, setProfiles] = useState<PickerProfile[]>([]);
  const [groups, setGroups] = useState<PickerGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [url, setUrl] = useState("");
  const [contexto, setContexto] = useState("");
  const [staggerSeconds, setStaggerSeconds] = useState(600);
  const [autoRun, setAutoRun] = useState(true);
  const [namePrefix, setNamePrefix] = useState("grupo");
  const [campaignName, setCampaignName] = useState("");
  const [campaignMode, setCampaignMode] = useState<"new" | "existing">("new");
  const [existingCampaignId, setExistingCampaignId] = useState("");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<CreatedTask[] | null>(null);
  const [omitidos, setOmitidos] = useState<{ _id: string; name: string }[]>([]);
  const [createdCampaign, setCreatedCampaign] = useState<CreatedCampaign | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch<{ profiles: PickerProfile[] }>("/api/profiles?all=true"),
      apiFetch<{ groups: PickerGroup[] }>("/api/groups?all=true"),
    ])
      .then(([p, g]) => {
        setProfiles(p.profiles);
        setGroups(g.groups);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const cid = new URLSearchParams(window.location.search).get("campaignId");
    if (cid) {
      setCampaignMode("existing");
      setExistingCampaignId(cid);
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setResult(null);
    setOmitidos([]);
    setCreatedCampaign(null);
    try {
      const r = await apiFetch<{
        campaign: CreatedCampaign;
        tasks: CreatedTask[];
        omitidos: { _id: string; name: string }[];
      }>("/api/tasks/join-group-campaign", {
        method: "POST",
        body: JSON.stringify({
          campaignName: campaignMode === "new" ? campaignName : undefined,
          campaignId: campaignMode === "existing" ? existingCampaignId : undefined,
          url,
          contexto,
          profileIds: Array.from(selected),
          staggerSeconds,
          autoRun,
          namePrefix,
        }),
      });
      setResult(r.tasks);
      setOmitidos(r.omitidos ?? []);
      setCreatedCampaign(r.campaign);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  const count = selected.size;
  const elegidos = profiles.filter((p) => selected.has(p._id));
  const urlValida = GROUP_URL.test(url.trim());

  return (
    <div className="flex animate-fade-in-up flex-col gap-6">
      <div>
        <Link href="/tasks" className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Tareas
        </Link>
        <div className="mt-2 flex items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded border border-series-2/55 bg-series-2/12 text-series-2">
            <UsersRound className="h-4.5 w-4.5" />
          </span>
          <h1 className="text-2xl font-semibold text-ink">Unirse a grupos</h1>
        </div>
        <p className="mt-2 text-sm text-ink-secondary">
          Pega el link de un grupo de Facebook y elige los perfiles: cada uno pide entrar. Si el grupo tiene preguntas
          de ingreso, las contesta la IA con los datos del perfil y el contexto que escribas.
        </p>
      </div>

      {error && <p className="rounded-lg bg-critical/10 p-3 text-sm text-critical">{error}</p>}

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
              <>Se crearon {result.length} tarea{result.length === 1 ? "" : "s"}.</>
            )}
          </p>
          {omitidos.length > 0 && (
            <p className="text-xs text-ink-secondary">
              {omitidos.length} perfil{omitidos.length === 1 ? "" : "es"} no se mandaron porque ya tienen una solicitud
              a este grupo: {omitidos.map((p) => p.name).join(", ")}.
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            {result.map((t) => (
              <div key={t._id} className="flex items-center justify-between gap-2">
                <Link href={`/tasks/${t._id}`} className="text-ink hover:text-primary hover:underline">
                  {t.profile.name}
                </Link>
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

      <form onSubmit={submit} className="card-surface flex flex-col gap-5 p-5">
        <ExistingCampaignPicker
          type="joingroup"
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
              placeholder="Ej. Grupos Culiacán"
              className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
            />
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs text-ink-muted">Link del grupo</label>
          <input
            required
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.facebook.com/groups/1891377237815361"
            className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
          />
          {url && !urlValida && (
            <p className="text-xs text-critical">Tiene que ser un link de grupo: facebook.com/groups/…</p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            <Sparkles className="h-3.5 w-3.5" /> Contexto para responder las preguntas del grupo (opcional)
          </label>
          <textarea
            value={contexto}
            onChange={(e) => setContexto(e.target.value)}
            rows={3}
            placeholder="Ej. Somos vecinos de Culiacán, nos interesa el grupo para enterarnos de noticias de la ciudad y vender cosas de segunda mano."
            className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
          />
          <p className="text-xs text-ink-muted">
            Solo se usa si el grupo pide contestar preguntas. La IA responde en primera persona con la edad y el género
            de cada perfil, una respuesta distinta por cuenta, y acepta las reglas. Nunca inventa correos ni teléfonos.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-ink-muted">Espaciado entre perfiles (minutos)</label>
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

        <div className="flex flex-col gap-3 border-t border-hairline pt-4">
          {/* La tabla va paginada: sin esto, lo que marca el botón queda
              repartido en páginas que nadie está mirando. */}
          {elegidos.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {elegidos.map((p) => (
                <span
                  key={p._id}
                  className="inline-flex items-center gap-1 rounded-full border border-hairline bg-page px-2.5 py-1 text-xs text-ink"
                >
                  {p.name || p._id}
                  <span className="text-ink-muted">· {p.taskCount ?? 0} tareas</span>
                </span>
              ))}
            </div>
          )}
          <ProfilePicker
            profiles={profiles}
            groups={groups}
            loading={loading}
            selected={selected}
            onChange={setSelected}
            pickLeastUsed
          />
        </div>

        <button
          disabled={creating || count === 0 || !urlValida || (campaignMode === "existing" && !existingCampaignId)}
          className="glow-btn w-fit rounded bg-primary px-4 py-2 text-sm font-medium text-primary-fg transition-colors duration-100 disabled:pointer-events-none disabled:opacity-50"
        >
          {creating
            ? "Creando..."
            : campaignMode === "existing"
              ? `Agregar perfiles (${count})`
              : `Mandar ${count} perfil${count === 1 ? "" : "es"} al grupo`}
        </button>
      </form>

      <Modal open={showAdvanced} onClose={() => setShowAdvanced(false)} title="Ajustes adicionales">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-ink-muted">Prefijo de nombre</label>
            <input
              value={namePrefix}
              onChange={(e) => setNamePrefix(e.target.value)}
              className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <p className="text-xs text-ink-muted">
            Un perfil que ya tiene una solicitud a este grupo (hecha o en cola) no se vuelve a mandar. Las que fallaron sí
            se pueden reintentar.
          </p>
        </div>
      </Modal>
    </div>
  );
}
