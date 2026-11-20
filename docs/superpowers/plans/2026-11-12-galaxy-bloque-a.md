# Galaxy: bloque A (arreglos rápidos). Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objetivo:**
- Que los resultados digan lo que de verdad se cobra.
- Que se pueda escanear otra vez sin salir del escáner.
- Que las partidas en grupo se entiendan: descripciones en las cartas, daño solo para quien lo recibe, flechas hacia los compañeros y amigos desde la sala.

**Arquitectura:** solo toca `apps/web`. La simulación, el servidor y la configuración no cambian. Son 3 PR seguidos a `develop`:
- A1: tareas 1–3;
- A2: tareas 4–6;
- A3: tarea 7.

**Tecnología:** React 19, TanStack Query, PixiJS 8 (`stage.ts`), Vitest en los proyectos web (jsdom) y browser (Chromium).

**Especificación:** `docs/superpowers/specs/2026-11-12-galaxy-mejoras-noviembre-design.md` §4.

## Restricciones globales

- **Textos:** van en `apps/web/src/copy/es.ts`, en español y con «tú». Ningún valor que el admin pueda cambiar se escribe a mano: lo manda el servidor.
- **CSP:** `style-src 'self'`. Se permite la prop `style` de React. No se permiten `<style>` ni `style=""`.
- **Capturas a 1280, 1600, 1920 y 2560.** Nada crece de lado. Con movimiento reducido, nada late ni parpadea.
- **Tests en local:** `pnpm -C games/galaxy exec vitest run --project web <archivos>` y `--project browser <archivos>`. Además, `pnpm -C games/galaxy typecheck` y `lint`.

## Qué revisar con más cuidado

1. **«¡Escanear otra!» durante la petición:**
   - un doble clic no lanza dos escaneos: el botón se apaga mientras está `isPending`;
   - si la petición falla, el error se ve dentro del modal y se puede reintentar.
2. **«¡Escanear otra!» tras el escaneo gratis del día:** nunca vuelve a pedir `pay: 'free'`. El servidor respondería 409 `free_pull_used`.
3. **Indicadores de compañeros:**
   - un compañero fuera de la partida o que se ha ido no tiene flecha;
   - en solitario no se dibuja ninguna;
   - cuando hay varias flechas en el mismo borde no se tapan del todo: el nombre va dentro de la pantalla.
4. **El destello de daño al mirar a otro:** si estás caído y la cámara sigue a un compañero, su daño no hace temblar ni destellar tu pantalla.
5. **«Añadir amigo» contigo mismo:** tu propia tarjeta nunca tiene botón. Con la función de amigos apagada, el error se muestra con su texto.

---

### Task 1: textos de resultados (A1)

**Archivos:**
- Modificar: `apps/web/src/copy/es.ts` (`results.half` en `:2419`, `social.shards` en `:1439`)
- Modificar: `apps/web/src/hangar/ResultsScreen.tsx:94-98` y `:124`
- Test: `apps/web/test/results.test.tsx` (si no existe, el test de la pantalla de resultados que ya pinta `breakdown`)

**Interfaces que produce:**
- `copy.results.share(pct: number, extracted: boolean): string`, que sustituye a `half`.
- `copy.social.shards(n: number): string` pasa a ser `+${fmt(n)}`.
- `copy.social.shardsLabel(n: number, currency: string): string`, para lectores de pantalla.

- [ ] **Test:**
  - con `outcome: 'died'` y `share: 0.35` aparece «Sin extracción te llevas el 35 % del botín»;
  - con `outcome: 'extracted'` y `share: 0.5`, «Cobras el 50 % del botín»;
  - con `share: 1` no aparece la nota;
  - con `progress.shards: 5` el texto visible es «+5», con el icono `shard` justo detrás (`.results-points` contiene `+5` y luego `svg`), y el texto oculto lleva el nombre de la moneda de temporada.
- [ ] **Comprobar que falla.**
- [ ] **Implementar:**
  - el porcentaje sale de `Math.round(share * 100)`;
  - el nombre de la moneda viene en la vista de resultados o de temporada. Si la vista no lo trae, se usa `copy.season.currencyFallback`. **Decisión mía:** antes de inventar el campo, mira si `RunResult.progress` ya lo trae; si no, el texto oculto es «de moneda de temporada».
- [ ] **Comprobar que pasa.** Commit: `fix(galaxy): los resultados dicen lo que se cobra sin extraer y las esquirlas con su icono`.

### Task 2: «¡Escanear otra!» y «Colección» (A1)

