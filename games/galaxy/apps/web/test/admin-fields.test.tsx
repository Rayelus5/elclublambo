import type { MailAudience, MediaAsset, NewsLink } from '@galaxy/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { AudienceFields, useAudienceReach } from '../src/admin/communication/AudienceFields';
import { type AudienceValue, EMPTY_AUDIENCE, valueOfAudience } from '../src/admin/communication/audience';
import { ImageField } from '../src/admin/ImageField';
import { LinkField } from '../src/admin/LinkField';
import { copy } from '../src/copy/es';
import { pickOption } from './pick';
import { jsonResponse, mockApi, renderAt } from './render';

// The panel's shared fields (plan «Encuestas y avisos», «Piezas que se sacan para compartirlas»): the «Ver más» link
// with the panel's own widgets (never native radios), who a message goes to with how many it reaches, and an uploaded
// image with the proportion its place shows.
afterEach(() => vi.unstubAllGlobals());

const n = copy.admin.news;
const c = copy.admin.communication;

function LinkHarness({ initial, seen }: { initial: NewsLink | null; seen: (l: NewsLink | null) => void }) {
  const [link, setLink] = useState(initial);
  return (
    <LinkField
      legend="Ver más"
      value={link}
      onChange={(l) => {
        seen(l);
        setLink(l);
      }}
    />
  );
}

test('el enlace se elige con el control segmentado: pantalla del juego, página web o ninguno, y recuerda lo escrito', async () => {
  const seen = vi.fn();
  const user = userEvent.setup();
  renderAt('/', { '/': <LinkHarness initial={null} seen={seen} /> });
  const group = screen.getByRole('radiogroup', { name: 'Ver más' });
  expect(within(group).getByRole('radio', { name: n.linkKinds.none })).toHaveAttribute('aria-checked', 'true');
  // No native radios: the game's own segmented control.
  expect(document.querySelector('input[type="radio"]')).toBeNull();
  expect(screen.queryByLabelText(n.fields.label)).toBeNull();

  await user.click(within(group).getByRole('radio', { name: n.linkKinds.route }));
  expect(seen).toHaveBeenLastCalledWith({ kind: 'route', to: '/escaner', label: '' });
  await pickOption(user, screen.getByRole('combobox', { name: n.fields.route }), n.routes['/mercado']);
  expect(seen).toHaveBeenLastCalledWith({ kind: 'route', to: '/mercado', label: '' });
  await user.type(screen.getByLabelText(n.fields.label), 'Ir');
  expect(seen).toHaveBeenLastCalledWith({ kind: 'route', to: '/mercado', label: 'Ir' });

  await user.click(within(group).getByRole('radio', { name: n.linkKinds.url }));
  expect(seen).toHaveBeenLastCalledWith({ kind: 'url', href: '', label: 'Ir' });
  expect(screen.queryByRole('combobox', { name: n.fields.route })).toBeNull();
  await user.type(screen.getByLabelText(n.fields.url), 'https://discord.gg/x');
  expect(seen).toHaveBeenLastCalledWith({ kind: 'url', href: 'https://discord.gg/x', label: 'Ir' });

  await user.click(within(group).getByRole('radio', { name: n.linkKinds.none }));
  expect(seen).toHaveBeenLastCalledWith(null);
  expect(screen.queryByLabelText(n.fields.url)).toBeNull();
  // Back again, what was written is still there.
  await user.click(within(group).getByRole('radio', { name: n.linkKinds.route }));
  expect(seen).toHaveBeenLastCalledWith({ kind: 'route', to: '/mercado', label: 'Ir' });
  await user.click(within(group).getByRole('radio', { name: n.linkKinds.url }));
  expect(seen).toHaveBeenLastCalledWith({ kind: 'url', href: 'https://discord.gg/x', label: 'Ir' });
});

test('un enlace guardado abre en su tipo con sus valores', () => {
  renderAt('/', { '/': <LinkHarness initial={{ kind: 'url', href: 'https://example.com', label: 'Leer' }} seen={() => {}} /> });
  expect(screen.getByRole('radio', { name: n.linkKinds.url })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByLabelText(n.fields.url)).toHaveValue('https://example.com');
  expect(screen.getByLabelText(n.fields.label)).toHaveValue('Leer');
});

