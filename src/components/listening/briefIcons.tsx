import {
  Mic,
  Scale,
  Wallet,
  Shield,
  Stethoscope,
  Newspaper,
  Flag,
  Vote,
  HardHat,
  Leaf,
  GraduationCap,
  Globe,
  Megaphone,
  BarChart3,
  Clock,
  AlertTriangle,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";

/** Mismo vocabulario que el esquema del brief en src/lib/listening/analyze.ts. */
export const BRIEF_ICON_MAP: Record<string, LucideIcon> = {
  audio: Mic,
  legal: Scale,
  dinero: Wallet,
  seguridad: Shield,
  salud: Stethoscope,
  prensa: Newspaper,
  partido: Flag,
  eleccion: Vote,
  obra: HardHat,
  ambiente: Leaf,
  educacion: GraduationCap,
  internacional: Globe,
  comunicacion: Megaphone,
  datos: BarChart3,
  tiempo: Clock,
  alerta: AlertTriangle,
  oportunidad: TrendingUp,
  personas: Users,
};

export type BriefPoint = { text: string; icon: string };

/**
 * Palabras que delatan el tema, para los informes generados antes de que el
 * modelo devolviera el icono. El orden importa: gana la primera que aparece,
 * así que van de lo más específico a lo más genérico.
 */
const KEYWORD_ICON: [RegExp, string][] = [
  [/audio|grabaci|filtrac|entrevista/i, "audio"],
  [/visa|estados unidos|extradici|internacional|embajada/i, "internacional"],
  [/fiscal|juicio|denuncia|uif|judicial|legal|peritaje/i, "legal"],
  [/patrimoni|presupuest|contrato|recaudaci|financier|dinero/i, "dinero"],
  [/segurid|delito|polic|operativo|armas|extorsi/i, "seguridad"],
  [/salud|hospital|m[eé]dic|caravana/i, "salud"],
  [/prensa|medio|titular|cobertura|columna|peri[oó]dic/i, "prensa"],
  [/morena|partido|pan\b|dirigencia|alianza|interna/i, "partido"],
  [/sucesi|candidat|elecci|voto|delfín|delfin/i, "eleccion"],
  [/obra|pavimenta|transporte|infraestructura/i, "obra"],
  [/agua|reforesta|ambient|clima|ecolog/i, "ambiente"],
  [/escuela|preparatoria|beca|educaci/i, "educacion"],
  [/vocer|comunicaci|mensaje|mañanera|manana/i, "comunicacion"],
  [/cifra|dato|m[eé]trica|encuesta/i, "datos"],
  [/plazo|calendario|semana|urgen/i, "tiempo"],
  [/mujer|ciudadan|colectiv|comunidad/i, "personas"],
];

function guessIcon(text: string, fallback: string): string {
  for (const [pattern, icon] of KEYWORD_ICON) {
    if (pattern.test(text)) return icon;
  }
  return fallback;
}

/**
 * Acepta el formato nuevo (objeto con icono) y el viejo (string suelto), para
 * que los informes ya guardados sigan viéndose bien sin migrar la colección.
 */
export function normalizePoints(
  points: (string | BriefPoint)[] | undefined,
  fallbackIcon: string,
): BriefPoint[] {
  return (points ?? []).map((p) =>
    typeof p === "string"
      ? { text: p, icon: guessIcon(p, fallbackIcon) }
      : { text: p.text, icon: BRIEF_ICON_MAP[p.icon] ? p.icon : guessIcon(p.text, fallbackIcon) },
  );
}
