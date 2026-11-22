import { type AdminPopup, type AdminPopupResults, CONFIG_KEYS, type MeResponse, parseConfig, type PopupRecord, type PopupTextsPage } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { AdminLayout } from '../src/admin/AdminLayout';
import { PopupPage } from '../src/admin/popups/PopupPage';
import { PopupResults } from '../src/admin/popups/PopupResults';
import { PopupsScreen } from '../src/admin/popups/PopupsScreen';
import { applyTemplate, copyRecord, freshRecord, issueText, stepOf, withKind } from '../src/admin/popups/shared';
import { copy } from '../src/copy/es';
import { jsonResponse, locationOf, mockApi, renderAt } from './render';

// «Encuestas y avisos» in the admin panel (plan 2026-11-22, part A): the list by state with what can be done to each,
// the wizard with the server's checks counted on its steps (a promotion skips its questions and reward), its templates,
// a copy, publishing with the version and the password, a scheduled campaign shown as players will see it, and the
// results with the NPS, the bars and the texts read 50 at a time.
afterEach(() => vi.unstubAllGlobals());

const t = copy.admin.popups;
const superadmin: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 };
const DAY = 86_400_000;
const around = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const ID = { draft: '11111111-1111-4111-8111-111111111111', scheduled: '22222222-2222-4222-8222-222222222222', live: '33333333-3333-4333-8333-333333333333', ended: '44444444-4444-4444-8444-444444444444', promo: '55555555-5555-4555-8555-555555555555' };

const record = (over: Partial<PopupRecord> = {}): PopupRecord => ({
  kind: 'survey',
  title: 'Tu opinión cuenta',
  body: '',
  questions: [{ type: 'scale', id: 'q1', prompt: '¿Recomendarías Galaxy Survivor a un amigo?', range: '0-10', low: 'Poco probable', high: 'Muy probable', subject: null }],
  imageMedia: null,
  link: null,
  audience: { kind: 'all' },
  startsAt: around(1),
  endsAt: around(8),
  priority: 1,
  reward: [],
  ...over,
});
const popup = (id: string, state: AdminPopup['state'], over: Partial<AdminPopup> = {}, rec: Partial<PopupRecord> = {}): AdminPopup => ({
  id,
  state,
  version: 2,
  record: record(rec),
  createdAt: around(-3),
  createdBy: 'ad1',
  updatedAt: around(-1),
  updatedBy: 'ad1',
  publishedAt: state === 'draft' ? null : around(-1),
  publishedBy: state === 'draft' ? null : 'ad1',
  endedAt: null,
  endedBy: null,
  counts: { seen: 0, answered: 0, clicked: 0 },
  bigReasons: [],
  ...over,
});
const review = { questions: [{ type: 'stars', id: 'q1', prompt: '¿Cuántas estrellas le das?' }, { type: 'text', id: 'q2', prompt: 'Cuéntanos por qué', placeholder: 'Escribe aquí', required: false, maxLength: 500 }] } satisfies Partial<PopupRecord>;
const list = [
  popup(ID.draft, 'draft', { bigReasons: ['recipients'] }, { title: 'Borrador de invierno', reward: [{ kind: 'currency', currency: 'coins', amount: 500 }] }),
  popup(ID.scheduled, 'scheduled', {}, { title: 'Encuesta del lunes', startsAt: around(2), endsAt: around(9) }),
  popup(ID.live, 'live', { counts: { seen: 40, answered: 12, clicked: 0 } }, { kind: 'review', title: 'Valora Galaxy Survivor', startsAt: around(-1), endsAt: around(6), ...review }),
  popup(ID.ended, 'ended', { counts: { seen: 90, answered: 0, clicked: 31 } }, { kind: 'promotion', title: 'Copa de hielo', questions: [], startsAt: around(-9), endsAt: around(-2), imageMedia: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
];

const keys = CONFIG_KEYS.map((key) => (key === 'content' ? { key, version: 1, createdAt: null, author: null, note: null, lazy: true } : { key, version: 1, data: parseConfig(key, {}), createdAt: null, author: null, note: null }));

type Call = { path: string; body: unknown };
function api(me: MeResponse = superadmin, extra: Record<string, (body: unknown) => Response> = {}) {
  const calls: Call[] = [];
  const log = (path: string, res: (body: unknown) => Response) => (body: unknown) => {
    calls.push({ path, body });
    return res(body);
  };
  const fetch = mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, me),
    'GET /galaxy/api/admin/popups': () => jsonResponse(200, { popups: list, now: new Date().toISOString() }),
    'GET /galaxy/api/admin/config/keys': () => jsonResponse(200, keys),
    'GET /galaxy/api/content': () => jsonResponse(503, { error: 'internal' }),
    'GET /galaxy/api/profile/cosmetics': () => jsonResponse(200, {}),
    'GET /galaxy/api/admin/media': () => jsonResponse(200, { assets: [], totalBytes: 0 }),
    'POST /galaxy/api/admin/mail/preview': () => jsonResponse(200, { recipients: 120 }),
    'POST /galaxy/api/admin/popups/validate': () => jsonResponse(200, { ok: true, issues: [], bigReasons: [] }),
    ...Object.fromEntries(list.map((x) => [`GET /galaxy/api/admin/popups/${x.id}`, () => jsonResponse(200, x)])),
    // Only the writes are logged.
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, k.startsWith('POST') && !k.endsWith('/validate') ? log(k, v) : v])),
  });
  return { calls, fetch };
}

