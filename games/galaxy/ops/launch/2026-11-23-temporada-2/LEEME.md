# Temporada 2

Plan «torneo, Temporada 2, Mítica y referidos». La Temporada 1 (`season-1`) fue el torneo y acaba el 23/11 a las 00:00 (hora de Madrid). Justo después empieza la Temporada 2, más seria: 4 semanas, del 23/11 00:00 al 21/12 00:00.

**Estado: NO publicada.** Se publica el 23/11/2026 a partir de las 00:00, con el OK del propietario y la skill `galaxy-publicar-config`. Solo es configuración: no hace falta desplegar código.

## Qué trae

| Clave | Qué cambia |
|---|---|
| `season` | `season-2`, «Temporada 2», del 23/11 al 21/12. Anomalía **Estática férrea**, acabado exclusivo `rift`, tramos nuevos |
| `lab` | Estrena el **núcleo de temporada** del laboratorio (36 nodos de la plantilla, solo `season`). El árbol permanente no se toca |
| `seasonRoute` | Ruta de 32 escalones hasta 40.000 puntos con **las 8 skins Aurora**, tienda y premios de cierre nuevos. Esquirlas a 0,25 por punto |
| `missions` | 12 misiones de temporada. Las diarias y las semanales siguen igual |
| `achievements` | Los 14 logros vivos, intactos, y 4 nuevos de por vida |
| `events` | **Rumbo profundo** (nuevo, metas personales) y vuelve el **Escuadrón estelar** (grupo y clan) |
| `gacha` | El Escáner profundo igual y el **Escáner de Rumbo profundo**, con púlsares destacados |

### `season.json`

| Campo | Temporada 1 (viva) | Temporada 2 |
|---|---|---|
| Fechas | 13/11 → 23/11 (10 días) | 23/11 00:00 → 21/12 00:00 (28 días) |
| Puntos por capa, Núcleo y extracción | 20, 100 y 50 | igual |
| Tope por minuto | 20 | igual |
| Tramos (Bronce a Estelar) | 500, 2.000, 5.000, 20.000 y 100.000 | **1.500, 6.000, 16.000, 40.000 y 100.000** |
| Anomalía | `contagion` (Corrosión contagiosa) | **`iron-static` (Estática férrea)**: los enemigos aguantan un 25 % más y sueltan un 20 % más de datos |
| Acabado exclusivo | `rift`, 2 % | `rift`, 2 % (es el único que admite el esquema) |

**Por qué estos tramos.** Con el tope de 20 puntos por minuto, una partida buena da unos 100 puntos cada capa de 5 minutos, y una media realista ronda 15 por minuto. Las misiones y los eventos de la temporada suman además unos 10.000 puntos a quien los completa todos.
- **Bronce 1.500:** una o dos tardes.
- **Plata 6.000:** quien juega un rato varios días.
- **Oro 16.000:** quien juega una media hora al día toda la temporada, con sus misiones.
- **Platino 40.000:** el final de la ruta, para quien juega en serio (hora y cuarto al día con sus misiones y eventos).
- **Estelar 100.000:** la cima, más de 3 horas al día. Es la misma cifra del torneo, pero ahora en 4 semanas.

### `lab.json`

El núcleo de temporada que preparó el plan del laboratorio para la Temporada 2 (`ops/plantillas/temporada/lab.json`, sin cambios; el `LEEME.md` de `2026-11-12-laboratorio` ya decía que salía con ella):
- 36 nodos en tres ramas (Asalto, Resistencia y Botín), con estadísticas y cobro de partida, tres niveles cada uno.
- Sus niveles se guardan por `season.id`: empieza vacío con `season-2` y entre temporadas ni se ve ni da nada.
- Cabe en los presupuestos con el árbol permanente vivo de 107 nodos (lo comprueban el test y `check-config`).

### `seasonRoute.json`

