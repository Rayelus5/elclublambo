# Guía de preproducción: pre.elclub.party en el Proxmox de casa

Supabase self-hosted, Cloudflare Tunnel y un runner de GitHub, todo en una máquina de Proxmox.

Esta guía la ejecuta **otra IA** con shell de root en el servidor Proxmox del humano, sin acceso a la conversación
donde se construyó el proyecto. Todo lo que necesitas está aquí o en el repo. Los valores de cada variable están en
[`entornos.md`](entornos.md). La guía de producción, que no tienes que ejecutar, es [`produccion.md`](produccion.md).

Cómo leer cada paso:

- Los comandos se copian tal cual. `<ENTRE_ÁNGULOS>` es un valor que tienes que poner tú, y el paso dice de dónde sale.
- **Comprueba:** dice qué comando ejecutar y qué salida esperar. Si no la ves, **para**: los pasos siguientes dan por
  hecho que el anterior salió bien. Investiga con la sección 12 o pregunta al humano.
- **Necesita al humano:** ese paso lo hace o lo autoriza el humano. Pídeselo con las instrucciones exactas del paso y
  espera su respuesta.
- **Verifica antes:** algo que esta guía no puede saber de antemano (nombres que dependen de la versión que clones).
  Ejecuta la comprobación y usa lo que veas, no lo que supone la guía. Apunta cada diferencia para el informe final.

Salvo que se diga otra cosa, los comandos se ejecutan **como root dentro de la VM** (no en el host de Proxmox), con
`bash`.

---

## Contexto para la IA operadora

### Qué es elclublambo

Un foro asíncrono Web3, solo con invitación. Los miembros entran firmando con su wallet (SIWE), escriben en canales,
se dan propinas en USDC, abren bounties, votan y comparten una tesorería (una Safe) en la red **Linea**. Es una app
Next.js 16 sobre Supabase (Postgres con RLS y funciones `security definer`, Auth, Storage y Realtime con canales
privados).

### Para qué sirve la preproducción

Es una copia 24/7 de la app, en `https://pre.elclub.party`, que se despliega sola desde la rama `develop`. Sirve para
probar con wallets y dinero **de prueba** (Linea Sepolia, chain id 59141) antes de que el código llegue a `main` y a
producción. Sus datos son desechables.

```
                  Cloudflare (proxy naranja, WAF)
     https://pre.elclub.party        https://pre-api.elclub.party
                 │                          │ solo /auth/v1/ /rest/v1/ /realtime/v1/ /storage/v1/
                 └────────── túnel ─────────┘
                              │  (cloudflared sale hacia Cloudflare: no se abre ningún puerto en el router)
   VM Debian 12 en Proxmox    ▼
   ┌─────────────────────────────────────────────────────────────────────────────┐
   │ proyecto compose "elclub-pre" (desde el repo, deploy/preprod/)               │
   │   web (Next.js, 127.0.0.1:3000)   cron (curl horario)   cloudflared          │
   │                                                            │ red supabase_default
   │ proyecto compose "supabase" (/opt/supabase/docker, compose oficial)          │
   │   kong (127.0.0.1:8000) auth rest realtime storage db supavisor studio ...   │
   │                                                                              │
   │ runner de GitHub (usuario gh-runner): push a develop → build → migrate → up  │
   └─────────────────────────────────────────────────────────────────────────────┘
```

La web llama a Supabase por la URL pública `https://pre-api.elclub.party`, también desde el servidor: esas llamadas
salen a Cloudflare y vuelven por el túnel (hairpin). Por eso el paso 8.8 crea una regla de WAF que no desafía a
`pre-api.elclub.party`.

### Qué hay en el repo y qué hay en la máquina

| Qué | Dónde |
|---|---|
| Compose de la app (`web`, `cron`, `cloudflared`), proyecto `elclub-pre` | repo: `deploy/preprod/docker-compose.yml` |
| Ingress del túnel (qué hostname va a qué servicio) | repo: `deploy/preprod/cloudflared/config.yml` |
| Plantilla de variables | repo: `deploy/preprod/web.env.example` |
| Workflow de despliegue | repo: `.github/workflows/preproduction.yml` |
| Imagen de la web | repo: `Dockerfile` |
| Variables reales de la web (secretas) | VM: `/opt/elclub/pre/web.env` (600, del usuario `gh-runner`) |
| Credenciales del túnel (secretas) | VM: `/opt/elclub/pre/cloudflared/credentials.json` (400, uid 65532) |
| Supabase self-hosted y su `.env` (secreto) | VM: `/opt/supabase/docker` |
| Copia del repo solo para consultas | VM: `/opt/elclub/src` |
| Copias de seguridad | VM: `/srv/backups/elclub-pre` (segundo disco de Proxmox) |

### Reglas que no se rompen

1. **Studio nunca se expone**, ni Postgres, ni Supavisor, ni ningún puerto: cada puerto publicado escucha solo en
   `127.0.0.1`. Studio se abre únicamente con un túnel SSH (paso 6). No crees hostnames, reglas de ingress ni
   port-forwards del router para Studio, `pg-meta` o la base de datos.
2. **Nunca uses aquí nada de producción**: ni el Supabase Cloud, ni la Safe de mainnet, ni el Project ID de Reown
   "elclub prod", ni el `CRON_SECRET` o las claves VAPID de producción, ni la wallet de SuperAdmin real del humano.
3. **Pregunta al humano antes de tocar DNS, Cloudflare, GitHub o ramas.** Nunca hagas push a `develop` ni a `main`.
   Si hace falta un cambio en el repo, propón el diff al humano.
4. **Ningún secreto sale de la máquina.** No pegues en el chat, en el informe ni en un log el contenido de
   `/opt/supabase/docker/.env`, de `/opt/elclub/pre/web.env` ni de las credenciales del túnel. Los comandos de esta
   guía escriben los secretos directamente en los archivos, sin imprimirlos.
5. **Nunca lances tests contra la preproducción** (`pnpm test:e2e`, `pnpm db:test`, `tests/integration`): escriben y
   borran datos.
6. **Si algo no cuadra con esta guía, para y compruébalo.** Nombres de variables, servicios o versiones pueden haber
   cambiado en el Supabase que clones. Usa lo que veas en la versión real y apúntalo para el informe.

### Lo que necesita al humano (resumen)

Pídeselo con tiempo; lo demás lo haces tú:

| Paso | Qué necesitas del humano |
|---|---|
| 1.1 | IP fija para la VM, gateway, DNS, y su clave SSH pública |
| 7.2 | Si el repo es privado: añadir una deploy key de solo lectura |
| 7.4 | `SUPER_ADMIN_WALLET` (una wallet **de pruebas**), el Project ID de Reown "elclub dev/pre", la URL de Infura de Linea Sepolia, el correo para `VAPID_SUBJECT` y, opcional, `COINGECKO_API_KEY` |
| 8.3 | Autorizar `cloudflared tunnel login` en su navegador |
| 8.7 | Permiso para crear los dos registros DNS |
| 8.8 | Crear la regla de WAF en Cloudflare (o darte un token de API para hacerlo) |
| 9.2 | Un token de registro del runner (GitHub → Settings → Actions → Runners) |
| 9.4 | Ajustes de Actions y el Environment `preproduction` con sus dos secretos |
| 10.1 | El push a `develop` (o lanzar el workflow a mano) |
| 10.3 | Primer login con la wallet de pruebas (SuperAdmin) |
| 10.4 | Crear la Safe de Linea Sepolia y guardarla en `/settings/economia` |
| 11.4 | Elegir dónde guarda Proxmox las copias de la VM |

---

## 1. Máquina en Proxmox

**Recomendación:** una **VM** con Debian 12 (bookworm), no un contenedor LXC.

| Recurso | Valor |
|---|---|
| vCPU | 4 (tipo `host`) |
| RAM | 8 GB |
| Disco del sistema | 60 GB (Docker, imágenes, base de datos) |
| Disco de copias | 40 GB, segundo disco, montado en `/srv/backups` |
| Red | IP fija en la LAN, sin puertos abiertos en el router |

Por qué VM: Docker dentro de un LXC sin privilegios funciona con `nesting=1,keyctl=1`, pero es frágil (overlayfs,
AppArmor, cgroups, y el servicio `vector` de Supabase necesita el socket de Docker). Si el humano prefiere LXC
igualmente, usa la plantilla Debian 12, `--unprivileged 1 --features nesting=1,keyctl=1`, los mismos recursos, y
sigue desde el paso 1.3. Apunta en el informe que es un LXC.

### 1.1 Datos que necesitas

En el **host de Proxmox**:

```
pveversion
pvesm status
ip -br addr
pvesh get /cluster/nextid
```

**Comprueba:** ves la versión de Proxmox (8.x), un almacenamiento con espacio para 100 GB (por ejemplo `local-lvm`),
el bridge de la LAN (normalmente `vmbr0`) y un VMID libre.

**Necesita al humano:** pídele la IP fija que quiere para la VM (en formato `192.168.x.y/24`), el gateway, el DNS y
su clave SSH pública. Comprueba que la IP está libre antes de usarla:

```
ping -c 2 -W 1 <IP_SIN_MÁSCARA>
```

**Comprueba:** `100% packet loss` (nadie la usa).

### 1.2 Crear la VM

En el host de Proxmox, sustituye `<VMID>`, `<STORAGE>`, `<BRIDGE>`, `<IP/MÁSCARA>`, `<GATEWAY>` y `<DNS>`. Guarda la
clave pública del humano en `/root/elclub-pre.pub` y añade también la tuya (genera una con
`ssh-keygen -t ed25519 -f /root/.ssh/elclub-pre -N ""` y añade `/root/.ssh/elclub-pre.pub` al mismo archivo).

