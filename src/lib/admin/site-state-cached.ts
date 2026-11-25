// The site state for the pages (the landing and the tools hub show the switches, A-R16), through the tagged cache: both
// pages are part of the static shell instead of being rendered on every request. Administración's actions expire the tag
// (updateTag) right after a change, so a switch shows at once; the proxy keeps its own 5-second read for the gates.
import { cacheLife, cacheTag } from "next/cache";
import { readSiteState } from "./site-state";
import { OPEN_STATE, type SiteState } from "./state";

export const SITE_STATE_TAG = "site-state";

export async function getCachedSiteState(): Promise<SiteState> {
  "use cache";
  cacheTag(SITE_STATE_TAG);
  // No network while `next build` prerenders (A-R16): the preproduction Docker build stalled on this read until the
  // "use cache" fill timed out. The open state, for minutes: the first request after that renders the page again at
  // runtime with the real switches, and the proxy gates every switched-off tool in the meantime.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    cacheLife("minutes");
    return OPEN_STATE;
  }
  const state = await readSiteState();
  if (state === null) {
    // A failed read opens everything (like the proxy), but only for minutes: a blip, or a build without the database,
    // must not stick. The proxy still gates every switched-off tool in the meantime.
    cacheLife("minutes");
    return OPEN_STATE;
  }
  // Only Administración changes the switches, and its actions expire the tag: hours is a safety net.
  cacheLife("hours");
  return state;
}
