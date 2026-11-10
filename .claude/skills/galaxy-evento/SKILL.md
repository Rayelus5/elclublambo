---
name: galaxy-evento
description: Preparar un evento temporal de Galaxy Survivor y dejarlo listo para publicar en PRE. Cubre el evento con sus metas personales o de clan, sus señales de evento, el escáner de evento con su galaxia destacada, los potenciadores (monedas, polvo o material ×N) y el aviso de la pantalla de título. Úsala cuando pidan «nuevo evento», «evento de fin de semana», «escáner de evento», «galaxia destacada», «doble de polvo», «potenciador», «multiplicador» o «aviso de evento», o new event, limited-time event, featured banner, boost.
---

# Evento temporal

Un evento es configuración viva: las claves `events`, `gacha` (su escáner), `boosts` y, opcionalmente, un aviso. Se prepara en una carpeta de `ops/launch/`, la valida un test y se publica en PRE con `galaxy-publicar-config` tras el OK del propietario.

**La alternativa sin archivos:** el propietario puede crearlo él desde el panel, con el asistente `/admin/eventos/nuevo` (o `?desde=<id>` para duplicar uno, que mueve las fechas una semana y añade `-2` al id). El asistente publica a la vez el evento y su escáner, pero lo pone al final de la lista (no saldrá en el inicio mientras haya otro en curso antes) y no crea potenciadores ni avisos. Ofréceselo si eso le basta.

Antes de empezar, lee:
- `games/galaxy/AGENTS.md`;
- la parte B de `games/galaxy/docs/CONTENIDO.md`, sobre todo B4 (ids), B5 (fechas), B6 (límites) y B7 (eventos y escáneres).

## 1. Lee lo que está vivo (solo lectura)

Con el acceso SSH a PRE de `docs/DEPLOY_PRE.md` (`<PRE>`; comandos para Git Bash), en una carpeta temporal **fuera del repositorio** (`<tmp>`):
```
for k in events gacha boosts season; do
  ssh <PRE> "docker exec elclub-pre-galaxy-1 node dist/cli.js show-config $k --data" > <tmp>/$k.vivo.json
done
```
Las listas se publican enteras: tu borrador parte de lo vivo. Si no puedes llegar a PRE o `show-config` todavía no existe allí (la CLI responde «Comando desconocido»), pide al propietario que exporte las claves desde el panel. Nunca partas de los valores del código.

## 2. Pregunta al propietario

Con AskUserQuestion (o preguntando con opciones, si no eres Claude):
- **Nombre y descripción:** español, sin punto final; nombre ≤40 caracteres, descripción ≤200. El id es nuevo, en minúsculas con guiones, de ≤26 caracteres y nunca reutilizado.
- **Fechas:** ≤31 días, dentro de la temporada vigente, a las 00:00 de Madrid. El fin es exclusivo: «de viernes a domingo» acaba el lunes a las 00:00; «hasta el lunes incluido», el martes.
- **Metas:** 1–12. Cada una con:
  - stat de `MISSION_STATS`: `runs, minutes, kills, bossKills, extractions, depth, pulls, legendaries, fusions, disintegrations, components, coopRuns, revives`;
  - objetivo;
  - alcance `personal` o `clan` (de clan solo cuenta para quien está en uno);
  - premio: `coins`, `dust`, `signal`, `xp`, `points`, `eventSignals` (≤100).

  Una stat nueva es código: pídela aparte.
- **Escáner de evento:** solo si alguna meta paga `eventSignals`. Rasgo y valor de la destacada: valores reales de `packages/engine/config/traits.yaml`, también listados en `traitValues` de `apps/web/src/copy/es.ts`.
- **Potenciadores:** opcionales. Moneda (`coins`, `dust`, `material`, `signal`), factor 1–5, fechas (≤14 días, a cualquier hora). Solo multiplican lo que pagan las incursiones. Mira los vivos: los de la misma moneda que coinciden se multiplican (un ×2 sobre un ×1,5 da ×3); díselo al propietario.
- **Destacado en el inicio:** el inicio muestra el primer evento **en curso** de la lista; si debe ser este, va primero.
- **Aviso:** opcional, 1–200 caracteres. Con la CLI sale **en el momento de publicar** y dura N días desde entonces; si debe salir más tarde (por ejemplo, el mismo viernes), que el propietario lo programe en Admin › Comunicación.

## 3. Prepara la carpeta

1. Copia `games/galaxy/ops/plantillas/evento/` (sin su `LEEME.md`) a `games/galaxy/ops/launch/<aaaa-mm-dd>-<id-evento>/`. La fecha es la del día de publicación; el nombre, en minúsculas y con guiones.
2. **`events.json`:** `{ "list": [...] }` con **todos** los eventos vivos que siguen en curso o por venir, copiados tal cual de `events.vivo.json`, más el nuevo, en el orden en que deben salir. Como mucho 10. Solo se pueden quitar los ya terminados: quitar uno en curso borra su progreso y convierte en polvo sus señales, sin vuelta atrás.
3. **`gacha.json`:** `{ "banners": [...] }` con todos los escáneres vivos que siguen abiertos, siempre con `deep-scan`, más el nuevo:
   - `id`: el del evento;
   - `kind: "event"`;
   - `name: "Escáner de <evento>"`;
   - `pityGroup: "event-<id>"`;
   - `currency: "signal:<id>"`;
   - `featured: { trait, value }`;
   - `startsAt` y `endsAt` **exactamente** los del evento, la misma cadena con `.000Z`.
4. **`boosts.json`:** `{ "list": [...] }` con los vivos que siguen, más los nuevos. Los de la misma moneda se multiplican hasta ×5, y los que tienen el mismo nombre y fin se ven como una sola noticia.
5. **`LEEME.md`:**
   - qué trae el evento;
   - orden de publicación: `boosts`, `events`, `gacha`, aviso;
   - el texto exacto del aviso y sus días (o que lo programa el propietario en el panel).

## 4. Valida

```
pnpm -C games/galaxy exec vitest run --project unit packages/shared/test/launch-config.test.ts
```
Comprueba que el escáner existe, que se paga con las señales del evento y lleva sus fechas, que el evento cabe en la temporada, que las fechas caen a medianoche de Madrid, que la destacada puede salir legendaria y que `deep-scan` sigue.

Si la destacada falla, el valor no existe o es imposible para una legendaria: elige otro con el propietario.

El test reconstruye lo vivo desde las carpetas, así que no ve lo que el propietario cambió en el panel ni si te dejaste un evento vivo. Eso lo comprueba `check-config` contra lo vivo de verdad, en la skill de publicar: ahí cualquier `-` en `list` o `banners` es una alarma.

## 5. Entrega

1. Rama `feature/galaxy-evento-<id>` desde `develop` con la carpeta, PR con «Qué cambia» y «Pruebas», CI en verde y merge.
2. Publica con la skill `galaxy-publicar-config`, en el orden canónico: `boosts`, `events`, `gacha` y, al final, el aviso con `notice`. Hazlo con margen antes del inicio del evento.

Al acabar el evento, sus señales sobrantes se convierten solas en polvo (`gacha.leftoverDust`) y el jugador ve un aviso. No hay que hacer nada.
