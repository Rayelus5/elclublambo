import { type CommunicationDeps, dispatchDue } from '../admin/communication';

// The mail's job (mail v2, P5): every minute it sends the scheduled messages whose time has come. Only the production
// entry starts it (through the app, which has the live config and the live socket), never the tests.

export { dispatchDue };

const EVERY_MS = 60_000;

/** Runs the dispatcher 20 seconds after the start and then every minute; returns the stop. */
export function startMailJobs(deps: CommunicationDeps, log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void }): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const sent = await dispatchDue(deps);
      if (sent > 0) log.info({ sent }, 'scheduled mail sent');
    } catch (err) {
      log.error({ err }, 'mail job failed');
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => void run(), 20_000);
  const every = setInterval(() => void run(), EVERY_MS);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
