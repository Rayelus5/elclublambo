import type { PulledGalaxy, Tier } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { RevealRehearsal } from '../src/admin/RevealRehearsal';
import { copy } from '../src/copy/es';
import type { ProCinemaProps } from '../src/scanner/pro/ProCinema';
import { fabricatePulls } from '../src/scanner/pro/fabricate';
import { renderAt } from './render';

// The scanner's rehearsal (plan «rareza Mítica» M2): the admin watches every animation, the classic reveal as well as
// the pro one, with the same invented pulls (one or ten, the presets, the tier, the finish…). The pro cinema is
// stubbed (jsdom has no WebGL) and the pulls are made instantly (the real generator takes its time looking for them).

vi.mock('../src/galaxy/images', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/galaxy/images')>()),
  loadRender: vi.fn(() => Promise.reject(new Error('sin worker en jsdom'))),
}));
vi.mock('../src/scanner/pro/ProCinema', () => ({
  default: function StubCinema(p: ProCinemaProps) {
    return <div data-testid="cinema">{p.pulls.length}</div>;
  },
}));
vi.mock('../src/scanner/pro/fabricate', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/scanner/pro/fabricate')>();
  return {
    ...real,
    fabricatePulls: vi.fn(async (o: { tiers: readonly Tier[] }): Promise<PulledGalaxy[]> =>
      o.tiers.map((tier, i) => ({ id: `ensayo-${i}`, seed: String(100 + i), tier, finish: 'normal', traits: { phenomenon: 'none' }, name: `Ensayo ${i}`, designation: `GX-${i}`, featured: false })),
    ),
  };
});

const t = copy.admin.rehearsal;
afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

const open = () => renderAt('/admin/escaner-ensayo', { '/admin/escaner-ensayo': <RevealRehearsal /> });

test('el ensayo elige la presentación, Clásica o Pro, y empieza en la pro', () => {
  open();
  const group = screen.getByRole('radiogroup', { name: t.presentation });
  expect(within(group).getByRole('radio', { name: 'Clásica' })).toHaveAttribute('aria-checked', 'false');
  expect(within(group).getByRole('radio', { name: 'Pro' })).toHaveAttribute('aria-checked', 'true');
});

test('con «Clásica» se reproduce la presentación clásica del escáner con las mismas tiradas inventadas', async () => {
  const user = userEvent.setup();
  open();
  await user.click(within(screen.getByRole('radiogroup', { name: t.presentation })).getByRole('radio', { name: 'Clásica' }));
  // What only the pro cinematic has (its surge, its speed, its phase durations) is not offered for the classic one.
  expect(screen.queryByRole('radiogroup', { name: t.surge })).toBeNull();
  expect(screen.queryByRole('radiogroup', { name: t.speed })).toBeNull();
  expect(screen.queryByRole('group', { name: t.durations })).toBeNull();
  await user.click(screen.getByRole('button', { name: t.play }));
  const stage = await screen.findByRole('dialog', { name: t.title });
  expect(stage.querySelector('.crt')).not.toBeNull();
  expect(stage.querySelector('.pro-root')).toBeNull();
  expect(within(stage).getByText(copy.scanner.progress(1, 10))).toBeInTheDocument();
  expect(vi.mocked(fabricatePulls).mock.calls[0]![0].tiers).toHaveLength(10);
});

test('con «Pro» se reproduce la cinemática pro, como siempre', async () => {
  const user = userEvent.setup();
  open();
  expect(screen.getByRole('radiogroup', { name: t.surge })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: t.play }));
  const stage = await screen.findByRole('dialog', { name: t.title });
  await waitFor(() => expect(within(stage).getByTestId('cinema')).toHaveTextContent('10'));
  expect(stage.querySelector('.crt')).toBeNull();
});

test('«Una mítica» y una sola tirada de una mítica se ensayan también en la clásica', async () => {
  const user = userEvent.setup();
  open();
  await user.click(within(screen.getByRole('radiogroup', { name: t.presentation })).getByRole('radio', { name: 'Clásica' }));
  await user.click(screen.getByRole('combobox', { name: t.preset }));
  await user.click(await screen.findByRole('option', { name: t.presets.unaMitica }));
  await user.click(screen.getByRole('button', { name: t.play }));
  await screen.findByRole('dialog', { name: t.title });
  expect(vi.mocked(fabricatePulls).mock.calls[0]![0].tiers.at(-1)).toBe('mythic');
  await user.click(screen.getByRole('button', { name: copy.scanner.skip }));
  await user.click(await screen.findByRole('button', { name: copy.scanner.close }));
  await user.click(within(screen.getByRole('radiogroup', { name: t.count })).getByRole('radio', { name: t.counts.one }));
  await user.click(screen.getByRole('combobox', { name: t.tier }));
  await user.click(await screen.findByRole('option', { name: copy.tiers.mythic }));
  await user.click(screen.getByRole('button', { name: t.play }));
  const stage = await screen.findByRole('dialog', { name: t.title });
  expect(vi.mocked(fabricatePulls).mock.calls.at(-1)![0].tiers).toEqual(['mythic']);
  expect(stage.querySelector('.crt')).not.toBeNull();
});

test('los tiempos del silencio de la mítica se pueden dirigir en la pro', () => {
  open();
  expect(screen.getByRole('textbox', { name: t.families['silencio'] })).toBeInTheDocument();
});
