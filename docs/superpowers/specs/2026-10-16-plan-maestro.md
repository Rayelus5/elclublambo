# Plan Maestro — elclublambo (Foro Web3 asíncrono en Linea)

## Contexto
Foro asíncrono solo con invitación que sustituye a Discord para una comunidad cripto. Combina RBAC estilo Discord, lectura profunda tipo Discourse, estética Linear, autenticación SIWE en Linea, propinas P2P y una tesorería DAO con participaciones (%). El repo está vacío (`README.md`, `INSTRUCCIONES_PROYECTO.md`, commit `d1084a8`). Git ya estaba inicializado.
Entorno disponible: Node 24.19, npm 11.17 y Docker 29.8. No hay pnpm (lo activaré con `corepack`) ni Supabase CLI (irá como devDependency).

**Decisiones del usuario:**
- Tesorería en Safe multisig con ledger en Supabase y contabilidad por **shares**, con retiros (riesgo legal asumido; habrá aviso en la UI).
- La tesorería acepta **solo USDC**.
- Gating VIP con **dos reglas por canal**: % mínimo o aportación neta mínima.
- Encuestas con peso **configurable**: igualitario, lineal o cuadrático.
- Acento **cian #61DFFF**; fuentes **Archivo Expanded + DM Sans** y JetBrains Mono para datos.

---

