# Fase 6 — Base + Arbitrum, club simplificado y parte pública (diseño)

Fecha: 2026-10-24. Rama: `feature/base-arbitrum-y-parte-publica` (desde `develop` cd7687e).
Investigación de base (leer antes de planificar):
- `docs/research/2026-10-24-multired-y-parte-publica.md` — informe completo (redes, rediseño por función, legal, ideas).
- `docs/research/2026-10-21-grants-base-arbitrum.md` — grants de Base/Arbitrum/Optimism.
- `docs/research/notas-2026-10-24/*.md` — notas con fuentes. **Direcciones de contratos (USDC, feeds), chain ids,
  dominios CCTP y datos de finalidad: `infraestructura_cadenas.md`. Inventario del acoplamiento a Linea con
  `ruta:línea`: `auditoria_codigo.md`.** Toda dirección se vuelve a comprobar en la fuente oficial antes de usarla.

## Intención
ElClub. deja Linea y pasa a vivir en **Base y Arbitrum**, simplifica lo que tenía riesgo legal (el fondo con
participaciones y retiradas, los sorteos ponderados) y abre una **parte pública** —sin invitación, en español e
inglés— con herramientas útiles para la comunidad cripto. La parte pública genera transacciones en Base atribuidas
con **Builder Codes** para optar a grants y premios de Base (Builder Grant, Base Batches, buildathons) y lleva gente
al club privado, que sigue siendo el producto principal.

Todo lo construye la IA de forma autónoma, por prioridades (§Prioridades). Hoy en producción solo hay datos de
prueba: la migración puede romper compatibilidad con los datos de Linea sin migrarlos.

**Éxito:**
- Un miembro entra con su wallet en Base o en Arbitrum y paga propinas, bounties y donaciones eligiendo **el token**
  (USDC de Base, USDC de Arbitrum, ETH…), sin pensar en redes: la app cambia de red sola.
- Dona a ElClub., recibe el rol de mecenas, aparece en la lista de donantes (si quiere) y entra en sus canales.
- Gana un sorteo cuyo premio es un rol, un objeto o USDC, y cualquiera comprueba que fue justo.
- Alguien sin invitación llega a `www.elclub.party`, ve la landing pública, crea un sorteo verificable para su
  Discord o comparte su enlace de pago en USDC, y descubre que existe un club al que se entra por invitación.
- base.dev muestra transacciones atribuidas al Builder Code de ElClub.

**Anti-objetivos** (fracaso aunque "funcione"):
- Que ElClub. custodie fondos de terceros, los mueva por nadie o prometa rendimiento. Nada de escrow controlado por
  nosotros, nada de retiradas proporcionales.
- Sorteos con entrada de pago, o cuyo premio dependa de cuánto aportó cada uno.
- Datos personales on-chain (handles, nombres, emails en atestaciones o calldata).
- Que alguien pierda fondos por enviarlos a la red equivocada (la Safe debe existir en ambas redes con la misma
  dirección antes de aceptar nada).
- Cobrar dinero real en la parte pública (API x402) antes de que el usuario confirme su situación fiscal.
- Interfaces saturadas de texto: los textos explicativos son cortos y concretos.

## Decisiones del usuario (2026-10-24)
1. **Redes: solo Base y Arbitrum.** Linea sale (código, BD, textos). El usuario **elige a qué red conectar**; al
   pagar **elige el token, no la red**. Si un token existe en las dos redes (USDC), se especifica cuál.
2. **Iconografía:** cada red se muestra con su **logo redondo** (+ nombre si hace falta). Cada token con su logo
   redondo; si el token existe en varias redes, el logo de la red va **pequeño, redondo, abajo a la derecha**,
   superpuesto al del token.
3. **La DAO pasa a ser una donación simple a ElClub.**, sin interés ni retorno. El código de la DAO actual
   (participaciones, NAV, retiradas, reconciliación por shares) **se conserva como histórico**: no se borra, no se usa.