**Moneda:** Esquirlas, con `dustRate` 2 como en la Temporada 1 y `perPoint` de **0,5 a 0,25**.
- El `dustRate` no cambia a propósito: las esquirlas que le queden a cada jugador de la Temporada 1 se convierten en polvo en su siguiente visita, al ritmo de la ruta que esté viva entonces. Si cambiara, quien vuelva tarde cobraría distinto.
- A 0,5 por punto y en 4 semanas, quien juega en serio ganaría unas 15.000 esquirlas para una tienda de 4.300, y el resto se convertiría en más de 20.000 de polvo de golpe al cierre. A 0,25, quien juega 40 minutos al día vacía la tienda y el sobrante es moderado.

**Ruta** (escalón = puntos de temporada; las 8 Aurora en negrita):

| Puntos | Premio | | Puntos | Premio |
|---|---|---|---|---|
| 200 | 300 monedas | | 16.000 | 1.600 de polvo y título «Forjado en estática» (Oro) |
| 500 | 40 esquirlas | | 17.500 | 2.500 monedas |
| 900 | 1 señal | | 19.000 | 160 esquirlas |
| 1.500 | **Lumen aurora** (Bronce) | | 20.500 | **Áncora aurora** |
| 2.100 | 400 de polvo | | 22.000 | 3 señales |
| 2.800 | 800 monedas | | 24.000 | 2.200 de polvo |
| 3.600 | 2 señales | | 26.000 | 3.000 monedas |
| 4.500 | **Bastión aurora** | | 28.000 | **Prisma aurora** |
| 5.300 | 80 esquirlas | | 30.000 | 4 señales |
| 6.000 | 800 de polvo y título «Explorador del vacío» (Plata) | | 32.000 | 3.000 de polvo |
| 7.000 | 1.200 monedas | | 34.000 | 4.000 monedas |
| 8.000 | 2 señales | | 36.000 | **Cometa aurora** |
| 9.000 | **Chispa aurora** | | 38.000 | 5 señales y 4.000 de polvo |
| 10.200 | 120 esquirlas | | 40.000 | **Eco aurora**, 5 señales y título «Leyenda de la Temporada 2» (Platino) |
| 11.500 | 1.200 de polvo | | | |
| 12.800 | 1.800 monedas y marco Nebulosa | | | |
| 14.000 | **Vigía aurora** | | | |
| 15.000 | 3 señales | | | |

- **En total:** 13.600 monedas, 13.200 de polvo, 25 señales, 400 esquirlas, 3 títulos, el marco Nebulosa y las 8 skins Aurora. La ruta de la Temporada 1 daba 9.100, 10.200, 18 y 590 en 20 escalones.
- **Reparto de las Aurora:** quien juega poco (unos 6.000 puntos) se lleva 2; quien juega a diario un rato (16.000 a 20.000), 4 o 5; quien juega en serio (40.000), las 8. Van en el orden de las sondas: primero las tres de salida (Lumen, Bastión y Chispa), después las que se desbloquean jugando.

**Tienda** (cada temporada empieza de cero):

| Artículo | Precio | Límite | Cambio |
|---|---|---|---|
| Señal de galaxia | 40 | 30 | igual |
| Saco de polvo estelar (300) | 80 | 10 | igual |
| Bolsa de monedas (200) | 80 | 10 | igual |
| Título Transcriptor | 600 | 1 | nuevo; sale el Título Cazador de estática, que queda como recuerdo de la Temporada 1 |
| Marco Abismo | 900 | 1 | igual, para quien no lo compró en los 10 días del torneo |

**Cierre** (cada jugador cobra el premio de su tramo, y el podio además el suyo):

| Tramo | Temporada 1 | Temporada 2 |
|---|---|---|
| Bronce | 500 monedas y 1 señal | 1.000 monedas, 300 de polvo y 2 señales |
| Plata | 1.500 monedas, 300 de polvo y 2 señales | 2.500 monedas, 800 de polvo y 4 señales |
| Oro | 3.000 monedas, 800 de polvo, 4 señales y marco Bronce | 5.000 monedas, 1.500 de polvo, 7 señales y título «Oro de la Temporada 2» |
| Platino | 5.000 monedas, 1.500 de polvo, 6 señales y título «Platino de temporada» | 8.000 monedas, 2.500 de polvo, 10 señales y título «Platino de la Temporada 2» |
| Estelar | 8.000 monedas, 3.000 de polvo, 10 señales, título «Estelar de temporada» y marco Nebulosa | 12.000 monedas, 4.000 de polvo, 15 señales y título «Estelar de la Temporada 2» |
| Podio (los 3 primeros) | 10 señales, título «Podio de temporada» y marco Corona | 5.000 de polvo, 20 señales, título «Podio de la Temporada 2» y marco Corona |

