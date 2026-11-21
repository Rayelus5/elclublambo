import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { ZodError } from 'zod';
import { clearSessionCookie, registerSessionReader } from './auth/guards';
import { registerAuthRoutes } from './auth/routes';
import { createDraftService } from './config/drafts';
import { registerDraftRoutes } from './config/drafts-routes';
import { registerConfigRoutes } from './config/routes';
import { registerCollectionRoutes } from './collection/routes';
import { registerGachaRoutes } from './gacha/routes';
import { registerRunRoutes } from './runs/routes';
import { SoloFeeds } from './runs/solo-feeds';
import { registerSoloStreamRoutes } from './runs/stream-routes';
import { registerStationRoutes } from './station/routes';
import { type Landing, registerLanding } from './landing';
import { registerLabRoutes } from './lab/routes';
import { registerPlanetariumRoutes } from './planetarium/routes';
import { registerSocialRoutes } from './social/routes';
import { registerClanRoutes } from './clans/routes';
import { ChatHub } from './chat/hub';
import { LiveHub } from './realtime/live-hub';
import { createRooms, registerRoomRoutes } from './coop/room-routes';
import { registerCoopPlayRoutes } from './coop/play-routes';
import { registerPlayerReportRoutes } from './coop/reports';
import { CoopService } from './coop/service';
import { registerFriendRoutes } from './social/friend-routes';
import { friendIdsOf, prefsOf } from './social/friends';
import { registerChatRoutes } from './chat/routes';
import { registerMarketRoutes } from './market/routes';
import { registerTradeRoutes } from './market/trade-routes';
import { registerAdminRoutes } from './admin/routes';
import { registerModerationRoutes } from './admin/moderation-routes';
import { registerAdminMarketRoutes } from './admin/market-routes';
import { registerCommunicationRoutes } from './admin/communication-routes';
import { startMailJobs } from './mail/jobs';
import { registerNewsRoutes } from './news/routes';
import { registerStatsRoutes } from './admin/stats-routes';
import { registerReferralRoutes } from './referrals/routes';
import { type Disk, serverDisk } from './admin/storage';
import { registerAdminRunRoutes } from './admin/runs-routes';
import { registerAdminProgressRoutes } from './admin/progress-routes';
import { registerMailRoutes } from './mail/routes';
import { registerMissionRoutes } from './missions/routes';
import { registerCosmeticsRoutes } from './cosmetics/routes';
import { registerCatalogRoutes } from './catalog/routes';
import { registerCodexRoutes } from './codex/routes';
import { registerOnboardingRoutes } from './onboarding/routes';
import { registerTutorialRoutes } from './onboarding/tutorial';
import { registerSettingsRoutes } from './settings/routes';
import { registerNotesRoutes } from './notes/routes';
import { registerSeasonRoutes } from './season/routes';
import type { ShopGateway } from './shop/gateway';
import { registerShopAdminRoutes } from './shop/admin-routes';
import { registerShopRoutes } from './shop/routes';
import { shopFlag } from './shop/service';
import { createStripeGateway } from './shop/stripe-gateway';
import { type ConfigService, createConfigService } from './config/service';
import { createSeasonStore, seasonAwareConfig, startSeasonImport } from './season/records';
import type { DB } from './db/schema';
import type { Env } from './env';
import { HttpError } from './errors';
import { registerHealth, registerPing } from './health';
import { createLoadMonitor, processReaders, registerLoadRoutes } from './admin/load';
import { registerMaintenanceGate } from './maintenance';
import { RateLimitedError } from './ratelimit';
import { registerSecurityHeaders } from './security/headers';
import { registerHostRedirects } from './security/host';
import { registerOriginGuard } from './security/origin';
import { registerPwa } from './pwa';
import { registerStatic, wantsSpaShell } from './static';

