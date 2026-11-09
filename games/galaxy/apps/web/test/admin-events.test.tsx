import { CONFIG_KEYS, type MeResponse, parseConfig } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { EventsScreen } from '../src/admin/events/EventsScreen';
import { EventWizardScreen } from '../src/admin/events/EventWizard';
import { copy } from '../src/copy/es';
import { jsonResponse, mockApi, renderAt } from './render';

// Eventos in the admin panel (polish phase 4): the events by when they happen with what each gives and warns, the
// wizard that writes an event and its scanner and publishes both at once, and ending or removing one.
afterEach(() => vi.unstubAllGlobals());

const t = copy.admin.events;
const admin: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 };
const DAY = 86_400_000;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const goal = (id: string, extra: object = {}) => ({ id, name: `Meta ${id}`, stat: 'kills', target: 100, scope: 'personal', reward: { coins: 100, dust: 0, signal: 0, xp: 0, points: 0, eventSignals: 0 }, ...extra });
const live = { id: 'cometas', name: 'Lluvia de cometas', description: 'Una semana de cometas', startsAt: iso(-DAY), endsAt: iso(6 * DAY), goals: [goal('a', { reward: { coins: 100, dust: 0, signal: 0, xp: 0, points: 0, eventSignals: 5 } })] };
const next = { id: 'hielo', name: 'Semana del hielo', description: 'Frío', startsAt: iso(10 * DAY), endsAt: iso(17 * DAY), goals: [goal('b')] };
const past = { id: 'viejo', name: 'Evento viejo', description: 'Ya pasó', startsAt: iso(-20 * DAY), endsAt: iso(-13 * DAY), goals: [goal('c')] };

function keysWith(list: object[], banners?: object[]) {
  return CONFIG_KEYS.map((key) => ({
    key,
    version: key === 'events' ? 5 : key === 'gacha' ? 9 : 0,
    data: key === 'events' ? { list } : key === 'gacha' ? { ...parseConfig('gacha', {}), ...(banners ? { banners } : {}) } : parseConfig(key, {}),
    createdAt: null,
    author: null,
    note: null,
  }));
}

function api(list: object[], banners?: object[]) {
  const batches: { items: { key: string; data: Record<string, unknown>; baseVersion?: number }[]; reason: string }[] = [];
  mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, admin),
    'GET /galaxy/api/admin/config/keys': () => jsonResponse(200, keysWith(list, banners)),
    'POST /galaxy/api/admin/config/batch': (body) => {
      batches.push(body as (typeof batches)[number]);
      return jsonResponse(201, { versions: { events: 6 } });
    },
  });
  return batches;
}

const signIn = async (user: ReturnType<typeof userEvent.setup>, label: string, where: HTMLElement = document.body) => {
  await user.type(within(where).getByLabelText(copy.admin.fields.reason), 'Evento de prueba');
  await user.type(within(where).getByLabelText(copy.admin.fields.password), 'mi-clave');
  await user.click(within(where).getByRole('button', { name: label }));
};

test('la lista agrupa los eventos por cuándo pasan, con lo que dan y sus avisos', async () => {
  api([past, next, live]);
  renderAt('/admin/eventos', { '/admin/eventos': <EventsScreen /> });
  const liveGroup = await screen.findByRole('region', { name: t.groups.live });
  expect(within(liveGroup).getByRole('heading', { name: live.name })).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: t.groups.next })).getByRole('heading', { name: next.name })).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: t.groups.past })).getByRole('heading', { name: past.name })).toBeInTheDocument();
  // The live event pays its own signals but has no scanner to spend them in.
  expect(within(liveGroup).getByText(t.warnings.signalsWithoutScanner(live.name))).toBeInTheDocument();
  expect(within(liveGroup).getByRole('button', { name: t.endNow })).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: t.groups.next })).queryByRole('button', { name: t.endNow })).toBeNull();
  expect(screen.getByText(t.used(3, 10))).toBeInTheDocument();
  expect(screen.getByRole('link', { name: t.create })).toHaveAttribute('href', '/admin/eventos/nuevo');
});

