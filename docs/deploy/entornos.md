# Entornos: variables y MCP

Hay tres entornos:

| Entorno | Dónde | Red | Supabase | Se despliega |
|---|---|---|---|---|
| Desarrollo | tu PC, `http://localhost:3000` | Base Sepolia y Arbitrum Sepolia (o la cadena Hardhat local de los e2e) | local (`pnpm db:start`) | `pnpm dev` |
| Preproducción | Proxmox de casa, `https://pre.elclub.party` | Base Sepolia y Arbitrum Sepolia | self-hosted, `https://pre-api.elclub.party` | push a `develop` |
| Producción | Vercel, `https://elclub.party` | Base y Arbitrum mainnet | Supabase Cloud, `https://<ref>.supabase.co` | push a `main` |

Dónde se ponen las variables:

- **Desarrollo:** `.env.local` en la raíz del repo (está en `.gitignore`). Plantilla: `.env.example`.
- **Preproducción:** `/opt/elclub/pre/web.env` en el servidor. Plantilla: `deploy/preprod/web.env.example`.
- **Producción:** Vercel → Settings → Environment Variables, **solo Production**. Plantilla:
  `deploy/prod/vercel.env.example`. Paso a paso en [`produccion.md`](produccion.md), paso 3.3.

Ningún archivo con valores reales se sube al repo.

## Matriz de variables

Cómo leer las celdas:

- Un valor entre comillas invertidas es el valor exacto.
- **vacía** quiere decir que la variable existe sin valor o no se crea. En producción, "no se crea".
- **\<tu valor\>** es algo tuyo que generas o copias (cada entorno el suyo; nunca reutilices un secreto entre
  entornos).
- **Secreta:** sí = nunca en el repo, en un chat ni en los logs. En Vercel, marcada Sensitive.
- **Build-time:** sí = el valor queda fijado dentro del build. Todas las `NEXT_PUBLIC_*` lo son: se copian en el
  JavaScript del navegador, y la CSP (`src/lib/security/headers.ts`) se calcula con ellas al construir. Cambiarlas
  obliga a reconstruir: en producción, relanzar el workflow; en preproducción, el siguiente push a `develop` (la
  imagen las recibe como build args).

