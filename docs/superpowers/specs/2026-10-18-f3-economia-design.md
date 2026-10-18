# Fase 3: economía en Linea (diseño)

Spec padre: `docs/superpowers/specs/2026-10-16-plan-maestro.md` (§2 tesorería con shares, verificación de transacciones, gating; §3 esquema de economía). F1 y F2 están mergeadas (PR #1, #2 y #3): identidad, permisos en cascada, chat en tiempo real con hilos, Alpha, avisos, tickets y búsqueda.

## Intención

Que el dinero se mueva dentro del club **sin que el club lo custodie nunca**:
- un miembro premia a otro por un buen mensaje;
- quien necesita ayuda publica un bounty y lo paga;
- la comunidad junta una tesorería común en una Safe, cuya participación (%) abre canales con candado.

Todo es verificable on-chain y se explica bien a la gente nueva.

**Éxito:** un miembro nuevo entra, ve una bienvenida, entiende en la guía cómo funcionan las propinas, los bounties y la DAO, y envía su primera propina sabiendo en qué red está. El autor ve la insignia y el aviso en el hilo. Un donante a la DAO ve su % en el dashboard y entra al canal que antes tenía candado.

**Anti-objetivos** (aunque "funcione", sería un fracaso):
- Que el foro custodie fondos o pida firmar algo distinto de una transferencia normal a una dirección conocida.
- Que se acredite una transacción no verificada en servidor, ajena (de otra wallet) o ya usada.
- Que los fondos de testnet entren en el ledger, el ranking o el gating de mainnet, o que se use testnet sin que todos vean que es modo prueba.
- Que alguien envíe dinero sin ver antes en qué red está.
- Que una transferencia directa a la Safe, sin registrar, infle el valor de las shares (ataque de inflación, Plan Maestro §2).
- Que el contenido de un canal con candado llegue a quien no cumple el requisito, por la vía que sea.

## Decisiones del usuario

1. **Dos redes a la vez:** Linea mainnet (59144) y Linea Sepolia (59141).
   - El admin elige la red activa en Ajustes.
   - Antes de cualquier envío de dinero (propina, pago de bounty o donación a la DAO) se muestra siempre una etiqueta con la red activa.
2. **Ledger separado por red.** Cada red tiene su propia tesorería, shares y ranking. El dashboard y el gating usan solo la red activa; al pasar a mainnet, la tesorería de mainnet empieza de cero.
3. **Propinas** en ETH o USDC a:
   - cualquier mensaje del chat, incluidas las respuestas de hilo y las publicaciones Alpha;
   - perfiles, con un botón en el propio perfil.
4. **Visibilidad de las propinas:**
   - El mensaje recompensado muestra una insignia, el total y la lista de quién dio cuánto, con enlace al explorador.
   - Cada propina verificada publica en el hilo del mensaje un aviso individual (a modo de log): "Se ha enviado X TOKEN a @autor por este mensaje".
5. **Propina anónima:** el donante puede marcarla así. En la lista y en el aviso del hilo sale como "Anónimo". La UI avisa de que on-chain sigue siendo rastreable.
6. **Comisión de la plataforma:**
   - El SuperAdmin configura la wallet de la plataforma y una comisión **mínima** entre 0% y 50%, con decimales (por ejemplo 0,5% o 2,6%).
   - Al confirmar el envío, el donante puede **subir** la comisión de forma opcional para apoyar el proyecto. Nunca puede bajarla del mínimo.
7. **Bounties:** son un tipo de mensaje, como Alpha, creado con `/bounty` (importe, token y descripción).
   - Lo puede crear quien tenga el permiso nuevo **"Crear bounties"**, que es un bit de canal. Por defecto lo tienen los Verificados.
   - Las soluciones van en su hilo. El autor marca una respuesta como solución y la paga con el flujo de propina.
   - Si no paga en 7 días, recibe la marca pública "bounty impagado".
8. **Tesorería DAO:** donaciones solo en USDC a la Safe de la red activa, convertidas en shares según el ledger (Plan Maestro §2).
   - Dashboard público con balance, historial y ranking.
   - En el ranking, cada miembro elige si aparece con su nombre o como "Anónimo". Su % cuenta para el gating igualmente.
9. **Canales con gating, visibles con candado.** El canal aparece en el sidebar con un candado. Al entrar se ve:
   - el requisito (por ejemplo, "Necesitas 1% de la DAO o 100 USDC aportados");
   - la situación actual del miembro;
   - un botón para donar.

   Ni el contenido ni los mensajes se filtran.
10. **Perfiles editables:**
    - **@handle** único de 3 a 20 caracteres, usado en menciones y en la URL `/u/handle`;
    - **avatar** subido (png, jpeg o webp, máx. 2 MB); si no hay, un identicon de la wallet;
    - **bio** de unos 280 caracteres en texto plano;
    - hasta **3 enlaces**, que pasan por el Guardián.

    Desde el perfil se puede dar propina.

    El @handle es **obligatorio**: se elige en el primer paso de la bienvenida, también los miembros actuales al entrar. Se puede cambiar una vez cada 30 días; el antiguo queda libre y `/u/0x…` sigue funcionando siempre. El `display_name` actual se mantiene como nombre visible opcional junto al @handle. Las menciones y los avisos muestran el @handle.
11. **Guía para gente nueva:**
    - Páginas fijas en `/guia`: Propinas, Bounties, DAO y shares, Canales con candado, Redes y seguridad.
    - Cada diálogo de dinero lleva un enlace "¿Cómo funciona?" a su sección.
    - La guía también está en Cmd+K y en la barra superior.
    - Hay una **bienvenida** de 3 o 4 pasos la primera vez que se entra, que se puede saltar y reabrir desde la guía. El paso del @handle es obligatorio, solo se puede saltar el resto.
12. **La comisión se suma al importe.** El destinatario recibe íntegro lo anunciado y el donante paga importe + comisión. Se aplica a **propinas, pagos de bounty y donaciones a la DAO**. En la DAO, las shares se calculan sobre lo que llega a la Safe, sin contar la comisión.
13. **Testnet como modo de prueba.** Con Sepolia activa, el gating usa el ledger de Sepolia, así que los USDC de faucet abren canales con candado y se puede probar todo de principio a fin. Mientras tanto, todos los miembros ven una etiqueta **"MODO PRUEBA"** en la barra superior.
14. **Plazos de los bounties.** Los 7 días para la marca "impagado" cuentan desde que el autor **marca una solución**. Un bounty sin solución marcada pasa a "expirado" a los 30 días: es visible, pero no lleva marca de impagado. La marca "impagado" se ve en el bounty y en el perfil del autor. Si paga después, se sustituye por "pagado tarde".

## Decisiones mías (revisables)

- **Quién cambia la red y la configuración económica:** solo el SuperAdmin (bit 512). Eso incluye la red activa, las direcciones de la Safe y de la plataforma y la comisión mínima. Todo cambio queda en `audit_log`.
- **Datos fijos en código por red:** chainId, la dirección oficial de USDC y el explorador. Las direcciones de USDC se verifican en la documentación de Circle al planificar, nunca de memoria. Lo editable es solo la Safe, la wallet de la plataforma y la comisión.
- **Una transacción registrada conserva su red.** Cambiar la red activa no reescribe nada; las propinas y los bounties de la otra red siguen visibles, marcados con su red.
- **Donación mínima a la DAO de 1 USDC.**
- **Confirmación según el tipo de envío:**
  - Las propinas y los pagos de bounty se acreditan en cuanto la transacción está minada con `status=success` y algunas confirmaciones.
  - Las donaciones a la DAO solo generan shares cuando el bloque está **finalizado** (`finalized`), lo que en Linea puede tardar horas. Mientras tanto se ven como "pendiente de finalización". Así una reorganización nunca crea shares falsas.
- **Comisión en transferencias separadas, nunca en lote ni con contrato.**
  - Son siempre dos transferencias normales: primero la comisión a la wallet de la plataforma y después el envío al destinatario.
  - No se usa EIP-5792: en muchas wallets obliga a convertir la cuenta en smart account (firma EIP-7702), y los envíos de ETH en lote no se pueden verificar sin trazas.
  - El foro solo acredita el envío (insignia, aviso, lista o shares) cuando ha verificado las dos y la comisión cumple el mínimo.
  - Con comisión del 0%, es una sola transferencia.
  - No hay contrato divisor, para no desplegar ni auditar código con fondos; podría llegar en la F5.
- **Intención de pago previa.**
  - Antes de firmar, el servidor crea una intención con quién envía, destino, token, importe, comisión mínima vigente, comisión elegida y red, y una caducidad de 24 h.
  - Solo se acreditan transacciones que coinciden con una intención y están en un bloque posterior a ella.
  - Las transferencias directas a la Safe hechas fuera del diálogo no cuentan nunca: son los "fondos no registrados" que el modelo de shares ignora.
  - Una donación a la DAO conserva la comisión de su intención aunque la finalización tarde horas.
- **Configuración por red:** la Safe y la wallet de la plataforma son por red. La comisión mínima es global.
- **Dos reglas de gating por canal, unidas con "o".** Un canal puede exigir % mínimo, aportación neta mínima o cualquiera de las dos, como en "1% de la DAO o 100 USDC aportados". Requiere migrar el esquema actual, que solo admite una regla por canal. Los requisitos de los foros y categorías antecesores se siguen aplicando todos, como ya hace `channel_permissions`.
- **El aviso del hilo** lo publica el sistema, no el donante. Usa el `post_message_as` de la F2 con un autor de sistema "El Club", sin texto libre del donante. Si el mensaje recompensado no tenía hilo, se crea.
- **Propinas a perfiles:** se ven en el perfil del destinatario (total y lista). No generan aviso en ningún hilo.
- **No hay propinas ni pagos a uno mismo.** La wallet de origen debe ser la del miembro autenticado y distinta de la de destino.
- **Reconciliación:**
  - Una tarea compara el valor del ledger de cada red con el saldo de USDC de su Safe.
  - Se ejecuta con un botón en el panel de la tesorería y de forma periódica mediante una ruta protegida con secreto, que llamará el cron del despliegue (F5).
  - Si hay desajuste, avisa a quien tiene `MANAGE_TREASURY` con una notificación de la F2c.
  - Nunca corrige el ledger sola.
- **Bit nuevo** `CREATE_BOUNTIES` = 65536, de canal, incluido en `CHANNEL_MASK` y en el espejo de TypeScript. Por defecto se concede a Verificado en `@everyone`-safe.
- **Un bounty se paga una sola vez,** a una sola respuesta, con el mismo token y al menos el importe anunciado, que es lo que recibe quien lo resuelve (la comisión va aparte). El autor puede cancelar mientras no haya solución marcada; queda visible como cancelado.

## Comportamiento

**Envío de dinero (común a propina, pago de bounty y donación):**
1. Se abre un diálogo con:
   - la etiqueta de la red activa;
   - el destinatario, con su @handle y su wallet corta;
   - el token y el importe;
   - la comisión: el mínimo y un control opcional para subirla;
   - el total a firmar;
   - la casilla "anónimo" (en propinas);
   - "¿Cómo funciona?".
2. Si la wallet conectada está en otra red, se pide cambiarla antes de firmar (en la F1 ya vimos que MetaMask falla si se cambia la red justo al conectar).
3. Tras firmar, el cliente envía los hashes al servidor. El servidor verifica con viem contra el RPC de esa red:
   - recibo con `status=success` y `chainId` correcto;
   - para USDC, un log `Transfer` del contrato oficial con `from` = wallet del miembro, `to` = destino e importe exacto;
   - para ETH, `tx.to` = destino, `value` exacto y `from` = wallet del miembro;
   - coincidencia con la intención de pago, cuya comisión es ≥ la mínima guardada en ella;
   - unicidad `(chain_id, tx_hash, log_index)`.
4. Hasta que se verifica, se ve "Verificando…". Si falla, se ve el motivo. Se puede reintentar con el mismo hash, nunca se acredita dos veces.

**Shares** (Plan Maestro §2, por red):
- `shares = S==0 ? d·10¹² : d·S/V`, en enteros grandes, nunca floats.
- `V` es el valor del ledger, no el saldo on-chain.
- Los gastos (F4) bajan `V`.
- El % es `shares_u / S`.

**Gating:** `channel_permissions` aplica el gating que hoy devuelve pass:
- cada canal puede tener `min_share_bps`, `min_net_usdc` o las dos, unidas con "o";
- `min_share_bps` usa la posición del miembro en la red activa, incluida Sepolia en modo prueba;
- `min_net_usdc` usa la aportación neta en la red activa;
- `gate_scope` es `view` o `post`, como en la F2b-R1.

El candado de la F3 solo afecta a la presentación (el sidebar y la página del requisito). El contenido sigue protegido por RLS.

## Fuera de alcance

Retiros y quema de shares, sorteos, encuestas y panel de gastos son de la F4. La migración real a mainnet, el cron de producción y un contrato Vault o divisor son de la F5.

## Entrega por partes (mi decisión)

1. **F3a:** perfiles editables, configuración económica y de red (SuperAdmin), guía `/guia` y bienvenida.
2. **F3b:** propinas a mensajes, Alpha y perfiles, con comisión, anónimas, insignia, lista y aviso en el hilo.
3. **F3c:** bounties, con el permiso nuevo, solución, pago e impagado a los 7 días.
4. **F3d:** tesorería (donaciones, ledger, shares), dashboard, ranking con opción de anonimato, gating activo con candado y reconciliación.

## Lo que necesita el usuario (HACER A MANO, al llegar a F3b y F3d)

- Una Safe en Linea Sepolia y otra en Linea mainnet (app.safe.global). Para pruebas basta 1-de-1; en producción, 2-de-3.
- La wallet de la plataforma, es decir, su dirección pública.
- ETH y USDC de faucet en Linea Sepolia para dos wallets de prueba.
- Una API key de RPC para Linea, de Infura o Alchemy, para las dos redes.