Los títulos llevan el número de la temporada para que cada uno sea un recuerdo propio. El marco Nebulosa ya sale en la ruta, por eso Estelar no lo repite.

### `missions.json`

Solo `season`: las diarias y las semanales no se mandan y se quedan como están. Los ids que repiten de la Temporada 1 significan lo mismo (40 y 120 Núcleos, capas 5 y 6); su progreso es por temporada (`s:season-2`), así que empieza de cero.

| Id | Misión | Premio |
|---|---|---|
| `s-runs50` | Juega 50 incursiones | 2 señales y 200 puntos |
| `s-runs150` | Juega 150 incursiones | 6 señales y 500 puntos |
| `s-boss40` | Purga 40 Núcleos | 4 señales y 300 puntos |
| `s-boss120` | Purga 120 Núcleos | 8 señales y 700 puntos |
| `s-depth5` | Llega a la capa 5 | 2 señales y 200 puntos |
| `s-depth6` | Llega a la capa 6 | 5 señales y 400 puntos |
| `s-extract30` | Extrae 30 veces | 3 señales y 300 puntos |
| `s-extract80` | Extrae 80 veces | 6 señales y 500 puntos |
| `s-group40` | Juega 40 partidas en grupo | 5 señales y 400 puntos |
| `s-revive40` | Reanima a 40 compañeros | 3 señales y 300 puntos |
| `s-legend5` | Consigue 5 legendarias | 800 de polvo y 200 puntos |
| `s-kills100k` | Elimina 100.000 enemigos | 5 señales y 400 puntos |

En total, 49 señales, 800 de polvo y 4.400 puntos. Salen `s-runs100`, `s-legend3`, `s-group30` y `s-extract60` (los sustituyen los de arriba).

### `achievements.json`

La lista viva entera (14 logros, sin tocar) y 4 nuevos de oro, para quien ya los tiene casi todos. Son opcionales: si no los quieres, no publiques esta clave.

| Id | Logro | Para | Premio |
|---|---|---|---|
| `a-legend10` | Coleccionista de leyendas | Consigue 10 galaxias legendarias | 5 señales, 120 puntos y título «Coleccionista» |
| `a-boss300` | Purga sin descanso | Purga 300 Núcleos | 8 señales, 150 puntos y título «Incansable» |
| `a-kills250k` | Aniquilador | Elimina 250.000 enemigos | 5 señales, 120 puntos y título «Aniquilador» |
| `a-extract100` | Cien regresos | Extrae 100 veces | 5 señales, 120 puntos y título «Infalible» |

Cuentan de por vida: quien ya pase de la cifra los desbloquea en su siguiente partida.

### `events.json`

| Evento | Fechas (Madrid, fin excluido) | Tipo | Paga |
|---|---|---|---|
| `escuadron-estelar`, primero de la lista | 30/11 00:00 → 21/12 00:00 (21 días) | grupo y clan | señales de galaxia, Eco de coral |
| `rumbo-profundo`, nuevo | 23/11 00:00 → 7/12 00:00 (14 días) | personal | señales de evento, avatar Primer contacto |

**Orden:** el inicio enseña el primer evento en curso de la lista. La primera semana solo corre Rumbo profundo y sale él; desde el 30/11 sale el Escuadrón estelar, que es la novedad, mientras Rumbo profundo sigue en Eventos y en el escáner.

**Rumbo profundo** («Dos semanas de metas duras para ti. Ganas señales del escáner de Rumbo profundo, con púlsares destacados, y el avatar Primer contacto si llegas al final»). Como la Beta Abierta (`primer-contacto`), pero en serio:

