// The game servers players connect to (2026-11-17, the owner: «actualmente solo hay un servidor multijugador (España)
// será visible (junto con el ping) por si en un futuro añadimos más servers en otros países»). One today, the home
// server in Spain. A new one is infrastructure (its own origin, the security policy's connect-src, cookies across
// origins), so the list lives in the code, not in the live config. Its name is in the web's copy (`coop.servers`).

export interface GameServer {
  id: string;
  /** Its country's flag (ISO 3166-1 alpha-2, lowercase), drawn by the web. */
  flag: string;
  /** Where to measure its ping: a 204 that touches nothing (apps/server/src/health.ts, `registerPing`). */
  ping: string;
}

export const GAME_SERVERS: readonly GameServer[] = [{ id: 'es', flag: 'es', ping: '/galaxy/api/ping' }];
