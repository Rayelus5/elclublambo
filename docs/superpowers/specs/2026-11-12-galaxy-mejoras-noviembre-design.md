# Galaxy Survivor: mejoras de noviembre (diseño)

Fecha: 2026-11-12. Pedido por el propietario tras abrir la tienda. Este documento recoge lo que quiere, lo que decidió en la sesión de preguntas y lo que decido yo. Con él se escribe el plan (superpowers:writing-plans).

Todo el código del juego está en `games/galaxy/`. Antes de tocarlo, lee `games/galaxy/AGENTS.md`. Las referencias `archivo:línea` son de `develop` a fecha de hoy.

## 1. Por qué

La beta abierta ya tiene jugadores y una tienda con dinero real. El propietario ha jugado y ha encontrado cosas que confunden o aburren:
- En grupo, el daño de un compañero se ve y se oye como si fuera tuyo.
- No sabes dónde están tus compañeros.
- Las cartas de mejora en grupo no explican nada.
- El jefe de cada sector es siempre el mismo.
- La dificultad no sube de un sector al siguiente como debería.

Además quiere más contenido (armas y pasivas), que el perfil sea algo que el jugador cuide y luzca (avatar, marco, título y banner), y una segunda línea de ingresos con cosméticos exclusivos.

**Qué es un éxito:**
- Partidas en grupo que se entienden a simple vista.
- Más variedad en cada capa.
- Una curva de dificultad que se nota al cambiar de sector.
- Perfiles que se distinguen entre sí.
- Todo con el acabado de siempre (pixel art cuidado, animación, sonido) y sin romper nada de lo que ya hay en PRE.

## 2. Alcance y orden

Tres bloques, en este orden (decisión del propietario: arreglos rápidos primero, después combate y por último perfil). Cada PR va a `develop` con CI en verde. Nunca `main`.

| Bloque | PR | Qué |
|---|---|---|
| A | A1 | Textos de resultados, «¡Escanear otra!» en el escáner y descripciones en las cartas de grupo |
| A | A2 | Daño solo para quien lo recibe e indicadores de compañeros |
| A | A3 | Añadir amigos desde la sala multijugador |
| B | B1 | Curva de dificultad: fórmulas, calibración y datos |
| B | B2 | 5 pasivas nuevas |
| B | B3 | 5 armas nuevas con sus evoluciones |
| B | B4 | Tres formas por Núcleo |
| B | B5 | Publicación del contenido en PRE (con OK del propietario) |
| C | C1 | Desplegables propios en todo el juego y el admin |
| C | C2 | Cosméticos: modelo de datos, «Personalizar» y avatar con marco en todas partes |
| C | C3 | Arte del lote de estreno (avatares y marcos), con hoja para aprobar |
| C | C4 | Banner de galaxia y tema de acabado del perfil |
| C | C5 | Cosméticos de pago en la tienda (pestaña «Estilo») y su puesta en marcha |

**Fuera de alcance:**
- Copia de seguridad fuera de la máquina: el propietario la aplaza.
- Las fechas de los eventos `primer-contacto` y `escuadron-estelar`: son correctas. Si `check-config` avisa de ellas, se ignora.
- Modos de partida con duración fija: no existen ni se crean. Una partida dura hasta morir o extraer, y cada capa dura 5 minutos.

## 3. Reglas que aplican a todo

- **TDD:** primero el test que falla.
  - Los tests unitarios, web y de navegador se pasan en local.
  - Los de integración y pgTAP, solo en CI.
  - Nunca se ejecutan en local `supabase db reset`, `pnpm db:test`, el e2e de la raíz ni `apps/server/test/integration/config.test.ts`.
- **Pantallas nuevas o cambiadas:** capturas a 1280, 1600, 1920 y 2560 px. Nada crece de lado. Se respeta `prefers-reduced-motion`.
- **CSP:** `style-src 'self'`. Se puede usar el `style` de React y `el.style.setProperty`; no se puede usar `<style>` ni `style=""` en el HTML. Imágenes solo propias, `data:` o `blob:`.
- **Textos** en español con «tú». Nunca se escribe en un texto un valor que el admin puede cambiar: lo manda el servidor.
- **PRE es producción** para pagos y jugadores:
  - no se crean cuentas de prueba;
  - no se publica configuración sin el OK explícito del propietario en esa conversación (skill `galaxy-publicar-config`);
  - toda publicación de `content` parte de lo vivo (`draft-config`), porque en PRE está el «Bosses Buff» del propietario (vida de jefe de 2,7× a 8× la del código) y retoques del panel que no están en el repositorio.
