# F5 — Endurecimiento y producción (diseño)

Fecha: 2026-10-19. Rama: `feat/f5-produccion` (desde main a3b483b, F4 mergeada).

## Intención
Poner elclublambo en producción real (Linea mainnet, dinero real) y montar una preproducción 24/7 en el servidor
Proxmox del usuario para probar cada cambio antes de producción. Antes, endurecer la app (revisión de seguridad,
límite de peticiones, cabeceras). El usuario no tiene nada configurado: todo lo manual va en guías paso a paso.

## Decisiones del usuario (2026-10-19)
- Producción: **Linea mainnet**. Desarrollo y preproducción: **Linea Sepolia** (o Hardhat local en desarrollo).
- Nube: **Vercel Pro** (ya contratado) + **Supabase Free** (puede subir de plan). Crons nativos de Vercel.
- Dominio: **elclub.party** comprado en **Cloudflare**. Producción en `elclub.party`; preproducción en
  `pre.elclub.party` vía **Cloudflare Tunnel** (sin abrir puertos).
- Preproducción: **Supabase self-hosted en Docker** dentro del servidor Proxmox, junto a la web.
- Flujo git: **`develop` → preproducción** (despliegue automático), **`main` → producción**. PR develop → main.
- RPC: Infura (mainnet y Sepolia) — ya tiene claves.
- Safe de mainnet: hoy 1-de-1; la guía explica pasar a 2-de-3 con wallets propias (recomendado antes de dinero real).
- Extras: **ninguno** (sin Sentry, sin copias automáticas, sin alertas externas, sin contrato Vault). DiceBear vía su
  API pública (sin cambios).
- El usuario puede instalar conexiones MCP (Vercel, Supabase, Cloudflare); hay que comprobar qué puedo hacer con
  ellas y no depender de que existan.

## Objetivos
1. **Revisión de seguridad completa** de la app (no solo F4): auth SIWE, RLS, RPCs, server actions, proxy, Storage,
   Realtime, push, cron, secretos, dependencias. Arreglar lo que salga.
2. **Límite de peticiones** en las acciones abusables (login/nonce, canje de invitaciones, mensajes, reportes,
   subida de imágenes, intents de donación, votos, propinas y verificaciones on-chain que gastan RPC). Debe
   funcionar igual en producción (Vercel) y preproducción (self-hosted) → implementado en Postgres, no en un servicio
   externo.
3. **Cabeceras de seguridad** completas: CSP con `default-src` y todas las fuentes reales (Supabase, RPCs, Reown,
   WalletConnect, CoinGecko, DiceBear, DexScreener), HSTS, `X-Content-Type-Options`, `Referrer-Policy`,
   `Permissions-Policy`. Sin romper el login con wallet ni el verificador de sorteos. El origen de Supabase sale de
   la variable de entorno (distinto en cada entorno).
4. **Producción en Vercel**: `vercel.json` con el cron horario de `/api/cron/dao` (Vercel cron hace GET con
   `Authorization: Bearer $CRON_SECRET`), región cercana a Supabase, migraciones aplicadas **antes** del despliegue
   del código (GitHub Action en push a main: `supabase db push` → deploy hook de Vercel; auto-deploy de main en
   Vercel desactivado para respetar el orden), previews sin acceso a la BD de producción.
5. **Preproducción en casa**: imagen Docker de la web (Next standalone), Supabase self-hosted oficial, cron horario
   en un contenedor, Cloudflare Tunnel (`pre.elclub.party` web, `pre-api.elclub.party` API de Supabase; Studio nunca
   expuesto), despliegue automático en push a `develop` mediante un runner self-hosted de GitHub Actions en el
   servidor (build → migraciones → reinicio), datos persistentes en volúmenes.
6. **Comprobador de RPC** (`scripts/check-rpc.mjs`): verifica que la RPC configurada sirve estado histórico
   (archive) y `eth_getLogs` de ≥2000 bloques en la cadena activa, sin imprimir la clave.
7. **Checklist de mainnet** comprobada en código: direcciones verificadas de USDC/WETH/Chainlink en 59144,
   retiradas desactivadas por defecto, sorteos ponderados desactivados en mainnet, overrides de oráculo ignorados en
   59144, `NEXT_PUBLIC_LINEA_*_RPC_URL` vacías.
8. **Guías** (en el repo, en español):
   - `docs/deploy/produccion.md` — para el usuario, paso a paso desde cero: Cloudflare (DNS), Supabase Cloud
     (proyecto, auth Web3, Realtime privado, URLs, claves), Vercel (proyecto, dominio, variables, cron, región),
     GitHub (secrets, rama develop, protección de ramas), Safe 2-de-3, VAPID, Reown (dominios), primer arranque
     (bootstrap del SuperAdmin, configurar Safe en `/settings/economia`), verificación y copias manuales.
   - `docs/deploy/preproduccion-homelab.md` — para otra IA que opera dentro del servidor Proxmox: crear la VM/LXC,
     Docker, Supabase self-hosted, la web, cron, Cloudflare Tunnel, runner de GitHub, variables, comprobaciones,
     mantenimiento. Autocontenida y ejecutable sin contexto de este chat.
   - Matriz de variables de entorno por entorno (desarrollo / preproducción / producción).
   - Qué MCP instalar y qué puedo hacer yo con cada uno.

## No objetivos
- Contrato Vault, Sentry, alertas externas, copias automáticas, CDN de imágenes propio, DiceBear propio.
- Escalado (el foro empieza con pocos usuarios).
- Cambiar el modelo de tesorería.

## Anti-objetivos (fallo aunque "funcione")
- Que una preview de Vercel o la preproducción pueda escribir en la BD de producción.
- Que un secreto (service role, CRON_SECRET, claves RPC, VAPID privada) acabe en el bundle del cliente, en el repo o
  en los logs.
- Que el código nuevo se sirva antes de que su migración esté aplicada.
- Que la CSP rompa el login, el pago o el verificador y nadie lo note (debe probarse en e2e de producción).
- Que el límite de peticiones bloquee el uso normal de un miembro.

## Restricciones
- Next.js 16 (ver `node_modules/next/dist/docs/`), cacheComponents. TDD; pgTAP para SQL; e2e en dev y E2E_PROD.
- No usar las wallets reales del usuario en pruebas. No commitear `.env*` ni secretos.
- Las acciones externas irreversibles (crear proyectos, DNS, despliegues, push a main/develop) las hace el usuario o
  yo vía MCP solo con su confirmación.

## Decisiones dejadas al constructor (registradas como rulings)
- Umbrales concretos del límite de peticiones (generosos para uso humano).
- Forma exacta de la CSP (con o sin nonces según lo que permita Next 16 con cacheComponents).
- Imagen base y estructura del docker-compose de preproducción.
