---
name: galaxy-torneo
description: Preparar un torneo de Galaxy Survivor y dejarlo como borrador en PRE, y acompañar al propietario mientras se juega y se revisa. Cubre título, resumen y reglas, fechas dentro de una temporada, la medida con la que se gana (puntos, mejor partida, enemigos, partidas, capa, Núcleos, extracciones o puntos de temporada), filtros de sector, sonda y modo, exclusividad, entrada en moneda del juego, nivel mínimo y cupo, premios por puesto o por tramos con regalos de cualquier tipo o dinero, premio de participación y la revisión antes de pagar. Úsala cuando pidan «nuevo torneo», «torneo de fin de semana», «copa», «competición», «premios por puesto», «premio en metálico», «revisar un torneo» o «resultados del torneo», o new tournament, competition, cup.
---

# Torneo

Un torneo es una **ficha en la base de datos** (`galaxy.tournaments`), no una clave de configuración. Vive en una temporada programada y tiene su propia clasificación, que calcula siempre el servidor con las partidas.

**Hay dos caminos. Ofrece primero el del panel:**
1. **El propietario lo crea en el panel:** Administración › Torneos › «Nuevo torneo» (`/admin/torneos/nuevo`; `?desde=<id>` duplica uno). El asistente valida en vivo, sube las imágenes y enseña «Así lo verá el jugador». Si eso le basta, ayúdale a decidir los datos (paso 2) y no prepares carpeta.
2. **Lo preparas tú en una carpeta de `ops/launch/`** con un `torneo.json`. Lo valida un test, lo comprueba `check-config` contra lo vivo y, con el OK del propietario, `tournament-draft` lo guarda en PRE **como borrador**.

**Programarlo es siempre cosa del propietario,** desde el panel y con su contraseña. Si los premios superan los límites del buzón o llevan dinero, tiene que programarlo un superadmin. La CLI nunca programa torneos.

Antes de empezar, lee:
- `games/galaxy/AGENTS.md`;
- de `games/galaxy/docs/CONTENIDO.md`: B10 (regalos del buzón y sus límites) y B11 (torneos);
- `games/galaxy/docs/GDD.md` §13.3 (las reglas del torneo).

## 1. Lee lo vivo (solo lectura)

Con el acceso SSH a PRE de `docs/DEPLOY_PRE.md` (`<PRE>`; comandos para Git Bash):
```
ssh <PRE> "docker exec elclub-pre-galaxy-1 node dist/cli.js season-list"
ssh <PRE> "docker exec elclub-pre-galaxy-1 node dist/cli.js tournament-list"
ssh <PRE> "docker exec elclub-pre-galaxy-1 node dist/cli.js show-config content --data" > <tmp>/content.vivo.json
```
- **`season-list`:** el torneo tiene que caber en una temporada **programada**. Si la que toca aún es un borrador, se programa antes (skill `galaxy-temporada`).
- **`tournament-list`:** lo que ya hay. Un torneo exclusivo que coincide en fechas con otro exclusivo obliga a elegir: nadie puede estar en los dos.
- **`content`:** los ids de sectores y sondas, si hay filtros, y de sondas que se regalen.

`<tmp>` es una carpeta temporal **fuera del repositorio**. Si la CLI de PRE responde «Comando desconocido» a `tournament-list`, el código de esta skill aún no está desplegado: usa el panel.

## 2. Pregunta al propietario

Con AskUserQuestion. Los textos van en español, sin punto final ni símbolos especiales, y los títulos se proponen como opciones.
- **Título** (≤60), **resumen** de la tarjeta (≤200) y **reglas** en claro (≤4000).
- **Slug:** la dirección `/torneos/<slug>`. En minúsculas con guiones, 3–48 caracteres. Nunca repetido, tampoco con torneos terminados.
- **Fechas:** a cualquier hora, 28 días como mucho, dentro de su temporada. El fin es exclusivo: «hasta el domingo incluido» acaba el lunes a las 00:00 de Madrid. Guárdalas en UTC con `.000Z`. En invierno, Madrid es UTC+1.
- **Cómo se gana** (`metric`):

  | Medida | Qué cuenta |
  |---|---|
  | `points` | Los puntos de temporada de cada partida, sumados |
  | `best_run` | Los puntos de la mejor partida |
  | `kills` / `cores` | Enemigos y Núcleos, sumados |
  | `runs` / `extractions` | Partidas y extracciones, contadas |
  | `depth` | La capa más honda |
  | `season_points` | Los puntos desde el inicio de la temporada hasta el fin del torneo. Inscribirse solo da derecho a optar |

  Salvo en `season_points`, cuentan las partidas terminadas desde la inscripción. Nunca cuentan misiones ni ajustes.
- **Filtros:** sector, sonda, modo (`solo`, `coop` o `any`) y nivel mínimo para inscribirse.
- **Inscripción:**
  - exclusivo (por defecto sí);
  - entrada opcional en `coins`, `dust` o `signal`. Salirse no la devuelve, cancelar el torneo sí;
  - cupo opcional (`maxEntrants`).
