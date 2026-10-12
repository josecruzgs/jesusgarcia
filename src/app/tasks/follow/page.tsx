"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, UserPlus } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { canonicalizeFacebookProfileUrl } from "@/lib/facebookProfileUrl";
import StatusBadge from "@/components/StatusBadge";
import Card from "@/components/Card";
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

export default function FollowCampaignPage() {
  const [profiles, setProfiles] = useState<PickerProfile[]>([]);
  const [groups, setGroups] = useState<PickerGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [url, setUrl] = useState("");
  const [staggerSeconds, setStaggerSeconds] = useState(300);
  const [autoRun, setAutoRun] = useState(true);
  const [campaignName, setCampaignName] = useState("");
  const [campaignMode, setCampaignMode] = useState<"new" | "existing">("new");
  const [existingCampaignId, setExistingCampaignId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<CreatedTask[] | null>(null);
  const [omitidos, setOmitidos] = useState<{ _id: string; name: string }[]>([]);
  const [createdCampaign, setCreatedCampaign] = useState<CreatedCampaign | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch<{ profiles: PickerProfile[] }>("/api/profiles?all=true"),
      apiFetch<{ groups: PickerGroup[] }>("/api/groups?all=true"),
    ])
      .then(([profileResponse, groupResponse]) => {
        setProfiles(profileResponse.profiles);
        setGroups(groupResponse.groups);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const campaignId = new URLSearchParams(window.location.search).get("campaignId");
    if (campaignId) {
      setCampaignMode("existing");
      setExistingCampaignId(campaignId);
    }
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    setResult(null);
    setOmitidos([]);
    setCreatedCampaign(null);
    try {
      const response = await apiFetch<{
        campaign: CreatedCampaign;
        tasks: CreatedTask[];
        omitidos: { _id: string; name: string }[];
      }>("/api/tasks/follow-campaign", {
        method: "POST",
        body: JSON.stringify({
          campaignName: campaignMode === "new" ? campaignName : undefined,
          campaignId: campaignMode === "existing" ? existingCampaignId : undefined,
          url,
          profileIds: Array.from(selected),
          staggerSeconds,
          autoRun,
        }),
      });
      setResult(response.tasks);
      setOmitidos(response.omitidos ?? []);
      setCreatedCampaign(response.campaign);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  const urlValida = Boolean(canonicalizeFacebookProfileUrl(url.trim()));
  const count = selected.size;
  const elegidos = profiles.filter((profile) => selected.has(profile._id));

  return (
    <div className="flex animate-fade-in-up flex-col gap-6">
      <div>
        <Link href="/tasks" className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Tareas
        </Link>
        <div className="mt-2 flex items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded border border-series-3/55 bg-series-3/12 text-series-3">
            <UserPlus className="h-4.5 w-4.5" />
          </span>
          <h1 className="text-2xl font-semibold text-ink">Seguir perfiles</h1>
        </div>
        <p className="mt-2 text-sm text-ink-secondary">
          Pega el link del perfil de Facebook y elige las cuentas que quieres usar. Se crea una tarea por cada perfil
          seleccionado.
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
              <>Se crearon {result.length} tarea{result.length === 1 ? "" : "s"} de seguimiento.</>
            )}
          </p>
          {omitidos.length > 0 && (
            <p className="text-xs text-ink-secondary">
              {omitidos.length} perfil{omitidos.length === 1 ? "" : "es"} ya tenía una tarea de seguimiento a esta cuenta:
              {" "}{omitidos.map((profile) => profile.name).join(", ")}.
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            {result.map((task) => (
              <div key={task._id} className="flex items-center justify-between gap-2">
                <Link href={`/tasks/${task._id}`} className="text-ink hover:text-primary hover:underline">
                  {task.profile.name}
                </Link>
                <StatusBadge status={task.status} />
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
          type="follow"
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
              onChange={(event) => setCampaignName(event.target.value)}
              placeholder="Ej. Seguir cuentas de interés"
              className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
            />
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs text-ink-muted">Link del perfil de Facebook</label>
          <input
            required
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://www.facebook.com/nombre"
            className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
          />
          {url && !urlValida && (
            <p className="text-xs text-critical">Pega un perfil: facebook.com/nombre o facebook.com/profile.php?id=…</p>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-ink-muted">Espaciado entre perfiles (minutos)</label>
            <input
              type="number"
              min={0}
              step={0.5}
              value={staggerSeconds / 60}
              onChange={(event) => setStaggerSeconds(Math.max(0, Math.round(Number(event.target.value) * 60)))}
              className="w-40 rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
        </div>

        <label className="flex w-fit items-center gap-2 text-sm text-ink-secondary">
          <input type="checkbox" checked={autoRun} onChange={(event) => setAutoRun(event.target.checked)} className="h-4 w-4 accent-primary" />
          Encolar y ejecutar automáticamente al crear
        </label>
        {!autoRun && <p className="-mt-3 text-xs text-ink-muted">Las tareas quedan pendientes para ejecutarlas manualmente.</p>}

        <div className="flex flex-col gap-3 border-t border-hairline pt-4">
          {elegidos.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {elegidos.map((profile) => (
                <span key={profile._id} className="inline-flex items-center gap-1 rounded-full border border-hairline bg-page px-2.5 py-1 text-xs text-ink">
                  {profile.name || profile._id}
                  <span className="text-ink-muted">· {profile.taskCount ?? 0} tareas</span>
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
          {creating ? "Creando..." : campaignMode === "existing" ? `Agregar perfiles (${count})` : `Seguir con ${count} perfil${count === 1 ? "" : "es"}`}
        </button>
      </form>
    </div>
  );
}
