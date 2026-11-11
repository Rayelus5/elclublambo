# Galaxy Survivor · Documento de diseño (GDD)

> Versión 1 · 2026-11-06 · Rama `feature/galaxy-survivor`.
> Sale del brainstorming sobre `BRIEF.md`. Ese archivo sigue siendo válido en lo que este documento no cambia; donde se contradicen, manda este.

**Cómo leerlo.** Cada decisión lleva su origen:
- **[U]** la decidió el usuario y no se cambia sin preguntarle.
- **[D]** es una decisión de diseño tomada durante el brainstorming con su visto bueno general; se puede ajustar con criterio si la implementación lo pide, y los números marcados como *de partida* se calibran con simulación.
- **[C]** queda al criterio de quien construye, dentro de las restricciones del documento.

---

## 1. Qué es y por qué

Galaxy Survivor es un juego web de escritorio, sin web3, que une tres ganchos alrededor de un solo objeto: **la galaxia braille** generada por el motor de ElClub Nebula.

1. **La tirada.** Un gachapón genera en el momento una galaxia única. Da la incertidumbre de lo aleatorio, el coleccionismo y estatus dentro del grupo.
2. **La incursión.** Un survivor de 5 a 20 minutos: empiezas siendo nadie en un sector hostil y acabas arrasando gracias a tus mejoras y a tus reliquias. Cada partida es distinta.
3. **El hogar.** Una estación-observatorio que crece contigo, desde la que gestionas todo y que trabaja un poco mientras no estás.

Las tres partes se empujan entre sí: las galaxias del gachapón son las reliquias que te hacen fuerte en la incursión y lo que expones en la estación; la incursión trae los recursos para tirar más y para mejorar la estación.

**Premisa.** La Estática, una corrupción de datos, devora la Nebulosa ElClub e infecta su fauna. El ECN transcribe el cielo a braille para salvarlo. Eres operador de una estación del ECN: envías tu sonda a sectores del cielo a rescatar galaxias antes de que desaparezcan. Tirar del gachapón es, dentro de la ficción, transcribir una galaxia a tiempo.

### 1.1 Jugadores y éxito

- **Primeros jugadores [U]:** amigos del usuario, de 16 a 30 años, en PRE (`pre.elclub.party/galaxy`).
- **Ambición [U]:** si el juego se siente espectacular, vivo y profesional, abrirlo al público. Referentes de calidad: PokéBonk y PokeSurvivor; esencia del género: Vampire Survivors.
- **Éxito [U]:** que sea adictivo y tenga sentido real: metas claras, rejugabilidad, builds variadas, colección que apetece completar.
- **La beta [U]:** es el juego **completo y algo pulido**, no una versión recortada. Los amigos entran cuando estén todos los hitos.

### 1.2 Objetivos

- Un bucle diario con sentido: incursiones como centro, gachapón como premio, estación como base.
- Variedad real de enemigos, jefes, armas y builds, para que haya estrategia.
- Galaxias que se sienten valiosas: cartas tipo TCG con 3D, holográficos y reverso en braille en relieve.
- Lore profundo pero opcional.
- Un panel de admin con control total.

### 1.3 No objetivos

- ~~Pagos con dinero real de cualquier tipo~~. **Cambiado por el propietario (2026-11-11) [U]:** hay una tienda de recursos con dinero real (§11.5). Sigue sin venderse nada del escáner: ni señales ni tiradas.
- Móvil, tableta o idiomas distintos del español **[U]**.
- Cooperativo en la beta: el juego se prepara para él, pero no se entrega **[U]**.
- Exponer o usar las 1.000 piezas de la colección NFT: las galaxias se generan en vivo **[U]**.

### 1.4 Antiobjetivos (fracaso aunque funcione)

- **Combinaciones de pasivas rotas** que hagan trivial el juego **[U]**.
- **Farmeo infinito**, desde el idle o a base de jugar incursiones sin parar **[U]**. Se frena con §10 y §11.3 bis.
- **Mercado explotable**: duplicados, dobles compras, trasvase entre cuentas falsas **[U]**.
- Que el hogar dé más que las incursiones **[U]**.
- Muros de texto y lore impuesto al jugador normal **[U]**.
- Interfaz con aspecto genérico o de IA (regla del proyecto, `INSTRUCCIONES_PROYECTO.md`).

## 2. Restricciones

- **Plataforma [U]:** solo escritorio, puntero fino, mínimo 1280×720, y **adaptado a pantallas anchas** (de 16:10 a ultrapanorámicas). Solo español.
- **Entorno [U]:** solo PRE de momento, base de datos del Supabase autoalojado de PRE (esquema `galaxy`, ver §18).
- **Cuentas [U]:** usuario + contraseña, sin email.
- **Proceso (regla del proyecto):** TDD estricto con Superpowers; todo frontend pasa antes por ui-ux-pro-max; prohibidos los estilos genéricos de IA.
- **Arte [U]:** pixel art para sonda, enemigos, estación y efectos; galaxias en braille; interfaz moderna. Sprites hechos en **Aseprite** (instalado, con servidor MCP `aseprite`), generados por código y packs CC0.
- **Audio [U]:** sintetizado por código con WebAudio.

---

## 3. El bucle

### 3.1 Una sesión típica [U+D]

1. Entras en `/galaxy` y aparece la **pantalla de título** (§4).
2. **Jugar** te lleva al último modo que usaste. **Supervivencia** abre la elección de sector; **Hogar**, la estación.
3. Lanzas incursiones. Traes monedas, polvo estelar, material en bruto y, rara vez, señales de galaxia o fragmentos de transmisión.
4. En la estación recoges lo refinado, mejoras módulos y el laboratorio, tiras del gachapón, gestionas reliquias y colección, comercias.
5. Las misiones diarias, el evento activo y la clasificación de temporada te dan metas cortas; el Catálogo ECN, la profundidad y los Núcleos, metas largas.

### 3.2 Metas del jugador [D]

- **Corto plazo:** misiones diarias, evento, la siguiente tirada, la siguiente capa.
- **Medio plazo:** la ruta de temporada, la clasificación, desbloquear sondas, ampliar ranuras, reparar la estación.
- **Largo plazo:** completar el **Catálogo ECN** (álbum de tipos, paletas, fenómenos y acabados), llegar a **sectores más profundos**, **purgar los Núcleos de la Estática** (jefes de sector y de temporada) y el prestigio opcional **«Corrimiento al rojo»** (§12.5).

---

## 4. Pantalla de título y navegación

Referencia visual aprobada: `.superpowers/brainstorm/1011-1793971787/content/titulo-v2.html` (demo; ver §17).

- **Fondo [U]:** galaxias braille grandes y animadas sobre una escena pixel art (cielo con nebulosa tramada, planeta, la estación con su haz de escaneo, sondas y cometas). La interfaz se distingue claramente del fondo.
- **Columna izquierda [U]:**
  - título animado (con «Galaxy Survivor» escrito en braille debajo);
  - **Jugar**, grande y lo más llamativo, retoma el último modo;
  - al lado, apilados, **Supervivencia** y **Hogar**;
  - tarjeta del **evento activo** y tarjeta de **misiones**;
  - accesos: Colección, Sondas, Logros, Clan, Ranking, Códice;
  - Ajustes y Guía.
