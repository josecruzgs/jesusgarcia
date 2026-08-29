/**
 * Receptor del webhook de GitHub: cada push a main dispara el deploy.
 *
 * Corre como servicio de systemd y no como app de PM2 a propósito. El deploy
 * termina en `pm2 reload all`; si el receptor viviera dentro de PM2, ese reload
 * se reiniciaría a sí mismo y mataría el script de deploy a media compilación.
 * Systemd lo deja fuera de ese árbol de procesos.
 *
 * Solo escucha en el localhost: quien lo expone es nginx, en la ruta del
 * snippet deploy/webhook-location.conf.
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createWriteStream } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const REPO = process.env.GODEYE_REPO_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BRANCH = process.env.GODEYE_DEPLOY_BRANCH ?? "main";
const PORT = Number(process.env.GODEYE_WEBHOOK_PORT ?? 9099);
// Con el nombre de la carpeta del repo y no fijo: hay VPS con dos de estos
// sistemas bajo el mismo usuario, y un solo archivo mezclaría los dos deploys.
const LOG = process.env.GODEYE_DEPLOY_LOG ?? join(homedir(), `${basename(REPO)}-deploy.log`);
const SECRET = process.env.GODEYE_WEBHOOK_SECRET;

if (!SECRET) {
  console.error("Falta GODEYE_WEBHOOK_SECRET. Sin secreto no hay forma de saber que el push viene de GitHub.");
  process.exit(1);
}

// Un push normal ronda los 10 KB; el tope está para que nadie mantenga abierta
// una conexión mandando megabytes que igual van a fallar la firma.
const MAX_BODY = 1024 * 1024;

let running = false;
// Si llega un push mientras hay un deploy corriendo, no se encola una segunda
// compilación en paralelo: se marca que al terminar hay que volver a mirar el
// remoto. Tres pushes seguidos dejan un solo deploy pendiente, con el último
// commit de los tres.
let pending = false;

function log(line) {
  console.log(`[${new Date().toISOString()}] ${line}`);
}

function deploy(reason) {
  if (running) {
    pending = true;
    log(`deploy en curso; ${reason} queda pendiente`);
    return;
  }
  running = true;
  log(`arranca deploy (${reason}) — salida en ${LOG}`);

  // La salida se vuelca al log a medida que sale: el receptor no tiene por qué
  // retener en memoria los dos minutos de build para escribirlos al final.
  const out = createWriteStream(LOG, { flags: "a" });
  const child = spawn("bash", [join(REPO, "deploy", "update.sh")], {
    cwd: REPO,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GODEYE_REPO_DIR: REPO, GODEYE_DEPLOY_BRANCH: BRANCH },
  });
  child.stdout.pipe(out, { end: false });
  child.stderr.pipe(out, { end: false });

  child.on("close", (code) => {
    running = false;
    out.end();
    log(code === 0 ? "deploy terminado" : `deploy FALLÓ con código ${code} — revisá ${LOG}`);
    if (pending) {
      pending = false;
      deploy("push acumulado");
    }
  });
}

function signatureOk(raw, header) {
  if (!header) return false;
  const mine = Buffer.from(`sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}`);
  const theirs = Buffer.from(header);
  // timingSafeEqual exige el mismo largo; con distinto largo la firma ya es
  // inválida, pero comparar antes evitaría el throw.
  return mine.length === theirs.length && timingSafeEqual(mine, theirs);
}

createServer((req, res) => {
  const reply = (code, text) => {
    res.writeHead(code, { "content-type": "text/plain; charset=utf-8" });
    res.end(text + "\n");
  };

  if (req.method !== "POST") return reply(405, "solo POST");

  const chunks = [];
  let size = 0;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      reply(413, "cuerpo demasiado grande");
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on("end", () => {
    if (req.destroyed) return;
    const raw = Buffer.concat(chunks);

    if (!signatureOk(raw, req.headers["x-hub-signature-256"])) {
      log("firma inválida — descartado");
      return reply(401, "firma inválida");
    }

    const event = req.headers["x-github-event"];
    if (event === "ping") return reply(200, "pong");
    if (event !== "push") return reply(200, `evento ${event} ignorado`);

    let payload;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      return reply(400, "cuerpo ilegible");
    }

    if (payload.ref !== `refs/heads/${BRANCH}`) {
      return reply(200, `${payload.ref} ignorado; solo se despliega ${BRANCH}`);
    }

    // GitHub corta a los 10 segundos y marca el envío como fallido: se contesta
    // ya y el deploy sigue por su cuenta.
    reply(202, "deploy encolado");
    deploy(`push de ${payload.pusher?.name ?? "?"} — ${String(payload.after).slice(0, 7)}`);
  });
}).listen(PORT, "127.0.0.1", () => log(`escuchando en 127.0.0.1:${PORT}, rama ${BRANCH}, repo ${REPO}`));
