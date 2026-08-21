"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw, Search, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useSession } from "@/lib/session";
import { findCheckTag } from "@/lib/checkTag";
import StatusBadge from "@/components/StatusBadge";
import Pagination from "@/components/Pagination";
import Card from "@/components/Card";
import TagBadge, { type Tag } from "@/components/TagBadge";

type Group = { _id: string; adsPowerGroupId: string; name: string };
type Profile = {
  _id: string;
  adsPowerProfileId: string;
  name: string;
  groupId: string;
  platform: string;
  lastStatus: string;
  age?: number | null;
  gender?: "hombre" | "mujer" | null;
  tags?: Tag[];
};

type DeleteProfileResponse = {
  ok?: boolean;
  error?: string;
  canDeleteLocal?: boolean;
};

const PAGE_SIZE = 20;

async function requestProfileDelete(id: string, localOnly = false) {
  const path = `/api/profiles/${id}${localOnly ? "?localOnly=true" : ""}`;
  const res = await fetch(path, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  });
  const text = await res.text();
  let json: DeleteProfileResponse | undefined;
  try {
    json = text ? (JSON.parse(text) as DeleteProfileResponse) : undefined;
  } catch {
    // El servidor deberia responder JSON, pero dejamos un fallback claro.
  }

  if (!res.ok) {
    return {
      ok: false as const,
      status: res.status,
      message: json?.error ?? `Error ${res.status} en ${path}`,
      canDeleteLocal: Boolean(json?.canDeleteLocal),
    };
  }

  return { ok: true as const, status: res.status };
}

