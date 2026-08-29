# Despliegue en un VPS

Guía para dejar Ojo de Dios corriendo 24/7 sin depender de tu máquina.

## Cómo está montado hoy

Todo corre en un único VPS y ninguna PC forma parte del sistema:

| Proceso | Qué hace |
|---|---|
| `jesusgarcia-web` | Next en el puerto interno 3002, detrás de Nginx con HTTPS |
| `jesusgarcia-listening` | Ingesta de menciones y análisis con Claude, sola, según el intervalo de cada proyecto |
| `jesusgarcia-tasks` | Ejecuta las tareas de automatización contra AdsPower |
| `xvfb` + `adspower` | Servicios de systemd: AdsPower de escritorio contra una pantalla virtual |

La pieza que obliga a instalar AdsPower en el servidor es que su API solo
escucha en el localhost de la máquina donde está, y el navegador se ejecuta ahí
mismo. Mientras viviera en una PC, la automatización dependía de esa PC.

Los workers no hablan con la web: toman su trabajo de Mongo. Por eso pueden
correr donde convenga, y de hecho `jesusgarcia-tasks` puede quedarse en una PC con
AdsPower si preferís no mover los perfiles de máquina — ver el final de la
sección 6.

--- 

## 1. El VPS

Cualquier proveedor con KVM sirve. Lo que importa:

- **Ubuntu 24.04 LTS**
- **4 GB de RAM** — `next build` es lo más pesado que corre ahí; con 2 GB el
  build muere por falta de memoria
- 2 vCPU y 40 GB de disco sobran
- Región cercana a la de tu cluster de Atlas: cada consulta paga ese viaje

Mongo sigue en Atlas, no se instala nada de base de datos en el VPS.

> **Antes de seguir:** en Atlas → Network Access, agregá la IP del VPS a la lista
> de acceso. Sin eso la app levanta pero no conecta, y el error no dice que sea
> por la IP.

### Si el VPS ya tiene otras cosas corriendo

Es lo normal y no hace falta un servidor dedicado: la app son dos procesos de
Node que en reposo no llegan a 1 GB. Antes de empezar, verificá en el candidato:

```bash
lsb_release -ds; nproc; free -h; df -h /
sudo ss -tlnp | grep -E ':(80|443|3000|3001|3002)\s'
node -v; nginx -v; pm2 list; docker ps --format '{{.Names}}'
ls -d /usr/local/cpanel /usr/local/CyberCP /opt/plesk /home/cloudpanel 2>/dev/null
```

- **~2 GB de RAM disponibles** para el `npm run build`. Si no hay, agregá swap
  (abajo) o compilá en tu máquina y subí el resultado.
- **Puerto 3002 libre** (el 3001 lo tiene el panel de Ismael Burgueño): Nginx atiende el 443, el puerto
  interno solo tiene que no chocar. Se cambia en `ecosystem.config.cjs`.
- **Nginx sin panel de control.** Si aparece CyberPanel, Plesk, cPanel o
  CloudPanel, no edites los archivos a mano: esos paneles los reescriben solos.
  El bloque hay que darlo de alta desde el panel.
- **Node 22 y PM2 ya instalados** → saltate el paso 2 entero.

Con otras apps en la misma máquina, saltear el paso de crear el usuario
`burgueno` y correr todo con el mismo usuario que ya usa PM2 ahí es lo más
práctico: dos demonios de PM2 con usuarios distintos no se ven entre sí y
`pm2 list` deja de mostrar la mitad de los procesos, que es una fuente de
confusión mucho más cara que la separación que gana.

### Swap, si la RAM está justa

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 2. Base del servidor