| Variable | Desarrollo | Preproducción | Producción | Secreta | Build-time |
|---|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `http://127.0.0.1:54321` | `https://pre-api.elclub.party` | `https://<ref>.supabase.co` | no | sí |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | \<tu valor\> (`pnpm exec supabase status`) | \<tu valor\> (`ANON_KEY` del Supabase self-hosted) | \<tu valor\> (publishable o anon) | no | sí |
| `SUPABASE_SERVICE_ROLE_KEY` | \<tu valor\> (`pnpm exec supabase status`) | \<tu valor\> (`SERVICE_ROLE_KEY` del self-hosted) | \<tu valor\> (secret o service_role) | **sí** | no |
| `SUPER_ADMIN_WALLET` | \<tu valor\> (tu wallet de pruebas) | \<tu valor\> | \<tu valor\> (tu wallet de SuperAdmin) | no | no |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | \<tu valor\> ("elclub dev/pre") | \<tu valor\> ("elclub dev/pre") | \<tu valor\> ("elclub prod") | no | sí |
| `NEXT_PUBLIC_NETWORK_SET` | `testnet` | `testnet` | `mainnet` | no | sí |
| `NEXT_PUBLIC_BASE_BUILDER_CODE` | vacía | vacía | \<tu valor\> (tu Builder Code de base.dev, obligatoria: el build falla si no) | no | sí |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | `https://pre.elclub.party` | `https://elclub.party` | no | sí |
| `BASE_RPC_URL` | vacía (RPC pública) | vacía | \<tu valor\> (RPC de Base mainnet, obligatoria) | **sí** | no |
| `ARBITRUM_RPC_URL` | vacía (RPC pública) | vacía | \<tu valor\> (RPC de Arbitrum One, obligatoria) | **sí** | no |
| `BASE_SEPOLIA_RPC_URL` | \<tu valor\> o vacía (RPC pública) | \<tu valor\> o vacía | vacía (el build de mainnet no la usa) | **sí** | no |
| `ARBITRUM_SEPOLIA_RPC_URL` | \<tu valor\> o vacía (RPC pública) | \<tu valor\> o vacía | vacía (el build de mainnet no la usa) | **sí** | no |
| `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL` | vacía (solo la fijan los e2e) | vacía | vacía (el build falla si no) | no, pero nunca pongas una clave aquí | sí |
| `NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL` | vacía (solo la fijan los e2e) | vacía | vacía (el build falla si no) | no, pero nunca pongas una clave aquí | sí |
| `TIP_CONFIRMATIONS` | vacía (= 3) | `3` | `3` | no | no |
| `ETH_USD_FEED_ADDRESS_59141` | vacía (solo e2e / cadena local) | vacía | vacía (el build falla si no) | no | no |
| `WETH_ADDRESS_59141` | vacía (solo e2e / cadena local) | vacía | vacía (el build falla si no) | no | no |
| `COINGECKO_DISABLED` | vacía (solo e2e) | vacía | vacía (el build falla si no) | no | no |
| `COINGECKO_API_BASE` | vacía (los e2e la apuntan a un mock) | vacía | vacía (el build falla si no) | no | no |
| `DRAND_API_BASE` | vacía (los e2e la apuntan al drand simulado) | vacía (drand real) | vacía (se ignora en `mainnet`) | no | no |
| `NEXT_PUBLIC_DRAND_API_BASE` | vacía (los e2e la apuntan al drand simulado) | vacía (drand real) | vacía (se ignora en `mainnet`) | no | sí |
| `NEXT_PUBLIC_DRAND_PUBLIC_KEY` | vacía (los e2e ponen la clave de prueba) | vacía (clave real de quicknet) | vacía (se ignora en `mainnet`) | no | sí |
| `COINGECKO_API_KEY` | \<tu valor\> o vacía | \<tu valor\> o vacía | \<tu valor\> o vacía | **sí** | no |
| `VAPID_PUBLIC_KEY` | \<tu valor\> o vacía (push apagado) | \<tu valor\> | \<tu valor\> | no | no |
| `VAPID_PRIVATE_KEY` | \<tu valor\> o vacía | \<tu valor\> | \<tu valor\> | **sí** | no |
| `VAPID_SUBJECT` | `mailto:<tu correo>` o vacía | `mailto:<tu correo>` | `mailto:<tu correo>` | no | no |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | igual que `VAPID_PUBLIC_KEY` | igual que `VAPID_PUBLIC_KEY` | igual que `VAPID_PUBLIC_KEY` | no | sí |
| `CRON_SECRET` | \<tu valor\> o vacía (la ruta responde 503) | \<tu valor\> (`openssl rand -hex 32`) | \<tu valor\> (`openssl rand -hex 32`, mínimo 32 caracteres) | **sí** | no |
| `NEXT_OUTPUT` | vacía | `standalone` (lo fija el `Dockerfile`) | vacía | no | sí |
| `ENABLE_EXPERIMENTAL_COREPACK` | vacía | vacía | `1` (para que Vercel use `pnpm@12.11.2`) | no | sí |

Notas:

- `ETH_USD_FEED_ADDRESS_59144` y `WETH_ADDRESS_59144` no existen como override: la red heredada usa siempre las
  direcciones verificadas del código. Si alguien las crea en Vercel, el build de producción falla.
- `NEXT_PUBLIC_NETWORK_SET` decide qué redes usa el build. Vacía o ausente significa `testnet`; cualquier otro valor
  que no sea `mainnet` o `testnet` rompe el build. La migración de la base de datos habilita las cuatro redes: el
  build decide cuáles se usan, así que no hay nada que activar a mano en `/settings/economia`.
- Las variables de la configuración anterior (`NEXT_PUBLIC_CHAIN`, `LINEA_RPC_URL`, `LINEA_SEPOLIA_RPC_URL`,
  `NEXT_PUBLIC_LINEA_RPC_URL`, `NEXT_PUBLIC_LINEA_SEPOLIA_RPC_URL`) ya no las lee nada. Si siguen en Vercel, el build
  de producción falla hasta que las borres.
- `VERCEL_ENV` la pone Vercel sola. Cuando vale `production`, el build ejecuta la comprobación de
  `src/lib/deploy/readiness.ts` (mensajes explicados en `produccion.md`, paso 3.4). Si el ajuste de Vercel
  **Automatically expose System Environment Variables** se desactiva, `VERCEL_ENV` no llega al build y la
  comprobación se salta en silencio: déjalo activado.
- Las claves VAPID se generan con `pnpm exec web-push generate-vapid-keys --json`, una pareja por entorno.