// AdsPower marca con un check en la etiqueta los perfiles ya listos para
// usar. Es la vista con la que se quiere entrar a la tabla, asi que el filtro
// de etiquetas arranca con esa etiqueta puesta (se puede quitar a mano).
export default function ProfilesPage() {
  const session = useSession();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);
  // El check por defecto solo se aplica la primera vez: si el usuario lo
  // quita, una recarga de etiquetas (ej. tras sincronizar) no lo devuelve.
  const checkTagApplied = useRef(false);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [platformFilter, setPlatformFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [genderFilter, setGenderFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [ageMinFilter, setAgeMinFilter] = useState("");
  const [ageMaxFilter, setAgeMaxFilter] = useState("");

  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState("");
  const [platform, setPlatform] = useState("");
  const [creating, setCreating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const visibleProfileIds = profiles.map((profile) => profile._id);
  const selectedIdSet = new Set(selectedIds);
  const selectedCount = selectedIds.length;
  const allVisibleSelected = visibleProfileIds.length > 0 && visibleProfileIds.every((id) => selectedIdSet.has(id));
  const someVisibleSelected = visibleProfileIds.some((id) => selectedIdSet.has(id));

  async function loadGroups() {
    try {
      const { groups } = await apiFetch<{ groups: Group[] }>("/api/groups?all=true");
      setGroups(groups);
      if (!groupId && groups[0]) setGroupId(groups[0].adsPowerGroupId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function loadTags() {
    try {
      const { tags } = await apiFetch<{ tags: Tag[] }>("/api/profiles/tags");
      setAvailableTags(tags);
      if (!checkTagApplied.current) {
        checkTagApplied.current = true;
        const checkTag = findCheckTag(tags);
        if (checkTag) {
          setTagFilter(checkTag);
          setPage(1);
        }
      }
    } catch {
      // El filtro de etiquetas es un extra — si falla, se sigue sin él.
    }
  }

  async function loadProfiles() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (groupFilter) params.set("groupId", groupFilter);
      if (platformFilter) params.set("platform", platformFilter);
      if (statusFilter) params.set("lastStatus", statusFilter);
      if (search) params.set("search", search);
      if (genderFilter) params.set("gender", genderFilter);
      if (tagFilter) params.set("tag", tagFilter);
      if (ageMinFilter) params.set("ageMin", ageMinFilter);
      if (ageMaxFilter) params.set("ageMax", ageMaxFilter);
      const data = await apiFetch<{ profiles: Profile[]; total: number }>(`/api/profiles?${params}`);
      setProfiles(data.profiles);
      setTotal(data.total);
      refreshStatuses(data.profiles.map((p) => p._id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // "lastStatus" en la base solo refleja los perfiles que se iniciaron o
  // detuvieron desde esta app; para el resto (ej. recién sincronizados)
  // consultamos el estado real en AdsPower, pero solo para los perfiles de
  // la página visible (no los cientos que pueda haber en total).
  async function refreshStatuses(ids: string[]) {
    try {
      const { statuses } = await apiFetch<{ statuses: Record<string, string> }>("/api/profiles/status-refresh", {
        method: "POST",
        body: JSON.stringify({ ids }),
      });
      setProfiles((prev) => prev.map((p) => (statuses[p._id] ? { ...p, lastStatus: statuses[p._id] } : p)));
    } catch {
      // Si AdsPower no está corriendo, dejamos el estado guardado tal cual.
    }
  }

  useEffect(() => {
    loadGroups();
    loadTags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    loadProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, groupFilter, platformFilter, statusFilter, search, genderFilter, tagFilter, ageMinFilter, ageMaxFilter]);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
    }
  }, [allVisibleSelected, someVisibleSelected]);

  useEffect(() => {
    const visibleIds = new Set(profiles.map((profile) => profile._id));
    setSelectedIds((current) => {
      const next = current.filter((id) => visibleIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [profiles]);

  function updateGroupFilter(v: string) {
    setGroupFilter(v);
    setPage(1);
  }
  function updatePlatformFilter(v: string) {
    setPlatformFilter(v);
    setPage(1);
  }
  function updateStatusFilter(v: string) {
    setStatusFilter(v);
    setPage(1);
  }
  function updateGenderFilter(v: string) {
    setGenderFilter(v);
    setPage(1);
  }
  function updateTagFilter(v: string) {
    setTagFilter(v);
    setPage(1);
  }
  function updateAgeMinFilter(v: string) {
    setAgeMinFilter(v);
    setPage(1);
  }
  function updateAgeMaxFilter(v: string) {
    setAgeMaxFilter(v);
    setPage(1);
  }
  function clearFilters() {
    setSearchInput("");
    setSearch("");
    setGroupFilter("");
    setPlatformFilter("");
    setStatusFilter("");
    setGenderFilter("");
    setTagFilter("");
    setAgeMinFilter("");
    setAgeMaxFilter("");
    setPage(1);
  }

  function toggleProfileSelection(id: string, checked: boolean) {
    setSelectedIds((current) => {
      if (checked) return current.includes(id) ? current : [...current, id];
      return current.filter((selectedId) => selectedId !== id);
    });
  }

  function toggleVisibleSelection(checked: boolean) {
    setSelectedIds(checked ? visibleProfileIds : []);
  }

  function profileName(id: string) {
    return profiles.find((profile) => profile._id === id)?.name ?? id;
  }

  async function deleteSelectedProfiles() {
    if (selectedIds.length === 0) return;

    const ids = [...selectedIds];
    const label = ids.length === 1 ? "1 perfil" : `${ids.length} perfiles`;
    if (!confirm(`Eliminar ${label} seleccionados de forma permanente?`)) return;

    setBulkDeleting(true);
    setError(null);

    const failures: string[] = [];
    const failedIds = new Set<string>();
    const localOnlyCandidates: { id: string; message: string }[] = [];

    try {
      for (const id of ids) {
        const result = await requestProfileDelete(id);
        if (!result.ok) {
          if (result.status === 409 && result.canDeleteLocal) {
            localOnlyCandidates.push({ id, message: result.message });
          } else {
            failedIds.add(id);
            failures.push(`${profileName(id)}: ${result.message}`);
          }
        }
      }

      if (localOnlyCandidates.length > 0) {
        const localLabel =
          localOnlyCandidates.length === 1 ? "1 perfil sigue" : `${localOnlyCandidates.length} perfiles siguen`;
        const deleteLocal = confirm(
          `${localLabel} en uso en AdsPower.\n\nEliminarlos solo de esta app/Mongo? Si sincronizas y todavia existen en AdsPower, volveran a aparecer.`,
        );

        if (deleteLocal) {
          for (const { id } of localOnlyCandidates) {
            const localResult = await requestProfileDelete(id, true);
            if (!localResult.ok) {
              failedIds.add(id);
              failures.push(`${profileName(id)}: ${localResult.message}`);
            }
          }
        } else {
          for (const { id, message } of localOnlyCandidates) {
            failedIds.add(id);
            failures.push(`${profileName(id)}: ${message}`);
          }
        }
      }

      setSelectedIds((current) => current.filter((id) => failedIds.has(id)));
      await loadProfiles();

      if (failures.length > 0) {
        const detail = failures.slice(0, 4).join(" | ");
        const extra = failures.length > 4 ? ` (+${failures.length - 4} mas)` : "";
        setError(`No se pudieron eliminar ${failures.length} perfil(es): ${detail}${extra}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkDeleting(false);
    }
  }

  async function sync() {
    setSyncing(true);
    setError(null);
    setSyncNotice(null);
    try {
      // Secuencial (no en paralelo): la Local API de AdsPower rate-limitea
      // ~1 req/seg y estas llamadas ya paginan internamente.
      //
      // La de grupos es solo para admin —escribe la tabla que decide qué
      // grupos existen para asignar permisos— y devuelve 403 a los demás. El
      // operador se la saltea en vez de comerse el error: lo que necesita
      // refrescar son sus perfiles, y esa sí la puede correr.
      if (session?.role === "admin") {
        await apiFetch<{ groups: Group[] }>("/api/groups/sync", { method: "POST" });
      }
      const { removed } = await apiFetch<{ removed?: number }>("/api/profiles/sync", { method: "POST" });
      await loadGroups();
      await loadTags();
      await loadProfiles();
      if (removed) setSyncNotice(`Se quitaron ${removed} perfil(es) que ya no existen en AdsPower.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

  async function createProfile(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await apiFetch("/api/profiles", {
        method: "POST",
        body: JSON.stringify({ name, groupId, platform }),
      });
      setName("");
      await loadProfiles();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function startProfile(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await apiFetch(`/api/profiles/${id}/start`, { method: "POST" });
      await loadProfiles();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function stopProfile(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await apiFetch(`/api/profiles/${id}/stop`, { method: "POST" });
      await loadProfiles();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function deleteProfile(id: string) {
    if (!confirm("¿Eliminar este perfil de forma permanente?")) return;
    setBusyId(id);
    setError(null);
    try {
      const result = await requestProfileDelete(id);
      if (!result.ok) {
        if (
          result.status === 409 &&
          result.canDeleteLocal &&
          confirm(
            `${result.message}\n\nEliminarlo solo de esta app/Mongo? Si sincronizas y todavia existe en AdsPower, volvera a aparecer.`,
          )
        ) {
          const localResult = await requestProfileDelete(id, true);
          if (!localResult.ok) throw new Error(localResult.message);
        } else {
          throw new Error(result.message);
        }
      }
      await loadProfiles();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  function groupName(groupId: string) {
    return groups.find((g) => g.adsPowerGroupId === groupId)?.name ?? groupId;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(
    groupFilter || platformFilter || statusFilter || search || genderFilter || tagFilter || ageMinFilter || ageMaxFilter,
  );

  return (
    <div className="flex animate-fade-in-up flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Perfiles</h1>
          <p className="mt-1 text-sm text-ink-secondary">{total} en total</p>
        </div>
        <button
          onClick={sync}
          disabled={syncing}
          className="inline-flex items-center gap-1.5 rounded border border-hairline bg-surface px-3 py-2 text-sm font-medium transition-colors duration-100 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Sincronizando..." : "Sincronizar con Sistema"}
        </button>
      </div>

      {error && <p className="rounded-lg bg-critical/10 p-3 text-sm text-critical">{error}</p>}
      {!error && syncNotice && (
        <p className="rounded-lg bg-success/10 p-3 text-sm text-success">{syncNotice}</p>
      )}

      <Card className="p-4">
        <form onSubmit={createProfile} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-ink-muted">Nombre</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
              placeholder="ej. ig-cuenta-01"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-ink-muted">Grupo</label>
            <select
              required
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="" disabled>Selecciona un grupo</option>
              {groups.map((g) => (
                <option key={g._id} value={g.adsPowerGroupId}>{g.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-ink-muted">Plataforma</label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="">-</option>
              <option value="facebook">Facebook</option>
              <option value="instagram">Instagram</option>
              <option value="tiktok">TikTok</option>
              <option value="x">X</option>
              <option value="linkedin">LinkedIn</option>
            </select>
          </div>
          <button
            disabled={creating || !groups.length}
            className="glow-btn inline-flex items-center gap-1.5 rounded bg-primary px-3 py-2 text-sm font-medium text-primary-fg transition-colors duration-100 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {creating ? "Creando..." : "Crear perfil"}
          </button>
          {!groups.length && (
            <p className="text-xs text-warning">Crea un grupo primero en la pestaña Grupos.</p>
          )}
        </form>
      </Card>

      <Card className="flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-50 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar por nombre..."
            className="w-full rounded-lg border border-hairline bg-page py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary"
          />
        </div>
        <select
          value={groupFilter}
          onChange={(e) => updateGroupFilter(e.target.value)}
          className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="">Todos los grupos</option>
          {groups.map((g) => (
            <option key={g._id} value={g.adsPowerGroupId}>{g.name}</option>
          ))}
        </select>
        <select
          value={platformFilter}
          onChange={(e) => updatePlatformFilter(e.target.value)}
          className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="">Todas las plataformas</option>
          <option value="facebook">Facebook</option>
          <option value="instagram">Instagram</option>
          <option value="tiktok">TikTok</option>
          <option value="x">X</option>
          <option value="linkedin">LinkedIn</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => updateStatusFilter(e.target.value)}
          className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="">Todos los estados</option>
          <option value="active">active</option>
          <option value="inactive">inactive</option>
          <option value="unknown">unknown</option>
        </select>
        <select
          value={genderFilter}
          onChange={(e) => updateGenderFilter(e.target.value)}
          className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="">Todos los géneros</option>
          <option value="hombre">Hombre</option>
          <option value="mujer">Mujer</option>
        </select>
        {availableTags.length > 0 && (
          <select
            value={tagFilter}
            onChange={(e) => updateTagFilter(e.target.value)}
            className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
          >
            <option value="">Todas las etiquetas</option>
            {availableTags.map((t) => (
              <option key={t.name} value={t.name}>{t.name}</option>
            ))}
          </select>
        )}
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={0}
            value={ageMinFilter}
            onChange={(e) => updateAgeMinFilter(e.target.value)}
            placeholder="Edad min"
            className="w-24 rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <span className="text-xs text-ink-muted">–</span>
          <input
            type="number"
            min={0}
            value={ageMaxFilter}
            onChange={(e) => updateAgeMaxFilter(e.target.value)}
            placeholder="Edad max"
            className="w-24 rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        {hasFilters && (
          <button type="button" onClick={clearFilters} className="text-xs text-ink-muted underline hover:text-ink">
            Limpiar filtros
          </button>
        )}
      </Card>

      {selectedCount > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
          <p className="text-sm font-medium text-ink">
            {selectedCount} perfil{selectedCount === 1 ? "" : "es"} seleccionado{selectedCount === 1 ? "" : "s"}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              disabled={bulkDeleting}
              className="rounded-lg border border-hairline px-3 py-2 text-sm font-medium transition-colors hover:bg-page disabled:opacity-40"
            >
              Limpiar seleccion
            </button>
            <button
              type="button"
              onClick={deleteSelectedProfiles}
              disabled={bulkDeleting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-critical/20 bg-critical/10 px-3 py-2 text-sm font-medium text-critical transition-colors hover:bg-critical/15 disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" />
              {bulkDeleting ? "Eliminando..." : "Eliminar seleccionados"}
            </button>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-hairline text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="w-12 px-4 py-3 font-medium">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    aria-label="Seleccionar perfiles visibles"
                    checked={allVisibleSelected}
                    disabled={loading || bulkDeleting || profiles.length === 0}
                    onChange={(e) => toggleVisibleSelection(e.target.checked)}
                    className="h-4 w-4 rounded border-hairline accent-primary disabled:opacity-40"
                  />
                </th>
                <th className="px-4 py-3 font-medium">Nombre</th>
                <th className="px-4 py-3 font-medium">Grupo</th>
                <th className="px-4 py-3 font-medium">Plataforma</th>
                <th className="px-4 py-3 font-medium">Edad/Género</th>
                <th className="px-4 py-3 font-medium">Etiquetas</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading && profiles.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-ink-muted">Cargando...</td></tr>
              ) : profiles.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-ink-muted">Sin perfiles que coincidan.</td></tr>
              ) : (
                profiles.map((p) => (
                  <tr key={p._id} className="border-t border-hairline transition-colors hover:bg-page/60">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Seleccionar ${p.name}`}
                        checked={selectedIdSet.has(p._id)}
                        disabled={bulkDeleting || busyId === p._id}
                        onChange={(e) => toggleProfileSelection(p._id, e.target.checked)}
                        className="h-4 w-4 rounded border-hairline accent-primary disabled:opacity-40"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-ink">{p.name}</td>
                    <td className="px-4 py-3 text-ink-secondary">{groupName(p.groupId)}</td>
                    <td className="px-4 py-3 text-ink-secondary">{p.platform || "-"}</td>
                    <td className="px-4 py-3 text-ink-secondary">
                      {p.age ?? "—"}{p.gender ? ` · ${p.gender === "hombre" ? "Hombre" : "Mujer"}` : ""}
                    </td>
                    <td className="px-4 py-3">
                      {p.tags && p.tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {p.tags.map((t) => (
                            <TagBadge key={t.name} tag={t} />
                          ))}
                        </div>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={p.lastStatus} /></td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          disabled={bulkDeleting || busyId === p._id}
                          onClick={() => startProfile(p._id)}
                          className="rounded-lg border border-hairline px-2.5 py-1 text-xs font-medium transition-colors hover:bg-page disabled:opacity-40"
                        >
                          Iniciar
                        </button>
                        <button
                          disabled={bulkDeleting || busyId === p._id}
                          onClick={() => stopProfile(p._id)}
                          className="rounded-lg border border-hairline px-2.5 py-1 text-xs font-medium transition-colors hover:bg-page disabled:opacity-40"
                        >
                          Detener
                        </button>
                        <Link
                          href={`/tasks/new?profileId=${p._id}`}
                          className={`rounded-lg border border-hairline px-2.5 py-1 text-xs font-medium transition-colors hover:bg-page ${
                            bulkDeleting ? "pointer-events-none opacity-40" : ""
                          }`}
                        >
                          + Tarea
                        </Link>
                        <button
                          disabled={bulkDeleting || busyId === p._id}
                          onClick={() => deleteProfile(p._id)}
                          className="rounded-lg border border-critical/20 px-2.5 py-1 text-xs font-medium text-critical transition-colors hover:bg-critical/10 disabled:opacity-40"
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-hairline px-2">
          <Pagination page={page} totalPages={totalPages} totalItems={total} pageSize={PAGE_SIZE} onChange={setPage} />
        </div>
      </Card>
    </div>
  );
}