```bash
ssh root@177.7.33.214

# adduser es interactivo: pide contraseña y datos. Corrélo solo, o se comerá
# las líneas siguientes como respuestas a sus preguntas.
adduser burgueno
usermod -aG sudo burgueno

mkdir -p /home/burgueno/.ssh
cp ~/.ssh/authorized_keys /home/burgueno/.ssh/ 2>/dev/null || true
chown -R burgueno:burgueno /home/burgueno/.ssh && chmod 700 /home/burgueno/.ssh

# Por número de puerto y no por perfil: 'Nginx Full' lo crea Nginx al
# instalarse, y todavía no está instalado.
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable

# Node 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs nginx git
npm install -g pm2

su - burgueno
```

## 3. La app

`su -` abre una shell nueva: lo que venga pegado detrás se pierde en la shell
vieja. Esperá al prompt de `burgueno@` antes de seguir.

```bash
git clone https://github.com/josecruzgs/jesusgarcia.git jesusgarcia && cd jesusgarcia
npm ci
npm run build
```

`npm ci` avisa de vulnerabilidades en `postcss` y `sharp`, dependencias internas
de Next. **No corras `npm audit fix --force`**: el arreglo es subir Next a una
versión fuera del rango declarado, y no es algo para hacer a ciegas en un
despliegue. `postcss` solo actúa en el build y `sharp` procesa imágenes propias.

### `.env.local` del VPS

Copialo desde tu máquina en vez de pegarlo en un editor — una línea cortada al
pegar deja el arranque fallando por una razón difícil de ver:

```powershell
scp .env.local burgueno@177.7.33.214:~/jesusgarcia/.env.local
```

Y ahí cambiá estas cuatro:

```bash
SESSION_SECRET=                      # firma las sesiones — generarla, ver abajo
NEXT_PUBLIC_SHARE_BASE_URL=https://jesusgarcia.kognitic.io
ADSPOWER_API_BASE_URL=http://127.0.0.1:50325   # AdsPower corre acá — sección 6
ADSPOWER_API_KEY=                    # vacío si dejás la verificación apagada
```

`SESSION_SECRET` se genera con
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. No
tiene que ser memorable ni la escribe nadie: firma la cookie de sesión. Cambiarla
cierra todas las sesiones abiertas.

`NEXT_PUBLIC_SHARE_BASE_URL` se inyecta **en el build**, no en el arranque: si la
cambiás después, hay que volver a correr `npm run build` o los links de campañas
seguirán apuntando a donde apuntaban.

### El primer usuario

El panel no tiene contraseña compartida: cada persona entra con su usuario, y los
usuarios viven en Mongo. El primero se crea por línea de comandos, en el VPS,
**una sola vez**:

```bash
npm run users:admin -- --username jose --password "una-larga-y-nueva"
```

Ese comando también adopta todo lo que existía antes de que hubiera usuarios
—campañas, tareas, dashboards, bancos de textos y proyectos de escucha— y lo pone
a nombre de ese admin. Sin correrlo, lo viejo queda sin dueño y no lo ve nadie.
Correrlo dos veces no hace daño: no toca lo que ya tiene dueño ni pisa la
contraseña salvo que agregues `--reset-password`.

De ahí en adelante los usuarios se administran desde **/usuarios**, dentro del
panel: alta, baja, rol y a qué grupos de AdsPower accede cada uno.

## 4. Los procesos

```bash
pm2 start ecosystem.config.cjs --only jesusgarcia-web,jesusgarcia-listening
pm2 save
pm2 startup          # imprime un comando con sudo — copialo y ejecutalo
```

Ese último paso es el que hace que todo vuelva solo después de un reinicio del
VPS. Sin él, un reboot deja el sistema caído sin avisar.

```bash
pm2 status
pm2 logs jesusgarcia-listening --lines 50
```

## 5. Dominio y HTTPS

Apuntá un registro **A** de tu dominio a la IP del VPS y esperá a que propague.

