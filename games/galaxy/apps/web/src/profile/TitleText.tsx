import type { CosmeticsConfig } from '@galaxy/shared';

// A title as the catalog styles it (Nov plan C2): plain, or with a shine, an aurora or a flare for the rare ones.
export function titleStyle(catalog: CosmeticsConfig | undefined, text: string): string {
  return catalog?.titles.find((t) => t.text === text)?.style ?? 'plain';
}

export function TitleText({ text, catalog, className = '' }: { text: string; catalog?: CosmeticsConfig; className?: string }) {
  return <span className={`title-text title-${titleStyle(catalog, text)} ${className}`.trim()}>{text}</span>;
}