- **El repositorio es público:** nada secreto ni personal.
- **`SIM_VERSION`:** se sube cuando cambia cómo se juega la simulación, con su entrada en `docs/DEPLOY_PRE.md` («recargar»). En grupo, el servidor ejecuta la misma simulación como árbitro, así que cualquier cambio de la simulación sin subida desincroniza.
- **Arte nuevo:** con el MCP de Aseprite, siguiendo `docs/CONTENIDO.md` §A6. El propietario aprueba la hoja completa antes de publicar el arte de C3 y la de las formas de Núcleo de B4.

## 4. Bloque A: arreglos rápidos

### A1. Resultados, escáner y cartas de grupo

**«Sin extracción se cobra la mitad»** (`es.ts:2419`, usado en `hangar/ResultsScreen.tsx:124`)
- No es exacto: lo que te llevas sin extraer es `runs.deathShare`, que el admin cambia. El servidor ya manda `r.breakdown.share`.
- El texto pasa a depender del valor:
  - sin extracción: «Sin extracción te llevas el {pct} % del botín»;
  - si extrajiste pero el resultado se marcó como sospechoso (`share < 1` también ocurre ahí, `packages/shared/src/runs/rewards.ts:76`): «Cobras el {pct} % del botín».

**«+5 de moneda de temporada»** (`es.ts:1439`, `ResultsScreen.tsx:94-98`)
- Pasa a «+5» con el icono `shard` justo detrás, en la misma línea.
- El nombre completo de la moneda de temporada (viene de la configuración) se queda como texto oculto para lectores de pantalla.

**Escáner: botones tras un escaneo** (`scanner/RevealStage.tsx:211-227`, `scanner/ScannerScreen.tsx:229-243`)

Botones nuevos:
- **«¡Escanear otra!»** tras escanear 1 y **«¡Escanear otras 10!»** tras escanear 10.
  - Es el botón principal, con más peso visual que los otros.
  - Al lado muestra lo que cuesta, con los valores de `view.costs`.
- **«Colección»** sustituye a «Ver en la colección» y cambia el fondo amarillo por violeta. El texto blanco debe tener un contraste de al menos 4,5:1. Si no hay token violeta, se crea en `app.css` con su `-2` y su `-lip`, como `pill-solar`.
- «Cerrar» se queda igual.

Cómo se paga:
- Se repite el mismo escaneo (1 o 10) en el mismo escáner y con el mismo medio de pago.
- Si el anterior fue el gratis del día, el siguiente se paga con señales del escáner si tienes y, si no, con monedas.
- Si no te llega, el botón se ve apagado y dice cuánto falta («Te faltan 40 monedas»). No lleva a la tienda ni enseña nada para comprar.

Problemas del código que hay que resolver:
- `RevealStage` guarda el paso y las imágenes entre escaneos. Hay que volver a montarlo con un `key` del nuevo escaneo y que el foco caiga bien.
- El estado «cargando» y los errores tienen que verse dentro del escenario, no detrás del modal.
- El tutorial escucha `scanner:pulled` y `scanner:revealClosed`, y no debe romperse.

**Cartas de mejora en grupo** (`coop/CoopHud.tsx:18-69`)
- `describeOffer` ya calcula `d.text`, pero `CoopCards` no lo pinta.
- Se pinta como en las partidas en solitario: hasta 3 líneas, la tira de cartas más alta, la clase `fresh` y un icono de 48 px.
- Al ser una tira sobre la partida en marcha, debe seguir sin tapar el centro de la pantalla. Se añade una captura del modo grupo.

### A2. Daño local e indicadores de compañeros

**El destello de daño solo es para quien lo recibe**
- Hoy, `stage.ts:825` (destello y temblor) y `arena-sfx.ts:93` (sonido) reaccionan al evento `hurt` de cualquier sonda.
- Se añade una opción `me` a `StageOptions`, distinta de `probe` (la sonda que sigue la cámara):
  - el destello y el temblor solo saltan con `e.probe === me`;
  - mientras estás caído y miras a un compañero, no ves su destello.
