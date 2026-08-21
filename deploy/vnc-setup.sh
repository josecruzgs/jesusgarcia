#!/usr/bin/env bash
# Deja la pantalla del servidor disponible para /pantalla del panel.
#
# Levanta x11vnc y websockify como servicios de systemd sobre la pantalla
# virtual donde ya corre AdsPower. Antes se levantaban a mano con nohup y se
# perdían en cada reinicio.
#
# Se adapta a la máquina: descubre el display de la pantalla virtual y usa el
# usuario que lo ejecuta. Es idempotente: se puede correr las veces que haga
# falta. Corre EN EL SERVIDOR, no en tu PC.
#
#   bash vnc-setup.sh

# Sin -e a propósito: si algo falla queremos el diagnóstico completo, no un
# corte en la primera línea que no le gustó.
set -uo pipefail

echo "== quién y dónde =="
echo "usuario: $(whoami) · host: $(hostname)"

echo
echo "== servicios =="
for s in xvfb adspower nginx x11vnc websockify; do
  printf '  %-12s %s\n' "$s" "$(systemctl is-active "$s" 2>/dev/null || echo no-existe)"
done

echo
echo "== puertos =="
ss -tlnp 2>/dev/null | grep -E ':(5900|6080|50325|3000|3001)\s' || echo "  ninguno de 5900/6080/50325/3000/3001"

# El display de la pantalla virtual: primero se le pregunta al propio servicio
# de AdsPower, que es quien manda; si no está declarado, se mira qué Xvfb hay
# corriendo; y recién al final se asume el :99 de la guía.
DISP=$(systemctl show adspower -p Environment --value 2>/dev/null | tr ' ' '\n' | sed -n 's/^DISPLAY=//p' | head -1)
[ -z "$DISP" ] && DISP=$(pgrep -a Xvfb 2>/dev/null | grep -oE ' :[0-9]+' | head -1 | tr -d ' ')
[ -z "$DISP" ] && DISP=":99"

echo
echo "== display: $DISP =="

if ! pgrep -x Xvfb >/dev/null 2>&1; then
  echo "NO hay ningún Xvfb corriendo: sin pantalla virtual no hay nada que mirar."
  echo "Mirá 'systemctl status xvfb adspower' — la sección 6 de DEPLOY.md los crea."
  exit 1
fi

echo
echo "== paquetes =="
sudo apt-get install -y x11vnc novnc websockify >/dev/null 2>&1 && echo "  ok" || echo "  revisar apt a mano"

X11VNC=$(command -v x11vnc)
WSOCK=$(command -v websockify)
if [ -z "$X11VNC" ] || [ -z "$WSOCK" ]; then
  echo "Falta x11vnc o websockify y apt no pudo instalarlos. Sin eso no se sigue."
  exit 1
fi

# Un x11vnc o un websockify sueltos de un nohup viejo tienen tomado el puerto y
# el servicio nuevo no podría arrancar.
sudo pkill -f 'x11vnc -display' 2>/dev/null
sudo pkill -f 'websockify --web' 2>/dev/null

# El dueño del Xvfb, y no quien ejecuta esto: si el script se corre como root,
# un x11vnc de root no puede abrir la pantalla de otro usuario.
USUARIO=$(ps -o user= -C Xvfb 2>/dev/null | head -1 | tr -d " ")
[ -z "$USUARIO" ] && USUARIO="${SUDO_USER:-$USER}"
# El orden de arranque solo se puede declarar si esa unidad existe; si la
# pantalla virtual la levanta otra cosa, se deja sin atar.
ORDEN=""
systemctl cat xvfb.service >/dev/null 2>&1 && ORDEN=$'Requires=xvfb.service\nAfter=xvfb.service'

echo
echo "== servicios nuevos =="
sudo tee /etc/systemd/system/x11vnc.service >/dev/null <<EOF
[Unit]
Description=x11vnc sobre la pantalla virtual
$ORDEN

[Service]
User=$USUARIO
Environment=DISPLAY=$DISP
# -localhost: escucha solo en el loopback. A internet lo saca nginx, que
# adelante tiene el chequeo de sesión de administrador (deploy/nginx.conf).
ExecStart=$X11VNC -display $DISP -localhost -nopw -forever -shared -rfbport 5900
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/websockify.service >/dev/null <<EOF
[Unit]
Description=websockify + noVNC para la pantalla del servidor
Requires=x11vnc.service
After=x11vnc.service

[Service]
User=$USUARIO
ExecStart=$WSOCK --web=/usr/share/novnc 127.0.0.1:6080 127.0.0.1:5900
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now x11vnc websockify >/dev/null 2>&1
sleep 2

echo "  x11vnc:     $(systemctl is-active x11vnc)"
echo "  websockify: $(systemctl is-active websockify)"

echo
if curl -fsS -m 5 -o /dev/null http://127.0.0.1:6080/vnc.html; then
  echo "OK: noVNC responde en 127.0.0.1:6080"
else
  echo "FALLA: no responde. Los últimos logs:"
  journalctl -u x11vnc -n 15 --no-pager 2>/dev/null
  journalctl -u websockify -n 15 --no-pager 2>/dev/null
fi