```
cd /var/lib/vz/template
wget -O debian-12-genericcloud-amd64.qcow2 https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-amd64.qcow2
qm create <VMID> --name elclub-pre --memory 8192 --cores 4 --cpu host --ostype l26 --onboot 1 --agent enabled=1 --net0 virtio,bridge=<BRIDGE> --scsihw virtio-scsi-single --serial0 socket --vga serial0
qm disk import <VMID> debian-12-genericcloud-amd64.qcow2 <STORAGE>
qm set <VMID> --scsi0 <STORAGE>:vm-<VMID>-disk-0,discard=on,ssd=1 --boot order=scsi0
qm disk resize <VMID> scsi0 60G
qm set <VMID> --scsi1 <STORAGE>:40,discard=on,ssd=1
qm set <VMID> --ide2 <STORAGE>:cloudinit --ciuser elclub --sshkeys /root/elclub-pre.pub --ipconfig0 ip=<IP/MÁSCARA>,gw=<GATEWAY> --nameserver <DNS>
qm start <VMID>
```

Si `qm disk import` no existe (Proxmox 7), usa `qm importdisk`. Si el disco importado tiene otro nombre, míralo con
`qm config <VMID>` (línea `unused0`).

**Comprueba:** `qm status <VMID>` dice `status: running`, y al minuto entras con
`ssh -i /root/.ssh/elclub-pre elclub@<IP>`. Desde aquí trabajas dentro de la VM con `sudo -i`.

### 1.3 Sistema base

```
apt update && apt full-upgrade -y
apt install -y qemu-guest-agent unattended-upgrades apt-listchanges ca-certificates curl gnupg git jq openssl dnsutils
systemctl enable --now qemu-guest-agent
dpkg-reconfigure -f noninteractive unattended-upgrades
timedatectl set-timezone UTC
```

Deja SSH solo con clave:

```
printf 'PasswordAuthentication no\nPermitRootLogin prohibit-password\n' > /etc/ssh/sshd_config.d/10-elclub.conf
systemctl reload ssh
```

Limita el tamaño del journal:

```
mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=500M\n' > /etc/systemd/journald.conf.d/size.conf
systemctl restart systemd-journald
```

**Comprueba:**

- `cat /etc/apt/apt.conf.d/20auto-upgrades` muestra las dos líneas con `"1"`.
- `sshd -T | grep -E '^passwordauthentication'` → `passwordauthentication no`.
- `timedatectl | grep -E 'synchronized|Time zone'` → `System clock synchronized: yes` y `UTC`. La hora importa: los
  mensajes SIWE y los JWT caducan.
- `ip -br addr` muestra la IP fija.

### 1.4 Disco de copias

```
lsblk
```

El disco de 40 GB sin particiones es el de copias (normalmente `/dev/sdb`). **Verifica antes** que no tiene
particiones ni datos: en `lsblk` no cuelga nada de él.

```
mkfs.ext4 -L backups /dev/<DISCO>
mkdir -p /srv/backups
echo 'LABEL=backups /srv/backups ext4 defaults,nofail 0 2' >> /etc/fstab
mount -a
```

**Comprueba:** `df -h /srv/backups` muestra unos 40 GB montados en `/srv/backups`.

---

## 2. Docker

Docker Engine y el plugin de compose desde el repositorio oficial de Docker (no el paquete `docker.io` de Debian):

```
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Rotación de logs de los contenedores. Hazlo **antes** de crear contenedores: solo se aplica a los nuevos.

```
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" }
}
EOF
systemctl restart docker
```

**Comprueba:**

- `docker compose version` → `Docker Compose version v2.x` (2.24 o más: el paso 3.5 usa `!override`).
- `docker info --format '{{.LoggingDriver}}'` → `json-file`.
- `docker run --rm hello-world` termina con `Hello from Docker!`.

Ojo: Docker se salta el cortafuegos del sistema (ufw/nftables) para los puertos publicados. La única protección es
publicar en `127.0.0.1`, y por eso esta guía lo comprueba varias veces.

---

## 3. Supabase self-hosted

Supabase es un proyecto compose aparte, el oficial, en `/opt/supabase/docker`. La app no lo arranca ni lo para: solo
se une a su red `supabase_default`. Referencia oficial: <https://supabase.com/docs/guides/self-hosting/docker>.

### 3.1 Clonar

```
git clone --depth 1 https://github.com/supabase/supabase /opt/supabase
cd /opt/supabase/docker
cp .env.example .env
chmod 600 .env
git -C /opt/supabase log -1 --format='%h %cs'
```

**Comprueba:** existen `/opt/supabase/docker/docker-compose.yml` y `.env`. Apunta el commit y la fecha para el informe.

### 3.2 Verifica antes: lo que esta guía supone del compose oficial

Ejecuta cada comprobación en `/opt/supabase/docker` y anota la salida. Si algo no coincide, **usa el nombre real** en
los pasos siguientes y apúntalo.

1. El proyecto se llama `supabase`, así su red es `supabase_default`:
   ```
   grep -n '^name:' docker-compose.yml
   ```
   Esperado: `name: supabase`. Si no sale nada, añade `COMPOSE_PROJECT_NAME=supabase` al `.env`.
2. Kong es el servicio `kong` y escucha en el puerto 8000 del contenedor:
   ```
   docker compose config --services
   grep -n 'KONG_HTTP_PORT' docker-compose.yml .env
   ```
   Esperado: `kong` en la lista, `${KONG_HTTP_PORT}:8000/tcp` y `KONG_HTTP_PORT=8000`.
3. Postgres es la versión 17:
   ```
   grep -n 'image: supabase/postgres' docker-compose.yml
   ```
   Esperado: una etiqueta que empieza por `17.`.
4. Variables de Auth (GoTrue) que alimenta el `.env`:
   ```
   grep -n -E 'GOTRUE_(SITE_URL|URI_ALLOW_LIST|DISABLE_SIGNUP|EXTERNAL_EMAIL_ENABLED|EXTERNAL_PHONE_ENABLED|RATE_LIMIT)|API_EXTERNAL_URL' docker-compose.yml
   ```
   Esperado: se alimentan de `SITE_URL`, `ADDITIONAL_REDIRECT_URLS`, `DISABLE_SIGNUP`, `ENABLE_EMAIL_SIGNUP`,
   `ENABLE_PHONE_SIGNUP` y `API_EXTERNAL_URL`.
5. Supavisor (el pooler) publica el puerto de sesión, y su usuario lleva el tenant:
   ```
   grep -n -A40 '^  supavisor:' docker-compose.yml | grep -E 'container_name|5432|6543'
   grep -n 'POOLER_TENANT_ID\|^POSTGRES_PORT' .env
   ```
   Esperado: `${POSTGRES_PORT}:5432` y `${POOLER_PROXY_PORT_TRANSACTION}:6543`, y las claves `POOLER_TENANT_ID` y
   `POSTGRES_PORT=5432`. El usuario de las migraciones será `postgres.<POOLER_TENANT_ID>`.
6. Todos los servicios que publican puertos:
   ```
   docker compose config --format json | jq -r '.services | to_entries[] | select(.value.ports) | .key'
   ```
   Esperado: normalmente `kong` y `supavisor` (a veces también `analytics`). Todos irán al override de 3.5.
7. Generador de claves:
   ```
   ls utils/
   ```
   Si existe `generate-keys.sh`, el paso 3.3 lo usa.

Si la imagen de Postgres **no** es 17: la base de datos local del proyecto es la 17 (`major_version = 17` en
`supabase/config.toml`) y las migraciones se prueban ahí. **Para y pregunta al humano** antes de arrancar nada. No
cambies la versión por tu cuenta.

### 3.3 Secretos de Supabase

Una función para escribir una clave en un `.env` sin imprimir su valor (defínela en tu shell; la usarás varias veces):

```
setkv() { f="$1"; k="$2"; v="$3"; if grep -q "^$k=" "$f"; then sed -i "s|^$k=.*|$k=$v|" "$f"; else printf '%s=%s\n' "$k" "$v" >> "$f"; fi; }
```

**Si existe `utils/generate-keys.sh`:** léelo entero (`cat utils/generate-keys.sh`) para saber qué escribe y dónde.
Si escribe en `.env`, ejecútalo con `sh utils/generate-keys.sh` y redirige su salida a `/dev/null` si imprime los
secretos. Si el `.env.example` de tu versión usa claves de formato nuevo (`sb_publishable_…`/`sb_secret_…`) en lugar
de `ANON_KEY`/`SERVICE_ROLE_KEY`, sigue el generador oficial: la app funciona con los dos formatos (publishable o
anon → `NEXT_PUBLIC_SUPABASE_ANON_KEY`; secret o service_role → `SUPABASE_SERVICE_ROLE_KEY`).

**Si no existe**, genera tú los valores (hex, para que no haya caracteres especiales en URLs):

```
cd /opt/supabase/docker
setkv .env POSTGRES_PASSWORD "$(openssl rand -hex 24)"
setkv .env JWT_SECRET "$(openssl rand -hex 32)"
setkv .env DASHBOARD_USERNAME elclub
setkv .env DASHBOARD_PASSWORD "$(openssl rand -hex 16)"
setkv .env SECRET_KEY_BASE "$(openssl rand -hex 32)"
setkv .env VAULT_ENC_KEY "$(openssl rand -hex 16)"
setkv .env PG_META_CRYPTO_KEY "$(openssl rand -hex 16)"
setkv .env LOGFLARE_PUBLIC_ACCESS_TOKEN "$(openssl rand -hex 24)"
setkv .env LOGFLARE_PRIVATE_ACCESS_TOKEN "$(openssl rand -hex 24)"
setkv .env POOLER_TENANT_ID elclub-pre
```

Solo escribe las claves que existan en tu `.env.example` (compruébalo con `grep -c '^VAULT_ENC_KEY=' .env.example`,
etc.); si una no existe, sáltala.

`ANON_KEY` y `SERVICE_ROLE_KEY` son JWT firmados con `JWT_SECRET` (roles `anon` y `service_role`, emisor `supabase`):

```
JWT_SECRET="$(grep '^JWT_SECRET=' .env | cut -d= -f2-)"
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
jwt() { now=$(date +%s); h=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url); p=$(printf '{"role":"%s","iss":"supabase","iat":%d,"exp":%d}' "$1" "$now" "$((now + 157680000))" | b64url); s=$(printf '%s.%s' "$h" "$p" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | b64url); printf '%s.%s.%s' "$h" "$p" "$s"; }
setkv .env ANON_KEY "$(jwt anon)"
setkv .env SERVICE_ROLE_KEY "$(jwt service_role)"
unset JWT_SECRET
```

**Comprueba:**

```
grep -c -E '^(POSTGRES_PASSWORD|JWT_SECRET|ANON_KEY|SERVICE_ROLE_KEY|DASHBOARD_PASSWORD)=.{20,}' .env
grep -n -i -E 'your-|super-secret|insecure|changeme' .env | cut -d= -f1
```

El primero da `5`. El segundo no imprime nada (si imprime nombres de claves, esas siguen con el valor de ejemplo:
genéralas). `grep '^ANON_KEY=' .env | cut -d. -f2 | tr '_-' '/+' | base64 -d 2>/dev/null` muestra
`{"role":"anon","iss":"supabase",...}` (es la parte pública del JWT, no el secreto).

### 3.4 URLs y proveedores de login

```
cd /opt/supabase/docker
setkv .env SITE_URL https://pre.elclub.party
setkv .env ADDITIONAL_REDIRECT_URLS 'https://pre.elclub.party/**'
setkv .env API_EXTERNAL_URL https://pre-api.elclub.party
setkv .env SUPABASE_PUBLIC_URL https://pre-api.elclub.party
setkv .env DISABLE_SIGNUP false
setkv .env ENABLE_EMAIL_SIGNUP false
setkv .env ENABLE_EMAIL_AUTOCONFIRM false
setkv .env ENABLE_PHONE_SIGNUP false
setkv .env ENABLE_PHONE_AUTOCONFIRM false
setkv .env ENABLE_ANONYMOUS_USERS false
setkv .env JWT_EXPIRY 3600
setkv .env PGRST_DB_SCHEMAS public,graphql_public
```

Por qué:

- `SITE_URL=https://pre.elclub.party` y `ADDITIONAL_REDIRECT_URLS`: GoTrue solo acepta el login con wallet que viene
  de una URL permitida.
