"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Newspaper, CheckCircle2, SlidersHorizontal, ImagePlus, X, AlertTriangle } from "lucide-react";
import { apiFetch } from "@/lib/api";
import StatusBadge from "@/components/StatusBadge";
import Card from "@/components/Card";
import Modal from "@/components/Modal";
import ProfilePicker, { type PickerGroup, type PickerProfile } from "@/components/ProfilePicker";
import ExistingCampaignPicker from "@/components/ExistingCampaignPicker";
import { grupoCanonico } from "@/lib/facebookGroups";
import type { LaunchedGroup } from "../unirse-grupo/GruposLanzados";

type CreatedTask = { _id: string; name: string; status: string; profile: { _id: string; name: string } };
type CreatedCampaign = { _id: string; name: string; status: string; taskCount: number };

/** Una imagen ya subida al servidor; `preview` es la vista local para la miniatura. */
type Imagen = { _id: string; name: string; size: number; preview: string };

const GROUP_URL = /^https?:\/\/([a-z0-9-]+\.)?facebook\.com\/groups\/[^/?#]+/i;
const MAX_IMAGEN_BYTES = 8 * 1024 * 1024;
const TIPOS_IMAGEN = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/**
 * Las publicaciones se separan con una línea que tenga solo "---", y no una
 * por línea: un post de grupo suele tener varios párrafos.
 */
function separarTextos(valor: string) {
  return valor
    .split(/^\s*-{3,}\s*$/m)
    .map((t) => t.trim())
    .filter(Boolean);
}

export default function GroupPostCampaignPage() {
  const [profiles, setProfiles] = useState<PickerProfile[]>([]);
  const [groups, setGroups] = useState<PickerGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [url, setUrl] = useState("");
  const [textosCrudos, setTextosCrudos] = useState("");
  const [imagenes, setImagenes] = useState<Imagen[]>([]);
  const [subiendo, setSubiendo] = useState(0);
  const inputImagen = useRef<HTMLInputElement>(null);

  const [staggerSeconds, setStaggerSeconds] = useState(900);
  const [autoRun, setAutoRun] = useState(true);
  const [namePrefix, setNamePrefix] = useState("post grupo");
  const [campaignName, setCampaignName] = useState("");
  const [campaignMode, setCampaignMode] = useState<"new" | "existing">("new");
  const [existingCampaignId, setExistingCampaignId] = useState("");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<CreatedTask[] | null>(null);
  const [createdCampaign, setCreatedCampaign] = useState<CreatedCampaign | null>(null);

  const [launched, setLaunched] = useState<LaunchedGroup[]>([]);

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
    // Lo que se sabe de quién está en qué grupo sale de las campañas de
    // unirse: sirve para avisar antes de mandar a un perfil que no es miembro.
    apiFetch<{ groups: LaunchedGroup[] }>("/api/tasks/join-groups")
      .then((r) => setLaunched(r.groups))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const cid = new URLSearchParams(window.location.search).get("campaignId");
    if (cid) {
      setCampaignMode("existing");
      setExistingCampaignId(cid);
    }
  }, []);

  // Las miniaturas son URLs locales del navegador: se liberan al salir.
  const imagenesRef = useRef(imagenes);
  useEffect(() => {
    imagenesRef.current = imagenes;
  }, [imagenes]);
  useEffect(() => () => imagenesRef.current.forEach((i) => URL.revokeObjectURL(i.preview)), []);

  async function subirImagenes(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    for (const file of Array.from(files)) {
      if (!TIPOS_IMAGEN.includes(file.type)) {
        setError(`"${file.name}" no es una imagen JPG, PNG, WEBP o GIF.`);
        continue;
      }
      if (file.size > MAX_IMAGEN_BYTES) {
        setError(`"${file.name}" pasa de 8 MB.`);
        continue;
      }
      setSubiendo((n) => n + 1);
      try {
        // fetch directo y no apiFetch: apiFetch fija Content-Type JSON y el
        // navegador tiene que poner el multipart con su boundary.
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/group-post-images", { method: "POST", body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `No se pudo subir "${file.name}"`);
        setImagenes((prev) => [...prev, { ...data.image, preview: URL.createObjectURL(file) }]);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSubiendo((n) => n - 1);
      }
    }
    if (inputImagen.current) inputImagen.current.value = "";
  }

  async function quitarImagen(img: Imagen) {
    setImagenes((prev) => prev.filter((i) => i._id !== img._id));
    URL.revokeObjectURL(img.preview);
    // Si falla (p. ej. ya la usa una tarea), queda en el servidor sin estorbar.
    apiFetch(`/api/group-post-images/${img._id}`, { method: "DELETE" }).catch(() => {});
  }

  const textos = useMemo(() => separarTextos(textosCrudos), [textosCrudos]);
  const urlValida = GROUP_URL.test(url.trim());
  const canonico = urlValida ? grupoCanonico(url.trim()) : null;
  const grupoActual = canonico ? launched.find((g) => g.url === canonico) : undefined;
  const miembros = new Set((grupoActual?.profiles ?? []).filter((p) => p.state === "member").map((p) => p.profileId));

  const elegidos = profiles.filter((p) => selected.has(p._id));
  const count = elegidos.length;
  const sinConfirmar = canonico ? elegidos.filter((p) => !miembros.has(p._id)) : [];
  const faltanTextos = Math.max(0, count - textos.length);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setResult(null);
    setCreatedCampaign(null);
    try {
      const r = await apiFetch<{ campaign: CreatedCampaign; tasks: CreatedTask[] }>("/api/tasks/group-post-campaign", {
        method: "POST",
        body: JSON.stringify({
          campaignName: campaignMode === "new" ? campaignName : undefined,
          campaignId: campaignMode === "existing" ? existingCampaignId : undefined,
          url,
          textos,
          imageIds: imagenes.map((i) => i._id),
          profileIds: elegidos.map((p) => p._id),
          staggerSeconds,
          autoRun,
          namePrefix,
        }),
      });
      setResult(r.tasks);
      setCreatedCampaign(r.campaign);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex animate-fade-in-up flex-col gap-6">
      <div>
        <Link href="/tasks" className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Tareas
        </Link>
        <div className="mt-2 flex items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-series-3/55 bg-series-3/12 text-series-3">
            <Newspaper className="h-4.5 w-4.5" />
          </span>
          <h1 className="text-2xl font-semibold text-ink">Publicar en grupos</h1>
        </div>
        <p className="mt-2 text-sm text-ink-secondary">
          Pega el link de un grupo de Facebook, escribe las publicaciones y elige los perfiles: cada uno entra al grupo y
          publica uno de los textos, con una de las imágenes si subes alguna. Los perfiles tienen que ser miembros del
          grupo.
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
              <>Se crearon {result.length} tarea{result.length === 1 ? "" : "s"}.</>
            )}
          </p>
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
          type="grouppost"
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
              placeholder="Ej. Lotes en grupos de Culiacán"
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
          {url && !urlValida && <p className="text-xs text-critical">Tiene que ser un link de grupo: facebook.com/groups/…</p>}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-ink-muted">Publicaciones (una por perfil)</label>
          <textarea
            value={textosCrudos}
            onChange={(e) => setTextosCrudos(e.target.value)}
            rows={8}
            placeholder={"¿Alguien conoce terrenos a buen precio cerca del centro?\nLos estoy buscando para construir.\n---\nLes comparto este proyecto de lotes, a mí me pareció muy bueno.\n---\n..."}
            className="rounded-lg border border-hairline bg-page px-3 py-2 font-mono text-sm outline-none transition-colors focus:border-primary"
          />
          <p className="text-xs text-ink-muted">
            Separa cada publicación con una línea que tenga solo <code>---</code>. Hay{" "}
            <span className="font-medium text-ink">{textos.length}</span> publicación{textos.length === 1 ? "" : "es"}. Cada
            perfil publica una distinta: el mismo texto repetido en un grupo se marca como spam.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs text-ink-muted">Imágenes (opcional)</label>
          <div className="flex flex-wrap gap-2">
            {imagenes.map((img) => (
              <div key={img._id} className="group relative h-24 w-24 overflow-hidden rounded-lg border border-hairline">
                {/* eslint-disable-next-line @next/next/no-img-element -- vista local (blob:), no pasa por next/image */}
                <img src={img.preview} alt={img.name} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => quitarImagen(img)}
                  title="Quitar"
                  className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white opacity-90 hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => inputImagen.current?.click()}
              disabled={subiendo > 0}
              className="grid h-24 w-24 place-items-center rounded-lg border border-dashed border-hairline text-ink-muted transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
            >
              <span className="flex flex-col items-center gap-1 text-xs">
                <ImagePlus className="h-5 w-5" />
                {subiendo > 0 ? "Subiendo…" : "Agregar"}
              </span>
            </button>
            <input
              ref={inputImagen}
              type="file"
              accept={TIPOS_IMAGEN.join(",")}
              multiple
              className="hidden"
              onChange={(e) => subirImagenes(e.target.files)}
            />
          </div>
          <p className="text-xs text-ink-muted">
            JPG, PNG, WEBP o GIF, hasta 8 MB cada una. Se reparten en orden entre los perfiles; con una sola, va la misma
            para todos.
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
          <p className="-mt-3 text-xs text-ink-muted">Las tareas quedan en &quot;pending&quot;; las ejecutas manualmente desde Tareas.</p>
        )}

        <div className="flex flex-col gap-3 border-t border-hairline pt-4">
          {faltanTextos > 0 && (
            <p className="flex items-center gap-2 rounded-xl border border-critical/30 bg-critical/10 p-3 text-sm text-ink">
              <AlertTriangle className="h-4 w-4 shrink-0 text-critical" />
              Hay {textos.length} publicación{textos.length === 1 ? "" : "es"} para {count} perfil{count === 1 ? "" : "es"}:
              faltan {faltanTextos}.
            </p>
          )}
          {sinConfirmar.length > 0 && (
            <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-ink">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>
                {sinConfirmar.length} perfil{sinConfirmar.length === 1 ? "" : "es"} no figura{sinConfirmar.length === 1 ? "" : "n"}{" "}
                como miembro{sinConfirmar.length === 1 ? "" : "s"} de este grupo en las campañas de unirse
                ({sinConfirmar.map((p) => p.name).join(", ")}). Si no lo son, su tarea va a fallar avisando eso.
              </span>
            </p>
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
          disabled={
            creating ||
            subiendo > 0 ||
            count === 0 ||
            !urlValida ||
            faltanTextos > 0 ||
            (campaignMode === "existing" && !existingCampaignId)
          }
          className="glow-btn w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md disabled:pointer-events-none disabled:opacity-50"
        >
          {creating
            ? "Creando..."
            : campaignMode === "existing"
              ? `Agregar perfiles (${count})`
              : `Publicar con ${count} perfil${count === 1 ? "" : "es"}`}
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
            Conviene espaciar bastante: varias publicaciones seguidas en el mismo grupo desde cuentas nuevas es lo que los
            admins y Facebook marcan primero.
          </p>
        </div>
      </Modal>
    </div>
  );
}