| Meta | Premio |
|---|---|
| Juega 30 incursiones | 4 señales de evento, 600 monedas y 100 puntos |
| Juega 300 minutos | 4 señales de evento, 400 de polvo y 100 puntos |
| Haz 40 escaneos | 4 señales de evento, 400 de polvo y 100 puntos |
| Juega 10 partidas en grupo | 4 señales de evento, 800 monedas y 100 puntos |
| Fusiona 5 veces | 4 señales de evento, 300 de polvo y 100 puntos |
| Purga 20 Núcleos | 5 señales de evento, 500 de polvo y 150 puntos |
| Extrae 15 veces | 5 señales de evento, 1.000 monedas y 150 puntos |
| Llega a la capa 6 | 6 señales de evento, 2 señales y 200 puntos |
| Elimina 60.000 enemigos | 6 señales de evento, 2 señales y 200 puntos |
| Purga 50 Núcleos | 8 señales de evento, 3 señales, 300 puntos y avatar **Primer contacto** (legendario, «Se gana en un evento», aún no lo daba nada) |

En total, 50 señales de evento, 7 señales de galaxia, 2.400 monedas, 1.600 de polvo y 1.500 puntos. La Beta Abierta daba 30 señales de evento en metas mucho más fáciles.

**Escuadrón estelar** («Vuelve el escuadrón, más exigente. Metas para jugar en grupo y metas que tu clan completa entre todos, con el Eco de coral para quien llegue al final»). Vuelve con el mismo id: nunca llegó a empezar (iba a ser el 17/11 y salió de la lista el 13/11), así que no hay progreso ni cobros con ese id. Más exigente que su versión del 10/11 (10 partidas en grupo, 15 reanimaciones, clan 150 Núcleos y 300 incursiones):

| Meta | Alcance | Premio |
|---|---|---|
| Juega 15 partidas en grupo | personal | 1.500 monedas, 3 señales y 150 puntos |
| Reanima a 25 compañeros | personal | 800 de polvo, 4 señales y 200 puntos |
| Tu clan juega 500 incursiones | clan | 2.000 de polvo, 3 señales y 200 puntos |
| Tu clan purga 250 Núcleos | clan | 3.000 monedas, 4 señales y 250 puntos |
| Tu clan extrae 200 veces | clan | 2.500 monedas, 3 señales y 200 puntos |
| Tu clan juega 150 partidas en grupo | clan | 2.500 de polvo, 4 señales y 250 puntos |
| Juega 50 partidas en grupo | personal | 6 señales, 300 puntos y **Eco de coral**, la última skin Coral |

En total, 27 señales de galaxia, 7.000 monedas, 5.300 de polvo y 1.550 puntos. La skin va en una meta personal para que también la pueda ganar quien no tiene clan.

**Los `-` de la lista** (los dos ya habrán terminado al publicar):
- `primer-torneo`: acaba el 23/11 a las 00:00, justo cuando se publica esto. Sus metas ya no se pueden cobrar después de esa hora, y no paga señales de evento, así que quitarlo no le quita nada a nadie. **Por eso `events` nunca se publica antes de las 00:00.**
- `primer-contacto` (Beta Abierta): acabó el 14/11. Las señales de evento que alguien no haya gastado ya se convierten solas en polvo; sin el evento en la lista, el aviso de esa conversión dirá «Primer contacto» en vez de «Beta Abierta».

### `gacha.json`

Solo `banners`: el resto (probabilidades y garantías que el propietario ajustó en el panel) se queda como está.
- `deep-scan`: copiado tal cual de lo vivo.
- **`+rumbo-profundo`:** «Escáner de Rumbo profundo», `kind: event`, `pityGroup: event-rumbo-profundo`, `currency: signal:rumbo-profundo`, destacada `phenomenon = pulsar` (Púlsar, unas 2 de cada 100 galaxias; puede salir legendaria) y las mismas fechas que su evento.
- **`-primer-contacto`:** el escáner de la Beta Abierta, cerrado desde el 14/11.