- `API_EXTERNAL_URL=https://pre-api.elclub.party`: la URL pública de Auth.
- `DISABLE_SIGNUP=false`: el registro **se queda abierto**; sin él nadie puede entrar con su wallet por primera vez.
  Email, teléfono y anónimos se apagan: la app solo entra con wallet (SIWE).
- `PGRST_DB_SCHEMAS`: los mismos esquemas que expone producción. **Nunca añadas `private`**: ahí viven los contadores
  de límites y funciones internas.

**Comprueba:** `grep -E '^(SITE_URL|ADDITIONAL_REDIRECT_URLS|API_EXTERNAL_URL|SUPABASE_PUBLIC_URL|DISABLE_SIGNUP|ENABLE_EMAIL_SIGNUP|ENABLE_PHONE_SIGNUP|PGRST_DB_SCHEMAS)=' .env`
muestra exactamente los valores de arriba (ninguno es secreto).

### 3.5 Override: Web3, límites de login y puertos solo en 127.0.0.1

Los cambios al compose oficial van en `docker-compose.override.yml`, que compose carga solo. Así `git pull` en
`/opt/supabase` no choca con tus cambios.

**Verifica antes** los nombres de las variables de GoTrue para la versión de Auth de tu compose:

```
grep -n 'image: supabase/gotrue\|image: supabase/auth' docker-compose.yml
```

Con esa etiqueta (`v2.x.y`), abre
`https://raw.githubusercontent.com/supabase/auth/<ETIQUETA>/internal/conf/configuration.go` y busca `Web3Ethereum` y
`RateLimitWeb3`. Las variables se llaman `GOTRUE_` + la ruta del campo en mayúsculas. Lo esperado es
`GOTRUE_EXTERNAL_WEB3_ETHEREUM_ENABLED`, `GOTRUE_RATE_LIMIT_WEB3`, `GOTRUE_RATE_LIMIT_TOKEN_REFRESH`,
`GOTRUE_RATE_LIMIT_VERIFY` y `GOTRUE_RATE_LIMIT_HEADER`. Si no puedes descargar el archivo, usa estos nombres y confía en la comprobación del paso
4.3, que lo detecta.

Escribe el override, ajustando el nombre de los servicios y las variables de puertos a lo que viste en el paso 3.2.
Incluye **todos** los servicios con `ports:`:

```
cat > /opt/supabase/docker/docker-compose.override.yml <<'EOF'
# elclub preproduction: Web3 login, login rate limits (= supabase/config.toml) and every host port on 127.0.0.1.
services:
  auth:
    environment:
      GOTRUE_EXTERNAL_WEB3_ETHEREUM_ENABLED: "true"
      GOTRUE_RATE_LIMIT_WEB3: "30"
      GOTRUE_RATE_LIMIT_TOKEN_REFRESH: "150"
      GOTRUE_RATE_LIMIT_VERIFY: "30"
      GOTRUE_RATE_LIMIT_HEADER: "CF-Connecting-IP"
  kong:
    ports: !override
      - "127.0.0.1:${KONG_HTTP_PORT}:8000/tcp"
      - "127.0.0.1:${KONG_HTTPS_PORT}:8443/tcp"
  supavisor:
    ports: !override
      - "127.0.0.1:${POSTGRES_PORT}:5432"
      - "127.0.0.1:${POOLER_PROXY_PORT_TRANSACTION}:6543"
EOF
```

Los límites son por IP y cada 5 minutos, los mismos de `supabase/config.toml` y de producción: Web3 30, refresco de
token 150, verificaciones 30.

`GOTRUE_RATE_LIMIT_HEADER: CF-Connecting-IP` le dice a GoTrue de qué cabecera sacar la IP del cliente para esos
límites. Sin ella, todas las peticiones llegan desde el contenedor `cloudflared` y los límites por IP acabarían
siendo **compartidos por todos los testers**. Cloudflare sobrescribe esa cabecera en cada petición, así que un
cliente no puede falsearla. **Verifica** que tu versión de GoTrue conoce la variable: en el
`configuration.go` del paso anterior, busca `RateLimitHeader` (variable `GOTRUE_RATE_LIMIT_HEADER`). Si no existe en
tu versión, quita esa línea del override y apunta en el informe que los límites de login son compartidos (con dos o
tres testers no es un problema).

**Comprueba:**

```
cd /opt/supabase/docker
docker compose config --format json | jq -r '.services | to_entries[] | select(.value.ports) | .key + " " + ([.value.ports[] | (.host_ip // "TODAS") + ":" + (.published|tostring)] | join(" "))'
docker compose config --format json | jq '.services.auth.environment | with_entries(select(.key | test("WEB3|RATE_LIMIT|SITE_URL|URI_ALLOW|DISABLE_SIGNUP|EXTERNAL_(EMAIL|PHONE)_ENABLED")))'
```

**Importante (versiones de 2026-10 en adelante):** el `.env` oficial fija `COMPOSE_FILE=docker-compose.yml`, y con
eso compose **ignora** `docker-compose.override.yml`. Inclúyelo:

```
sed -i 's|^COMPOSE_FILE=.*|COMPOSE_FILE=docker-compose.yml:docker-compose.override.yml|' /opt/supabase/docker/.env
```

En esas versiones el gateway ya no es Kong sino **Envoy**: el servicio se llama `api-gw` (contenedor
`supabase-envoy`) y publica solo el puerto `${API_GW_HTTP_PORT:-${KONG_HTTP_PORT:-8000}}:8000`. En el override usa
`api-gw:` con ese único puerto en lugar del bloque `kong:`. Conserva los alias de red `kong` y `envoy`, así que el
ingress del túnel (`http://kong:8000`) sigue funcionando sin cambios.

El primero lista cada servicio con puertos y **todos** empiezan por `127.0.0.1:`. Si alguno dice `TODAS`, añádelo al
override con `!override` y repite. El segundo muestra Web3 `"true"`, los tres límites, `GOTRUE_SITE_URL` con
`https://pre.elclub.party`, `GOTRUE_DISABLE_SIGNUP` `"false"` y email y teléfono `"false"`. Si `docker compose config`
falla en `!override`, tu compose es anterior a 2.24: actualiza el plugin (paso 2) o, como último recurso, edita
`docker-compose.yml` directamente y apúntalo (tendrás que repetirlo tras cada actualización).

---

## 4. Arrancar Supabase

### 4.1 Arranque

```
cd /opt/supabase/docker
docker compose pull
docker compose up -d
```

Espera unos dos minutos.

**Comprueba:**

- `docker compose ps --format '{{.Service}} {{.Status}}'`: todos `Up`, y los que tienen healthcheck `(healthy)`.
- `docker network ls --format '{{.Name}}' | grep -x supabase_default` → `supabase_default`.
- `ss -Htlnp | grep docker-proxy` → cada línea escucha en `127.0.0.1:<puerto>`. Ninguna en `0.0.0.0` ni en `[::]`.

### 4.2 Versión de Postgres

```
docker exec supabase-db psql -U postgres -d postgres -tAc "select version()"
```

