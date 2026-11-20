import { type Content, contentSchema, DEFAULT_CONTENT, type SingularityTuning } from '@galaxy/sim';

// Reading the live content safely (review of PR #180). A browser can hold a content body from before a deploy that
// added fields (the HTTP cache, with an ETag that did not change): read through the content's schema, those fields
// take their defaults, as the server's own reading does. And where a field is read straight, it never breaks on a
// body that lacks it. Pure: the hangar and the arena both use it.

/** The content as the web reads it: through the schema, its missing fields with their defaults (as it came if not). */
export function readContent(content: Content): Content {
  const parsed = contentSchema.safeParse(content);
  return parsed.success ? parsed.data : content;
}

/** A mythic's singularity tuning, never missing (plan «rareza Mítica» M2: content published before it lacks it). */
export function singularityOf(content: Content): SingularityTuning {
  return (content.relics as Partial<Content['relics']>).singularity ?? DEFAULT_CONTENT.relics.singularity;
}
