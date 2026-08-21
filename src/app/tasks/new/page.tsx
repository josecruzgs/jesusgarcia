"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";

type Profile = { _id: string; name: string };

type StepAction =
  | "goto"
  | "click"
  | "fill"
  | "type"
  | "press"
  | "waitForSelector"
  | "waitForTimeout"
  | "screenshot"
  | "scroll";

type Step = {
  action: StepAction;
  selector?: string;
  value?: string;
  url?: string;
  key?: string;
  ms?: number;
};

const ACTIONS: StepAction[] = [
  "goto",
  "click",
  "fill",
  "type",
  "press",
  "waitForSelector",
  "waitForTimeout",
  "screenshot",
  "scroll",
];

const TEMPLATES: Record<string, Step[]> = {
  "Login genérico": [
    { action: "goto", url: "https://example.com/login" },
    { action: "fill", selector: "#username", value: "" },
    { action: "fill", selector: "#password", value: "" },
    { action: "click", selector: "button[type=submit]" },
    { action: "waitForSelector", selector: "#home", ms: 30000 },
  ],
  "Publicar post genérico": [
    { action: "goto", url: "https://example.com/home" },
    { action: "click", selector: "[data-testid=create-post]" },
    { action: "fill", selector: "[data-testid=post-textarea]", value: "" },
    { action: "click", selector: "[data-testid=submit-post]" },
    { action: "waitForTimeout", ms: 2000 },
  ],
  "Warm-up (scroll + esperas)": [
    { action: "goto", url: "https://example.com/home" },
    { action: "waitForTimeout", ms: 3000 },
    { action: "scroll", ms: 800 },
    { action: "waitForTimeout", ms: 4000 },
    { action: "scroll", ms: 800 },
  ],
  "Dar like a una publicación": [
    { action: "goto", url: "https://example.com/post/123" },
    { action: "waitForTimeout", ms: 3000 },
    { action: "waitForSelector", selector: "[data-testid=like-button]", ms: 15000 },
    { action: "click", selector: "[data-testid=like-button]" },
    { action: "waitForTimeout", ms: 1500 },
  ],
};

function StepFields({ step, onChange }: { step: Step; onChange: (s: Step) => void }) {
  const set = (patch: Partial<Step>) => onChange({ ...step, ...patch });

  return (
    <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
      {step.action === "goto" && (
        <input
          className="col-span-2 rounded-lg border border-hairline bg-page px-2 py-1.5 text-xs outline-none focus:border-primary sm:col-span-4"
          placeholder="URL"
          value={step.url ?? ""}
          onChange={(e) => set({ url: e.target.value })}
        />
      )}
      {(step.action === "click" || step.action === "waitForSelector") && (
        <input
          className="col-span-2 rounded-lg border border-hairline bg-page px-2 py-1.5 text-xs outline-none focus:border-primary sm:col-span-4"
          placeholder="selector CSS"
          value={step.selector ?? ""}
          onChange={(e) => set({ selector: e.target.value })}
        />
      )}
      {(step.action === "fill" || step.action === "type") && (
        <>
          <input
            className="col-span-2 rounded-lg border border-hairline bg-page px-2 py-1.5 text-xs outline-none focus:border-primary"
            placeholder="selector CSS"
            value={step.selector ?? ""}
            onChange={(e) => set({ selector: e.target.value })}
          />
          <input
            className="col-span-2 rounded-lg border border-hairline bg-page px-2 py-1.5 text-xs outline-none focus:border-primary"
            placeholder="valor / texto"
            value={step.value ?? ""}
            onChange={(e) => set({ value: e.target.value })}
          />
        </>
      )}
      {step.action === "press" && (
        <>
          <input
            className="col-span-2 rounded-lg border border-hairline bg-page px-2 py-1.5 text-xs outline-none focus:border-primary"
            placeholder="selector (opcional)"
            value={step.selector ?? ""}
            onChange={(e) => set({ selector: e.target.value })}
          />
          <input
            className="col-span-2 rounded-lg border border-hairline bg-page px-2 py-1.5 text-xs outline-none focus:border-primary"
            placeholder="tecla, ej. Enter"
            value={step.key ?? ""}
            onChange={(e) => set({ key: e.target.value })}
          />
        </>
      )}
      {(step.action === "waitForTimeout" || step.action === "scroll" || step.action === "waitForSelector") && (
        <input
          type="number"
          className="col-span-2 rounded-lg border border-hairline bg-page px-2 py-1.5 text-xs outline-none focus:border-primary sm:col-span-4"
          placeholder="ms"
          value={step.ms ?? ""}
          onChange={(e) => set({ ms: Number(e.target.value) })}
        />
      )}
    </div>
  );
}

function NewTaskContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialProfileId = searchParams.get("profileId") ?? "";

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [name, setName] = useState("");
  const [profileId, setProfileId] = useState(initialProfileId);
  const [type, setType] = useState("custom");
  const [steps, setSteps] = useState<Step[]>([{ action: "goto", url: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ profiles: Profile[] }>("/api/profiles?all=true")
      .then(({ profiles }) => {
        setProfiles(profiles);
        if (!profileId && profiles[0]) setProfileId(profiles[0]._id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateStep(i: number, s: Step) {
    setSteps((prev) => prev.map((p, idx) => (idx === i ? s : p)));
  }

  function addStep() {
    setSteps((prev) => [...prev, { action: "waitForTimeout", ms: 1000 }]);
  }

  function removeStep(i: number) {
    setSteps((prev) => prev.filter((_, idx) => idx !== i));
  }

  function applyTemplate(templateName: string) {
    if (!templateName) return;
    setSteps(TEMPLATES[templateName].map((s) => ({ ...s })));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { task } = await apiFetch<{ task: { _id: string } }>("/api/tasks", {
        method: "POST",
        body: JSON.stringify({ name, profileId, type, steps }),
      });
      router.push(`/tasks/${task._id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex animate-fade-in-up flex-col gap-6">
      <h1 className="text-2xl font-semibold text-ink">Nueva tarea</h1>

      {error && <p className="rounded-xl bg-critical/10 p-3 text-sm text-critical">{error}</p>}

      <form onSubmit={submit} className="card-surface flex flex-col gap-5 p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-ink-muted">Nombre</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
              placeholder="ej. login-ig-01"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-ink-muted">Perfil</label>
            <select
              required
              value={profileId}
              onChange={(e) => setProfileId(e.target.value)}
              className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="" disabled>Selecciona un perfil</option>
              {profiles.map((p) => (
                <option key={p._id} value={p._id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-ink-muted">Tipo</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="login">login</option>
              <option value="post">post</option>
              <option value="warmup">warmup</option>
              <option value="scrape">scrape</option>
              <option value="like">like</option>
              <option value="likecomment">likecomment</option>
              <option value="custom">custom</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-ink-muted">Plantilla</label>
          <select
            onChange={(e) => applyTemplate(e.target.value)}
            defaultValue=""
            className="rounded-lg border border-hairline bg-page px-2 py-1.5 text-xs outline-none focus:border-primary"
          >
            <option value="">Cargar plantilla de ejemplo...</option>
            {Object.keys(TEMPLATES).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <span className="text-xs text-ink-muted">Los selectores son de ejemplo, ajústalos al sitio real.</span>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-ink-muted">Steps</label>
            <button type="button" onClick={addStep} className="text-xs text-primary underline">+ agregar step</button>
          </div>
          <div className="flex flex-col gap-2">
            {steps.map((step, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border border-hairline p-2">
                <span className="pt-1 text-xs text-ink-muted">{i + 1}</span>
                <select
                  value={step.action}
                  onChange={(e) => updateStep(i, { action: e.target.value as StepAction })}
                  className="rounded-lg border border-hairline bg-page px-2 py-1.5 text-xs outline-none focus:border-primary"
                >
                  {ACTIONS.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
                <StepFields step={step} onChange={(s) => updateStep(i, s)} />
                <button
                  type="button"
                  onClick={() => removeStep(i)}
                  className="pt-1 text-xs text-critical hover:underline"
                >
                  quitar
                </button>
              </div>
            ))}
          </div>
        </div>

        <button
          disabled={saving}
          className="glow-btn w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md disabled:pointer-events-none disabled:opacity-50"
        >
          {saving ? "Guardando..." : "Crear tarea"}
        </button>
      </form>
    </div>
  );
}

export default function NewTaskPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse-soft rounded-2xl bg-surface" />}>
      <NewTaskContent />
    </Suspense>
  );
}
