"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

type ExistingCampaign = { _id: string; name: string; taskCount: number };

export default function ExistingCampaignPicker({
  type,
  mode,
  onModeChange,
  campaignId,
  onCampaignIdChange,
}: {
  type: string;
  mode: "new" | "existing";
  onModeChange: (mode: "new" | "existing") => void;
  campaignId: string;
  onCampaignIdChange: (id: string) => void;
}) {
  const [campaigns, setCampaigns] = useState<ExistingCampaign[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (mode !== "existing") return;
    setLoading(true);
    apiFetch<{ campaigns: ExistingCampaign[] }>(`/api/campaigns?type=${type}&pageSize=100`)
      .then((data) => setCampaigns(data.campaigns))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [mode, type]);

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs text-ink-muted">Campaña</label>
      <div className="inline-flex w-fit rounded-lg border border-hairline bg-page p-1 text-sm">
        <button
          type="button"
          onClick={() => onModeChange("new")}
          className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
            mode === "new" ? "bg-primary text-primary-fg" : "text-ink-secondary hover:text-ink"
          }`}
        >
          Nueva campaña
        </button>
        <button
          type="button"
          onClick={() => onModeChange("existing")}
          className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
            mode === "existing" ? "bg-primary text-primary-fg" : "text-ink-secondary hover:text-ink"
          }`}
        >
          Agregar a campaña existente
        </button>
      </div>

      {mode === "existing" && (
        <select
          required
          value={campaignId}
          onChange={(e) => onCampaignIdChange(e.target.value)}
          className="rounded-lg border border-hairline bg-page px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
        >
          <option value="">{loading ? "Cargando campañas..." : "Elige una campaña..."}</option>
          {campaigns.map((c) => (
            <option key={c._id} value={c._id}>
              {c.name} ({c.taskCount} tareas)
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
