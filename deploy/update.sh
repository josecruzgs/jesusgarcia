#!/usr/bin/env bash
#
# El "Actualizar" de DEPLOY.md, hecho script para que lo pueda disparar el
# webhook. Se puede correr a mano igual: `bash ~/godeye/deploy/update.sh`.
set -uo pipefail

# Se corre desde una copia porque el `git reset` de más abajo reescribe ESTE
# archivo: bash lee el script por tramos a medida que avanza, así que a partir
# de ahí estaría ejecutando una mezcla de las dos versiones. La copia se borra
# sola al terminar.
if [ -z "${GODEYE_DEPLOY_COPIA:-}" ]; then
  copia=$(mktemp) || exit 1
  cat "$0" > "$copia" || exit 1
  export GODEYE_DEPLOY_COPIA=1
  exec bash "$copia" "$@"
fi
trap 'rm -f "$0"' EXIT

REPO="${GODEYE_REPO_DIR:-$HOME/godeye}"
BRANCH="${GODEYE_DEPLOY_BRANCH:-main}"
# Margen de disco antes de tocar node_modules o .next. La caché de AdsPower
# llena el disco sola, y un `npm ci` a mitad de camino sin espacio deja el
# árbol de dependencias roto, que es mucho peor que no desplegar.
MIN_FREE_MB="${GODEYE_MIN_FREE_MB:-3000}"

# --force: compila y recarga aunque el repo ya esté en el commit del remoto.
# Sirve para rehacer un build que quedó a medias, donde la comparación de
# commits diría "no hay nada que hacer".
#
# --quiet: no dice nada mientras no haya trabajo. Es para correrlo por cron cada
# minuto —donde no hay webhook que avise— sin que el log quede en tres líneas
# por minuto diciendo que no pasó nada. Los errores se imprimen igual.
FORCE=0
QUIET=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --quiet) QUIET=1 ;;
  esac
done

cd "$REPO" || exit 1

say() { [ "$QUIET" = "1" ] || echo "$*"; }
step() { say "-- $(date -Is) $*"; }
# Un fallo se dice siempre, aunque sea en silencio: es lo único que uno busca
# en el log de una corrida automática.
fail() { echo "!! $(date -Is) $*"; exit 1; }

# Un solo deploy a la vez, aunque el webhook y una mano lo lancen juntos. El
# candado lleva el nombre del repo: donde conviven dos de estos sistemas bajo el
# mismo usuario, uno compartido dejaría al segundo deploy creyendo que ya hay
# uno corriendo y saliendo sin hacer nada.
if command -v flock >/dev/null 2>&1; then
  exec 9>"$HOME/.$(basename "$REPO")-deploy.lock"
  if ! flock -n 9; then
    say "== $(date -Is) ya hay un deploy corriendo; salgo"
    exit 0
  fi
else
  # Sin flock no hay forma de tomar el candado, pero tampoco es motivo para no
  # desplegar: se avisa y se sigue. En Ubuntu viene con util-linux, así que
  # esto solo pasa corriendo el script fuera del servidor.
  say "== $(date -Is) sin flock en esta máquina: se sigue sin candado"
fi

say "== $(date -Is) deploy en $REPO ($BRANCH)"

before=$(git rev-parse HEAD) || fail "no pude leer HEAD"

step "git fetch"
# -q: sin esto imprime "From ... -> FETCH_HEAD" por stderr en cada corrida, y
# por cron eso es una línea por minuto contando que no pasó nada.
git fetch -q --prune origin "$BRANCH" || fail "fetch falló"
target=$(git rev-parse "origin/$BRANCH") || fail "no existe origin/$BRANCH"

if [ "$before" = "$target" ] && [ "$FORCE" = "0" ]; then
  say "== ya estaba en ${target:0:7}, nada que hacer"
  exit 0
fi

# Hay trabajo: de acá en adelante se cuenta todo, incluso en modo silencioso.
if [ "$QUIET" = "1" ]; then
  QUIET=0
  echo "== $(date -Is) deploy en $REPO ($BRANCH)"
fi

free_mb=$(df -Pm / | awk 'NR==2 {print $4}')
[ "$free_mb" -ge "$MIN_FREE_MB" ] || fail "solo quedan ${free_mb}MB libres en / (mínimo ${MIN_FREE_MB}). Limpiá antes de desplegar."

step "${before:0:7} -> ${target:0:7}"
git log --oneline "$before..$target" | sed 's/^/   /'

# reset --hard y no pull: el pull se atasca pidiendo resolver conflictos si
# alguien editó un archivo en el servidor, y acá no hay nadie para responder.
# No toca lo que no está versionado: .env.local, uploads/ y screenshots/ siguen
# donde estaban.
git reset --hard "$target" || fail "reset falló"

# npm ci borra node_modules entero y tarda minutos; solo tiene sentido si
# cambiaron las dependencias.
if git diff --name-only "$before" "$target" | grep -qE '^package(-lock)?\.json$'; then
  step "npm ci (cambiaron las dependencias)"
  npm ci || fail "npm ci falló"
else
  step "dependencias sin cambios, salteo npm ci"
fi

step "npm run build"
if ! npm run build; then
  echo "!! el build falló. Los procesos siguen corriendo con el build anterior en memoria,"
  echo "!! pero .next quedó a medias: NO reinicies PM2 hasta arreglarlo."
  echo "!! Para volver atrás:  cd $REPO && git reset --hard $before && bash deploy/update.sh --force"
  exit 1
fi

# reload y no restart: espera a que terminen las peticiones en vuelo. Ojo que
# para los workers (fork, no cluster) es un reinicio igual: una tarea de
# automatización en curso se corta.
#
# Por el archivo de ecosistema y no `pm2 reload all`: hay VPS con dos de estos
# sistemas bajo el mismo usuario, y PM2 es por usuario, así que un "all"
# reiniciaría también la app del vecino. El ecosistema nombra exactamente los
# procesos de este repo.
step "pm2 reload"
if [ -f ecosystem.config.cjs ]; then
  pm2 reload ecosystem.config.cjs || fail "pm2 reload falló"
else
  pm2 reload all || fail "pm2 reload falló"
fi

echo "== $(date -Is) listo en ${target:0:7}"
