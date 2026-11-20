# Galaxy: botones de escaneo «Sobres» — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objetivo:** los botones de escanear ×1, ×5 y ×10 pasan al diseño «Sobres» que eligió el propietario, y el brillo del núcleo de la garantía deja de cortarse.

**Arquitectura:**
- Solo cambia la web: `ScannerScreen.tsx` (`PullButton`, `PullRow` y el bloque de pago del panel lateral) y `app.css`.
- Precios, lógica y servidor no se tocan.

**Tecnología:** React 19, CSS en `apps/web/src/styles/app.css`, Vitest (web y navegador).

**Spec:** `docs/superpowers/specs/2026-11-17-galaxy-botones-escaneo-design.md`

## Restricciones globales

- **Copia** en `apps/web/src/copy/es.ts`: sin punto final ni símbolos en los títulos, y ningún precio escrito a mano (lo dan `pullCost` y `bestValue`).
- **Nombres accesibles:** cada botón conserva el que hoy encuentran las pruebas y el tutorial, el `data-tour="pull10"` del ×10 con señales. El texto es `${copy.scanner.pull(n)}, ${coste}`, por ejemplo «Escanear 10, 10 señales».
- **Movimiento:** con `:root[data-motion='reduced']` nada se mueve (ni el brillo ni el abanico).
- **Desbordes:** ninguno a 1280, 1600, 1920 y 2560 (la prueba de navegador ya lo comprueba).

## Foco de la revisión

1. **Sin saldo para ninguna tirada** (0 señales): los tres botones apagados y la nota «Te falta 1 señal para la de 1». Es la tirada más pequeña que no llega.
2. **Saldo justo para ×5 y no para ×10** (8 señales): «Te faltan 2 señales para la de 10». Con todo pagable, no hay nota.
3. **Escáner de evento:**
   - las señales de evento salen con su icono en violeta y su número en la cabecera;
   - los botones de señales van en UV con labio violeta.
4. **Mientras se escanea** (`busy`): los botones se apagan, pero no sale la nota de lo que falta.
5. **«Mejor precio»** solo donde `bestValue` lo dice (hoy el ×10 con monedas, nunca con señales).

---

### Tarea 1: botones «Sobres» y cabecera única

**Archivos:**
- Modificar:
  - `apps/web/src/scanner/ScannerScreen.tsx`: `PullButton`, `PullRow` y el JSX de `.pull-row` del panel.
  - `apps/web/src/styles/app.css`: bloque `.pull-row`, `.pull-label` y `.pull-btn`.
  - `apps/web/src/copy/es.ts`: `scanner`.
- Pruebas:
  - `apps/web/test/scanner.test.tsx`;
  - `apps/web/test/scanner-event.test.tsx` (la línea 55 hoy busca `withEventSignals`);
  - `apps/web/test/browser/scanner.browser.test.ts`.

**Interfaces:**
- **Produce:**
  - `shortOf(costs: GachaView['costs'], pay: 'coins' | 'signal', have: number): { size: PullCount; missing: number } | null`, exportada desde `ScannerScreen.tsx`: la tirada más pequeña que no llega, o null.
  - Copia nueva: `copy.scanner.pullTitle = 'Escanear'` y `copy.scanner.shortFor = (missing: string, size: number) => \`${missing} para la de ${size}\``.
  - Se quitan `withSignals`, `withCoins`, `withEventSignals` y `pullWord` si nada más los usa.

- [ ] **Paso 1: las pruebas que fallan**, en `scanner.test.tsx`:
  - `'los botones de escaneo no repiten: «Escanear» una vez con lo que tienes, y en cada uno su dibujo, su número y su precio'`:
    - una sola vez `getAllByText(copy.scanner.pullTitle)` dentro de `.scanner-side`;
    - no existen `copy.scanner.withSignals` ni `copy.scanner.withCoins`;
    - cada `.pull-btn` tiene un `.pull-fan`, un `.pull-n` con «×1», «×5» o «×10» y un `.pull-price` con su número (`'1'`, `'5'`, `'10'`, `'100'`, `'475'`, `'900'`);
    - los nombres por rol siguen casando con `new RegExp(\`${copy.scanner.pull(10)}.*${copy.scanner.costSignals(10)}\`)`.
  - `'sin saldo para la de 10, la fila dice lo que falta para ella'`: con `wallet.signal = 8`, se ve `copy.scanner.shortFor(copy.scanner.missingSignals(2), 10)`.
  - `'sin saldo para ninguna, dice lo que falta para la de 1; con todo pagable, nada'`: con 0 señales se ve `shortFor(missingSignals(1), 1)`; con 10, ninguna nota.
  - Una prueba unitaria de `shortFor` con los casos 0, 8 y 10 → `{size: 1, missing: 1}`, `{size: 10, missing: 2}` y `null`.
  - En `scanner-event.test.tsx:55`, cambiar la aserción: la cabecera enseña `copy.hub.resource.eventSignal(4)` (el texto para el lector de pantalla junto al icono).