**Archivos:**
- Crear: `apps/web/src/scanner/again.ts`
- Modificar: `apps/web/src/scanner/ScannerScreen.tsx`
- Modificar: `apps/web/src/scanner/RevealStage.tsx` (prop nueva `status`)
- Modificar: `apps/web/src/copy/es.ts` (`scanner`)
- Modificar: `apps/web/src/styles/app.css` (`.pill-uv`, junto a `.pill-solar` en `:225`)
- Test: `apps/web/test/scanner-again.test.ts` y `apps/web/test/scanner.test.tsx`

**Interfaces que produce:**
```ts
export type Again = { count: 1 | 10; pay: 'signal' | 'coins'; cost: number; currency: 'coins' | 'signal'; missing: number };
export function againPlan(count: 1 | 10, lastPay: 'free' | 'signal' | 'coins', costs: { coins: number; coinsTen: number; signals: number }, signals: number, coins: number): Again;
```
- `lastPay` `'coins'` → monedas. `'signal'` → señales.
- `'free'` → señales si te llegan; si no, monedas si te llegan; si no te llega ninguna, señales con lo que falta.
- `missing` es `max(0, coste − saldo)`.
- `RevealStage` recibe `status?: ReactNode`, que pinta en el resumen encima de `.summary-actions`.

**Textos:**
- `copy.scanner.again(count)`: «¡Escanear otra!» o «¡Escanear otras 10!».
- `copy.scanner.toCollection = 'Colección'`.
- `copy.scanner.missingCoins(n)`: «Te faltan N monedas».
- `copy.scanner.missingSignals(n)`: «Te falta 1 señal» o «Te faltan N señales».
- Se quita `scanner.again: 'Escanear otra vez'`, que no se usa.

- [ ] **Tests de `againPlan`:**
  - `('free', costes {100, 900, 1}, señales 0, monedas 150)` → `{pay: 'coins', cost: 100, missing: 0}`;
  - `('free', …, señales 3, monedas 0)` → `{pay: 'signal', cost: 1}`;
  - `('free', …, 0, 0)` → `{pay: 'signal', missing: 1}`;
  - `(10, 'coins', …, monedas 500)` → `{cost: 900, missing: 400}`.
- [ ] **Tests de `scanner.test.tsx`:**
  - tras escanear 1 con señales y llegar al resumen, existen el botón «¡Escanear otra!» (accesible por nombre, con el coste «1 señal») y el enlace «Colección» con clase `pill-uv`;
  - al pulsar «¡Escanear otra!» se envía `POST /gacha/pull` con `{count: 1, pay: 'signal'}` y una `Idempotency-Key` distinta de la anterior, y vuelve a empezar la revelación (aparece «Saltar»);
  - sin saldo, el botón está apagado y se ve «Te faltan 100 monedas»;
  - tras el gratis no se envía `pay: 'free'`;
  - si el servidor responde con error, se ve dentro del diálogo (`role="alert"`) y el botón se puede volver a pulsar;
  - tras escanear 10 se ve «¡Escanear otras 10!».
- [ ] **Comprobar que fallan.**
- [ ] **Implementar:**
  - `ScannerScreen` guarda `last = { count, pay }` al llamar a `scan`;
  - `RevealStage` lleva `key={revealed[0].id}`, para que un escaneo nuevo lo vuelva a montar;
  - mientras dura la petición, el botón se apaga con `busy`;
  - el error va en `status`.
  - `emitTour('scanner:pulled')` se mantiene.
- [ ] **Estilo:** `.pill-uv`, con degradado de `--color-uv` a `--color-uv-2`, texto `--color-ink` y `--lip-c: var(--color-uv-lip)`. «¡Escanear otra!» es el botón principal: `pill-solar`, con su coste en un `<small>`.
- [ ] **Comprobar que pasan.** Commit: `feat(galaxy): escanear otra desde el resumen y Colección en violeta`.

### Task 3: descripciones en las cartas de grupo (A1)

**Archivos:**
- Modificar: `apps/web/src/coop/CoopHud.tsx:50-65`
- Modificar: `apps/web/src/styles/app.css` (`.coop-card*`, `:2667-2671`)
- Test: `apps/web/test/coop-arena.test.tsx:131`
- Test: `apps/web/test/browser/coop-cards.browser.test.ts` (nuevo, con captura bajo `VITE_COOP_SHOTS`)

- [ ] **Test web:** al salir las cartas, cada una contiene el texto de `describeOffer(content, o).text`. Por ejemplo, la descripción de la primera arma de la oferta del fixture.
- [ ] **Test de navegador:**
  - con una oferta de 3 cartas montada en `CoopCards`, ninguna carta se desborda (`scrollWidth <= clientWidth`) a 1280 y a 1920 de ancho;
  - la tira no supera el 34 % del alto de la ventana.