- `playEvents(events, me)`: los sonidos personales (`hurt`, `levelUp`, `pickup` y `dash`) solo suenan si son tuyos.
- El anillo dorado de evolución se dibuja en quien evoluciona, no siempre en tu sonda (`stage.ts:858-861`).
- **Decisión mía:** cuando un compañero recibe daño, su sprite parpadea en rojo un instante, para que se sepa sin confundirlo con el tuyo.

**Indicadores de compañeros** (decisión del propietario: flecha, nombre y vida)
- Cuando un compañero queda fuera de la pantalla, aparece en el borde:
  - una flecha de su color de equipo (`TEAM_TINT`);
  - su nombre;
  - una barrita de vida.
- Si está caído, la flecha late en rojo. Si está desconectado, se ve tenue.
- Se dibuja en Pixi, en el espacio de la pantalla y en cada fotograma (junto a `numbers`, `stage.ts:204-207`), no en el DOM a 10 Hz.
- **Decisión mía:** las cuentas para pegar algo al borde de la pantalla se sacan a una función pura con tests. La usan también la baliza (`BeaconMarker`) y las marcas de grupo (`CoopMarks`), que hoy tienen las mismas cuentas copiadas.
- **Fallo menor que se arregla:** en grupo, la dirección de la baliza se mide desde tu sonda aunque la cámara siga a un compañero.

### A3. Añadir amigos desde la sala

- En cada tarjeta de miembro de la sala (`hangar/lobby/Stage.tsx`, `Mate`) se muestra un botón según la relación con ese jugador. Todos los miembros lo ven, no solo el líder.
  - Sin relación: «Añadir amigo».
  - Solicitud enviada: «Solicitud enviada», apagado.
  - Te la ha enviado él: «Aceptar solicitud».
  - Ya sois amigos, o hay un bloqueo: nada.
- La relación sale de la caché de `useFriends()` (la misma de `RoomPanel`), sin una petición por tarjeta.
- Las acciones usan `useFriendAction()`; los errores se muestran con `errorText`.
- La tarjeta mide 180 px de ancho: hay que revisar que el botón cabe.
- **Decisión mía:** el mismo botón aparece en la lista del equipo de la pantalla de resultados en grupo (`coop/TeamResults.tsx`).

## 5. Bloque B: combate

### B1. Curva de dificultad (decisión del propietario: 5 / 15 / 30 y cada sector más difícil)

**Objetivo, medido con el bot de calibración en el Sector 1:**

| Jugador | Muerte hacia el minuto | Capas aproximadas |
|---|---|---|
| Quien empieza | 5 | 1–2 |
| Medio | 15 | 3 |
| Veterano | 30 | 5–6 |

- En cada sector siguiente, esos tiempos bajan entre un 10 y un 15 %. El sector de temporada es el más difícil.
- Quien empieza no debe frustrarse en el Sector 1: se acepta que sea el más fácil.

**Fallos de hoy que se corrigen:**
- Anillos Helados (sector 2) crece por minuto más deprisa que los sectores 3 y 4 (`hpPerMinute` 0,075, `damagePerMinute` 0,09, densidad 0,24/4,5). A partir del minuto 3 es más difícil que ellos.
- El daño de los Núcleos (contacto y balas) ignora `sector.enemyDamage`, la anomalía y el `enemyDamage` del grupo (`boss.ts:28-30`, `:51`, `:67`). Su vida ignora `anomaly.enemyHp`. Se aplican todos. Es un cambio de fórmula: sube `SIM_VERSION`.

**Calibración:**
- Se definen tres perfiles de bot (quien empieza, medio y veterano) en `packages/sim/test/proving.ts`:
  - quien empieza: sonda inicial a nivel 1, sin laboratorio ni reliquias;
  - medio y veterano: el constructor fija su nivel de sonda, su laboratorio y sus reliquias, y lo documenta.
- **Test largo** (`GALAXY_CALIBRATE=1`): para cada perfil y sector, la mediana del minuto de muerte con 8 semillas entra en la banda (5 ± 1,5; 15 ± 3; 30 ± 5 en el Sector 1) y baja de un sector al siguiente dentro de la banda del 10–15 %.
- **Test barato en CI:** los multiplicadores de vida y daño de la fauna, en puntos fijos (capa, minuto), nunca bajan de un sector al siguiente. Hoy fallaría con Anillos Helados.
- **Decisión mía:** la vida de los jefes de `DEFAULT_CONTENT` se iguala a la que hay en PRE (el «Bosses Buff»), para que la calibración mida lo que juegan de verdad. Los datos están en `ops/launch/2026-11-10/content.json` y en lo vivo.
- La economía por minuto sigue igual entre sectores (±15 % respecto a la Nebulosa) y se sigue comprobando.

