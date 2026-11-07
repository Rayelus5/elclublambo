import { type HangarView, type SectorChoice, sectorStatus } from '@galaxy/shared';
import { HttpError } from '../errors';
import { ensureHangar, hangarView, type RunsDeps, sectorStats } from './hangar';

// Choosing the sector for the next runs (GDD §5.5, §13.1): only one that exists and is open now. The choice is kept;
// whether it is still open is decided again when the hangar is shown and when a run starts.

export async function chooseSector(deps: RunsDeps, accountId: string, req: SectorChoice): Promise<HangarView> {
  const [content, cfg] = await Promise.all([deps.config.get('content'), deps.config.get('sectors')]);
  const def = content.sectors.find((s) => s.id === req.sector);
  if (!def) throw new HttpError(400, 'invalid_input');
  if (!sectorStatus(def, await sectorStats(deps.db, accountId), cfg).unlocked) throw new HttpError(409, 'sector_locked');
  await ensureHangar(deps.db, accountId);
  await deps.db.updateTable('galaxy.hangars').set({ sector: req.sector, updated_at: new Date() }).where('account_id', '=', accountId).execute();
  return hangarView(deps, accountId);
}