**Por qué Rumbo profundo paga señales de evento y el Escuadrón señales de galaxia:**
- Las señales de evento solo sirven en su escáner y durante su evento; lo que sobra pasa a 50 de polvo cada una. No engordan la reserva de señales de galaxia, que se guarda de temporada en temporada.
- Con la garantía de destacada viva (45 tiradas), quien complete casi todas las metas (50 señales) se asegura **una legendaria con púlsar**: un premio serio que no se puede acumular. Quien se quede a medias tira igual, con las probabilidades de siempre.
- El Escuadrón estelar nunca tuvo escáner y es un evento social: paga directamente señales de galaxia, como el torneo, y su premio gordo es la skin.
- El púlsar encaja con la historia de la Señal (los primeros púlsares se tomaron por una señal) y no es la supernova recién rebajada.

## Economía de un vistazo

Quien completa todo en la Temporada 2 gana unas 108 señales de galaxia en 4 semanas (ruta 25, misiones 49, Escuadrón 27, Rumbo profundo 7), más 10 a 15 al cierre, hasta 30 en la tienda y 50 de evento. En los 10 días del torneo, quien lo completaba todo ganaba unas 165. No hay potenciadores: la temporada no los necesita y así no se infla el polvo.

## Cuándo y cómo publicar

**Nada antes del 23/11 a las 00:00 (hora de Madrid):**
- **`season`:** un id nuevo cierra y archiva la temporada anterior (`closeDue` forzado). Antes de su fin, cortaría el torneo y su clasificación.
- **`events`:** quita `primer-torneo`. Antes de su fin, borraría el progreso del torneo.

**A las 00:00 o lo antes posible después.** Lo que se juegue entre las 00:00 y la publicación suma a la clasificación y a la ruta de la Temporada 2 (se calculan con las partidas desde su inicio), pero no paga esquirlas ni cuenta para sus misiones ni para Rumbo profundo. Rumbo profundo empieza a medianoche aunque se publique unos minutos después; no hay margen posible, porque el torneo acaba en el mismo instante.

**Orden** (`PUBLISH_ORDER`): `season`, `lab`, `seasonRoute`, `missions`, `achievements`, `events`, `gacha` y el aviso.
- `season` antes que `seasonRoute`: la Temporada 1 se archiva con los premios de cierre de la ruta viva en ese momento, que deben ser los suyos.
- `events` antes que `gacha`: el escáner se paga con las señales del evento. Si `gacha` falla, arréglalo y publícalo enseguida, o vuelve a publicar `antes/events.json`.

**Comandos** (Git Bash, desde la raíz del repo):