test('terminar ahora cierra el evento y su escáner en la misma publicación', async () => {
  const scanner = { id: 'cometas', kind: 'event', name: 'Escáner de cometas', pityGroup: 'event-cometas', currency: 'signal:cometas', featured: { trait: 'phenomenon', value: 'comet' }, startsAt: live.startsAt, endsAt: live.endsAt };
  const batches = api([live], [...parseConfig('gacha', {}).banners, scanner]);
  renderAt('/admin/eventos', { '/admin/eventos': <EventsScreen /> });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: t.endNow }));
  const dialog = screen.getByRole('alertdialog', { name: t.endTitle(live.name) });
  expect(within(dialog).getByText(t.withScanner)).toBeInTheDocument();
  await signIn(user, t.endNow, dialog);
  await waitFor(() => expect(batches).toHaveLength(1));
  const [events, gacha] = batches[0]!.items;
  expect(events).toMatchObject({ key: 'events', baseVersion: 5 });
  expect(gacha).toMatchObject({ key: 'gacha', baseVersion: 9 });
  const endsAt = (events!.data.list as { endsAt: string }[])[0]!.endsAt;
  expect(Date.parse(endsAt)).toBeLessThanOrEqual(Date.now());
  expect((gacha!.data.banners as { id: string; endsAt?: string }[]).find((b) => b.id === 'cometas')!.endsAt).toBe(endsAt);
});

test('el asistente crea un evento con su escáner y publica los dos a la vez', async () => {
  const batches = api([next]);
  renderAt('/admin/eventos/nuevo', { '/admin/eventos/:id': <EventWizardScreen />, '/admin/eventos': <p>lista</p> });
  const user = userEvent.setup();
  expect(await screen.findByRole('heading', { level: 1, name: t.createTitle })).toBeInTheDocument();
  // Datos: the id follows the name; quick dates.
  await user.type(await screen.findByLabelText('Nombre'), 'Noche de púlsares');
  expect(screen.getByLabelText('Identificador')).toHaveValue('noche-de-pulsares');
  await user.type(screen.getByLabelText('Descripción'), 'Una noche entera de púlsares');
  await user.click(screen.getByRole('button', { name: t.startNow }));
  await user.click(screen.getByRole('button', { name: t.days(7) }));
  expect(screen.getByText(t.lasts(7, 0))).toBeInTheDocument();
  // Metas: the first goal, with the event's own signals.
  await user.click(screen.getByRole('button', { name: t.next }));
  const goals = screen.getByRole('region', { name: 'Metas' });
  await user.click(within(goals).getAllByRole('button', { expanded: false })[0]!);
  await user.type(within(goals).getByLabelText('Nombre'), 'Derrota 3 Núcleos');
  await user.selectOptions(within(goals).getByLabelText('Qué cuenta'), 'Núcleos derrotados');
  const target = within(goals).getByLabelText('Objetivo');
  await user.clear(target);
  await user.type(target, '3');
  const signals = within(goals).getByLabelText('Señales del evento');
  await user.clear(signals);
  await user.type(signals, '10');
  // Premios: what one player takes home.
  await user.click(screen.getByRole('button', { name: t.next }));
  expect(screen.getByRole('heading', { name: t.perPlayer }).parentElement).toHaveTextContent(copy.missions.reward.eventSignals(10));
  // Escáner: on, with a featured trait.
  await user.click(screen.getByRole('button', { name: t.next }));
  expect(screen.getByText(t.warnings.signalsWithoutScanner('Noche de púlsares'))).toBeInTheDocument();
  await user.click(screen.getByRole('switch', { name: t.scannerOn }));
  await user.selectOptions(screen.getByLabelText(t.scannerTrait), copy.traitNames.phenomenon!);
  await user.selectOptions(screen.getByLabelText(t.scannerValue), 'Púlsar');
  expect(screen.queryByText(t.warnings.signalsWithoutScanner('Noche de púlsares'))).toBeNull();
  // Revisar: the player's view, then one publish of both keys.
  await user.click(screen.getByRole('button', { name: t.next }));
  const preview = screen.getByRole('region', { name: t.preview });
  expect(within(preview).getByRole('heading', { name: 'Noche de púlsares' })).toBeInTheDocument();
  expect(within(preview).getByText('Derrota 3 Núcleos')).toBeInTheDocument();
  await signIn(user, t.publishEvent);
  await waitFor(() => expect(batches).toHaveLength(1));
  const [events, gacha] = batches[0]!.items;
  const list = events!.data.list as { id: string; goals: { id: string; stat: string; target: number; reward: { eventSignals: number } }[] }[];
  expect(list.map((e) => e.id)).toEqual(['hielo', 'noche-de-pulsares']);
  expect(list[1]!.goals[0]).toMatchObject({ id: 'derrota-3-nucleos', stat: 'bossKills', target: 3, reward: { eventSignals: 10 } });
  expect((gacha!.data.banners as object[]).at(-1)).toMatchObject({ id: 'noche-de-pulsares', kind: 'event', currency: 'signal:noche-de-pulsares', featured: { trait: 'phenomenon', value: 'pulsar' } });
  expect(await screen.findByText('lista')).toBeInTheDocument();
});