**Comprueba:** empieza por `PostgreSQL 17.`. Debe coincidir con `major_version = 17` de `supabase/config.toml`. Si es
otra versión mayor, **para y pregunta al humano**: las migraciones y los tests pgTAP del proyecto se han probado en la
17. No sigas hasta que el humano decida (por ejemplo, pasar la suite pgTAP completa contra esta versión).

Si `psql` pide contraseña o dice `permission denied`, repite con la contraseña en el entorno (no en el comando):

```
export PGPASSWORD="$(grep '^POSTGRES_PASSWORD=' /opt/supabase/docker/.env | cut -d= -f2-)"
docker exec -e PGPASSWORD supabase-db psql -U postgres -h 127.0.0.1 -d postgres -tAc "select version()"
unset PGPASSWORD
```

### 4.3 Auth: Web3 activo, email y teléfono apagados

```
ANON="$(grep '^ANON_KEY=' /opt/supabase/docker/.env | cut -d= -f2-)"
curl -s http://127.0.0.1:8000/auth/v1/settings -H "apikey: $ANON" | jq '{web3: .external.web3_ethereum, email: .external.email, phone: .external.phone, disable_signup}'
docker exec supabase-auth env | grep -E '^GOTRUE_(EXTERNAL_WEB3|RATE_LIMIT_(WEB3|TOKEN_REFRESH|VERIFY|HEADER))'
```

En Auth v2.197 (2026-10) `/auth/v1/settings` ya **no lista** `web3_ethereum` (sale `null` aunque esté activo): en esa
versión manda el segundo comando, y la prueba definitiva es el primer login con wallet (paso 10.3).

**Comprueba:** el JSON es `{"web3": true, "email": false, "phone": false, "disable_signup": false}` y el segundo
comando muestra las variables de 3.5 (las cuatro de límites incluida `GOTRUE_RATE_LIMIT_HEADER`, si tu versión la admite). Si `web3` sale `null` o `false`, el nombre de la variable no es el de tu
versión de GoTrue: vuelve a 3.5, busca el nombre real y recrea con `docker compose up -d auth`. (Si el contenedor no
se llama `supabase-auth`, míralo con `docker compose ps auth`.)

### 4.4 Kong y la conexión de migraciones

```
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000/rest/v1/ -H "apikey: $ANON"
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000/auth/v1/health -H "apikey: $ANON"
unset ANON
```

**Comprueba:** `200` y `200`.

El workflow aplica las migraciones con `supabase db push` desde esta misma máquina, a través de Supavisor en modo
sesión (puerto `POSTGRES_PORT`, normalmente 5432) y con usuario `postgres.<POOLER_TENANT_ID>`. Pruébalo con la misma
forma de URL que usará el workflow, **sin contraseña en la URL**:

```
TENANT="$(grep '^POOLER_TENANT_ID=' /opt/supabase/docker/.env | cut -d= -f2-)"
PORT="$(grep '^POSTGRES_PORT=' /opt/supabase/docker/.env | cut -d= -f2-)"
export PGPASSWORD="$(grep '^POSTGRES_PASSWORD=' /opt/supabase/docker/.env | cut -d= -f2-)"
docker run --rm --network host -e PGPASSWORD postgres:17-alpine psql "postgresql://postgres.$TENANT@127.0.0.1:$PORT/postgres" -tAc "select current_user"
unset PGPASSWORD
echo "PREPROD_DB_URL=postgresql://postgres.$TENANT@127.0.0.1:$PORT/postgres?sslmode=disable"
```

**Comprueba:** la consulta imprime `postgres`. La última línea es el valor exacto de `PREPROD_DB_URL` (no es secreto;
apúntalo para el paso 9.4). Si sale `Tenant or user not found`, el formato del usuario de tu versión de Supavisor es
otro: revisa la documentación de self-hosting de tu versión y apunta el formato que funcione.

---

## 5. Realtime solo privado

La app solo usa canales privados de Realtime, protegidos por políticas. Cerrar los públicos es una defensa extra
(como "Allow public access" apagado en producción).

**Verifica antes** que la columna existe en tu versión de Realtime:

```
docker exec supabase-db psql -U postgres -d postgres -tAc "select column_name from information_schema.columns where table_schema = '_realtime' and table_name = 'tenants' and column_name = 'private_only'"
```

Si imprime `private_only`:

```
docker exec supabase-db psql -U postgres -d postgres -c "update _realtime.tenants set private_only = true"
cd /opt/supabase/docker && docker compose restart realtime
```

Espera a que `realtime` vuelva a `Up (healthy)` y **comprueba después del reinicio** (el arranque de Realtime
puede volver a escribir el tenant con sus valores por defecto):

```
docker exec supabase-db psql -U postgres -d postgres -tAc "select external_id, private_only from _realtime.tenants"
```

Si el `update` da `permission denied`, repítelo como `supabase_admin` con la contraseña en el entorno (como en 4.2,
con `-U supabase_admin -h 127.0.0.1`).

**Comprueba:** cada tenant sale con `|t` (si tras el reinicio vuelve a `|f`, repite el `update` y el reinicio, y
apúntalo en el informe), y `docker compose ps realtime` está `Up (healthy)`. Repite esta comprobación después de
cada actualización de Supabase (sección 11.2).

**Si vuelve a `|f` tras el reinicio** (pasa en las versiones de 2026-10): Realtime re-siembra el tenant en cada
arranque porque el compose oficial trae `SEED_SELF_HOST: "true"`. El tenant ya existe tras el primer arranque, así que
añade al override

```
  realtime:
    environment:
      SEED_SELF_HOST: "false"
```

aplica con `docker compose up -d realtime`, repite el `update` (como `supabase_admin`) y el reinicio, y comprueba que
ahora se queda en `|t`.

Si la columna no existe, no hagas nada más: apúntalo en el informe y sigue. La app funciona igual, porque solo usa
topics privados.

---

## 6. Studio

Studio nunca se publica: ni en el túnel, ni en el router, ni en `0.0.0.0`. Kong lo sirve en `127.0.0.1:8000` con
usuario y contraseña (`DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD` del `.env`), y solo se llega con un túnel SSH desde
el PC del humano:

```
ssh -L 8000:127.0.0.1:8000 elclub@<IP_DE_LA_VM>
```

Y en su navegador, `http://localhost:8000`. Dile al humano cómo leer la contraseña él mismo:
`sudo grep '^DASHBOARD_PASSWORD=' /opt/supabase/docker/.env`.

**Comprueba:** desde otra máquina de la LAN (o desde el host de Proxmox),
`curl -s --max-time 5 -o /dev/null -w '%{http_code}\n' http://<IP_DE_LA_VM>:8000/` → `000` (conexión rechazada).
Tras el paso 8, `curl -s -o /dev/null -w '%{http_code}\n' https://pre-api.elclub.party/` → `404`.

---

## 7. Entorno de la web

### 7.1 Usuario del runner y carpetas

El runner de GitHub (paso 9) corre como `gh-runner`, sin root, en el grupo `docker`. Estar en `docker` equivale a
root en esta máquina; se acepta porque la VM solo sirve para esto.

```
adduser --disabled-password --gecos "" gh-runner
usermod -aG docker gh-runner
install -d -m 750 -o gh-runner -g gh-runner /opt/elclub/pre
install -d -m 700 -o root -g root /opt/elclub/pre/cloudflared
```

**Comprueba:** `id gh-runner` incluye `docker`, y `runuser -u gh-runner -- docker ps` lista los contenedores de
Supabase sin `permission denied`.

### 7.2 Copia del repo para consultas

Esta copia solo sirve para leer la plantilla, validar el túnel y ejecutar `check:rpc`. **No** es la que despliega:
el runner hace su propio checkout.

```
curl -s -o /dev/null -w '%{http_code}\n' https://github.com/Rayelus5/elclublambo
```

- `200` (repo público):
  `git clone --branch develop https://github.com/Rayelus5/elclublambo /opt/elclub/src`
- `404` (repo privado). **Necesita al humano:** genera una clave y pídele que la añada en GitHub → repo → Settings →
  Deploy keys → Add deploy key, **sin** "Allow write access":
  ```
  ssh-keygen -t ed25519 -f /root/.ssh/elclub_deploy -N "" -C elclub-pre-readonly
  cat /root/.ssh/elclub_deploy.pub
  ```
  Cuando confirme:
  ```
  GIT_SSH_COMMAND='ssh -i /root/.ssh/elclub_deploy -o StrictHostKeyChecking=accept-new' git clone --branch develop git@github.com:Rayelus5/elclublambo.git /opt/elclub/src
  ```

**Comprueba:** `ls /opt/elclub/src/deploy/preprod/` muestra `docker-compose.yml`, `web.env.example`, `cloudflared` y
`cron`. Si `develop` no existe o no tiene `deploy/preprod/`, la rama de producción (F5) aún no está mergeada:
**para y pregunta al humano**.

Para actualizarla más adelante: `git -C /opt/elclub/src pull` (con el mismo `GIT_SSH_COMMAND` si es privado).

### 7.3 Crear `web.env`

```
install -m 600 -o gh-runner -g gh-runner /opt/elclub/src/deploy/preprod/web.env.example /opt/elclub/pre/web.env
```

**Comprueba:** `stat -c '%a %U' /opt/elclub/pre/web.env` → `600 gh-runner`.

### 7.4 Rellenar `web.env`

Usa la función `setkv` del paso 3.3 (si abriste otra shell, vuelve a definirla). Valores de cada clave (la tabla completa de entornos está en
[`entornos.md`](entornos.md)):

