"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import StatusBadge from "@/components/StatusBadge";
import Pagination from "@/components/Pagination";
import type { Tag } from "@/components/TagBadge";

const PAGE_SIZE = 20;

export type PickerGroup = { _id: string; adsPowerGroupId: string; name: string };
export type PickerProfile = {
  _id: string;
  name: string;
  groupId: string;
  platform: string;
  lastStatus: string;
  age?: number | null;
  gender?: "hombre" | "mujer" | null;
  tags?: Tag[];
};

export default function ProfilePicker({
  profiles,
  groups,
  loading,
  selected,
  onChange,
}: {
  profiles: PickerProfile[];
  groups: PickerGroup[];
  loading: boolean;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [platformFilter, setPlatformFilter] = useState("");
  const [genderFilter, setGenderFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [ageMinFilter, setAgeMinFilter] = useState("");
  const [ageMaxFilter, setAgeMaxFilter] = useState("");
  const [page, setPage] = useState(1);

  function groupName(groupId: string) {
    return groups.find((g) => g.adsPowerGroupId === groupId)?.name ?? groupId;
  }

  const ageMin = ageMinFilter ? Number(ageMinFilter) : undefined;
  const ageMax = ageMaxFilter ? Number(ageMaxFilter) : undefined;

  const availableTags = useMemo(() => {
    const seen = new Map<string, Tag>();
    for (const p of profiles) {
      for (const t of p.tags ?? []) if (!seen.has(t.name)) seen.set(t.name, t);
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [profiles]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return profiles.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (groupFilter && p.groupId !== groupFilter) return false;
      if (platformFilter && p.platform !== platformFilter) return false;
      if (genderFilter && p.gender !== genderFilter) return false;
      if (tagFilter && !(p.tags ?? []).some((t) => t.name === tagFilter)) return false;
      if (ageMin !== undefined && (p.age == null || p.age < ageMin)) return false;
      if (ageMax !== undefined && (p.age == null || p.age > ageMax)) return false;
      return true;
    });
  }, [profiles, search, groupFilter, platformFilter, genderFilter, tagFilter, ageMin, ageMax]);

  useEffect(() => {
    setPage(1);
  }, [search, groupFilter, platformFilter, genderFilter, tagFilter, ageMin, ageMax]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  function selectAllFiltered() {
    const next = new Set(selected);
    filtered.forEach((p) => next.add(p._id));
    onChange(next);
  }

  // El check de la cabecera trabaja solo sobre la página que se está viendo y
  // suma a lo que ya había elegido: así se puede ir página por página, marcando
  // unas y saltándose otras, sin perder lo seleccionado antes.
  const pageSelectedCount = paged.filter((p) => selected.has(p._id)).length;
  const allPageSelected = paged.length > 0 && pageSelectedCount === paged.length;

  // `indeterminate` (la rayita del "algunos, no todos") no existe como atributo
  // de HTML, solo como propiedad del nodo — hay que ponerla por ref.
  const pageCheckboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (pageCheckboxRef.current) {
      pageCheckboxRef.current.indeterminate = pageSelectedCount > 0 && !allPageSelected;
    }
  }, [pageSelectedCount, allPageSelected]);

  function togglePage() {
    const next = new Set(selected);
    if (allPageSelected) paged.forEach((p) => next.delete(p._id));
    else paged.forEach((p) => next.add(p._id));
    onChange(next);
  }

  function clearSelection() {
    onChange(new Set());
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-xs text-ink-muted">
          Candidatos elegidos: <span className="font-medium text-ink">{selected.size}</span>
        </label>
        <div className="flex flex-wrap gap-3">
          {/* Ahora que la cabecera tiene un check por página, el nombre viejo
              ("seleccionar visibles") quedaba ambiguo justo al lado: éste toma
              todas las páginas que pasan los filtros, no solo la que se ve. */}
          <button
            type="button"
            onClick={selectAllFiltered}
            title={`Selecciona los ${filtered.length} de todas las páginas`}
            className="text-xs text-primary underline"
          >
            seleccionar todos los filtrados ({filtered.length})
          </button>
          <button type="button" onClick={clearSelection} className="text-xs text-critical underline">
            limpiar selección
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-50 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre..."
            className="w-full rounded-lg border border-hairline bg-page py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary"
          />
        </div>
        <select
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
          className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="">Todos los grupos</option>
          {groups.map((g) => (
            <option key={g._id} value={g.adsPowerGroupId}>{g.name}</option>
          ))}
        </select>
        <select
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value)}
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
          value={genderFilter}
          onChange={(e) => setGenderFilter(e.target.value)}
          className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="">Todos los géneros</option>
          <option value="hombre">Hombre</option>
          <option value="mujer">Mujer</option>
        </select>
        {availableTags.length > 0 && (
          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
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
            onChange={(e) => setAgeMinFilter(e.target.value)}
            placeholder="Edad min"
            className="w-24 rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <span className="text-xs text-ink-muted">–</span>
          <input
            type="number"
            min={0}
            value={ageMaxFilter}
            onChange={(e) => setAgeMaxFilter(e.target.value)}
            placeholder="Edad max"
            className="w-24 rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-hairline">
        {loading ? (
          <p className="p-4 text-sm text-ink-muted">Cargando perfiles...</p>
        ) : filtered.length === 0 ? (
          <p className="p-4 text-sm text-ink-muted">Sin perfiles que coincidan.</p>
        ) : (
          <>
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b border-hairline bg-surface text-left text-xs uppercase tracking-wide text-ink-muted">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <input
                        ref={pageCheckboxRef}
                        type="checkbox"
                        checked={allPageSelected}
                        onChange={togglePage}
                        title={
                          allPageSelected
                            ? `Quitar los ${paged.length} de esta página`
                            : `Seleccionar los ${paged.length} de esta página`
                        }
                        aria-label="Seleccionar los perfiles de esta página"
                        className="h-4 w-4 cursor-pointer align-middle accent-primary"
                      />
                    </th>
                    <th className="px-3 py-2 font-medium">Nombre</th>
                    <th className="px-3 py-2 font-medium">Grupo</th>
                    <th className="px-3 py-2 font-medium">Plataforma</th>
                    <th className="px-3 py-2 font-medium">Edad/Género</th>
                    <th className="px-3 py-2 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((p) => {
                    const checked = selected.has(p._id);
                    return (
                      <tr
                        key={p._id}
                        onClick={() => toggle(p._id)}
                        className={`cursor-pointer border-t border-hairline transition-colors ${
                          checked ? "bg-primary/5" : "hover:bg-page"
                        }`}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(p._id)}
                            onClick={(e) => e.stopPropagation()}
                            className="h-4 w-4 accent-primary"
                          />
                        </td>
                        <td className="max-w-48 px-3 py-2 font-medium text-ink">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate">{p.name}</span>
                            {(p.tags ?? []).map((t) => (
                              <span
                                key={t.name}
                                title={t.name}
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ backgroundColor: t.color || "#8a8a8a" }}
                              />
                            ))}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-ink-muted">{groupName(p.groupId)}</td>
                        <td className="px-3 py-2 text-ink-muted">{p.platform || "-"}</td>
                        <td className="px-3 py-2 text-ink-muted">
                          {p.age || p.gender
                            ? `${p.age ?? "—"}${p.gender ? ` · ${p.gender === "hombre" ? "Hombre" : "Mujer"}` : ""}`
                            : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={p.lastStatus} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t border-hairline px-2">
              <Pagination page={page} totalPages={totalPages} totalItems={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