test('editar un evento lo cambia en su sitio, y un paso con problemas lo dice', async () => {
  const batches = api([live, next]);
  renderAt('/admin/eventos/hielo', { '/admin/eventos/:id': <EventWizardScreen />, '/admin/eventos': <p>lista</p> });
  const user = userEvent.setup();
  expect(await screen.findByRole('heading', { level: 1, name: t.editTitle })).toBeInTheDocument();
  const name = await screen.findByLabelText('Nombre');
  await user.clear(name);
  expect(screen.getByRole('button', { name: t.problemsIn(t.steps.data, 1) })).toBeInTheDocument();
  await user.type(name, 'Semana del hielo eterno');
  // A published event's id is shown, not editable, and never follows its name: it names its claims.
  expect(screen.getByText('hielo')).toBeInTheDocument();
  expect(screen.queryByLabelText('Identificador')).toBeNull();
  await signIn(user, t.saveChanges);
  await waitFor(() => expect(batches).toHaveLength(1));
  expect(batches[0]!.items).toHaveLength(1);
  expect((batches[0]!.items[0]!.data.list as { id: string; name: string }[]).map((e) => `${e.id}:${e.name}`)).toEqual(['cometas:Lluvia de cometas', 'hielo:Semana del hielo eterno']);
});

test('tras un 409 el asistente sigue sobre la versión en la que empezó y ofrece cargar lo publicado', async () => {
  let version = 5;
  const sent: number[] = [];
  mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, admin),
    'GET /galaxy/api/admin/config/keys': () => jsonResponse(200, keysWith([next]).map((k) => (k.key === 'events' ? { ...k, version } : k))),
    'POST /galaxy/api/admin/config/batch': (body) => {
      sent.push((body as { items: { key: string; baseVersion: number }[] }).items.find((i) => i.key === 'events')!.baseVersion);
      version = 6;
      return jsonResponse(409, { error: 'config_conflict', key: 'events' });
    },
  });
  renderAt('/admin/eventos/hielo', { '/admin/eventos/:id': <EventWizardScreen /> });
  const user = userEvent.setup();
  const name = await screen.findByLabelText('Nombre');
  await user.type(name, ' eterno');
  await signIn(user, t.saveChanges);
  expect(await screen.findByText(copy.errors.config_conflict)).toBeInTheDocument();
  expect(await screen.findByText(t.moved(6))).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: t.saveChanges }));
  await waitFor(() => expect(sent).toEqual([5, 5]));
  await user.click(screen.getByRole('button', { name: t.reloadLive }));
  expect(screen.getByLabelText('Nombre')).toHaveValue(next.name);
});

test('guardar un evento conserva el identificador, el grupo de garantía y el sitio de su escáner', async () => {
  const other = { id: 'otro', kind: 'event', name: 'Otro', pityGroup: 'event-otro', currency: 'signal:otro', featured: { trait: 'phenomenon', value: 'comet' } };
  const own = { id: 'scan-hielo', kind: 'event', name: 'Escáner del hielo', pityGroup: 'grupo-hielo', currency: 'signal:hielo', featured: { trait: 'phenomenon', value: 'pulsar' }, startsAt: next.startsAt, endsAt: next.endsAt };
  const standard = parseConfig('gacha', {}).banners;
  const batches = api([next], [...standard, own, other]);
  renderAt('/admin/eventos/hielo', { '/admin/eventos/:id': <EventWizardScreen />, '/admin/eventos': <p>lista</p> });
  const user = userEvent.setup();
  await screen.findByLabelText('Nombre');
  for (let i = 0; i < 3; i++) await user.click(screen.getByRole('button', { name: t.next }));
  await user.selectOptions(screen.getByLabelText(t.scannerValue), 'Supernova');
  await user.click(screen.getByRole('button', { name: t.next }));
  await signIn(user, t.saveChanges);
  await waitFor(() => expect(batches).toHaveLength(1));
  // Only the scanner changed: only the gacha key is published.
  expect(batches[0]!.items.map((i) => i.key)).toEqual(['gacha']);
  const banners = batches[0]!.items[0]!.data.banners as { id: string; pityGroup: string; featured: { value: string } }[];
  expect(banners.map((b) => b.id)).toEqual([...standard.map((b) => b.id), 'scan-hielo', 'otro']);
  expect(banners[standard.length]).toMatchObject({ id: 'scan-hielo', pityGroup: 'grupo-hielo', featured: { value: 'supernova' } });
});
