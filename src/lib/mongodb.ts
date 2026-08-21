import dns from "dns";
import mongoose from "mongoose";

type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

declare global {
  var _mongooseCache: MongooseCache | undefined;
}

const cache: MongooseCache = global._mongooseCache ?? { conn: null, promise: null };
global._mongooseCache = cache;

export async function dbConnect() {
  if (cache.conn) return cache.conn;

  const MONGODB_URI = process.env.MONGODB_URI;
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI no está definido. Revisa tu .env.local");
  }

  if (!cache.promise) {
    cache.promise = mongoose
      .connect(MONGODB_URI, { bufferCommands: false })
      .catch(async (err) => {
        // En algunas redes (VPN corporativa, ciertos routers/DNS de Windows)
        // el resolutor DNS nativo de Node no puede resolver el registro SRV
        // de Atlas (mongodb+srv://) aunque el DNS del sistema sí puede.
        // Reintentamos una vez forzando resolutores públicos.
        const isDnsSrvError = err instanceof Error && /querySrv|ECONNREFUSED/i.test(err.message);
        if (!isDnsSrvError || !MONGODB_URI.startsWith("mongodb+srv://")) throw err;

        dns.setServers(["1.1.1.1", "8.8.8.8"]);
        return mongoose.connect(MONGODB_URI, { bufferCommands: false });
      });
  }

  const pending = cache.promise;

  try {
    cache.conn = await pending;
  } catch (err) {
    // Sin esto la promesa rechazada queda cacheada para siempre, y como el
    // caché vive en `global` (sobrevive al hot reload y a los invocations
    // del serverless), CUALQUIER fallo de conexión —un hipo de red, unas
    // credenciales que ya corregiste en el .env— deja la app tirando el
    // mismo error hasta reiniciar el proceso. Limpiándola, la próxima
    // petición vuelve a intentar conectar de cero.
    //
    // La comparación con `pending` es por si dos requests concurrentes
    // fallan a la vez: la segunda no debe borrar el reintento que la
    // primera ya dejó en marcha.
    if (cache.promise === pending) cache.promise = null;
    throw err;
  }

  return cache.conn;
}
