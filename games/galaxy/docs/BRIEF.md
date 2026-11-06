# Galaxy Survivor · Brief de partida

> Documento de traspaso, 2026-11-06. Recoge todo lo decidido con el usuario antes del brainstorming. **La siguiente sesión empieza aquí**: leer este archivo completo, después `INSTRUCCIONES_PROYECTO.md`, y arrancar `superpowers:brainstorming` sobre los temas abiertos (sección 6).
> Rama de trabajo: `feature/galaxy-survivor`, creada desde `develop`. Nunca trabajar directamente en `develop`: cada push despliega PRE.

## 1. Qué es

**Galaxy Survivor** es un juego web **sin web3** que usa como recurso principal las galaxias braille del motor de **ElClub Nebula**. Es un híbrido de tres partes:
- una **estación idle** propia;
- **aventuras estilo survivor**;
- un **gachapón** que **genera en el momento** una galaxia única. Esa galaxia es a la vez carta coleccionable y reliquia con pasivas.

Como las galaxias se generan en vivo (RNG puro), **el juego no usa ni expone las 1.000 piezas de la colección NFT**: no afecta a su revelado diferido ni a su provenance.

Se sirve en **`pre.elclub.party/galaxy`** (solo preproducción de momento), con la base de datos del Supabase autoalojado de PRE.

## 2. Decisiones del usuario (cerradas)

| Tema | Decisión |
|---|---|
| Nombre | **Galaxy Survivor** |
| Plataforma / idioma | Solo **escritorio** · solo **español** |
| Bucle | **Híbrido**: estación-observatorio propia (idle, farmeo AFK mínimo) + aventuras survivor de **5–20 min** sin límite de tiempo. La dificultad sube hasta que el jugador cae tarde o temprano. **Puntos de extracción** = 100 % del botín; **morir** = 50 % |
| Gachapón | Cada tirada **genera** una galaxia única (imagen y datos al momento). Economía **equilibrada**: varias tiradas por sesión, una gratis al día y pity |
| Galaxias | Cartas coleccionables con **rareza**, acabados **holográficos** e **inspección 3D**. Son reliquias con pasivas, con **ranuras desbloqueables de 2 a 6** |
| Galaxias sobrantes | **Desintegrar** en polvo estelar · **fusionar** varias en una nueva de rareza superior · **exponer** en la estación (ingresos idle según sus rasgos) |
| Protagonista | **Nave/sonda pixel art** del ECN Survey Terminal |
| Enemigos | **Fauna cósmica infectada por la Estática** (corrupción de datos) |
| Zona idle | **Observatorio-estación** con módulos construibles y mejorables |
| Estilo visual | **Pixel art** para la nave, los enemigos, la estación y los efectos. **Galaxias en braille**, para conservar la esencia de la colección. Interfaz **moderna e intuitiva** definida por la IA. Debe tener **sentido real** y ser **adictivo**. Hacerlo todo en braille se descartó por poco intuitivo |
| Arte | Sprites **generados por código** + packs **CC0** (p. ej. Kenney) |
| Audio | **Sintetizado por código** (WebAudio): música adaptativa chiptune/synthwave y efectos |
| Social | Clasificación global · perfiles y colecciones públicas · **intercambio**: trueque 1:1 confirmado por ambos **y** mercado con **precio mínimo según la rareza** · eventos y temporadas |
| Cuentas | **Usuario + contraseña** (sin email) |
| Pagos | **Ninguno con dinero real**: solo monedas del juego |
| Admin | Panel con poder total: ver estadísticas y datos de todos, ver y editar inventarios, añadir o quitar galaxias, monedas y tiradas, banear. **Primer admin: usuario `rayelus`** |
| Entorno | Solo **PRE** de momento (`pre.elclub.party/galaxy`), con la base de datos de PRE |

## 3. Semilla de concepto (propuestas para el brainstorming, no decididas)

- **Premisa.** La Estática devora la Nebulosa ElClub e infecta su fauna. Eres operador de una estación del ECN y envías tu sonda a sectores del cielo para rescatar y transcribir galaxias antes de que desaparezcan.
- **Metas reales.** Tres objetivos:
  1. Completar el **Catálogo ECN**, un álbum de tipos, paletas, fenómenos y acabados.
  2. Llegar a **sectores más profundos**, que son la clasificación principal.
  3. **Purgar los Núcleos de la Estática**: jefes de sector y de temporada.

  Además, un prestigio opcional, el «Corrimiento al rojo».