// ---------------------------------------------------------------------------------------------------------------------
// The list

test('la barra lateral lleva a Encuestas y avisos', async () => {
  api();
  renderAt('/admin', { '/admin': <AdminLayout /> });
  const nav = await screen.findByRole('navigation', { name: copy.admin.nav });
  expect(within(nav).getByRole('link', { name: copy.admin.sections.popups })).toHaveAttribute('href', '/admin/encuestas');
});

test('la lista agrupa las campañas por estado con sus respuestas y sus acciones', async () => {
  api();
  renderAt('/admin/encuestas', { '/admin/encuestas': <PopupsScreen /> });
  const drafts = await screen.findByRole('region', { name: t.groups.draft });
  const draft = within(drafts).getByRole('listitem', { name: 'Borrador de invierno' });
  expect(within(draft).getByText(t.kinds.survey)).toBeInTheDocument();
  expect(within(draft).getByRole('link', { name: t.actions.edit })).toHaveAttribute('href', `/admin/encuestas/${ID.draft}`);
  expect(within(draft).getByRole('link', { name: t.actions.publish })).toHaveAttribute('href', `/admin/encuestas/${ID.draft}?paso=revision`);
  expect(within(draft).getByRole('link', { name: t.actions.duplicate })).toHaveAttribute('href', `/admin/encuestas/nueva?desde=${ID.draft}`);
  expect(within(draft).getByRole('button', { name: t.actions.remove })).toBeInTheDocument();
  expect(within(draft).getByText(t.needsSuperadmin)).toBeInTheDocument();

  // Nobody saw the scheduled one yet: it can still go back to draft.
  const scheduled = within(screen.getByRole('region', { name: t.groups.scheduled })).getByRole('listitem', { name: 'Encuesta del lunes' });
  expect(within(scheduled).getByRole('button', { name: t.actions.unpublish })).toBeInTheDocument();
  expect(within(scheduled).getByRole('button', { name: t.actions.end })).toBeInTheDocument();

  const live = within(screen.getByRole('region', { name: t.groups.live })).getByRole('listitem', { name: 'Valora Galaxy Survivor' });
  expect(within(live).getByText(t.answers(12, 40))).toBeInTheDocument();
  expect(within(live).getByRole('link', { name: t.actions.results })).toHaveAttribute('href', `/admin/encuestas/${ID.live}/resultados`);
  expect(within(live).queryByRole('button', { name: t.actions.unpublish })).not.toBeInTheDocument();

  // A promotion counts «Ver más».
  const ended = within(screen.getByRole('region', { name: t.groups.ended })).getByRole('listitem', { name: 'Copa de hielo' });
  expect(within(ended).getByText(t.clicks(31, 90))).toBeInTheDocument();
  expect(within(ended).queryByRole('button', { name: t.actions.end })).not.toBeInTheDocument();
});

