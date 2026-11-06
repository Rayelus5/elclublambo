# Galaxy Survivor · M2a: port del motor de galaxias · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El motor de galaxias de Python (`C:\Users\rayel\Desktop\galaxy-nft`) portado a TypeScript en `games/galaxy/packages/engine`. Debe cumplir tres cosas:
- dar los **mismos rasgos y el mismo braille, carácter por carácter**, que el original para la misma semilla y las mismas columnas (192, 96 y 48);
- tener el posprocesado (brillo, viñeta, tonemap, CRT) en WebGL2, visualmente equivalente;
- funcionar en Workers con caché.

Además, el **fondo de acceso** se rediseña con galaxias reales del motor que aparecen y se funden, y el despliegue de la imagen del juego deja de tardar 17 minutos.

**Architecture:**
- `packages/engine` es isomórfico (Node y navegador, sin DOM) en todo lo que decide el braille:
  - semillas: SHA-256, SeedSequence y PCG64 con BigInt;
  - rasgos;
  - campos de densidad en `Float64Array`;
  - tramado, estrellas, destellos, fenómenos y texto braille.
- El servidor lo usará en M2b para sortear rasgos.
- `packages/engine/src/gpu` (solo navegador) compone la imagen en WebGL2 a partir de los colores y radios de cada punto.
- La web calcula en un Worker, guarda en caché (memoria + IndexedDB) y dibuja.
- **Fidelidad:** referencias doradas exportadas del Python, que es la verdad, y comparación exacta del braille.

**Tech Stack:**
- TypeScript con `Float64Array` y BigInt; `@noble/hashes` (SHA-256 síncrono).
- Vitest: proyecto `unit` en Node y proyecto nuevo `browser` (Vitest browser mode con Playwright Chromium y WebGL2).
- WebGL2, Web Workers e IndexedDB.
- Python 3.13 del venv de galaxy-nft para exportar las referencias.

**Spec:**
- `games/galaxy/docs/GDD.md`: §7 (generación), §17.1 (fondo vivo) y §18.3 (motor).
- Referencia técnica exacta: `games/galaxy/docs/ENGINE_PORT.md`, que copia la Tarea 2 del resumen verificado del motor. Las secciones que cito abajo (§1.3, §2.4…) son las de ese documento.
- Fondo de acceso pedido por el usuario el 2026-11-06:
  - «quiero que se viera como una especie de galaxias, que aparezca una, y vaya fundiéndose mientras aparece otra diferente, animadas a lo largo del tiempo sin perder la forma»;
  - sin estación ni planeta;
  - «más misterioso, creativo y con estilo».

## Global Constraints

