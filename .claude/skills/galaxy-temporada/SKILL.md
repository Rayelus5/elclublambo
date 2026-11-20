---
name: galaxy-temporada
description: Preparar una temporada nueva de Galaxy Survivor y dejarla lista para publicar en PRE. Cubre fechas y nombre, puntos y tramos, anomalía y acabado exclusivo, ruta de recompensas y tienda con su moneda, premios de cierre y podio, misiones y logros de temporada, el sector de temporada y el cierre de la anterior. Úsala cuando pidan «nueva temporada», «temporada 2», «siguiente temporada», «ruta de temporada», «tienda de temporada», «misiones de temporada», «logros nuevos» o «cambiar la anomalía», o new season, season pass.
---

# Temporada nueva

Una temporada es configuración viva, no código: las claves `season`, `seasonRoute`, `missions` y `achievements`, a veces con `content` (una anomalía nueva) o `sectors` (el sector de temporada). Se prepara en una carpeta de `ops/launch/`, la valida un test y se publica en PRE con `galaxy-publicar-config`, tras el OK del propietario.

Antes de empezar, lee:
- `games/galaxy/AGENTS.md`;
- la parte B de `games/galaxy/docs/CONTENIDO.md`, sobre todo B4 (ids), B5 (fechas) y B8 (temporada);
- en el GDD, §13.1 y §13.1 bis.

## 1. Lee lo que está vivo (solo lectura)

Con el acceso SSH a PRE de `docs/DEPLOY_PRE.md` (`<PRE>`; comandos para Git Bash), guarda en una carpeta temporal **fuera del repositorio**:
```
ssh <PRE> "docker exec elclub-pre-galaxy-1 node dist/cli.js show-config season --data" > <tmp>/season.vivo.json
```
Haz lo mismo con `seasonRoute`, `missions`, `achievements`, `events` y `content` (para ver qué anomalías hay en `content.anomalies`).

Si no puedes llegar a PRE o `show-config` todavía no existe allí (la CLI responde «Comando desconocido»), pide al propietario que exporte las claves desde el panel (`/admin/configuracion/<clave>`). No uses `psql` con contraseñas ni partas de los valores del código.

## 2. Pregunta al propietario

Con AskUserQuestion (o preguntando con opciones, si no eres Claude), en una o dos tandas:
- **Nombre** y número. El id es `season-<n>`, nuevo y nunca reutilizado.
- **Fechas:** normalmente empieza cuando acaba la anterior y dura 4 semanas. Siempre a las 00:00 de Madrid: `23:00Z` en invierno, `22:00Z` en verano.
- **Anomalía:** una de las que hay en `content.anomalies`, o una nueva. Una nueva va antes con la skill `galaxy-enemigos-sectores-sondas` y se publica `content` antes que la temporada.
- **Acabado exclusivo:** `rift` o ninguno. Uno nuevo es código y arte.
- **Puntos y tramos** (`points`, `tiers` de 5 crecientes). Escálalos a la duración: la Temporada 1 usó `[350, 1400, 4200, 10000, 20000]` para 4 semanas.
- **Ruta:** pasos (`at` estrictamente creciente, hasta 60), tienda, premios de cierre por tramo y podio. Títulos de ≤30 caracteres. Marcos solo de `bronze, silver, gold, nebula, abyss, crown`.
- **Misiones de temporada:** cuáles, con stats de `MISSION_STATS`.
- **Logros nuevos:** opcionales. Sus ids nunca cambian de significado.
- **Eventos:** si hay eventos que cruzan el cambio de temporada, hay que acortarlos o moverlos, porque deben caber en la temporada. Para eventos nuevos, la skill `galaxy-evento`.
- **Aviso** en la pantalla de título.

## 3. Prepara la carpeta

1. Copia `games/galaxy/ops/plantillas/temporada/` (sin su `LEEME.md`) a `games/galaxy/ops/launch/<aaaa-mm-dd>-temporada-<n>/`. La fecha es la del día de publicación; el nombre, en minúsculas y con guiones.
2. **`season.json`:** la clave completa con el id, nombre y fechas nuevos.
3. **`seasonRoute.json`:** la ruta completa (moneda, pasos, tienda, cierre). Parte de la viva y ajústala.
4. **`missions.json`:** `{ "season": [...] }` con las misiones nuevas. Las diarias y semanales se quedan como están si no mandas esos campos. Los ids no se repiten dentro de la clave.
5. **`achievements.json`:** solo si cambian. La lista completa: lo vivo más lo nuevo, sin cambiar ids existentes.
6. **Si hace falta:**
   - `content.json` con `{ "anomalies": [...] }`, partiendo de lo vivo;
   - `events.json` y `gacha.json`, si se ajustan eventos.
7. **`LEEME.md`:**
   - qué trae la temporada;
   - orden de publicación: `content`, `season`, `seasonRoute`, `missions`, `achievements`, eventos;
   - **cuándo publicar `season`:** en el momento del cambio o después del `endsAt` de la anterior, nunca antes;
   - el texto del aviso.

## 4. Valida

```
pnpm -C games/galaxy exec vitest run --project unit packages/shared/test/launch-config.test.ts
```
Comprueba que todo vale sobre lo anterior, las fechas a medianoche de Madrid, los eventos dentro de la temporada, la anomalía existente y los ids de misión únicos. El test reconstruye lo vivo desde las carpetas; la comprobación contra lo vivo de verdad es `check-config`, en la skill de publicar.

Si la temporada cambia de tema, revisa también los textos fijos: «Temporada 1 · La Señal» en `apps/web/src/codex/entries.ts`, PERKINS en `es.ts` y el sector de temporada (`sectors.season`). Eso es un PR de código aparte, con sus tests.

## 5. Entrega

1. Rama `feature/galaxy-temporada-<n>` desde `develop` con la carpeta, PR con «Qué cambia» y «Pruebas», CI en verde y merge.
2. Publica con la skill `galaxy-publicar-config` en el orden del `LEEME.md`.

**Reglas que no se saltan:**
- **`season` antes que `seasonRoute`:** el id nuevo archiva la temporada anterior (`closeDue`) con los premios de cierre de la ruta que esté viva en ese momento.
- **Nunca antes del final de la anterior:** publicar `season` antes del `endsAt` de la anterior la cierra antes de tiempo. Hay que hacerlo justo al cambio y avisar al propietario de la hora.
- **Moneda sobrante:** la que les quede a los jugadores pasa a polvo con el `dustRate` de la ruta vigente.
