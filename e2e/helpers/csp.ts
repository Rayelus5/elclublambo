import type { Page } from "@playwright/test";

/**
 * F5 Task 3: records every Content-Security-Policy violation of `page` (top frame only: a third-party iframe such as
 * DexScreener enforces its own CSP, not ours). Each violation is pushed as `${violatedDirective} ${blockedURI}` into
 * `window.__cspViolations` and forwarded to the test, so violations of documents the page has since navigated away from
 * are kept. Call it before the navigation to watch; the returned reader gives everything seen so far.
 *
 * Playwright's init scripts and bindings run outside the page's CSP, so the watcher itself never trips it.
 */
export async function watchCsp(page: Page): Promise<() => Promise<string[]>> {
  const seen: string[] = [];
  await page.exposeFunction("__cspViolation", (entry: string) => {
    seen.push(entry);
  });
  await page.addInitScript(() => {
    if (window !== window.top) return;
    const w = window as unknown as { __cspViolations?: string[]; __cspViolation?: (entry: string) => Promise<void> };
    w.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      const entry = `${e.violatedDirective} ${e.blockedURI}`;
      w.__cspViolations!.push(entry);
      void w.__cspViolation?.(entry);
    });
  });
  return async () => {
    // A round trip through the page, so a binding call it already issued has reached `seen` (CDP keeps the order).
    if (!page.isClosed()) await page.evaluate(() => undefined).catch(() => undefined);
    return [...seen];
  };
}
