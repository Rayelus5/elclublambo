import { configIssues, mergeDraft, parseConfig, sameValue } from '@galaxy/shared';
import type { Content } from '@galaxy/sim';

// The content editor's drafts (2026-11-16, P2): a draft holds only the top-level fields that differ from what is live,
// and plays the draft over what is live.

/**
 * What to save for an edited value: each top-level field that differs from what is live, and `null` for a field the
 * draft had that is back to what is live (the server then drops it). Fields that did not move are left out.
 */
export function changedFields(live: Record<string, unknown>, edited: Record<string, unknown>, saved: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of new Set([...Object.keys(edited), ...Object.keys(saved)])) {
    const value = edited[field];
    const differs = value !== undefined && !sameValue(value, live[field]);
    if (differs && !sameValue(value, saved[field])) out[field] = value;
    else if (!differs && field in saved) out[field] = null;
  }
  return out;
}

/** The content a draft plays: its fields over what is live, parsed (or the issues that stop it). */
export function draftContent(live: Content, fields: Record<string, unknown>): { ok: true; content: Content } | { ok: false; issues: { path: string; message: string }[] } {
  const merged = mergeDraft('content', live, fields);
  const issues = configIssues('content', merged);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, content: parseConfig('content', merged) };
}