function AudienceHarness({ initial, seen }: { initial: AudienceValue; seen: (a: MailAudience | null, problem: string | undefined, recipients: number | undefined) => void }) {
  const [value, setValue] = useState(initial);
  const reach = useAudienceReach(value);
  seen(reach.audience, reach.problem, reach.recipients);
  return <AudienceFields value={value} onChange={setValue} reach={reach} />;
}

const previewRoutes = () =>
  mockApi({ 'POST /galaxy/api/admin/mail/preview': (body) => jsonResponse(200, { recipients: (body as { audience: MailAudience }).audience.kind === 'all' ? 40 : 2 }) });

test('una lista de cuentas da un segmento con sus nombres y dice a cuántas llega', async () => {
  previewRoutes();
  const seen = vi.fn();
  const user = userEvent.setup();
  renderAt('/', { '/': <AudienceHarness initial={EMPTY_AUDIENCE} seen={seen} /> });
  expect(await screen.findByText(c.reach(40))).toBeInTheDocument();
  expect(seen).toHaveBeenLastCalledWith({ kind: 'all' }, undefined, 40);
  await pickOption(user, screen.getByLabelText(c.fields.audience), c.audiences['names']!);
  await user.type(screen.getByLabelText(c.fields.usernames), 'Vega, nova nova');
  expect(await screen.findByText(c.reach(2))).toBeInTheDocument();
  expect(seen).toHaveBeenLastCalledWith({ kind: 'segment', usernames: ['vega', 'nova'] }, undefined, 2);
});

test('un segmento mal escrito dice qué corregir en lugar de contar', async () => {
  previewRoutes();
  const seen = vi.fn();
  const user = userEvent.setup();
  renderAt('/', { '/': <AudienceHarness initial={{ ...EMPTY_AUDIENCE, kind: 'segment' }} seen={seen} /> });
  await user.type(screen.getByLabelText(c.fields.minLevel), '10');
  await user.type(screen.getByLabelText(c.fields.maxLevel), '5');
  expect(screen.getByText(c.audienceInvalid)).toBeInTheDocument();
  expect(seen).toHaveBeenLastCalledWith(null, c.audienceInvalid, undefined);
});

test('un público guardado vuelve al formulario', () => {
  expect(valueOfAudience({ kind: 'all' })).toEqual(EMPTY_AUDIENCE);
  expect(valueOfAudience({ kind: 'segment', usernames: ['vega', 'nova'] })).toEqual({ ...EMPTY_AUDIENCE, kind: 'names', usernames: 'vega, nova' });
  expect(valueOfAudience({ kind: 'segment', minLevel: 5, joinedFrom: '2026-11-01' })).toEqual({ ...EMPTY_AUDIENCE, kind: 'segment', minLevel: '5', joinedFrom: '2026-11-01' });
});

const asset = (id: string, width: number, height: number): MediaAsset => ({ id, name: `${id}.png`, mime: 'image/png', bytes: 1000, width, height, createdAt: '2026-11-20T10:00:00.000Z', uses: 0 });
const WIDE = '00000000-0000-4000-8000-0000000000a1';
const STRIP = '00000000-0000-4000-8000-0000000000a2';

test('la imagen avisa cuando su proporción no es la de su sitio', () => {
  const off = (w: number, h: number) => `Mide ${w} × ${h}`;
  const assets = [asset(WIDE, 1600, 900), asset(STRIP, 1600, 600)];
  const view = renderAt('/', { '/': <ImageField label="Imagen" hint="Recomendado 1600 × 900" value={WIDE} assets={assets} aspect="16:9" offHint={off} onChange={() => {}} /> });
  expect(screen.getByText('Recomendado 1600 × 900', { selector: 'p' })).toBeInTheDocument();
  expect(document.querySelector('.admin-image-preview')).toHaveAttribute('data-aspect', '16:9');
  view.unmount();
  renderAt('/', { '/': <ImageField label="Imagen" hint="Recomendado 1600 × 900" value={STRIP} assets={assets} aspect="16:9" offHint={off} onChange={() => {}} /> });
  expect(screen.getByText('Mide 1600 × 600')).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: copy.admin.imageField.none })).not.toBeChecked();
});