- **Premios por tramos de puestos:**
  - empiezan en el 1.º, van en orden y no se solapan; puede haber huecos;
  - cada tramo da regalos del buzón (`Gift`): monedas, polvo, señal, material, componentes, piezas cosméticas, galaxias, sondas o experiencia. Nunca nada que acabe con la temporada o con un evento (sus puntos, su moneda o señales de evento): los premios no caducan;
  - dinero opcional por tramo (`cash: { amountEur, note }`). Lo paga un admin fuera del juego, que nunca pide datos bancarios. **Una entrada y un premio en dinero nunca van juntos.**
  - Quien tiene apagado «puede ganar premios» conserva su puesto con una marca, y su premio pasa al siguiente.
- **Premio de participación:** opcional, para quien juega al menos `minRuns` partidas que cuentan.
- **Horas de revisión** (`reviewHours`, 0–168; 24 por defecto): el mínimo entre el final y los resultados.
- **Imágenes** (banner 8:3, unos 1600×600, e imagen de premios): se suben en el panel, nunca en la carpeta.

## 3. Prepara la carpeta

1. Copia `games/galaxy/ops/plantillas/torneo/` (sin su `LEEME.md`) a `games/galaxy/ops/launch/<aaaa-mm-dd>-torneo-<slug>/`. La fecha es la del día en que se guarda en PRE.
2. Rellena `torneo.json` con lo que decidió el propietario. Deja `bannerMedia` y `detailsMedia` en `null`.
3. Escribe un `LEEME.md` con:
   - qué trae el torneo;
   - que se guarda como borrador con `tournament-draft`;
   - que el propietario sube las imágenes y lo programa en el panel.

## 4. Valida

```
pnpm -C games/galaxy exec vitest run --project unit packages/shared/test/launch-config.test.ts
```
Comprueba la ficha: fechas, tramos, entrada y dinero, regalos que no caducan, sectores y sondas del contenido de las carpetas y, si su temporada está en alguna carpeta, que cabe en ella.

Después, contra lo vivo de PRE (solo lectura):
```
node games/galaxy/scripts/ops-bundle.mjs games/galaxy/ops/launch/<carpeta> | ssh <PRE> "docker exec -i elclub-pre-galaxy-1 node dist/cli.js check-config -"
```
Tiene que decir «Torneo <slug>: se puede guardar y programar». Si no, cada línea dice el campo y el problema; el texto de cada código está en `apps/web/src/copy/es.ts` (`tournamentIssues`). Lo que sale como «Problema:» es del resto de lo vivo, no del torneo: cuéntaselo al propietario.

## 5. Entrega

1. Rama `feature/galaxy-torneo-<slug>` desde `develop` con la carpeta, PR con «Qué cambia» y «Pruebas», CI en verde y merge.
2. **Con el OK explícito del propietario en esta conversación,** guárdalo como borrador:
   ```
   node games/galaxy/scripts/ops-bundle.mjs games/galaxy/ops/launch/<carpeta> | ssh <PRE> "docker exec -i elclub-pre-galaxy-1 node dist/cli.js tournament-draft - --reason '<motivo>'"
   ```
   Si ya hay un borrador con ese slug, lo sustituye. Si ya está programado, no se toca: hay que desprogramarlo antes en el panel (solo antes de empezar y sin inscritos).
3. Dile al propietario que abra Administración › Torneos › el borrador:
   - suba el banner y la imagen de premios;
   - mire «Así lo verá el jugador»;
   - pulse «Guardar y programar» con su contraseña.

## 6. Mientras se juega y al acabar

Todo esto es del propietario, en el panel. Tu papel es explicárselo y avisarle.
- **Programado:** se puede inscribir cualquiera que cumpla los requisitos. Empieza solo a su hora y avisa a los inscritos.
- **En revisión,** al acabar: el servidor resimula las partidas de los puestos con premio.
  - Las que no coinciden pasan a sospechosas solas.
  - Las que no se pueden comprobar (`unverifiable`) o fallan (`error`) esperan a un admin. Las `unverifiable` se aceptan o descartan en bloque, por motivo o por jugador; las `error`, una a una.
  - Tu propia partida solo la puedes descartar. La de un superadmin la decide otro superadmin; la de otro del equipo, un superadmin.
  - Si nadie puede decidirla en el panel (la partida es del único superadmin), el propietario la decide desde el contenedor con `tournament-decide <slug> <id de la partida> accept|discard --reason '<motivo>'` (por SSH, como `tournament-list`; queda auditada como «cli»).
  - Un admin puede descalificar con motivo.
- **Resultados:** salen cuando pasan las horas de revisión y no queda nada pendiente, o con «Publicar ya». Cada ganador recibe un aviso en el buzón y recoge sus premios en la página del torneo.
- **Dinero:** sale en «Premios en metálico pendientes». El admin escribe al ganador por el buzón, le paga fuera del juego y lo marca como pagado.
- **Cancelar** devuelve la entrada a quien la pagó, una sola vez.
- **Antes de integrar en `develop` algo que suba `SIM_VERSION`** con un torneo con premios en curso o en revisión, avisa al propietario. Sus partidas anteriores quedarían sin comprobar y habría que decidirlas en bloque. Que elija él el momento.