test('un borrador se borra con un motivo y terminar una en curso pide también la contraseña', async () => {
  const user = userEvent.setup();
  const { calls } = api(superadmin, {
    [`POST /galaxy/api/admin/popups/${ID.draft}/delete`]: () => new Response(null, { status: 204 }),
    [`POST /galaxy/api/admin/popups/${ID.live}/end`]: () => jsonResponse(200, { ...list[2], state: 'ended' }),
  });
  renderAt('/admin/encuestas', { '/admin/encuestas': <PopupsScreen /> });
  const draft = within(await screen.findByRole('region', { name: t.groups.draft })).getByRole('listitem', { name: 'Borrador de invierno' });
  await user.click(within(draft).getByRole('button', { name: t.actions.remove }));
  let dialog = screen.getByRole('dialog', { name: t.removeTitle('Borrador de invierno') });
  expect(within(dialog).queryByLabelText(copy.admin.fields.password)).not.toBeInTheDocument();
  await user.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Ya no hace falta');
  await user.click(within(dialog).getByRole('button', { name: t.actions.remove }));
  expect(await screen.findByText(t.done.removed('Borrador de invierno'))).toBeInTheDocument();

  const live = within(screen.getByRole('region', { name: t.groups.live })).getByRole('listitem', { name: 'Valora Galaxy Survivor' });
  await user.click(within(live).getByRole('button', { name: t.actions.end }));
  dialog = screen.getByRole('dialog', { name: t.endTitle('Valora Galaxy Survivor') });
  expect(within(dialog).getByText(t.endText(15))).toBeInTheDocument();
  await user.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Ya tenemos bastantes');
  await user.type(within(dialog).getByLabelText(copy.admin.fields.password), 'mi-clave');
  await user.click(within(dialog).getByRole('button', { name: t.actions.end }));
  await waitFor(() =>
    expect(calls).toEqual([
      { path: `POST /galaxy/api/admin/popups/${ID.draft}/delete`, body: { reason: 'Ya no hace falta' } },
      { path: `POST /galaxy/api/admin/popups/${ID.live}/end`, body: { reason: 'Ya tenemos bastantes', password: 'mi-clave' } },
    ]),
  );
  expect(await screen.findByText(t.done.ended('Valora Galaxy Survivor'))).toBeInTheDocument();
});

// ---------------------------------------------------------------------------------------------------------------------
// The wizard

const step = (name: string) => screen.getByRole('button', { name: new RegExp(`^\\d?\\s*${name}`) });
const stepNames = () => within(screen.getByRole('list', { name: t.stepsLabel })).getAllByRole('button').map((b) => b.textContent?.replace(/^\d/, '').replace(/\d+ problemas? en .*$/, ''));

test('los problemas del servidor se cuentan en su paso y llevan a él', async () => {
  const user = userEvent.setup();
  api(superadmin, {
    'POST /galaxy/api/admin/popups/validate': () =>
      jsonResponse(200, {
        ok: false,
        issues: [
          { path: 'questions.0.prompt', message: 'Too small' },
          { path: 'endsAt', message: 'popup_end_past' },
          { path: 'startsAt', message: 'popup_dates' },
        ],
        bigReasons: [],
      }),
  });
  renderAt(`/admin/encuestas/${ID.draft}`, { '/admin/encuestas/:id': <PopupPage /> });
  await screen.findByLabelText(t.fields.title);
  await waitFor(() => expect(step(t.steps.audience)).toHaveTextContent(t.problemsIn(t.steps.audience, 2)));
  expect(step(t.steps.questions)).toHaveTextContent(t.problemsIn(t.steps.questions, 1));
  expect(step(t.steps.kind)).not.toHaveTextContent(/problema/);
  // A question's problem says which question and what to write.
  const text = t.questionIssue(1, t.questionIssues.prompt!);
  await user.click(screen.getByRole('button', { name: text }));
  expect(screen.getByRole('heading', { level: 2, name: t.steps.questions })).toBeInTheDocument();
  expect(screen.getAllByText(text).length).toBeGreaterThan(1);
});