### B2. Cinco pasivas nuevas (aprobadas por el propietario)

| Pasiva | Qué hace | Stat nueva |
|---|---|---|
| Fase cuántica | Probabilidad de esquivar un golpe | `evasion` |
| Cazanúcleos | Más daño contra jefes y élites | `bossDamage` |
| Protocolo de purga | Los enemigos normales con muy poca vida mueren al instante. Nunca afecta a élites ni jefes | `execute` |
| Repulsor | Más retroceso en tus golpes | `knockback` |
| Inercia | Más daño mientras te mueves | `movingDamage` |

- Cada pasiva es una stat nueva: hoy hay 20 pasivas para 20 stats, una por stat.
- Cada stat tiene niveles y un tope en `caps`. La esquiva y la purga llevan topes bajos.
- Los presupuestos de `builds.test.ts` deben seguir cumpliéndose.

**Trampa: `caps` exige todas las claves** (`schema.ts:383`)
- Una stat nueva hace inválido el contenido publicado en PRE, y el servidor cae en silencio a `DEFAULT_CONTENT`, con lo que se pierde el «Bosses Buff».
- Las claves nuevas llevan un valor por defecto. Un test comprueba que el contenido vivo de hoy (`ops/launch/2026-11-10/content.json`) sigue validando.

**El laboratorio usa la misma lista de stats** (`registry.ts:77` y el presupuesto `lab_stat_cap`, `:134`).
- **Decisión mía:** las stats nuevas no entran en el árbol del laboratorio por ahora.
- El esquema y los presupuestos deben aceptarlas sin exigir nodos.

### B3. Cinco armas nuevas (aprobadas por el propietario)

| Arma | Qué hace |
|---|---|
| Arpón magnético | Atraviesa al primer enemigo y lo arrastra hacia ti, golpeando a los que encuentra por el camino |
| Honda gravitatoria | Atrapa al enemigo más cercano y lo lanza contra los demás. Él es el proyectil y estalla al chocar. Contra élites y jefes solo les hace daño, no los lanza |
| Señuelo holográfico | Deja un holograma tuyo que atrae a los enemigos cercanos unos segundos y luego explota |
| Faro de fotones | Un láser largo que gira a tu alrededor sin parar, barriendo todo lo que toca |
| Mortero de racimo | Lanza un proyectil en parábola hacia donde vas. Al caer se divide en bombitas |

- **Cada arma es un tipo nuevo** (`WEAPON_KINDS`), con su lógica en `systems/weapons.ts` o `systems/arsenal.ts`, su dibujo en `stage.ts`, sus partículas, el sprite del disparo y su icono de 12×12. La guía es la skill `galaxy-habilidad`.
- **Cada una tiene una evolución dorada**, que necesita una pasiva que hoy no use ninguna evolución.
- **Emparejamiento propuesto** (decisión mía, ajustable):

  | Arma | Pasiva necesaria | Evolución |
  |---|---|---|
  | Arpón magnético | Propulsores | «Arpón de remolque» |
  | Honda gravitatoria | Repulsor | «Catapulta de singularidad» |
  | Señuelo holográfico | Deflector | «Legión de espejismos» |
  | Faro de fotones | Inercia | «Faro binario» |
  | Mortero de racimo | Cazanúcleos | «Mortero de asedio» |

- Las armas nuevas no son iniciales de ninguna sonda: no tienen variantes de nivel 4 y 8 ni arte de hangar.
- **Al entrar en la bolsa común de ofertas, diluyen las demás:**
  - se mueven las partidas de referencia (`golden`, `recording`) y la calibración;
  - se actualizan los tests que fijan el número de armas (`upgrades.test.ts:125-131`, `content.test.ts`);
  - se actualiza el orden del bot (`bot.ts:116-117`).
  - Sube `SIM_VERSION`.

### B4. Tres formas por Núcleo (decisión del propietario: tres formas en orden)

- Cada uno de los 6 Núcleos tiene 3 formas: la de hoy y 2 nuevas. En total, 12 formas nuevas.
- **Cada forma nueva cambia lo que se ve y lo que hace:**
  - silueta y paleta propias;
  - al menos un ataque que la forma anterior no tiene;
  - su propio nombre.
