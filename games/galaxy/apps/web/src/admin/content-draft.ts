import { parseConfig } from '@galaxy/shared';
import type { Content } from '@galaxy/sim';

// «Probar en incursión» (admin debug mode, 2026-11-15): the content draft the panel's editor sends to a test run, kept
// in the tab's session (it outlives a reload, not the tab) and read back only if it still validates. The browser storage
// can refuse (a private window, a full quota): then there is simply no draft.

const KEY = 'galaxy:content-draft';

export interface ContentDraft {
  /** The live version the draft was made on. */
  baseVersion: number;
  /** The merged draft as the editor holds it (to restore it there). */
  raw: unknown;
  /** The same, validated: what the run plays. */
  content: Content;
}

export function saveContentDraft(d: ContentDraft): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ baseVersion: d.baseVersion, raw: d.raw }));
  } catch {
    // No storage: the test run plays the live content instead.
  }
}

export function readContentDraft(): ContentDraft | null {
  try {
    const text = sessionStorage.getItem(KEY);
    if (!text) return null;
    const stored = JSON.parse(text) as { baseVersion?: unknown; raw?: unknown };
    if (typeof stored.baseVersion !== 'number') return null;
    return { baseVersion: stored.baseVersion, raw: stored.raw, content: parseConfig('content', stored.raw) };
  } catch {
    return null;
  }
}

export function clearContentDraft(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing kept, nothing to clear.
  }
}
