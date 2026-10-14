/**
 * IP real de quien hace la request. Se prefiere X-Real-IP porque lo pone nginx
 * con la IP de la conexión; X-Forwarded-For en cambio arrastra lo que mande el
 * navegador, y su primer valor se puede inventar.
 */
export function realIp(req: Request): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",").at(-1)!.trim() : "";
}

/**
 * Ciudad aproximada de una IP ("Culiacán, SIN, MX"), o "" si no se sabe.
 *
 * Sale de una base de IPs que viaja con el servidor (fast-geoip, datos de
 * GeoLite): la IP no se le manda a nadie y la base se lee del disco al
 * consultar, sin cargarla entera en memoria. Es por IP, así que con VPN o datos
 * móviles puede dar otra ciudad o la del proveedor.
 */
export async function ipLocation(ip: string): Promise<string> {
  if (!ip) return "";
  // Import dinámico dentro del try: si la base faltara o no cargara, el login
  // sigue andando y solo se pierde la ubicación.
  try {
    const { default: geoip } = await import("fast-geoip");
    const geo = await geoip.lookup(ip);
    if (!geo) return "";
    return [geo.city, geo.region, geo.country].filter(Boolean).join(", ");
  } catch {
    return "";
  }
}