## Secretos de GitHub

Van en GitHub → Settings → Environments, no en Vercel ni en el servidor.

| Environment | Secreto | Qué es |
|---|---|---|
| `production` | `SUPABASE_ACCESS_TOKEN` | token personal de Supabase, para `supabase link` |
| `production` | `SUPABASE_DB_PASSWORD` | contraseña de la base de datos de producción |
| `production` | `SUPABASE_PROJECT_REF` | ref del proyecto de Supabase Cloud |
| `production` | `VERCEL_TOKEN` | token de Vercel para `vercel deploy --prod` |
| `production` | `VERCEL_ORG_ID` | Team ID de Vercel (`team_…`) |
| `production` | `VERCEL_PROJECT_ID` | Project ID de Vercel (`prj_…`) |
| `preproduction` | `PREPROD_DB_URL` | `postgresql://usuario@host:puerto/postgres`, **sin** contraseña |
| `preproduction` | `PREPROD_DB_PASSWORD` | contraseña de Postgres del Supabase self-hosted |

## Qué MCP instalar y qué puedo hacer con cada uno

Un MCP es una conexión que me deja (a Claude) hablar directamente con un servicio. **Nada de la app ni de los
despliegues depende de que estén instalados**: todo lo de `produccion.md` se puede hacer a mano desde los paneles.
Los MCP solo ahorran clics y me dejan mirar logs sin que me copies nada.

Regla para todos: **cualquier acción que cree, cambie o borre algo en un servicio real la hago solo con tu
confirmación explícita**, después de decirte qué voy a hacer exactamente. Leer (logs, estado, listas) lo puedo hacer
sin preguntar.

### Vercel MCP (instalado)

Qué puedo hacer:

- Leer proyectos, deployments, logs de build y logs de ejecución (por ejemplo, ver por qué falló un build o qué
  respondió el cron).
- Ver qué variables de entorno existen y en qué entornos están, sin leer sus valores.
- Comprobar dominios y su configuración DNS desde el lado de Vercel.
- Buscar en la documentación de Vercel.

Qué haría solo con tu confirmación:

- Crear el proyecto.
- Añadir o cambiar variables de entorno (de las no secretas; las secretas las pegas tú, para que no pasen por el
  chat).
- Añadir los dominios `elclub.party` y `www.elclub.party`.
- Relanzar o revertir un deployment.

### Supabase MCP (instalado)

Para el día a día con producción conviene configurarlo con `read_only=true` y `project_ref` fijado al proyecto de
producción, así no puede escribir aunque yo me equivoque. Si lo dejas con escritura, valen las mismas reglas.

Qué puedo hacer:

- Listar proyectos, tablas, extensiones y migraciones aplicadas.
- Ejecutar SQL de solo lectura.
- Leer logs (API, Auth, Postgres, Realtime) y los avisos de seguridad y rendimiento (advisors).
- Buscar en la documentación de Supabase.

Qué haría solo con tu confirmación:

- Crear el proyecto de Supabase (te enseño antes el coste: Free, 0 €).
- Desactivar `pg_graphql` (paso 2.6 de `produccion.md`).

Lo que **no** hago aunque pueda: aplicar migraciones o ejecutar SQL que escriba en producción. Las migraciones de
producción las aplica solo el workflow de GitHub (`supabase db push`), después de `verify`. Así el orden
migración → código nunca se rompe.

### Cloudflare MCP (no instalado, opcional)

Si lo instalas, podría leer los registros DNS de `elclub.party` y el estado del Tunnel de preproducción, y crear los
registros DNS de Vercel con tu confirmación. Sin él, los registros los creas tú (paso 4 de `produccion.md`).

### Lo que siempre haces tú

Esto no pasa por ningún MCP, ni aunque estén instalados:

- **Tokens y secretos:** el token de Vercel, el token de Supabase, `CRON_SECRET`, las claves VAPID privadas, la clave
  secreta de Supabase y la URL de Infura. Los generas y los pegas tú directamente en Vercel o GitHub.
- **Secretos de GitHub** (los Environments `production` y `preproduction`).
- **DNS de Cloudflare** (salvo que instales su MCP y me confirmes cada cambio).
- **La Safe:** añadir firmantes y cambiar el umbral se firma con tus wallets en app.safe.global.
- **Reown:** crear los proyectos y su allowlist de dominios en dashboard.reown.com.
- **Merges a `main` y `develop`**, que son los que despliegan.