test('una promoción no tiene ni Preguntas ni Premio, y vuelve a tenerlos al cambiar de tipo', async () => {
  const user = userEvent.setup();
  api();
  renderAt('/admin/encuestas/nueva', { '/admin/encuestas/:id': <PopupPage /> });
  await screen.findByLabelText(t.fields.title);
  expect(stepNames()).toEqual(Object.values(t.steps));
  await user.click(screen.getByRole('radio', { name: new RegExp(t.kinds.promotion) }));
  expect(stepNames()).toEqual([t.steps.kind, t.steps.media, t.steps.audience, t.steps.review]);
  await user.click(step(t.steps.media));
  expect(screen.getByRole('group', { name: t.fields.link })).toBeInTheDocument();
  await user.click(step(t.steps.kind));
  await user.click(screen.getByRole('radio', { name: new RegExp(t.kinds.form) }));
  expect(stepNames()).toEqual(Object.values(t.steps));
  await user.click(step(t.steps.media));
  expect(screen.queryByRole('group', { name: t.fields.link })).not.toBeInTheDocument();
  expect(screen.getByText(t.fields.linkOnlyPromotion)).toBeInTheDocument();
});

test('una plantilla rellena el tipo, el título y la pregunta', async () => {
  const user = userEvent.setup();
  api();
  renderAt('/admin/encuestas/nueva', { '/admin/encuestas/:id': <PopupPage /> });
  await screen.findByLabelText(t.fields.title);
  await user.click(screen.getByRole('button', { name: new RegExp(t.templates.nps.name) }));
  expect(screen.getByLabelText(t.fields.title)).toHaveValue(t.templates.nps.title);
  expect(screen.getByRole('radio', { name: new RegExp(t.kinds.survey) })).toBeChecked();
  await user.click(step(t.steps.questions));
  expect(screen.getByLabelText(t.q.prompt)).toHaveValue(t.templates.nps.prompt);
  expect(screen.getByRole('radio', { name: t.q.ranges['0-10'] })).toBeChecked();
  expect(screen.getByLabelText(t.q.low)).toHaveValue(t.templates.nps.low);
  // The review template: stars and an optional text.
  await user.click(step(t.steps.kind));
  await user.click(screen.getByRole('button', { name: new RegExp(t.templates.game.name) }));
  // The title was written already: it stays.
  expect(screen.getByLabelText(t.fields.title)).toHaveValue(t.templates.nps.title);
  await user.click(step(t.steps.questions));
  expect(screen.getAllByLabelText(t.q.prompt).map((x) => (x as HTMLInputElement).value)).toEqual([t.templates.game.prompt, t.templates.game.text]);
  expect(screen.getByRole('switch', { name: t.q.withText })).toBeChecked();
});

test('un formulario añade, ordena y cambia de tipo sus preguntas', async () => {
  const user = userEvent.setup();
  api();
  renderAt('/admin/encuestas/nueva', { '/admin/encuestas/:id': <PopupPage /> });
  await screen.findByLabelText(t.fields.title);
  await user.click(screen.getByRole('radio', { name: new RegExp(t.kinds.form) }));
  await user.click(step(t.steps.questions));
  await user.type(screen.getByLabelText(t.q.prompt), 'Primera');
  await user.click(screen.getByRole('button', { name: t.q.add }));
  const prompts = () => screen.getAllByLabelText(t.q.prompt).map((x) => (x as HTMLInputElement).value);
  await user.type(screen.getAllByLabelText(t.q.prompt)[1]!, 'Segunda');
  await user.click(screen.getByRole('button', { name: t.q.up(2) }));
  expect(prompts()).toEqual(['Segunda', 'Primera']);
  const second = screen.getAllByRole('listitem').find((li) => within(li).queryByText(t.q.n(2)))!;
  await user.click(within(second).getByRole('radio', { name: t.q.types.text }));
  expect(within(second).getByLabelText(t.q.maxLength)).toHaveValue('500');
  expect(within(second).getByRole('switch', { name: t.q.required })).not.toBeChecked();
  expect(prompts()).toEqual(['Segunda', 'Primera']);
});

