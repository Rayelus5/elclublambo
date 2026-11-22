---
name: galaxy-temporada
description: Preparar una temporada nueva de Galaxy Survivor y dejarla lista para publicar en PRE. Cubre fechas y nombre, puntos y tramos, anomalía y acabado exclusivo, ruta de recompensas y tienda con su moneda, premios de cierre y podio, misiones y logros de temporada, el sector de temporada y el cierre de la anterior. Úsala cuando pidan «nueva temporada», «temporada 2», «siguiente temporada», «ruta de temporada», «tienda de temporada», «misiones de temporada», «logros nuevos» o «cambiar la anomalía», o new season, season pass.
---

# Temporada nueva

Desde el 21/11/2026 una temporada es una **ficha** (`galaxy.seasons`, plan «temporadas como fichas»), no claves de configuración. La ficha lleva fechas, reglas (puntos, tramos, anomalía, acabado), ruta y tienda con su moneda y premios de cierre, misiones de temporada y árbol de laboratorio de temporada. Las fichas pasadas, la actual y las próximas conviven: la próxima se deja **programada** y empieza sola a su hora; la anterior se cierra y archiva sola con sus propios premios de cierre.

Se prepara en una carpeta de `ops/launch/` con un `temporada.json`, la valida un test y se lleva a PRE con la CLI (`season-import` y `season-schedule`) o desde Administración › Temporadas, siempre tras el OK del propietario. Los logros (`achievements`), los eventos y escáneres, una anomalía nueva (`content`) o el sector de temporada (`sectors`) siguen siendo claves y se publican con `galaxy-publicar-config`.

Las claves antiguas `season` y `seasonRoute`, y los campos `missions.season` y `lab.season`, ya no se publican: el servidor y la CLI lo rechazan.

Antes de empezar, lee:
- `games/galaxy/AGENTS.md`;
- la parte B de `games/galaxy/docs/CONTENIDO.md`, sobre todo B4 (ids), B5 (fechas) y B8 (temporada);
- en el GDD, §13.1 y §13.1 bis.

## 1. Lee lo que está vivo (solo lectura)

Con el acceso SSH a PRE de `docs/DEPLOY_PRE.md` (`<PRE>`; comandos para Git Bash), guarda en una carpeta temporal **fuera del repositorio**:
```
ssh <PRE> "docker exec elclub-pre-galaxy-1 node dist/cli.js show-config season --data" > <tmp>/season.vivo.json
```
Haz lo mismo con `seasonRoute`, `missions`, `achievements`, `events` y `content` (para ver qué anomalías hay en `content.anomalies`). `show-config season` y `seasonRoute` ya dan la temporada abierta de las fichas. Para ver todas las fichas: `season-list`, y una entera con `season-show <id>`.

Si no puedes llegar a PRE o `show-config` todavía no existe allí (la CLI responde «Comando desconocido»), pide al propietario que exporte las claves desde el panel (`/admin/configuracion/<clave>`). No uses `psql` con contraseñas ni partas de los valores del código.

## 2. Pregunta al propietario

Con AskUserQuestion (o preguntando con opciones, si no eres Claude), en una o dos tandas:
- **Nombre** y número. El id es `season-<n>`, nuevo y nunca reutilizado.
- **Fechas:** normalmente empieza cuando acaba la anterior y dura 4 semanas. Siempre a las 00:00 de Madrid: `23:00Z` en invierno, `22:00Z` en verano.
- **Anomalía:** una de las que hay en `content.anomalies`, o una nueva. Una nueva va antes con la skill `galaxy-enemigos-sectores-sondas` y se publica `content` antes que la temporada.
- **Acabado exclusivo:** `rift` o ninguno. Uno nuevo es código y arte.
- **Puntos y tramos** (`points`, `tiers` de 5 crecientes). Escálalos a la duración: la Temporada 1 usó `[350, 1400, 4200, 10000, 20000]` para 4 semanas.
- **Ruta:** pasos (`at` estrictamente creciente, hasta 60), tienda, premios de cierre por tramo, podio y **puestos** (rangos desde el 1). Títulos de ≤30 caracteres. Marcos solo de `bronze, silver, gold, nebula, abyss, crown`.
- **Premios de cualquier tipo** (desde el 22/11/2026): además de monedas, polvo, señales, esquirlas y piezas, cada escalón, artículo o premio de cierre puede dar galaxias (rareza, acabado y quizá un rasgo), sondas, skins o experiencia. Pregunta cuáles y si alguno es grande: por encima de `mailLimits` solo un superadmin la programa desde el panel.
- **Misiones de temporada:** cuáles, con stats de `MISSION_STATS`.
- **Logros nuevos:** opcionales. Sus ids nunca cambian de significado.
- **Eventos:** si hay eventos que cruzan el cambio de temporada, hay que acortarlos o moverlos, porque deben caber en la temporada. Para eventos nuevos, la skill `galaxy-evento`.
- **Aviso** en la pantalla de título.

## 3. Prepara la carpeta

