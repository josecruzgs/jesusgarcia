"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  UserCog,
  CheckCircle2,
  AlertTriangle,
  SlidersHorizontal,
  Search,
  Download,
  FileSpreadsheet,
  MousePointerClick,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import StatusBadge from "@/components/StatusBadge";
import Card from "@/components/Card";
import Modal from "@/components/Modal";
import PlatformPicker from "@/components/PlatformPicker";
import ProfilePicker, { type PickerGroup, type PickerProfile } from "@/components/ProfilePicker";

type SelectorPreset = {
  label: string;
  profileEditUrl: string;
  nameFieldSelector: string;
  cityOpenSelector: string;
  cityFieldSelector: string;
  saveSelector: string;
  note: string;
};

// Puntos de partida razonables por plataforma — igual que en Likes/Comentar
// (selectores por aria-label, que suelen ser más estables que clases CSS
// generadas). Donde el flujo real requiere otra página o no se ha
// confirmado todavía, se deja vacío a propósito en vez de adivinar algo que
// falle en silencio — con el aviso de "selectores faltantes" ya no pasa
// desapercibido.
const PLATFORM_PRESETS: Record<string, SelectorPreset> = {
  facebook: {
    label: "Facebook",
    profileEditUrl: "https://www.facebook.com/me/",
    nameFieldSelector: "",
    cityOpenSelector: 'a[aria-label="Editar Datos personales"] || div[aria-label="Editar ciudad actual"]',
    cityFieldSelector: 'input[aria-label="Ciudad actual"]',
    saveSelector: "",
    note: "Ciudad verificada en vivo en facebook.com/me: el campo es un combobox con autocompletado (no un input plano) — 'Abrir' pasa por el link 'Editar Datos personales' y el lápiz 'Editar ciudad actual' antes de escribir, y al elegir la sugerencia con flecha abajo + Enter ya queda guardado solo (por eso no hace falta 'saveSelector' acá). Nombre todavía no se confirmó en vivo — Facebook lo mueve a Configuración → Información personal, un flujo más sensible (puede pedir reingresar contraseña); ajusta nameFieldSelector antes de usarlo en masa.",
  },
  instagram: {
    label: "Instagram",
    profileEditUrl: "https://www.instagram.com/accounts/edit/",
    nameFieldSelector: 'input[name="fullName"]',
    cityOpenSelector: "",
    cityFieldSelector: "",
    saveSelector: 'button:has-text("Enviar"), button:has-text("Submit")',
    note: "Instagram no tiene campo de ciudad en el perfil — queda vacío a propósito.",
  },
  tiktok: {
    label: "TikTok",
    profileEditUrl: "https://www.tiktok.com/setting/profile",
    nameFieldSelector: "",
    cityOpenSelector: "",
    cityFieldSelector: "",
    saveSelector: "",
    note: "TikTok no tiene un patrón de selectores conocido y estable — inspecciona la página real para completarlos.",
  },
  x: {
    label: "X / Twitter",
    profileEditUrl: "https://x.com/settings/profile",
    nameFieldSelector: "",
    cityOpenSelector: "",
    cityFieldSelector: "",
    saveSelector: "",
    note: "X no tiene un patrón de selectores conocido y estable — inspecciona la página real para completarlos.",
  },
  custom: {
    label: "Personalizado",
    profileEditUrl: "",
    nameFieldSelector: "",
    cityOpenSelector: "",
    cityFieldSelector: "",
    saveSelector: "",
    note: "",
  },
};

// Meta rechaza texto libre que no matchee una ciudad real de su propio
// autocompletado (ver nota del preset de Facebook). En manual se elige
// primero estado y luego ciudad para no terminar escribiendo el estado entero.
const CITY_OPTIONS_BY_STATE: Record<string, string[]> = {
  "Baja California": ["Tijuana", "Mexicali", "Ensenada", "Tecate", "Playas de Rosarito"],
  Sonora: ["Hermosillo", "Ciudad Obregón", "Nogales", "San Luis Río Colorado", "Navojoa"],
  Jalisco: ["Guadalajara", "Zapopan", "San Pedro Tlaquepaque", "Tonalá", "Puerto Vallarta"],
  "Nuevo León": ["Monterrey", "San Pedro Garza García", "San Nicolás de los Garza", "Guadalupe", "Apodaca"],
  "Ciudad de México": ["Ciudad de México", "Coyoacán", "Miguel Hidalgo", "Benito Juárez", "Cuauhtémoc"],
  Sinaloa: ["Culiacán", "Mazatlán", "Los Mochis", "Guasave"],
  Chihuahua: ["Chihuahua", "Ciudad Juárez", "Delicias", "Cuauhtémoc"],
  "Estado de México": ["Toluca", "Naucalpan de Juárez", "Tlalnepantla", "Ecatepec", "Metepec"],
  Puebla: ["Puebla", "Tehuacán", "San Andrés Cholula", "Atlixco"],
};