- **Columna derecha [U]:** clasificación de la temporada con pestañas (General, Profundidad, Purgas, Clanes), podio, tu fila, tramos de premios y «Ver clasificación completa».
- **Barra superior [U]:** perfil (avatar, nombre, nivel), polvo estelar, monedas, señales de galaxia, buzón de noticias, Comunidad (chat global) y Salir. A la izquierda, accesos al Escáner profundo (con aviso de tirada gratis) y al Mercado.
- **Cooperativo [D]:** acceso visible pero bloqueado, con la etiqueta «En desarrollo».

---

## 5. Incursiones (el núcleo)

### 5.1 Estructura [D]

1. **Antes de salir (Hangar):** eliges sector y sonda y te equipas las galaxias-reliquia (§8.4).
2. **Núcleo del género:** te mueves; la sonda dispara sola. Los enemigos sueltan **fragmentos de datos** (experiencia). Al subir de nivel eliges **1 de 3** mejoras: un arma nueva de la sonda o una pasiva de partida. Algunas combinaciones de arma + pasiva, o arma + elemento de tus reliquias, **evolucionan** el arma.
3. **Capas:** el sector se divide en capas de **~5 minutos** *(de partida)*. Cada capa termina con un **Núcleo de la Estática** (jefe). Al vencerlo se abre una **baliza de extracción durante 60 s**: llegas y aguantas dentro de su radio ~8 s *(de partida)* mientras la oleada aprieta, y extraes. Si la ignoras, bajas a la siguiente capa.
4. **Sin límite de tiempo [U]:** la dificultad sube hasta que caes. 1 capa ≈ 5 min, 4 capas ≈ 20 min, y sigue.
5. **Botín [U]:** extraer = 100 % del botín; morir = 50 %. Cada capa más profunda multiplica el botín *(de partida: ×1, ×1,5, ×2,2, ×3, +0,8 por capa)*.

### 5.2 Controles [D]

- Movimiento con WASD o flechas; ataque automático.
- Apuntado manual con el ratón **opcional** (conmutador en ajustes).
- Soporte de mando.
- Pausa en cualquier momento (en solitario).

### 5.3 Armas, pasivas y evoluciones [D]

- **Contenido de la beta *(de partida)*:** unas **16 armas** de sonda y unas **20 pasivas de partida**, con evoluciones definidas.
- El catálogo concreto (nombres, números y evoluciones) es **[C]**, con estas reglas: cada arma tiene un papel distinto (área, perforación, órbita, rastro, rebote, invocación…), y las evoluciones exigen nivel máximo del arma.

### 5.4 Elementos y reacciones [D]

- Las **paletas** de las galaxias dan elementos (§8.3).
- Cuando dos elementos coinciden sobre un enemigo se produce una **reacción**. Ejemplos:
  - corrosión + descarga = cortocircuito en cadena;
  - quemadura + ralentización = choque térmico que rompe blindajes.
- La tabla completa de reacciones es **[C]**: todas útiles, ninguna dominante, todas sujetas a los frenos de §8.6.

### 5.5 Enemigos, jefes y sectores [D]

- **Fauna cósmica infectada por la Estática [U].** Cada familia tiene un papel distinto que exige una respuesta distinta:
  - enjambres;
  - embestidas avisadas;
  - tiradores con patrones;
  - los que se dividen al morir;
  - blindados (vulnerables por la espalda o a ciertos elementos);
  - los que curan o corrompen a otros;
  - invocadores.
- **Élites [D]:** enemigos con **modificadores de Estática** (escudo, prisa, explosión al morir…).
- **Jefes [D]:** los Núcleos de la Estática, con fases y patrones anunciados.
- **Sectores [D]:** cada uno tiene su bioma, terreno, fauna propia y jefe. Los sectores más profundos son la meta de clasificación por profundidad.
- **Contenido de la beta *(de partida)*:**
  - 4 sectores normales y 1 de temporada;
  - unos 24 tipos de enemigo en 6 familias;
  - 5 jefes de sector y 1 de temporada.

  El diseño de cada uno es **[C]**.

### 5.6 Dificultad [C]

- La curva sube por tiempo y capa: densidad, élites, velocidad y nuevas familias.
- Se calibra con simulación (bots que juegan con builds tipo) para que una partida normal llegue a la capa 2–4 en el rango de 5 a 20 minutos.

### 5.7 Preparado para el cooperativo [U+D]

- La simulación (`packages/sim`) es determinista, de paso fijo a 60 Hz, con RNG con semilla.
- Desde el primer día admite **N sondas** y se alimenta de **comandos de entrada por tick** por jugador.
- Se graban las entradas de cada partida, lo que permite:
  - reproducir la partida;
  - verificarla contra trampas (§14.7);
  - añadir el cooperativo por red sin rehacer la simulación.
- El cooperativo por red ya existe: las partidas en grupo (§14.8) usan esta misma simulación en *lockstep*.

---

## 6. Sondas (los personajes)

- **Sondas [U]:** son los personajes. Cada una tiene su sprite pixel art, un arma inicial, una estadística fuerte y una peculiaridad. Por ejemplo, una exploradora rápida y frágil, una blindada y lenta, o una que empieza con un dron.
- **Contenido de la beta *(de partida)*:** 8 sondas **[D]**.
- **Sonda inicial por test [U]:**
  - Al crear la cuenta respondes un test de personalidad de **5 preguntas con 3 respuestas** cada una.
  - Cada respuesta suma puntos a una de las **3 sondas iniciales**, que están **equilibradas**: distinta táctica, ninguna mejor.
  - No eliges la sonda: la descubres.
  - El resultado se presenta como un perfil («eres de los que…») con la sonda revelada **[D]**.
  - Si hay empate, una pregunta extra desempata **[D]**.
- **Sin repetir [U]:** te quedas con esa sonda hasta desbloquear otras.
- **Desbloqueos [D]:** el resto de sondas se ganan jugando (jefes, profundidad, logros). **Nunca salen del gachapón.**
- **Mejoras [D]:**
  - **Hangar:** cada sonda tiene **nivel 1–10** y lo sube con componentes y monedas.
  - **Qué da cada nivel:** pequeñas mejoras de sus estadísticas. En los niveles 4 y 8 desbloquea una **variante de su arma inicial**.
  - **Laboratorio:** da mejoras permanentes comunes a todas las sondas.
  - **Freno:** los dos sistemas respetan los topes de §8.6.

---

## 7. Galaxias: generación

- **Generación en vivo [U]:** cada galaxia se genera al momento con el motor portado (§18.3), desde una semilla segura. La imagen y los datos son únicos.
- **Rasgos del motor:**
  - Galaxy Type: 8 valores;
  - Arms: 2–6, solo en espirales;
  - Size;
  - Inclination;
  - Core;
  - Star Density;
  - Palette: 11 valores;
  - Background: 5 valores;
  - Phenomenon: 8, más ninguno.

  Las reglas `requires`, `forbid` y `force` del motor se respetan.
- **Rareza coherente [U]:**
  1. Se sortea el nivel: Común, Poco común, Rara, Épica o Legendaria.
  2. Se generan rasgos hasta caer en la **banda de puntuación** de ese nivel. Las bandas se calibran con simulación offline, porque el ranking del NFT no sirve con suministro infinito.

  Lo raro se ve raro.
- **Acabado [U]:** se sortea aparte entre Normal, Holo, Prismático, Relieve braille y Corrupto (ultra-raro).
  - Probabilidades *de partida*: 85 / 10 / 3,5 / 1,3 / 0,2 %.
  - **Es solo estético [D]:** cuenta para el catálogo y el valor de mercado, no da poder.