- **Orden de aparición en un sector:**
  - capa 1: forma 1; capa 2: forma 2; capa 3: forma 3;
  - las capas del Eco Profundo (4, 8, 12…) no cuentan para la rotación; en las demás vuelve a empezar;
  - la fuerza sigue subiendo por capa como hoy (`scaling`).
  - Con Eco Profundo cada 4 capas, la forma de la capa L es `((L−1) − floor((L−1)/4)) mod 3`. Ejemplo: L5 → forma 1 y L6 → forma 2.
- **El Eco Profundo también tiene 3 formas**, que rotan según cuántas veces ha salido: forma 1 en la capa 4, forma 2 en la 8, forma 3 en la 12.
- **Fisura de la Señal** (el sector de temporada) no tiene Eco Profundo: sus formas rotan en todas las capas.

**Datos**
- Cada sector lleva un campo nuevo `bossCycle: string[]`, que por defecto es `[boss]`, para que el contenido vivo siga validando.
- El Eco Profundo lleva su ciclo en `deepBoss`.
- Las formas nuevas son entradas nuevas en `bosses[]`. El límite es 32 (`schema.ts:377`).
- `bossDef()` (`systems/boss.ts:16-20`) elige la forma. Sube `SIM_VERSION`.
- La regla de verosimilitud de un jefe por capa (`plausibility.ts:40-44`) no cambia.

**Ataques**
- Las 12 formas pueden combinar los 8 tipos de ataque de hoy con valores distintos.
- **Decisión mía:** además se añaden 3 tipos de ataque nuevos, con su aviso en `warnings.ts`:
  - un barrido de láser que gira, avisado antes;
  - un anillo que se cierra hacia el jugador;
  - zonas marcadas en el suelo donde caen proyectiles.
  - Así «un ataque nuevo» se nota de verdad.
- El diseño exacto de cada forma es cosa del constructor.

**Arte**
- Sprites de 40×40 a 2 fotogramas, como los de hoy (`arena/sprites/bosses.ts`; la Colmena está en `fauna.ts`).
- **Decisión mía:** se dibujan con más detalle siguiendo el método de los sprites de la tienda: generador, revisión en Aseprite y hoja de aprobación. En el juego se cargan como las de hoy.
- El propietario aprueba la hoja de las 12 formas antes de publicar.

**Otras pantallas**
- El Códice muestra las 3 formas de cada Núcleo; las que aún no has visto salen ocultas.
- `copy.arena.radio.bosses` lleva un aviso por forma.
- La tarjeta del sector y `WherePanel` siguen mostrando la forma 1.

### B5. Publicación

- El contenido de B1–B4 llega a los jugadores con **una sola publicación de `content`** en PRE, que se prepara partiendo de lo vivo.
  - Va en una carpeta de `ops/launch/` con su `LEEME.md` y su copia `antes/`.
  - Se publica con el OK del propietario (skill `galaxy-publicar-config`), con un aviso en Noticias que explica los cambios.
- Los cambios de fórmula (daño de los jefes) llegan con el despliegue, porque son código. Su efecto es pequeño: multiplicadores de 1,00 a 1,12.

## 6. Bloque C: perfil y cosméticos

### C1. Desplegables propios

- Un solo componente, `ui/Select.tsx`. Sigue el patrón accesible de WAI-ARIA de «combobox de solo selección», con lista desplegable.
  - **Teclado:** flechas, Inicio y Fin, buscar al escribir, Intro y Escape.
  - Se coloca dentro de la pantalla y funciona dentro de `Dialog`.
  - Usa los sonidos (`ui-sfx.ts`, ya incluye `[role="option"]`) y el cursor del juego.
- Sustituye **todos** los `<select>` nativos del juego y del admin, unos 25 sitios. La lista está en la investigación de esta sesión: Filters, AutoFusion, Mercado, Sala, Amigos, Misiones y todo el admin.
- **Decisión mía:** las 2 fechas del admin (`AuditScreen.tsx:35` y `ConfigForm.tsx:157`) también pasan a un selector propio de fecha y hora. Los deslizadores (`range`) no son desplegables y se quedan.
- **Tests:**
  - una ayuda de test sustituye `userEvent.selectOptions` en los tests web que lo usan;
  - se cambian los 3 `selectOption` de los e2e (`admin-moderation.spec.ts:132`, `mail.spec.ts:65` y `:77`).

### C2. Cosméticos y «Personalizar»