El archivo ya viene con `jesusgarcia.kognitic.io`; si usás otro dominio, cambialo ahí.

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/jesusgarcia
sudo ln -s /etc/nginx/sites-available/jesusgarcia /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d jesusgarcia.kognitic.io
```

Certbot deja la renovación automática configurada.

### Si el sitio YA existe en ese nginx

Nada de copiar el archivo encima: el que está sirviendo tiene tu dominio de
verdad y el bloque del 443 que escribió certbot, y sobrescribirlo tira el sitio
y el certificado. Se abre el que ya está...

```bash
ls /etc/nginx/sites-enabled/
sudo nano /etc/nginx/sites-enabled/EL-QUE-SEA
```

...y se pegan adentro del `server { }` que tiene tu dominio los tres bloques de
`deploy/nginx.conf` marcados como PANTALLA DEL SERVIDOR (`/internal/vnc-auth`,
`/vnc/` y `/websockify`), antes del `location / {`. Después, como siempre:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

El `proxy_pass` de `/internal/vnc-auth` tiene que apuntar al puerto donde
realmente corre Next en esa máquina —`pm2 list` y `ss -tlnp | grep node` lo
dicen—, que no siempre es el 3002.

### Actualizar el código ya desplegado

Desde PowerShell, empezando de cero. Primero se sube lo que se hizo en la
máquina:

```powershell
cd C:UsersjosecDocumentsGithubjesusgarcia
git add -A
git commit -m "lo que se cambió"
git push
```

Y después se baja en el servidor. **Como `burgueno`, no como root**: entrar por
root deja los archivos con dueño equivocado y usa otro PM2, donde estos
procesos no existen.

```powershell
ssh burgueno@177.7.33.214
```

```bash
free -h                 # menos de 2 GB disponibles: no compilar acá
cd ~/jesusgarcia
git pull
npm ci                  # solo si cambiaron dependencias
npm run build
pm2 restart jesusgarcia-web jesusgarcia-listening
```

`.env.local` no viaja por git. Si cambió, va aparte, desde PowerShell:

```powershell
scp .env.local burgueno@177.7.33.214:~/jesusgarcia/.env.local
```

Comprobación, en el servidor:

```bash
pm2 list
curl -s -o /dev/null -w %{http_code}n http://127.0.0.1:3002/login
```

200 y los procesos en `online` sin que suba el contador de reinicios.

`npm run build` es lo más pesado que corre en el VPS, y no está solo: comparte
máquina con el panel de Ismael Burgueño. Si no hay memoria, el kernel mata
procesos para liberar y puede elegir los del otro panel.

## 6. AdsPower en el VPS

> **Este panel comparte el AdsPower del panel de Ismael Burgueño**, que vive en
> el mismo VPS. No se instala de nuevo ni se crean otra vez `xvfb`, `adspower`,
> `x11vnc` ni `websockify`: ya están corriendo y los dos paneles hablan con la
> misma API local y miran la misma pantalla. Esta sección queda como referencia
> de cómo se montó, y para cuando haya que reinstalar.


AdsPower es una aplicación de escritorio: su API solo escucha en el localhost de
la máquina donde está instalada, y el navegador se ejecuta ahí. Mientras viva en
una PC, la automatización depende de que esa PC esté encendida.

La salida es instalarla en el VPS. No hay pantalla, así que corre contra una
pantalla virtual — configuración que AdsPower no documenta (piden Ubuntu
*Desktop*) pero que funciona.

```bash
# El .deb; la URL sale del botón de descarga de adspower.com/download,
# que arma el enlace por JavaScript — se copia desde el gestor de descargas.
wget https://version.adspower.net/software/linux-x64-global/8.7.23/AdsPower-Global-8.7.23-x64.deb
sudo apt install -y ./AdsPower-Global-8.7.23-x64.deb

# Ubuntu Server no trae las librerías gráficas que toda app de escritorio
# necesita. En 24.04 varias cambiaron de nombre (sufijo t64), así que se
# prueban ambos y se sigue de largo con el que no exista.
for p in libasound2t64 libasound2 libgtk-3-0t64 libgtk-3-0 libnss3 libgbm1 \
         libxss1 libxtst6 libsecret-1-0 libatk-bridge2.0-0t64 libatk-bridge2.0-0 \
         libcups2t64 libcups2 fonts-liberation xdg-utils xvfb x11vnc dbus-x11 \
         novnc websockify; do
  sudo apt-get install -y "$p" >/dev/null 2>&1 && echo "ok  $p" || echo "--  $p"
done

ldd "/opt/AdsPower Global/adspower_global" | grep -i "not found"   # debe salir vacío
```

Los dos servicios. `Requires`/`After` importan: sin la pantalla ya levantada,
AdsPower muere con "Missing X server or $DISPLAY".

```bash
sudo tee /etc/systemd/system/xvfb.service >/dev/null <<'EOF'
[Unit]
Description=Pantalla virtual para AdsPower
After=network.target

[Service]
User=burgueno
ExecStart=/usr/bin/Xvfb :99 -screen 0 1440x900x24
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/adspower.service >/dev/null <<'EOF'
[Unit]
Description=AdsPower - API local
Requires=xvfb.service
After=xvfb.service

[Service]
User=burgueno
Environment=HOME=/home/burgueno
Environment=DISPLAY=:99
ExecStart="/opt/AdsPower Global/adspower_global" --no-sandbox
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now xvfb adspower
```

### La pantalla, como servicio

x11vnc publica ese display y websockify lo sirve por WebSocket junto con noVNC,
que es el cliente web. Antes se levantaban a mano con `nohup` y se perdían en
cada reinicio; ahora que el panel los mira desde `/pantalla`, van como servicios.

```bash
sudo tee /etc/systemd/system/x11vnc.service >/dev/null <<'EOF'
[Unit]
Description=x11vnc sobre la pantalla virtual
Requires=xvfb.service
After=xvfb.service

[Service]
User=burgueno
Environment=DISPLAY=:99
# -localhost: escucha solo en el loopback. A internet lo saca nginx, que
# adelante tiene el chequeo de sesión de administrador (deploy/nginx.conf).
# -nopw no lleva contraseña propia a propósito: la autorización es la del panel,
# y una segunda contraseña compartida sería una copia peor de la primera.
ExecStart=/usr/bin/x11vnc -display :99 -localhost -nopw -forever -shared -rfbport 5900
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/websockify.service >/dev/null <<'EOF'
[Unit]
Description=websockify + noVNC para la pantalla del servidor
Requires=x11vnc.service
After=x11vnc.service

[Service]
User=burgueno
ExecStart=/usr/bin/websockify --web=/usr/share/novnc 127.0.0.1:6080 127.0.0.1:5900
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now x11vnc websockify
```

El 6080 también queda atado al loopback: la única puerta es nginx, y su bloque
`/vnc/` le pregunta antes a `/api/vnc/authorize` si la cookie es de un
administrador. Sin ese portero, publicar un VNC sin contraseña sería regalar el
escritorio del VPS con la sesión de AdsPower abierta adentro.

Con los dos servicios arriba, el ícono de pantalla de la barra superior —que
solo ven los administradores— abre `/pantalla` en otra pestaña, y ahí se mira a
AdsPower trabajando en vivo. Si el marco sale negro, el diagnóstico es
`systemctl status xvfb x11vnc websockify`.

### Iniciar sesión la primera vez

La API local viene apagada y la sesión hay que abrirla desde la ventana de la
aplicación, o sea desde esa pantalla. Mientras el deploy no esté arriba —o si
nginx todavía no tiene el bloque— se llega por túnel, sin exponer nada:

```powershell
ssh -N -L 6080:127.0.0.1:6080 burgueno@177.7.33.214
```

Y en el navegador, `http://127.0.0.1:6080/vnc.html` → *Connect*; con el deploy
funcionando, `/pantalla` es el mismo visor sin túnel. Ahí se inicia sesión y se
activa la API local en **API & MCP**, que debe quedar en
`http://127.0.0.1:50325` con *Connection: Success*. Si dejás *API verification*
apagada, `ADSPOWER_API_KEY` va vacía en el `.env.local`.

Comprobación:

```bash
curl -s http://127.0.0.1:50325/status
curl -s "http://127.0.0.1:50325/api/v1/user/list?page=1&page_size=5"
```

Si el puerto lo tiene `sshd` en vez de `adspower_global` (`sudo ss -tlnp | grep
50325`), es que quedó abierto un túnel inverso viejo desde la PC y le robó el
puerto: cerralo y reiniciá el servicio.

### El worker de automatización

Con AdsPower en el VPS, el worker de tareas también corre ahí y la PC deja de
formar parte del sistema:

```bash
pm2 start ecosystem.config.cjs --only jesusgarcia-tasks
pm2 save
```

**Antes de mover cuentas reales**, probá una tarea con un perfil de descarte:
los perfiles creados corriendo sobre Windows pasan a lanzarse desde Linux, y
aunque AdsPower falsea la huella, un desajuste en un perfil que la plataforma ya
conoce puede encender alarmas.

Si preferís dejar AdsPower en la PC, el worker va allá en vez de acá — mismo
comando, y para que arranque con Windows: `npm install -g pm2-windows-startup`
y `pm2-startup install`. En ese caso la sincronización de perfiles necesita un
túnel inverso, documentado en `.env.example`.

### Cómo saber cuál está vivo

El chip de la barra superior tiene tres estados:

| Chip | Significa |
|---|---|
| `EN VIVO` | Los dos workers latiendo |
| `SOLO ESCUCHA` | Se ingiere, pero `jesusgarcia-tasks` está caído: las tareas en cola no avanzan |
| `SOLO TAREAS` | La automatización corre, pero nadie ingiere: la escucha solo avanza con "Buscar ahora" |
| `SIN WORKER` | Ninguno |

---

## Actualizar

```bash
cd ~/jesusgarcia && git pull && npm ci && npm run build && pm2 reload all
```

`pm2 reload` en vez de `restart`: espera a que terminen las peticiones en vuelo
en vez de cortarlas.

Lo mismo, hecho script y con los cuidados que a mano se olvidan —candado para
que no corran dos a la vez, chequeo de disco antes de tocar `node_modules`,
`npm ci` solo si cambiaron las dependencias y no reiniciar nada si el build
falla— es `deploy/update.sh`:

```bash
bash ~/jesusgarcia/deploy/update.sh            # solo si hay commits nuevos
bash ~/jesusgarcia/deploy/update.sh --force    # compila y recarga igual
```

El `--force` es para rehacer un build que quedó a medias: sin él, el script
compara commits, ve que el repo ya está en el del remoto y sale sin hacer nada.

### Deploy automático con un webhook de GitHub

Con esto, cada push a `main` actualiza el VPS solo. Son tres piezas: un
receptor que escucha en el localhost (`deploy/webhook.mjs`), nginx que le
acerca una ruta pública, y el webhook dado de alta en GitHub.

**Qué se despliega y qué no.** Solo los push a `main`; cualquier otra rama se
contesta con un 200 y no pasa nada. Si llegan tres push seguidos no se
encolan tres builds: el que está corriendo termina y después se vuelve a mirar
el remoto una sola vez, con el último commit de los tres.

**El punto a tener presente:** el deploy termina recargando los procesos de PM2
de este repo, y para los workers eso es un reinicio —una tarea de automatización en curso se corta y hay
que recuperarla. Un push a `main` a media campaña ya no es solo un commit. Si
esto molesta, la alternativa es trabajar en una rama y hacer merge a `main`
cuando la cola esté vacía.

En el VPS, como `burgueno`:

```bash
# Un secreto largo al azar; se usa dos veces: acá y en el formulario de GitHub.
openssl rand -hex 32
```

Como `root`, con ese valor:

```bash
echo 'GODEYE_WEBHOOK_SECRET=EL_SECRETO_QUE_SALIÓ_ARRIBA' > /etc/jesusgarcia-webhook.env
chmod 600 /etc/jesusgarcia-webhook.env

cp /home/burgueno/jesusgarcia/deploy/jesusgarcia-webhook.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now jesusgarcia-webhook
systemctl status jesusgarcia-webhook --no-pager

cp /home/burgueno/jesusgarcia/deploy/webhook-location.conf /etc/nginx/snippets/jesusgarcia-webhook.conf
```

El `include snippets/jesusgarcia-webhook.conf;` va dentro del server block de 443,
al lado del de la pantalla. Después, `nginx -t && systemctl reload nginx`.

Es un servicio de systemd y no una app de PM2 porque el deploy termina
recargando PM2: dentro de PM2, el receptor se reiniciaría a sí mismo y mataría
su propio build a la mitad. Como vive afuera, un cambio en `deploy/webhook.mjs`
no lo levanta el propio deploy: hay que reiniciarlo a mano con
`sudo systemctl restart jesusgarcia-webhook`. Lo de `deploy/update.sh` sí toma
efecto solo, porque se lee en cada corrida.

**Ojo, en esta máquina viven dos sistemas.** `burgueno` y `jesusgarcia`
comparten VPS y usuario, así que cada uno lleva lo suyo y nada se pisa: el
receptor en un puerto distinto (9098), su unidad de systemd, su archivo de
secreto, su log (`~/jesusgarcia-deploy.log`) y su candado. Y el deploy recarga solo
los procesos del `ecosystem.config.cjs` de este repo: un `pm2 reload all` se
llevaría puesta también la app del vecino, porque PM2 es por usuario.

En GitHub → Settings → Webhooks → Add webhook:

| Campo | Valor |
|---|---|
| Payload URL | `https://jesusgarcia.kognitic.io/_deploy/github` |
| Content type | `application/json` |
| Secret | el mismo de `/etc/jesusgarcia-webhook.env` |
| Events | Just the push event |

GitHub manda un `ping` al guardarlo; en Recent Deliveries tiene que figurar con
un `200 pong`. El resto se sigue así:

```bash
journalctl -u jesusgarcia-webhook -f    # quién llamó y qué se hizo con eso
tail -f ~/jesusgarcia-deploy.log        # la salida del build, igual que a mano
```

Un `401 firma inválida` en Recent Deliveries es el secreto distinto entre los
dos lados. Si el build falla, el log lo dice y **no** se reinicia nada: la
versión anterior sigue en pie y abajo del error queda escrito el comando para
volver atrás.


## Mantenimiento

```bash
npm run listening:repair              # simula
npm run listening:repair -- --apply   # limpia duplicados de figuras renombradas
pm2 logs --lines 100
pm2 monit
```

## Si algo falla

| Síntoma | Causa habitual |
|---|---|
| La web carga pero todo sale vacío | La IP del VPS no está en Network Access de Atlas |
| `SSL alert number 80` / "Could not connect to any servers" | Lo mismo, visto desde el otro lado: Atlas corta el TLS a las IPs que no están en la lista. Verificá además que la lista que estás mirando sea la del proyecto de Atlas donde vive el cluster: es por proyecto, no por cuenta, y editar la del proyecto equivocado no cambia nada. Una IP doméstica rota cada tanto; la del VPS es fija |
| `next build` muere sin mensaje | El VPS se quedó sin RAM. Agregá swap: `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile` |
| Links de compartir apuntan a localhost | `NEXT_PUBLIC_SHARE_BASE_URL` se cambió sin rebuild |
| El chip dice `SIN WORKER` con PM2 arriba | El worker no conecta a Mongo — `pm2 logs jesusgarcia-listening` |
| Todo cae tras reiniciar el VPS | Faltó ejecutar el comando que imprimió `pm2 startup` |
| `nginx -t` dice que el puerto ya está en uso | Otra app tomó el 3002. Cambiá `PORT` en `ecosystem.config.cjs` y el `proxy_pass` del bloque de nginx |