- [ ] **Implementar:**
  - `<span className="coop-card-desc">{d.text}</span>` dentro de `.coop-card-text`;
  - el texto se corta a 3 líneas con `-webkit-line-clamp`;
  - icono de 48 px (`spriteDataUrl(d.icon, 4)`);
  - clase `fresh` igual que en `LevelUp` (`LevelUp.tsx:103`);
  - la carta se alinea arriba.
- [ ] **Comprobar que pasan y revisar las capturas.** Commit: `feat(galaxy): las cartas de mejora en grupo explican lo que hacen`.
- [ ] **PR A1.** Incluye la especificación y este plan. Al terminar: CI, fusión, despliegue en PRE y salud.

### Task 4: función de borde de pantalla (A2)

**Archivos:**
- Crear: `apps/web/src/arena/stage/edge.ts`
- Modificar: `apps/web/src/arena/hud/Overlays.tsx:22-54` (`BeaconMarker`)
- Modificar: `apps/web/src/coop/Marks.tsx:57-98`
- Test: `apps/web/test/edge.test.ts`

**Interfaces que produce:**
```ts
export type Field = { width: number; height: number; bars: number };
export type EdgePoint = { x: number; y: number; angle: number; inside: boolean };
/** dx/dy: distancia en píxeles de pantalla desde el centro del campo. */
export function edgePoint(field: Field, dx: number, dy: number, pad: number): EdgePoint;
```
- El centro es `cx = bars + (width − 2·bars)/2` y `cy = height/2`.
- Dentro de la pantalla: `inside: true` y el punto tal cual.
- Fuera: `k = min((campoW/2 − pad)/|cos|, (h/2 − pad)/|sin|)`. Es la cuenta que ya hacen los dos componentes, extraída aquí.

- [ ] **Tests:**
  - un punto dentro devuelve `inside: true`;
  - uno a la derecha, fuera, queda en `x = width − bars − pad` con `angle ≈ 0`;
  - uno arriba a la izquierda queda pegado al borde más cercano;
  - con `bars > 0`, el punto nunca entra en las bandas.
- [ ] **Implementar.** `BeaconMarker` y `CoopMarks` usan `edgePoint`. Sus tests (`coop-arena.test.tsx:175`) siguen pasando.
- [ ] **Arreglar la baliza:** en `CoopArena.tsx:383`, `hudSnapshot(sim, slot)` mide la baliza desde la sonda que sigue la cámara cuando miras a otro. Se pasa el índice que sigue la cámara.
- [ ] Commit: `refactor(galaxy): una sola cuenta para pegar marcas al borde de la pantalla`.

### Task 5: el daño y los sonidos personales, solo para ti (A2)

**Archivos:**
- Modificar: `apps/web/src/arena/stage/stage.ts`
  - `StageOptions` (`:16-30`): nuevo `me?: number`. Por defecto vale `probe`.
  - `case 'hurt'` (`:825`).
  - `evolve` (`:858-861`).
  - Parpadeo de un compañero en `drawProbes` (`:647-710`).
- Modificar: `apps/web/src/arena/arena-sfx.ts:61`: `playEvents(events, me = 0)`.
- Modificar: `apps/web/src/arena/ArenaScreen.tsx:158`, `apps/web/src/coop/CoopArena.tsx:313-315` y `:357` (opciones del stage con `me: slot`).
- Crear: `apps/web/src/arena/personal.ts`, con `isPersonal(e: SimEvent, me: number): boolean`.
- Test: `apps/web/test/personal.test.ts` y `apps/web/test/coop-arena.test.tsx`.

**Interfaces que produce:**
- `isPersonal(e, me)` es `false` solo para `hurt`, `levelUp`, `pickup` y `dash` cuyo `probe !== me`. Los demás eventos son de todos.

- [ ] **Tests:**
  - `isPersonal({t: 'hurt', probe: 1, amount: 3}, 0) === false`;
  - con `probe 0` y `me 0`, `true`;
  - `{t: 'bossDown'}` → `true`;
  - en `coop-arena.test.tsx`, `playEvents` se llama con el `slot` del jugador.
- [ ] **Implementar:**
  - `playEvents` descarta los eventos que no son tuyos;
  - en `stage.ts`, el destello y el temblor de `hurt` solo saltan si `e.probe === opts.me`;
  - si el `hurt` es de otra sonda, se guarda `blink[e.probe] = 0.18` s y `drawProbes` la tiñe de `0xff5a6e` mientras dure (sin parpadeo con `reduced`);
  - el anillo de `evolve` se dibuja en la posición de `sim.probes[e.probe]`.
