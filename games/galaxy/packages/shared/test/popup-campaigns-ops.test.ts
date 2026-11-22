import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { popupIssues, popupRecordSchema } from '../src';

// The campaigns of «Encuestas y avisos» prepared in ops/launch (`<carpeta>/avisos/*.json`, plan 2026-11-22, part A):
// each one holds as a record, has everything it needs to be published (a promotion's image is the file next to it,
// which popup-draft uploads), and its image is there.
const OPS = new URL('../../../ops/launch/', import.meta.url);

const campaigns = readdirSync(OPS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(new URL(`${d.name}/avisos/`, OPS)))
  .flatMap((d) =>
    readdirSync(new URL(`${d.name}/avisos/`, OPS))
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({ name: `${d.name}/avisos/${f}`, dir: new URL(`${d.name}/avisos/`, OPS), data: JSON.parse(readFileSync(new URL(`${d.name}/avisos/${f}`, OPS), 'utf8')) as { record: unknown; image?: string } })),
  );

test('hay campañas preparadas que comprobar', () => {
  expect(campaigns.length).toBeGreaterThan(0);
});

test.each(campaigns.map((c) => [c.name, c] as const))('%s se puede publicar', (_name, c) => {
  const parsed = popupRecordSchema.safeParse(c.data.record);
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  const issues = popupIssues(c.data.record, { forPublish: true, now: new Date(Date.parse(parsed.data!.startsAt) - 60_000) });
  // A promotion's image is uploaded with it: missing in the record is fine when the file is there.
  const left = issues.filter((i) => !(i.message === 'popup_image_missing' && c.data.image));
  expect(left).toEqual([]);
  if (c.data.image) expect(existsSync(new URL(c.data.image, c.dir))).toBe(true);
});