const STATE_OPTIONS = Object.keys(CITY_OPTIONS_BY_STATE);

type ManualProfileDraft = {
  name: string;
  state: string;
  city: string;
};

const EMPTY_MANUAL_DRAFT: ManualProfileDraft = { name: "", state: "", city: "" };

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

type MatchedRow = {
  profileId: string;
  profileName: string;
  groupId: string;
  platform: string;
  lastStatus: string;
  age: number | null;
  gender: "hombre" | "mujer" | null;
  name: string | null;
  city: string | null;
};

const TEMPLATE_CSV =
  "Perfil,Nombre,Ciudad\n" +
  "Adriana Quintero,Adriana Q.,Bogotá\n" +
  "Alejandra Guzman,,Medellín\n" +
  "Alonso Fierro Beltran,Alonso F.,\n";

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadTemplate() {
  downloadCsv(TEMPLATE_CSV, "plantilla-auto-profile.csv");
}

// Comillas dobles si el nombre trae coma, comilla o salto de línea (RFC 4180) —
// mismo criterio que src/lib/csv.ts usa para leer, para que el archivo se
// pueda editar y volver a importar sin romperse.
function csvField(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

// Exporta los perfiles reales ya existentes con la columna "Perfil" llena y
// las demás vacías, listas para editar — así no hay que escribir cada
// nombre a mano ni arriesgarse a que no matchee por un typo.
function downloadProfilesExport(profiles: PickerProfile[]) {
  const rows = [["Perfil", "Nombre", "Ciudad"]];
  for (const p of profiles) rows.push([p.name, "", ""]);
  const csv = rows.map((r) => r.map(csvField).join(",")).join("\n") + "\n";
  downloadCsv(csv, "perfiles-auto-profile.csv");
}

// Ajustes de selectores + timing compartidos por ambos modos (sheet y manual).
function AdvancedSettingsModal({
  open,
  onClose,
  values,
}: {
  open: boolean;
  onClose: () => void;
  values: ReturnType<typeof useSharedSettings>;
}) {
  const {
    nameFieldSelector, setNameFieldSelector,
    cityOpenSelector, setCityOpenSelector,
    cityFieldSelector, setCityFieldSelector,
    saveSelector, setSaveSelector,
    waitMs, setWaitMs,
    namePrefix, setNamePrefix,
  } = values;

  return (
    <Modal open={open} onClose={onClose} title="Selectores y ajustes adicionales">
      <div className="flex flex-col gap-4">
        <p className="text-xs text-ink-muted">
          Los selectores son un punto de partida: la plataforma cambia su HTML seguido, ajústalos si un campo falla.
        </p>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-ink-muted">Selector del campo Nombre (opcional)</label>
          <input value={nameFieldSelector} onChange={(e) => setNameFieldSelector(e.target.value)} placeholder="selector CSS" className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary" />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-ink-muted">Selector(es) para abrir el flujo de ciudad (opcional)</label>
          <input value={cityOpenSelector} onChange={(e) => setCityOpenSelector(e.target.value)} placeholder='selector 1 || selector 2' className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary" />
          <p className="text-xs text-ink-muted">
            Cuando el campo no está visible de entrada (ej. hay que abrir un menú o un lápiz de editar antes), encadena
            los clics necesarios separándolos con <code className="rounded bg-page px-1 py-0.5">||</code>.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-ink-muted">Selector del campo Ciudad (opcional)</label>
          <input value={cityFieldSelector} onChange={(e) => setCityFieldSelector(e.target.value)} placeholder="selector CSS" className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary" />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-ink-muted">Selector del botón Guardar general (opcional)</label>
          <input value={saveSelector} onChange={(e) => setSaveSelector(e.target.value)} placeholder="selector CSS" className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary" />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-ink-muted">Espera antes de empezar a interactuar (ms)</label>
          <input type="number" min={0} value={waitMs} onChange={(e) => setWaitMs(Number(e.target.value))} className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary" />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-ink-muted">Prefijo de nombre</label>
          <input value={namePrefix} onChange={(e) => setNamePrefix(e.target.value)} className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary" />
        </div>
      </div>
    </Modal>
  );
}

function useSharedSettings() {
  const [profileEditUrl, setProfileEditUrl] = useState("");
  const [nameFieldSelector, setNameFieldSelector] = useState("");
  const [cityOpenSelector, setCityOpenSelector] = useState("");
  const [cityFieldSelector, setCityFieldSelector] = useState("");
  const [saveSelector, setSaveSelector] = useState("");
  const [waitMs, setWaitMs] = useState(3000);
  const [staggerSeconds, setStaggerSeconds] = useState(300);
  const [autoRun, setAutoRun] = useState(true);
  const [namePrefix, setNamePrefix] = useState("auto-profile");

  return {
    profileEditUrl, setProfileEditUrl,
    nameFieldSelector, setNameFieldSelector,
    cityOpenSelector, setCityOpenSelector,
    cityFieldSelector, setCityFieldSelector,
    saveSelector, setSaveSelector,
    waitMs, setWaitMs,
    staggerSeconds, setStaggerSeconds,
    autoRun, setAutoRun,
    namePrefix, setNamePrefix,
  };
}

export default function AutoProfilePage() {
  const [mode, setMode] = useState<"sheet" | "manual">("sheet");
  const [profiles, setProfiles] = useState<PickerProfile[]>([]);
  const [groups, setGroups] = useState<PickerGroup[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);

  const settings = useSharedSettings();
  const [platformPreset, setPlatformPreset] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreatedTask[] | null>(null);
  const [createdCampaign, setCreatedCampaign] = useState<CreatedCampaign | null>(null);
  const [campaignName, setCampaignName] = useState("");

  function applyPlatformPreset(key: string) {
    setPlatformPreset(key);
    const preset = PLATFORM_PRESETS[key];
    if (!preset) return;
    settings.setProfileEditUrl(preset.profileEditUrl);
    settings.setNameFieldSelector(preset.nameFieldSelector);
    settings.setCityOpenSelector(preset.cityOpenSelector);
    settings.setCityFieldSelector(preset.cityFieldSelector);
    settings.setSaveSelector(preset.saveSelector);
  }

  // --- modo sheet -----------------------------------------------------
  const [sheetUrl, setSheetUrl] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [matched, setMatched] = useState<MatchedRow[]>([]);
  const [unmatchedNames, setUnmatchedNames] = useState<string[]>([]);
  const [sheetSelected, setSheetSelected] = useState<Set<string>>(new Set());
  const [sheetSearch, setSheetSearch] = useState("");
  const [sheetGroupFilter, setSheetGroupFilter] = useState("");
  const [sheetPlatformFilter, setSheetPlatformFilter] = useState("");
  const [sheetGenderFilter, setSheetGenderFilter] = useState("");
  const [sheetAgeMin, setSheetAgeMin] = useState("");
  const [sheetAgeMax, setSheetAgeMax] = useState("");

  // --- modo manual: una tabla editable, una fila por perfil elegido
  const [manualSelected, setManualSelected] = useState<Set<string>>(new Set());
  const [manualDrafts, setManualDrafts] = useState<Record<string, ManualProfileDraft>>({});

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
      .finally(() => setLoadingProfiles(false));
  }, []);

  function groupName(groupId: string) {
    return groups.find((g) => g.adsPowerGroupId === groupId)?.name ?? groupId;
  }

  async function loadPreview(e: React.FormEvent) {
    e.preventDefault();
    setLoadingPreview(true);
    setPreviewError(null);
    setResult(null);
    setCreatedCampaign(null);
    try {
      const data = await apiFetch<{ matched: MatchedRow[]; unmatchedNames: string[] }>(
        "/api/tasks/auto-profile-campaign",
        { method: "POST", body: JSON.stringify({ mode: "sheet", sheetUrl, dryRun: true }) },
      );
      setMatched(data.matched);
      setUnmatchedNames(data.unmatchedNames);
      setSheetSelected(new Set(data.matched.filter((m) => m.name || m.city).map((m) => m.profileId)));
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : String(e));
      setMatched([]);
      setUnmatchedNames([]);
    } finally {
      setLoadingPreview(false);
    }
  }

  const filteredMatched = useMemo(() => {
    const q = sheetSearch.trim().toLowerCase();
    const ageMin = sheetAgeMin ? Number(sheetAgeMin) : undefined;
    const ageMax = sheetAgeMax ? Number(sheetAgeMax) : undefined;
    return matched.filter((m) => {
      if (q && !m.profileName.toLowerCase().includes(q)) return false;
      if (sheetGroupFilter && m.groupId !== sheetGroupFilter) return false;
      if (sheetPlatformFilter && m.platform !== sheetPlatformFilter) return false;
      if (sheetGenderFilter && m.gender !== sheetGenderFilter) return false;
      if (ageMin !== undefined && (m.age == null || m.age < ageMin)) return false;
      if (ageMax !== undefined && (m.age == null || m.age > ageMax)) return false;
      return true;
    });
  }, [matched, sheetSearch, sheetGroupFilter, sheetPlatformFilter, sheetGenderFilter, sheetAgeMin, sheetAgeMax]);

  function toggleSheetRow(id: string) {
    const next = new Set(sheetSelected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSheetSelected(next);
  }

  async function submitSheet(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setResult(null);
    setCreatedCampaign(null);
    try {
      const { campaign, tasks } = await apiFetch<{ campaign: CreatedCampaign; tasks: CreatedTask[] }>("/api/tasks/auto-profile-campaign", {
        method: "POST",
        body: JSON.stringify({
          mode: "sheet",
          dryRun: false,
          sheetUrl,
          campaignName,
          selectedProfileIds: Array.from(sheetSelected),
          ...selectorPayload(settings),
        }),
      });
      setResult(tasks);
      setCreatedCampaign(campaign);
      setMatched([]);
      setSheetSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  function manualDraftFor(profileId: string): ManualProfileDraft {
    return manualDrafts[profileId] ?? EMPTY_MANUAL_DRAFT;
  }

  function updateManualDraft(profileId: string, patch: Partial<ManualProfileDraft>) {
    setManualDrafts((prev) => {
      const current = prev[profileId] ?? { name: "", state: "", city: "" };
      const next = { ...current, ...patch };
      return { ...prev, [profileId]: next };
    });
  }

  function clearManualDraft(profileId: string) {
    setManualDrafts((prev) => {
      const next = { ...prev };
      delete next[profileId];
      return next;
    });
  }

  const manualProfiles = useMemo(
    () => profiles.filter((p) => manualSelected.has(p._id)),
    [profiles, manualSelected],
  );
  const canEditName = Boolean(settings.nameFieldSelector.trim());

  const manualAssignments = useMemo(
    () =>
      manualProfiles
        .map((profile) => {
          const draft = manualDrafts[profile._id] ?? EMPTY_MANUAL_DRAFT;
          return {
            profileId: profile._id,
            name: canEditName ? draft.name.trim() || undefined : undefined,
            city: draft.city.trim() || undefined,
          };
        })
        .filter((assignment) => assignment.name || assignment.city),
    [manualProfiles, manualDrafts, canEditName],
  );

  async function submitManual(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setResult(null);
    setCreatedCampaign(null);
    try {
      const { campaign, tasks } = await apiFetch<{ campaign: CreatedCampaign; tasks: CreatedTask[] }>("/api/tasks/auto-profile-campaign", {
        method: "POST",
        body: JSON.stringify({ mode: "manual", campaignName, assignments: manualAssignments, ...selectorPayload(settings) }),
      });
      setResult(tasks);
      setCreatedCampaign(campaign);
      setManualSelected(new Set());
      setManualDrafts({});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  function selectorPayload(s: ReturnType<typeof useSharedSettings>) {
    return {
      profileEditUrl: s.profileEditUrl,
      nameFieldSelector: s.nameFieldSelector,
      cityOpenSelector: s.cityOpenSelector,
      cityFieldSelector: s.cityFieldSelector,
      saveSelector: s.saveSelector,
      waitMs: s.waitMs,
      staggerSeconds: s.staggerSeconds,
      autoRun: s.autoRun,
      namePrefix: s.namePrefix,
    };
  }

  const sheetCount = sheetSelected.size;
  const manualCount = manualAssignments.length;

  // Si un campo trae valor pero su selector está vacío, ese paso se
  // saltaría en silencio y la tarea terminaría "success" sin haber cambiado
  // nada — se avisa acá antes de que el usuario le dé clic a crear.
  function computeMissingLabels(hasName: boolean, hasCity: boolean) {
    const missing: string[] = [];
    if (hasName && !settings.nameFieldSelector) missing.push("nombre");
    if (hasCity && !settings.cityFieldSelector) missing.push("ciudad");
    return missing;
  }

  const sheetSelectedRows = matched.filter((m) => sheetSelected.has(m.profileId));
  const sheetMissing = computeMissingLabels(
    sheetSelectedRows.some((m) => m.name),
    sheetSelectedRows.some((m) => m.city),
  );
  const manualMissing = computeMissingLabels(
    manualAssignments.some((a) => a.name),
    manualAssignments.some((a) => a.city),
  );

  function renderFooter(count: number, missing: string[]) {
    return (
    <>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-ink-muted">Nombre de campaña</label>
        <input
          value={campaignName}
          onChange={(e) => setCampaignName(e.target.value)}
          placeholder="Ej. Auto Profile julio"
          className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-ink-muted">Espaciado entre tareas (minutos)</label>
          <input
            type="number"
            min={0}
            step={0.5}
            value={settings.staggerSeconds / 60}
            onChange={(e) => settings.setStaggerSeconds(Math.max(0, Math.round(Number(e.target.value) * 60)))}
            className="w-40 rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowAdvanced(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-2 text-sm font-medium text-ink-secondary transition-colors hover:bg-page hover:text-ink"
        >
          <SlidersHorizontal className="h-4 w-4" />
          Ver selectores y ajustes adicionales
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-ink-muted">Plataforma (precarga selectores de partida)</label>
        <PlatformPicker
          options={Object.entries(PLATFORM_PRESETS).map(([key, p]) => ({ key, label: p.label }))}
          value={platformPreset}
          onChange={applyPlatformPreset}
        />
        {platformPreset && PLATFORM_PRESETS[platformPreset]?.note && (
          <p className="mt-1 text-xs text-ink-muted">{PLATFORM_PRESETS[platformPreset].note}</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-ink-muted">URL de la página de edición de perfil</label>
        <input
          required
          type="url"
          value={settings.profileEditUrl}
          onChange={(e) => settings.setProfileEditUrl(e.target.value)}
          placeholder="https://www.facebook.com/profile.php?edit_bio"
          className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
        />
        <p className="text-xs text-ink-muted">
          Cada perfil ya tiene su propia sesión iniciada en AdsPower, así que esta misma URL abre la edición de la
          cuenta correspondiente para cada uno.
        </p>
      </div>

      <label className="flex w-fit items-center gap-2 text-sm text-ink-secondary">
        <input type="checkbox" checked={settings.autoRun} onChange={(e) => settings.setAutoRun(e.target.checked)} className="h-4 w-4 accent-primary" />
        Encolar y ejecutar automáticamente al crear
      </label>
      {!settings.autoRun && (
        <p className="-mt-3 text-xs text-ink-muted">
          Las tareas quedan en &quot;pending&quot;; las ejecutas manualmente desde Tareas.
        </p>
      )}

      {missing.length > 0 && (
        <p className="flex items-center gap-1.5 rounded-lg bg-warning/10 p-3 text-xs text-warning">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Falta configurar el selector de <strong>{missing.join(", ")}</strong> en &quot;Ver selectores y ajustes
          adicionales&quot; — si no, ese campo se saltaría sin cambiar nada.
        </p>
      )}

      <button
        disabled={creating || count === 0 || !settings.profileEditUrl || missing.length > 0}
        className="glow-btn w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md disabled:pointer-events-none disabled:opacity-50"
      >
        {creating ? "Creando..." : `Crear campaña de Auto Profile (${count || 0})`}
      </button>
    </>
    );
  }

  return (
    <div className="flex animate-fade-in-up flex-col gap-6">
      <div>
        <Link href="/profiles" className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Perfiles
        </Link>
        <div className="mt-2 flex items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] accent-fill border">
            <UserCog className="h-4.5 w-4.5" />
          </span>
          <h1 className="text-2xl font-semibold text-ink">Auto Profile</h1>
        </div>
        <p className="mt-2 text-sm text-ink-secondary">
          Actualiza nombre y ciudad de tus perfiles — masivamente desde un Sheet, o eligiendo perfil por perfil.
        </p>
      </div>

      {error && <p className="rounded-xl bg-critical/10 p-3 text-sm text-critical">{error}</p>}

      {result && (
        <Card className="flex animate-fade-in-up flex-col gap-3 border-success/20 bg-success/5 p-4 text-sm">
          <p className="flex items-center gap-2 font-medium text-success">
            <CheckCircle2 className="h-4 w-4" />
            {createdCampaign ? (
              <>
                Se creó la campaña{" "}
                <Link href={`/campanas?campaignId=${createdCampaign._id}`} className="underline">
                  {createdCampaign.name}
                </Link>{" "}
                con {result.length} tarea{result.length === 1 ? "" : "s"}.
              </>
            ) : (
              <>Se crearon {result.length} tarea{result.length === 1 ? "" : "s"} de Auto Profile.</>
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

      <div role="tablist" aria-label="Modo de actualización" className="flex w-fit rounded-lg border border-hairline bg-surface p-1 shadow-sm">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "sheet"}
          onClick={() => setMode("sheet")}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-all duration-150 ${
            mode === "sheet" ? "bg-primary text-primary-fg shadow-sm" : "text-ink-secondary hover:bg-page hover:text-ink"
          }`}
        >
          <FileSpreadsheet className="h-4 w-4" /> Sheet (masivo)
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "manual"}
          onClick={() => setMode("manual")}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-all duration-150 ${
            mode === "manual" ? "bg-primary text-primary-fg shadow-sm" : "text-ink-secondary hover:bg-page hover:text-ink"
          }`}
        >
          <MousePointerClick className="h-4 w-4" /> Manual (uno por uno)
        </button>
      </div>

      {mode === "sheet" ? (
        <>
          <Card className="flex flex-col gap-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink">1. Lee el Sheet</h2>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => downloadProfilesExport(profiles)}
                  disabled={loadingProfiles || profiles.length === 0}
                  className="inline-flex items-center gap-1.5 text-xs text-primary underline disabled:pointer-events-none disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" /> Exportar mis {profiles.length || ""} perfiles a CSV
                </button>
                <button
                  type="button"
                  onClick={downloadTemplate}
                  className="inline-flex items-center gap-1.5 text-xs text-ink-muted underline"
                >
                  <Download className="h-3.5 w-3.5" /> Ver plantilla de ejemplo
                </button>
              </div>
            </div>
            <p className="text-xs text-ink-muted">
              &quot;Exportar mis perfiles&quot; te da un CSV con la columna Perfil ya llena con los nombres exactos
              de tus {profiles.length || "N"} perfiles — solo agrega Nombre/Ciudad donde quieras cambiar algo, deja
              vacías las filas que no toques, y súbelo a Sheets (o pégalo directo si tu Sheet acepta importar CSV).
            </p>
            <form onSubmit={loadPreview} className="flex gap-2">
              <div className="relative min-w-50 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
                <input
                  required
                  value={sheetUrl}
                  onChange={(e) => setSheetUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/.../pub?output=csv"
                  className="w-full rounded-lg border border-hairline bg-page py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary"
                />
              </div>
              <button
                disabled={loadingPreview || !sheetUrl.trim()}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md disabled:pointer-events-none disabled:opacity-50"
              >
                {loadingPreview ? "Leyendo..." : "Leer sheet"}
              </button>
            </form>
            <p className="text-xs text-ink-muted">
              Columnas: <strong>Perfil, Nombre, Ciudad</strong> (primera fila = encabezado, cualquier columna puede
              quedar vacía). Publicado como CSV (Archivo → Compartir → Publicar en la web → formato CSV).
            </p>
            {previewError && <p className="text-xs text-critical">{previewError}</p>}
          </Card>

          {(matched.length > 0 || unmatchedNames.length > 0) && (
            <Card className="flex flex-col gap-3 p-5">
              <h2 className="text-sm font-semibold text-ink">
                2. Filtra y elige quién se actualiza:{" "}
                <span className="text-primary">{sheetCount}</span> / {matched.length}
              </h2>

              <div className="flex flex-wrap gap-2">
                <div className="relative min-w-40 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
                  <input
                    value={sheetSearch}
                    onChange={(e) => setSheetSearch(e.target.value)}
                    placeholder="Buscar por nombre..."
                    className="w-full rounded-lg border border-hairline bg-page py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary"
                  />
                </div>
                <select value={sheetGroupFilter} onChange={(e) => setSheetGroupFilter(e.target.value)} className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary">
                  <option value="">Todos los grupos</option>
                  {groups.map((g) => (
                    <option key={g._id} value={g.adsPowerGroupId}>{g.name}</option>
                  ))}
                </select>
                <select value={sheetPlatformFilter} onChange={(e) => setSheetPlatformFilter(e.target.value)} className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary">
                  <option value="">Todas las plataformas</option>
                  <option value="facebook">Facebook</option>
                  <option value="instagram">Instagram</option>
                  <option value="tiktok">TikTok</option>
                  <option value="x">X</option>
                  <option value="linkedin">LinkedIn</option>
                </select>
                <select value={sheetGenderFilter} onChange={(e) => setSheetGenderFilter(e.target.value)} className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary">
                  <option value="">Todos los géneros</option>
                  <option value="hombre">Hombre</option>
                  <option value="mujer">Mujer</option>
                </select>
                <div className="flex items-center gap-1.5">
                  <input type="number" min={0} value={sheetAgeMin} onChange={(e) => setSheetAgeMin(e.target.value)} placeholder="Edad min" className="w-24 rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary" />
                  <span className="text-xs text-ink-muted">–</span>
                  <input type="number" min={0} value={sheetAgeMax} onChange={(e) => setSheetAgeMax(e.target.value)} placeholder="Edad max" className="w-24 rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary" />
                </div>
              </div>

              {filteredMatched.length > 0 && (
                <div className="max-h-80 overflow-y-auto rounded-lg border border-hairline">
                  <ul className="divide-y divide-hairline">
                    {filteredMatched.map((m) => {
                      const hasSheetChange = Boolean(m.name || m.city);
                      const checked = hasSheetChange && sheetSelected.has(m.profileId);
                      return (
                        <li key={m.profileId}>
                          <label className={`flex flex-wrap items-center gap-3 px-3 py-2 text-sm transition-colors ${!hasSheetChange ? "opacity-60" : checked ? "cursor-pointer bg-primary/5" : "cursor-pointer hover:bg-page"}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!hasSheetChange}
                              onChange={() => toggleSheetRow(m.profileId)}
                              className="h-4 w-4 accent-primary disabled:cursor-not-allowed"
                            />
                            <span className="font-medium text-ink">{m.profileName}</span>
                            <span className="text-xs text-ink-muted">{groupName(m.groupId)}</span>
                            <span className="text-xs text-ink-muted">{m.platform || "-"}</span>
                            {(m.age || m.gender) && (
                              <span className="text-xs text-ink-muted">
                                {m.age ?? "—"}{m.gender ? ` · ${m.gender === "hombre" ? "Hombre" : "Mujer"}` : ""}
                              </span>
                            )}
                            <span className="ml-auto flex flex-wrap gap-2">
                              {m.name && <span className="text-xs text-ink-muted">nombre → {m.name}</span>}
                              {m.city && <span className="text-xs text-ink-muted">ciudad → {m.city}</span>}
                              {!hasSheetChange && <span className="text-xs text-ink-muted">sin cambios</span>}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {filteredMatched.length === 0 && (
                <p className="p-2 text-sm text-ink-muted">Ningún perfil del sheet coincide con estos filtros.</p>
              )}

              {unmatchedNames.length > 0 && (
                <div className="flex flex-col gap-1 rounded-lg bg-warning/10 p-3 text-xs text-warning">
                  <p className="flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {unmatchedNames.length} fila(s) del sheet no coinciden con ningún perfil existente:
                  </p>
                  <p className="text-warning/80">{unmatchedNames.join(", ")}</p>
                </div>
              )}
            </Card>
          )}

          {matched.length > 0 && (
            <form onSubmit={submitSheet} className="card-surface flex flex-col gap-5 p-5">
              <h2 className="text-sm font-semibold text-ink">3. Configura y crea las tareas</h2>
              {renderFooter(sheetCount, sheetMissing)}
            </form>
          )}
        </>
      ) : (
        <form onSubmit={submitManual} className="flex flex-col gap-6">
          <Card className="flex flex-col gap-3 p-5">
            <h2 className="text-sm font-semibold text-ink">1. Elige perfiles</h2>
            <ProfilePicker
              profiles={profiles}
              groups={groups}
              loading={loadingProfiles}
              selected={manualSelected}
              onChange={setManualSelected}
            />
          </Card>

          <Card className="flex flex-col gap-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink">
                2. Escribe los cambios por perfil: <span className="text-primary">{manualCount}</span> con cambios
              </h2>
              {manualProfiles.length > 0 && (
                <button
                  type="button"
                  onClick={() => setManualDrafts({})}
                  className="text-xs text-ink-muted underline"
                >
                  limpiar cambios
                </button>
              )}
            </div>
            {!canEditName && (
              <p className="flex items-center gap-1.5 rounded-lg bg-warning/10 p-3 text-xs text-warning">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                El cambio de nombre queda desactivado hasta configurar un selector real. En Facebook normalmente no es
                confiable porque pasa por Account Center y puede pedir verificación; ciudad sí puede usarse con el preset.
              </p>
            )}

            {manualProfiles.length === 0 ? (
              <p className="rounded-lg border border-dashed border-hairline p-4 text-sm text-ink-muted">
                Selecciona perfiles arriba para editar nombre y ciudad en una tabla.
              </p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-hairline">
                <div className="max-h-96 overflow-auto">
                  <table className="w-full min-w-[860px] text-sm">
                    <thead className="sticky top-0 border-b border-hairline bg-surface text-left text-xs uppercase tracking-wide text-ink-muted">
                      <tr>
                        <th className="px-3 py-2 font-medium">Perfil</th>
                        <th className="px-3 py-2 font-medium">Nuevo nombre</th>
                        <th className="px-3 py-2 font-medium">Estado</th>
                        <th className="px-3 py-2 font-medium">Ciudad</th>
                        <th className="w-20 px-3 py-2 font-medium">Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {manualProfiles.map((profile) => {
                        const draft = manualDraftFor(profile._id);
                        const cityOptions = draft.state ? CITY_OPTIONS_BY_STATE[draft.state] ?? [] : [];
                        const hasNameChange = canEditName && Boolean(draft.name.trim());
                        const hasChange = hasNameChange || Boolean(draft.city.trim());

                        return (
                          <tr key={profile._id} className={hasChange ? "border-t border-hairline bg-primary/5" : "border-t border-hairline"}>
                            <td className="max-w-56 px-3 py-2">
                              <span className="block truncate font-medium text-ink" title={profile.name}>
                                {profile.name}
                              </span>
                              <span className="text-xs text-ink-muted">{groupName(profile.groupId)}</span>
                            </td>
                            <td className="px-3 py-2">
                              <input
                                value={canEditName ? draft.name : ""}
                                onChange={(e) => updateManualDraft(profile._id, { name: e.target.value })}
                                disabled={!canEditName}
                                placeholder={canEditName ? "Dejar igual" : "Configura selector primero"}
                                title={canEditName ? undefined : "Facebook no trae selector de nombre confiable en el preset actual."}
                                className="w-full min-w-44 rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <select
                                value={draft.state}
                                onChange={(e) =>
                                  updateManualDraft(profile._id, {
                                    state: e.target.value,
                                    city: "",
                                  })
                                }
                                className="w-full min-w-40 rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
                              >
                                <option value="">Sin cambio</option>
                                {STATE_OPTIONS.map((state) => (
                                  <option key={state} value={state}>
                                    {state}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              <select
                                value={draft.city}
                                onChange={(e) => updateManualDraft(profile._id, { city: e.target.value })}
                                disabled={!draft.state}
                                className="w-full min-w-44 rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
                              >
                                <option value="">Dejar igual</option>
                                {cityOptions.map((city) => (
                                  <option key={city} value={city}>
                                    {city}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                onClick={() => clearManualDraft(profile._id)}
                                disabled={!hasChange}
                                className="text-xs text-critical underline disabled:pointer-events-none disabled:opacity-40"
                              >
                                limpiar
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>

          <div className="card-surface flex flex-col gap-5 p-5">
            <h2 className="text-sm font-semibold text-ink">
              3. Configura y crea tareas: <span className="text-primary">{manualCount}</span> perfil{manualCount === 1 ? "" : "es"} con cambios
            </h2>
            {renderFooter(manualCount, manualMissing)}
          </div>
        </form>
      )}

      <AdvancedSettingsModal open={showAdvanced} onClose={() => setShowAdvanced(false)} values={settings} />
    </div>
  );
}
