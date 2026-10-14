import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lee su base de IPs del disco con rutas relativas a su propia carpeta, que
  // dejan de existir si Next lo empaqueta.
  serverExternalPackages: ["fast-geoip"],
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
