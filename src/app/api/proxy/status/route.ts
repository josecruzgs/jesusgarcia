import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { decodo, type DecodoSubscription } from "@/lib/decodo/client";
import { withAuth } from "@/lib/apiHandler";
import { allowedGroupFilter, type SessionUser } from "@/lib/auth/dal";
import ProfileModel from "@/lib/models/Profile";
import TaskModel from "@/lib/models/Task";

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

// Los nombres de campo exactos de la respuesta real no están confirmados
// todavía (la documentación pública no los detalla del todo) — se prueban
// varios alias comunes hasta que se confirme contra una respuesta real.
function normalize(sub: DecodoSubscription) {
  const limit = num(sub.traffic_limit) ?? num(sub.trafficLimit);
  const used = num(sub.traffic_used) ?? num(sub.trafficUsed) ?? num(sub.used_traffic);
  const remaining = num(sub.traffic_remaining) ?? num(sub.remaining_traffic) ?? num(sub.remaining);
  const available = remaining ?? (limit !== null && used !== null ? limit - used : null);

  return {
    serviceType: sub.service_type ?? sub.serviceType ?? null,
    limitGB: limit,
    usedGB: used,
    availableGB: available,
    percentUsed: limit && limit > 0 && used !== null ? Math.round((used / limit) * 1000) / 10 : null,
    validFrom: sub.valid_from ?? sub.validFrom ?? null,
    validUntil: sub.valid_until ?? sub.validUntil ?? null,
    raw: sub,
  };
}

const PROXY_ERROR_RE =
  /proxy|tunnel|407|ERR_|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|net::|page\.goto: Timeout|navigating to|AdsPower API HTTP/i;

// El saldo del proxy es global (una sola cuenta de Decodo para todos), pero
// las cifras locales no: cada quien ve sus perfiles visibles y sus tareas.
async function getLocalStats(user: SessionUser) {
  await dbConnect();

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const visibleProfiles = allowedGroupFilter(user);
  const proxyIssueFilter = {
    ownerId: user.objectId,
    status: "failed",
    error: PROXY_ERROR_RE,
  };

  const [profileCount, activeProfileCount, recentProxyIssueCount, lastProxyIssue] = await Promise.all([
    ProfileModel.countDocuments(visibleProfiles),
    ProfileModel.countDocuments({ ...visibleProfiles, lastStatus: "active" }),
    TaskModel.countDocuments({ ...proxyIssueFilter, updatedAt: { $gte: since24h } }),
    TaskModel.findOne(proxyIssueFilter).sort({ updatedAt: -1 }).select("name type error updatedAt").lean(),
  ]);

  return {
    profileCount,
    activeProfileCount,
    recentProxyIssueCount,
    lastProxyIssue: lastProxyIssue
      ? {
          name: lastProxyIssue.name,
          type: lastProxyIssue.type,
          error: lastProxyIssue.error,
          updatedAt: lastProxyIssue.updatedAt,
        }
      : null,
  };
}

export const GET = withAuth(async (user) => {
  const local = await getLocalStats(user);

  try {
    const data = await decodo.getSubscriptions();
    const subscriptions = Array.isArray(data) ? data : [data];
    const normalizedSubscriptions = subscriptions.map(normalize);

    return NextResponse.json({
      subscriptions: normalizedSubscriptions,
      smartproxy: {
        connected: true,
        balanceAvailable: normalizedSubscriptions.length > 0,
      },
      local,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("SMARTPROXY_API_KEY") || message.includes("DECODO_API_KEY") || message.includes("Decodo API HTTP")) {
      return NextResponse.json({
        subscriptions: [],
        unavailable: true,
        reason: message,
        smartproxy: {
          connected: false,
          balanceAvailable: false,
        },
        local,
      });
    }
    throw err;
  }
});