export type AppDeps = {
  env: Env;
  db: Kysely<DB>;
  now?: () => Date;
  config?: ConfigService;
  /** The shop's payment gateway: by default Stripe's from the env (none without its keys); tests pass a fake. */
  shopGateway?: ShopGateway | null;
  /** The server's disk for «Almacenamiento»: by default the root's (statfs); tests pass a fixed one. */
  disk?: () => Promise<Disk | null>;
  /** Background jobs that need the live config and socket (mail v2, P5: scheduled mail): only the production entry. */
  jobs?: { mail?: boolean; seasons?: boolean };
  /**
   * Seasons as records (plan «temporadas como fichas», 2026-11-21): the live `season`, `seasonRoute`, `missions.season`
   * and `lab.season` come from galaxy.seasons and can no longer be published the old way. On in production; tests that
   * check it turn it on (the rest keep reading the old keys, so their seasons never meet another file's records).
   */
  seasons?: boolean;
};

/**
 * The game server. Logs carry codes and request lines only: bodies (passwords), cookies and tokens are never logged.
 */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      process.env.NODE_ENV === 'test'
        ? false
        : { level: 'info', redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["stripe-signature"]', 'res.headers["set-cookie"]'] },
    bodyLimit: 64 * 1024,
  });

  await app.register(cookie);
  // The chats' socket (M5b-2): small frames only (it pushes; clients send nothing but pongs).
  await app.register(websocket, { options: { maxPayload: 4096 } });
  // The game's own domain (galaxysurvivor.es plan): www → apex, and the old host's page loads when the cutover switch is
  // on. After the websocket plugin (its hook marks an upgrade, so a redirected upgrade's socket is closed, not leaked) and
  // before the static files, the CSRF guard and the API, so it runs for every request, unknown paths too.
  // With the switch on, a browser on the old host gets the landing's notice «Galaxy Survivor se ha mudado» (the move,
  // 2026-11-17); the landing registers later, so the hook reads it when a request comes.
  let landing: Landing | null = null;
  registerHostRedirects(app, {
    canonicalOrigin: deps.env.GALAXY_CANONICAL_ORIGIN,
    legacyHosts: deps.env.GALAXY_LEGACY_REDIRECT_FROM,
    notice: (location) => landing?.moved(location) ?? null,
  });
  registerSecurityHeaders(app);
  registerOriginGuard(app, deps.env.GALAXY_PUBLIC_ORIGINS);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      if (err.code === 'unauthenticated') clearSessionCookie(reply);
      return reply.code(err.status).send({ error: err.code, ...err.details });
    }
    if (err instanceof ZodError) return reply.code(400).send({ error: 'invalid_input' });
    if (err instanceof RateLimitedError) return reply.code(429).send({ error: 'rate_limited' });
    const status = (err as { statusCode?: number }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    req.log.error({ err: { name: (err as Error).name, code: (err as { code?: unknown }).code } }, 'unhandled');
    return reply.code(500).send({ error: 'internal' });
  });
  // The game's shell carries each screen's title and its own head (galaxysurvivor.es plan, PR 2).
  const shell = await registerStatic(app, deps.env.WEB_DIST, deps.env.GALAXY_CANONICAL_ORIGIN, deps.env.GALAXY_PWA);
  // The installable app's service worker, or its kill switch with GALAXY_PWA=off (galaxysurvivor.es plan, PR 3).
  if (shell) registerPwa(app, { enabled: deps.env.GALAXY_PWA, webDist: deps.env.WEB_DIST });
  // The landing of galaxysurvivor.es at the site root (plan «galaxysurvivor.es», PR 4); /galaxy stays the game's.
  landing = await registerLanding(app, deps.env.LANDING_DIST, deps.env.legal);
  app.setNotFoundHandler((req, reply) => {
    if (shell && wantsSpaShell(req)) return shell(req, reply);
    const path = req.url.split('?')[0] ?? '';
    const game = path === '/galaxy' || path.startsWith('/galaxy/');
    if (landing && !game && (req.method === 'GET' || req.method === 'HEAD')) return landing.notFound(req, reply);
    return reply.code(404).send({ error: 'not_found' });
  });

  const now = deps.now ?? (() => new Date());
  const baseConfig =
    deps.config ??
    createConfigService(deps.db, {
      onInvalid: (key, err) => app.log.error({ key, err: (err as Error).name }, 'config_invalid_stored_row'),
    });
  const seasons = deps.seasons ? createSeasonStore(deps.db, { onInvalid: (id, err) => app.log.error({ season: id, err: (err as Error).name }, 'season_invalid_stored_row') }) : null;
  const config = seasons ? seasonAwareConfig(baseConfig, seasons, now) : baseConfig;
  // The first deploy turns what was live into records; tried until it works, never fatal.
  if (seasons && deps.jobs?.seasons) {
    const stopImport = startSeasonImport(deps.db, baseConfig, seasons, app.log);
    app.addHook('onClose', async () => stopImport());
  }
  // Plan phase 6: the co-op runs (their clock, logs and pay); tests reach it as app.galaxyCoop.
  const coop = new CoopService({ db: deps.db, config, now, log: app.log, autoRecover: process.env.NODE_ENV !== 'test' });
  app.decorate('galaxyCoop', coop);
  app.addHook('onClose', async () => coop.close());
  registerPing(app);
  // The API lives in its own encapsulated plugin: its hooks (session, maintenance) run only for MATCHED API routes,
  // whatever the raw URL spelling (%-encoded paths included), and static files never touch the database.
  await app.register(async (api) => {
    // Hook order matters: the session must be known before the maintenance gate decides.
    registerSessionReader(api, deps.db, now);
    registerMaintenanceGate(api, config);
    registerHealth(api, deps.db);
    // Plan phase 5: the rooms, which the presence reads («in a room, 2/4», and its code when friends may join), and
    // (phase 6c) the room chat, which reaches who is in the room now. A probe chosen in the hangar shows in the room.
    const rooms = createRooms(config);
    // Plan phase 3: the live socket (friends, presence, rooms and, real-time notices plan, every notice), made before the
    // routes whose changes send notices.
    const live = new LiveHub({
      friendsOf: (id) => friendIdsOf(deps.db, id),
      showsStatus: async (id) => (await prefsOf(deps.db, id)).showStatus,
      roomOf: (id) => {
        const r = rooms.manager.roomOf(id);
        return r && r.state === 'lobby' ? { size: r.members.length, max: 4, ...(r.kind !== 'private' ? { code: r.code } : {}) } : null;
      },
    });
    api.addHook('onClose', async () => live.close());
    registerAuthRoutes(api, { env: deps.env, db: deps.db, config, now, onLogout: (id) => live.dropSession(id) });
    registerConfigRoutes(api, { env: deps.env, config, db: deps.db });
    // The content editor (2026-11-16, P2): config drafts, also tried in a test run.
    const drafts = createDraftService({ db: deps.db, config });
    registerDraftRoutes(api, { env: deps.env, drafts, db: deps.db });
    // Shop and lab plan F4: the resource shop's gateway (closed without Stripe's keys).
    const gateway = deps.shopGateway !== undefined ? deps.shopGateway : deps.env.stripe ? createStripeGateway(deps.env.stripe) : null;
    registerGachaRoutes(api, { db: deps.db, config, now, live, shopFlag: (s) => shopFlag({ db: deps.db, config, now, gateway }, s) });
    registerCollectionRoutes(api, { db: deps.db, config, live });
    // Plan «escáner pro», part G: the solo runs' live feeds, ended when a run is saved.
    const soloFeeds = new SoloFeeds({ now: () => now().getTime() });
    soloFeeds.start();
    api.addHook('onClose', async () => soloFeeds.close());
    registerRunRoutes(api, { db: deps.db, config, now, live, feeds: soloFeeds, drafts, trustCfIp: deps.env.TRUST_CF_IP, onProbeChosen: (id, probe, skin) => rooms.memberChanged(id, { probe, skin }) });
    registerSoloStreamRoutes(api, { db: deps.db, feeds: soloFeeds, origins: deps.env.GALAXY_PUBLIC_ORIGINS });
    registerStationRoutes(api, { db: deps.db, config, now, live });
    registerLabRoutes(api, { db: deps.db, config, now });
    registerPlanetariumRoutes(api, { db: deps.db, config });
    registerSocialRoutes(api, { db: deps.db, config, now });
    registerClanRoutes(api, { db: deps.db, config, now, live });
    // The owner's chat asks (2026-11-14): the chats also go out on the live socket (unread counts, notices, mentions).
    const hub = new ChatHub(deps.db, (id) => rooms.manager.byId(id)?.members.map((m) => m.accountId) ?? [], live);
    api.addHook('onClose', async () => hub.close());
    // Phase 6c: who left a group run hears its result on the live socket when it ends.
    coop.notify = (id, event) => live.send(id, event);
    registerFriendRoutes(api, { db: deps.db, config, live, now, origins: deps.env.GALAXY_PUBLIC_ORIGINS });
    registerRoomRoutes(api, { db: deps.db, config, live, rooms, coop, trustCfIp: deps.env.TRUST_CF_IP });
    registerCoopPlayRoutes(api, { coop, origins: deps.env.GALAXY_PUBLIC_ORIGINS });
    // The server's load for Moderación › Salas en vivo (2026-11-17): a sample every 15 s, the last hour in memory.
    const load = createLoadMonitor(
      {
        rooms: () => ({ ...rooms.manager.counts(), max: rooms.limits().maxRooms, players: rooms.manager.all().reduce((n, r) => n + r.members.length, 0) }),
        coop: () => coop.liveStats(),
        solo: () => soloFeeds.list().length,
        sockets: () => live.size(),
      },
      { readers: processReaders() },
    );
    load.start();
    api.addHook('onClose', async () => load.stop());
    registerLoadRoutes(api, load);
    registerPlayerReportRoutes(api, { db: deps.db, trustCfIp: deps.env.TRUST_CF_IP });
    // A ban or closed sessions drop the live socket (the chats arrive on it); the statistics count its sockets.
    const sockets = { dropAccount: (id: string) => live.dropAccount(id), size: () => live.size(), online: () => live.onlineIds() };
    registerChatRoutes(api, { db: deps.db, config, now, hub, live, roomOf: (id) => rooms.manager.roomOf(id)?.id ?? null, origins: deps.env.GALAXY_PUBLIC_ORIGINS, trustCfIp: deps.env.TRUST_CF_IP });
    registerMarketRoutes(api, { db: deps.db, config, now, live });
    registerTradeRoutes(api, { db: deps.db, config, now, live });
    registerAdminRoutes(api, { db: deps.db, config, env: deps.env, hub: sockets });
    registerModerationRoutes(api, { db: deps.db, config, env: deps.env, hub, now });
    registerAdminMarketRoutes(api, { db: deps.db, env: deps.env, now });
    registerMailRoutes(api, { db: deps.db, config, now });
    registerReferralRoutes(api, { db: deps.db, config, env: deps.env });
    registerMissionRoutes(api, { db: deps.db, config, now });
    registerCosmeticsRoutes(api, { db: deps.db, config });
    registerCatalogRoutes(api, { db: deps.db, config });
    registerCodexRoutes(api, { db: deps.db, config });
    registerOnboardingRoutes(api, { db: deps.db });
    registerTutorialRoutes(api, { db: deps.db, config });
    registerSettingsRoutes(api, { db: deps.db });
    registerNotesRoutes(api, { db: deps.db, env: deps.env });
    registerSeasonRoutes(api, { db: deps.db, config, now, seasons });
    registerCommunicationRoutes(api, { db: deps.db, config, env: deps.env, now, live });
    if (deps.jobs?.mail) {
      const stopMail = startMailJobs({ db: deps.db, config, now, live }, app.log);
      api.addHook('onClose', async () => stopMail());
    }
    registerNewsRoutes(api, { db: deps.db, env: deps.env, now });
    registerStatsRoutes(api, { db: deps.db, config, hub: sockets, now, disk: deps.disk ?? (() => serverDisk()) });
    registerAdminRunRoutes(api, { db: deps.db, env: deps.env });
    registerAdminProgressRoutes(api, { db: deps.db, config, env: deps.env });
    // The resource shop's routes and its admin (shop and lab plan, F4).
    const shop = { db: deps.db, config, now, gateway, origins: deps.env.GALAXY_PUBLIC_ORIGINS, canonicalOrigin: deps.env.GALAXY_CANONICAL_ORIGIN, live, log: app.log };
    registerShopRoutes(api, shop);
    registerShopAdminRoutes(api, { ...shop, trustCfIp: deps.env.TRUST_CF_IP });
  });
  return app;
}