| Clave | Valor en preproducción | Lo pones |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://pre-api.elclub.party` (ya viene en la plantilla) | nada |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `ANON_KEY` de `/opt/supabase/docker/.env` | tú |
| `SUPABASE_SERVICE_ROLE_KEY` | `SERVICE_ROLE_KEY` de `/opt/supabase/docker/.env` | tú |
| `SUPER_ADMIN_WALLET` | una wallet **de pruebas** del humano (`0x` + 40 hex). Nunca su wallet de SuperAdmin de producción | humano |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | Project ID del proyecto de Reown **"elclub dev/pre"**, con `pre.elclub.party` en su allowlist | humano |
| `NEXT_PUBLIC_CHAIN` | `lineaSepolia` (ya viene) | nada |
| `NEXT_PUBLIC_SITE_URL` | `https://pre.elclub.party` (ya viene) | nada |
| `LINEA_RPC_URL` | vacía (la preproducción no usa mainnet) | nada |
| `LINEA_SEPOLIA_RPC_URL` | `https://linea-sepolia.infura.io/v3/<clave>`, la de Infura del humano para Sepolia | humano |
| `NEXT_PUBLIC_LINEA_RPC_URL` | vacía. Nunca una clave aquí: va al navegador | nada |
| `NEXT_PUBLIC_LINEA_SEPOLIA_RPC_URL` | vacía. Nunca una clave aquí: va al navegador | nada |
| `TIP_CONFIRMATIONS` | `3` (ya viene) | nada |
| `ETH_USD_FEED_ADDRESS_59141` | vacía (solo tests) | nada |
| `WETH_ADDRESS_59141` | vacía (solo tests) | nada |
| `COINGECKO_DISABLED` | vacía (solo tests) | nada |
| `COINGECKO_API_BASE` | vacía (solo tests) | nada |
| `COINGECKO_API_KEY` | opcional, del humano; vacía funciona con la API pública | humano |
| `VAPID_PUBLIC_KEY` | generada aquí (abajo) | tú |
| `VAPID_PRIVATE_KEY` | generada aquí (abajo) | tú |
| `VAPID_SUBJECT` | `mailto:<correo del humano>` | humano |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | el mismo valor que `VAPID_PUBLIC_KEY` | tú |
| `CRON_SECRET` | `openssl rand -hex 32`, propio de preproducción | tú |

Todas las `NEXT_PUBLIC_*` quedan **fijadas en la imagen al construir** (son build args del compose) y las URLs tienen
que ser `https://`: el `Dockerfile` rechaza construir si `NEXT_PUBLIC_SUPABASE_URL` o `NEXT_PUBLIC_SITE_URL` no lo
son. Cambiar una `NEXT_PUBLIC_*` obliga a reconstruir (paso 11.1).

Lo que pones tú:

```
E=/opt/elclub/pre/web.env
S=/opt/supabase/docker/.env
setkv $E NEXT_PUBLIC_SUPABASE_ANON_KEY "$(grep '^ANON_KEY=' $S | cut -d= -f2-)"
setkv $E SUPABASE_SERVICE_ROLE_KEY "$(grep '^SERVICE_ROLE_KEY=' $S | cut -d= -f2-)"
setkv $E CRON_SECRET "$(openssl rand -hex 32)"
docker run --rm node:22-bookworm-slim npx -y web-push@3.6.7 generate-vapid-keys --json > /root/vapid.json
setkv $E VAPID_PUBLIC_KEY "$(jq -r .publicKey /root/vapid.json)"
setkv $E NEXT_PUBLIC_VAPID_PUBLIC_KEY "$(jq -r .publicKey /root/vapid.json)"
setkv $E VAPID_PRIVATE_KEY "$(jq -r .privateKey /root/vapid.json)"
shred -u /root/vapid.json
```

**Necesita al humano:** pídele los valores de su columna. Para que no tengan que pasar por el chat, lo mejor es que él
mismo entre por SSH y los escriba con `sudo nano /opt/elclub/pre/web.env`. Si te los da, escríbelos con `setkv` y no
los repitas en ningún mensaje. Recuérdale que el proyecto de Reown "elclub dev/pre" tiene que tener
`pre.elclub.party` en su allowlist (dashboard.reown.com → proyecto → Domain allowlist).

**Comprueba** (no imprime valores):

```
awk -F= '!/^#/ && NF { print $1, (length($2) ? "puesta" : "VACÍA") }' /opt/elclub/pre/web.env
grep -c -E '^NEXT_PUBLIC_(SUPABASE|SITE)_URL=https://' /opt/elclub/pre/web.env
stat -c '%a %U' /opt/elclub/pre/web.env
```

