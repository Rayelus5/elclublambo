import { SIM_VERSION } from '@galaxy/sim';

// The live content's ETag (GET /galaxy/api/content; plan «escáner pro», part D). It names the published version and
// the simulation's version (review of PR #180): a deploy that adds fields to the content's schema fills them with
// their defaults without publishing a new version, so with the version alone a browser that had the content cached
// would get a 304 and keep the old body, without them.

/** The ETag of the content published as `version`, served by a server built with simulation `sim`. */
export function contentEtag(version: number, sim: string = SIM_VERSION): string {
  return `"content-${version}-${sim}"`;
}