- [ ] **Comprobar** con `pnpm … --project web test/personal.test.ts test/coop-arena.test.tsx test/arena.test.tsx`. Commit: `fix(galaxy): en grupo, el daño y los sonidos de cada uno son solo suyos`.

### Task 6: flechas hacia los compañeros (A2)

**Archivos:**
- Modificar: `apps/web/src/arena/stage/stage.ts`
  - una capa `Graphics` nueva, `mates`, en el espacio de la pantalla, junto a `numbers` (`:204-207`);
  - etiquetas `BitmapText` reutilizadas;
  - se rellena en el bucle de `tagAt` (`:767-786`).
- Crear: `apps/web/src/arena/stage/mates.ts`, con `mateMarkers(sim, cam, field, me): MateMarker[]`. Es puro y se puede testear.
- Test: `apps/web/test/mates.test.ts` y `apps/web/test/browser/arena.browser.test.ts` (captura de grupo con un compañero lejos).

**Interfaces que produce:**
```ts
export type MateMarker = { index: number; x: number; y: number; angle: number; hp: number; state: 'ok' | 'down' | 'away' };
export function mateMarkers(probes: readonly { x: number; y: number; hp: number; maxHp: number; alive: boolean; downT: number; life: string }[], camera: { x: number; y: number; zoom: number }, field: Field, me: number): MateMarker[];
```
- Solo se incluyen los compañeros (`index !== me`) que están fuera de la pantalla. Los que están `out` o `left` no se incluyen.
- `hp` es de 0 a 1. El estado es `down` si está caído y `away` si está desconectado.
- Los valores exactos de `life`/`alive` se leen de `packages/sim/src/snapshot.ts:34,77` y del tipo de sonda.

- [ ] **Tests:**
  - en solitario, una lista vacía;
  - un compañero a 2000 u a la derecha da un marcador en el borde derecho con `angle ≈ 0`;
  - uno dentro de la pantalla no da marcador;
  - uno caído da `state: 'down'`;
  - uno que se ha ido no aparece.
- [ ] **Implementar el dibujo:**
  - triángulo de 14 px del color del equipo (`TEAM_TINT[index]`), con un borde oscuro, girado `angle` y separado 26 px del borde;
  - el nombre en `BitmapText`, del color del equipo, hacia dentro de la pantalla;
  - debajo, una barrita de vida de 34×4.
  - `down`: el alfa del triángulo late (`0.55 + 0.45·sin(t·10)`) y se tiñe de `0xff4d6d`. Con `reduced`, rojo fijo.
  - `away`: alfa 0,4.
- [ ] **Comprobar:** tests y captura en el navegador. Commit: `feat(galaxy): flechas con nombre y vida hacia los compañeros fuera de pantalla`.
- [ ] **PR A2.** CI, fusión, despliegue y salud.

### Task 7: «Añadir amigo» en la sala y en los resultados (A3)

**Archivos:**
- Crear: `apps/web/src/social/relation.ts`, con `relationOf(view: FriendsView | undefined, username: string): 'none' | 'friends' | 'incoming' | 'outgoing' | 'blocked'`.
- Crear: `apps/web/src/social/AddFriendButton.tsx`, un botón pequeño según la relación. Usa `useFriendAction()` y muestra el error con `errorText`.
- Modificar: `apps/web/src/hangar/lobby/Stage.tsx` (`Mate`, `:119-161`). El botón va para todos menos para ti, fuera del bloque que solo ve el líder.
- Modificar: `apps/web/src/coop/TeamResults.tsx:69-101`
- Modificar: `apps/web/src/styles/app.css:2886-2900`
- Test: `apps/web/test/relation.test.ts`, `apps/web/test/rooms.test.tsx` y `apps/web/test/team-results.test.tsx` (o el de resultados de grupo que ya exista)

**Textos:** se reutilizan `copy.friends.profile.add`, `sent` y `accept`.

- [ ] **Tests:**
  - `relationOf` con un usuario en `friends`, `incoming`, `outgoing` o `blocked`, y sin relación;
  - las mayúsculas no importan.
  - En la sala, un miembro sin relación muestra «Añadir amigo», y al pulsarlo se hace `POST /friends/requests {username}`;
  - uno en `outgoing` muestra «Solicitud enviada», apagado;
  - en tu propia tarjeta no hay botón.
- [ ] **Implementar.** La caché de `['friends']` la refresca `useFriendAction` y la tarjeta cambia sola. El botón no rompe la tarjeta de 180 px: se revisa con la captura de la sala (`menu.browser` o la de rooms).
- [ ] Commit: `feat(galaxy): añadir amigos desde la sala y desde los resultados en grupo`.
- [ ] **PR A3.** CI, fusión, despliegue y salud.
