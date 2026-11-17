import { GAME_SERVERS, type GameServer } from '@galaxy/shared';
import { pingQuality, useServerPing } from '../api/ping';
import { copy } from '../copy/es';

// The game server a group plays on, with its ping (2026-11-17): its flag, its country and the round trip, coloured by
// how it feels. One server today (Spain); the list is ready for more (packages/shared/src/api/servers.ts).

const t = copy.coop;

export function ServerChip({ server = GAME_SERVERS[0]! }: { server?: GameServer }) {
  const ping = useServerPing(server);
  const ms = ping.data ?? null;
  const name = t.servers[server.id] ?? server.id.toUpperCase();
  return (
    <span className="lobby-server" role="img" aria-label={t.serverLabel(name, ms)} data-quality={pingQuality(ms)}>
      <span className="flag" data-flag={server.flag} aria-hidden="true" />
      <span aria-hidden="true">{name}</span>
      <span className="lobby-ping" aria-hidden="true">
        <i />
        {t.ping(ms)}
      </span>
    </span>
  );
}