test('guardar y publicar guarda el borrador a su versión y lo publica con la nueva, el motivo y la contraseña', async () => {
  const user = userEvent.setup();
  const draft = popup(ID.draft, 'draft', { version: 3 });
  const { calls } = api(superadmin, {
    [`GET /galaxy/api/admin/popups/${ID.draft}`]: () => jsonResponse(200, draft),
    [`POST /galaxy/api/admin/popups/${ID.draft}`]: () => jsonResponse(200, { ...draft, version: 4 }),
    [`POST /galaxy/api/admin/popups/${ID.draft}/publish`]: () => jsonResponse(200, { ...draft, version: 5, state: 'scheduled' }),
  });
  renderAt(`/admin/encuestas/${ID.draft}?paso=revision`, { '/admin/encuestas/:id': <PopupPage />, '/admin/encuestas': <p>Lista</p> });
  expect(await screen.findByRole('heading', { level: 2, name: t.steps.review })).toBeInTheDocument();
  // The real popup, in place.
  const preview = screen.getByRole('region', { name: t.preview });
  expect(within(preview).getByRole('heading', { name: 'Tu opinión cuenta' })).toBeInTheDocument();
  expect(within(within(preview).getByRole('radiogroup', { name: '¿Recomendarías Galaxy Survivor a un amigo?' })).getAllByRole('radio')).toHaveLength(11);
  expect(within(preview).getByRole('radio', { name: '1920 × 1080' })).toBeChecked();
  const publish = screen.getByRole('region', { name: t.publishNow });
  await user.type(within(publish).getByLabelText(copy.admin.fields.reason), 'Encuesta de la semana');
  await user.type(within(publish).getByLabelText(copy.admin.fields.password), 'mi-clave');
  await waitFor(() => expect(within(publish).getByRole('button', { name: t.publishNow })).toBeEnabled());
  await user.click(within(publish).getByRole('button', { name: t.publishNow }));
  await waitFor(() => expect(calls.map((c) => c.path)).toEqual([`POST /galaxy/api/admin/popups/${ID.draft}`, `POST /galaxy/api/admin/popups/${ID.draft}/publish`]));
  expect(calls[0]!.body).toMatchObject({ version: 3, reason: 'Encuesta de la semana', record: { title: 'Tu opinión cuenta', audience: { kind: 'all' } } });
  expect(calls[1]!.body).toEqual({ version: 4, reason: 'Encuesta de la semana', password: 'mi-clave' });
  expect(await screen.findByText('Lista')).toBeInTheDocument();
});

test('un premio grande sin ser superadmin no se publica, y dice por qué', async () => {
  const plain: MeResponse = { ...superadmin, roles: ['admin'] };
  api(plain, {
    [`GET /galaxy/api/admin/popups/${ID.draft}`]: () => jsonResponse(200, list[0]),
    'POST /galaxy/api/admin/popups/validate': () => jsonResponse(200, { ok: true, issues: [], bigReasons: ['recipients'] }),
  });
  renderAt(`/admin/encuestas/${ID.draft}?paso=revision`, { '/admin/encuestas/:id': <PopupPage /> });
  await screen.findByRole('heading', { level: 2, name: t.steps.review });
  expect(await screen.findByText(t.bigNeeds)).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: t.publishNow })).getByRole('button', { name: t.publishNow })).toBeDisabled();
});