- **Sello de origen [D]:** cada galaxia guarda la temporada en que nació.
- **Auditoría [U]:** cada tirada guarda semilla, pity y versión del motor.

## 8. Galaxias: cartas y reliquias

### 8.1 Cartas [U]

- Cartas coleccionables al estilo TCG.
- **En la rejilla:** inclinación y brillo con CSS 3D.
- **Al inspeccionarlas:** three.js, cargado solo entonces, con capas en profundidad, paralaje, shader holográfico y reflejos al mover el ratón.
- **El reverso** muestra la transcripción braille en relieve de la galaxia y sus estadísticas.

### 8.2 Poder según la rareza [U]

Las galaxias raras dan una **ventaja notable**: ataques más potentes, animaciones excepcionales y más aguante en la partida. Tener una muy rara se tiene que notar.

- Multiplicador de magnitud de la pasiva *(de partida)* **[D]**: Común ×1,0, Poco común ×1,15, Rara ×1,35, Épica ×1,6, Legendaria ×2,0.
- Las Legendarias garantizan un fenómeno.
- Las Comunes sirven para rellenar ranuras al principio, fusionar y desintegrar.

### 8.3 Rasgos → pasiva [D]

Tabla de partida, ajustable:

| Rasgo | Efecto en la reliquia |
|---|---|
| **Galaxy Type** → familia de la pasiva | Espiral: cuchillas orbitales · Barrada: rayo perforante · Elíptica: escudo · Lenticular: lente crítica · Irregular: efecto caótico · Anular: aura · Enana: recogida y velocidad · Fusión: copia otra reliquia equipada |
| **Arms** | Número de proyectiles o cargas |
| **Size** | Magnitud (radio y daño) |
| **Inclination** | Forma del efecto: de frente es circular, inclinada es un cono, de canto es una línea perforante |
| **Core** | Potencia: Faint < Bright < Quasar (añade un rayo) · Double Nucleus duplica el disparo |
| **Star Density** | Frecuencia |
| **Palette** → elemento | Solar Gold: quemadura · Andromeda Blue: ralentización · Terminal Green: corrosión · Ultraviolet: descarga · Amber CRT: hackeo (el enemigo lucha un rato a tu favor) · Crimson Nebula: robo de vida · Emerald Void: daño a escudos · Neon Synapse: rebotes encadenados · Monochrome: daño puro con más crítico · Prismatic: rota elementos · Antimatter: invierte proyectiles enemigos |
| **Background** | Bonus de entorno (recogida, visión, experiencia, suerte de botín, resistencia a la Estática) |
| **Phenomenon** → habilidad única | Supernova: nova periódica · Satellite: dron · Globular: orbes · Comet: embestida · Jets: láseres gemelos · Pulsar: ondas rítmicas · Einstein Ring: duplica proyectiles · Anomaly: efecto glitch impredecible |
| **Conjunto** | Bonus por combinaciones de rasgos entre reliquias equipadas, por ejemplo 3 de la misma paleta o tipo + fenómeno |

### 8.4 Ranuras [U]

- Empiezas con **2** ranuras y llegas hasta **6** desbloqueándolas.
- Las ranuras se desbloquean con hitos de progresión y polvo estelar **[D]**.

### 8.4 bis Nivel de las reliquias [D]

- **Nivel 1–10:** cada galaxia tiene nivel y lo sube con polvo estelar, con un coste creciente.
- **Potencia:** cada nivel suma *de partida* +4 % a la magnitud de su pasiva, con rendimiento decreciente y dentro de los topes de §8.6.
- **Visible en la carta:** el nivel se muestra en ella.
- **Comercio:** **el nivel viaja con la galaxia** al intercambiarla o venderla. El precio mínimo por rareza no cambia: el vendedor decide si cobra el nivel.
- **Fusión y desintegración:** al fusionar o desintegrar se devuelve *de partida* el 50 % del polvo invertido en niveles.
- **Nivel y rareza son independientes:** el nivel no cambia la rareza. La fusión es el único camino para subir de rareza.

### 8.5 Fusionar, desintegrar, exponer [U]

- **Desintegrar:** convierte la galaxia en polvo estelar. El rendimiento depende de la rareza y del acabado.
- **Fusionar:** varias galaxias dan una nueva de rareza superior, con semilla nueva y linaje guardado. La regla *de partida* es 5 de un nivel más polvo, que dan 1 del nivel siguiente **[D]**.
- **Exponer:** las galaxias se exponen en el planetario de la estación (§10).

### 8.6 Frenos contra combinaciones rotas [U+D]

- **Rendimiento decreciente:** el mismo efecto rinde menos cuanto más se acumula.
- **Topes por categoría:** velocidad de ataque, reducción de enfriamientos, robo de vida, número de proyectiles, etc.
- **Simulación de combinaciones antes de cada versión:** prueba miles de builds aleatorias más las extremas y marca las que superan umbrales de daño o supervivencia. Es un paso del CI de reglas.
- Estos frenos limitan que algo **rompa** el juego, no que una Legendaria brille.

---

## 9. Gachapón (Escáner profundo)

- **Bienvenida [U]:** las primeras tiradas tienen más suerte y la **primera Legendaria está garantizada en ≤10 tiradas**. El tutorial y la primera incursión dan esas tiradas, así que llega en **5–15 minutos** de juego.
- **Ritmo normal [U]:** una Legendaria cada **30 min – 2 h** de juego normal, según la suerte.
  - No empeora aunque crezca la colección, para no castigar a quien colecciona **[D]**.
  - *De partida:* ingresos de unas 10 tiradas por hora de juego; probabilidad base de Legendaria del 3 %; suerte creciente desde la tirada 8; garantía a la 20.
- **Suerte creciente y garantía [U]:**
  - **Suerte creciente:** si llevas muchas tiradas sin Legendaria, la probabilidad sube en cada tirada.
  - **Garantía:** a las X tiradas sale una Legendaria segura.
- **Gachapones de evento [U]:**
  - Tienen una galaxia o un rasgo destacado con probabilidad muy baja, garantizado a las **40–50 tiradas**.
  - La suerte acumulada se conserva entre eventos del mismo tipo **[D]**.
- **Transparencia [D]:** el jugador ve las probabilidades de cada nivel y su contador hasta la garantía.
- **Pago [U]:** con monedas, con boletos (señales de galaxia) o con la tirada gratis diaria.
- **Boletos [U+D]:**
  - Hay boleto normal y boleto de evento, que solo vale para su gachapón.
  - Se consiguen con misiones, logros, eventos, subidas de nivel y, rara vez, como botín.
  - **No se pueden intercambiar ni vender.**
- **Revelado: «escaneo de campo profundo» [D, del brief]:**
  - El terminal CRT barre la estática, suben las barras de señal y la galaxia se resuelve punto a punto.
  - El color de la línea de escaneo y el tono del sonido anticipan la rareza.
  - Si sale un fenómeno: «Fenómeno detectado».
  - Una Legendaria hace fallar la pantalla y suena un acorde.
  - Sello sonoro: el clac de una máquina Perkins de braille.
  - Tiradas múltiples (x10) con revelado en secuencia y opción de saltar.

---

## 10. La estación (Hogar)

**Papel [U]:** complemento, no fuente principal. Base con todas las herramientas de gestión; **farmeo AFK mínimo**; premia las incursiones.