- **Los rasgos del motor dan las pasivas.**
  - **Galaxy Type** → familia de la pasiva:
    - Espiral: cuchillas orbitales
    - Barrada: rayo perforante
    - Elíptica: escudo
    - Lenticular: lente crítica
    - Irregular: efecto caótico
    - Anular: aura
    - Enana: recogida y velocidad
    - Fusión: copia otra reliquia
  - **Arms (2–6)** → número de proyectiles o cargas.
  - **Size** → magnitud.
  - **Core** → nivel de potencia (Quasar añade un rayo; Double Nucleus duplica).
  - **Star Density** → frecuencia.
  - **Palette** → elemento y sinergias. Ejemplos:
    - Solar Gold: quemadura
    - Andromeda Blue: ralentiza
    - Terminal Green: corrosión
    - Ultraviolet: descarga
    - Amber CRT: «hackear» enemigos
    - Antimatter: invierte proyectiles enemigos
    - Prismatic: rota elementos
    - …
  - **Background** → bonus de entorno.
  - **Phenomenon** → habilidad única:
    - Supernova: nova periódica
    - Satellite: dron
    - Globular: orbes
    - Comet: embestida
    - Jets: láseres gemelos
    - Pulsar: ondas rítmicas
    - Einstein Ring: duplica proyectiles
    - Anomaly: efecto glitch impredecible
  - **Bonus de conjunto** por combinaciones de rasgos.
- **Rareza coherente.** Primero se sortea el nivel (Common…Legendary) y luego se generan rasgos cuya rareza real caiga en ese nivel: lo raro se ve raro. El **acabado** se sortea aparte: Normal, Holo, Prismático, Relieve braille o Corrupto (ultra-raro).
- **Revelado del gachapón = «escaneo de campo profundo».**
  - El terminal CRT barre la estática, suben las barras de señal y la galaxia se resuelve punto a punto.
  - El color de la línea de escaneo y el tono del sonido anticipan la rareza.
  - Si sale un fenómeno: «FENÓMENO DETECTADO».
  - Una Legendary hace fallar la pantalla y suena un acorde.
  - Sello sonoro: el clac de una **máquina Perkins de braille**.
- **Carta en 3D.** Inclinación con el ratón, paralaje y shader holográfico. **El reverso muestra la transcripción braille en relieve** de la galaxia, más sus estadísticas.
- **Módulos de la estación:**
  - Antena (señal pasiva)
  - Laboratorio (mejoras permanentes)
  - Hangar (sonda y armas)
  - Planetario (galaxias expuestas: ingresos idle)
  - Escáner profundo (gachapón)
  - Colisionador (fusiones)
  - Comunicaciones (trueque y mercado)
  - Tope de acumulación AFK

## 4. Arquitectura técnica (propuesta validada; se confirma en el brainstorming)

### 4.1 Código y despliegue

- **Código:** `games/galaxy/`, workspace pnpm independiente con su propio lockfile:
  - `apps/web`: cliente.
  - `apps/server`: API.
  - `packages/engine`: motor de galaxias portado.
  - `packages/sim`: simulación de las aventuras.
  - `packages/rules`: economía y reglas.
  - `packages/shared`: esquemas Zod.

  En la raíz, excluir `games/**` de `tsconfig.json`, `eslint.config.mjs` y `.dockerignore`. Así hay **un solo historial de migraciones y un solo pipeline de PRE**: con dos repos, `supabase db push` fallaría en ambos.
- **Hosting en PRE:**
  - **Contenedor `galaxy`** (Node 22 + Fastify): sirve la API en `/galaxy/api/*` y el build de Vite (`base: '/galaxy/'`) en `/galaxy/*`. Está en la red `supabase_default` y conecta con Postgres en `db:5432` con un rol propio, `galaxy_api`, que solo ve el esquema `galaxy`. Ese esquema **no se expone por PostgREST**.
  - **Túnel** (`deploy/preprod/cloudflared/config.yml`): esta regla va **antes** de la de `pre.elclub.party`:
    ```yaml
    - hostname: pre.elclub.party
      path: ^/galaxy(/|$)
      service: http://galaxy:8080
    ```
    Así el juego queda fuera de Next: sin proxy de login (`src/proxy.ts`), sin la CSP del foro y sin wallets.
  - **CSP propia y estricta:** `script-src 'self'`, `connect-src 'self'`, `worker-src 'self' blob:`, `frame-ancestors 'none'`, HSTS. PixiJS se importa como `pixi.js/unsafe-eval`.
  - **Producción** (más adelante): rewrite de Vercel de `/galaxy/:path*`.
  - **Pipeline:** `preproduction.yml` añade el build, el restart y el smoke de `/galaxy/api/health`. Además, un `galaxy-ci.yml` con runners de GitHub para los cambios en `games/**`.

### 4.2 Cuentas propias