test('una programada se ve como la verá el jugador; una en curso abre sus resultados', async () => {
  api();
  renderAt(`/admin/encuestas/${ID.scheduled}`, { '/admin/encuestas/:id': <PopupPage /> });
  expect(await screen.findByRole('heading', { level: 1, name: t.viewTitle })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: t.preview })).toHaveTextContent('Encuesta del lunes');
  expect(screen.getByRole('button', { name: t.actions.unpublish })).toBeInTheDocument();
  expect(screen.queryByRole('list', { name: t.stepsLabel })).not.toBeInTheDocument();

  api();
  renderAt(`/admin/encuestas/${ID.live}`, { '/admin/encuestas/:id': <PopupPage /> });
  await waitFor(() => expect(locationOf(screen.getByTestId('location')).pathname).toBe(`/admin/encuestas/${ID.live}/resultados`));
});

// ---------------------------------------------------------------------------------------------------------------------
// What the wizard shares

test('cada problema va a su paso, y el de un paso que el tipo no tiene va al primero', () => {
  expect(stepOf({ path: 'questions.2.options.0.label' }, 'form')).toBe('questions');
  expect(stepOf({ path: 'imageMedia' }, 'promotion')).toBe('media');
  expect(stepOf({ path: 'reward.0' }, 'survey')).toBe('reward');
  expect(stepOf({ path: 'reward' }, 'promotion')).toBe('kind');
  expect(stepOf({ path: 'audience' }, 'review')).toBe('audience');
  expect(issueText({ path: 'questions.1.options.3.label', message: 'Too small' })).toBe(t.questionIssue(2, t.questionIssues.label!));
  expect(issueText({ path: 'endsAt', message: 'popup_too_long' })).toBe(copy.popupIssues.popup_too_long);
});

test('una copia lleva «(copia)» y el mismo largo, a sus fechas si aún no empezó o desde la próxima hora', () => {
  const now = new Date('2026-11-22T10:20:00Z');
  const past = record({ startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-11-04T00:00:00.000Z', reward: [{ kind: 'xp', amount: 100 }] });
  const copied = copyRecord(past, now);
  expect(copied.title).toBe(t.copyOf(past.title));
  expect(copied.startsAt).toBe('2026-11-22T11:00:00.000Z');
  expect(Date.parse(copied.endsAt) - Date.parse(copied.startsAt)).toBe(3 * DAY);
  expect(copied.reward).toEqual(past.reward);
  const ahead = record({ startsAt: '2026-12-01T00:00:00.000Z', endsAt: '2026-12-02T00:00:00.000Z' });
  expect(copyRecord(ahead, now)).toMatchObject({ startsAt: ahead.startsAt, endsAt: ahead.endsAt });
});

test('las plantillas y el cambio de tipo dejan las preguntas con la forma de cada tipo', () => {
  const base = freshRecord('form', new Date('2026-11-22T10:00:00Z'));
  expect(applyTemplate(base, 'enemy', 'drone')).toMatchObject({ kind: 'survey', title: t.templates.enemy.title, questions: [{ type: 'scale', range: '1-5', subject: { kind: 'enemy', id: 'drone' } }] });
  const promo = withKind({ ...base, reward: [{ kind: 'xp', amount: 50 }] }, 'promotion');
  expect(promo).toMatchObject({ kind: 'promotion', questions: [], reward: [] });
  expect(withKind(promo, 'review').questions.map((q) => q.type)).toEqual(['stars']);
});

// ---------------------------------------------------------------------------------------------------------------------
// Results

const results: AdminPopupResults = {
  popup: list[2]!,
  totals: { seen: 40, answered: 12, later: 9, exhausted: 3, rewarded: 0, closed: 0, clicked: 0 },
  questions: [
    { type: 'stars', id: 'q1', n: 12, buckets: [1, 2, 3, 4, 5].map((v) => ({ value: v, count: [0, 1, 2, 4, 5][v - 1]!, pct: ([0, 1, 2, 4, 5][v - 1]! * 100) / 12 })), average: 4.08, topBox: 75 },
    { type: 'text', id: 'q2', n: 51 },
  ],
};
const npsResults: AdminPopupResults = {
  popup: popup(ID.live, 'live', { counts: { seen: 20, answered: 10, clicked: 0 } }),
  totals: { seen: 20, answered: 10, later: 2, exhausted: 0, rewarded: 0, closed: 0, clicked: 0 },
  questions: [
    {
      type: 'scale',
      id: 'q1',
      range: '0-10',
      n: 10,
      buckets: Array.from({ length: 11 }, (_, v) => ({ value: v, count: v === 3 ? 2 : v === 8 ? 3 : v === 10 ? 5 : 0, pct: v === 3 ? 20 : v === 8 ? 30 : v === 10 ? 50 : 0 })),
      average: 7.4,
      nps: { score: 30, promoters: 5, passives: 3, detractors: 2 },
      topBox: null,
    },
  ],
};
const page = (from: number, n: number, next: string | null): PopupTextsPage => ({
  question: 'q2',
  texts: Array.from({ length: n }, (_, i) => ({ username: `piloto${from + i}`, text: `Me gusta ${from + i}`, at: around(-i / 24) })),
  total: 51,
  next,
});

test('los resultados de una escala de 0 a 10 dan el NPS en tres tramos y las barras con sus números', async () => {
  api(superadmin, { [`GET /galaxy/api/admin/popups/${ID.live}/results`]: () => jsonResponse(200, npsResults) });
  renderAt(`/admin/encuestas/${ID.live}/resultados`, { '/admin/encuestas/:id/resultados': <PopupResults /> });
  expect(await screen.findByRole('heading', { level: 1, name: 'Tu opinión cuenta' })).toBeInTheDocument();
  expect(screen.getByText(t.tiles.rate).parentElement).toHaveTextContent('50 %');
  expect(screen.getByText('+30')).toBeInTheDocument();
  const legend = screen.getByRole('list', { name: t.npsBar });
  expect(within(legend).getByText(t.npsGroups.promoters).closest('li')).toHaveTextContent('550 %');
  expect(within(legend).getByText(t.npsGroups.detractors).closest('li')).toHaveTextContent('220 %');
  expect(screen.getByText('7,4')).toBeInTheDocument();
  // The bars' table, for screen readers: every value, zeros too.
  const table = screen.getByRole('table', { name: '¿Recomendarías Galaxy Survivor a un amigo?' });
  expect(within(table).getAllByRole('row')).toHaveLength(12);
  expect(within(table).getByRole('row', { name: /^10 5 50 %$/ })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: t.actions.csv })).toHaveAttribute('href', `/galaxy/api/admin/popups/${ID.live}/results.csv`);
});