4. **Lo que recibe quien dona** (sin valor económico): **rol/insignia de donante**, **lista pública de donantes**
   (con opción de ocultarse) y **canales exclusivos**.
5. **Encuestas: 1 miembro = 1 voto.** Se quitan los modos lineal y cuadrático.
6. **Sin comisión de plataforma** en propinas y bounties (cambio del 2026-10-24: "quitémoslas para ahorrarnos
   problemas"). El código de comisión se desactiva y se quita de la interfaz; no se cobra nada en ningún flujo.
7. **Sorteos: solo peso igual.** Textos explicativos más intuitivos y cortos. **Premios no solo monetarios**: un rol,
   un objeto físico, algo libre… hay que diseñar para eso.
8. **Parte pública** (sin invitación, ES + EN, misma estética de la web): sorteos verificables, **ElClub Pay**,
   **comprobador de tokens/enlaces + API x402**, **avales con EAS**, y más herramientas DeFi útiles. **Análisis de
   wallets: descartado.** Empieza por **sorteos verificables**; un hub con varias herramientas y ElClub Pay también.
9. **Landing pública** con diseño creativo, interactivo y visual al nivel de `/start`, con sus CTA. **`/start` se
   reforma** para reflejar todos estos cambios.
10. Por "bounties de Base" el usuario se refiere a **grants y premios de Base**.
11. **Pueden donar los no miembros** desde la parte pública: aparecen en la lista (si quieren) como «donante
    externo». El rol Mecenas y los canales siguen siendo solo del club; si después entran, sus donaciones cuentan.
12. **Privacidad entre club y parte pública:** el perfil público es independiente (alias propio, espacio de nombres
    distinto del handle del club) y no muestra nada del club salvo que el miembro active la insignia «Miembro de
    ElClub.». Se avisa de que la dirección de la wallet es pública de todos modos.
13. **«Inicio» del foro privado se rehace** (2026-10-24) como introducción/dashboard visual e intuitivo, sin
    información innecesaria. Estructura «buscador protagonista»: saludo + **buscador grande estilo navegador** que
    funciona exactamente igual que el de Ctrl+K; debajo **accesos rápidos** (fichas con icono: sin leer, bounties
    abiertos, sorteo activo, encuesta abierta, donar/Mecenas), **«Continúa donde lo dejaste»** (canales con no
    leídos como tarjetas), **anuncio fijado destacado** (el más reciente; el resto tras «ver todos») y **actividad
    reciente** compacta. La tarjeta de la DAO desaparece.

## Decisiones de la IA (revisables; coste si es incorrecta entre paréntesis)
- **D1 Redes por entorno:** PRO = Base (8453) + Arbitrum One (42161); PRE y local = Base Sepolia (84532) + Arbitrum
  Sepolia (421614); Hardhat local en e2e simula Base Sepolia (84532) y Arbitrum Sepolia (421614) con dos nodos o, si
  no es viable, uno solo (84532). (Bajo: es configuración.)
- **D2 Sin "red activa" global.** `app_config.active_chain_id` y `set_active_chain` desaparecen del uso; cada RPC de
  dinero recibe `p_chain_id` y lo valida contra `app_config.enabled_chain_ids` (lista por entorno). El cliente nunca
  decide qué es válido. (Medio.)
- **D3 Activo = (token, red).** Lista cerrada en TS y en BD: USDC nativo (Circle) y ETH en cada red. Sin USDC.e
  puenteado (se rechaza con mensaje claro). (Bajo.)
- **D4 Selector de token** ordena por saldo del usuario (primero lo que puede pagar), muestra saldo por activo y al
  elegir cambia de red con `wallet_switchEthereumChain`; si la wallet no cambia, un botón "Cambiar a <red>" (patrón
  actual de `tip-dialog`). Logos SVG locales (CSP sin orígenes nuevos) en `public/brand/`. (Bajo.)
- **D5 Login:** AppKit ofrece las dos redes del entorno; SIWE acepta cualquiera de ellas. Base Account (smart
  wallet): se investiga si Supabase `signInWithWeb3` verifica firmas ERC-1271/ERC-6492; si no, v1 solo EOAs y se
  deja anotado. (Medio: Base Account suma puntos con Base.)
- **D6 La Safe del club** existe en Base y en Arbitrum **con la misma dirección** (CREATE2, mismos owners/threshold).
  La app no acepta donaciones en una red sin Safe desplegada y verificada por `getCode`. (Alto si se omite.)
- **D7 Donaciones:** nueva tabla `donations` (no se reutiliza `dao_ledger`). USDC o ETH en cualquiera de las dos
  redes; valor en USD fijado al verificar (USDC 1:1; ETH con Chainlink ETH/USD de esa red, con comprobación del
  *sequencer uptime feed* de L2). Verificación on-chain como hoy (recibo, log, `from` = wallet del miembro, `to` =
  Safe, finalidad por red, único `(chain_id, tx_hash, log_index)`). (Medio.)
- **D8 Reconocimiento:** rol de sistema **«Mecenas»** asignado automáticamente con la primera donación verificada.
  Canales exclusivos = permisos de canal dados a ese rol con el
  sistema de roles existente; además el gating del canal admite "donado total ≥ X USD" (sustituye a `min_share_bps` y
  `min_net_usdc`). Lista pública en `/donar` (o la ruta que sustituya a `/dao`) por total USD, con el interruptor
  de ocultarse que ya existe (`dao_ranking_visible`). (Bajo.)
- **D9 Transparencia sin fondo:** `/donar` muestra saldo de la Safe por red (lectura on-chain), donaciones
  recientes y **gastos con nota del tesorero** (reutiliza el escaneo de operaciones de la Safe y las notas, sin NAV
  ni participaciones). Sin gráficas de valor por share. `/donar` es **pública** (decisión 11): cualquiera con
  wallet puede donar; los miembros ven además su rol y sus canales. (Bajo.)
- **D10 DAO como histórico:** sus tablas, funciones y migraciones se quedan; la UI y los crons de NAV/retiradas se
  desconectan detrás de `app_config.legacy_dao_enabled = false`. Rutas antiguas (`/dao/...`) redirigen a la nueva.
  Sus tests de BD siguen pasando (o se marcan como legado si dependen de Linea). (Medio.)
- **D11 Sorteos:** azar con **drand quicknet** en lugar de block hash (en L2 el block hash lo controla el
  secuenciador; Arbitrum lo declara inseguro). Al crear: se publica `hash(seed)` y la **ronda de drand** posterior
  al cierre. Ganador(es) = `keccak(seed ‖ randomness) mod n` (y siguientes para varios premios, sin repetir). El
  verificador del navegador descarga la ronda de drand y la comprueba (firma BLS) y recalcula. Origen de drand
  añadido a la CSP. (Medio.)
- **D12 Premios de sorteo:** tipos `crypto` (token+red+importe, lo paga la Safe del club o el organizador y se
  verifica la transferencia), `role` (se asigna el rol al ganador automáticamente) y `custom` (texto + imagen
  opcional; el organizador marca "entregado"). Un sorteo puede tener varios premios (1.º, 2.º…). Sin entrada de pago,
  nunca. (Bajo.)
- **D13 Sin comisión:** propinas y bounties transfieren solo el importe al destinatario (una transacción). La
  configuración de comisión (`min_fee_bps`, monedero de plataforma) queda a 0 / sin uso; los textos y el desglose
  "importe + comisión" desaparecen. (Bajo.)
- **D14 Builder Codes (ERC-8021):** sufijo en el calldata de **toda** transacción que la app pide firmar en Base
  (propinas, bounties, donaciones, pagos públicos, premios, avales). Código en env `NEXT_PUBLIC_BASE_BUILDER_CODE`;
  sin código, no se añade nada. En Arbitrum no se añade. (Bajo.)
- **D15 Cuentas públicas:** las herramientas públicas que requieren identidad (crear sorteo, apuntarse, perfil de
  pago, avales) usan la misma sesión SIWE **sin ser miembro**. La RLS distingue `is_active_member()` (club) de
  `is_authenticated_wallet()` (público). Nada del club es visible para cuentas públicas. (Alto si se mezcla.)
- **D16 Rutas e idiomas:** español sin prefijo y inglés con `/en`. Visitante sin sesión en `/` → landing pública
  (reescritura en el proxy); con sesión de miembro → foro como hoy. Herramientas en `/herramientas/...` y
  `/en/tools/...`; `/start` (club) también en `/en/start`. Diccionarios propios en TS (sin librería si basta; si se
  usa, `next-intl` versión estable fijada). (Medio.)
- **D17 x402:** la API del comprobador cobra por consulta en USDC en Base vía el facilitador de Coinbase. En PRO el
  cobro queda **desactivado por defecto** (`app_config.x402_enabled = false`, la API responde gratis con límite de
  peticiones) hasta que el usuario confirme su alta fiscal. En PRE se prueba en Base Sepolia. (Bajo.)
- **D18 Avales EAS:** esquema "ElClub vouch" en Base: `attester` avala `recipient` (direcciones) con un campo
  `kind` corto; **sin handles ni texto libre on-chain**. El vínculo dirección↔perfil vive fuera de la cadena. Los
  firma el propio usuario (no ElClub.). (Medio, RGPD.)
- **D19 Alphas:** el diálogo pide red (logo) + contrato; `getCode` en esa red; DexScreener `base`/`arbitrum`.
- **D20 Bounty board público:** fuera de alcance (escrow = riesgo de custodia, ver informe).
- **D21 Datos y restricciones de Linea:** no se borra ninguna fila. Los `check (chain_id in (59144, 59141))` de las
  tablas **vivas** se sustituyen por una FK a una nueva tabla `chains (chain_id, enabled, …)` donde Linea queda con
  `enabled = false`; así las filas de prueba antiguas siguen siendo válidas y nada nuevo puede usar Linea. Las tablas
  y funciones **de la DAO legada** se dejan tal cual (congeladas, con sus checks de Linea) y sus pgTAP siguen pasando.
  (Medio.)
- **D22 Red del destinatario:** cada miembro/cuenta pública indica en su perfil en qué redes recibe (por defecto
  ambas). El selector de token solo ofrece activos de redes que el destinatario acepta. Aviso al configurar: "si tu
  dirección es de un exchange o una smart wallet, deja solo la red que admite". (Bajo.)
- **D23 Paso de cuenta pública a miembro:** el mismo usuario de auth se convierte en miembro al canjear la invitación.
  En `/`, un visitante con sesión pero sin membresía ve la landing pública (con acceso a "Mis herramientas").
- **D24 Premios cripto de sorteos del club:** solo quien tiene `MANAGE_TREASURY` crea sorteos del club con premio
  pagado por la Safe. El pago se registra pegando el hash de la transacción y se verifica on-chain (de la Safe al
  ganador, token e importe exactos); no depende del escaneo legado de la DAO.
- **D26 Buscador de Inicio:** es un campo real en la página (no un botón): al escribir, los resultados salen debajo
  con el mismo motor, las mismas secciones (canales, hilos, miembros, acciones) y el mismo teclado (↑↓, Enter, Esc)
  que la paleta Ctrl+K, reutilizando su cuerpo; Ctrl+K sigue abriendo la paleta. Las fichas sin dato (no hay sorteo
  ni encuesta abiertos) no se muestran. (Bajo: es UI.)
- **D25 Alcance de cada plan:** un plan detallado por bloque de §Prioridades. El plan del siguiente bloque se escribe
  cuando el anterior está terminado, para que parta de lo construido.

## Prioridades (orden de construcción; cada bloque = un plan y un PR a `develop`)
- **P0 — Fundación multired.** Redes y activos (D1–D4), Linea fuera, clientes por red, AppKit, CSP, variables de
  entorno (`BASE_*`/`ARBITRUM_*` RPC), readiness, finalidad y tamaños de escaneo por red, logos, Builder Codes (D14),
  login (D5), tests migrados de 59141 a las nuevas redes. Propinas y bounties funcionando en ambas redes con el
  selector de token.
  **Hecho (2026-10-24, rama `feature/base-arbitrum-y-parte-publica`).** Los huecos de este spec se resolvieron al
  planificar con los rulings P0-R1…P0-R14 de `docs/superpowers/plans/2026-10-24-p0-fundacion-multired.md` (sección
  "Decisiones del constructor"): islas legadas hasta P1 (P0-R2), la DAO y los sorteos en pausa con "se está rehaciendo",
  sin comisión (P0-R5), Builder Code solo en Base (P0-R6), "MODO PRUEBA" por entorno (P0-R12) y las cuatro redes
  habilitadas en BD (P0-R14). Si la wallet está en otra red que la moneda elegida, "Continuar" le pide cambiarla y el
  pago sigue solo.
- **P1 — Club simplificado.** Donaciones + Mecenas + lista + canales + transparencia (D6–D10), sin comisión (D13), encuestas 1p1v, sorteos rehechos (D11–D12) con textos nuevos, alphas multired (D19), guía
  actualizada y **nuevo «Inicio»** (decisión 13, D26) al final del bloque.
  **Hecho (2026-10-24, rama `feature/p1-club-simplificado`).** Los huecos de este spec se resolvieron al planificar con los rulings P1-R1…P1-R17 de `docs/superpowers/plans/2026-10-24-p1-club-simplificado.md` ("Decisiones del constructor"): `/donar` dentro del club hasta P2 (P1-R1), lista de donantes con opción de salir (P1-R2), Mecenas desde 1 USD (P1-R3), candados por total donado (P1-R4), precio de ETH solo con Chainlink y secuenciador (P1-R5), sin Safe desplegada no se ofrece donar (P1-R6), gastos anotados por hash (P1-R7), sorteos en tablas `giveaways*` con drand quicknet y premios USDC, rol o texto (P1-R8…R12) y nuevo «Inicio» con buscador protagonista (P1-R16). El legado de la DAO queda congelado (D10).
- **P2 — Parte pública I.** Cuentas públicas (D15), i18n y rutas (D16), **landing pública** creativa, hub
  `/herramientas`, **Sorteos verificables públicos**: cualquiera con wallet crea un sorteo gratis para su comunidad
  (X/Discord/Telegram) con premios de cualquier tipo, comparte un enlace, los participantes se apuntan firmando
  (sin gas), cierre + drand + página de verificación pública + tarjeta OG para compartir. Premio cripto: lo paga el
  organizador directamente al ganador y la app verifica la transferencia ("premio entregado ✓"). **Reforma de
  `/start`** y enlace cruzado landing ↔ club.
- **P3 — ElClub Pay.** Enlace/página de pago `elclub.party/pay/<alias o dirección>` con importe y token opcionales;
  paga cualquiera con su wallet directo al destinatario (sin comisión, sin custodia); recibo verificable; botón para
  incrustar; perfiles públicos mínimos.
- **P4 — Comprobador de tokens y enlaces + API x402.** Web: pegar contrato (Base/Arbitrum) o enlace → informe
  (contrato existe, código verificado, edad, liquidez en DexScreener, alertas; guardián de enlaces existente). API
  JSON con x402 (D17).
- **P5 — Avales EAS** (D18): miembros y cuentas públicas pueden avalar direcciones; perfil público muestra avales.
- **P6 — Más herramientas DeFi** (backlog, cada una pequeña): revisor y revocador de aprobaciones de tokens (genera
  transacciones de revocación en Base), envío múltiple de USDC/reparto de gastos, conversor y calculadora de gas por
  red. Se priorizan las que generan transacciones en Base.

## Landing pública (P2) — contenido
- Estética de la web llevada a landing como `/start`: negro, cian `--accent`, Archivo gigante, Motion, capas,
  revelados por scroll, maquetas en código, reduced motion completo. Distinta de `/start`: `/start` vende el club;
  la landing vende **herramientas abiertas** y deja el club como recompensa.
- Bloques: hero con la promesa ("Herramientas cripto honestas, verificables y gratis") → demo viva de un sorteo
  verificable (animación del commit → drand → ganador) → ElClub Pay (enlace que se convierte en pago) → comprobador
  (pega un contrato, ves alertas) → "Construido en Base · también en Arbitrum" con logos → el club ("Lo mejor está
  dentro: un foro privado por invitación") → CTA: "Crear sorteo" (primario), "Crear enlace de pago", "Qué es
  ElClub." → pie con avisos (sin custodia, no es asesoramiento).
- Bilingüe, indexable solo en producción (patrón `isProductionSite()` existente), OG por idioma.

## Requisitos transversales
- TDD (unit + pgTAP + e2e) y SDD con subagentes; `ui-ux-pro-max` antes de cada UI; tokens de `globals.css`, sin hex.
- Accesibilidad AA, 375–1920 sin scroll horizontal, objetivos táctiles ≥ 44 px, reduced motion.
- CSP: solo orígenes nuevos imprescindibles (RPCs de Base/Arbitrum, drand, facilitador x402, EAS si se lee por API).
- Límite de peticiones (sistema existente en Postgres) en todo lo público: crear sorteo, apuntarse, comprobador, API.
- Antiabuso en sorteos públicos: una entrada por wallet; opcional "solo wallets con N transacciones" o lista de
  direcciones pegada por el organizador (sin integraciones con X/Discord en v1).
- Textos cortos. Cada pantalla de dinero recuerda: ElClub. no custodia fondos; donar no da derechos económicos.
- `pnpm test:unit` mientras el usuario prueba; los tests completos borran la BD local.

## Fuera de alcance
- Integración con bots de Discord/Telegram (fase posterior), bounty board público con escrow, análisis de wallets,
  mercados de predicción, Linea, migración de datos de prueba de Linea, contrato Vault.

## ⚠️ HACER A MANO ⚠️ (el usuario; cada plan lo recuerda cuando haga falta)
1. ✅ Safe del club: `0x380f2e12081995359e2Ab88E3c31c6b227904234`, añadida en Base, Arbitrum, Base Sepolia y
   Arbitrum Sepolia. **Pendiente: activarla (desplegarla) en cada una** — el 2026-10-24 `eth_getCode` devuelve `0x`
   en las cuatro (solo está desplegada en Linea mainnet). Al activarla, comprobar owners y umbral: una Safe añadida a
   otra red se despliega con la configuración **original**, no con los cambios posteriores.
2. ✅ Builder Code: `bc_ttxulybv` (va en `NEXT_PUBLIC_BASE_BUILDER_CODE`).
3. ✅ RPC Infura de Base y Arbitrum (mainnet y Sepolia) entregadas por el usuario; van en `.env.local`, Vercel y
   `web.env` de PRE como secretos (`BASE_RPC_URL`, `BASE_SEPOLIA_RPC_URL`, `ARBITRUM_RPC_URL`,
   `ARBITRUM_SEPOLIA_RPC_URL`), nunca en el repo.
4. Explorador: la API de Etherscan V2 para Base requiere plan de pago; alternativa Blockscout (decidir al planificar).
5. Antes de activar x402 con dinero real: hablar con un gestor (alta, IRPF, IVA).
6. Reown: añadir las nuevas redes no requiere cambios de dominio; revisar que el proyecto permite Base y Arbitrum.
7. Candados de canal (P1): al desplegar P1, los canales con candado quedan abiertos (las reglas antiguas de % y aportación neta dejan de aplicarse): vuelve a fijar cada candado en Ajustes → canal → «Donado mínimo (USD)». Mientras tanto su contenido es visible para todos los miembros.
