"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Play, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import StatusBadge from "@/components/StatusBadge";
import Card from "@/components/Card";

type Task = {
  _id: string;
  name: string;
  type: string;
  status: string;
  steps: unknown[];
  error?: string;
  profileId: { _id: string; name: string } | null;
  scheduledAt: string;
  startedAt?: string;
  finishedAt?: string;
};

type Log = {
  _id: string;
  level: "info" | "warn" | "error";
  message: string;
  createdAt: string;
};

const LOG_COLOR: Record<Log["level"], string> = {
  error: "border-critical text-critical",
  warn: "border-warning text-warning",
  info: "border-hairline text-ink-secondary",
};

export default function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [task, setTask] = useState<Task | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function load() {
    try {
      const data = await apiFetch<{ task: Task; logs: Log[] }>(`/api/tasks/${id}`);
      setTask(data.task);
      setLogs(data.logs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      await apiFetch(`/api/tasks/${id}/run`, { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  if (!task) {
    return <p className="text-sm text-ink-muted">{error ?? "Cargando..."}</p>;
  }

  const busy = task.status === "running" || task.status === "queued";

  return (
    <div className="flex animate-fade-in-up flex-col gap-6">
      <div>
        <Link href="/tasks" className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Tareas
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-ink">{task.name}</h1>
          <StatusBadge status={task.status} />
        </div>
        <p className="mt-1 text-sm text-ink-secondary">
          Perfil: {task.profileId?.name ?? "—"} · Tipo: {task.type}
        </p>
      </div>

      {error && <p className="rounded-xl bg-critical/10 p-3 text-sm text-critical">{error}</p>}
      {task.error && (
        <p className="rounded-xl bg-critical/10 p-3 text-sm text-critical">Último error: {task.error}</p>
      )}

      <button
        disabled={running || busy}
        onClick={run}
        className="glow-btn inline-flex w-fit items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md disabled:pointer-events-none disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        {busy ? "En proceso..." : "Ejecutar ahora"}
      </button>

      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold text-ink">Steps</h2>
        <pre className="overflow-x-auto rounded-lg bg-page p-3 text-xs text-ink-secondary">
          {JSON.stringify(task.steps, null, 2)}
        </pre>
      </Card>

      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold text-ink">Logs</h2>
        <div className="flex max-h-96 flex-col gap-1 overflow-y-auto font-mono text-xs">
          {logs.length === 0 ? (
            <p className="text-ink-muted">Sin logs aún.</p>
          ) : (
            logs.map((l) => (
              <div key={l._id} className={`border-l-2 pl-2 ${LOG_COLOR[l.level]}`}>
                [{new Date(l.createdAt).toLocaleTimeString()}] {l.message}
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