1. Guarda lo vivo justo antes, para volver atrás (lo de `antes/` se guardó el 13/11 y el propietario puede haber cambiado algo en el panel):
```
for k in season lab seasonRoute missions achievements events gacha boosts catalog cosmetics; do
  ssh -o BatchMode=yes root@192.168.1.103 "docker exec elclub-pre-galaxy-1 node dist/cli.js show-config $k --data" > games/galaxy/ops/launch/2026-11-23-temporada-2/antes/$k.json
done
```
2. Comprueba contra lo vivo (solo lectura). Debe decir «Se sostiene» y las mismas líneas que abajo:
```
node games/galaxy/scripts/ops-bundle.mjs games/galaxy/ops/launch/2026-11-23-temporada-2 | ssh -o BatchMode=yes root@192.168.1.103 "docker exec -i elclub-pre-galaxy-1 node dist/cli.js check-config -"
```
3. Publica clave a clave, en este orden, y para en el primer fallo:
```
ssh -o BatchMode=yes root@192.168.1.103 "docker exec -i elclub-pre-galaxy-1 node dist/cli.js publish-config season - --reason 'Temporada 2 del 23/11 al 21/12, por orden del propietario'" < games/galaxy/ops/launch/2026-11-23-temporada-2/season.json
ssh -o BatchMode=yes root@192.168.1.103 "docker exec -i elclub-pre-galaxy-1 node dist/cli.js publish-config lab - --reason 'Núcleo de temporada del laboratorio para la Temporada 2'" < games/galaxy/ops/launch/2026-11-23-temporada-2/lab.json
ssh -o BatchMode=yes root@192.168.1.103 "docker exec -i elclub-pre-galaxy-1 node dist/cli.js publish-config seasonRoute - --reason 'Ruta, tienda y cierre de la Temporada 2 con las skins Aurora'" < games/galaxy/ops/launch/2026-11-23-temporada-2/seasonRoute.json
ssh -o BatchMode=yes root@192.168.1.103 "docker exec -i elclub-pre-galaxy-1 node dist/cli.js publish-config missions - --reason 'Misiones de la Temporada 2'" < games/galaxy/ops/launch/2026-11-23-temporada-2/missions.json
ssh -o BatchMode=yes root@192.168.1.103 "docker exec -i elclub-pre-galaxy-1 node dist/cli.js publish-config achievements - --reason 'Cuatro logros nuevos para la Temporada 2'" < games/galaxy/ops/launch/2026-11-23-temporada-2/achievements.json
ssh -o BatchMode=yes root@192.168.1.103 "docker exec -i elclub-pre-galaxy-1 node dist/cli.js publish-config events - --reason 'Rumbo profundo y vuelta del Escuadrón estelar, salen el Primer torneo y la Beta Abierta ya terminados'" < games/galaxy/ops/launch/2026-11-23-temporada-2/events.json
ssh -o BatchMode=yes root@192.168.1.103 "docker exec -i elclub-pre-galaxy-1 node dist/cli.js publish-config gacha - --reason 'Escáner de Rumbo profundo con púlsares destacados, sale el de la Beta Abierta ya cerrado'" < games/galaxy/ops/launch/2026-11-23-temporada-2/gacha.json
```
4. El aviso, durante 7 días desde que se publica:
```
ssh -o BatchMode=yes root@192.168.1.103 "docker exec elclub-pre-galaxy-1 node dist/cli.js notice 'Empieza la Temporada 2: anomalía Estática férrea, las 8 skins Aurora en la ruta y el evento Rumbo profundo con su escáner. El Escuadrón estelar vuelve el 30 de noviembre' --tone info --days 7 --reason 'Aviso de la Temporada 2'"
```
5. Comprueba: `show-config <clave>` de cada una (la versión sube en una), `curl -fsS https://pre.elclub.party/galaxy/api/health` y los errores del contenedor (`docker logs --since 10m elclub-pre-galaxy-1 2>&1 | grep -i -E 'error|invalid' | tail -20`).

**Lo programa el propietario en Admin › Comunicación** (la CLI solo publica avisos desde ya): el 30/11 a las 00:00, «Vuelve el Escuadrón estelar: metas en grupo y de clan hasta el 21 de diciembre, con el Eco de coral para quien llegue al final», 7 días.

**Nota de versión:** lo publicado por configuración no pasa por un despliegue, y una nota en `entries.ts` saldría en cuanto se integre este PR, antes de la temporada. Que la añada el propietario al publicar, en Administración › Notas de versión. Propuesta:
- **Título:** «Temporada 2».
- **Resumen:** «Empieza la Temporada 2, más seria, con las skins Aurora en la ruta y dos eventos».
- **Novedades:**
  - «Temporada 2 hasta el 21 de diciembre, con la anomalía Estática férrea: los enemigos aguantan más y sueltan más datos»;
  - «La ruta de temporada trae las 8 skins Aurora, animadas»;
  - «Rumbo profundo: dos semanas de metas duras y un escáner con púlsares destacados»;
  - «El Escuadrón estelar vuelve el 30 de noviembre, con el Eco de coral»;
  - «El laboratorio estrena su núcleo de temporada»;
  - «Cuatro logros nuevos».

## Lo que no se puede deshacer