**Qué hay hoy**
- La tabla `galaxy.cosmetics(account_id, kind in ('title','frame'), value)`, y las columnas `accounts.title` y `accounts.frame`.
- Los 6 marcos son anillos de CSS (`bronze`, `silver`, `gold`, `nebula`, `abyss` y `crown`).
- Los títulos son texto libre que dan los logros, la temporada, el catálogo y el corrimiento al rojo.
- El avatar es una figura generada a partir del nombre (`hub/Avatar.tsx`).
- Todo se elige con dos `<select>` en Misiones › Logros.

**Lo que se construye**
- **Inventario.** La tabla `cosmetics` admite también `avatar`, y se añade la columna `accounts.avatar`.
  - Los avatares de serie los tiene todo el mundo, sin filas.
  - Los ids de los marcos de hoy se conservan, así siguen valiendo todas las recompensas ya dadas y configuradas.
- **Catálogo en la configuración viva.** Una clave nueva, `cosmetics`, con cada pieza:
  - id, tipo, nombre y rareza (común, rara, épica o legendaria);
  - si está animada;
  - de dónde sale (de serie, por jugar o de la tienda) y el texto de cómo conseguirla.
  - Así el admin puede renombrar, apagar o cambiar textos. El arte vive en el código y se busca por id.
  - Los valores por defecto son el lote de estreno, así que entra en vigor al desplegar.
- **Títulos con estilo.** Los títulos de pago y los legendarios tienen un estilo propio (color o brillo animado), definido en el catálogo. Los títulos de texto que ya se han dado siguen valiendo.
- **Recompensas.** El tipo `avatar` se añade donde hoy se dan títulos y marcos:
  - logros, ruta, tienda, cierre y podio de temporada, y catálogo;
  - también los eventos, que hoy no pueden dar cosméticos;
  - y la concesión manual desde el admin.
- **«Personalizar».** El propietario lo quiere en el perfil, con ese nombre y como un inventario con vista previa.
  - En tu propio perfil (`/perfil/:usuario`), un botón «Personalizar» abre un panel con pestañas: Avatar, Marco, Título y Banner.
  - Cada pestaña es una rejilla de piezas con su vista previa (animada si la pieza lo es) y una vista previa en vivo de la cabecera de tu perfil.
  - Lo que no tienes sale bloqueado, con cómo conseguirlo. Lo de la tienda lleva a `/tienda?pestana=estilo`.
  - Se guarda con «Guardar».
  - «Tu título y tu marco» desaparece de Misiones › Logros.
- **Avatar con marco en todas partes:**
  - barra de arriba, rankings y podio, chat y clan;
  - lista de amigos y tarjetas de la sala multijugador.
- **El título**, bajo el nombre en el perfil, en la tarjeta de la sala y en el ranking.
- **Tipos de la API que lo llevan:** `MeResponse`, `LeaderRow`, `FriendEntry`, `ChatMessage.author`, `RoomMember`, `Profile` y los miembros del clan.
- **Decisión mía:** quien no ha elegido avatar sigue viendo su figura generada, que además aparece en el inventario como «Tu firma».

### C3. Arte del lote de estreno (decisión del propietario: lote mediano y avatares mezclados)

**Avatares**
- **12 de serie:** tripulantes (pilotos, androides y alienígenas).
- **12 exclusivos para ganar jugando:**
  - los 6 retratos de Núcleo, que se consiguen al vencer por primera vez a cada uno (cualquier forma);
  - 6 más repartidos entre logros, catálogo, temporada y eventos. El constructor propone el reparto en la hoja.

**Marcos**
- Los 6 de hoy, redibujados en pixel art con los mismos ids.
- 6 nuevos para ganar jugando.
- Los comunes son estáticos. Los épicos y legendarios llevan un brillo animado (decisión del propietario).

**Tienda:** 4 avatares, 4 marcos y 4 títulos, la mitad animados.

**Técnica**
- Pixel art con Aseprite, a escala entera.
- **Decisión mía:** avatares de 32×32, mostrados a 32, 64 o 96 px. Los tamaños de hoy (40 px en la barra de arriba) se ajustan a esos.
- El marco se dibuja alrededor del avatar.
- Las tiras se cargan con `import.meta.glob(..., { query: '?no-inline' })`.
- Con movimiento reducido se ve el primer fotograma.

**Aprobación:** el propietario aprueba la hoja completa antes de publicar.

### C4. Banner de galaxia (decisión del propietario: solo en el perfil)