1. **La base es el menú [D].** La estación se ve en corte lateral, en pixel art. Cada sala es una herramienta y abre su pantalla:

   | Sala | Función |
   |---|---|
   | Escáner profundo | Gachapón |
   | Planetario | Colección y galaxias expuestas |
   | Laboratorio | Árbol de mejoras permanentes |
   | Hangar | Sondas, armas iniciales y reliquias equipadas |
   | Colisionador | Fusionar y desintegrar |
   | Comunicaciones | Mercado, trueque y buzón |
   | Refinería | Procesa el material de las incursiones |
   | Antena | Goteo mínimo de señal |
   | Archivo | Códice |
   | Trofeos | Premios de temporada expuestos |

2. **Empieza rota [D].** Al principio la Estática ha corrompido casi toda la estación. Con componentes de las incursiones reparas y mejoras salas, y la base crece a la vista.
3. **Las máquinas procesan, no generan [D].**
   - De cada incursión traes **material en bruto**. La refinería lo convierte en **componentes** a lo largo del tiempo real.
   - El ritmo y la capacidad de la cola dependen del nivel de la refinería.
   - Sin incursiones no hay nada que procesar.
4. **Goteo mínimo [D].** La antena acumula algo de señal, cobrada con la hora del servidor. El tope *de partida* es de 8 h y la cantidad, pequeña: un premio por entrar cada día, no una fuente.
5. **Planetario visitable [D].**
   - Expones tus mejores galaxias y tus amigos pueden **visitar tu estación**.
   - Da como mucho un **bonus pequeño** (*de partida*: ≤5 % a algo secundario), nunca ingresos importantes.
6. **Laboratorio [U+D].**
   - Un **árbol de mejoras enorme**, con ramas de sonda, reliquias, estación y extracción.
   - Tiene muchos nodos pequeños con rendimiento decreciente.
   - Se paga con polvo estelar y componentes, y nunca rompe el equilibrio.

---

## 11. Economía

### 11.1 Monedas y recursos [D]

| Recurso | Sale de | Se gasta en |
|---|---|---|
| **Monedas** | Incursiones, sobre todo; misiones; ventas en el mercado; tienda (§11.5) | Tiradas, mejoras, compras en el mercado |
| **Polvo estelar** | Desintegrar galaxias; incursiones; tienda (§11.5) | Mejoras de reliquias, ranuras, fusiones, laboratorio |
| **Material en bruto → componentes** | Incursiones → refinería; componentes en la tienda (§11.5) | Reparar y mejorar módulos, hangar |
| **Señales de galaxia** (boletos) | Misiones, logros, eventos, niveles, botín raro | Tiradas |
| **Moneda de temporada** | Actividad de la temporada | Tienda de la temporada; lo que sobra se convierte en polvo con un cambio desfavorable |

### 11.2 Sumideros [D]

- Tiradas.
- Mejoras: sonda, reliquias, laboratorio y módulos.
- Fusiones.
- Reparaciones.
- Comisión del mercado.
- Conversión desfavorable de la moneda de temporada.

### 11.3 Reglas del servidor [U, del brief]

- **El servidor decide todo.**
- Cada acción de economía es una transacción con **clave de idempotencia**.
- Hay un **libro de movimientos de solo añadir** y los saldos nunca bajan de 0.

### 11.3 bis Rendimiento diario de las incursiones [U]

**Problema.** Sin límite, un jugador intenso podría sacar más de 100 tiradas al día. Eso inunda el mercado de galaxias y llena las 6 ranuras de Legendarias en días, justo los antiobjetivos de §1.4.

**Regla [U].** No hay energía, esperas ni coste de entrada: se puede jugar sin parar. Lo que baja, poco a poco, es el **premio económico** cuando alguien ya ha jugado mucho ese día.

1. **Qué cuenta [D]:**
   - Cada cuenta acumula al día su **tiempo de incursión**, la suma de la duración real de sus partidas.
   - El día se reinicia a las 00:00 hora de Madrid, calculado siempre en el servidor y con la zona explícita.
2. **Tramos *de partida* [D]:**

   | Tiempo jugado hoy | Monedas, boletos y material en bruto |
   |---|---|
   | 0–3 h | ×1 (completo) |
   | 3–4 h | ×0,75 |
   | 4–5 h | ×0,5 |
   | más de 5 h | ×0,25 (nunca baja de aquí) |

3. **Prorrateo [D]:** si una partida cruza un umbral, los minutos de antes cobran a la tarifa anterior y los de después, a la nueva. Lo calcula el servidor con la duración de la partida.
4. **Lo que nunca se recorta [U]:**
   - la experiencia;
   - la **puntuación de temporada**;
   - el Códice y los fragmentos de transmisión;
   - los logros y el Catálogo;
   - los récords de profundidad;
   - el progreso de misiones y eventos.

   Jugar mucho siempre sirve; solo deja de multiplicar la economía.
5. **Se explica en el juego [D]:**
   - Dentro de la ficción, es la **saturación del canal** de la estación.
   - Antes de lanzar una incursión, el jugador ve cuánto tiempo le queda con premio completo y en qué tramo está.
   - La pantalla de resultados muestra qué parte se pagó a cada tarifa.
   - Nada se recorta sin avisar.
6. **Ajustable [D]:** los umbrales, los multiplicadores y la hora de reinicio están en la configuración viva (§16.3).
   - Un evento puede ampliar el tiempo completo, por ejemplo durante un fin de semana.
   - El admin puede ver y ajustar el contador de cualquier cuenta.

### 11.4 Calibración [D]

- Los números de este documento marcados *de partida* se ajustan con una **simulación offline de la economía**: jugadores tipo (casual, normal, intenso) a lo largo de una temporada.
- Hay que cumplir tres cosas:
  - los tiempos del gachapón de §9;
  - que el idle sea menos del 10 % de los ingresos de un jugador normal;
  - que el rendimiento diario de §11.3 bis frene al jugador intenso sin castigar al normal, que no debería pasar de 3 h casi nunca;
  - que ningún bucle produzca más de lo que consume sin límite.
- Los parámetros viven en configuración editable (§16.3).

### 11.5 Tienda de recursos [U, 2026-11-11]

**Qué vende [U].** Monedas, polvo estelar y componentes por dinero real, cobrados con Stripe en modo real:
- 6 packs de cada recurso: cuanto más grande, mejor precio por unidad y más regalo;
- packs combinados y un pack de bienvenida, una vez por cuenta;
- **nunca señales del escáner**. Las monedas siguen comprando tiradas, como siempre.

**Ofertas [U].** Se pueden apagar todas:
- extra en la primera compra de cada pack;
- pack de bienvenida;
- ofertas por tiempo limitado, de «+X % de regalo» o de precio rebajado;
- packs combinados.

El precio tachado de una rebaja es el más bajo de los 30 días anteriores (directiva Ómnibus) y lo calcula el servidor; si no lo hay, no se tacha nada.

**Protecciones [U]:**
- límite de gasto diario por cuenta (día de Madrid);
- una casilla obligatoria al pagar: mayor de edad o con permiso, y renuncia al desistimiento por entrega inmediata;
- devolución o contracargo: se quita lo que quede de lo entregado (el saldo nunca baja de 0), se bloquea la tienda de esa cuenta y salta un aviso en el panel.

**Reglas del servidor [U]:**
- Todo es configuración viva (`shop`): productos, precios mostrados, precios de Stripe, ofertas y límites.
- La tienda nace cerrada y, al abrirse, primero solo para el staff.
- El servidor cobra con el precio de Stripe del producto, nunca con un importe del navegador, y comprueba que es el mostrado.
- Lo que da una compra se fija al abrir el pago y se entrega una sola vez cuando Stripe confirma el cobro (webhook firmado o consulta de la compra), sin multiplicadores ni topes.
- Desde la primera compra real, PRE ya no se borra (`ops/reset-beta.sql` se niega).