- [ ] **Paso 2:** `pnpm exec vitest run --project web apps/web/test/scanner.test.tsx apps/web/test/scanner-event.test.tsx` → FALLAN las nuevas.
- [ ] **Paso 3: implementar.**
  - **Cabecera:** `<div className="pull-head"><span className="pull-title">{pullTitle}</span><span className="pull-have">…</span></div>`. Lleva `Icon ticket` (en violeta si es de evento) con el número y su `sr-only` `copy.hub.resource.signal(n)` o `eventSignal(n)`, y `Icon coin` con las monedas y su `sr-only`.
  - **`PullButton`:**
    - `aria-label={\`${copy.scanner.pull(count)}, ${cost}\`}`;
    - un `<span className="pull-fan" data-count={count} aria-hidden="true">` con 1, 5 o 5 elementos `<i>` (×10 = mazo con `--k`, del −2 al 2);
    - `<span className="pull-n">×{count}</span>`;
    - `<span className="pull-price"><Icon name={pay === 'signal' ? 'ticket' : 'coin'} />{número}</span>`;
    - la cinta `pull-best` como hoy y un `<span className="pull-shine" aria-hidden="true">`.
  - **`PullRow`:** recibe `pay`, pinta los tres botones y, si `!busy && shortOf(...)`, debajo un `<p className="pull-short">`.
  - **Clases de color:** `solar` para señales, `pull-event` para señales de evento y `pull-coins` para monedas.
- [ ] **Paso 4: CSS**, con las medidas de la maqueta `botones-escaneo-v2.html`:
  - `.pull-btn`: rejilla centrada, `gap 7px`, `min-block-size 124px`.
  - `.pull-fan i`: cartas de 26×38 px, radio 5 px y borde de 2 px.
    - El abanico de 5 gira −24, −12, 0, 12 y 24°, y al pasar el ratón −34, −17, 0, 17 y 34°.
    - El mazo se desplaza `--k × 2,4 px` (3,4 px al pasar el ratón).
    - Colores de las cartas por clase del botón: Solar crema y naranja, UV lavanda, monedas índigo.
  - `.pull-n`: Bungee de 22 px.
  - `.pull-price`: pastilla `border-radius: 99px`, fondo `rgb(0 0 0 / .2)` (`.3` en monedas y evento), 13,5 px, peso 700.
  - `.pull-coins`: `--lip-c: #0d1036` (labio azul oscuro), fondo `linear-gradient(160deg, #3b3f86, #2a2d66 55%, #20234f)`, color `#fff3cf`.
  - Brillo:
    - `.pull-shine::after` cada 4,2 s, desfasado 0,5 y 1 s por posición;
    - parado con movimiento reducido, igual que las transiciones del abanico.
  - Se borran `.pull-label`, `.pull-word` y `.pull-cost`.
- [ ] **Paso 5:** `pnpm exec vitest run --project web apps/web/test/scanner.test.tsx apps/web/test/scanner-event.test.tsx apps/web/test/scanner-pro.test.tsx apps/web/test/tour.test.tsx` → todas PASAN.
- [ ] **Paso 6:** `VITE_SCANNER_SHOTS=1 pnpm exec vitest run --project browser apps/web/test/browser/scanner.browser.test.ts` → 8 de 8. Mirar las capturas de 1280 y 1920 de los dos escáneres.
- [ ] **Paso 7:** commit.

### Tarea 2: el brillo del núcleo de la garantía no se corta

**Archivos:**
- Modificar: `apps/web/src/styles/app.css` (`.pity-core svg`).
- Prueba: `apps/web/test/browser/scanner.browser.test.ts`.

- [ ] **Paso 1:** en la prueba de navegador del escáner, `getComputedStyle(document.querySelector('.pity-core svg')!).overflow` es `'visible'`.
- [ ] **Paso 2:** comprobar que falla, porque hoy es `'hidden'`, el valor por defecto de un SVG.
- [ ] **Paso 3:** `.pity-core svg { overflow: visible; }`.
- [ ] **Paso 4:** pasa. Captura de cerca del núcleo con `.pity[data-hot]`.
- [ ] **Paso 5:** commit, con la nota de versión «Botones de escaneo más claros» en la 1.41 y DESIGN_SYSTEM §8 bis (botones) al día.