## 1. Sistema de diseño (base: ui-ux-pro-max)
Fuentes de la skill: estilo *Exaggerated Minimalism* con toques de *Brutalism* (bordes visibles, radios mínimos). Descarté su recomendación automática (Orbitron/Exo 2 sobre slate #0F172A) por ser cliché y "AI slop".

**Tokens semánticos** (CSS vars en `:root`; ningún componente usa hex sueltos):
| Token | Valor | Uso |
|---|---|---|
| `--bg` | #0A0A0A | fondo (negro neutro, no slate) |
| `--surface` / `--surface-2` | #111111 / #171717 | paneles y hover |
| `--border` | #262626 (fuerte: #3A3A3A) | bordes de 1px **en lugar de sombras** |
| `--fg` | #EDEDED | texto (~16:1) |
| `--fg-muted` | #A3A3A3 | secundario (~8:1) |
| `--accent` | #61DFFF | único acento (~12:1), texto encima #0A0A0A |
| `--success` | #3DDC84 | "post recompensado", tx confirmada |
| `--warning` | #FFB020 | guardián de enlaces |
| `--danger` | #FF5A5A | baneos y errores |

Para que el cian no parezca el "crypto azul" genérico: nada de glows, degradados ni glassmorphism. El cian solo aparece en foco, CTA primario, enlaces y estados activos.

**Tipografía:**
- Títulos: Archivo (variable, `wdth 112–125`, `wght 800–900`, tracking -0.02em).
- Cuerpo: DM Sans 400/500/700. Datos (hashes, direcciones, importes): JetBrains Mono 400/500.
- Escala: display `clamp(2.5rem,6vw,5rem)`/900 · h1 2.25rem/800 · h2 1.5rem/800 · h3 1.125rem/700 · cuerpo 17px/1.65 · small 13px.
- Columna de lectura de 68ch como máximo.

**Espaciado y forma:**
- Base de 4px; escala 4·8·12·16·24·32·48·64·96·128.
- Radios de 2px (controles) y 4px (paneles).
- Layout: sidebar de canales 264px | contenido | rail derecho 320px (colapsa en <1024px).

**Movimiento:** solo Motion (framer), sin GSAP. Lo dicta la regla de la skill de "1–2 animaciones por vista", y para micro-interacciones no compensa su peso.
- Duraciones de 150–250ms con ease-out.
- Se respeta `prefers-reduced-motion`.

**Accesibilidad:** contraste ≥4.5:1, anillo de foco de 2px `--accent` con offset de 2px, objetivos táctiles ≥44px, iconos SVG Lucide (nunca emojis).

---

## 2. Crítica de arquitectura y decisiones técnicas

**Auth: SIWE + Supabase**
- **La puerta de acceso va en la base de datos, no en el registro.**
  - Autenticarse con la wallet no da acceso a nada.
  - El acceso lo da una fila en `members` con `status='active'`.
  - Todas las políticas RLS pasan por `is_active_member()`.
  - Así, una wallet sin invitación tiene sesión, pero solo puede llamar a `redeem_invite()`.
- **Spike en F1, Tarea 1:** probar `supabase.auth.signInWithWeb3({chain:'ethereum'})` nativo (EIP-4361).
  - Si falla con el chainId de Linea o con OKX, plan B: ruta propia que verifica con `viem.verifySiweMessage` y emite un JWT compatible con Supabase.
  - El nonce va de un solo uso en BD, con TTL de 5 minutos, y se valida dominio + URI + chainId ∈ {59144, 59141}.
- **La dirección de la wallet sale siempre de la identidad del token, nunca del cliente.** Se normaliza a minúsculas.
- **Bootstrap del SuperAdmin:** RPC solo de servidor (service role).
  - Solo funciona si **no existe todavía ningún SuperAdmin** y la wallet coincide con `SUPER_ADMIN_WALLET`.
  - Queda registrado en `audit_log`.
  - Cambiar la variable más tarde no concede nada.
- **Wallets:** wagmi + viem + RainbowKit, con las cadenas forzadas a `linea` y `lineaSepolia`. MetaMask y OKX vienen incluidos.

**RBAC estilo Discord**
- Permisos en un bitfield `bigint`.
- Una función SQL `channel_permissions(member, channel)` aplica el algoritmo de Discord: base (`@everyone` OR roles) → `ADMINISTRATOR` lo concede todo → overwrites de categoría → overwrites de canal (en cada nivel, en este orden: everyone deny/allow → roles deny y luego allow → miembro deny/allow) → overrides globales del miembro (penalizaciones) → **gating DAO**.
- Hay un espejo en TypeScript, y ambos se prueban contra **los mismos casos en JSON** para que no diverjan.
- Jerarquía: nadie puede asignar, editar ni banear roles o miembros con posición ≥ a la suya.

**Tesorería con shares (modelo ERC-4626 fuera de la cadena)**
- Al donar `d` USDC: `shares = S==0 ? d·10¹² : d·S/V`, donde `V` es el valor del **ledger**, no el balance on-chain. Así una transferencia directa no registrada no puede inflar el valor de las shares, que es el ataque clásico de inflación.
- El % de cada usuario es `shares_u / S`. Los gastos de los admins (sorteos, recompensas) bajan `V` y no el %.
- El retiro quema shares: el importe es `shares·V/S`, fijado en el momento de la aprobación.
- Todos los cálculos usan `bigint` y `numeric(78,0)`. Nunca floats.
- Un job de reconciliación compara `V` con el balance USDC de la Safe y avisa de cualquier desviación.
- **Verificación de cada tx entrante (donación o propina):**
  - recibo con `status=success` y `chainId=59144`;
  - log `Transfer` del contrato USDC oficial (la dirección se verifica en docs de Circle/Linea, no la pongo de memoria);
  - `to` = Safe y `from` = wallet del usuario autenticado (nadie reclama donaciones ajenas);
  - bloque `finalized`;
  - `UNIQUE(chain_id, tx_hash, log_index)` contra la reutilización del mismo hash.
- **Aviso:** la Safe implica confiar en los admins. Si la comunidad crece, en la F5 se puede migrar a un contrato Vault auditado.

**Riesgos que quedan aceptados, con su mitigación**
- **Retiros y sorteos ponderados:** mostrar un aviso legal y revisarlo con un abogado antes de activarlos en mainnet. Ambos van detrás de un flag de configuración, desactivado por defecto en mainnet.
- **Gating por %:** se diluye cuando otros donan. La UI lo explica, y por eso existe también la regla de aportación neta absoluta.
- **Encuestas:** el peso se fija con un **snapshot al crear la encuesta**, para que nadie pueda donar a mitad de votación y cambiar el resultado.
- **Árbol de invitaciones público:** se ve solo dentro del foro, que ya es solo para miembros. Aun así enlaza pseudónimos entre sí, y lo explico en el onboarding.
- **Bounties sin escrow:** son un compromiso, no un depósito. Si el autor acepta una solución y no paga en N días, recibe la marca pública "bounty impagado". El escrow real necesitaría un contrato (F5).

**Editor:** BlockNote (basado en Tiptap), por el comando `/`, los bloques y las tablas que trae de serie.
- El contenido se guarda como **JSON, nunca HTML**.
- Se renderiza en servidor, con los enlaces pasando por el Guardián.
- Imágenes en Storage con RLS, límite de 5MB, solo png/jpeg/webp/gif y sin SVG (vector de XSS).

---

## 3. Esquema PostgreSQL (resumen; el DDL completo se escribe en F1–F4 con TDD y pgTAP)

**Identidad y acceso (F1)**
- `members`:
  - `id`, `auth_user_id` (uniq) → auth.users, `wallet_address` (citext uniq, check `^0x[0-9a-f]{40}$`)
  - `display_name`, `avatar_path`, `status` (active|banned|left)
  - `invited_by_member_id` → members, `invite_id` → invites
  - `is_bootstrap` bool; CHECK `(invited_by_member_id IS NOT NULL) OR is_bootstrap`
- `siwe_nonces` (solo con el plan B)
- `invites`:
  - `id`, `code` (uniq, 128 bits aleatorios), `created_by` → members
  - `max_uses`, `uses`, `expires_at`, `revoked_at`, `revoked_reason`
- `invite_redemptions`: `invite_id`, `member_id` (uniq), `redeemed_at`
- `bans`:
  - `id`, `member_id`, `banned_by`, `reason`, `created_at`, `lifted_at`
  - `sponsor_penalized` bool, `sponsor_member_id`
- `member_permission_overrides`: `member_id` PK, `allow` bigint, `deny` bigint, `reason`, `set_by`. Es la penalización global, por ejemplo deny `CREATE_INVITES`.
- `audit_log`: `id`, `actor_id`, `action`, `target_type`, `target_id`, `payload` jsonb, `created_at` (append-only)
- `app_config`: flags (`withdrawals_enabled`, `weighted_raffles_enabled`, …)

**RBAC y foro (núcleo de roles en F1, el resto en F2)**
- `roles`: `id`, `name`, `color`, `position`, `permissions` bigint, `is_everyone`, `is_system`
- `member_roles`: (`member_id`, `role_id`)
- `categories`: `id`, `name`, `position`
- `channels`:
  - `id`, `category_id`, `name`, `slug`, `topic`, `position`
  - `gate_mode` (none|min_share_bps|min_net_usdc), `gate_value` numeric, `gate_scope` (view|post)
- `permission_overwrites`:
  - `id`, `scope` (category|channel), `scope_id`, `target_type` (role|member), `target_id`
  - `allow` bigint, `deny` bigint, con unique sobre (scope, scope_id, target)
- `threads`:
  - `id`, `channel_id`, `author_id`, `title`, `kind` (discussion|alpha|bounty)
  - `body` jsonb, `search_tsv` (generada), `pinned`, `locked`, timestamps
- `posts` (respuestas anidadas): `id`, `thread_id`, `parent_id`, `author_id`, `body` jsonb, `search_tsv`, `deleted_at`
- `alpha_details`: `thread_id` PK, `contract_address` (check de dirección), `chain_id` = 59144, `verified_contract` bool (se comprueba con `getCode`)
- `bounty_details`:
  - `thread_id` PK, `amount`, `token` (ETH|USDC), `status` (open|accepted|paid|cancelled)
  - `accepted_post_id`, `accepted_at`, `award_tip_id` → tips
- `allowed_domains`: `domain` PK, `added_by`. Semilla: lineascan.build, sepolia.lineascan.build, linea.build, github.com, x.com, dexscreener.com, etherscan.io.

**Economía (F3–F4)**
- `tips`:
  - `id`, `chain_id`, `tx_hash`, `log_index` (-1 para ETH nativo), `from_member`, `to_member`
  - `target_type` (thread|post|profile), `target_id`, `token`, `amount` numeric(78,0)
  - `block_number`, `verified_at`; UNIQUE(chain_id, tx_hash, log_index)
- `dao_ledger` (append-only):
  - `id`, `kind` (donation|withdrawal|expense|raffle_payout|reward), `member_id`
  - `amount_usdc`, `shares_delta`, `tx_hash`, `log_index`, `verified_at`, `note`
  - UNIQUE(chain_id, tx_hash, log_index)
- `dao_state` (fila única): `total_shares`, `value_usdc`, `updated_at`, actualizada por trigger
- `dao_positions`: `member_id` PK, `shares`, `net_contributed_usdc`, mantenida por trigger, con `share_bps` calculado. Gating y RLS consultan esta tabla en O(1), sin agregados por fila.
- `withdrawal_requests`:
  - `id`, `member_id`, `shares_requested`, `status` (PENDING_WITHDRAWAL|APPROVED|PAID|REJECTED|CANCELLED)
  - `amount_usdc_locked` (fijado al aprobar), `approved_by`, `payout_tx_hash`, `paid_at`
  - Índice parcial único: 1 PENDING por miembro; las shares quedan bloqueadas mientras tanto.
- `raffles`:
  - `id`, `title`, `prize_usdc`, `mode` (equal|weighted), `status` (open|closed|drawn|paid)
  - `seed_commit` (hash), `seed_reveal`, `draw_block_number`, `draw_block_hash`
  - `winner_member_id`, `payout_tx_hash`
- `raffle_entries`: `raffle_id`, `member_id`, `weight` (snapshot al cerrar)
- `polls`: `id`, `thread_id`, `question`, `weight_mode` (equal|linear|quadratic), `closes_at`
- `poll_options`
- `poll_weight_snapshots`: `poll_id`, `member_id`, `weight`, fijado al crear la encuesta
- `poll_votes`: `poll_id`, `member_id` PK compuesta, `option_id`

**Patrón RLS**
- RLS activa en todas las tablas y denegación por defecto.
- Helpers `SECURITY DEFINER STABLE SET search_path=''`: `current_member_id()`, `is_active_member()`, `has_global_perm(bit)`, `channel_permissions(member, channel)`, `can(channel, bit)`.
- `threads/posts`: SELECT si `can(channel, VIEW_CHANNEL)`, que ya incluye el gating DAO.
  - INSERT de thread si `can(CREATE_THREADS)`; INSERT de post si `can(SEND_REPLIES)` y el hilo no está locked.
  - UPDATE/DELETE para el autor o con `MANAGE_MESSAGES`.
- `members`: SELECT para miembros activos; así el árbol de invitaciones es público dentro del foro. El UPDATE solo afecta a tus propios campos de perfil.
- **Escrituras sensibles solo por RPC o servidor:** `redeem_invite`, `ban_member`, `record_tip`, `record_donation`, `request_withdrawal`, `mark_withdrawal_paid`, `draw_raffle`, `cast_vote`.
  - El cliente no tiene INSERT directo en ledger, tips ni bans.
  - Las RPC que dependen de verificación on-chain se ejecutan con service role desde Server Actions, después de verificar con viem.
- `dao_*`, `tips`, `raffles`: SELECT para todos los miembros activos (transparencia), sin escritura desde el cliente.
- `search(q)`: `SECURITY INVOKER`, así la RLS filtra los resultados y Cmd+K nunca filtra contenido de canales que no puedes ver.

**Bits de permisos:**
- `VIEW_CHANNEL`, `CREATE_THREADS`, `SEND_REPLIES`, `MANAGE_MESSAGES`
- `CREATE_INVITES`, `BAN_MEMBERS`, `MANAGE_ROLES`, `MANAGE_CHANNELS`
- `MANAGE_TREASURY`, `ADMINISTRATOR`

**Flujos clave**
- **`ban_member(target, reason, penalize_sponsor)`**, en una sola transacción:
  1. Comprueba jerarquía y el permiso `BAN_MEMBERS`, y pone `status='banned'`.
  2. Revoca las invitaciones activas del baneado.
  3. Si `penalize_sponsor`: añade deny `CREATE_INVITES` al padrino y revoca sus invitaciones activas.
  4. Marca a los ahijados del baneado como "en revisión" (sin banearlos automáticamente).
  5. Escribe en `audit_log` y cierra las sesiones del baneado.
- **Guardián de enlaces:** se parsea con `URL`. El host está permitido si coincide exactamente con un dominio de la lista o es un subdominio con límite de punto (`github.com.evil.io` no pasa). Los IDN se muestran en punycode.
  - Si no está permitido, el enlace pasa por la página `/out?u=`, con aviso y el dominio real.
  - Todos los enlaces llevan `rel="noopener noreferrer nofollow ugc"`.
- **DexScreener:** iframe `dexscreener.com/linea/<addr>?embed=1&theme=dark`, con `sandbox`, CSP `frame-src` restringida y carga lazy con `next/dynamic`.
- **Sorteos verificables:**
  1. Al crear, se hace commit de `hash(seed)`.
  2. Al cerrar, se toma un snapshot de los pesos.
  3. El ganador sale de `keccak(seed ‖ blockhash del primer bloque de Linea posterior al cierre) mod peso_total`.
  4. Cualquiera puede recalcularlo desde la UI.

---

## 4. Fases

**F1 — Fundaciones, identidad y gatekeeping** (crece un ~35% con los nuevos casos de uso)
1. Scaffold:
   - Next.js (App Router, versión estable actual), TS estricto, Tailwind, shadcn/ui y los tokens de la §1 (con fuentes vía `next/font`).
   - Vitest + RTL, Playwright, `supabase init` local con Docker y pgTAP (`supabase test db`).
   - `.gitignore` y `.env.example`.
   - Trabajo en un worktree (`using-git-worktrees`).
2. Spike de auth Web3: Supabase nativo vs plan B con SIWE + JWT. Decido con un test E2E que use una wallet mock de viem (connector `mock` de wagmi).
3. Migración: `members`, `invites`, `invite_redemptions`, `roles` (núcleo: @everyone, Member, SuperAdmin), `member_roles`, `member_permission_overrides`, `bans`, `audit_log`, `app_config` y los helpers RLS de permisos globales. Todo con pgTAP primero.
4. Bootstrap del SuperAdmin y la RPC `redeem_invite`: atómica con `FOR UPDATE`, controla usos y caducidad, y fija `invited_by` desde la invitación.
5. UI de generación de invitaciones (`CREATE_INVITES`, usos y caducidad) y página `/invite/[code]`.
6. Perfil básico: wallet, quién te invitó y a quién has invitado (árbol a 1 nivel; más niveles a demanda).
7. Baneo con penalización en cascada opcional y panel admin mínimo de miembros.
8. Shell de la app: layout de 3 columnas vacío, conexión de wallet y proxy/middleware de sesión.
**Hecho cuando:** una wallet sin invitación no ve nada; el SuperAdmin entra sin invitación; un invitado entra con un código válido; un código caducado o agotado se rechaza; el baneo con penalización revoca las invitaciones del padrino. Cada uno de estos puntos tiene su test, sea pgTAP o E2E.

**F2 — RBAC completo y motor del foro**
- Gestión de roles (colores, jerarquía, matriz de permisos) y overwrites por categoría y canal, con la función SQL y su espejo en TS compartiendo fixtures.
- Categorías → canales → hilos → respuestas anidadas, y editor BlockNote con subida a Storage.
- Guardián de enlaces con `allowed_domains` administrable.
- Cmd+K con búsqueda tsvector que respeta RLS.
- Plantilla Alpha/Tesis con widget de DexScreener.
- Ganchos de gating ya presentes en `channel_permissions`, devolviendo pass mientras no haya datos.

**F3 — Economía en Linea: propinas, bounties y tesorería (inflows)**
- Propinas P2P en ETH y USDC con verificación en servidor, más insignia de "post recompensado".
- Bounties: aceptar solución → propina → `paid`, más la marca de bounty impagado.
- Safe de la DAO: donación USDC → verificación → ledger → shares → `dao_positions`.
- Dashboard público: balance, ranking con %, historial.
- Gating de canales activo, con ambas reglas.
- Job de reconciliación.

**F4 — Gobernanza de la tesorería**
- Exit requests: PENDING → APPROVED (importe fijado) → PAID (verificación de la tx de salida desde la Safe al usuario por el importe exacto) → quema de shares.
- Sorteos (igualitario/ponderado, commit-reveal).
- Encuestas con peso configurable y snapshot.
- Panel admin de tesorería y flags legales.

**F5 — Endurecimiento y producción**
- `security-review` y rate limiting en las RPC.
- Cabeceras CSP; despliegue en Vercel + Supabase Cloud; paso de Sepolia a mainnet.
- Monitorización.
- Opcional: contrato Vault auditado para quitar la dependencia de confiar en los admins.

Cada tarea sigue el ciclo: plan detallado (`writing-plans`) → RED/GREEN/REFACTOR → `verification-before-completion` → `requesting-code-review`. Antes de cada componente visual se hace una consulta a `search.py`.

---

## 5. ⚠️ HACER A MANO ⚠️ (antes de arrancar F1)
1. **Abre Docker Desktop** y déjalo en marcha: Supabase local corre en contenedores.
2. **Pásame la dirección PÚBLICA de tu wallet de admin** (`0x…`), la que irá en `SUPER_ADMIN_WALLET`. **Nunca la clave privada ni la frase semilla.**
3. **Crea un projectId de WalletConnect/Reown** (RainbowKit lo necesita para OKX/WalletConnect):
   a. Entra en https://dashboard.reown.com e inicia sesión.
   b. "Create Project" → tipo "AppKit" o "WalletKit" → nombre `elclublambo`.
   c. Copia el **Project ID** y pásamelo; es público y se puede compartir.
   d. En "Domains", añade `http://localhost:3000`.
4. (Recomendado) Usa una **wallet de pruebas distinta** a la principal para los tests manuales en Linea Sepolia. En F1 no hace falta gas, porque firmar SIWE es gratis.

No hace falta crear el proyecto de Supabase Cloud hasta la F5: todo corre en local.
**Para la F3 te pediré:** crear la Safe 2-de-3 en Linea (app.safe.global), ETH de faucet en Linea Sepolia y una API key de un RPC (Infura o Alchemy para Linea).

---

## 6. Verificación
- `pnpm test` (Vitest: permisos en TS, guardián de enlaces, cálculo de shares con bigint, verificación de tx con viem mockeado).
- `supabase test db` (pgTAP: cada política RLS con un caso permitido y otro denegado, por rol, y los flujos de invitación, baneo, gating y shares).
- `pnpm test:e2e` (Playwright con wallet mock: login sin invitación bloqueado, bootstrap del admin, canje de invitación, baneo en cascada).
- `pnpm lint && pnpm typecheck`.
- Al final de cada fase: arrancar la app con `run`, comprobar a mano en 375/768/1024/1440px y pasar el checklist de la skill.