---

## 12. Progresión

### 12.1 Cuenta [D]

- **Nivel de cuenta:** se sube con experiencia de incursiones y misiones, y desbloquea funciones como el comercio y el chat.
- **Perfil:** avatar, título, marco, galaxias destacadas e historial de temporadas.

### 12.2 Primeros minutos (onboarding) [D]

1. Creas la cuenta.
2. Haces el **test de la sonda**.
3. Juegas una **incursión tutorial** de 2–3 minutos guiada por PERKINS.
4. Haces las **tiradas de bienvenida**, que traen la primera Legendaria.
5. PERKINS te enseña la estación: reparas la primera sala y equipas tu primera reliquia.

Cada paso enseña una sola cosa y se puede saltar si ya lo sabes. Hay además una **Guía** consultable en todo momento: capítulos con animaciones de ejemplo.

### 12.3 Misiones y logros [D]

- **Misiones:** diarias (3–5), semanales y de temporada, con recompensas por recoger.
- **Logros:** dan títulos, marcos y boletos.
- **Catálogo ECN:** premios por completar porcentajes del álbum.

### 12.4 Códice [U]

Ver §15.

### 12.5 Prestigio «Corrimiento al rojo» [D]

- Es opcional y se desbloquea muy tarde.
- Reinicia parte del progreso de la estación y del laboratorio a cambio de un bonus permanente pequeño y de cosméticos.
- **Nunca toca la colección.**
- El diseño concreto es **[C]**, con el freno del §1.4: que no se convierta en farmeo infinito.

---

## 13. Temporadas y eventos

### 13.1 Temporadas [U]

- **Duración:** unas 6 semanas. La Temporada 1 de la beta abierta dura 4, del 10 de noviembre al 8 de diciembre de 2026.
- **Se conserva:**
  - la colección completa;
  - las sondas y la estación;
  - el laboratorio;
  - monedas, polvo, boletos y la suerte acumulada;
  - los logros y el Catálogo;
  - el nivel y el clan;
  - el récord histórico de profundidad y el historial de temporadas.
- **Empieza de cero:**
  - la puntuación y la clasificación de la temporada;
  - el récord de profundidad de la temporada;
  - la **ruta de temporada**: escalera de premios gratuita que se sube jugando;
  - las misiones y la moneda de temporada, con la conversión de §11.1;
  - la clasificación de clanes.
- **Novedades de cada temporada:**
  - un **sector nuevo** con su fauna y su **Núcleo de temporada**;
  - una **anomalía global**: una regla que cambia el juego durante la temporada, por ejemplo «la corrosión se contagia entre enemigos»;
  - un **acabado exclusivo**, solo estético;
  - el **sello de origen** en las galaxias nacidas en ella.
- **Premios de cierre:**
  - por **tramos** de puntuación: Bronce, Plata, Oro, Platino y Estelar;
  - el **top 3** recibe además un trofeo para su estación y un marco único;
  - **salón de la fama** con las temporadas pasadas.
- **Contra abusos:** las partidas marcadas como sospechosas no suman, y comerciar o donar no da puntos.

### 13.1 bis Cómo se lanza una temporada [D]

- **Contenido como datos, desde M3a:**
  - Los sectores, enemigos, jefes, anomalías y acabados se definen como **datos**: catálogos versionados en la configuración viva.
  - Los enemigos se componen a partir de **comportamientos** programados: perseguir, embestir, disparar patrones, dividirse, blindarse, curar, invocar…
  - Los jefes, a partir de **patrones y fases** programados.
- **Desde el panel:** el admin puede abrir una temporada eligiendo en esos catálogos:
  - el sector, que puede ser una remezcla de terreno, fauna y jefe ya existentes;
  - la anomalía;
  - el acabado exclusivo;
  - la ruta y la tienda.

  No hace falta publicar código nuevo.
- **Contenido nuevo:** comportamientos, patrones de jefe o sprites inéditos llegan con una versión nueva del juego, que prepara Claude cuando el usuario la pide.
- **Para la beta:** se entrega la temporada 1 completa y un catálogo suficiente para que la 2 pueda lanzarse remezclando si el contenido nuevo no está listo.

### 13.2 Eventos [D]

- Eventos temporales con metas propias, por ejemplo «Lluvia de cometas: purga 40 cometas».
- Pueden traer un gachapón de evento, misiones, multiplicadores y eventos de clan.
- Se crean y programan desde el panel de admin.

---

## 14. Social

### 14.1 Clasificación [U+D]

- **Principal:** **puntuación general de la temporada**, la suma de los puntos de todas las estadísticas del jugador en la temporada **[U]**.
- **Qué suma [D]:** profundidad, Núcleos purgados, extracciones, misiones, logros y entradas nuevas del catálogo. Comerciar y donar no suman.
- **Pestañas [D]:** General, Profundidad, Purgas, Clanes y En grupo.
- **En grupo [D]:**
  - cada grupo (los mismos jugadores) sale una vez, con su mejor partida en grupo de la temporada;
  - el orden es la capa, después los Núcleos y después la más rápida;
  - los récords en grupo no cuentan en Profundidad ni en Purgas.

### 14.2 Perfiles y colecciones públicas [U]

- Cualquiera puede ver tu perfil y tu colección.
- Desde ahí se puede visitar tu estación (§10).

### 14.3 Clanes [U+D]

- **Qué hacen [U]:** chat entre miembros, intercambios, eventos de clan y donar recursos.
- **Límites [D]:**
  - máximo de unos 30 miembros;
  - las donaciones tienen tope diario y exigen una antigüedad mínima de la cuenta;
  - los eventos de clan son metas en equipo con premio para todos.

### 14.4 Chats [U+D]

- **Canales [U]:** chat global («Comunidad») y chat de clan.
- **Chat de sala [D]:** cada sala de partida en grupo tiene el suyo, con la misma moderación.
- **Moderación [D]:**
  - límite de mensajes por minuto;
  - nivel de cuenta mínimo para escribir (*de partida*: 5);
  - filtro de palabras editable por el admin;
  - botón de denunciar;
  - el admin puede ver y borrar mensajes, silenciar y banear.
- **Técnica [D]:** WebSocket servido por el contenedor `galaxy` (§18.1).

### 14.5 Trueque [U]

- Intercambio 1:1 confirmado por ambos.
- Lo ofrecido queda en depósito y cada trato tiene versiones: los dos confirman la misma.

### 14.6 Mercado [U]

- **De momento solo se venden galaxias.**
- **Precio mínimo por rareza**, impuesto por un *trigger*. Valores *de partida*: Común 50 · Poco común 120 · Rara 400 · Épica 1.500 · Legendaria 6.000 monedas.
- **Comisión de venta** como sumidero: *de partida*, 7 %.
- Bloqueo contra dobles compras.

### 14.7 Antiabuso del comercio y de las partidas [D]

- **Para comerciar** hacen falta nivel 10 y 3 días de cuenta.
- **Tope diario** de tratos y de anuncios.
- **Aviso al admin** cuando hay transferencias entre cuentas que comparten IP o huella, o cuando el valor es muy desequilibrado.
- **Partidas:**
  - El servidor entrega la semilla y una foto de las reliquias.
  - El resultado se envía una sola vez y pasa controles de plausibilidad.
  - Las partidas sospechosas se marcan y no puntúan.
  - Más adelante se verifican repitiendo la partida desde las entradas grabadas.

