import { SIM_VERSION } from '@galaxy/sim';
import { expect, test } from 'vitest';
import { contentEtag } from '../../src/runs/content-etag';

// Review of PR #180: the content's ETag named only its published version, so after a deploy that adds fields to the
// content (with their defaults, the version unchanged on PRE) a browser that had it cached got a 304 and kept the old
// body, without the new fields. The ETag names the simulation's version too: a deploy that changes it changes the ETag.
test('el ETag del contenido cambia con su versión publicada y con la versión de la simulación', () => {
  expect(contentEtag(7)).toBe(`"content-7-${SIM_VERSION}"`);
  expect(contentEtag(7, '1.10.0')).not.toBe(contentEtag(7, '1.11.0'));
  expect(contentEtag(7)).not.toBe(contentEtag(8));
});