test('las estrellas dan su media y cuántos dan 4 o 5, y los textos se leen de 50 en 50', async () => {
  const user = userEvent.setup();
  const { fetch } = api(superadmin, {
    [`GET /galaxy/api/admin/popups/${ID.live}/results`]: () => jsonResponse(200, results),
    [`GET /galaxy/api/admin/popups/${ID.live}/texts?question=q2`]: () => jsonResponse(200, page(1, 50, '77')),
    [`GET /galaxy/api/admin/popups/${ID.live}/texts?question=q2&cursor=77`]: () => jsonResponse(200, page(51, 1, null)),
  });
  renderAt(`/admin/encuestas/${ID.live}/resultados`, { '/admin/encuestas/:id/resultados': <PopupResults /> });
  expect(await screen.findByText('4,1')).toBeInTheDocument();
  expect(screen.getByText(t.topBox).parentElement).toHaveTextContent('75 %');
  expect(screen.getByRole('table', { name: '¿Cuántas estrellas le das?' })).toHaveTextContent(copy.popups.stars(5));
  expect(await screen.findByRole('link', { name: 'piloto1' })).toHaveAttribute('href', '/admin/jugadores/piloto1');
  expect(screen.getByText(t.textsShown(50, 51))).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: t.textsMore }));
  expect(await screen.findByRole('link', { name: 'piloto51' })).toBeInTheDocument();
  expect(screen.getByText(t.textsShown(51, 51))).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: t.textsMore })).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith(`/galaxy/api/admin/popups/${ID.live}/texts?question=q2&cursor=77`, expect.anything());
});
