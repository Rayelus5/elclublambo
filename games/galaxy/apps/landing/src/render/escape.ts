// HTML escaping for the landing's templates (plan «galaxysurvivor.es», PR 4).

const MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Text or attribute value, escaped. */
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => MAP[c]!);

/** Escaped text where [label](url) becomes a link (external ones open apart). Only the dictionary's own text uses it. */
export const inline = (s: string) =>
  esc(s).replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) =>
    /^https?:/.test(url) ? `<a href="${url}" rel="noopener" target="_blank">${label}</a>` : `<a href="${url}">${label}</a>`,
  );

/** JSON for a <script type="application/ld+json"> block: `<` escaped so no text can close the tag. */
export const ldJson = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\u003c')}</script>`;