1. Copia `games/galaxy/ops/plantillas/temporada/` (sin su `LEEME.md`) a `games/galaxy/ops/launch/<aaaa-mm-dd>-temporada-<n>/`. La fecha es la del día en que empieza la temporada; el nombre, en minúsculas y con guiones.
2. **`temporada.json`:** la ficha completa (`seasonRecordSchema` en `packages/shared/src/progress/season-record.ts`):
   - `id`, `name`, `startsAt`, `endsAt` (medianoche de Madrid; normalmente empieza justo cuando acaba la anterior);
   - `rules`: lo que antes era `season` sin id, nombre ni fechas (`points`, `tiers`, `top`, `capPerMinute`, `anomaly`, `finish`, `finishChance`);
   - `route`: moneda, pasos, tienda y premios de cierre (antes `seasonRoute`). Cada paso, artículo y premio lleva su `reward` de siempre y, si da algo más, una lista `gifts` con regalos del buzón; el cierre añade `tierGifts` (cinco listas, de Bronce a Estelar), `podiumGifts` y `places: [{ from, to, gifts }]`. Reglas y ejemplo en CONTENIDO B8 («Premios de cualquier tipo»): la ruta y la tienda solo dan la moneda de **su** temporada y nunca puntos de temporada; el cierre no da nada de temporada; como mucho 20 regalos y 10 galaxias por lista;
   - `missions`: la lista de misiones de temporada (antes `missions.season`); sus ids no repiten los de las diarias ni semanales;
   - `lab`: el árbol de laboratorio de temporada (antes `lab.season`), con ids nuevos de esa temporada.
3. **`achievements.json`:** solo si cambian. La lista completa: lo vivo más lo nuevo, sin cambiar ids existentes.
4. **Si hace falta:**
   - `content.json` con `{ "anomalies": [...] }`, partiendo de lo vivo;
   - `events.json` y `gacha.json`. Son listas completas: si se publican antes del cambio de temporada, conserva los eventos que aún corren (por ejemplo, el de la temporada que acaba hasta su fin). Cada evento cabe en alguna temporada programada.
5. **`LEEME.md`:**
   - qué trae la temporada;
   - qué se publica como claves (con `galaxy-publicar-config`) y que la ficha se importa y se programa;
   - el texto del aviso.

## 4. Valida

```
pnpm -C games/galaxy exec vitest run --project unit packages/shared/test/launch-config.test.ts
```
Comprueba que todo vale sobre lo anterior, que la ficha vale (fechas a medianoche de Madrid, anomalía existente, árbol de laboratorio dentro del presupuesto con el árbol permanente, regalos de temporada bien puestos y rangos de puestos en orden), los eventos dentro de alguna temporada y los ids de misión únicos. Que cada pieza, sonda o galaxia regalada exista y se pueda hacer lo comprueba `check-config` contra lo vivo. El test reconstruye lo vivo desde las carpetas; la comprobación contra lo vivo de verdad es `check-config` (acepta la ficha bajo `temporada`, la que pone `scripts/ops-bundle.mjs`).

Si la temporada cambia de tema, revisa también los textos fijos: «Temporada 1 · La Señal» en `apps/web/src/codex/entries.ts`, PERKINS en `es.ts` y el sector de temporada (`sectors.season`). Eso es un PR de código aparte, con sus tests.

## 5. Entrega

1. Rama `feature/galaxy-temporada-<n>` desde `develop` con la carpeta, PR con «Qué cambia» y «Pruebas», CI en verde y merge.
2. **En PRE, con el OK del propietario** (comandos para Git Bash, `<PRE>` de `docs/DEPLOY_PRE.md`):
   ```
   node games/galaxy/scripts/ops-bundle.mjs games/galaxy/ops/launch/<carpeta> | ssh <PRE> "docker exec -i elclub-pre-galaxy-1 node dist/cli.js check-config -"
   node games/galaxy/scripts/ops-bundle.mjs games/galaxy/ops/launch/<carpeta> | ssh <PRE> "docker exec -i elclub-pre-galaxy-1 node dist/cli.js season-import - --reason '<motivo>'"
   ssh <PRE> "docker exec elclub-pre-galaxy-1 node dist/cli.js season-schedule <id> --reason '<motivo>'"
   ssh <PRE> "docker exec elclub-pre-galaxy-1 node dist/cli.js season-list"
   ```
   `season-import` la deja como borrador (se puede repetir para corregirla); `season-schedule` la programa. Se puede programar con días de antelación: empieza sola a su hora. También se puede preparar entera desde Administración › Temporadas (paso «Ruta, tienda y misiones», con el selector de regalos del buzón); si da premios grandes, la programa un superadmin.
3. Las claves de la carpeta (logros, eventos, escáneres, contenido) se publican con la skill `galaxy-publicar-config`.

**Reglas que no se saltan:**
- **Sin solapes:** dos temporadas programadas nunca se solapan; seguidas (el fin de una es el inicio de la otra) sí. Para alargar la actual y empujar la siguiente: `season-extend <id> <fin> --reason <motivo> --move-next`. No se mueve si las fechas nuevas rompen algo que valía (un regalo de evento que no llega al nuevo final, un torneo programado o en curso que se queda fuera de su temporada).
- **Desprogramar:** `season-unschedule <id>` solo antes de que empiece.
- **Corregir una programada o ya empezada:** `season-patch <id> - --reason <motivo>` con la ficha entera corregida (por la entrada estándar con `ops-bundle`). Nunca cambia el id ni, una vez empezada, el inicio.
- **Ids nuevos siempre:** no se programa una temporada con el id de otra ya archivada, ni una cuyo final ya pasó.
- **Cierre:** al acabar, la temporada se archiva sola con los premios de cierre de **su propia ficha**.
- **Moneda sobrante:** la que les quede a los jugadores pasa a polvo con el `dustRate` de la ruta de la temporada que se ve.
