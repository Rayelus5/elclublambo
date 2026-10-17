import { after } from "next/server";

/**
 * Schedules the push dispatch after the response of the current server action. Called from every action that can
 * create notices. The dispatcher is imported lazily so callers (and their unit tests) never load web-push, and it
 * never throws: outside a request scope `after` itself throws, which is swallowed.
 */
export function schedulePushDispatch(): void {
  try {
    after(async () => {
      const { dispatchPendingPush } = await import("@/lib/push/dispatch");
      await dispatchPendingPush();
    });
  } catch {
    // no request scope (tests, scripts): nothing to schedule
  }
}