- **Rama:** `feature/galaxy-m2a`, que sale de `origin/develop` (c02de77). Commits en español con formato convencional y la línea `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. El hito termina en un PR a `develop`; el usuario autorizó fusionar si el CI está verde.
- **TDD estricto**, con referencias doradas como tests. Ningún código del motor sin un test que falle antes.
- **Fidelidad (ENGINE_PORT §0, §8):**
  - campos en `Float64Array` y el mismo orden de operaciones que Python, sin reasociar;
  - `hypot` se escribe siempre como `Math.sqrt(x*x + y*y)`, nunca `Math.hypot`;
  - `t_bg` y `light.t` pasan por `Math.fround`;
  - las potencias escalares que Python hace con `pow` se replican como `Math.pow`, y las de array `**2` como `x*x` (§8);
  - el módulo negativo se corrige a positivo;
  - el redondeo es half-to-even donde Python usa `rint` o `round`.
- **Orden del YAML:** se conserva siempre (arrays o `Map`; nunca objetos con claves numéricas).
- **Sin aleatoriedad suelta:** nada de `Math.random` ni `Date` en el motor. Todo sale de `subRng(seed, name)` o de `subSeed32`.
- **Versión:** `ENGINE_VERSION = '1.0.0'`. Las referencias doradas `test/golden/v1` congelan los visuales v1. Cambiarlas exige subir la versión.
- **Python solo con** `C:\Users\rayel\Desktop\galaxy-nft\.venv\Scripts\python.exe`, con `PYTHONIOENCODING=utf-8`, `PYTHONDONTWRITEBYTECODE=1` y `-I`. galaxy-nft no se modifica: el exportador vive en este repo.
- **Frontend:** consultar ui-ux-pro-max antes del CSS. Tokens de `DESIGN_SYSTEM.md`. Respetar `prefers-reduced-motion`. La CSP del juego no cambia: los Workers salen de un archivo propio (`worker-src 'self' blob:` ya lo permite) y nada se evalúa.
- **BD local:** la del usuario. Nada en este hito escribe en ella salvo los e2e existentes.
- **Windows:** añadir `/c/Windows/System32` al final del PATH antes de Playwright. Nunca escribir archivos con `Set-Content` ni `Out-File`.

## Review Focus

1. **Semillas de 64 bits por encima de 2^63.** Se convierten a decimal exacto en `deriveSeed`, sin `Number`, y producen el mismo flujo que numpy → Tarea 3.
2. **Paleta invertida (antimatter).** Dots de `t**0.7` y fondo forzado a `deep_void`; el braille coincide → Tareas 4 y 8.
3. **Bordes en 48 columnas.** Las cruces de destellos y los recortes de la Anomaly no salen de la rejilla ni lanzan errores → Tareas 8 y 9.
4. **Sin WebGL2 o con el contexto perdido.** El fondo sigue funcionando con el dibujado sin posprocesado, sin pantallas en blanco ni excepciones → Tareas 10 y 13.
5. **Pestaña oculta o fundidos rápidos.** El fondo se pausa sin acumular Workers ni memoria (caché LRU con tope) → Tareas 11 y 13.

---

## Mapa de archivos

```
games/galaxy/
  Dockerfile                                    (Tarea 1)
  docs/ENGINE_PORT.md                           (Tarea 2, resumen verificado del motor)
  tools/golden/export.py                        (Tarea 2, exportador de referencias con el venv de galaxy-nft)
  tools/golden/reference/{pcgref,gauss,bicubic}.py
  packages/engine/
    package.json, tsconfig.json
    config/{traits,palettes,visuals,collection}.yaml      (copias de galaxy-nft)
    scripts/gen-config.mjs                       (YAML → src/config/generated.ts, con orden)
    src/index.ts
    src/version.ts
    src/rng/{sha256,seed,pcg64,generator}.ts
    src/config/{generated,types}.ts
    src/traits.ts
    src/color.ts
    src/noise.ts
    src/geometry/{common,spiral,elliptical,irregular,ring,merger}.ts
    src/fields.ts
    src/background.ts
    src/stars.ts
    src/phenomena.ts
    src/raster.ts                                 (BrailleGrid, dither, toText)
    src/render.ts                                 (renderBraille, renderFromSeed)
    src/gpu/{compose,shaders}.ts                  (solo navegador)
    test/golden/v1/{rng,traits,params,colors}.json, cases/*.json, images/*.png
    test/*.test.ts, test/browser/*.browser.test.ts
  apps/web/src/galaxy/{worker.ts,client.ts,cache.ts}
  apps/web/src/scene/{GalaxyBackdrop.tsx,backdrop-schedule.ts}   (sustituye a AuthBackdrop/scene.ts)
  apps/web/test/backdrop-schedule.test.ts
```

---

### Task 1: Despliegue rápido de la imagen del juego

**Files:**
- Modify: `games/galaxy/Dockerfile`, `games/galaxy/apps/server/test/unit/deploy-config.test.ts`

**Interfaces:**
- Produces:
  - **Etapa `build`:**
    - instala con un *cache mount* de BuildKit para el almacén de pnpm: `RUN --mount=type=cache,id=galaxy-pnpm,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts`, con `ENV PNPM_STORE_DIR=/pnpm/store` o `--store-dir`;
    - las dependencias de producción del servidor se preparan **sin red**: `pnpm --filter @galaxy/server deploy --prod --legacy --offline /out`, con el mismo *cache mount*.

- [ ] **Step 1: Escribir el test que falla**, en `deploy-config.test.ts`, «la imagen prepara las dependencias de producción sin red»:
  - el `Dockerfile` contiene `deploy --prod --legacy --offline`;
  - toda línea `RUN` con `pnpm install` o `pnpm --filter` lleva `--mount=type=cache`.

- [ ] **Step 2: Ejecutar y ver que falla.** Run: `pnpm -C games/galaxy vitest run --project unit deploy-config`. Expected: FAIL.

- [ ] **Step 3: Cambiar el Dockerfile y construir en local dos veces**
  - Run:
    ```
    docker build --no-cache -t elclub-galaxy:t1 games/galaxy
    docker build -t elclub-galaxy:t1b games/galaxy
    ```
    midiendo el tiempo de cada uno.
  - Expected: el paso `deploy` tarda menos de 60 s en la primera build y la segunda reutiliza la caché.
  - Después, el smoke del contenedor de M1: health `{"ok":true,"db":"up"}` contra la BD local, `docker run --read-only`.

- [ ] **Step 4: Ver que pasa y hacer commit:** `perf(galaxy): la imagen instala las dependencias de producción sin red`.

---

### Task 2: Referencias del motor y exportador dorado

**Files:**
- Create:
  - `games/galaxy/docs/ENGINE_PORT.md`, copia del resumen verificado (`engine-digest.md` del scratchpad de la sesión), con una cabecera que diga que es la referencia del port;
  - `games/galaxy/tools/golden/reference/{pcgref,gauss,bicubic}.py`, copias;
  - `games/galaxy/tools/golden/export.py`;
  - `games/galaxy/packages/engine/config/*.yaml`, copias exactas de `galaxy-nft/config/{traits,palettes,visuals,collection}.yaml`;
  - `games/galaxy/packages/engine/test/golden/v1/**`, generados.

**Interfaces:**
- Produces: `export.py` (se ejecuta con el venv de galaxy-nft; importa `galaxy_nft` desde su `src`). Escribe lo siguiente en `packages/engine/test/golden/v1/`:

  | Archivo | Contenido |
  |---|---|
  | `rng.json` | Vectores de `derive_seed`, `sub_seed32`, estado de `PCG64`, `random_raw` y `random` (los del §2.7 y del Apéndice A); para 6 semillas, entre ellas una ≥ 2^63, 64 valores de `random()`, `integers(0,24)`, `integers(3,8)`, `choice(p=[...])`, `choice([-1,1])`, `permutation(10)` y `choice(range(50), size=7, replace=False)`, intercalados en un orden fijo que mezcla llamadas de 32 y 64 bits para cubrir el búfer |
  | `traits.json` | 500 semillas `token_seed(20261104, i)`: `draw(sub_rng(seed,"traits"))` y su DNA; además 30 sorteos con `fixed`, entre ellos `{size: large}` (sin enanas) y `{palette: antimatter}` (fondo forzado) |
  | `params.json` | `build_params` de los 8 tipos (los tokens del Apéndice A) a 192, 96 y 48 columnas |
  | `colors.json` | Para cada paleta, 64 muestras de `Palette.sample` y `sample_cyclic` (Prismatic) en float32, y el `blackbody_linear` de 12 temperaturas |
  | `cases/<nombre>.json` | Un caso por combinación de la tabla de abajo, con `seed`, `fixed`, `traits`, `dna`, `braille` en 192, 96 y 48 columnas (texto LF) y muestras de campo: `gal.t`, `t_bg` y `light.t` en los dots `(j, i)` con `j, i ∈ {0, 37, 101, 192, 255, 383}` ∩ rejilla, más 40 dots fijos cerca del centro |
  | `images/<nombre>.png` | Para 8 casos, el PNG de 2048 de Python reducido a 256×256 con Pillow LANCZOS |

  **Casos:** las semillas son `token_seed(20261104, 9000 + k)`, renderizadas con `render_custom`-like (`fixed`):

  | Galaxy type | Casos |
  |---|---|
  | spiral | `none` + andromeda_blue; `anomaly` + amber_crt; `einstein_ring` + edge_on |
  | barred_spiral | quasar + `relativistic_jets`; `pulsar` |
  | elliptical | shells (búsqueda de semilla hasta que salgan); `supernova` + antimatter |
  | lenticular | `comet`; `globular_cluster` |
  | irregular | cosmic_web; microwave_background |
  | ring | `satellite_galaxy`; prismatic |
  | dwarf | spheroidal; irregular |
  | merger | `supernova`; spiral B |

  Además, uno por paleta que falte hasta cubrir las 11 y uno por fondo hasta cubrir los 5. En total, unos 26 casos.

  **Autocomprobación:** `export.py --check` vuelve a renderizar el token #1 y compara con `manifest.json`.

- [ ] **Step 1: Escribir `export.py` con `--check` y ejecutarlo.**
  Run: `PYTHONIOENCODING=utf-8 PYTHONDONTWRITEBYTECODE=1 "C:/Users/rayel/Desktop/galaxy-nft/.venv/Scripts/python.exe" -I games/galaxy/tools/golden/export.py --check`
  Expected: `token 1 ok: braille sha256 741aa14e…c4fb (LF), image sha256 = manifest`.

- [ ] **Step 2: Exportar.** Run: el mismo comando con `--out games/galaxy/packages/engine/test/golden/v1`. Expected: escribe los archivos de la tabla, unos 26 casos y menos de 3 MB en total.

- [ ] **Step 3: Commit:** `test(galaxy): referencias doradas del motor de Python y documento del port`.

---

### Task 3: Semillas y generador (SHA-256, SeedSequence, PCG64)

**Files:**
- Create: `packages/engine/{package.json,tsconfig.json}`, `src/rng/{sha256,seed,pcg64,generator}.ts`, `src/index.ts`, `src/version.ts`
- Test: `packages/engine/test/rng.test.ts`

**Interfaces:**
- Produces (`@galaxy/engine`):
  - `ENGINE_VERSION = '1.0.0'`.
  - `deriveSeed(...parts: Array<string | number | bigint>): bigint`, con partes en decimal exacto unidas por `\x1f` y los primeros 8 bytes del SHA-256 big-endian.
  - `subSeed32(seed: bigint, name: string): number`.
  - `tokenSeed(master: number, index: number): bigint`.
  - `class Generator`, creado con `subRng(seed: bigint, name: string)` o `new Generator(seed: bigint)`. Métodos:
    - `random(): number`, `randomArray(n): Float64Array`;
    - `uniform(lo, hi): number`, `uniformArray(lo, hi, n): Float64Array`;
    - `integers(lo: number, hi: number): number`, con Lemire de 32 bits y búfer de media palabra (ENGINE_PORT §2.3 y §2.4);
    - `choiceP(p: readonly number[]): number`;
    - `sign(): -1 | 1`;
    - `permutation(n): Int32Array`;
    - `sampleWithoutReplacement(pool: ArrayLike<number>, k: number): number[]`, con Floyd y la mezcla Lemire.

- [ ] **Step 1: Escribir los tests que fallan.** Leen `golden/v1/rng.json` y comprueban la igualdad exacta de:
  - `deriveSeed('token', 20261104, 1) === 8592738875135951460n`;
  - los `sub_seed32` del §2.7;
  - `new Generator(3529837714663881650n).random()` → `0.5961096316747411`, …;
  - cada secuencia intercalada de las 6 semillas, incluida la ≥ 2^63.

- [ ] **Step 2: Ejecutar y ver que fallan.** Run: `pnpm -C games/galaxy vitest run --project unit packages/engine/test/rng`. Expected: FAIL (no existe el módulo).

- [ ] **Step 3: Implementar.** SHA-256 con `@noble/hashes/sha2`. Estado de 128 bits como BigInt; la multiplicación se hace módulo `2n**128n`.

- [ ] **Step 4: Ver que pasan y hacer commit:** `feat(galaxy): semillas y PCG64 idénticos a numpy`.

---

### Task 4: Configuración ordenada y sorteo de rasgos

**Files:**
- Create: `packages/engine/scripts/gen-config.mjs`, `src/config/{generated,types}.ts`, `src/traits.ts`
- Test: `packages/engine/test/{config,traits}.test.ts`

**Interfaces:**
- Produces:
  - `TRAITS`, `PALETTES`, `VISUALS` y `RENDER`: estructuras inmutables generadas desde los YAML, con el orden en arrays o `Map`.
  - `type Traits = { galaxy_type: string; arms?: string; size: string; inclination?: string; core: string; star_density: string; palette: string; background: string; phenomenon: string }`, con las claves en orden de sorteo.
  - `drawTraits(rng: Generator, fixed?: Partial<Traits>): Traits`, con la semántica exacta del §3.1: una sola llamada a `choiceP` por rasgo sorteado, aunque haya un único candidato.
  - `dna(traits: Traits): string`, en hex minúsculas.
  - `violations(traits): string[]`.

- [ ] **Step 1: Escribir los tests que fallan.**
  - `config.test`: lo generado coincide con parsear los YAML en el test (`yaml` en orden) y pinta el orden de `galaxy_type` y `palette`.
  - `traits.test`: los 500 sorteos y DNA de `traits.json`, más los 30 con `fixed`, exactamente iguales. `{size: 'large'}` nunca da `dwarf`. `{palette: 'antimatter'}` da `background: 'deep_void'` sin consumir el número aleatorio del fondo, comprobado con la secuencia del generador.

- [ ] **Step 2: Ejecutar y ver que fallan, implementar y ver que pasan.**
  Run: `pnpm -C games/galaxy vitest run --project unit packages/engine/test/{config,traits}`
  Expected: primero FAIL y después PASS.

- [ ] **Step 3: Commit:** `feat(galaxy): configuración del motor y sorteo de rasgos idéntico al original`.

---

### Task 5: Color (OKLab, degradados y cuerpo negro)

**Files:**
- Create: `packages/engine/src/color.ts`
- Test: `packages/engine/test/color.test.ts`

**Interfaces:**
- Produces:
  - `loadPalette(key: string): Palette`, con estos miembros:
    - `sample(x: number): [number, number, number]` y `sampleCyclic(x)`, con LUT de 1024, `rint` half-even e índice como en `color.py`;
    - `inverted: boolean`, `background`, `accent`, `detail?` y `postfx`.
  - `blackbodyLinear(T: number): [number, number, number]`.
  - Utilidades `srgbToLinear`, `linearToSrgb` y `linearToOklab` / `oklabToLinear`, con `cbrt` como `Math.cbrt`.

- [ ] **Step 1: Escribir el test que falla.** Compara `colors.json`: muestras en float32 (`Math.fround`) iguales bit a bit, salvo un ulp de float32 donde intervenga `cbrt`. Si aparece esa tolerancia, se documenta en el test con su motivo.

- [ ] **Step 2: Ver que falla, implementar y ver que pasa.** Run: `… vitest run --project unit packages/engine/test/color`.

- [ ] **Step 3: Commit:** `feat(galaxy): paletas del motor en OKLab`.

---

### Task 6: Ruido, marco y geometrías de disco

**Files:**
- Create: `packages/engine/src/noise.ts`, `src/geometry/{common,spiral,elliptical,irregular,ring}.ts`, `src/fields.ts` (solo `buildParams` en esta tarea)
- Test: `packages/engine/test/{noise,params,geometry}.test.ts`

**Interfaces:**
- Produces:
  - Ruido (§5.4):
    - `valueNoise(x: Float64Array, y: Float64Array, seed: number): Float64Array`;
    - `fbm(x, y, seed, octaves=5, lacunarity=2.03, gain=0.5)`;
    - `warpedFbm(…)`;
    - `worley(x, y, seed, jitter=0.8): [F1, F2, F3]`;
    - `smoothstep`.
  - `makeFrame(u, v, cx, cy, size, angle, tilt, bulgeTiltFloor=0.65): Frame`.
  - `buildParams(traits, seed: bigint, center: [number, number]): GalaxyParams`, con el orden de llamadas del §2.5.
  - `spiral`, `barredSpiral`, `elliptical`, `lenticular`, `irregular`, `dwarf` y `ring` `(f, p, seed) → { d: Float64Array; young: Float64Array }`.

- [ ] **Step 1: Escribir los tests que fallan.**
  - `params.test`: `params.json`, igualdad exacta de cada número, en las tres LOD.
  - `noise.test`: vectores de `value_noise`/`fbm`/`worley` exportados en `params.json` (añadir al exportador si faltan: 32 puntos por función), con igualdad exacta (aritmética entera y polinómica sin transcendentes).
  - `geometry.test`: las muestras de campo de `cases/*.json` para un tipo de disco por caso (sin fenómeno) con error relativo ≤ 1e-12.

- [ ] **Step 2: Ver que fallan, implementar y ver que pasan.** Run: `… vitest run --project unit packages/engine/test/{noise,params,geometry}`.

- [ ] **Step 3: Commit:** `feat(galaxy): ruido, parámetros y geometrías de disco del motor`.

---

### Task 7: Fusión, campo de galaxia y fondos

**Files:**
- Create: `packages/engine/src/geometry/merger.ts`, `src/background.ts`
- Modify: `src/fields.ts` (`galaxyField`, `coreDensity`, `quasarSpikes`)
- Test: `packages/engine/test/fields.test.ts`

**Interfaces:**
- Produces:
  - `galaxyField(u, v, p, densityGain=1.55, dotStep, extra?): { t; young; theta; radius }`, con `Float64Array`.
  - `merger(u, v, p, seed)`, con la semilla de B en `noise_seed + 101` (§10.8) y las espigas del quásar centradas en `(cx, cy)` (§10.7).
  - `backgroundField(u, v, kind, spec, palette, seed32, rng): { t: Float32Array; color: Float32Array }`.

- [ ] **Step 1: Escribir los tests que fallan.** Muestras `gal.t` y `t_bg` de todos los casos sin fenómeno: `gal.t` con error relativo ≤ 1e-12; `t_bg` exacto en float32.

- [ ] **Step 2: Ver que fallan, implementar y ver que pasan.**

- [ ] **Step 3: Commit:** `feat(galaxy): fusiones, campo de galaxia y fondos del motor`.

---

### Task 8: Rejilla, tramado, estrellas, destellos y braille (sin fenómenos)

**Files:**
- Create: `packages/engine/src/{raster,stars,render}.ts`
- Test: `packages/engine/test/braille.test.ts`

**Interfaces:**
- Produces:
  - `class BrailleGrid(width: number, height: number, columns: number)`, con `cellW`, `cellH`, `rows`, `step`, `nx`, `ny`, `oy`, `dotUv(): { u; v }`, `uvStep` y `snap(u, v)` (§1.3).
  - `dither(t: Float64Array, jitter, minDensity, rng): Uint8Array`, con el Bayer 4×4 del §6.
  - `backgroundStars`, `galaxyStars` y `glintCenters` (§5.6), con el orden de consumo del §2.5.
  - `toText(on: Uint8Array, nx: number, ny: number): string`, con LF y sin salto final.
  - `renderBraille(traits: Traits, seed: bigint, opts: { columns: 192 | 96 | 48; width?: 2048; height?: 2048 }): BrailleRender`, donde `BrailleRender = { columns, rows, nx, ny, step, oy, width, height, on: Uint8Array; dotColor: Float32Array (nx*ny*3); dotRadius: Float32Array; text: string; palette: { key; inverted; background; accent }; postfx: PostfxConfig }`.
  - `renderFromSeed(seed: bigint, opts & { fixed?: Partial<Traits> })`, que sortea los rasgos con `subRng(seed, 'traits')` y renderiza.

- [ ] **Step 1: Escribir los tests que fallan.**
  - Braille exacto en 192, 96 y 48 columnas para todos los casos con `phenomenon: none`, comparando caracter a caracter. Al fallar, el mensaje dice la fila, la columna y cuántas celdas difieren.
  - `toText`: el vector del §6.
  - Antimatter (Review Focus 2) incluido.
  - En 48 columnas, todas las cruces de destellos quedan dentro de la rejilla y no hay excepciones (Review Focus 3).

- [ ] **Step 2: Ver que fallan, implementar y ver que pasan.** Run: `… vitest run --project unit packages/engine/test/braille`.

- [ ] **Step 3: Comprobar el rendimiento.** `renderBraille` en 192 columnas tarda menos de 400 ms en Node en este PC, medido con un bench de 10 renders y su mediana. Si no, se perfila antes de seguir y el resultado queda en el registro.

- [ ] **Step 4: Commit:** `feat(galaxy): braille del motor idéntico al original sin fenómenos`.

---

### Task 9: Los 8 fenómenos

**Files:**
- Create: `packages/engine/src/phenomena.ts`
- Modify: `src/render.ts`
- Test: `packages/engine/test/phenomena.test.ts`

**Interfaces:**
- Produces:
  - `galaxyMatter(kind, u, v, p, spec, rng, seed32)`;
  - `lightLayer(kind, u, v, p, palette, spec, rng, grid, seed32) → { t: Float32Array; color } | null`;
  - `glitch(on, color, radius, palette, spec, rng, dotRadius)`, que modifica en sitio con los recortes del §10.11.

- [ ] **Step 1: Escribir el test que falla.** Braille exacto en 192, 96 y 48 columnas para todos los casos con fenómeno, y `light.t` exacto en float32 en las muestras. Con Anomaly en 48 columnas no hay excepciones (Review Focus 3).

- [ ] **Step 2: Ver que falla, implementar y ver que pasa.**

- [ ] **Step 3: Pasar toda la suite del motor.** Run: `… vitest run --project unit packages/engine`. Expected: los ~26 casos coinciden carácter a carácter en las tres LOD.

- [ ] **Step 4: Commit:** `feat(galaxy): los 8 fenómenos del motor`.

---

### Task 10: Composición en WebGL2 (posprocesado)

**Files:**
- Create: `packages/engine/src/gpu/{compose,shaders}.ts`
- Modify: `games/galaxy/vitest.config.ts` (proyecto `browser`: Vitest browser mode con Playwright Chromium, `include: packages/engine/test/browser/**`), `.github/workflows/galaxy-ci.yml` (instalar Chromium antes de los tests)
- Test: `packages/engine/test/browser/compose.browser.test.ts`

**Interfaces:**
- Produces:
  - `composeWebGL(canvas: HTMLCanvasElement | OffscreenCanvas, render: BrailleRender, size: number): boolean`. Hace los pasos del §7:
    - disco de cobertura con rampa de 1 px y color del dot más cercano;
    - glow de tres escalas (6, 18 y 48 px, pesos 0,45 / 0,30 / 0,22) a resolución de dots y reescalado;
    - viñeta, desplazamiento de canales, scanlines, tonemap con rodilla 0,8 y sRGB.

    El modo antimatter es sustractivo. Devuelve `false` si no hay WebGL2.
  - `composeFallback(ctx2d, render, size)`: dots coloreados sin brillo, para cuando no hay WebGL2 (Review Focus 4).

- [ ] **Step 1: Escribir el test que falla.** En Chromium real, para los 8 casos con imagen:
  - componer a 2048 y reducir a 256 con `drawImage` de alta calidad;
  - frente a `images/<caso>.png`, el error absoluto medio por canal debe ser ≤ 6/255 y el percentil 99 ≤ 40/255. Los umbrales cubren los dos reescalados distintos y el float32 del shader; se ajustan solo con la medida delante y quedan en el registro;
  - forzar la pérdida de contexto (`WEBGL_lose_context`) hace que `composeWebGL` devuelva `false` sin lanzar.

- [ ] **Step 2: Ver que falla, implementar y ver que pasa.** Run: `pnpm -C games/galaxy vitest run --project browser`.

- [ ] **Step 3: Commit:** `feat(galaxy): posprocesado del motor en WebGL2`.

---

### Task 11: Worker, caché y cliente

**Files:**
- Create: `apps/web/src/galaxy/{worker.ts,client.ts,cache.ts}`
- Test: `apps/web/test/galaxy-cache.test.ts`, `packages/engine/test/browser/worker.browser.test.ts`

**Interfaces:**
- Produces:
  - **`worker.ts`:** recibe `{ id; seed: string (decimal); columns; fixed? }` y responde `{ id; render: BrailleRender }`, con los buffers transferibles.
  - **`client.ts`:**
    - `requestGalaxy(seed: bigint, columns: 192 | 96 | 48, fixed?): Promise<BrailleRender>`;
    - mantiene **un** Worker vivo y una cola;
    - descarta los trabajos cancelados con `AbortSignal`.
  - **`cache.ts`:**
    - `GalaxyCache` con `get(key)` y `put(key, render)`, en memoria LRU de 12 entradas y en IndexedDB (`galaxy-cache`, store `renders`);
    - clave `${ENGINE_VERSION}:${seed}:${columns}:${fixedKey}`;
    - si IndexedDB falla, funciona solo en memoria.

- [ ] **Step 1: Escribir los tests que fallan.**
  - **`galaxy-cache`** (jsdom, sin IndexedDB):
    - la LRU expulsa la entrada 13;
    - una versión distinta no reutiliza entradas;
    - sin IndexedDB no lanza (Review Focus 5).
  - **`worker.browser`:**
    - el Worker devuelve el mismo `text` que `renderBraille` en el hilo principal para dos casos;
    - un trabajo abortado no resuelve.

- [ ] **Step 2: Ver que fallan, implementar y ver que pasan.**

- [ ] **Step 3: Commit:** `feat(galaxy): el motor corre en un Worker con caché`.

---

### Task 12: Demo del nuevo fondo de acceso (aprobación del usuario)

**Files:**
- Create: `.superpowers/brainstorm/<sesión>/content/fondo-v1.html` (demo, no se versiona). Usa un bundle del motor construido con `vite build --lib` en el scratchpad.

**Interfaces:**
- Produces: una demo animada de alta fidelidad, con la misma composición que la pantalla de acceso aprobada: logo y panel a la izquierda, y el fondo detrás. Propuesta de partida, que se ajusta con ui-ux-pro-max:
  - **Fondo:** solo galaxias reales del motor sobre negro profundo, con un polvo tramado casi imperceptible y sin estación ni planeta.
  - **Secuencia:** cada galaxia se genera con una semilla nueva y se ve unos 14 s. Durante ~5 s se funde con la siguiente, que aparece con el escaneo braille: la línea de barrido que resuelve los puntos.
  - **Movimiento:** rotación rígida muy lenta y una deriva o zoom mínimos, para que no pierda la forma. El brillo respira suave.
  - **Composición:** la galaxia a la derecha del panel. Sus colores tiñen apenas la viñeta.
  - **Con `prefers-reduced-motion`:** una sola galaxia quieta.
- Se revisa con capturas de Playwright, con el `screen` real, a 1280×720, 1920×1080 y 3440×1440.

- [ ] **Step 1: Consultar ui-ux-pro-max** (movimiento, fondo y contraste del panel sobre el fondo nuevo) y construir la demo.
- [ ] **Step 2: Revisarla con capturas.**
- [ ] **Step 3: STOP. El usuario aprueba la demo.** Sus cambios se incorporan y se vuelve a enseñar. No se empieza la Tarea 13 sin la aprobación.
- [ ] **Step 4: Anotar en `DESIGN_SYSTEM.md` §8 el fondo aprobado** (cadencia, fundido, movimiento y modo reducido) y hacer commit: `docs(galaxy): fondo de acceso con galaxias del motor`.

---

### Task 13: Nuevo fondo de acceso

**Files:**
- Create: `apps/web/src/scene/{GalaxyBackdrop.tsx,backdrop-schedule.ts}`
- Delete: `apps/web/src/scene/{AuthBackdrop.tsx,scene.ts}`
- Modify: `apps/web/src/shell/AuthLayout.tsx`, `apps/web/src/routes/Inicio.tsx`, `apps/web/src/styles/app.css`, `apps/web/e2e/auth.spec.ts`
- Test: `apps/web/test/backdrop-schedule.test.ts`, el e2e

**Interfaces:**
- Produces:
  - **`backdrop-schedule.ts`:** `nextPhase(state, now): BackdropState`, una máquina pura. Fases `scanning → showing → fading`, con duraciones de la demo aprobada. Usa como mucho dos galaxias montadas a la vez. Con la pestaña oculta, el tiempo se congela.
  - **`GalaxyBackdrop`:**
    - dos capas `<canvas>` que se funden por opacidad;
    - galaxias pedidas a `requestGalaxy` con semillas de `crypto.getRandomValues` y `columns` 96, o 192 si `devicePixelRatio × ancho ≥ 2400`;
    - composición con `composeWebGL`, o `composeFallback` si no hay WebGL2;
    - **con `prefers-reduced-motion`:** una sola galaxia quieta.

- [ ] **Step 1: Escribir los tests que fallan.**
  - `backdrop-schedule`:
    - las transiciones y duraciones siguen la secuencia;
    - nunca hay más de dos galaxias vivas;
    - con la pestaña oculta no avanza;
    - con movimiento reducido se queda en `showing` (Review Focus 5).
  - e2e:
    - el fondo dibuja un canvas no vacío;
    - no hay violaciones de CSP;
    - con `reducedMotion: 'reduce'` hay un solo canvas;
    - sin WebGL2 (forzado con `--disable-webgl`) la página sigue funcionando (Review Focus 4).

- [ ] **Step 2: Ver que fallan, implementar y ver que pasan.**
  Run:
  ```
  pnpm -C games/galaxy test:unit
  pnpm -C games/galaxy/apps/web exec playwright test
  ```

- [ ] **Step 3: Revisar con capturas** a 1280×720, 1366×650 (pantalla 1366×768), 1920×1080 y 3440×1440, y comparar con la demo aprobada.

- [ ] **Step 4: Commit:** `feat(galaxy): fondo de acceso con galaxias del motor que se funden`.

---

### Task 14: Congelar v1, verificación completa y PR

**Files:**
- Modify: `games/galaxy/docs/ENGINE_PORT.md` (sección «Versionado»), `games/galaxy/docs/GDD.md` §18.3 (los LOD son renders independientes, como en Python)

- [ ] **Step 1: Escribir el test que falla y hacerlo pasar.** `version.test`, «el motor v1 está congelado»: si cambia el hash conjunto de todos los `braille` dorados, el test exige subir `ENGINE_VERSION`. Compara el SHA-256 de la concatenación con una constante.

- [ ] **Step 2: Verificación completa**, en la raíz de galaxy y en la del repo:
  - `typecheck`, `lint` y `test` (unit, web e integración);
  - el proyecto `browser`;
  - `supabase test db`;
  - el e2e;
  - `TZ=UTC pnpm test:unit` de la raíz;
  - `docker build` de la imagen.

  Se pegan las salidas en el PR.

- [ ] **Step 3: Revisión final, PR, CI, fusión y PRE.**
  - Revisión final de toda la rama con un revisor nuevo.
  - PR a `develop`. Se fusiona con el CI en verde.
  - Comprobar el despliegue de PRE: la build del juego tarda menos de 5 min y el fondo nuevo se ve en `https://pre.elclub.party/galaxy/entrar`.
