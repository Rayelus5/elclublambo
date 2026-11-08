import { type HangarView, type ProbeChoice, probeStatus, type ProbeTestRequest, type ProbeTestResult, scoreTest } from '@galaxy/shared';
import { sql } from 'kysely';
import { inTransaction } from '../db/tx';
import { HttpError } from '../errors';
import { ensureHangar, hangarView, probeGrants, type RunsDeps, runStats, testedProbe } from './hangar';

// The probe test and the choice of probe (GDD §6, §12.2). The test is scored here (the client uses the same rules
// only to know whether to ask the tiebreak), kept once, and picks its probe in the hangar. A second answer gets the
// first result back. Only unlocked probes can be chosen.

export async function takeProbeTest(deps: RunsDeps, accountId: string, req: ProbeTestRequest): Promise<ProbeTestResult> {
  let result: ReturnType<typeof scoreTest>;
  try {
    result = scoreTest(req.answers);
  } catch {
    throw new HttpError(400, 'invalid_input');
  }
  return inTransaction(deps.db, async (trx) => {
    // One test per account: concurrent answers wait for each other here, and the first one stands.
    await sql`select pg_advisory_xact_lock(hashtextextended(${`probe-test:${accountId}`}, 0))`.execute(trx);
    const kept = await testedProbe(trx, accountId);
    if (kept !== null) return { probe: kept };
    if ('tie' in result) throw new HttpError(400, 'tiebreak_required');
    await trx.insertInto('galaxy.probe_tests').values({ account_id: accountId, answers: [...req.answers], probe: result.probe }).execute();
    await ensureHangar(trx, accountId);
    await trx.updateTable('galaxy.hangars').set({ probe: result.probe, updated_at: new Date() }).where('account_id', '=', accountId).execute();
    return { probe: result.probe };
  });
}

export async function chooseProbe(deps: RunsDeps, accountId: string, req: ProbeChoice): Promise<HangarView> {
  const [content, cfg] = await Promise.all([deps.config.get('content'), deps.config.get('probes')]);
  if (!content.probes.some((p) => p.id === req.probe)) throw new HttpError(400, 'invalid_input');
  const assigned = await testedProbe(deps.db, accountId);
  if (assigned === null) throw new HttpError(409, 'probe_test_required');
  const granted = (await probeGrants(deps.db, accountId)).has(req.probe);
  if (!probeStatus(req.probe, assigned, await runStats(deps.db, accountId, cfg.minRunSeconds), cfg, granted).unlocked) throw new HttpError(409, 'probe_locked');
  await ensureHangar(deps.db, accountId);
  await deps.db.updateTable('galaxy.hangars').set({ probe: req.probe, updated_at: new Date() }).where('account_id', '=', accountId).execute();
  return hangarView(deps, accountId);
}