No se usa Supabase Auth: una sesión de Supabase también sería válida para el proxy y para las funciones de ElClub.
- **Usuario:** `^[a-z0-9_]{3,20}$`, sin distinguir mayúsculas.
- **Contraseña:** argon2id (`@node-rs/argon2`).
- **Sesión:** token aleatorio guardado como hash, en la cookie `gs_sid` (HttpOnly, Secure, SameSite=Strict, `Path=/galaxy`).
- **Protecciones:** comprobación de Origin, límites por IP (`CF-Connecting-IP`) y por usuario, tiempo constante.
- **Contraseña olvidada:** sin email, el admin emite **códigos de un solo uso**.
- **Primer admin:** `rayelus` queda reservado en una migración y se crea con un comando en el contenedor (`create-admin rayelus`).

### 4.3 El servidor decide todo

Fastify + Zod compartido + Kysely. Cada acción de economía es una transacción con clave de idempotencia. Hay un libro de movimientos de solo añadir y saldos que nunca bajan de 0.
- **Gacha:**
  1. Se sortea el nivel con las probabilidades del banner y el pity.
  2. Se generan rasgos desde una semilla segura hasta caer en la **banda de puntuación** de ese nivel. Las bandas se calibran con una simulación offline: con suministro infinito no sirve el ranking del NFT.
  3. El acabado se sortea aparte.

  Cada tirada guarda semilla, pity y versión del motor, así que se puede auditar.
- **Fusión y desintegración:** se guarda el linaje. La galaxia fusionada recibe una semilla nueva.
- **Idle:** se cobra al recoger, `min(ahora − último, tope) × ritmo`, con la hora del servidor.
- **Aventuras:** el servidor entrega la semilla y una foto de las reliquias. El resultado se envía una sola vez y pasa controles de plausibilidad; las partidas sospechosas se marcan y quedan fuera de la clasificación. La simulación es determinista desde el primer día, para poder reproducir partidas.
- **Trueque y mercado:**
  - Lo que se ofrece queda en depósito; cada trato tiene versiones y ambos confirman la misma.
  - Un trigger impone el **precio mínimo por rareza**.
  - Comisión de venta como sumidero, bloqueo contra dobles compras y edad o nivel mínimo para comerciar.
- **Admin:** cada acción escribe en `admin_audit_log` dentro de la misma transacción (quién, qué, antes y después, motivo e IP). Ese registro no se puede editar. Un ban cierra sesiones y cancela anuncios y tratos. Los límites de frecuencia copian el patrón de `private.rate_limit` (`supabase/migrations/20261019700101_rate_limits.sql`).

### 4.4 Base de datos

Esquema `galaxy`. Migraciones `supabase/migrations/2026111x…_galaxy_*.sql` y tests pgTAP en `supabase/tests/9xx_galaxy_*`. Tablas:

| Área | Tablas |
|---|---|
| Cuentas | accounts, account_roles, reserved_usernames, sessions, reset_codes, rate_limit_hits |
| Monedas | balances, currency_ledger |
| Galaxias y gacha | galaxies, galaxy_lineage, banners, pity_counters, gacha_pulls |
| Reliquias y estación | relic_loadouts, station_state, station_modules, station_displays |
| Aventuras y temporadas | runs, seasons, vista de clasificación |
| Comercio | trades, trade_items, market_listings, market_min_prices |
| Administración | admin_audit_log |

### 4.5 Cliente

- **Interfaz:** Vite + React 19 + TanStack Query + Zustand + Tailwind v4/Radix, diseñada con ui-ux-pro-max. Textos en un catálogo en español; fuente pixel autoalojada con ñ, ¿ y ¡.
- **Combate:** **PixiJS v8** solo dibuja. La lógica vive en `packages/sim`: paso fijo de 60 Hz, arrays tipados, rejilla espacial y RNG con semilla (nunca `Math.random`).
- **Motor de galaxias:**
  - Workers en TypeScript con un PCG64 compatible con numpy calculan puntos, tramado, estrellas y fenómenos, a 192, 96 y 48 columnas.
  - Un único canvas WebGL2 fuera de pantalla aplica glow, viñeta, CRT y tonemap.
  - Caché en memoria e IndexedDB por galaxia, versión y nivel de detalle.
- **Cartas:**
  - En la rejilla: inclinación y brillo con CSS 3D.
  - Al inspeccionarlas: **three.js**, cargado solo entonces, con shader holográfico.
  - En la fusión: los puntos de las galaxias se convierten en partículas que colisionan.
- **Audio:** WebAudio con planificador anticipado. Capas musicales según la intensidad; los toques del gachapón escalan con la rareza.
- **Solo escritorio:** se exige puntero fino y al menos 1280×720.

### 4.6 Producción y riesgos

