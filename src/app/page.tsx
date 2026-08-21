import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Users,
  FolderKanban,
  Clock,
  RefreshCw,
  Heart,
  MessageSquare,
  TrendingUp,
  CalendarCheck,
  Radar,
  Radio,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { dbConnect } from "@/lib/mongodb";
import { currentUser, allowedGroupFilter, allowedGroupIdFilter, type SessionUser } from "@/lib/auth/dal";
import Panel from "@/components/ui/Panel";
import SubHead from "@/components/ui/SubHead";
import ElementIcon from "@/components/ui/ElementIcon";
import { ELEMENT_ORDER, ELEMENT_COLOR, ELEMENT_META } from "@/lib/elements";

// Se conecta a Mongo en cada request; evitamos que Next intente
// pre-renderizar esta página en build time (no hay Mongo disponible ahí).
export const dynamic = "force-dynamic";
import ProfileModel from "@/lib/models/Profile";
import GroupModel from "@/lib/models/Group";
import TaskModel from "@/lib/models/Task";
import CommentModel from "@/lib/models/Comment";
import StatCard from "@/components/StatCard";
import Meter from "@/components/Meter";
import CampaignTrendChart, { type TrendPoint } from "@/components/charts/CampaignTrendChart";
import TopProfilesChart, { type ProfileRow } from "@/components/charts/TopProfilesChart";
import { getListeningDigest } from "@/lib/listening/dashboard";

const TREND_DAYS = 14;

// Un like a un comentario cuenta como like en las métricas: para el reporte de
// campaña es la misma acción, solo cambia dónde cae.
const LIKE_TYPES = ["like", "likecomment"];

// Este dashboard es personal: cuenta el trabajo del usuario que lo mira y los
// perfiles y grupos que tiene permitidos. Es un Server Component, así que no
// pasa por `withAuth` —eso envuelve rutas de API— y el alcance se resuelve acá
// con el mismo usuario y los mismos filtros que usa el resto del sistema.
async function getStats(user: SessionUser) {
  await dbConnect();

  const mine = { ownerId: user.objectId };
  const now = new Date();
  const since14 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (TREND_DAYS - 1)));
  const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const d14 = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const [
    profiles,
    groups,
    pendingOrQueued,
    running,
    failed,
    success,
    likeSuccess,
    likeFailed,
    commentSuccess,
    commentFailed,
    last7,
    prev7,
    dailyRows,
    topRows,
    commentTotal,
    commentAvailable,
  ] = await Promise.all([
    // Perfiles y grupos son el sustrato compartido: se cuentan los que este
    // usuario puede ver, no los suyos (no le pertenecen a nadie).
    ProfileModel.countDocuments(allowedGroupFilter(user)),
    GroupModel.countDocuments(allowedGroupIdFilter(user)),
    TaskModel.countDocuments({ ...mine, status: { $in: ["pending", "queued"] } }),
    TaskModel.countDocuments({ ...mine, status: "running" }),
    TaskModel.countDocuments({ ...mine, status: "failed" }),
    TaskModel.countDocuments({ ...mine, status: "success" }),
    TaskModel.countDocuments({ ...mine, type: { $in: LIKE_TYPES }, status: "success" }),
    TaskModel.countDocuments({ ...mine, type: { $in: LIKE_TYPES }, status: "failed" }),
    TaskModel.countDocuments({ ...mine, type: "comment", status: "success" }),
    TaskModel.countDocuments({ ...mine, type: "comment", status: "failed" }),
    TaskModel.countDocuments({ ...mine, status: "success", finishedAt: { $gte: d7 } }),
    TaskModel.countDocuments({ ...mine, status: "success", finishedAt: { $gte: d14, $lt: d7 } }),
    TaskModel.aggregate([
      {
        $match: {
          ...mine,
          type: { $in: [...LIKE_TYPES, "comment"] },
          status: "success",
          finishedAt: { $gte: since14 },
        },
      },
      {
        $group: {
          _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$finishedAt" } }, type: "$type" },
          count: { $sum: 1 },
        },
      },
    ]),
    TaskModel.aggregate([
      { $match: { ...mine, type: { $in: [...LIKE_TYPES, "comment"] }, status: "success" } },
      { $group: { _id: "$profileId", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 6 },
      { $lookup: { from: "profiles", localField: "_id", foreignField: "_id", as: "profile" } },
      { $unwind: "$profile" },
      { $project: { _id: 0, name: "$profile.name", count: 1 } },
    ]),
    CommentModel.countDocuments(mine),
    CommentModel.countDocuments({ ...mine, used: false }),
  ]);

  // El día se agrupa en UTC (default de $dateToString) — se recorre y se
  // formatea también en UTC para que la etiqueta nunca se desfase un día
  // por la zona horaria del servidor.
  const dailyMap = new Map<string, { likes: number; comments: number }>();
  for (let i = 0; i < TREND_DAYS; i++) {
    const d = new Date(since14);
    d.setUTCDate(d.getUTCDate() + i);
    dailyMap.set(d.toISOString().slice(0, 10), { likes: 0, comments: 0 });
  }
  for (const row of dailyRows as { _id: { day: string; type: string }; count: number }[]) {
    const entry = dailyMap.get(row._id.day);
    if (!entry) continue;
    // Suma en vez de asignar: "like" y "likecomment" son filas distintas del
    // agregado que caen en la misma barra de likes del día.
    if (LIKE_TYPES.includes(row._id.type)) entry.likes += row.count;
    else entry.comments += row.count;
  }
  const trend: TrendPoint[] = Array.from(dailyMap.entries()).map(([day, v]) => ({
    day,
    label: new Date(day).toLocaleDateString("es", { day: "2-digit", month: "short", timeZone: "UTC" }),
    ...v,
  }));

  const likeTotal = likeSuccess + likeFailed;
  const commentTaskTotal = commentSuccess + commentFailed;
  const successRateTotal = success + failed;

  return {
    profiles,
    groups,
    pendingOrQueued,
    running,
    likeSuccess,
    commentSuccess,
    likeSuccessRate: likeTotal > 0 ? Math.round((likeSuccess / likeTotal) * 100) : null,
    commentSuccessRate: commentTaskTotal > 0 ? Math.round((commentSuccess / commentTaskTotal) * 100) : null,
    globalSuccessRate: successRateTotal > 0 ? Math.round((success / successRateTotal) * 100) : null,
    last7,
    last7Delta:
      prev7 > 0 ? Math.round(((last7 - prev7) / prev7) * 100) : last7 > 0 ? 100 : 0,
    trend,
    topProfiles: topRows as ProfileRow[],
    commentTotal,
    commentAvailable,
  };
}