- **El archivo de la Temporada 1:** publicar `season-2` cierra `season-1` con su clasificación final y sus premios de cierre. Volver a publicar `antes/season.json` no lo deshace.
- **Las esquirlas de la Temporada 1:** las que sobren pasan a polvo (2 cada una) en la siguiente visita de cada jugador. Ocurre al acabar la temporada, se publique o no.
- **Lo cobrado:** premios de la ruta, la tienda, las misiones, los logros y las metas quedan en el libro de movimientos, que es de solo añadir.
- **Las señales de Rumbo profundo:** si se quitara el evento y su escáner antes de tiempo, las que tenga cada jugador pasarían a polvo y su progreso no volvería.
- **El núcleo de temporada:** volver a `antes/lab.json` lo esconde, pero no devuelve el polvo ni los componentes gastados en él.

Para volver atrás lo demás, con el OK del propietario, se vuelve a publicar `antes/<clave>.json` con el motivo «Vuelta atrás: …» (skill `galaxy-publicar-config`).

## Comprobado el 13/11

`launch-config.test.ts` pasa: la carpeta vale sobre lo anterior y, a las 00:00 del 23/11, todo se sostiene (eventos dentro de la temporada, escáner con las fechas de su evento, púlsar posible en una legendaria, ids de misión únicos, anomalía existente) y las fechas caen a medianoche de Madrid.

`check-config` contra PRE, solo lectura:
```
Cambiaría season v9 → v10: id, name, startsAt, endsAt, tiers, anomaly
Cambiaría lab v1 → v2: season (+t2-assault … +t2-scrap, 36 nodos)
Cambiaría seasonRoute v2 → v3: currency, steps, shop (+title-transcriber -title-hunter), closing
Cambiaría missions v2 → v3: season (+s-runs50 +s-runs150 +s-extract30 +s-extract80 +s-group40 +s-revive40 +s-legend5 +s-kills100k -s-runs100 -s-legend3 -s-group30 -s-extract60 ~s-boss40 ~s-boss120 ~s-depth5 ~s-depth6)
Cambiaría achievements v2 → v3: list (+a-legend10 +a-boss300 +a-kills250k +a-extract100)
Cambiaría events v5 → v6: list (+escuadron-estelar +rumbo-profundo -primer-torneo -primer-contacto)
Cambiaría gacha v3 → v4: banners (+rumbo-profundo -primer-contacto)
Se sostiene: season, lab, seasonRoute, missions, achievements, events, gacha
```
- La línea de `lab` va abreviada: entran los 36 nodos `t2-*` y no sale ninguno.
- Los `-` de `events` y `gacha` son los explicados arriba. El de `shop` (`title-hunter`) y los de `missions.season` son cambios de la temporada: cada temporada tiene su tienda y sus misiones.
- Sin `season.json`, `check-config` diría «El evento escuadron-estelar no cabe en la temporada season-1» y lo mismo de `rumbo-profundo`: es lo que pasaría si se publicaran los eventos antes que la temporada. Con la carpeta entera, y en el orden de arriba, no pasa.

## Decisiones para que el propietario confirme

- Nombre «Temporada 2», sin subtítulo (los textos fijos del Códice y la Fisura de la Señal siguen siendo de la Temporada 1; cambiarlos es un PR de código aparte).
- Anomalía Estática férrea (`iron-static`), en vez de Enjambre (`swarm`) o Marea veloz (`rush`).
- Tramos 1.500, 6.000, 16.000, 40.000 y 100.000.
- Esquirlas a 0,25 por punto (antes 0,5) con el mismo `dustRate` 2.
- La ruta acaba en 40.000 (Platino) con la Eco aurora, y las Aurora en 1.500, 4.500, 9.000, 14.000, 20.500, 28.000, 36.000 y 40.000.
- Títulos «Explorador del vacío», «Forjado en estática», «Leyenda de la Temporada 2», «Transcriptor» y los de cierre con el número de temporada.
- Rumbo profundo del 23/11 al 7/12, con señales de evento, escáner propio con púlsar destacado y el avatar Primer contacto en su última meta.
- Escuadrón estelar del 30/11 al 21/12, primero en la lista, con la Eco de coral en «Juega 50 partidas en grupo».
- El núcleo de temporada del laboratorio sale ya, con la plantilla tal cual.
- Cuatro logros nuevos (opcionales).
- Sin potenciadores.