**Elegir el banner**
- En «Personalizar › Banner» eliges cualquier galaxia de tu colección, con los filtros de la colección.
- Se guarda en la columna `accounts.banner`, que apunta a `galaxy.galaxies(id)` y queda vacía si se borra la galaxia.
- Si la galaxia deja de ser tuya (venta, intercambio o fusión), no se muestra y se borra.

**Cómo se ve**
- En la esquina superior del perfil: oscuro, difuminado, moderno y minimalista.
- Se ve en tu perfil y en el de los demás.
- El arte sale de `useGalaxyImage` o de `loadRender` con `composeInto`.
- El difuminado se hace una sola vez en un canvas (`ctx.filter`), no con `backdrop-filter` encima de capas animadas.

**Tema de acabado**
- Si la galaxia tiene acabado (holo, prismático, relieve braille, corrupto o fisura), toda la página del perfil lleva una versión suave de ese acabado: brillo holo, irisado, puntos, líneas de barrido o deriva de la fisura.
- Debe verse épico y único, pero sin estorbar: los paneles con información conservan su fondo sólido y su contraste.
- Las reglas de hoy dependen de `.gcard` y de `cqw`. Para la página hacen falta reglas propias con tamaños en px.
- Con movimiento reducido, todo es estático.

### C5. Cosméticos de pago (decisión del propietario: catálogo fijo con novedades)

**La pestaña «Estilo» en `/tienda`**
- Siempre muestra las mismas piezas. El propietario añade novedades cuando quiere. Sin cuentas atrás ni rotación.
- Cada pieza tiene su vista previa animada.
- Si ya es tuya, pone «Ya es tuya».

**Producto `cosmetic`**
- Es un tipo nuevo de producto en `shop`, que entrega una pieza (`{ kind, id }`) en vez de recursos.
- Cuesta de 0,99 a 2,99 € (`priceCents` y `stripePriceId`) y se compra una vez por cuenta.
- No le aplica el bonus de primera compra.
- Cuenta para el límite diario.
- Tras pagar, se celebra mostrando la pieza.

**Devoluciones y contracargos**
- Se quita la pieza; si la llevabas puesta, se quita también.
- Bloqueo y aviso, como con los recursos.

**Pasos del propietario (como en F6)**
- Crear en Stripe un precio por pieza: 12 precios.
- Dar el OK a la publicación de `shop` con las piezas.

## 7. Decisiones del propietario (sesión del 2026-11-12)

| Tema | Decisión |
|---|---|
| Orden | Arreglos rápidos, después combate, después perfil |
| Botón del escáner | «¡Escanear otra!» (y «¡Escanear otras 10!» tras escanear 10, pagando igual que la vez anterior) |
| «Colección» | Fondo violeta |
| Sin saldo para escanear | Botón apagado que dice cuánto falta |
| Indicadores de compañeros | Flecha, nombre y vida; late en rojo si está caído |
| Avatares | Mezcla: tripulantes de serie; criaturas, Núcleos y sondas como exclusivos |
| Marcos | Animados solo los raros |
| Cosméticos de pago | Sí, algunos exclusivos (avatares, marcos y títulos, animados o estáticos), de 0,99 a 2,99 €. La mayoría se gana jugando |
| Desplegables propios | En todo el juego y el admin |
| Banner | Solo en el perfil |
| Avatar, marco y título | En todas partes |
| Catálogo de la tienda | Fijo, con novedades |
| Dónde se personaliza | En el perfil, botón «Personalizar», como un inventario con vista previa. Se quita de Misiones › Logros |
| Jefes | Tres formas en orden por capa |
| Dificultad | 5 / 15 / 30 y cada sector más difícil |
| Armas y pasivas | Las 5 y 5 propuestas, sin cambios |
| Lote de estreno | Mediano |

## 8. Decisiones mías, para que las revise el propietario