- Puestas: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPER_ADMIN_WALLET`, `NEXT_PUBLIC_REOWN_PROJECT_ID`, `NEXT_PUBLIC_CHAIN`, `NEXT_PUBLIC_SITE_URL`,
  `LINEA_SEPOLIA_RPC_URL`, `TIP_CONFIRMATIONS`, las cuatro VAPID y `CRON_SECRET` (y `COINGECKO_API_KEY` si la dio).
- Vacías: el resto.
- El segundo comando da `2` y el tercero `600 gh-runner`.

### 7.5 Comprobar la RPC de Sepolia

La app necesita una RPC con estado de archivo y `eth_getLogs` de al menos 2000 bloques. El script no imprime la
clave, solo `origen/***`. Desde un checkout con dependencias sería `pnpm check:rpc -- --chain 59141`; aquí no hace
falta instalar Node, basta con la forma `node --env-file` dentro de un contenedor:

```
docker run --rm -v /opt/elclub/pre/web.env:/web.env:ro -v /opt/elclub/src/scripts/check-rpc.mjs:/check-rpc.mjs:ro node:22-bookworm-slim node --env-file=/web.env /check-rpc.mjs --chain 59141; echo "exit $?"
```

**Comprueba:** la salida es

```
Comprobando https://linea-sepolia.infura.io/*** en Linea Sepolia (59141)
OK eth_chainId 59141
OK eth_blockNumber <número>
OK archive state at block <número>
OK eth_getLogs over 2001 blocks
exit 0
```

Cuatro `OK` y `exit 0`. Un `FAIL archive` o `FAIL eth_getLogs` quiere decir que el plan de Infura no sirve: díselo al
humano. `Falta la variable LINEA_SEPOLIA_RPC_URL` quiere decir que no está en `web.env`.

---

## 8. Cloudflare Tunnel

Un túnel **gestionado localmente**: el ingress vive en el repo (`deploy/preprod/cloudflared/config.yml`), el túnel
se llama `elclub-pre` y corre en el contenedor `cloudflared` del compose. El binario que instalas aquí solo sirve para
administrar (login, crear, DNS, validar); no lo instales como servicio.

El ingress del repo:

| Hostname | Ruta | Va a |
|---|---|---|
| `pre.elclub.party` | todas | `http://web:3000` |
| `pre-api.elclub.party` | `/auth/v1/`, `/rest/v1/`, `/realtime/v1/`, `/storage/v1/` | `http://kong:8000` |
| `pre-api.elclub.party` | cualquier otra (Studio, `/pg/`, `/`) | `http_status:404` |
| cualquier otro | — | `http_status:404` |

### 8.1 Requisito

**Necesita al humano:** confirma que la zona `elclub.party` está en su cuenta de Cloudflare (nameservers de
Cloudflare activos).

### 8.2 Instalar `cloudflared`

```
mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' > /etc/apt/sources.list.d/cloudflared.list
apt update && apt install -y cloudflared
```

Si `apt update` falla con la suite `any`, cambia `any` por `bookworm`.

**Comprueba:** `cloudflared --version` imprime una versión.

### 8.3 Login

```
cloudflared tunnel login
```

Imprime una URL. **Necesita al humano:** que la abra, elija la zona `elclub.party` y autorice.

**Comprueba:** existe `/root/.cloudflared/cert.pem`.

### 8.4 Crear el túnel

```
cloudflared tunnel create elclub-pre
cloudflared tunnel list
```

**Comprueba:** la salida dice `Created tunnel elclub-pre with id <UUID>` y existe `/root/.cloudflared/<UUID>.json`.
Apunta el UUID (no es secreto; el JSON sí). Si el túnel ya existía y falta el JSON, regenéralo con
`cloudflared tunnel token --cred-file /root/.cloudflared/<UUID>.json elclub-pre`.

### 8.5 Instalar las credenciales

El contenedor `cloudflared` corre como el usuario `nonroot` de la imagen, **uid 65532**, que tiene que poder leer el
archivo:

```
install -m 400 -o 65532 -g 65532 /root/.cloudflared/<UUID>.json /opt/elclub/pre/cloudflared/credentials.json
```

**Comprueba:**

```
stat -c '%a %u:%g' /opt/elclub/pre/cloudflared/credentials.json
docker run --rm --user 65532:65532 -v /opt/elclub/pre/cloudflared/credentials.json:/c.json:ro alpine:3.20 sh -c 'test -r /c.json && echo legible'
```

→ `400 65532:65532` y `legible`.

### 8.6 Validar el ingress del repo

```
C=/opt/elclub/src/deploy/preprod/cloudflared/config.yml
cloudflared tunnel ingress validate --config $C
cloudflared tunnel ingress rule --config $C https://pre-api.elclub.party/project/default
cloudflared tunnel ingress rule --config $C https://pre-api.elclub.party/pg/tables
cloudflared tunnel ingress rule --config $C https://pre-api.elclub.party/rest/v1/
cloudflared tunnel ingress rule --config $C https://pre.elclub.party/login
```

**Comprueba:** `validate` dice `OK`. Cada `cloudflared tunnel ingress rule` imprime la regla que casa:

- `/project/default` (Studio) → `service: http_status:404`
- `/pg/tables` (pg-meta) → `service: http_status:404`
- `/rest/v1/` → `service: http://kong:8000`
- `pre.elclub.party/login` → `service: http://web:3000`

### 8.7 DNS

**Necesita al humano:** pide permiso para crear dos CNAME con proxy (nube naranja) hacia el túnel. Si ya existe algún
registro `pre` o `pre-api`, el humano decide si se borra.

```
cloudflared tunnel route dns elclub-pre pre.elclub.party
cloudflared tunnel route dns elclub-pre pre-api.elclub.party
```

**Comprueba:** los dos comandos dicen `Added CNAME ... which will route to this tunnel`, y
`dig +short pre-api.elclub.party` devuelve IPs de Cloudflare.

### 8.8 Regla de WAF para `pre-api.elclub.party`

La web llama a Supabase desde el servidor (con la clave service role) por `https://pre-api.elclub.party`, pasando por
Cloudflare. Si Cloudflare desafía esas llamadas ("Just a moment…", captcha), el servidor recibe HTML en lugar de JSON
y el login y las acciones fallan.

**Necesita al humano** (o un token de API de Cloudflare con permiso de WAF en la zona que él te dé). En el panel de
Cloudflare → `elclub.party` → **Security → WAF → Custom rules** (en el panel nuevo, **Security → Security rules**):

1. **Create rule**. Nombre: `pre-api: sin desafíos (hairpin del servidor)`.
2. Expresión: `(http.host eq "pre-api.elclub.party")`.
3. Acción: **Skip**. Marca todo lo que ofrezca: *All remaining custom rules*, *All rate limiting rules*, *All
   managed rules*, *All Super Bot Fight Mode Rules*, y en *More components to skip*: *Browser Integrity Check*,
   *Security Level*, *User Agent Blocking* y *Zone Lockdown*.
4. Colócala la **primera** y guarda.
5. En **Security → Bots**: si **Bot Fight Mode** (el gratuito) está activo, **apágalo**. Una regla de WAF no puede
   saltárselo.
6. En **Network**, **WebSockets** activado (Realtime lo necesita). Viene activado.

Producción no se ve afectada: `elclub.party` está en "solo DNS" (nube gris).

**Comprueba** (después de 8.9, con el túnel corriendo):

```
ANON="$(grep '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' /opt/elclub/pre/web.env | cut -d= -f2-)"
curl -s -D - -o /dev/null https://pre-api.elclub.party/auth/v1/health -H "apikey: $ANON" | grep -i -E '^HTTP|cf-mitigated'
unset ANON
```

→ `HTTP/2 200` y ninguna línea `cf-mitigated`.

### 8.9 Probar el túnel antes del primer despliegue

Arranca un `cloudflared` temporal con la misma imagen, configuración y red que el compose:

```
docker run -d --name cf-test --network supabase_default -v /opt/elclub/src/deploy/preprod/cloudflared/config.yml:/etc/cloudflared/config.yml:ro -v /opt/elclub/pre/cloudflared/credentials.json:/etc/cloudflared/credentials.json:ro cloudflare/cloudflared:2026.10.0 tunnel --config /etc/cloudflared/config.yml run
sleep 15
docker logs cf-test 2>&1 | grep -E 'Registered tunnel connection|ERR' | head
curl -s -o /dev/null -w '%{http_code}\n' https://pre-api.elclub.party/
curl -s -o /dev/null -w '%{http_code}\n' https://pre-api.elclub.party/project/default
```

**Comprueba:** varias líneas `Registered tunnel connection` y ninguna `ERR`; `404` y `404`. Haz ahora la comprobación
de 8.8. (`https://pre.elclub.party` dará 502 hasta el primer despliegue: es normal, la web aún no existe.) Después:

```
docker rm -f cf-test
```

**Si arrancar por nombre falla** (en los logs sale algo sobre `origin certificate`, `cert.pem` o que no encuentra el
túnel `elclub-pre`): prueba con el UUID, que no necesita `cert.pem`. Repite el `docker run` anterior cambiando el
final por `tunnel --config /etc/cloudflared/config.yml run <UUID>`. Si así funciona, el arreglo permanente es cambiar
en el repo la línea `tunnel: elclub-pre` de `deploy/preprod/cloudflared/config.yml` por `tunnel: <UUID>` (el UUID no
es secreto). **Necesita al humano:** propónselo como PR a `develop`; tú no hagas push.

---

## 9. Runner de GitHub

El workflow `.github/workflows/preproduction.yml` corre en `runs-on: [self-hosted, linux, elclub-pre]`. El runner va
en esta misma VM, como `gh-runner` (paso 7.1), con las etiquetas `self-hosted,linux,elclub-pre`.

### 9.1 Ajustes de seguridad del repo

**Necesita al humano**, en GitHub → repo → Settings → Actions → General:

1. **Fork pull request workflows from outside collaborators:** *Require approval for all outside collaborators*. El
   workflow no tiene trigger `pull_request`, pero un runner self-hosted nunca debe ejecutar código de un fork.
2. **Workflow permissions:** *Read repository contents and packages permissions*.

### 9.2 Token de registro

**Necesita al humano:** GitHub → repo → Settings → Actions → Runners → **New self-hosted runner** → Linux, x64. La
página muestra los comandos de descarga con la **versión** y el **SHA-256** del runner, y un comando
`./config.sh --url https://github.com/Rayelus5/elclublambo --token <TOKEN>`. Pídele la versión, el SHA-256 y el
token (caduca en una hora; no es reutilizable una vez registrado el runner).

### 9.3 Instalar y registrar

```
install -d -m 750 -o gh-runner -g gh-runner /home/gh-runner/actions-runner
cd /home/gh-runner/actions-runner
runuser -u gh-runner -- curl -fsSLo actions-runner.tar.gz https://github.com/actions/runner/releases/download/v<VERSIÓN>/actions-runner-linux-x64-<VERSIÓN>.tar.gz
echo "<SHA256>  actions-runner.tar.gz" | sha256sum -c
runuser -u gh-runner -- tar xzf actions-runner.tar.gz
./bin/installdependencies.sh
runuser -u gh-runner -- ./config.sh --unattended --url https://github.com/Rayelus5/elclublambo --token <TOKEN> --name elclub-pre --labels elclub-pre --work _work --replace
./svc.sh install gh-runner
./svc.sh start
```

`config.sh` añade solas las etiquetas `self-hosted`, `Linux` y `X64` (GitHub no distingue mayúsculas), y tú añades
`elclub-pre`.

**Comprueba:**

- `sha256sum -c` dice `actions-runner.tar.gz: OK`.
- `./svc.sh status` → `active (running)`.
- `runuser -u gh-runner -- docker ps` funciona sin `permission denied`.
- **Necesita al humano:** en Settings → Actions → Runners aparece `elclub-pre` en estado **Idle** con las etiquetas
  `self-hosted`, `Linux`, `X64` y `elclub-pre`.

El runner se actualiza solo. Su checkout queda en `/home/gh-runner/actions-runner/_work/elclublambo/elclublambo`.

### 9.4 Environment `preproduction` y sus secretos

El workflow lee dos secretos del GitHub Environment `preproduction`:

| Secreto | Valor |
|---|---|
| `PREPROD_DB_URL` | la URL del paso 4.4, **sin contraseña**: `postgresql://postgres.<POOLER_TENANT_ID>@127.0.0.1:<POSTGRES_PORT>/postgres?sslmode=disable` (Supavisor local no habla TLS y `supabase db push` lo exige si no se le dice; en `127.0.0.1` no hay red que cifrar) |
| `PREPROD_DB_PASSWORD` | `POSTGRES_PASSWORD` de `/opt/supabase/docker/.env` |

El workflow pasa `PREPROD_DB_PASSWORD` a `supabase db push` como `PGPASSWORD`, así la contraseña nunca aparece en la
línea de comandos del runner. `127.0.0.1` funciona porque el runner está en la misma VM que Supavisor.

**Necesita al humano**, en GitHub → repo → Settings → Environments → **New environment** → `preproduction`:

1. **Deployment branches and tags:** *Selected branches and tags* → añade `develop`.
2. **Add environment secret** `PREPROD_DB_URL` con la URL que le das (no es secreta).
3. **Add environment secret** `PREPROD_DB_PASSWORD`. Para que la contraseña no pase por el chat, que la lea él mismo
   por SSH: `sudo grep '^POSTGRES_PASSWORD=' /opt/supabase/docker/.env | cut -d= -f2-`.

Alternativa, si el humano te da un token de GitHub con permiso de escritura en los secretos de este repo: instala
`gh` y canaliza el valor sin imprimirlo,
`grep '^POSTGRES_PASSWORD=' /opt/supabase/docker/.env | cut -d= -f2- | gh secret set PREPROD_DB_PASSWORD --env preproduction --repo Rayelus5/elclublambo`.

**Comprueba:** el humano ve en el Environment `preproduction` los dos secretos y la regla de rama `develop`.

---

## 10. Primer despliegue

Antes de lanzarlo, todo esto tiene que estar hecho: Supabase sano (4), `web.env` completo (7.4), RPC con 4 `OK`
(7.5), túnel probado (8.9), WAF (8.8), runner Idle (9.3) y los dos secretos (9.4).

### 10.1 Lanzarlo

**Necesita al humano:** un push a `develop`, o GitHub → Actions → **preproduction** → **Run workflow** en `develop`.

Mientras corre, en la VM:

```
journalctl -u 'actions.runner.*' -f
```

**Comprueba:** en GitHub el run termina en verde, con los pasos en este orden: **Build** → **Migrate** → **Restart**
→ **Smoke** → **Prune dangling images**. En **Migrate**, `supabase db push` lista las migraciones que aplica. Si falla
**Build** o **Migrate**, no se reinicia nada (sección 12).

### 10.2 Comprobaciones

```
docker compose -p elclub-pre ps --format '{{.Service}} {{.Status}}'
curl -s -o /dev/null -w '%{http_code}\n' https://pre.elclub.party/login
curl -s -o /dev/null -w '%{http_code}\n' https://pre-api.elclub.party/
curl -sI https://pre.elclub.party/login | grep -i -E '^(content-security-policy|strict-transport-security)' | grep -o -E "connect-src [^;]*|max-age=[0-9]+[^;]*"
docker exec supabase-db psql -U postgres -d postgres -tAc "select count(*) from supabase_migrations.schema_migrations"
ls /home/gh-runner/actions-runner/_work/elclublambo/elclublambo/supabase/migrations/*.sql | wc -l
```

**Comprueba:**

- `web Up (healthy)`, `cron Up`, `cloudflared Up`.
- `200` para `/login` y `404` para la raíz de `pre-api`.
- `connect-src` contiene `https://pre-api.elclub.party` y `wss://pre-api.elclub.party`, y HSTS `max-age=63072000`.
- Los dos últimos números son iguales (todas las migraciones aplicadas).

### 10.3 SuperAdmin

La base de datos está vacía. El primer login con la wallet de `SUPER_ADMIN_WALLET` crea al SuperAdmin.

**Necesita al humano:** que abra `https://pre.elclub.party`, conecte la wallet **de pruebas** que puso en
`SUPER_ADMIN_WALLET` y firme el mensaje.

**Comprueba:** entra al foro sin invitación, y
`docker exec supabase-db psql -U postgres -d postgres -tAc "select count(*) from auth.users"` → `1`.

### 10.4 Red y Safe de Sepolia

La red activa arranca en **Linea Sepolia (59141)**, que es la correcta para preproducción: **no la cambies**.

**Necesita al humano:**

1. Crear una Safe en Linea Sepolia (app.safe.global) con su wallet de pruebas.
2. Ir a `https://pre.elclub.party/settings/economia`, tarjeta **Linea Sepolia**: rellenar **Safe (Linea Sepolia)** y
   **Wallet de la plataforma (Linea Sepolia)**, y pulsar **Guardar direcciones**.

**Comprueba:** en `/settings/economia`, **Red activa** es Linea Sepolia y las dos direcciones aparecen guardadas.

### 10.5 Cron

El contenedor `cron` llama a `/api/cron/dao` cada hora en punto (UTC). Después de la siguiente hora en punto:

```
docker logs elclub-pre-cron-1 2>&1 | tail -5
```

**Comprueba:** aparece `cron dao ok`. Si sale `curl: (22) ... error: 401` o `503`, mira la sección 12.

### 10.6 Prueba de uso

**Necesita al humano** (opcional pero recomendado): con dos navegadores, el SuperAdmin crea una invitación, la
segunda wallet de pruebas entra con ella, y uno escribe un mensaje que el otro ve aparecer sin recargar (Realtime).
Si tiene USDC de Sepolia, una propina de 0.01 USDC.

---

## 11. Mantenimiento

### 11.1 Redesplegar y volver atrás

- **Redesplegar:** cada push a `develop` despliega. Para repetir sin push: Actions → preproduction → **Run workflow**
  en `develop`, o **Re-run all jobs** en un run.
- **Cambiar una `NEXT_PUBLIC_*`:** edita `web.env` y relanza el workflow. Hace falta reconstruir: el valor (y la CSP
  calculada con él) está dentro de la imagen.
- **Cambiar una variable de servidor** (sin `NEXT_PUBLIC_`): edita `web.env` y recrea sin reconstruir, desde el
  checkout del runner:
  ```
  cd /home/gh-runner/actions-runner/_work/elclublambo/elclublambo
  runuser -u gh-runner -- docker compose --env-file /opt/elclub/pre/web.env -f deploy/preprod/docker-compose.yml up -d --no-build --force-recreate web cron
  ```
- **Tras cambiar `deploy/preprod/cloudflared/config.yml` o `deploy/preprod/cron/crontab`:** no hace falta hacer nada
  a mano. Los archivos montados pueden quedarse con la versión anterior, así que el workflow recrea siempre `cron` y
  `cloudflared` (`--force-recreate`) después de `up -d`.
- **Volver atrás:** que el humano haga `git revert` del commit en `develop` y push: el workflow construye la versión
  anterior. Las migraciones **no** se deshacen: un **Re-run** de un run antiguo falla en **Migrate** si la base de
  datos ya tiene migraciones más nuevas (y entonces no reinicia nada). Una migración mala se arregla con otra
  migración nueva (hacia delante), en un PR. Como último recurso, los datos de preproducción son desechables: con
  permiso del humano, se puede vaciar la base de datos y volver a desplegar (y luego repetir 10.3 y 10.4).

### 11.2 Actualizaciones

- **Sistema:** `unattended-upgrades` aplica los parches de seguridad. Una vez al mes: `apt update && apt full-upgrade
  -y`; si existe `/var/run/reboot-required`, reinicia (`reboot`). Todos los contenedores tienen `restart:
  unless-stopped` y vuelven solos. **Comprueba:** tras reiniciar, 10.2 sale igual.
- **Supabase:**
  ```
  cd /opt/supabase && OLD=$(git rev-parse HEAD) && git pull
  git diff $OLD HEAD -- docker/.env.example docker/docker-compose.yml
  ```
  Lee el diff: añade a `.env` las claves nuevas, y comprueba que el override sigue valiendo (nombres de servicios y
  variables). Luego `cd docker && docker compose pull && docker compose up -d` y repite 3.5 (comprobación de puertos),
  4.1, 4.2 y 4.3, y la comprobación de `private_only` de la sección 5. Si el diff cambia la versión **mayor** de Postgres, **no actualices**: pregunta al humano.
- **cloudflared:** la imagen está fijada en el compose del repo; se actualiza con un PR.
- **Runner:** se actualiza solo.

### 11.3 Logs

- Web: `docker compose -p elclub-pre logs -f web`
- Cron: `docker logs elclub-pre-cron-1`
- Túnel: `docker logs elclub-pre-cloudflared-1`
- Supabase: `cd /opt/supabase/docker && docker compose logs -f auth` (o `rest`, `realtime`, `storage`, `kong`)
- Runner: `journalctl -u 'actions.runner.*'`

Rotación: `daemon.json` (paso 2) limita cada contenedor a 5 × 10 MB, y el journal a 500 MB (paso 1.3).

### 11.4 Copias de seguridad

Los datos de preproducción son desechables, pero una copia nocturna con 7 días de historia ahorra rehacer pruebas.
Script:

```
cat > /usr/local/sbin/elclub-pre-backup <<'EOF'
#!/bin/sh
# Nightly backup of the preproduction DB and Storage files, 7 days kept. The password never reaches argv.
set -eu
DEST=/srv/backups/elclub-pre
STAMP=$(date -u +%Y%m%dT%H%MZ)
umask 077
mkdir -p "$DEST"
PGPASSWORD=$(grep '^POSTGRES_PASSWORD=' /opt/supabase/docker/.env | cut -d= -f2-)
export PGPASSWORD
docker exec -e PGPASSWORD supabase-db pg_dump -U supabase_admin -h 127.0.0.1 -d postgres -Fc > "$DEST/db-$STAMP.dump"
tar -C /opt/supabase/docker/volumes -czf "$DEST/storage-$STAMP.tar.gz" storage
find "$DEST" -type f -mtime +7 -delete
echo "backup ok $STAMP"
EOF
chmod 700 /usr/local/sbin/elclub-pre-backup
echo '30 3 * * * root /usr/local/sbin/elclub-pre-backup >> /var/log/elclub-pre-backup.log 2>&1' > /etc/cron.d/elclub-pre-backup
echo '0 4 * * 0 root docker builder prune -f --filter until=168h >> /var/log/elclub-pre-backup.log 2>&1' >> /etc/cron.d/elclub-pre-backup
/usr/local/sbin/elclub-pre-backup
```

`pg_dump` corre dentro del contenedor de la base de datos, así su versión coincide con la del servidor (el
`pg_dump` de Debian 12 es más viejo y se negaría). **Verifica antes** que la carpeta de Storage es
`/opt/supabase/docker/volumes/storage` (`ls /opt/supabase/docker/volumes`).

**Comprueba:**

```
ls -la /srv/backups/elclub-pre
docker exec -i supabase-db pg_restore --list < "$(ls -t /srv/backups/elclub-pre/db-*.dump | head -1)" | head -5
```

→ un `.dump` y un `.tar.gz` de más de 0 bytes, y `pg_restore --list` muestra la cabecera del archivo (`; Archive
created at ...`). Si `pg_dump` falla con `supabase_admin`, prueba `-U postgres`.

**Necesita al humano:** que en Proxmox (Datacenter → Backup) programe una copia de la VM, idealmente a otro
almacenamiento (Proxmox Backup Server o un NAS). Así `/srv/backups` (que está en el segundo disco de la VM) y los
archivos secretos (`.env`, `web.env`, credenciales) quedan también fuera de la VM.

Restaurar una copia en preproducción es destructivo: hazlo solo con permiso del humano, y con
`docker exec -i -e PGPASSWORD supabase-db pg_restore -U supabase_admin -h 127.0.0.1 -d postgres --clean --if-exists < <archivo>`.
Después repite 10.3 y 10.4 si hace falta.

### 11.5 Disco

```
df -h / /srv/backups
docker system df
docker image prune -f
```

El workflow ya borra las imágenes huérfanas tras cada despliegue, y el cron del domingo limpia la caché de build de
más de una semana.

### 11.6 Rotar secretos

Nunca reutilices un secreto de producción. Tras cada rotación, repite 10.2.

| Secreto | Cómo |
|---|---|
| `CRON_SECRET` | `setkv` con `openssl rand -hex 32` en `web.env`, y recrea `web` y `cron` juntos (11.1). Si solo recreas uno, el cron recibe 401 |
| `LINEA_SEPOLIA_RPC_URL`, `COINGECKO_API_KEY`, `VAPID_PRIVATE_KEY` | nuevo valor en `web.env` y recrea `web` (11.1). Las VAPID van en pareja: una pareja nueva cambia también `VAPID_PUBLIC_KEY` y `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, lo que obliga a reconstruir, y las suscripciones push existentes dejan de funcionar |
| `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY` | van juntos: nuevo `JWT_SECRET`, firma de nuevo las dos claves (3.3), `docker compose up -d` en `/opt/supabase/docker`, copia las dos claves a `web.env` y relanza el workflow (la anon es `NEXT_PUBLIC_*`). Todos los miembros tienen que volver a entrar |
| `POSTGRES_PASSWORD` | cambiarlo en `.env` **no** cambia la contraseña de una base de datos ya creada. Pregunta al humano y sigue el procedimiento oficial de self-hosting de tu versión; después actualiza `PREPROD_DB_PASSWORD` en GitHub |
| `DASHBOARD_PASSWORD` | nuevo valor en `.env` y `docker compose up -d` en `/opt/supabase/docker` |
| Credenciales del túnel | **Necesita al humano:** `cloudflared tunnel delete elclub-pre`, crear de nuevo (8.4–8.7) y recrear `cloudflared` |
| Runner | **Necesita al humano:** quitarlo en Settings → Actions → Runners y registrarlo con un token nuevo (9.2–9.3) |

### 11.7 Después de vaciar la base de datos

La red activa vuelve a Linea Sepolia (59141), que es la correcta. Repite 10.3 (SuperAdmin) y 10.4 (Safe y wallet de
la plataforma de Sepolia), y 5 (Realtime) si recreaste Supabase entero.

---

## 12. Solución de problemas

### El túnel devuelve 502

Cloudflare llega al túnel pero el túnel no llega al servicio.

```
docker logs elclub-pre-cloudflared-1 2>&1 | tail -20
docker inspect elclub-pre-cloudflared-1 --format '{{json .NetworkSettings.Networks}}' | jq 'keys'
docker compose -p elclub-pre ps
```

- Logs con `no such host` o `dial tcp: lookup kong` → `cloudflared` no está en `supabase_default`. El `jq` tiene que
  listar `elclub-pre_default` y `supabase_default`. Si falta la red, Supabase no estaba arrancado cuando se creó el
  contenedor: arranca Supabase (4.1) y recrea `cloudflared` (11.1).
- `lookup web` o `connection refused` en `pre.elclub.party` → la web no está `Up (healthy)`: mira sus logs.
- Kong existe con otro nombre de servicio (paso 3.2) → el ingress del repo dice `http://kong:8000`: propón al humano
  un PR, o añade un alias de red `kong` al servicio en el override de Supabase.

### Kong devuelve 404 (`no Route matched with those values`)

- Si el cuerpo es JSON de Kong, la petición llegó a Kong por una ruta que Kong no tiene. Comprueba que existe en
  local: `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000/rest/v1/ -H "apikey: <ANON_KEY>"` → `200`.
  Si local da 404, `kong.yml` de tu versión no tiene esa ruta: revisa `volumes/api/kong.yml`.
- Si el 404 viene **vacío** y sin cabeceras de Kong, es el `http_status:404` del túnel: la ruta no es una de las
  cuatro APIs (`/auth/v1/`, `/rest/v1/`, `/realtime/v1/`, `/storage/v1/`). Para Studio y `/pg/` eso es lo correcto.

### La CSP bloquea Supabase

En la consola del navegador: `Refused to connect to 'https://…' because it violates the following Content Security
Policy directive: "connect-src …"`. La imagen se construyó con otra `NEXT_PUBLIC_SUPABASE_URL`: la CSP y el cliente
de Supabase se fijan al construir.

```
curl -sI https://pre.elclub.party/login | grep -i content-security-policy | grep -o "connect-src [^;]*"
grep '^NEXT_PUBLIC_SUPABASE_URL=' /opt/elclub/pre/web.env
```

`connect-src` tiene que contener `https://pre-api.elclub.party` y `wss://pre-api.elclub.party`, y `web.env` tiene que
decir `NEXT_PUBLIC_SUPABASE_URL=https://pre-api.elclub.party`. Corrige `web.env` y relanza el workflow; recrear el
contenedor no basta.

### El login con wallet falla

- `curl` de 4.3: `web3` tiene que ser `true` y `disable_signup` `false`.
- `SITE_URL` y `ADDITIONAL_REDIRECT_URLS` de 3.4.
- La allowlist del proyecto de Reown "elclub dev/pre" tiene que incluir `pre.elclub.party`.
- `docker compose logs auth --since 10m` en `/opt/supabase/docker`.
- Si los logs de la web muestran HTML de Cloudflare ("Just a moment") en llamadas a Supabase, falta la regla de 8.8
  o Bot Fight Mode sigue activo.

### El cron recibe 401

`docker logs elclub-pre-cron-1` muestra `curl: (22) The requested URL returned error: 401`: el `CRON_SECRET` del
contenedor `cron` no es el de `web`. Pasa cuando uno de los dos no se recreó tras cambiarlo. Recrea los dos juntos
(11.1, `--force-recreate web cron`). Un `503` es `cron_not_configured`: `CRON_SECRET` está vacío en `web.env`.

### El runner está Offline

En Settings → Actions → Runners sale **Offline**, o los runs se quedan en "Waiting for a runner".

```
cd /home/gh-runner/actions-runner && ./svc.sh status
journalctl -u 'actions.runner.*' --since '1 hour ago' | tail -30
```

- Servicio parado → `./svc.sh start`.
- `permission denied` con Docker → `usermod -aG docker gh-runner` y `./svc.sh stop && ./svc.sh start`.
- El registro ya no es válido (lo borraron en GitHub) → **Necesita al humano:** token nuevo; `./svc.sh uninstall`,
  `runuser -u gh-runner -- ./config.sh remove --token <TOKEN>` y repite 9.3.
- "Waiting for a runner" con el runner Idle → las etiquetas no coinciden con `self-hosted,linux,elclub-pre`.

### Falla el paso migrate

El paso **Migrate** del workflow falla. La web sigue con la versión anterior: el reinicio va después.

- `password authentication failed` → `PREPROD_DB_PASSWORD` no es el `POSTGRES_PASSWORD` actual.
- `Tenant or user not found` → el usuario de `PREPROD_DB_URL` no tiene el formato `postgres.<POOLER_TENANT_ID>`.
- `connection refused` → Supavisor no está publicado en `127.0.0.1:<POSTGRES_PORT>` o está parado
  (`ss -Htlnp | grep docker-proxy`, `docker compose ps supavisor`).
- `Remote migration versions not found in local migrations directory` → la base de datos tiene migraciones de un
  commit más nuevo que el desplegado (por ejemplo, tras un Re-run de un run viejo). Despliega el commit nuevo; no
  uses `supabase migration repair` sin el humano.
- Un error SQL en una migración → la migración está mal: avisa al humano, se arregla con un PR. Pega solo el error,
  nunca la URL ni variables.

### Falla el paso Build

- `NEXT_PUBLIC_SUPABASE_URL must be an https:// URL` (o `NEXT_PUBLIC_SITE_URL`) → corrige `web.env` (7.4).
- `no space left on device` → 11.5 y `docker builder prune -f`.

---

## 13. Checklist final

Envía al humano este informe, marcando cada punto y con lo que se pide entre paréntesis. **Ningún secreto** en el
informe.

- [ ] VM creada (VMID, IP, vCPU/RAM/discos; VM o LXC) con `unattended-upgrades`, SSH solo con clave y UTC.
- [ ] Docker y compose instalados (versiones), con rotación de logs `max-size` 10m.
- [ ] Supabase clonado en `/opt/supabase` (commit y fecha) con secretos propios, sin valores de ejemplo.
- [ ] Supuestos del paso 3.2 verificados (lista de diferencias encontradas, o "ninguna").
- [ ] `select version()` → PostgreSQL 17 (versión exacta).
- [ ] Auth: Web3 activo, email y teléfono apagados, registro abierto, límites 30/150/30 (salida del `curl` de 4.3).
- [ ] Todos los puertos publicados en `127.0.0.1` (salida de `ss -Htlnp | grep docker-proxy`).
- [ ] Realtime `private_only` activo (o "la columna no existe en esta versión").
- [ ] Studio solo por SSH: `404` público en `pre-api` y `000` desde la LAN.
- [ ] `/opt/elclub/pre/web.env` completo, `600 gh-runner` (lista "puesta/VACÍA" de 7.4).
- [ ] `check:rpc` de Sepolia con 4 `OK`.
- [ ] Túnel `elclub-pre` (UUID; por nombre o por UUID, y si hace falta el PR del UUID), credenciales `400 65532:65532`.
- [ ] DNS `pre.elclub.party` y `pre-api.elclub.party` creados.
- [ ] Regla de WAF de `pre-api.elclub.party` creada y Bot Fight Mode apagado (sin `cf-mitigated`).
- [ ] Runner `elclub-pre` Idle con etiquetas `self-hosted,linux,elclub-pre`, como servicio y usuario `gh-runner`.
- [ ] Environment `preproduction` con `PREPROD_DB_URL` (sin contraseña) y `PREPROD_DB_PASSWORD`, limitado a `develop`.
- [ ] Primer run verde (enlace al run) y comprobaciones de 10.2 (los cuatro resultados).
- [ ] SuperAdmin de preproducción creado con la wallet de pruebas.
- [ ] Safe y wallet de la plataforma de Sepolia guardadas en `/settings/economia`; red activa Linea Sepolia.
- [ ] Cron: `cron dao ok` a la hora en punto.
- [ ] Copia nocturna con `pg_dump` funcionando (tamaño del primer `.dump`) y copia de la VM en Proxmox programada.
- [ ] Desviaciones de esta guía y lo que queda pendiente del humano.