- **Producción:** al fusionar `develop` en `main`, el esquema `galaxy` se crea también en el Supabase de producción. Queda vacío, inerte y sin exponer. **Aceptado**: servirá para el lanzamiento.
- **Riesgos:**
  - Mismo origen que el foro: CSP estricta en ambos lados.
  - Si el motor cambia, cambian galaxias que ya tiene la gente: **versionar el motor y congelar los visuales v1** antes de que nadie juegue.
  - Las diferencias de `Math.*` entre navegadores solo afectan a la imagen; la semilla, los rasgos y la rareza mandan.
  - Sin email puede haber bots: límites ahora y Cloudflare Turnstile si hace falta.
  - Las aventuras se simulan en el cliente: controles de plausibilidad ahora y verificación por repetición después.

## 5. Motor de referencia (repo `C:\Users\rayel\Desktop\galaxy-nft`)

Python, unas 2.000 líneas, con 50 tests que pasan.

| Archivo | Qué contiene |
|---|---|
| `src/galaxy_nft/rng.py` | Semillas derivadas con SHA-256 y PCG64 por subsistema |
| `src/galaxy_nft/traits.py` | Sorteo ponderado con reglas `requires` / `forbid` / `force` y DNA |
| `config/traits.yaml` | 9 rasgos con pesos, reglas y datos numéricos |
| `config/palettes.yaml` | 11 paletas en OKLab; Amber CRT con color de detalle y post-procesado CRT |
| `config/visuals.yaml` | Tamaños, núcleos, fondos y fenómenos |
| `src/galaxy_nft/fields.py` + `geometry/*.py` | Espiral, barrada, elíptica, lenticular, anular, irregular, enana, fusión |
| `src/galaxy_nft/noise.py` | Value noise, fBm, ruido celular |
| `src/galaxy_nft/background.py`, `stars.py` | Fondos y estrellas |
| `src/galaxy_nft/phenomena.py` | Los 8 fenómenos |
| `src/galaxy_nft/render/braille.py` | Rejilla de 384×384 puntos (192 columnas), tramado Bayer y exportación a texto braille Unicode |
| `src/galaxy_nft/render/postfx.py` | Glow multiescala, viñeta, tonemap, desconvergencia CRT y scanlines |
| `src/galaxy_nft/pipeline.py` | El pipeline completo de un token |
| `docs/TRAITS.md`, `docs/DECISIONES.md` | Catálogo de rasgos y decisiones de diseño |

- **Coste:** la galaxia en sí (147.000 puntos) es barata. Los 8 s por imagen se van en el post-procesado a 2048 px, que en el juego se hará con WebGL.
- **Rareza:** la del NFT es por contenido de información dentro de una colección cerrada de 1.000 piezas. En el juego, con suministro infinito, se usan bandas calibradas.

## 6. Temas abiertos para el brainstorming (una pregunta cada vez)

1. **Economía:**
   - monedas y sumideros
   - probabilidades por nivel, pity y probabilidades de los acabados
   - coste de una tirada y tirada gratis diaria
   - costes de fusión y rendimiento de la desintegración
   - precios mínimos y comisión del mercado
   - límites anti-abuso del trueque
2. **Aventura:**
   - sectores y biomas
   - armas y mejoras al subir de nivel
   - bestiario y jefes
   - reglas y ritmo de los puntos de extracción
   - curva de dificultad
   - recompensas
3. **Estación:** módulos, costes, ritmo idle, tope AFK, árbol del laboratorio.
4. **Reliquias:** tabla final de rasgos → pasivas, bonus de conjunto, equilibrio, desbloqueo de ranuras.
5. **Progresión:** onboarding/tutorial, metas a largo plazo, prestigio, temporadas y eventos.
6. **Social:** categorías de clasificación, perfiles.
7. **Admin:** funciones concretas del panel, auditoría, bans, códigos de recuperación.
8. **Presentación:**
   - catálogo de animaciones (*juice*) y de efectos de sonido
   - capas musicales
   - interfaz de cada pantalla (con ui-ux-pro-max)

Entregables:
- `games/galaxy/docs/GDD.md`
- `games/galaxy/docs/DESIGN_SYSTEM.md`
- Planes de implementación por hito (`superpowers:writing-plans`)

## 7. Hitos

| Hito | Contenido |
|---|---|
| **M0** | Diseño (este brainstorming) |
| **M1** | Esqueleto, cuentas y despliegue en PRE |
| **M2a** | Port del motor + referencias (`galaxy-nft/tools/golden/export.py`) |
| **M2b** | Gachapón, colección, cartas e inspección 3D, desintegración y fusión |
| **M3** | Porción jugable de la aventura (simulación + arena Pixi) |
| **M4** | Estación idle |
| **M5** | Clasificaciones, perfiles, trueque y mercado |
| **M6** | Panel de admin y auditoría |
| **M7** | Temporadas, audio adaptativo, pulido, pruebas de carga y ruta de producción |

Verificación en cada hito: TDD estricto (Vitest + fast-check para las reglas, pgTAP para la base de datos y Playwright para el e2e). El motor portado se compara con el de Python. `preproduction.yml` debe quedar en verde.