1. En grupo, el sprite de un compañero parpadea en rojo cuando recibe daño, y los sonidos personales (subir de nivel, recoger y acelerón) solo suenan si son tuyos.
2. Las cuentas para pegar algo al borde de la pantalla se unifican en una función. Se arregla la dirección de la baliza cuando la cámara sigue a un compañero.
3. «Añadir amigo» también en la lista del equipo de los resultados en grupo.
4. La vida de los jefes del código se iguala al «Bosses Buff» de PRE, para que la calibración mida la realidad.
5. Las stats nuevas no entran en el laboratorio por ahora.
6. Emparejamiento de evoluciones de la tabla de B3.
7. Tres tipos de ataque de jefe nuevos; el Eco Profundo también tiene 3 formas.
8. Los sprites de las formas siguen el método de los de la tienda, con hoja de aprobación.
9. Una sola publicación de contenido al final del bloque B, con aviso en Noticias.
10. Las fechas del admin también tienen selector propio.
11. Catálogo de cosméticos en la configuración viva (`cosmetics`). Los ids de los marcos de hoy se conservan y la figura generada se queda como «Tu firma».
12. Avatares de 32×32 a escala entera.

### Aprobación y revisión del constructor

**Aprobación.** El 2026-11-12, el propietario aprobó este documento y todas las decisiones de esta sección: «tienes autonomía al 100 %… yo te apruebo todas las decisiones». Se ejecuta sin esperar más revisión. Las decisiones nuevas que salgan al construir se apuntan aquí o en el `.ledger.md` del bloque.

La revisión del constructor dejó cuatro preguntas. Las resuelvo así:

13. **«Bosses Buff».**
    - La vida que el propietario puso a mano es la base de la forma 1 de cada Núcleo en la capa 1, y no se baja.
    - Si la calibración no llega a las bandas, primero se ajustan:
      - el `scaling.hpPerLayer` de cada jefe (hoy 0,5);
      - el multiplicador de las formas 2 y 3;
      - las oleadas, la densidad y el escalado de la fauna.
    - Solo como último recurso se toca la vida base, nunca más de un 15 %, y se apunta en el `.ledger.md`.
    - Las formas nuevas parten de la vida de su forma 1.
    - B5 publica la vida que salga de aquí, partiendo de lo vivo.
14. **Quien empieza en el Sector 1.**
    - Muere hacia el minuto 5. Pero en al menos la mitad de las partidas llega al primer Núcleo, y en al menos 1 de cada 4 lo vence.
    - Así ve cómo se extrae y no se encuentra un muro.
    - La calibración lo comprueba con los eventos `bossSpawn` y `bossDown` del bot.
15. **Recompensas con efecto retroactivo: sí.**
    - Quien ya venció a un Núcleo recibe su retrato. Se calcula desde `galaxy.runs`, como hace el Códice: por sector, y el Eco Profundo por haber llegado a la capa 4 venciendo.
    - Quien ya cobró un logro, un tramo de temporada o un premio del catálogo que ahora da un avatar, lo recibe.
    - Se hace una sola vez, con un trabajo de la CLI que se puede repetir sin dar nada dos veces, y se lanza en PRE tras el despliegue.
16. **El retrato del Núcleo de la Señal** solo se puede ganar mientras su sector de temporada está abierto. Se acepta como exclusivo de temporada.

## 9. Lo que se deja al constructor

- Nombres de las formas, las evoluciones y las piezas; números exactos de armas, pasivas, topes y fórmulas; diseño de cada ataque.
- Estructura interna de los componentes, nombres de las rutas nuevas de la API y forma de las migraciones, siguiendo los patrones del repositorio.
- Partir o juntar los PR de una fila de la tabla si así es más claro, siempre en el orden de los bloques.

## 10. Lo que haría que esto fracasase aunque funcione

- **Pagar para ganar:** los cosméticos son solo visuales.
- **Patrones oscuros:**
  - cuentas atrás o rotaciones que metan prisa;
  - empujar a la tienda desde el escáner;
  - precios que no son los cobrados.
- **Un perfil con acabado que no se puede leer.**
- **Un Sector 1 que frustra a quien empieza.**
- **Desincronizar el grupo** por un cambio de la simulación sin subir `SIM_VERSION`.
- **Perder el «Bosses Buff» o los retoques del panel** por publicar desde los valores por defecto.
- **Romper el contenido vivo** con un esquema que lo rechace.

## 11. Documentación que se actualiza

- `docs/GDD.md`: perfil y cosméticos, tienda de cosméticos, jefes por capa, dificultad, armas y pasivas.
- `docs/DESIGN_SYSTEM.md`: `Select`, indicadores, «Personalizar», banner y temas de acabado.
- `docs/CONTENIDO.md` y las skills `galaxy-habilidad` y `galaxy-enemigos-sectores-sondas`: tipos de arma, stats y `bossCycle`.
- `docs/DEPLOY_PRE.md`: subidas de `SIM_VERSION`.
- La memoria del proyecto.