### 14.8 Partidas en grupo [U+D]

- **Quién [U]:**
  - de 1 a 4 jugadores;
  - se juega en grupo tras acabar o saltar el tutorial y con el nivel que fije el admin;
  - solo se entra antes de despegar;
  - basta con que el líder tenga abierto el sector.
- **Salas [U+D]:**
  - pública, solo amigos o privada, con código;
  - «Entrar rápido» busca una pública o la crea;
  - el líder despega cuando todos están listos.
- **Cómo se juega [U]:**
  - **Sin pausa:** 15 s para elegir carta; si no, sale una al azar.
  - **Caídas:** quien cae tiene 30 s para que lo reanimen quedándose encima; si no, queda fuera hasta la siguiente capa.
  - **Extracción:** se extrae cuando todos los que siguen en pie están en la baliza.
  - **Dificultad:** sube con el número de jugadores.
- **Botín y puntos [U]:**
  - el botín del grupo es entero para cada uno, rebajado según cuántos sean;
  - los puntos de temporada llevan su propio factor;
  - las partidas en grupo cuentan para las misiones y para la clasificación En grupo.
- **Red [D]:**
  - *lockstep* con registro sellado por el servidor;
  - un árbitro en el servidor simula la misma partida y decide el pago;
  - cada 5 s los navegadores comparan su huella con la del árbitro y, si no coincide, rehacen el mundo desde el registro.
- **En la partida [D]:**
  - avisos rápidos («Aquí», «Ayuda», «Baliza», «Cuidado»);
  - una cámara de espectador para quien queda fuera;
  - resultados por jugador, con la mejor cifra marcada.
- **Abandonos e inactividad [D]:**
  - quien abandona cobra lo que llevaba cuando la partida acaba, y le llega el resultado aunque se haya ido;
  - quien abandona a menudo espera antes de volver a jugar en grupo (límite, plazo y espera ajustables);
  - quien pasa la partida casi sin moverse queda marcado `coop_idle`: cobra el botín, pero no gana experiencia, puntos ni misiones.
- **Denuncias [D]:** desde los resultados, cada compañero se puede denunciar con un motivo y una nota (§16.4).

---

## 15. Historia y lore [U+D]

- **Profundo pero opcional [U].** El jugador normal no recibe muros de texto. Quien quiera más lo busca en el **Códice**.
- **En pantalla [D]:**
  - Solo hay mensajes de radio de **una o dos líneas** en momentos clave: el primer jefe, un sector nuevo o un fenómeno raro.
  - Se pueden saltar y nunca bloquean.
- **El Códice [U+D]:** son registros del terminal del ECN que se rellenan jugando.
  - **Bestiario:** cada entrada se desbloquea al derrotar suficientes ejemplares e incluye cómo combatir a la especie.
  - **Sectores, jefes y Núcleos.**
  - **Galaxias:** conectado con el Catálogo ECN.
  - **Personajes y crónica de la Nebulosa.**
- **Fragmentos de transmisión [D]:** botín raro que desbloquea entradas ocultas.
- **Temporadas = capítulos [D]:** cada temporada revela una parte del misterio de la Estática, y su jefe está ligado a ese capítulo.
- **PERKINS [D]:** la IA de la estación, con el nombre de la máquina de braille. Es la guía por radio: pocas palabras, algo de humor y sabe más de lo que cuenta.
- **Redacción [D]:** el lore lo escribe Claude y lo revisa el usuario.

---

## 16. Administración: control total

**Requisito [U]:** el admin controla **todo lo que el juego es capaz de hacer**, con un panel de control y moderación **completo**. Primer admin: el usuario `rayelus` **[U]**.

### 16.1 Roles y seguridad [D]

- **Roles:** superadmin (`rayelus`), admin y moderador. El moderador solo modera chats, denuncias y silencios.
- **Segundo factor:** las cuentas de admin usan TOTP. Es la protección más importante, porque el juego no tiene email.
- **Acciones destructivas:** piden confirmar la contraseña en el momento.
- **Registro de auditoría:**
  - cada acción escribe en `admin_audit_log`, en la misma transacción: quién, qué, antes y después, motivo e IP;
  - el registro no se puede editar;
  - el panel permite filtrarlo y exportarlo.

### 16.2 Jugadores [U+D]

- **Buscar** por nombre, IP, clan, etc.
- **Ver todo de un jugador:**
  - perfil e inventario;
  - libro de movimientos;
  - tiradas, con su semilla;
  - partidas, con la opción de reproducirlas;
  - tratos y anuncios;
  - mensajes de chat;
  - sesiones e IPs;
  - estación, laboratorio y sondas.
- **Editar todo:**
  - añadir o quitar monedas, polvo, componentes, boletos y moneda de temporada;
  - **conceder o retirar galaxias**, incluida la generación de una galaxia con rasgos, rareza y acabado elegidos;
  - contadores de suerte del gachapón;
  - sondas desbloqueadas;
  - estado de la estación y de los módulos;
  - nodos del laboratorio;
  - nivel y experiencia;
  - puntuación de temporada;
  - misiones, logros, títulos y marcos;
  - cambiar el nombre.
- **Cuentas:**
  - emitir **códigos de recuperación** de un solo uso;
  - cerrar sesiones;
  - silenciar;
  - **banear** de forma temporal o permanente, con motivo. Un ban cierra sesiones y cancela anuncios y tratos;
  - excluir de la clasificación;
  - marcar o desmarcar partidas.
- **Las correcciones de economía** se hacen con asientos compensatorios en el libro de movimientos, nunca borrando historia.

### 16.3 Juego y economía como configuración viva [D]

Todo parámetro del juego vive en **configuración versionada en base de datos**, validada con los esquemas Zod compartidos. El admin la edita desde el panel; cada cambio crea una versión nueva, y las tiradas y partidas guardan la versión con la que se jugaron. Abarca:

- **Gachapón:** gachapones, probabilidades, suerte creciente y garantía, galaxia o rasgo destacado, fechas, coste de tirada y tirada gratis.
- **Recompensas:** tablas de botín, multiplicadores por capa, curva de dificultad, recompensas de jefes.
- **Estación:** ritmos de la refinería y de la antena, topes AFK, costes de módulos y del laboratorio.
- **Galaxias:** rendimiento de desintegrar, recetas de fusión y precios mínimos.
- **Comercio:** comisión, límites del comercio y de las donaciones.
- **Contenido:**
  - misiones, logros, ruta y tienda de temporada, eventos y anomalías;
  - **catálogos de sectores, enemigos, jefes y acabados** (§13.1 bis);
  - apertura y cierre de temporadas.
- **Multiplicadores globales** temporales, por ejemplo «doble polvo el fin de semana».
- **Interruptores de funciones:** mercado, trueque, chat, gachapón, registro.
- **Modo mantenimiento.**

### 16.4 Moderación [U+D]

- **Chats:**
  - vista en vivo del global y de los de clan;
  - borrar mensajes;
  - silenciar;
  - filtro de palabras;
  - **cola de denuncias**.
- **Partidas en grupo (§14.8):**
  - salas en vivo, con cerrar una sala;
  - **ver en directo** una partida, con selector de cámara;
  - **denuncias de jugadores**: descartar o tomar medidas, siempre con motivo y auditado.
- **Clanes:** renombrar, disolver, expulsar y traspasar el liderazgo.
- **Mercado y tratos:**
  - cancelar anuncios;
  - **revertir tratos**, con linaje y asientos compensatorios;
  - historial;
  - **alertas** de comercio sospechoso.

