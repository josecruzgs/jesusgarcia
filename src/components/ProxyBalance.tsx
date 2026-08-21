"use client";

import { useEffect, useState } from "react";
import { Cloud, AlertTriangle, ShieldCheck, Users } from "lucide-react";

type Subscription = {
  serviceType: string | null;
  limitGB: number | null;
  usedGB: number | null;
  availableGB: number | null;
  percentUsed: number | null;
  validUntil: string | null;
};

type ProxyStatusResponse = {
  subscriptions?: Subscription[];
  unavailable?: boolean;
  reason?: string;
  error?: string;
  smartproxy?: {
    connected: boolean;
    balanceAvailable: boolean;
  };
  local?: {
    profileCount: number;
    activeProfileCount: number;
    recentProxyIssueCount: number;
    lastProxyIssue: {
      name: string;
      type: string;
      error?: string;
      updatedAt?: string;
    } | null;
  };
};

// Pinned al fondo de la sidebar (fuera del <nav> con scroll, así se queda
// pegado a la pantalla) — muestra el saldo de proxy (Decodo) más bajo entre
// las suscripciones activas, para detectar rápido cuando se está por acabar
// (el problema real que nos bloqueó una campaña completa una vez).
export default function ProxyBalance({ collapsed }: { collapsed: boolean }) {
  const [subs, setSubs] = useState<Subscription[] | null>(null);
  const [status, setStatus] = useState<ProxyStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/proxy/status");
        const data = (await res.json()) as ProxyStatusResponse;
        if (cancelled) return;
        if (!res.ok) {
          setError(typeof data.error === "string" ? data.error : "Error consultando el proxy");
          setSubs(null);
        } else {
          setError(null);
          setStatus(data);
          setSubs(data.subscriptions ?? []);
        }
      } catch {
        if (!cancelled) setError("No se pudo consultar el proxy");
      }
    }

    load();
    const interval = setInterval(load, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (error) {
    return (
      <div className="border-t border-hairline px-3 py-3">
        <div
          title={error}
          className={`flex items-center gap-2 text-xs text-critical ${collapsed ? "justify-center" : ""}`}
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {!collapsed && <span className="truncate">Proxy: sin datos</span>}
        </div>
      </div>
    );
  }

  if (subs === null || status === null) return null;
  if (subs.length === 0) {
    const local = status.local;
    const issueCount = local?.recentProxyIssueCount ?? 0;
    const smartproxyConnected = status.smartproxy?.connected ?? !status.unavailable;
    const statusText = smartproxyConnected ? "Conectado" : "Sin API";
    const statusColor = issueCount > 0 ? "text-warning" : smartproxyConnected ? "text-success" : "text-ink-muted";
    const title =
      issueCount > 0
        ? `${issueCount} fallo(s) de red/proxy en 24h. Ultimo: ${local?.lastProxyIssue?.name ?? "sin detalle"}`
        : smartproxyConnected
          ? "Smartproxy conectado. Static/ISP no entrega balance por API."
          : status.reason ?? "Smartproxy sin datos";

    if (collapsed) {
      return (
        <div className="flex justify-center border-t border-hairline py-3">
          <span
            title={title}
            className={`flex h-8 w-8 items-center justify-center rounded-full bg-page ${statusColor}`}
          >
            <Cloud className="h-4 w-4" />
          </span>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-2 border-t border-hairline px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
            <Cloud className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Smartproxy</span>
          </span>
          <span className={`shrink-0 text-xs font-medium ${statusColor}`}>{statusText}</span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex min-w-0 items-center gap-1.5 text-ink-muted" title="Perfiles sincronizados">
            <Users className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Perfiles</span>
          </div>
          <span className="text-right font-medium text-ink">{local?.profileCount ?? 0}</span>

          <div className="flex min-w-0 items-center gap-1.5 text-ink-muted" title="Fallos de red o proxy en 24h">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Red 24h</span>
          </div>
          <span className={`text-right font-medium ${issueCount > 0 ? "text-warning" : "text-success"}`}>
            {issueCount}
          </span>
        </div>

        {issueCount > 0 && local?.lastProxyIssue && (
          <span className="truncate text-[11px] text-ink-muted" title={local.lastProxyIssue.error}>
            Ultimo: {local.lastProxyIssue.name}
          </span>
        )}
      </div>
    );
  }

  // La suscripción con menos margen disponible es la más urgente de vigilar.
  const sub = [...subs].sort((a, b) => (a.percentUsed ?? 0) < (b.percentUsed ?? 0) ? 1 : -1)[0];
  const pct = sub.percentUsed ?? 0;
  const barColor = pct >= 90 ? "bg-critical" : pct >= 70 ? "bg-warning" : "bg-success";
  const textColor = pct >= 90 ? "text-critical" : pct >= 70 ? "text-warning" : "text-ink-secondary";

  const availableLabel =
    sub.availableGB !== null ? `${sub.availableGB.toFixed(sub.availableGB < 10 ? 2 : 1)} GB` : "—";

  if (collapsed) {
    return (
      <div className="flex justify-center border-t border-hairline py-3">
        <span
          title={`Proxy disponible: ${availableLabel}`}
          className={`flex h-8 w-8 items-center justify-center rounded-full bg-page ${textColor}`}
        >
          <Cloud className="h-4 w-4" />
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 border-t border-hairline px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs text-ink-muted">
          <Cloud className="h-3.5 w-3.5" />
          Proxy disponible
        </span>
        <span className={`text-xs font-medium ${textColor}`}>{availableLabel}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--seq-100)]">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${barColor}`}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
    </div>
  );
}
