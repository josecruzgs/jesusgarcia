/**
 * Procesos de producción para PM2.
 *
 * Son dos y no uno porque el worker no puede vivir dentro de Next: es un
 * proceso de larga duración que hace polling a Mongo, y el servidor web solo
 * existe mientras atiende peticiones.
 *
 * En el VPS se levantan `jesusgarcia-web` y `jesusgarcia-listening`. La automatización
 * (`jesusgarcia-tasks`) NO se levanta ahí: necesita AdsPower de escritorio corriendo
 * en la misma máquina, así que va en la Windows, con este mismo archivo:
 *
 *   VPS      → pm2 start ecosystem.config.cjs --only jesusgarcia-web,jesusgarcia-listening
 *   Windows  → pm2 start ecosystem.config.cjs --only jesusgarcia-tasks
 *
 * Los tres van en `exec_mode: "fork"` y sin `instances`. Declarar `instances`
 * —aunque sea 1— hace que PM2 pase a modo cluster, que arranca el script con el
 * módulo `cluster` de Node y no sabe ejecutar el CLI de tsx: el worker moría al
 * instante, sin alcanzar a escribir una línea en su log, y PM2 lo reintentaba
 * en bucle. Acá no hay nada que clusterizar: la caché de Next vive en disco
 * local y el latido del worker asume un proceso por rol.
 */
const forkOnce = { exec_mode: "fork", autorestart: true };

module.exports = {
  apps: [
    {
      ...forkOnce,
      name: "jesusgarcia-web",
      script: "node_modules/next/dist/bin/next",
      args: "start",
      // 3001 y no 3000: el 3000 es el default de todo proyecto de Node y en un
      // servidor compartido con otras apps ya suele estar tomado. Nginx es
      // quien atiende el 443, así que el puerto interno da igual mientras no
      // choque.
      env: { NODE_ENV: "production", PORT: 3002 },
      max_memory_restart: "700M",
    },
    {
      ...forkOnce,
      // Solo ingesta y análisis. Sin AdsPower a la vista, tomar tareas de
      // automatización las haría fallar una por una.
      name: "jesusgarcia-listening",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "src/worker/index.ts",
      env: { NODE_ENV: "production", WORKER_TASKS: "0", WORKER_LISTENING: "1" },
      max_memory_restart: "700M",
      // Un scrape de Bright Data puede tardar minutos; matarlo a la mitad
      // deja el snapshot pago sin recoger.
      kill_timeout: 30_000,
    },
    {
      ...forkOnce,
      name: "jesusgarcia-tasks",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "src/worker/index.ts",
      env: { NODE_ENV: "production", WORKER_TASKS: "1", WORKER_LISTENING: "0" },
      kill_timeout: 30_000,
    },
  ],
};