### 16.5 Comunicación [D]

- **Buzón:** noticias para todos o por segmentos, con **regalos adjuntos**.
- **Avisos** en la pantalla de título.

### 16.6 Paneles y herramientas [D]

- **Estadísticas en vivo:**
  - jugadores conectados;
  - partidas por hora;
  - flujos de cada moneda (entra y sale);
  - tiradas y rarezas reales frente a las esperadas;
  - volumen del mercado;
  - partidas en grupo: cuántas, jugadores por partida, cómo acabaron, capa media, abandonos e inactivos;
  - alertas.
- **Herramientas:**
  - reproductor de partidas, también de las partidas en grupo, con la cámara en cualquiera de los jugadores;
  - simulador del gachapón y de la economía con la configuración en edición, **antes** de publicarla;
  - exportación a CSV.

---

## 17. Presentación

### 17.1 Dirección visual [U]

- **Referencia aprobada:** la demo `titulo-v2.html`. El usuario la valoró así: «Esto sí que es un buen boceto», con un estilo y un diseño inspirados en PokéBonk, y dijo que la interacción de los botones es «muy satisfactoria». Hay que pulirla mucho más, pero es la base.
- **Identidad:**
  - interfaz moderna, limpia e intuitiva, con bordes redondeados;
  - colores llamativos pero armoniosos;
  - **distinta de la web de ElClub**, que usa Base Blue, Cerulean y Archivo.
- **Rasgos de la demo que pasan al sistema de diseño:**
  - **Superficies con relieve:** labio inferior que se hunde al pulsar y rebote suave.
  - **Textura de puntos braille** en los botones principales.
  - **Acentos sacados de las paletas del motor:** Solar Gold para la acción principal, Supernova para la supervivencia, Terminal Green para el hogar, Ultraviolet para los eventos e hielo braille.
  - **Tipografías:** Bungee para el logo y las grandes llamadas, Fredoka para la interfaz. Se autoalojan y cubren ñ, ¿ y ¡.
  - **Fondo pixel art vivo** con la galaxia braille calculada en tiempo real y el **revelado por escaneo** al cargar.
  - Avatares pixel generados a partir del nombre.
- **Siguiente entregable:** `games/galaxy/docs/DESIGN_SYSTEM.md`. Sale de la demo y se hace con ui-ux-pro-max: tokens, componentes, movimiento y reglas de accesibilidad (contraste ≥ 4,5:1, foco visible, `prefers-reduced-motion`).

### 17.2 Pantallas anchas [U+D]

- La interfaz se ancla a los bordes y el fondo crece con la pantalla; no hay un lienzo fijo con bandas.
- **En la arena de combate [D]**, la zona jugable visible tiene un **tope de proporción**, *de partida* 21:9, y lo que sobra se rellena con decoración. Así una pantalla ultrapanorámica no da ventaja.

### 17.3 Animación y *juice* [D]

- **Interfaz:** un momento orquestado por pantalla, como el escaneo de la portada o el revelado del gachapón, y respuesta inmediata a cada acción, como el hundido al pulsar o los contadores que suben.
- **En combate:**
  - golpes con destello y número;
  - sacudida de cámara proporcional;
  - partículas de los elementos;
  - glitch de Estática en élites y jefes.
- **El catálogo concreto** de animaciones y efectos es **[C]**, siguiendo ui-ux-pro-max.

### 17.4 Audio [U]

- Sintetizado con WebAudio y un planificador anticipado.
- **Música adaptativa** chiptune/synthwave por capas según la intensidad.
- **Efectos del gachapón** que escalan con la rareza.
- **Sello sonoro:** el clac de la máquina Perkins.

### 17.5 Arte [U+D]

- Sprites pixel art en **Aseprite**, a través del servidor MCP `aseprite`. Se exportan como hojas de sprites PNG + JSON para PixiJS.
- Se completan con sprites generados por código y packs CC0 (p. ej. Kenney).
- Las galaxias siempre en braille.

---

## 18. Arquitectura técnica

Se mantiene la arquitectura de `BRIEF.md` §4, validada. Resumen y cambios:

### 18.1 Código y despliegue [U, del brief]

- **`games/galaxy/`:** workspace pnpm independiente con su propio lockfile:
  - `apps/web`: Vite + React 19 + TanStack Query + Zustand + Tailwind v4/Radix;
  - `apps/server`: Fastify + Kysely;
  - `packages/engine`: motor de galaxias portado;
  - `packages/sim`: simulación;
  - `packages/rules`: economía y reglas;
  - `packages/shared`: esquemas Zod.
- **En la raíz,** `games/**` queda excluido de `tsconfig.json`, `eslint.config.mjs` y `.dockerignore`.
- **Un solo historial de migraciones** en `supabase/migrations` y un solo pipeline de PRE.
- **Contenedor `galaxy`** (Node 22 + Fastify):
  - sirve la API en `/galaxy/api/*`, el **WebSocket de chat y de avisos en vivo** en `/galaxy/api/ws` **[D]**, y el build de Vite en `/galaxy/*`;
  - está en la red `supabase_default`, con el rol `galaxy_api`, que solo ve el esquema `galaxy`. Ese esquema no se expone por PostgREST.
- **Túnel de Cloudflare:** la regla `^/galaxy(/|$)` va antes de la de `pre.elclub.party`. Así el juego queda fuera de Next, sin el proxy de login, sin la CSP del foro y sin wallets.
- **CSP propia y estricta:**
  - `script-src 'self'`;
  - `connect-src 'self'`, que también admite el WebSocket del mismo origen;
  - `worker-src 'self' blob:`;
  - `frame-ancestors 'none'`;
  - HSTS.

  PixiJS se importa como `pixi.js/unsafe-eval`.
- **Pipeline:** `preproduction.yml` construye, reinicia y hace el smoke de `/galaxy/api/health`. Además, `galaxy-ci.yml` corre con runners de GitHub para los cambios en `games/**`.
- **Producción** (más adelante): rewrite de Vercel de `/galaxy/:path*`. El esquema `galaxy` existirá vacío e inerte en producción tras fusionar en `main`, y está aceptado.
- **Datos de la beta [D]:**
  - Son permanentes y se tratan como datos de producción desde M1: migraciones serias, libro de movimientos y versiones de configuración.
  - Antes del lanzamiento público (M8) el usuario decide si se conservan o se reinicia. Construyendo así, las dos opciones quedan abiertas.
- **Dónde vivirá el servidor en producción [D]:**
  - Vercel no puede alojar Fastify con WebSocket, así que el rewrite apuntará a un servidor aparte.
  - En M8 se elige y se mide. Las opciones son el contenedor en el Proxmox de casa, tras el túnel con un nombre de producción, o un VPS.
  - También hay que contar con los límites del Supabase Free de producción: conexiones y 500 MB.
- **Retención [D]:**
  - Las entradas grabadas de partidas (`run_inputs`) se guardan *de partida* 30 días. Las de partidas marcadas, del top de la clasificación o de récords se guardan siempre.
  - El chat se guarda 90 días, y las denuncias, siempre.
- **Despliegues en PRE [D]:**
  - El pipeline solo reinicia el contenedor `galaxy` si cambia su imagen.
  - El cliente reconecta solo el WebSocket y reenvía lo pendiente con su clave de idempotencia. Un despliegue no puede costar progreso.

### 18.2 Cuentas [U, del brief]

