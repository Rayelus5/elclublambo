# Fase 4: gobernanza de la tesorería (diseño)

Spec padre: `docs/superpowers/specs/2026-10-16-plan-maestro.md` (§2 tesorería con shares, §3 `withdrawal_requests`, `raffles`, `polls`, §4 F4). Este documento parte de la F3 mergeada (PR #4 y #5): tesorería por red, shares, donaciones en dos fases con finalidad, reconciliación, candados, presencia y barra de actividad.

## Intención

La DAO deja de ser una hucha de USDC y pasa a ser **un fondo de inversión común del club en Linea**:
- Los miembros donan USDC **sin esperar nada a cambio**.
- El tesorero (por defecto, el SuperAdmin) invierte esos USDC, sobre todo en ETH.
- Las ganancias financian recompensas, como los sorteos.
- Cada miembro puede **retirar su porcentaje** cuando haya liquidez y el tesorero lo apruebe.
- El foro enseña con claridad qué hay en la Safe, cuánto vale, cómo evoluciona y qué decide la comunidad en sus encuestas.
- Una página **Mercado** da contexto de precios cripto.

**Éxito:**
- Un miembro abre `/dao` y ve en qué está invertido el fondo, su valor en vivo, la evolución en una gráfica y su % en dólares.
- Puede pedir una retirada parcial y la recibe en USDC tras la aprobación.
- Se apunta a un sorteo y cualquiera puede comprobar que el ganador salió de forma justa.
- Vota en una encuesta del canal sin que nadie sepa qué votó.
- Mira el top 100 de criptos en Mercado.

**Anti-objetivos** (aunque "funcione", sería un fracaso):
- Que el foro custodie fondos o firme por nadie: la Safe y sus firmantes siguen siendo los únicos que mueven dinero.
- Que alguien gane o pierda por el momento en que dona o retira: emitir o quemar shares a un valor desfasado o manipulable.
- Que una retirada se marque como pagada sin una transferencia verificada de la Safe a la wallet del miembro por el importe fijado.
- Que el ganador de un sorteo se pueda elegir o predecir antes del cierre, o que no se pueda verificar después.
- Que se sepa qué votó cada miembro, o que el voto de alguien revele que es donante anónimo.
- Que se prometa rentabilidad: cada pantalla de dinero recuerda que es una donación, que hay riesgo y que las retiradas dependen de la disponibilidad y del tesorero.

## Decisiones del usuario

1. **Fondo de inversión común.**
   - Se dona en USDC en Linea.
   - El tesorero invierte, sobre todo en ETH en Linea.
   - Las ganancias pagan recompensas.
   - Cada miembro puede retirar su % cuando esté disponible.
   - Tesorero por defecto: el SuperAdmin, mediante el permiso `MANAGE_TREASURY`, que puede delegarse en otros roles.
2. **Valoración a mercado en vivo.** Valor del fondo = lo que hay en la Safe × precio de mercado. Cada donación y cada retirada usa el valor de ese momento.
3. **Activos admitidos:** solo USDC y ETH (incluido WETH) en Linea.
4. **Retiradas:**
   - Las aprueba **un** tesorero, que fija el importe en dólares al aprobar.
   - Pueden ser **parciales o totales**: el miembro elige cuántas participaciones.
   - Solo una solicitud pendiente por miembro; sus shares quedan bloqueadas mientras tanto.
   - Se pagan en **USDC**. Si hace falta, el tesorero vende ETH antes.
5. **Interruptor legal:**
   - Las retiradas arrancan **desactivadas** y el SuperAdmin las activa por red.
   - **Aviso obligatorio al donar** (casilla que hay que marcar): es una donación sin esperar nada a cambio, la inversión tiene riesgo y las retiradas dependen de la disponibilidad y de la decisión del tesorero.
6. **Sorteos:**
   - El premio sale de la tesorería, así que baja el valor del fondo, no el % de nadie.
   - El admin los crea con premio y fecha de cierre, y elige **igualitario** o **ponderado por participación**.
   - Los miembros **se apuntan**.
   - El ganador sale de forma **verificable**: commit-reveal más bloque de Linea.
7. **Encuestas:**
   - Son un tipo de mensaje `/encuesta` en los canales, con su propio permiso por canal.
   - El creador elige el peso: 1 persona 1 voto, lineal o cuadrático según la participación.
   - El voto es **secreto** y los resultados se publican **al cerrar**.
8. **Seguimiento de la inversión, automático más notas:**
   - El foro lee la Safe y guarda el valor del fondo cada hora, para la gráfica.
   - El tesorero puede añadir una nota a cada operación ("compramos 2 ETH") con su enlace al explorador.
9. **Página Mercado** en la barra superior:
   - Top 100 con precio, variación 1h/24h/7d, capitalización, volumen y minigráfico de 7 días.
   - Ficha por cripto con gráfico (24h/7d/30d/1a) y datos clave.
   - API gratuita (CoinGecko), con caché en servidor.

## Decisiones mías (revisables)

### Valoración (NAV)
1. **Fórmula del NAV:**
   - Activos de la Safe en la red activa, valorados en USD: USDC, ETH y WETH (balance on-chain × precio).
   - Se restan las **obligaciones**:
     - donaciones recibidas pero aún no acreditadas (en finalidad);
     - retiradas aprobadas y no pagadas.
   - El supply de shares que cuenta excluye las shares bloqueadas por esas retiradas aprobadas.
2. **Precio de ETH para valorar:**
   - **Oráculo on-chain de Chainlink ETH/USD en Linea**: verificable y difícil de manipular.
   - Si el feed está obsoleto (más de 1 h) o no existe en la red (Linea Sepolia), se usa CoinGecko, con una comprobación de cordura frente a la última valoración.
   - Si ninguna fuente es fiable, **no se emiten ni se fijan shares**: la operación espera, como un error transitorio.
   - El builder verifica en la documentación oficial de Chainlink la dirección del feed y si existe en Sepolia; no se escribe de memoria.
   - USDC se valora a 1 USD.
3. **Emisión de shares:** al acreditar una donación, `shares = S == 0 ? d·10¹² : floor(d · S / NAV_previo)`.
   - `NAV_previo` es el NAV en el momento de acreditar, sin esta donación ni las demás pendientes.
   - Sustituye a la fórmula de F3 basada en el valor del ledger.
   - Una transferencia directa a la Safe sí sube el NAV: beneficia a todos por igual y nadie puede reclamarla como suya.
   - Contra el clásico ataque de inflación (el primer donante con pocas shares que dona "por fuera" para que los siguientes reciban 0) hay dos defensas:
     - donación mínima;
     - si el cálculo da 0 shares, la donación no se acredita: se marca para revisión del tesorero, sin perder el registro.
4. **La reconciliación cambia de sentido.**
   - Ya no compara el ledger con el balance, porque el NAV es el balance a mercado.
   - Ahora vigila otras cosas y avisa a los tesoreros:
     - activos no admitidos en la Safe;
     - salidas de USDC/ETH sin retirada ni sorteo registrados (gasto sin explicar).
   - Las notas del tesorero pueden "explicar" una salida.
5. **Instantáneas horarias del NAV y del valor por share**, por red, desde el cron existente (`/api/cron/dao`). Alimentan la gráfica de evolución. Una instantánea fallida (RPC u oráculo caído) se salta, no se inventa.

### Retiradas
6. **Flujo:**
   - **Solicitud:** el miembro indica las shares o un %, que se bloquean.
   - **Aprobación** por un tesorero: el importe en USDC se fija como `shares · NAV / S` en ese momento y pasa a ser una obligación que descuenta del NAV.
   - **Pago:** se verifica una transferencia USDC desde la Safe de esa red a la wallet del miembro por **al menos** el importe fijado, con las mismas reglas que las donaciones (confirmaciones, log del contrato oficial, finalidad y anti-reutilización).
   - **Cierre:** las shares se queman y la posición se actualiza.
   - **Otros finales:**
     - el miembro puede cancelar mientras esté pendiente;
     - el tesorero puede rechazar con un motivo;
     - una aprobación sin pagar en 14 días caduca y libera las shares (el tesorero puede volver a aprobarla al precio nuevo).
7. **Prioridades:**
   - Solo se puede aprobar si las retiradas están activadas en esa red.
   - La UI del tesorero muestra si hay USDC suficiente en la Safe para pagar.
8. **El gating usa las shares no bloqueadas.** Pedir una retirada te quita el acceso que dependía de esas shares desde el primer momento: si no, se podría pedir la retirada, entrar en el canal y cancelar.

### Sorteos
9. **Sorteo verificable:**
   - Al crearlo, el servidor genera una semilla secreta y publica su hash (commit).
   - Al cerrar, se fija el primer bloque de Linea posterior al cierre y se revela la semilla.
   - Ganador = `keccak256(semilla ‖ hash del bloque) mod peso_total`, recorriendo las participaciones en orden estable.
   - La página del sorteo muestra todos los datos para recalcularlo a mano.
10. **Pesos:**
    - Igualitario: 1 por participante.
    - Ponderado: las shares no bloqueadas en el momento del cierre, en un snapshot inmutable. Si no tienes shares, pesas 0: no puedes ganar, aunque puedes apuntarte y la UI lo explica.
11. **Premio:**
    - En USDC o ETH, por importe, con la red mostrada.
    - El tesorero lo paga desde la Safe al ganador y se verifica igual que una retirada.
    - Si no se paga en 14 días, el sorteo queda marcado como "impagado", visible (como los bounties).
    - El pago baja el NAV de forma natural.

### Encuestas
12. **Configuración:** `/encuesta` crea un mensaje con:
    - pregunta;
    - de 2 a 10 opciones;
    - fecha de cierre (de 1 h a 30 días);
    - modo de peso.

    Permiso nuevo por canal **"Crear encuestas"**, concedido por defecto a Moderador y Verificado, como el de bounties.
13. **Pesos:**
    - Se fijan con un **snapshot al crear la encuesta** (Plan Maestro §2), con las shares no bloqueadas de la red activa.
    - Lineal = shares; cuadrático = raíz de las shares, con precisión fija y aritmética entera.
    - En modos ponderados, quien no tiene shares puede votar con peso 0 y lo ve explicado; el recuento muestra votantes y peso por separado.
14. **Voto secreto de verdad:**
    - Los votos se guardan en una tabla sin lectura directa para nadie, ni siquiera admins vía UI.
    - Solo una función agrega los resultados, y solo tras el cierre.
    - Antes del cierre, cada miembro ve únicamente su propio voto y el número total de votantes.
    - Un voto se puede cambiar hasta el cierre.
    - Pueden votar quienes puedan ver el canal en ese momento.
15. **Resultados:** al cerrar, el mensaje muestra barras con el % de peso por opción y el número de votantes. Las encuestas no se ejecutan solas: son consultivas, y la UI lo dice.

### Panel y páginas
16. **`/dao` amplía lo de F3:**
    - **Composición del fondo:** USDC, ETH y WETH con cantidades y valor en USD.
    - **Precio de ETH** y de qué fuente sale.
    - **Gráficas:** valor del fondo y valor por share (24h/7d/30d/todo).
    - **Tu posición:** % y valor en USD.
    - **Botón "Retirar"**, si está activado.
    - **Operaciones recientes** de la Safe con sus notas.
    - **Sorteos** activos y pasados.
    - Enlace a la Safe en el explorador.
17. **Panel del tesorero** en `/dao/tesoreria` (permiso `MANAGE_TREASURY`):
    - retiradas pendientes y aprobadas, con aprobar, rechazar y marcar pagada (pegando el hash);
    - crear y gestionar sorteos;
    - notas de operaciones;
    - avisos de la reconciliación;
    - interruptor de retiradas por red, este solo para el SuperAdmin.
18. **Mercado:**
    - `/mercado` (lista) y `/mercado/[id]` (ficha), solo para miembros.
    - Caché en servidor de 60 s para la lista y de 5 min para los gráficos, para no pasarse del límite gratuito.
    - Atribución "Datos de CoinGecko".
    - Si la API falla, se muestra la última copia con su hora, o un error claro.
19. **Notificaciones nuevas:**
    - retirada aprobada, rechazada o pagada;
    - ganaste un sorteo;
    - encuesta cerrada (a quien votó);
    - aviso de tesorería (para tesoreros).
20. **La guía (`/guia`)** gana una sección sobre el fondo común, las retiradas, los sorteos y las encuestas, con el aviso de riesgo.

## Comportamiento
- **Donar (cambia respecto a F3):**
  - La casilla del aviso legal es obligatoria antes de "Continuar".
  - El diálogo muestra el valor actual por share y cuántas shares, aproximadamente, recibirías. Es una estimación: el número exacto se fija al acreditar.
- **Pedir una retirada:**
  - El miembro elige el % (deslizador y campo) y ve el valor estimado en USDC al precio actual, con el aviso de que el importe final se fija al aprobar.
  - Tras confirmar, sus shares quedan bloqueadas.
  - Estados que ve: Pendiente → Aprobada (importe fijado) → Pagada, o bien Rechazada (con motivo), Cancelada o Caducada.
- **El tesorero aprueba** y ve el importe que se fijará, el USDC disponible en la Safe y la wallet de destino. Luego paga desde la Safe (fuera del foro) y pega el hash, o el foro detecta la transferencia sola.
- **Sorteo:** tarjeta con premio, cierre, modo, participantes, el botón "Participar" y el commit visible. Al cerrar: ganador, semilla, bloque y una explicación de cómo comprobarlo.
- **Encuesta en el chat:**
  - Tarjeta con opciones, tiempo restante, modo de peso y tu voto.
  - Al cerrar: barras de resultados.
  - Llega en tiempo real como el resto de mensajes.

## Fuera de alcance
- **Ejecutar swaps o firmar desde el foro:** el tesorero opera en la Safe o en un DEX por su cuenta.
- **Activos distintos de USDC/ETH/WETH**, otras redes y staking.
- **Retiradas en ETH o proporcionales.**
- **Encuestas vinculantes que muevan dinero** y delegación de voto.
- **Vault on-chain auditado** (F5).

## Entrega por partes (mi decisión)
- **F4a, valoración y fondo:**
  - NAV con oráculo, instantáneas y gráficas;
  - composición y operaciones con notas;
  - nueva reconciliación;
  - emisión de shares con NAV;
  - aviso legal al donar;
  - guía.
- **F4b, Mercado:** lista y ficha con gráfico.
- **F4c, retiradas:** solicitud, aprobación, pago verificado y quema; interruptor; panel del tesorero.
- **F4d, sorteos:** commit-reveal, pago verificado e impagados.
- **F4e, encuestas:** `/encuesta`, permiso, snapshot, voto secreto y resultados.

Cada parte tiene su plan, con TDD, revisión por tarea y E2E en la cadena local de Hardhat (con un feed de precio simulado). La F4 se cierra con una revisión final de la rama completa.

## Lo que necesita el usuario (HACER A MANO, al llegar a F4a/F4c)
- Confirmar que la Safe de cada red es la configurada en `/settings/economia`.
- En F4c, decidir cuándo activar las retiradas en mainnet; recomiendo hacerlo tras una revisión legal.
