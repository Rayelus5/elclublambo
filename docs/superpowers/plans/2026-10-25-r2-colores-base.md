# R2 — Colores de Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sustituir el cian de Linea (#61DFFF) por la paleta de Base: Base Blue #0000FF como relleno de marca (botones principales con texto blanco, estados activos) y Cerulean #3C8AFF para texto, enlaces, foco y el cuadrado del logotipo; fondos y grises de Base; todo AA.

**Architecture:** Cambio de tokens en `src/app/globals.css` (y su espejo `src/styles/tokens.ts`, usado por las imágenes OG, el badge y el test de contraste). `--accent` pasa a Cerulean (todo el texto/borde/anillo de acento se actualiza solo). Nuevos tokens `--accent-fill` (#0000FF) y `--accent-fill-fg` (#FFFFFF); `--primary`/`--primary-foreground` (botón por defecto de shadcn) apuntan a ellos. Se auditan uno a uno los ~50 usos de `bg-accent` para decidir relleno de marca (Base Blue + blanco) o acento (Cerulean + texto oscuro).

**Tech Stack:** Tailwind v4 (`@theme inline`), CSS custom properties, Vitest (contraste), Playwright (capturas).

**Spec:** decisión del usuario 2026-10-25 (memoria `multichain-public-decisions`), guía de marca de Base (https://brand.base.org/color; activos locales en `C:\Users\rayel\Downloads\_base-brand\1_Base Brand Assets`).

## Global Constraints
- Paleta exacta (pantalla): Base Blue `#0000FF`; Cerulean `#3C8AFF`; Gray 100 `#0A0B0D`, Gray 80 `#32353D`, Gray 60 `#5B616E`, Gray 50 `#717886`, Gray 30 `#B1B7C3`, Gray 15 `#DEE1E7`, Gray 10 `#EEF0F3`, blanco `#FFFFFF`; secundarios: Green `#66C800`, Yellow `#FFD12F`, Red `#FC401F`, Pink `#FEA8CD`, Tan `#B8A581`, Lime `#B6F569`.
- **Nunca** Base Blue como texto, borde o anillo sobre fondo oscuro (2,3:1). Base Blue solo como relleno con texto blanco (8,6:1).
- **El cuadrado del logotipo «ElClub■» nunca en Base Blue** (es el símbolo de Base, «The Square»): Cerulean. Tampoco se usa el logo, el basemark ni «The Square» de Base como marca propia.
- AA: texto ≥ 4,5:1; componentes de UI y anillos de foco ≥ 3:1 sobre su fondo. Lo comprueba `tests/unit/tokens.test.ts`.
- Solo tokens en componentes (sin hex); las imágenes OG y el badge usan `src/styles/tokens.ts`.
- Sin degradados ni transparencias decorativas nuevas (guía de Base).

## Review Focus
1. **Un botón principal** (Crear sorteo, Pagar, Firmar y entrar): fondo Base Blue, texto blanco, foco visible en Cerulean. Test en Task 2.
2. **Enlaces y texto de acento** sobre `bg`, `surface` y `surface-2`: Cerulean ≥ 4,5:1. Test en Task 1.
3. **El logotipo** en la cabecera pública, el foro, `/start` (cuadrado que crece) y las OG: cuadrado Cerulean, nunca #0000FF. Test en Task 2.
4. **Texto atenuado** (`fg-muted`) sobre todas las superficies ≥ 4,5:1. Test en Task 1.

## Decisiones del constructor (rulings; coste si es incorrecta)
- **R2-R1 Superficies:** `--bg #0A0B0D` (Gray 100); `--surface #121418` y `--surface-2 #1A1D22` (escalones oscuros neutros-fríos entre Gray 100 y Gray 80; la guía de Base no define superficies de producto); `--border #24272D`; `--border-strong #32353D` (Gray 80). (Bajo.)
- **R2-R2 Texto:** `--fg #EEF0F3` (Gray 10); `--fg-muted #B1B7C3` (Gray 30; Gray 50 no llega a 4,5:1 sobre negro). (Bajo.)
- **R2-R3 Estados:** `--success #66C800`, `--warning #FFD12F`, `--danger #FC401F` (secundarios de Base, todos ≥ 4,5:1 sobre negro). (Bajo.)
- **R2-R4 Gráficas:** `--chart-1 #3C8AFF`, `--chart-2 #66C800`, `--chart-3 #FFD12F`, `--chart-4 #FEA8CD`, `--chart-5 #B8A581`, `--chart-rest #5B616E`. (Bajo.)
- **R2-R5 AppKit (modal de wallets):** acento Cerulean, igual que el foco. (Bajo.)
- **R2-R6 Barras de desplazamiento y detalles de 1–2 px** en acento: Cerulean. (Bajo.)

---

### Task 1: Tokens

**Files:** Modify `src/app/globals.css` (valores R2-R1…R4, nuevos `--accent-fill`, `--accent-fill-fg`, `--color-accent-fill`, `--color-accent-fill-fg` en `@theme inline`; `--primary: var(--accent-fill)`, `--primary-foreground: var(--accent-fill-fg)`; `--accent-foreground` = `--bg`; `--ring: var(--accent)`), `src/styles/tokens.ts` (mismos valores + `accentFill`, `accentFillFg`), `tests/unit/tokens.test.ts`, `src/lib/web3/appkit.ts` (R2-R5), `tests/unit/brand.test.ts` si fija colores.

- [ ] **Step 1: Failing test** — `tokens.test.ts`: los valores exactos de la paleta; contraste ≥ 4,5 para `fg`, `fgMuted` y `accent` sobre `bg`, `surface` y `surface-2`; ≥ 4,5 para `accentFillFg` sobre `accentFill`; ≥ 4,5 para `bg` sobre `accent` (texto oscuro sobre Cerulean); ≥ 3 para `accent` (anillo) sobre `bg`/`surface`; ≥ 4,5 para `success`, `warning`, `danger` sobre `bg`; y que `accent` ≠ `#0000FF` (Review Focus 2 y 4).
- [ ] **Step 2–4:** FAIL → Implement → PASS (`pnpm vitest run tests/unit/tokens.test.ts tests/unit/brand.test.ts`, `pnpm typecheck`).
- [ ] **Step 5: Commit** — `feat(ui): paleta de Base en los tokens`

---

### Task 2: Rellenos de marca y logotipo

**Files:** Modify every `bg-accent` / `text-accent-foreground` / `bg-primary` usage in `src/components/**` and `src/app/**` (clasificar: CTA y estado activo de marca → `bg-accent-fill text-accent-fill-fg`; marcadores pequeños, puntos, barras de progreso, el cuadrado del logotipo y el cuadrado gigante del hero de `/start` → Cerulean `bg-accent`), `src/components/ui/button.tsx` (variante por defecto ya vía `--primary`; comprobar foco), imágenes OG (`src/app/(public)/[lang]/**/opengraph-image.tsx`) y badge (`pay/[target]/badge/route.ts`) con `tokens.accent` para el cuadrado y `tokens.accentFill` donde haya un botón dibujado.
- Test: `tests/unit/ui/brand-fill.test.tsx` (nuevo): el `Button` por defecto renderiza clases de relleno de marca (`bg-primary`/`bg-accent-fill`) con texto blanco; el wordmark (cabecera pública, foro, hero de `/start`) usa `bg-accent` y nunca `bg-accent-fill` (**Review Focus 1 y 3**); test de fuente: ningún fichero de `src` contiene `#0000FF`/`#0000ff` fuera de `globals.css` y `styles/tokens.ts`; las OG/badge usan `tokens.accent` para el cuadrado.

- [ ] **Step 1: `ui-ux-pro-max`** (estados activos, jerarquía: un solo CTA de marca por pantalla).
- [ ] **Step 2: Failing tests.** **Step 3: Implement** la clasificación (lista en el informe: fichero → decisión). **Step 4:** `pnpm lint`, `typecheck`, `test:unit` PASS.
- [ ] **Step 5: Commit** — `feat(ui): Base Blue en los rellenos de marca y Cerulean en el logotipo`

---

### Task 3: Verificación visual, e2e y docs

**Files:** Modify `docs/superpowers/specs/2026-10-24-base-arbitrum-y-parte-publica-design.md` (R2 «Hecho» + rulings) y cualquier e2e que compruebe colores computados (grep `61dfff`/`rgb(97, 223, 255)`).

- [ ] **Step 1:** Capturas con Playwright (script temporal en el scratchpad, no en el repo) a 375 y 1440 px de `/`, `/start`, `/herramientas/sorteos/nuevo`, `/herramientas/comprobador`, `/pay/<dirección>`, `/foro` (miembro) y `/foro/login`; revisarlas y corregir lo que se vea mal (contraste, cuadrado en Base Blue, botón sin relleno).
- [ ] **Step 2: Verificación completa** — `pnpm lint`, `typecheck`, `test`, `test:e2e`, `E2E_PROD=1 pnpm test:e2e`, `SUPABASE_SERVICE_ROLE_KEY= CRON_SECRET= pnpm build` (`db:test` no cambia: no hay migraciones).
- [ ] **Step 3: Commit** — `test(ui): colores de Base verificados; docs R2`
