"use client";

import { useEffect, useState } from "react";
import { Plus, ShieldCheck, KeyRound, Trash2, MapPin } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import Card from "@/components/Card";
import { useSession } from "@/lib/session";

type Role = "admin" | "operador";

type User = {
  _id: string;
  username: string;
  role: Role;
  groupIds: string[];
  active: boolean;
  createdAt?: string;
  lastLoginAt?: string | null;
  lastSeenAt?: string | null;
  lastLoginIp?: string;
  lastLoginLocation?: string;
  campaignCount?: number;
  lastCampaignAt?: string | null;
};

type Group = { _id: string; adsPowerGroupId: string; name: string };

export default function UsersPage() {
  const session = useSession();
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Hora de la última carga: los "hace cuánto" se calculan contra esto.
  const [now, setNow] = useState(0);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("operador");
  const [newGroupIds, setNewGroupIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [usersData, groupsData] = await Promise.all([
        apiFetch<{ users: User[] }>("/api/users"),
        apiFetch<{ groups: Group[] }>("/api/groups?all=true"),
      ]);
      setUsers(usersData.users);
      setNow(Date.now());
      setGroups(groupsData.groups);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    await run(async () => {
      await apiFetch("/api/users", {
        method: "POST",
        body: JSON.stringify({ username, password, role, groupIds: newGroupIds }),
      });
      setUsername("");
      setPassword("");
      setRole("operador");
      setNewGroupIds([]);
    });
    setCreating(false);
  }

  function patch(id: string, body: Record<string, unknown>) {
    return run(() => apiFetch(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }));
  }

  function toggleGroup(user: User, groupId: string) {
    const next = user.groupIds.includes(groupId)
      ? user.groupIds.filter((g) => g !== groupId)
      : [...user.groupIds, groupId];
    return patch(user._id, { groupIds: next });
  }

  async function resetPassword(user: User) {
    const value = window.prompt(`Nueva contraseña para "${user.username}"`);
    if (!value) return;
    await patch(user._id, { password: value });
  }

  /**
   * Borrar en dos tiempos.
   *
   * Si el usuario tiene trabajo hecho, el servidor frena y dice qué tiene. Ahí
   * se ofrece pasárselo a tu cuenta: es la única salida real, porque las
   * campañas y los bancos de otro no se ven desde ninguna pantalla y no habría
   * forma de vaciarlos antes de borrarlo.
   */
  async function remove(user: User) {
    if (!window.confirm(`¿Borrar a "${user.username}"? Esto no se puede deshacer.`)) return;

    setError(null);
    try {
      await apiFetch(`/api/users/${user._id}`, { method: "DELETE" });
      await load();
      return;
    } catch (e) {
      if (!(e instanceof ApiError) || !e.data.canTransfer) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }

      const detail = (e.data.owned as { label: string }[]).map((o) => o.label).join(", ");

      const ok = window.confirm(
        `"${user.username}" tiene ${detail}.\n\n` +
          `Aceptar: eso pasa a tu cuenta y el usuario se borra.\n` +
          `Cancelar: no se borra (podés darlo de baja en su lugar).`,
      );
      if (!ok) return;

      await run(() => apiFetch(`/api/users/${user._id}?transfer=1`, { method: "DELETE" }));
    }
  }

  return (
    <div className="flex animate-fade-in-up flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Usuarios</h1>
        <p className="label-mono-sm mt-1">
          {users.length} en total · cada uno ve solo sus campañas y los grupos que le asignes
        </p>
      </div>

      {error && <p className="rounded-lg bg-critical/10 p-3 text-sm text-critical">{error}</p>}

      <Card className="p-4">
        <form onSubmit={createUser} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-ink-muted">Usuario</label>
              <input
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoCapitalize="none"
                spellCheck={false}
                placeholder="ej. maria"
                className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-ink-muted">Contraseña</label>
              <input
                required
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="mínimo 10 caracteres"
                className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-ink-muted">Rol</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none focus:border-primary"
              >
                <option value="operador">Operador</option>
                <option value="admin">Administrador</option>
              </select>
            </div>
            <button
              disabled={creating}
              className="glow-btn inline-flex items-center gap-1.5 rounded bg-primary px-3 py-2 text-sm font-medium text-primary-fg transition-colors duration-100 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {creating ? "Creando..." : "Crear usuario"}
            </button>
          </div>

          {/* El administrador ve todos los grupos por definición, así que
              elegirlos solo tiene sentido para un operador. */}
          {role === "operador" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-ink-muted">Grupos a los que tendrá acceso</label>
              <GroupChips
                groups={groups}
                selected={newGroupIds}
                onToggle={(gid) =>
                  setNewGroupIds((prev) =>
                    prev.includes(gid) ? prev.filter((g) => g !== gid) : [...prev, gid],
                  )
                }
              />
            </div>
          )}
        </form>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-hairline text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Usuario</th>
                <th className="px-4 py-3 font-medium">Rol</th>
                <th className="px-4 py-3 font-medium">Grupos</th>
                <th className="px-4 py-3 font-medium">Último login</th>
                <th className="px-4 py-3 font-medium">Última actividad</th>
                <th className="px-4 py-3 font-medium">Campañas</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {loading && users.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-ink-muted">
                    Cargando...
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u._id} className="border-t border-hairline align-top">
                    <td className="px-4 py-3 font-medium text-ink">
                      {u.username}
                      {session?.id === u._id && <span className="ml-1.5 text-xs text-ink-muted">(vos)</span>}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={u.role}
                        onChange={(e) => patch(u._id, { role: e.target.value })}
                        className="rounded-lg border border-hairline bg-page px-2 py-1 text-xs outline-none focus:border-primary"
                      >
                        <option value="operador">Operador</option>
                        <option value="admin">Administrador</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      {u.role === "admin" ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-ink-secondary">
                          <ShieldCheck className="h-3.5 w-3.5 text-steel" /> Todos
                        </span>
                      ) : (
                        <GroupChips
                          groups={groups}
                          selected={u.groupIds}
                          onToggle={(gid) => toggleGroup(u, gid)}
                        />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <When date={u.lastLoginAt} now={now} />
                      {(u.lastLoginLocation || u.lastLoginIp) && (
                        <span
                          className="mt-0.5 flex items-center gap-1 whitespace-nowrap text-xs text-ink-muted"
                          title="Aproximada, según la IP"
                        >
                          <MapPin className="h-3 w-3 shrink-0" />
                          {u.lastLoginLocation || "Ubicación desconocida"}
                          {u.lastLoginIp && <span className="opacity-70">· {u.lastLoginIp}</span>}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <When date={u.lastSeenAt} now={now} live />
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-ink">{u.campaignCount ?? 0}</span>
                      {u.lastCampaignAt && (
                        <span className="block text-xs text-ink-muted">
                          última {relative(u.lastCampaignAt, now)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => patch(u._id, { active: !u.active })}
                        className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                          u.active
                            ? "border-hairline text-ink-secondary hover:bg-page"
                            : "border-critical/40 bg-critical/10 text-critical"
                        }`}
                      >
                        {u.active ? "Activo" : "De baja"}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => resetPassword(u)}
                          title="Cambiar contraseña"
                          className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-page hover:text-ink"
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(u)}
                          title="Borrar usuario"
                          className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-critical/10 hover:text-critical"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/** "hace 5 min", "hace 3 días"... */
function relative(iso: string, now: number): string {
  const diff = now - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `hace ${d} ${d === 1 ? "día" : "días"}`;
  const m = Math.round(d / 30);
  return `hace ${m} ${m === 1 ? "mes" : "meses"}`;
}

/**
 * Fecha y hora completas, con el "hace cuánto" debajo. Con `live`, un punto
 * verde si hubo actividad en los últimos 10 minutos: lastSeenAt se anota cada
 * cinco, así que eso es "lo está usando ahora".
 */
function When({ date, now, live }: { date?: string | null; now: number; live?: boolean }) {
  if (!date) return <span className="text-xs text-ink-muted">Nunca</span>;
  const online = live && now - new Date(date).getTime() < 10 * 60_000;
  return (
    <div className="whitespace-nowrap">
      <span className="text-xs text-ink">
        {new Date(date).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}
      </span>
      <span className="flex items-center gap-1 text-xs text-ink-muted">
        {online && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
        {online ? "en línea" : relative(date, now)}
      </span>
    </div>
  );
}

function GroupChips({
  groups,
  selected,
  onToggle,
}: {
  groups: Group[];
  selected: string[];
  onToggle: (groupId: string) => void;
}) {
  if (groups.length === 0) {
    return <p className="text-xs text-ink-muted">No hay grupos. Sincronizá con AdsPower primero.</p>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {groups.map((g) => {
        const on = selected.includes(g.adsPowerGroupId);
        return (
          <button
            key={g._id}
            type="button"
            onClick={() => onToggle(g.adsPowerGroupId)}
            className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
              on
                ? "border-primary/45 bg-primary/10 text-ink"
                : "border-hairline text-ink-muted hover:bg-page hover:text-ink-secondary"
            }`}
          >
            {g.name}
          </button>
        );
      })}
    </div>
  );
}
