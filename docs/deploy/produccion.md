# Guía de producción: elclub.party en Vercel + Supabase Cloud (Base y Arbitrum mainnet)

Esta guía te lleva desde cero hasta tener elclublambo funcionando en `https://elclub.party` con dinero real en
Base y Arbitrum mainnet. Está escrita para hacerla una vez, en orden, sin haber usado antes Vercel ni Supabase Cloud.

Cada paso termina con una línea **Comprueba:** que dice qué tienes que ver. Si no lo ves, para ahí y no sigas: los
pasos siguientes dan por hecho que el anterior salió bien.

Los valores exactos de cada variable están en [`entornos.md`](entornos.md). Esta guía dice dónde se ponen.

## Orden en el que vas a trabajar

El primer push a `main` que contenga `.github/workflows/production.yml` lanza el despliegue de producción. Ese push
es, casi seguro, el merge de la rama de F5. Por eso **todo lo de los pasos 1 a 7 tiene que estar hecho antes de
mergear a `main`**:

1. RPC comprobada (paso 1).
2. Proyecto de Supabase creado y configurado (paso 2).
3. Proyecto de Vercel creado, con todas las variables en Production (paso 3).
4. DNS en Cloudflare (paso 4). Necesitas el dominio `elclub.party` ya comprado. Si aún no lo tienes, puedes hacer
   todo lo demás y dejar el merge para cuando lo tengas: sin dominio el login con wallet no funciona, porque Supabase
   y Reown solo aceptan `elclub.party`.
5. GitHub Environment `production`, limitado a la rama `main`, con sus 6 secretos, y protección de `main` (paso 5).
6. Secretos generados y Reown creado (paso 6). En la práctica los generas antes del paso 3, porque Vercel los pide.

La rama `develop` **no** se crea ahora: se crea desde `main` **después** del merge de F5 (paso 7.4), para que
herede el workflow de preproducción y `deploy/preprod/`.

Si mergeas a `main` sin los secretos de GitHub, el workflow falla en el job `migrate` (no puede hacer
`supabase link`) y **no se despliega nada**. No rompe nada: añades los secretos y relanzas el workflow (paso 7).

---

## 0. Qué vas a montar

```
                    Cloudflare DNS (solo DNS, nube gris)
                                 │
                                 ▼
  navegador ──── https://elclub.party ────► Vercel (Pro, funciones en dub1, Dublín)
                                                 │            ▲
                                                 │            │ vercel deploy --prod
                                                 ▼            │
                              Supabase Cloud (Free, eu-west-1, Irlanda)
                                                 ▲            │
                                                 │            │
     GitHub: push a main ──► verify ──► migrate (supabase db push) ──► deploy
```

- **Vercel** sirve la web y ejecuta el cron horario `/api/cron/dao` (`0 * * * *`). Las funciones corren en `dub1` (Dublín),
  al lado de la base de datos.
- **Supabase Cloud** guarda todo: base de datos, login, imágenes y Realtime. Región West EU (Ireland),
  `eu-west-1`.
- **GitHub Actions** despliega. Al hacer push a `main` corre `.github/workflows/production.yml`, con tres jobs
  estrictamente en orden:
  1. `verify`: `pnpm typecheck`, `pnpm lint` y `pnpm test:unit`. Si algo está en rojo, se para aquí.
  2. `migrate`: `supabase db push` aplica las migraciones nuevas a la base de datos de producción.
  3. `deploy`: `vercel deploy --prod` con la CLI de Vercel. Vercel construye en remoto con las variables de
     Production.

Lo que **nunca** pasa:

- **No hay previews.** `vercel.json` tiene `"git": { "deploymentEnabled": false }`, así que Vercel no construye nada
  por su cuenta al hacer push a ninguna rama. Solo despliega cuando el workflow se lo pide.
- **El código nunca llega antes que su migración.** Si `supabase db push` falla, el job `deploy` no se ejecuta y la
  web sigue con la versión anterior.
- **Un despliegue no cancela a otro.** Si haces dos push seguidos, el segundo espera a que termine el primero.

---

## 1. RPC de Base y Arbitrum mainnet

La app lee la blockchain desde el servidor: verifica propinas, pagos de bounties y donaciones, y el cron valora la
Safe y escanea sus operaciones. Para eso usa `BASE_RPC_URL` y `ARBITRUM_RPC_URL`, tus endpoints de proveedor (por ejemplo Infura) con la clave dentro.

Dos reglas:

- **La clave tiene que ir en la ruta o en la query de la URL, nunca en el nombre del host.** Infura lo hace bien:
  `https://base-mainnet.infura.io/v3/<tu-clave>`. Los logs de la app tachan todo lo que va después del host, pero
  el host se deja visible a propósito. Un proveedor que meta la clave en el subdominio la acabaría enseñando en los
  logs.
- **Nunca pongas una clave en una variable `NEXT_PUBLIC_*`.** Esas variables se copian dentro del JavaScript que
  descarga cualquier visitante. `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL` y `NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL` son solo para
  tests y en producción van **vacías** (el build falla si no lo están).

1. Abre una terminal en la carpeta del proyecto.
2. Comprueba la RPC. Tienes dos formas:
   - Si tu `.env.local` (o `.env`) ya tiene `BASE_RPC_URL` y `ARBITRUM_RPC_URL` con las claves de mainnet, el
     script las lee solo. Sin `--chain` comprueba las dos redes de `NEXT_PUBLIC_NETWORK_SET`; con `--chain` una:
     ```
     pnpm check:rpc --chain 8453
     pnpm check:rpc --chain 42161
     ```
   - Si no, en PowerShell, pidiendo la clave sin que se escriba en pantalla ni en el historial (pega la URL
     completa cuando te la pida):
     ```
     $s = Read-Host -AsSecureString "BASE_RPC_URL"
     $env:BASE_RPC_URL = [System.Net.NetworkCredential]::new('', $s).Password
     pnpm check:rpc -- --chain 8453
     Remove-Item Env:BASE_RPC_URL
     (repite con ARBITRUM_RPC_URL y --chain 42161)
     ```
     No escribas la clave directamente en el comando: PowerShell guarda el historial en disco
     (`ConsoleHost_history.txt`) y cerrar la terminal no lo borra.