- **Usuario:** `^[a-z0-9_]{3,20}$`, sin distinguir mayúsculas.
- **Contraseña:** argon2id (`@node-rs/argon2`).
- **Sesión:** token aleatorio guardado como hash, en la cookie `gs_sid` (HttpOnly, Secure, SameSite=Strict, `Path=/galaxy`).
- **Protecciones:** comprobación de Origin, límites por IP (`CF-Connecting-IP`) y por usuario, comparaciones en tiempo constante.
- **Sin Supabase Auth.**
- **Recuperación:** con códigos que emite el admin.
- **Primer admin:** `rayelus` queda reservado en una migración y se crea con `create-admin rayelus`.
- **Añadido [D]:** TOTP para los roles de admin.

### 18.3 Motor de galaxias [U, del brief]

- **Workers en TypeScript** con un PCG64 compatible con numpy calculan:
  - puntos;
  - tramado Bayer;
  - estrellas;
  - fenómenos.

  Trabajan a 192, 96 y 48 columnas. Cada LOD es un render propio, como en el motor de Python (`columns` distinto): no se obtiene reduciendo el de 192, así que las tres coinciden carácter a carácter con Python, pero no entre sí.
- **Un único canvas WebGL2** fuera de pantalla aplica glow, viñeta, CRT y tonemap.
- **Caché** en memoria y en IndexedDB.
- **Comparación con el motor de Python** de `C:\Users\rayel\Desktop\galaxy-nft` mediante referencias doradas (`tools/golden/export.py`).
- **Motor versionado:** los visuales v1 se congelan antes de que nadie juegue. La semilla, los rasgos y la rareza mandan; las diferencias de `Math.*` entre navegadores solo afectan a la imagen.

### 18.4 Simulación y cliente [U+D]

- **PixiJS v8** solo dibuja.
- **`packages/sim`:**
  - paso fijo a 60 Hz;
  - arrays tipados y rejilla espacial;
  - RNG con semilla, nunca `Math.random`;
  - **N sondas y comandos de entrada por tick** **[D]**, para poder reproducir partidas y añadir el cooperativo.
- **Solo escritorio:** el cliente exige puntero fino y un mínimo de 1280×720. La adaptación a pantallas anchas está en §17.2.

### 18.5 Base de datos [U+D]

- **Esquema `galaxy`:**
  - migraciones `supabase/migrations/<fecha de creación>_galaxy_*.sql`, nunca con fecha futura (`supabase db push` rechaza las anteriores a la última aplicada);
  - pgTAP en `supabase/tests/9xx_galaxy_*`.
- **Tablas del brief:** cuentas, monedas, galaxias y gacha, reliquias y estación, aventuras y temporadas, comercio y `admin_audit_log`.
- **Añadidas [D]:**

  | Área | Tablas nuevas |
  |---|---|
  | Clanes | clans, clan_members, clan_donations, clan_events |
  | Chats y moderación | chat_messages, chat_mutes, reports, word_filter |
  | Progresión | missions, mission_progress, achievements, account_achievements, codex_entries, account_codex, season_track, season_shop |
  | Contenido vivo | events, mailbox_messages, mailbox_claims |
  | Configuración | game_config_versions, feature_flags |
  | Seguridad admin | admin_totp |
  | Sondas | probes_unlocked, personality_results |
  | Partidas | run_inputs (entradas grabadas) |

  Los nombres son orientativos **[C]**.
- **Límites de frecuencia:** copian el patrón de `private.rate_limit` (`supabase/migrations/20261019700101_rate_limits.sql`).

---

## 19. Hitos

Actualiza los del brief para incluir lo nuevo. Verificación en cada hito:
- TDD estricto: Vitest + fast-check para las reglas, pgTAP para la base de datos y Playwright para el e2e;
- el motor portado se compara con el de Python;
- `preproduction.yml` debe quedar en verde.

| Hito | Contenido |
|---|---|
| **M0** | Diseño: este GDD, `DESIGN_SYSTEM.md` y los planes por hito |
| **M1** | Esqueleto del workspace, cuentas (con TOTP para admins), configuración viva, despliegue en PRE |
| **M2a** | Port del motor + referencias doradas |
| **M2b** | Gachapón (bienvenida, suerte creciente, garantía, eventos, boletos, revelado), colección, cartas e inspección 3D, desintegración y fusión |
| **M3a** | Núcleo de la incursión: simulación determinista para N sondas, arena Pixi, 1 sector completo con capas, jefe y extracción, armas, pasivas, elementos, reliquias en partida |
| **M3b** | Contenido completo de incursiones: 4+1 sectores, unos 24 enemigos, jefes, 16 armas, 20 pasivas, evoluciones, reacciones, 8 sondas y el test de personalidad |
| **M4** | Estación: salas, reparación, refinería, antena, planetario visitable, laboratorio |
| **M5** | Social: clasificación, perfiles, clanes, chats en tiempo real, trueque, mercado y antiabuso |
| **M6** | Panel de admin completo (§16) y auditoría |
| **M7** | Progresión y contenido vivo: onboarding y tutorial, misiones, logros, Catálogo, Códice y lore, temporadas, eventos, buzón, prestigio |
| **M8** | Audio adaptativo, pulido de *juice*, calibración final de la economía, pruebas de carga y ruta de producción. **Al terminar: beta para los amigos** |

El orden puede ajustarse en los planes **[C]**, siempre que cada hito deje algo jugable o administrable en PRE.

**Calendario [U]:** no hay fecha. Se construye por orden de hitos y no se pasa al siguiente sin que el usuario apruebe el anterior en PRE. No se recorta contenido para llegar antes.

**Puntos de aprobación del usuario [D]:**
- **Documentos:** `DESIGN_SYSTEM.md` antes de escribir interfaz.
- **Arte:** una muestra de dirección de arte en Aseprite (sonda, 3 enemigos y la estación) antes de producirlo todo.
- **Lore:** el texto antes de cargarlo en el Códice.
- **Cada hito:** sale como PR a `develop` y lo fusiona el usuario tras probarlo en PRE.

## 20. Lo que queda a criterio de quien construye

- **Contenido concreto:**
  - catálogo de armas, pasivas, evoluciones y reacciones;
  - diseño de cada enemigo, jefe y sector;
  - las 8 sondas y las preguntas del test;
  - nodos del laboratorio;
  - misiones y logros;
  - textos del lore.

  Todo dentro de §5–§15.
- **Todos los números marcados *de partida*,** que se calibran con las simulaciones de §8.6 y §11.4.
- **Nombres de tablas y endpoints,** y la organización interna de cada paquete.
- **El catálogo de animaciones y efectos de sonido.**

## 21. Riesgos

- **Mismo origen que el foro:** CSP estricta en ambos lados.
- **Cambios en el motor:** cambiarían galaxias que ya tiene la gente. Hay que versionar y congelar los visuales v1.
- **Sin email puede haber bots.** Se mitiga con límites ahora y Cloudflare Turnstile si hace falta.
- **Las partidas se simulan en el cliente.** Se mitiga con controles de plausibilidad ahora y verificación por repetición después.
- **El alcance es grande** para una beta completa. Lo mitigan los hitos jugables en PRE y la configuración viva, que permite ajustar sin desplegar.
- **Equilibrio de reliquias y reacciones:** combinaciones rotas. Se mitiga con frenos más la simulación de builds en el CI.
- **Chats con jugadores de 16 años:** moderación, filtro, denuncias y roles de moderador desde el primer día del chat.