// Accesos a los cuatro elementos, en el orden canónico de la sala.
const ELEMENT_LINKS: Record<string, { href: string; cta: string }> = {
  viento: { href: "/scrapping", cta: "Escuchar" },
  agua: { href: "/campanas", cta: "Operar" },
  tierra: { href: "/actividades", cta: "Desplegar" },
  fuego: { href: "/dia-d", cta: "Preparar" },
};

const PASOS = [
  { n: "1", t: "Abre el cliente de escritorio o en esta máquina." },
  { n: "2", t: "Corre el worker en otra terminal: npm run worker", code: "npm run worker" },
  { n: "3", t: "Sincroniza o crea grupos.", href: "/groups", link: "Grupos" },
  { n: "4", t: "Sincroniza perfiles y arranca o detén navegadores.", href: "/profiles", link: "Perfiles" },
  { n: "5", t: "Crea automatizaciones.", href: "/tasks", link: "Tareas" },
];

export default async function Home() {
  // proxy.ts ya redirige al login sin sesión; esto es el cinturón de seguridad
  // para que la página nunca pueda renderizar sin un usuario del que colgar el
  // alcance de las cifras.
  const user = await currentUser();
  if (!user) redirect("/login");

  // En paralelo: Agua (campañas y tareas) y Viento (escucha) son consultas
  // independientes, no tiene sentido encadenarlas.
  const [stats, escucha] = await Promise.all([getStats(user), getListeningDigest(user)]);

  return (
    <>
      {/* Portada editorial. */}
      <section className="animate-fade-in-up py-6">
        <p className="overline">Jesús García · USO INTERNO</p>
        <h1 className="hero-h1">Esto es lo que se mueve hoy</h1>
        <p className="hero-p">
          Cuatro elementos, un vistazo: qué está corriendo, qué se acumuló en la cola y qué tanto está saliendo
          bien.
        </p>
      </section>

      <div className="bento">
        <SubHead>Estado de la operación</SubHead>

        <StatCard label="Perfiles" value={stats.profiles} href="/profiles" icon={Users} accent="gold" />
        <StatCard label="Grupos" value={stats.groups} href="/groups" icon={FolderKanban} accent="gold" />
        <StatCard label="En cola" value={stats.pendingOrQueued} href="/tasks?status=queued" icon={Clock} accent="agua" />
        <StatCard
          label="Corriendo"
          value={stats.running}
          href="/tasks?status=running"
          icon={RefreshCw}
          accent="warning"
          live={stats.running > 0}
        />

        <SubHead>Agua · rendimiento de campañas</SubHead>

        <StatCard
          label="Likes completados"
          value={stats.likeSuccess}
          href="/tasks?status=success&type=like"
          icon={Heart}
          accent="series-3"
          delta={
            stats.likeSuccessRate !== null
              ? { text: `${stats.likeSuccessRate}% éxito`, positive: stats.likeSuccessRate >= 50 }
              : undefined
          }
        />
        <StatCard
          label="Comentarios completados"
          value={stats.commentSuccess}
          href="/tasks?status=success&type=comment"
          icon={MessageSquare}
          accent="series-5"
          delta={
            stats.commentSuccessRate !== null
              ? { text: `${stats.commentSuccessRate}% éxito`, positive: stats.commentSuccessRate >= 50 }
              : undefined
          }
        />
        <StatCard
          label="Tasa de éxito global"
          value={stats.globalSuccessRate !== null ? `${stats.globalSuccessRate}%` : "—"}
          icon={TrendingUp}
          accent="success"
        />
        <StatCard
          label="Completadas · 7 días"
          value={stats.last7}
          href="/tasks?status=success"
          icon={CalendarCheck}
          accent="gold"
          delta={
            stats.last7 > 0 || stats.last7Delta !== 0
              ? { text: `${Math.abs(stats.last7Delta)}% vs. semana previa`, positive: stats.last7Delta >= 0 }
              : undefined
          }
        />

        <SubHead>Viento · qué se dice ahí afuera</SubHead>

        <StatCard
          label="Menciones · 30 días"
          value={escucha.mentions30d}
          href="/scrapping"
          icon={Radar}
          accent="viento"
        />
        <StatCard
          label="Últimas 24 horas"
          value={escucha.mentions24h}
          href="/scrapping"
          icon={Radio}
          accent="viento"
          live={escucha.mentions24h > 0}
        />
        <StatCard
          label="Sentimiento promedio"
          value={escucha.avgScore === null ? "—" : Math.round(escucha.avgScore)}
          icon={TrendingUp}
          accent={
            escucha.avgScore === null
              ? "viento"
              : escucha.avgScore > 10
                ? "success"
                : escucha.avgScore < -10
                  ? "fuego"
                  : "warning"
          }
        />
        <StatCard
          label="Menciones adversas"
          value={escucha.negative30d}
          href="/scrapping"
          icon={AlertTriangle}
          accent="fuego"
        />

        {escucha.mentions30d === 0 ? (
          <Panel col={12} accent="var(--el-viento)">
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-2xl accent-fill border">
                <ElementIcon name="viento" size={22} />
              </span>
              <p className="max-w-md text-[13px] leading-relaxed text-ink-secondary">
                Todavía no hay menciones. Crea un proyecto de escucha con las figuras que quieras
                monitorear y en minutos vas a ver aquí lo que se publica sobre ellas.
              </p>
              <Link href="/scrapping" className="tbtn">
                Ir a Escucha →
              </Link>
            </div>
          </Panel>
        ) : (
          <>
            <Panel
              col={7}
              title="Lo último que se publicó"
              tag="todas las figuras"
              accent="var(--el-viento)"
              icon={<ElementIcon name="viento" size={13} />}
              right={
                <Link href="/scrapping" className="label-mono transition-colors hover:text-gold">
                  Ver todo →
                </Link>
              }
            >
              <div className="flex flex-col gap-2.5">
                {escucha.latest.map((m) => {
                  const color =
                    m.sentiment === "positive"
                      ? "var(--ok)"
                      : m.sentiment === "negative"
                        ? "var(--danger)"
                        : "var(--text-muted)";
                  return (
                    <a
                      key={m.id}
                      href={m.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-start gap-2.5"
                    >
                      <span
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: color }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] leading-snug text-ink transition-colors group-hover:text-gold">
                          {m.title}
                        </span>
                        <span className="label-mono-sm mt-0.5 block">
                          {m.entity} · {m.domain} ·{" "}
                          {new Date(m.publishedAt).toLocaleDateString("es-MX", {
                            day: "2-digit",
                            month: "short",
                          })}
                        </span>
                      </span>
                      <ExternalLink className="mt-1 h-3 w-3 shrink-0 text-ink-muted opacity-0 transition-opacity group-hover:opacity-100" />
                    </a>
                  );
                })}
              </div>
            </Panel>

            <Panel
              col={5}
              title="Temas que dominan"
              tag="detectados por IA"
              accent="var(--gold)"
              icon={<ElementIcon name="eye" size={13} />}
              bodyClassName="flex h-full flex-col justify-between gap-4"
            >
              {escucha.topTopics.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-ink-secondary">
                  Sin temas todavía — hace falta que la IA analice las menciones.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {escucha.topTopics.map((t, i) => (
                    <span
                      key={t.name}
                      className="rounded-[7px] border px-2.5 py-1 font-mono text-[11px]"
                      style={{
                        borderColor: `color-mix(in srgb, var(--gold) ${Math.max(20, 60 - i * 6)}%, transparent)`,
                        color: i < 3 ? "var(--gold)" : "var(--text-secondary)",
                      }}
                    >
                      {t.name} <span className="tabular-nums opacity-60">{t.count}</span>
                    </span>
                  ))}
                </div>
              )}

              {escucha.worstProject && (
                <Link
                  href={`/scrapping/proyecto/${escucha.worstProject.id}`}
                  className="card-flat flex items-center gap-2.5 p-3 transition-colors hover:border-critical/40"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0 text-critical" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-ink">
                      {escucha.worstProject.name}
                    </span>
                    <span className="label-mono-sm mt-0.5 block normal-case tracking-normal">
                      Es el proyecto con peor lectura: {escucha.worstProject.avgScore}
                    </span>
                  </span>
                </Link>
              )}
            </Panel>
          </>
        )}

        <SubHead>Los cuatro elementos</SubHead>

        {ELEMENT_ORDER.map((key) => {
          const meta = ELEMENT_META[key];
          const color = ELEMENT_COLOR[key];
          const link = ELEMENT_LINKS[key];
          return (
            <Link
              key={key}
              href={link.href}
              className="card-surface card-lift c3 flex min-h-45 flex-col px-4.5 py-4.5"
              style={{ ["--edge-c" as string]: color }}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border"
                  style={{
                    color,
                    borderColor: `color-mix(in srgb, ${color} 40%, transparent)`,
                    background: `color-mix(in srgb, ${color} 14%, transparent)`,
                  }}
                >
                  <ElementIcon name={key} size={18} />
                </span>
                <div className="min-w-0">
                  <p className="font-display text-[17px] font-semibold leading-none text-ink">{meta.name}</p>
                  <p className="label-mono-sm mt-1 truncate">{meta.title}</p>
                </div>
              </div>
              <p className="font-display mt-3.5 text-[13px] italic text-ink-secondary">{meta.lead}</p>
              {/* mt-auto ancla el CTA al pie: los cuatro quedan alineados
                  aunque el lema de uno ocupe dos renglones. */}
              <p className="mt-auto pt-4 font-mono text-[10px] tracking-[0.04em]" style={{ color }}>
                {link.cta} →
              </p>
            </Link>
          );
        })}

        <SubHead>Actividad</SubHead>

        <Panel
          col={8}
          title={`Actividad de campañas · últimos ${TREND_DAYS} días`}
          tag="likes + comentarios"
          accent="var(--el-agua)"
          icon={<ElementIcon name="agua" size={13} />}
        >
          <CampaignTrendChart data={stats.trend} />
        </Panel>

        <Panel
          col={4}
          title="Banco de comentarios"
          tag="sin usar"
          accent="var(--gold)"
          icon={<ElementIcon name="eye" size={13} />}
          bodyClassName="flex h-full flex-col gap-4"
        >
          <Meter
            label="Disponibles"
            value={stats.commentAvailable}
            total={stats.commentTotal}
            accent="var(--gold)"
          />
          <p className="text-[12px] leading-relaxed text-ink-secondary">
            Comentarios listos para la próxima campaña. Cuando se agotan, las tareas de comentar se quedan sin
            munición.
          </p>
          <Link href="/tasks/comment" className="tbtn mt-auto text-center">
            Ir a campaña de comentarios
          </Link>
        </Panel>

        <Panel
          col={12}
          title="Perfiles más activos"
          tag="likes + comentarios exitosos"
          accent="var(--el-viento)"
          icon={<ElementIcon name="viento" size={13} />}
        >
          <TopProfilesChart data={stats.topProfiles} />
        </Panel>

        <SubHead>Antes de empezar</SubHead>

        <Panel col={12} accent="var(--gold)">
          <ol className="flex flex-col gap-3">
            {PASOS.map((p, i) => (
              <li key={p.n} className="reveal flex items-start gap-3.5" style={{ ["--d" as string]: `${i * 0.05}s` }}>
                <span className="font-display grid h-7 w-7 shrink-0 place-items-center rounded-full border border-hairline text-[13px] font-bold text-gold">
                  {p.n}
                </span>
                <span className="pt-1 text-[13px] leading-snug text-ink-secondary">
                  {p.code ? (
                    <>
                      Corre el worker en otra terminal:{" "}
                      <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink">
                        {p.code}
                      </code>
                    </>
                  ) : p.href ? (
                    <>
                      Ve a{" "}
                      <Link className="text-gold underline-offset-4 hover:underline" href={p.href}>
                        {p.link}
                      </Link>{" "}
                      para {p.t.charAt(0).toLowerCase()}
                      {p.t.slice(1)}
                    </>
                  ) : (
                    p.t
                  )}
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </>
  );
}