**Comprueba:** salen 4 líneas `OK` por red, y la URL aparece tachada (`https://base-mainnet.infura.io/***`):

```
Comprobando https://base-mainnet.infura.io/*** en Base (8453)
OK eth_chainId 8453
OK eth_blockNumber <número>
OK archive state at block <número>
OK eth_getLogs over 2001 blocks
```

Si falla `archive` o `eth_getLogs`, cambia de plan de Infura o de proveedor. No es opcional: el cron escanea la Safe
en ventanas de 2000 bloques y valora la Safe en bloques pasados, y sin estado de archivo esas lecturas fallan.
(Con tus claves de Infura actuales ya se comprobó: mainnet y Sepolia pasan las dos pruebas.)

---

## 2. Supabase Cloud

### 2.1 Crear el proyecto

Antes de empezar, ten en cuenta el límite del plan Free: **2 proyectos activos por organización**. Si ya tienes
2 proyectos activos en la organización, pausa uno antes de crear este. Con elclub llegas al límite: a partir de ahí
no podrás reactivar tus otros proyectos pausados sin pausar otro, y elclub no se puede pausar porque es producción.

1. Entra en [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. Rellena:
   - **Name:** `elclub` (o el que quieras; no lo usa la app).
   - **Database Password:** pulsa **Generate a password**, cópiala y guárdala en tu gestor de contraseñas. La
     necesitarás como `SUPABASE_DB_PASSWORD` en GitHub y para las copias de seguridad.
   - **Region:** **West EU (Ireland)**. Es `eu-west-1`, la misma zona que las funciones de Vercel (`dub1`, Dublín).
   - **Plan:** Free.
3. Pulsa **Create new project** y espera a que termine (un par de minutos).

**Comprueba:** el proyecto aparece como activo y en **Project Settings → General** ves la región West EU (Ireland) y el
**Project ID** (una cadena de unas 20 letras). Ese Project ID es el *project ref*: apúntalo, lo usarás como
`SUPABASE_PROJECT_REF` y en `NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co`.

### 2.2 Login solo con wallet

1. Ve a **Authentication → Sign In / Providers**.
2. Activa **Web3 Wallet** y, dentro, **Ethereum**. Deja Solana apagado.
3. Desactiva **Email** y **Phone**. La app solo entra con wallet (SIWE); dejar el email abierto es superficie de
   ataque que no se usa.
4. En la sección de registros de usuarios, deja **Allow new users to sign up** activado. Si lo apagas, nadie nuevo
   puede entrar con su wallet, ni siquiera tú la primera vez.

**Comprueba:** en la lista de proveedores solo aparece activo Web3 Wallet (Ethereum).

### 2.3 URLs permitidas

Supabase comprueba que el mensaje que firma la wallet viene de una URL permitida.

1. Ve a **Authentication → URL Configuration**.
2. **Site URL:** `https://elclub.party`
3. **Redirect URLs:** añade `https://elclub.party/**` y nada más. No añadas `localhost` ni `pre.elclub.party`: cada
   entorno tiene su propio Supabase.

**Comprueba:** Site URL es `https://elclub.party` y en Redirect URLs hay una sola entrada, `https://elclub.party/**`.

### 2.4 Límites de login

1. Ve a **Authentication → Rate Limits**.
2. Pon estos valores (todos son por IP y por 5 minutos, los mismos que `supabase/config.toml`):

   | Campo | Valor |
   |---|---|
   | Web3 (sign ups y sign ins con wallet) | 30 |
   | Token refreshes | 150 |
   | Sign ups and sign ins | 30 |
   | Token verifications | 30 |

3. Guarda.

**Comprueba:** al recargar la página siguen los cuatro valores.

### 2.5 Realtime solo privado

La app solo usa canales privados (cada uno protegido por políticas en la base de datos). Cerrar los públicos es una
defensa extra.

1. Ve a **Realtime → Settings**.
2. Desactiva **Allow public access**.
3. Guarda.

**Comprueba:** "Allow public access" aparece apagado.

### 2.6 API y GraphQL

1. Ve a **Project Settings → Data API**.
   - **Exposed schemas:** `public` y `graphql_public`, que es lo que trae. **Nunca añadas `private`**: ahí viven los
     contadores de límites y funciones internas.
   - **Max rows:** 1000.
2. La app no usa GraphQL (no hay ni una consulta GraphQL en el código), pero los proyectos de Supabase Cloud traen la
   extensión `pg_graphql` activada. Es superficie que sobra:
   - Ve a **Database → Extensions**, busca `pg_graphql` y desactívala.
   - Si no te deja desde ahí, abre **SQL Editor** y ejecuta `drop extension if exists pg_graphql;`.
3. **JWT expiry:** déjalo en 3600 segundos (1 hora), que es el valor por defecto. Si lo ves en la configuración de
   JWT, no lo cambies.

**Comprueba:** en **Database → Extensions**, `pg_graphql` aparece desactivada.

### 2.7 Nunca `tx=rollback`

PostgREST tiene un modo (`db-tx-end` distinto de `commit`) que permite pedir `Prefer: tx=rollback`: ejecuta una
función y deshace todo al final. Con él, cualquiera podría "probar" las funciones de la base de datos, ver qué
devolverían y no dejar rastro ni gastar sus límites. En Supabase Cloud viene apagado y no hay interruptor en el panel.
**Nunca lo actives**, aunque una guía o un soporte te lo sugiera.

### 2.8 Claves de la API

1. Ve a **Project Settings → API Keys**.
2. Según la edad del proyecto verás claves nuevas, las antiguas (pestaña *Legacy*) o las dos. La app funciona con
   cualquiera de los dos formatos. Así se corresponden:

   | En Supabase | Variable en Vercel | ¿Secreta? |
   |---|---|---|
   | Publishable key (`sb_publishable_…`) o `anon` (legacy) | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | No: va al navegador |
   | Secret key (`sb_secret_…`) o `service_role` (legacy) | `SUPABASE_SERVICE_ROLE_KEY` | **Sí**: salta todas las políticas |

   Usa las dos del mismo formato (las dos nuevas o las dos legacy).
3. La URL del proyecto es `https://<ref>.supabase.co` → `NEXT_PUBLIC_SUPABASE_URL`.

**Comprueba:** tienes apuntadas la URL, la clave pública y la secreta. La secreta, solo en tu gestor de contraseñas.

### 2.9 Ensayo de las migraciones (sin aplicar nada)

Quieres ver que la CLI conecta y qué migraciones va a aplicar el workflow. Desde la carpeta del proyecto:

```
pnpm exec supabase login
pnpm exec supabase link --project-ref <ref>
pnpm exec supabase db push --dry-run
pnpm exec supabase unlink
```

`login` abre el navegador. `link` te pide la contraseña de la base de datos (la del paso 2.1).

**Comprueba:** `--dry-run` lista todas las migraciones de `supabase/migrations` como pendientes y termina sin error.
Después de `unlink`, el archivo `supabase/.temp/project-ref` ya no existe.

**No dejes la carpeta enlazada a producción.** Mientras esté enlazada, cualquier comando con `--linked` o
`db push` que lance tú, o una IA que trabaje en esta carpeta, ataca la base de datos de producción. Por eso el
paso termina con `supabase unlink`. (Si `unlink` falla, borra el archivo `supabase/.temp/project-ref` a mano.)
Vuelve a enlazar solo para las copias de seguridad (paso 11) y desenlaza al terminar.

Desde tu PC usa **solo** `--dry-run`. Quien aplica las migraciones a producción es el workflow. Y nunca ejecutes
`supabase db reset --linked`: borra la base de datos de producción.

### 2.10 Plan Free: pausa y copias

- Supabase Free **pausa el proyecto tras 7 días sin actividad**. El cron horario de Vercel consulta la base de datos
  cada hora, así que en la práctica no se pausa. Si alguna vez se pausa (por ejemplo, porque el cron falla una
  semana), lo reactivas desde el panel con **Restore project**.
- Free **no tiene copias descargables**. Haz las tuyas a mano (paso 11).

---

## 3. Vercel (Pro)

### 3.1 Crear el proyecto

1. En [vercel.com](https://vercel.com), con tu equipo Pro seleccionado arriba a la izquierda, pulsa **Add New… →
   Project**.
2. Conecta GitHub si te lo pide e importa el repositorio `Rayelus5/elclublambo`.
3. **Framework Preset:** Next.js (lo detecta solo). No toques Build Command ni Install Command.
4. No añadas variables en esta pantalla (aquí se aplicarían a todos los entornos). Pulsa **Deploy**.
5. Este primer build construye la rama `main` **actual**, que todavía no tiene el código de F5 (ni la comprobación de
   producción ni `vercel.json`). Todavía no hay variables, así que lo esperable es que falle (o, peor, que
   despliegue una versión rota por otro motivo). Da igual: no lo uses.
6. **No pulses Redeploy** sobre ese deployment, ni ahora ni cuando ya tengas variables: serviría código antiguo con
   las variables de producción contra una base de datos sin migrar. Hasta el merge de F5, la integración con Git
   sigue activa para `main` (`vercel.json` aún no está en `main`). Para cortarlo, ve a **Settings → Git → Ignored
   Build Step** y elige **Don't build anything**; así los push a `main` no construyen nada por Git. **Vuelve a poner
   Automatic antes del merge de F5** (paso 7.1): `vercel.json` ya desactiva Git y no quieres que este ajuste interfiera
   con el despliegue por CLI.

**Comprueba:** el proyecto existe en Vercel y la importación ha creado un deployment en Production (fallido o roto,
no importa). No lo uses ni lo redespliegues: el primer deployment bueno es el del paso 7.

### 3.2 Ajustes del proyecto

1. **Settings → Build and Deployment → Node.js Version:** `22.x` (la misma que usa el workflow).
2. **Settings → Functions:** la región debe salir como Dublín (`dub1`). Viene de `vercel.json`
   (`"regions": ["dub1"]`); si sale otra, revisa que `vercel.json` esté en la raíz del repo.
3. **Settings → Git:** el repositorio aparece conectado. No hace falta tocar nada: `vercel.json` tiene
   `"git": { "deploymentEnabled": false }`, así que los push no despliegan por su cuenta.

**Comprueba:** Node.js 22.x y región `dub1`.

### 3.3 Variables de entorno

Ve a **Settings → Environment Variables**. Añade cada variable de `deploy/prod/vercel.env.example`. Para **cada una**:

- **Environments:** marca **solo Production**. Desmarca Preview y Development. Así, aunque algún día existiera una
  preview, no tendría acceso a la base de datos de producción.
- **Sensitive:** actívalo en las secretas: `SUPABASE_SERVICE_ROLE_KEY`, `BASE_RPC_URL`, `ARBITRUM_RPC_URL`,
  `VAPID_PRIVATE_KEY`, `CRON_SECRET` y `COINGECKO_API_KEY`. Una variable sensible no se puede volver a leer desde
  el panel, solo sobrescribir.
- **No crees** las que la plantilla deja fuera a propósito: `ETH_USD_FEED_ADDRESS_59141`, `WETH_ADDRESS_59141`,
  `COINGECKO_DISABLED` y `COINGECKO_API_BASE`. Si no tienes valor para una opcional (por ejemplo
  `COINGECKO_API_KEY`), simplemente no la crees.

La lista, con el valor que lleva cada una:

| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` (paso 2.8) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | clave pública de Supabase (paso 2.8) |
| `SUPABASE_SERVICE_ROLE_KEY` | clave secreta de Supabase (paso 2.8). Sensitive |
| `SUPER_ADMIN_WALLET` | tu wallet `0x…` de SuperAdmin (paso 8) |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | Project ID de "elclub prod" (paso 6.3) |
| `NEXT_PUBLIC_NETWORK_SET` | `mainnet` (Base y Arbitrum mainnet) |
| `NEXT_PUBLIC_BASE_BUILDER_CODE` | tu Builder Code de base.dev (letras, números, `_` y `-`, hasta 32). Obligatoria |
| `NEXT_PUBLIC_SITE_URL` | `https://elclub.party` |
| `BASE_RPC_URL` | tu RPC de Base mainnet (paso 1). Sensitive |
| `ARBITRUM_RPC_URL` | tu RPC de Arbitrum One (paso 1). Sensitive |
| `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL` | no la crees (debe estar vacía) |
| `NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL` | no la crees (debe estar vacía) |
| `TIP_CONFIRMATIONS` | `3` |
| `COINGECKO_API_KEY` | opcional: tu clave demo de CoinGecko. Sensitive |
| `VAPID_PUBLIC_KEY` | clave pública VAPID de producción (paso 6.2) |
| `VAPID_PRIVATE_KEY` | clave privada VAPID de producción (paso 6.2). Sensitive |
| `VAPID_SUBJECT` | `mailto:<tu correo>` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | la misma que `VAPID_PUBLIC_KEY` |
| `CRON_SECRET` | 64 caracteres de `openssl rand -hex 32` (paso 6.1). Sensitive |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` |

**`VERCEL_ENV` tiene que existir en el build.** Es la variable que Vercel pone sola (`production`, `preview` o
`development`) y de la que depende la comprobación del paso 3.4: si no vale `production`, la comprobación **no se
ejecuta** y el build pasa sin revisar nada. Vercel la expone mientras esté activado **Settings → Environment
Variables → Automatically expose System Environment Variables** (viene activado). No lo desactives, y no crees tú
una variable `VERCEL_ENV`.

`ENABLE_EXPERIMENTAL_COREPACK=1` hace que Vercel instale exactamente la versión de pnpm fijada en `package.json`
(`"packageManager": "pnpm@12.11.2"`). Sin ella, Vercel elige la versión de pnpm a partir del lockfile y puede usar
una más antigua. Si un build falla en la instalación con `ERR_PNPM_UNSUPPORTED_ENGINE` o con un error de formato del
lockfile, comprueba que esta variable existe, está en Production y vale `1`.

**Comprueba:** en la lista, cada variable muestra solo "Production", las seis secretas tienen el candado de
Sensitive, y **Automatically expose System Environment Variables** está activado.

### 3.4 Qué comprueba el build de producción

Cuando Vercel construye en Production, `next.config.ts` llama a la comprobación de `src/lib/deploy/readiness.ts`.
Si algo está mal, el build falla con `Configuración de producción inválida:` seguido de la lista de problemas. Solo
nombra variables, nunca sus valores. Qué significa cada mensaje y cómo se arregla:

| Mensaje | Qué pasa | Arreglo |
|---|---|---|
| `NEXT_PUBLIC_NETWORK_SET must be mainnet` | El build no es de mainnet (o la variable está vacía, que significa testnet) | Pon `NEXT_PUBLIC_NETWORK_SET` = `mainnet` |
| `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL must be empty` | Hay una RPC en una variable pública: iría al navegador | Borra la variable |
| `NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL must be empty` | Igual, para Arbitrum Sepolia | Borra la variable |
| `BASE_RPC_URL is required` | Falta tu RPC de Base | Añádela (paso 1) |
| `ARBITRUM_RPC_URL is required` | Falta tu RPC de Arbitrum | Añádela (paso 1) |
| `NEXT_PUBLIC_BASE_BUILDER_CODE must be a builder code` | Falta el Builder Code o tiene caracteres no válidos (solo letras, números, `_` y `-`, de 1 a 32) | Copia tu código de base.dev |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY is required` | Falta la clave pública de Supabase | Añádela (paso 2.8) |
| `SUPABASE_SERVICE_ROLE_KEY is required` | Falta la clave secreta de Supabase | Añádela (paso 2.8) |
| `NEXT_PUBLIC_REOWN_PROJECT_ID is required` | Falta el Project ID de Reown | Añádelo (paso 6.3) |
| `NEXT_PUBLIC_SITE_URL must be https` | La URL del sitio no es una URL `https://` válida con dominio: sin eso no se envían HSTS ni la CSP correcta | `https://elclub.party` |
| `NEXT_PUBLIC_SUPABASE_URL must be https` | La URL de Supabase no es una URL `https://` válida con dominio | `https://<ref>.supabase.co` |
| `CRON_SECRET must be at least 32 characters` | El secreto del cron es corto o falta | Genera uno con `openssl rand -hex 32` |
| `SUPER_ADMIN_WALLET must be a 0x address` | No es una dirección `0x` + 40 caracteres hexadecimales | Copia tu dirección completa |
| `ETH_USD_FEED_ADDRESS_59141 must be unset in production` | Hay un override de tests | Borra la variable |
| `WETH_ADDRESS_59141 must be unset in production` | Hay un override de tests | Borra la variable |
| `ETH_USD_FEED_ADDRESS_59144 must be unset in production` | Hay un override de tests | Borra la variable |
| `WETH_ADDRESS_59144 must be unset in production` | Hay un override de tests | Borra la variable |
| `NEXT_PUBLIC_CHAIN must be unset in production` | Queda configuración de la red anterior en Vercel | Borra la variable |
| `LINEA_RPC_URL must be unset in production` | Igual: configuración de la red anterior | Borra la variable |
| `LINEA_SEPOLIA_RPC_URL must be unset in production` | Igual | Borra la variable |
| `NEXT_PUBLIC_LINEA_RPC_URL must be unset in production` | Igual | Borra la variable |
| `NEXT_PUBLIC_LINEA_SEPOLIA_RPC_URL must be unset in production` | Igual | Borra la variable |
| `COINGECKO_DISABLED must be unset in production` | El precio de respaldo de CoinGecko está apagado (solo tests) | Borra la variable |
| `COINGECKO_API_BASE must be unset in production` | CoinGecko apunta a otro servidor (solo tests) | Borra la variable |
| `TIP_CONFIRMATIONS must be empty or >= 3` | Menos de 3 confirmaciones es arriesgado con dinero real | Pon `3` o déjala sin crear |

El build no imprime nada cuando la comprobación pasa, así que no hay una línea de log que buscar. Si en Vercel
falta `VERCEL_ENV`, el build falla con `VERCEL_ENV is missing (enable 'Automatically expose System Environment
Variables')`: activa el ajuste de arriba. Para ver la comprobación en acción la primera vez, haz un primer
deployment de Production mal configurado a propósito creando `ETH_USD_FEED_ADDRESS_59141` con cualquier valor
(es inofensiva en mainnet): debe salir `ETH_USD_FEED_ADDRESS_59141 must be unset in production`. Si el build pasa,
la comprobación no corre y hay que revisar el ajuste. Luego borra la variable.

Después de corregir una variable, relanza el despliegue (paso 7.3). Cambiar una variable en Vercel no reconstruye
nada por sí solo.

### 3.5 Token y IDs para GitHub

El workflow despliega con la CLI de Vercel y necesita tres datos:

1. **`VERCEL_TOKEN`:** ve a **Account Settings → Tokens** ([vercel.com/account/tokens](https://vercel.com/account/tokens)),
   con tu cuenta personal seleccionada arriba a la izquierda.
   - **Name:** `github-actions-elclub`.
   - **Scope:** tu equipo y, dentro, el proyecto de elclub (el alcance más pequeño). Si luego el job `deploy` falla
     con un error de permisos (403), crea otro con el equipo entero (**All Projects**).
   - **Expiration:** la que prefieras. Apunta la fecha: cuando caduque, el deploy fallará hasta que lo renueves.
   - Pulsa **Create** y copia el token. Solo se enseña una vez.
2. **`VERCEL_ORG_ID`:** el ID de tu equipo. Está en **Team Settings → General → Team ID** (empieza por `team_`).
3. **`VERCEL_PROJECT_ID`:** en el proyecto, **Settings → General → Project ID** (empieza por `prj_`).

Los tres van a GitHub en el paso 5, no a Vercel.

**Comprueba:** tienes el token (`vcp_…`), el Team ID (`team_…`) y el Project ID (`prj_…`).

### 3.6 Dominio

1. En el proyecto, **Settings → Domains → Add Domain**: escribe `elclub.party`.
2. Vercel te ofrece añadir también `www.elclub.party`. Acepta y elige que `www.elclub.party` **redirija** a
   `elclub.party` (el dominio principal es el apex, sin `www`).
3. Vercel mostrará "Invalid Configuration" y los registros DNS que necesita. Déjalo abierto: los copias en el paso 4.

**Comprueba:** en Domains aparecen `elclub.party` y `www.elclub.party` (este con la redirección), los dos pendientes
de DNS.

---

## 4. Cloudflare DNS

El dominio está en Cloudflare, pero el tráfico tiene que ir directo a Vercel, sin pasar por el proxy de Cloudflare.

1. En Cloudflare, abre `elclub.party` → **DNS → Records**.
2. Crea **exactamente** los registros que te enseña la página Domains de Vercel. Normalmente son:
   - Apex: tipo `A`, nombre `@`, con la IP que muestra Vercel.
   - `www`: tipo `CNAME`, nombre `www`, con el destino que muestra Vercel (es propio de tu proyecto).

   Usa siempre los valores de tu pantalla de Vercel, no los de esta guía.
3. En los dos, **Proxy status: DNS only** (la nube gris, no la naranja). TTL: Auto.
4. Si Vercel te pide además un registro `TXT` de verificación (`_vercel`), créalo igual.
5. Si tienes registros `CAA` en la zona, deja permitido `letsencrypt.org`: Vercel emite el certificado con Let's
   Encrypt. Si no tienes CAA, no hagas nada.
6. **SSL/TLS:** el certificado lo pone Vercel. No cambies el modo SSL de Cloudflare a *Flexible*.
7. **No toques** `pre` ni `pre-api`: los crea la guía de preproducción (`docs/deploy/preproduccion-homelab.md`).

**Comprueba:** a los pocos minutos, en Vercel → Domains, `elclub.party` y `www.elclub.party` pasan a "Valid
Configuration" y el certificado aparece emitido. En Cloudflare los dos registros tienen la nube gris.

---

## 5. GitHub

### 5.1 Environment `production` y sus secretos

1. Repo → **Settings → Environments → New environment**, nombre `production` (exactamente así).
2. **Obligatorio:** en **Deployment branches and tags**, elige **Selected branches and tags** y añade solo `main`.
   Es la barrera que impide que otra rama (con el selector de "Run workflow", o una rama que edite el workflow)
   use estos secretos, migre la base de datos de producción o despliegue. El workflow también comprueba
   `github.ref == 'refs/heads/main'` en `migrate` y `deploy`, pero esta regla es la que protege los secretos.
   Opcional: añádete como **Required reviewer**, para tener que aprobar a mano el primer despliegue con dinero real.
3. En **Environment secrets → Add environment secret**, crea estos seis:

   | Secreto | De dónde sale |
   |---|---|
   | `SUPABASE_ACCESS_TOKEN` | [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) → **Generate new token** |
   | `SUPABASE_DB_PASSWORD` | la contraseña de la base de datos (paso 2.1) |
   | `SUPABASE_PROJECT_REF` | el Project ID de Supabase (paso 2.1) |
   | `VERCEL_TOKEN` | el token de Vercel (paso 3.5) |
   | `VERCEL_ORG_ID` | el Team ID de Vercel (paso 3.5) |
   | `VERCEL_PROJECT_ID` | el Project ID de Vercel (paso 3.5) |

4. Crea también el Environment `preproduction`. Sus secretos (`PREPROD_DB_URL` y `PREPROD_DB_PASSWORD`) y su regla
   de rama (`develop`) los rellena la guía de preproducción; por ahora puede quedarse vacío.

**Comprueba:** en Environments → `production` aparecen los seis secretos por nombre, y **Deployment branches and
tags** dice "Selected branches" con `main` como única entrada.

### 5.2 Proteger `main`

1. Repo → **Settings → Branches → Add branch protection rule** (o **Rules → Rulesets**, si GitHub te lleva ahí).
2. Una regla para `main` (la de `develop` se crea en el paso 7.4), con:
   - **Require a pull request before merging:** activado.
   - **Allow force pushes:** desactivado.
   - **Allow deletions:** desactivado.

**Comprueba:** un `git push` directo a `main` desde tu PC es rechazado. (Haz esto antes del merge de F5, que entra
por pull request.)

---

## 6. Secretos que tienes que generar

### 6.1 `CRON_SECRET`

Vercel llama al cron con `Authorization: Bearer <CRON_SECRET>` y la ruta lo compara. En Git Bash:

```
openssl rand -hex 32
```

Si no tienes `openssl`, en cualquier terminal:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Comprueba:** salen 64 caracteres hexadecimales. Pégalos en Vercel como `CRON_SECRET` (Production, Sensitive).
Usa uno distinto para preproducción.

### 6.2 Claves VAPID (notificaciones push)

Una pareja por entorno. Desde la carpeta del proyecto:

```
pnpm exec web-push generate-vapid-keys --json
```

Sale un JSON con `publicKey` y `privateKey`:

- `publicKey` → `VAPID_PUBLIC_KEY` **y** `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (el mismo valor en las dos).
- `privateKey` → `VAPID_PRIVATE_KEY` (Sensitive).
- `VAPID_SUBJECT` → `mailto:<tu correo>`.

**Comprueba:** las cuatro variables VAPID están en Vercel, en Production.

### 6.3 Reown (WalletConnect)

Hay dos proyectos de Reown: "elclub prod" para producción y "elclub dev/pre" para desarrollo y preproducción.

1. Entra en [dashboard.reown.com](https://dashboard.reown.com) y crea un proyecto llamado **elclub prod**.
2. En su configuración de dominios (**Domain allowlist**), añade solo `elclub.party`.
3. Copia el **Project ID** → `NEXT_PUBLIC_REOWN_PROJECT_ID` en Vercel.
4. Si aún no lo tienes, crea **elclub dev/pre** con `pre.elclub.party` y `localhost` en la allowlist. Ese Project ID
   va en tu `.env.local` y en preproducción, nunca en Vercel.

**Comprueba:** "elclub prod" tiene `elclub.party` como único dominio permitido.

---

## 7. Primer despliegue

### 7.1 Lanzarlo

1. Revisa la lista de "Orden en el que vas a trabajar" del principio. Todo marcado. Si pusiste el Ignored Build
   Step del paso 3.1, vuelve a dejarlo en Automatic.
2. Mergea a `main` el PR de F5.
3. Ve a la pestaña **Actions** del repo y abre el run del workflow **production**.

**Comprueba:** los tres jobs pasan en verde y en orden: `verify` → `migrate` → `deploy`. En los logs de `migrate`
ves cómo `supabase db push` aplica las migraciones. En Vercel aparece un deployment nuevo en **Production**, en
estado Ready, y `https://elclub.party` carga la página de login.

### 7.2 Si algo falla

- **Falla `verify` en `pnpm install` con `ERR_PNPM_IGNORED_BUILDS`:** una dependencia con script de instalación no
  tiene decisión en `allowBuilds` de `pnpm-workspace.yaml`. Añádela con `true` o `false` en una rama y PR. El
  mismo error aparecería en el build de Vercel.
- **Falla `verify`:** el código tiene un error de tipos, de lint o un test roto. No se ha tocado nada en producción.
  Arréglalo en una rama y vuelve a mergear.
- **Falla `migrate` en `supabase link`:** falta o está mal `SUPABASE_ACCESS_TOKEN` o `SUPABASE_PROJECT_REF`, o el
  Environment no se llama exactamente `production`. Nada se ha desplegado.
- **Falla `migrate` en `supabase db push`:** contraseña incorrecta (`SUPABASE_DB_PASSWORD`) o una migración que no
  aplica. La web sigue con la versión anterior. Lee el error antes de reintentar.
- **`deploy` aparece cancelado u omitido tras `migrate`:** probablemente quedó puesto el Ignored Build Step del paso
  3.1. Vuelve a dejar **Settings → Git → Ignored Build Step** en Automatic y relanza el workflow (paso 7.3). Es
  seguro: las migraciones ya aplicadas no se repiten y son compatibles hacia atrás.
- **Falla `deploy` antes de construir:** `VERCEL_TOKEN`, `VERCEL_ORG_ID` o `VERCEL_PROJECT_ID` mal o caducado. Las
  migraciones ya están aplicadas; relanza cuando lo corrijas.
- **Falla `deploy` con `Configuración de producción inválida`:** mira la tabla del paso 3.4.

### 7.3 Relanzar

- Para repetir un run fallido: ábrelo en **Actions** y pulsa **Re-run all jobs**.
- Para lanzarlo sin hacer push: **Actions → production → Run workflow**, rama `main`.

Los dos repiten `verify` → `migrate` → `deploy`. Las migraciones ya aplicadas no se vuelven a aplicar.

`migrate` y `deploy` solo se ejecutan si el run es de `main`: si lanzas el workflow a mano sobre otra rama, solo
corre `verify`, y el Environment `production` rechaza esa rama de todos modos.

### 7.4 Crear `develop` (después del merge)

El flujo de trabajo es: ramas → PR a `develop` (despliega preproducción) → PR de `develop` a `main` (despliega
producción). `develop` se crea **ahora**, desde un `main` que ya contiene F5, para que tenga el workflow de
preproducción y `deploy/preprod/`.

1. En GitHub, en el repo, abre el selector de ramas, escribe `develop` y elige **Create branch develop from main**.
2. Protégela como `main` (paso 5.2): **Settings → Branches → Add branch protection rule** para `develop`, con PR
   obligatorio y sin force push ni borrado.
3. Si aún no lo hiciste, **Settings → Environments → `preproduction`**: la regla de rama `develop` se añade en la guía
   de preproducción.

**Comprueba:** la rama `develop` existe, contiene `.github/workflows/preproduction.yml` y está protegida.

---

## 8. Arranque de producción

1. Abre `https://elclub.party` y conecta **la wallet cuya dirección pusiste en `SUPER_ADMIN_WALLET`**. Firma el
   mensaje. Como la base de datos está vacía, ese primer login te crea como SuperAdmin.
2. No hay nada que activar a mano: la migración habilita las cuatro redes (Base, Arbitrum y sus testnets) y el
   build decide cuáles se usan (`NEXT_PUBLIC_NETWORK_SET=mainnet`: Base y Arbitrum). Abre `/settings/economia` solo
   para comprobar que ve las dos redes de mainnet.
3. Ve a **`/dao/tesoreria`** y comprueba que **Retiradas** y **Sorteos ponderados** están
   **apagados**. Vienen apagados por defecto. Actívalos **solo tras revisión legal**: los dos mueven dinero real
   según las participaciones, y el plan maestro exige revisarlos con un abogado antes de encenderlos en mainnet.

**Comprueba:** `/settings/economia` muestra Base y Arbitrum, y ninguna testnet.

---

## 9. Safe 1-de-1 → 2-de-3

Hoy tu Safe de mainnet tiene un solo firmante: si pierdes esa wallet, pierdes el acceso a la tesorería. Hazlo
**antes de que entre dinero real**.

1. Prepara dos wallets más que **controles tú**: por ejemplo una en MetaMask del PC, otra en el móvil, e idealmente
   una hardware wallet. Cada una con su propia frase semilla, guardada aparte.
2. **Nunca compartas una frase semilla** con nadie ni la escribas en un chat, un correo o este repositorio.
3. La wallet que ya firma la Safe necesita un poco de ETH en la red de tu Safe para pagar el gas de los cambios.
4. Entra en [app.safe.global](https://app.safe.global), conecta la wallet firmante y abre tu Safe.
5. **Settings → Setup**, en la sección de firmantes:
   - **Add signer** con la primera wallet nueva. Cuando te pregunte el umbral, deja 1.
   - **Add signer** con la segunda. Esta vez pon el umbral en **2 de 3**.
   - Si tu versión de la interfaz junta los cambios en una sola pantalla ("Manage signers"), añade las dos y pon 2
     de 3 a la vez.
6. Firma y ejecuta cada transacción con tu wallet actual.

**Comprueba:** en **Settings → Setup** aparecen 3 firmantes y "2 out of 3". La dirección de la Safe **no cambia**,
así que en la app no tienes que tocar nada. A partir de ahora cada pago desde la Safe necesita dos firmas.

---

## 10. Comprobaciones finales

1. **Cabeceras.** En PowerShell usa `curl.exe` (no `curl`, que en PowerShell es otro comando):
   ```
   curl.exe -sI https://elclub.party/foro/login
   ```
   **Comprueba:** salen `content-security-policy` (con `default-src 'self'` y tu `https://<ref>.supabase.co` en
   `connect-src`), `strict-transport-security: max-age=63072000; includeSubDomains`, `x-frame-options: DENY` y
   `x-content-type-options: nosniff`.
2. **Login y una propina.** Entra con dos cuentas de prueba tuyas (la segunda con una invitación de la primera) y
   manda una propina de 0.01 USDC de una a la otra en Base mainnet.
   **Comprueba:** la propina aparece confirmada tras unas pocas confirmaciones.
3. **Cron.** En Vercel → proyecto → **Settings → Cron Jobs** aparece `/api/cron/dao` cada hora. Después de la
   siguiente hora en punto, en **Logs** filtra por `/api/cron/dao`.
   **Comprueba:** la petición responde 200 con un JSON.
4. **RPC.** Repite `pnpm check:rpc` (paso 1) de vez en cuando, y siempre que cambies de plan o de
   proveedor.

---

## 11. Copias de seguridad (Supabase Free)

Supabase Free no te deja descargar copias, así que las haces tú. Una vez a la semana, y antes de cualquier cambio
grande.

**Necesitas Docker Desktop abierto**: `supabase db dump` ejecuta `pg_dump` dentro de un contenedor.

1. Enlaza la carpeta a producción solo para este paso (paso 2.9) y que la contraseña no quede en el historial:
   en Git Bash, desde la carpeta del proyecto, léela sin eco:
   ```
   read -rs SUPABASE_DB_PASSWORD && export SUPABASE_DB_PASSWORD
   pnpm exec supabase login
   pnpm exec supabase link --project-ref <ref>
   ```
   `read -rs` no escribe lo que pegas en pantalla ni en `~/.bash_history`. No pongas la contraseña ni la cadena de
   conexión directamente en un comando.
2. Descarga (`--linked` usa la contraseña del entorno, así no va en los argumentos del comando):
   ```
   mkdir -p backup
   pnpm exec supabase db dump --linked -f backup/roles.sql --role-only
   pnpm exec supabase db dump --linked -f backup/schema.sql
   pnpm exec supabase db dump --linked -f backup/data.sql --use-copy --data-only
   ```
3. Imágenes de Storage (también con el proyecto enlazado):
   ```
   pnpm exec supabase storage cp -r ss:///chat-images ./backup/chat-images --experimental
   pnpm exec supabase storage cp -r ss:///avatars ./backup/avatars --experimental
   ```
   Y desenlaza al terminar, y borra la variable:
   ```
   pnpm exec supabase unlink
   unset SUPABASE_DB_PASSWORD
   ```
4. Guarda la carpeta `backup` **fuera** del repo y fuera de tu PC (un disco externo o una nube tuya, cifrada). Nunca
   la subas a GitHub: tiene los datos de todos los miembros.
5. Una vez, haz un **simulacro de restauración** en un proyecto de Supabase de usar y tirar (o en tu Supabase local),
   cargando `roles.sql`, `schema.sql` y `data.sql` en ese orden con `psql`. Una copia que nunca has restaurado no es
   una copia.
6. Cuando entre dinero real de verdad, pasa a Supabase **Pro**: tiene copias diarias y recuperación a un punto en el
   tiempo (PITR).

**Comprueba:** los tres `.sql` existen y no están vacíos, y las carpetas de imágenes tienen archivos.

---

## 12. Notas de producción (de F4)

- **RPC:** Infura tiene que servir estado de archivo y `eth_getLogs` de al menos 2000 bloques. Lo compruebas con
  `check:rpc` (paso 1).
- **`NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL` y `NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL` siempre vacías** en producción. El build falla
  si no lo están.
- **Nunca `tx=rollback`** en PostgREST (paso 2.7).
- **Retiradas apagadas por defecto**, y **sorteos ponderados apagados en mainnet**. Se encienden solo tras revisión
  legal.
- **Cambiar una variable `NEXT_PUBLIC_*` o la URL de Supabase obliga a reconstruir.** Esas variables, y la CSP que se
  calcula con ellas, quedan fijadas dentro del build. Tras cambiarlas en Vercel, relanza el workflow (paso 7.3). Si
  usas **Redeploy** en el panel de Vercel, desmarca la caché de build.
- **Después de vaciar la base de datos** (por ejemplo, si restauras en un proyecto nuevo), vuelve a `/settings/economia`
  y comprueba que ve Base y Arbitrum: la migración habilita las cuatro redes y el build decide cuáles se usan.
- **La finalidad tarda.** Los pagos de retiradas y los sorteos se cierran en una pasada posterior del cron,
  no al instante. Es normal que algo quede "pendiente" hasta la siguiente hora.
- **Migraciones compatibles hacia atrás.** El workflow aplica las migraciones (`migrate`) y solo después construye y
  publica el código nuevo (`deploy`, que tarda unos minutos). En ese intervalo el código **antiguo** sigue sirviendo
  tráfico sobre el esquema **nuevo**. Una migración que borre o renombre algo que el código antiguo usa (una
  columna, la firma de una función RPC) rompe producción durante esa ventana. Regla: expandir → desplegar →
  contraer. Primero una migración que solo añade (columnas nuevas, funciones nuevas o `create or replace`
  compatibles); en un PR posterior, cuando el código nuevo ya está en producción, otra migración que quita lo que
  sobra.
- **Nunca lances los tests e2e ni `pnpm db:test` contra producción.** Escriben y borran datos. Son solo para tu
  Supabase local.

---

## 13. Límites: qué ve un miembro

Para frenar abusos, la base de datos cuenta cuántas veces hace cada cosa cada miembro. Los límites están pensados
para que una persona activa no llegue nunca. Cuando alguien se pasa, la acción no se hace y ve el aviso "Has hecho
demasiadas acciones seguidas. Espera un rato antes de volver a intentarlo." (`rate_limited`). Basta con esperar a que
pase la ventana.

| Acción | Límite |
|---|---|
| Escribir mensajes (también bounties y encuestas) | 30 por minuto y 600 por hora |
| Reaccionar | 60 por minuto |
| Tickets de soporte (abrir o responder) | 20 por minuto |
| Iniciar un pago (propina, pago de bounty, donación) | 30 cada 10 minutos |
| Votar en encuestas | 30 por minuto |
| Entrar o salir de sorteos | 30 cada 10 minutos |
| Crear invitaciones | 30 al día (los administradores no tienen límite) |
| Pedir o cancelar retiradas | 20 al día |
| Cambiar perfil, nombre o avatar | 30 por hora |
| Verificaciones en la blockchain | 120 cada 10 minutos. Si se alcanza, el pago queda "pendiente" y el cron lo confirma después; nunca se marca como fallido |
| Canjear una invitación | 10 intentos por hora |
| Subir imágenes al chat | 60 por hora |
| Subir avatares | 20 por hora |
| Reportar mensajes | 10 por hora |
| Login con wallet | 30 cada 5 minutos por IP (paso 2.4) |
