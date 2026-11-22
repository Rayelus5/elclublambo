import { popupAnswersSchema, type PopupAnswerResult, type PopupView } from '@galaxy/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { playClaim } from '../src/missions/sfx';
import { CampaignPopup } from '../src/popups/CampaignPopup';
import { jsonResponse, locationOf, mockApi, renderAt } from './render';

// «Encuestas y avisos» (plan 2026-11-22, part A): each question as the player answers it — the scale, the stars, the
// options and the text — with the keys of a radio group, «Enviar» held until what must be answered is, the answers sent
// as the server takes them, the reward revealed (or a thank-you without one), and a promotion's «Ver más».

vi.mock('../src/missions/sfx', () => ({ playClaim: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(playClaim).mockClear();
});

const ID = '22222222-2222-4222-8222-222222222222';
const base = { id: ID, body: '', image: null, link: null, reward: [] } satisfies Partial<PopupView>;
const survey: PopupView = {
  ...base,
  kind: 'survey',
  title: 'Tu opinión cuenta',
  questions: [{ type: 'scale', id: 'rec', prompt: '¿Recomendarías el juego?', range: '1-5', low: 'Poco probable', high: 'Muy probable', subject: null }],
};
const nps: PopupView = {
  ...base,
  kind: 'survey',
  title: 'Los Núcleos',
  questions: [{ type: 'scale', id: 'hard', prompt: '¿Qué te parece este Núcleo?', range: '0-10', low: 'Muy fácil', high: 'Muy difícil', subject: { kind: 'boss', id: 'anemone', name: 'La Anémona Rey', sprite: 'anemone' } }],
};
const review: PopupView = {
  ...base,
  kind: 'review',
  title: 'Valora Galaxy Survivor',
  questions: [
    { type: 'stars', id: 'stars', prompt: '¿Cuántas estrellas le das?' },
    { type: 'text', id: 'why', prompt: 'Cuéntanos por qué', placeholder: 'Escribe aquí', required: false, maxLength: 500 },
  ],
};
const form: PopupView = {
  ...base,
  kind: 'form',
  title: 'Tu partida ideal',
  questions: [
    { type: 'choice', id: 'mode', prompt: '¿Cómo juegas más?', multi: false, options: [{ id: 'solo', label: 'Solo' }, { id: 'group', label: 'En grupo' }] },
    { type: 'choice', id: 'likes', prompt: '¿Qué te gusta más?', multi: true, options: [{ id: 'scan', label: 'El escáner' }, { id: 'runs', label: 'Las incursiones' }, { id: 'clans', label: 'Los clanes' }, { id: 'market', label: 'El mercado' }] },
    { type: 'text', id: 'idea', prompt: '¿Qué añadirías?', placeholder: 'Escribe aquí', required: true, maxLength: 300 },
  ],
};
const wallet = { coins: 1750, dust: 40, signal: 10 };
const ok = (granted: PopupAnswerResult['granted']): PopupAnswerResult => ({ granted, skipped: null, wallet });

function show(popup: PopupView, routes: Parameters<typeof mockApi>[0] = {}) {
  const onDone = vi.fn();
  const fetch = mockApi(routes);
  const view = renderAt('/', { '/': <CampaignPopup popup={popup} onDone={onDone} /> });
  return { onDone, fetch, view };
}
const send = () => screen.getByRole('button', { name: copy.popups.send });

test('la escala de 1 a 5 se elige con flechas, Inicio y Fin, y el foco sigue a la elegida', () => {
  show(survey);
  const group = screen.getByRole('radiogroup', { name: '¿Recomendarías el juego?' });
  expect(group).toHaveAccessibleDescription('1 es Poco probable y 5 es Muy probable');
  const radios = within(group).getAllByRole('radio');
  expect(radios.map((r) => r.textContent)).toEqual(['1', '2', '3', '4', '5']);
  // Nothing chosen: the first takes the Tab key.
  expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1, -1, -1]);
  fireEvent.keyDown(radios[0]!, { key: 'ArrowRight' });
  expect(radios[1]).toHaveAttribute('aria-checked', 'true');
  expect(radios[1]).toHaveFocus();
  fireEvent.keyDown(radios[1]!, { key: 'End' });
  expect(radios[4]).toHaveAttribute('aria-checked', 'true');
  fireEvent.keyDown(radios[4]!, { key: 'Home' });
  expect(radios[0]).toHaveAttribute('aria-checked', 'true');
  fireEvent.keyDown(radios[0]!, { key: 'ArrowLeft' });
  expect(radios[4]).toHaveAttribute('aria-checked', 'true');
  expect(radios[4]).toHaveFocus();
  expect(radios.map((r) => r.tabIndex)).toEqual([-1, -1, -1, -1, 0]);
});

test('la escala de 0 a 10 lleva su tema dibujado y empieza en 0', () => {
  show(nps);
  expect(screen.getByText('La Anémona Rey')).toBeInTheDocument();
  expect(screen.getByText(copy.popups.subject.boss)).toBeInTheDocument();
  const radios = within(screen.getByRole('radiogroup', { name: '¿Qué te parece este Núcleo?' })).getAllByRole('radio');
  expect(radios).toHaveLength(11);
  fireEvent.keyDown(radios[0]!, { key: 'End' });
  expect(radios[10]).toHaveAttribute('aria-checked', 'true');
  expect(radios[10]).toHaveTextContent('10');
  fireEvent.keyDown(radios[10]!, { key: 'Home' });
  expect(radios[0]).toHaveAttribute('aria-checked', 'true');
  expect(radios[0]).toHaveTextContent('0');
});

test('«Enviar» espera a que la escala tenga respuesta', () => {
  show(survey);
  expect(send()).toBeDisabled();
  fireEvent.click(screen.getByRole('radio', { name: '4' }));
  expect(send()).toBeEnabled();
});

test('las estrellas se nombran por su número, se eligen con las flechas y el texto opcional cuenta sus caracteres', () => {
  show(review);
  const group = screen.getByRole('radiogroup', { name: '¿Cuántas estrellas le das?' });
  const stars = within(group).getAllByRole('radio');
  expect(stars.map((s) => s.getAttribute('aria-label'))).toEqual(['1 estrella', '2 estrellas', '3 estrellas', '4 estrellas', '5 estrellas']);
  expect(send()).toBeDisabled();
  fireEvent.keyDown(stars[0]!, { key: 'ArrowRight' });
  expect(screen.getByRole('radio', { name: '2 estrellas' })).toHaveAttribute('aria-checked', 'true');
  fireEvent.keyDown(stars[1]!, { key: 'End' });
  expect(screen.getByRole('radio', { name: '5 estrellas' })).toHaveAttribute('aria-checked', 'true');
  fireEvent.keyDown(stars[4]!, { key: 'ArrowLeft' });
  expect(screen.getByRole('radio', { name: '4 estrellas' })).toHaveAttribute('aria-checked', 'true');
  // The text is optional: the stars are enough.
  expect(send()).toBeEnabled();
  const text = screen.getByRole('textbox', { name: 'Cuéntanos por qué' });
  expect(text).toHaveAttribute('placeholder', 'Escribe aquí');
  expect(text).toHaveAttribute('maxlength', '500');
  expect(screen.getByText(copy.popups.count(0, 500))).toBeInTheDocument();
  fireEvent.change(text, { target: { value: 'Me encanta el escáner' } });
  expect(screen.getByText(copy.popups.count(21, 500))).toBeInTheDocument();
});

test('un formulario va pregunta a pregunta, con la múltiple como casillas, y envía lo que el servidor acepta', async () => {
  const { fetch } = show(form, { [`POST /galaxy/api/popups/${ID}/answer`]: () => jsonResponse(200, ok(null)) });
  expect(screen.getByText(copy.popups.step(1, 3))).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: copy.popups.previous })).toBeNull();
  const next = () => screen.getByRole('button', { name: copy.popups.next });
  expect(next()).toBeDisabled();
  fireEvent.click(screen.getByRole('radio', { name: 'En grupo' }));
  fireEvent.click(next());
  expect(screen.getByText(copy.popups.step(2, 3))).toBeInTheDocument();
  expect(screen.getByText(copy.popups.multiHint)).toBeInTheDocument();
  const scan = screen.getByRole('checkbox', { name: 'El escáner' });
  const market = screen.getByRole('checkbox', { name: 'El mercado' });
  expect(next()).toBeDisabled();
  fireEvent.click(market);
  fireEvent.click(scan);
  expect(scan).toHaveAttribute('aria-checked', 'true');
  expect(market).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(scan);
  expect(scan).toHaveAttribute('aria-checked', 'false');
  fireEvent.click(scan);
  // «Anterior» keeps what was answered.
  fireEvent.click(screen.getByRole('button', { name: copy.popups.previous }));
  expect(screen.getByRole('radio', { name: 'En grupo' })).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(next());
  expect(screen.getByRole('checkbox', { name: 'El mercado' })).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(next());
  expect(screen.getByText(copy.popups.step(3, 3))).toBeInTheDocument();
  // A text that must be answered holds «Enviar» until it has something (spaces are nothing).
  const text = screen.getByRole('textbox', { name: '¿Qué añadirías?' });
  fireEvent.change(text, { target: { value: '   ' } });
  expect(send()).toBeDisabled();
  fireEvent.change(text, { target: { value: '  Más Núcleos  ' } });
  fireEvent.click(send());
  await screen.findByText(copy.popups.thanks);
  const call = fetch.mock.calls.find(([url]) => url === `/galaxy/api/popups/${ID}/answer`)!;
  const body = JSON.parse(String(call[1]!.body));
  expect(body).toEqual({
    answers: [
      { q: 'mode', choices: ['group'] },
      { q: 'likes', choices: ['scan', 'market'] },
      { q: 'idea', text: 'Más Núcleos' },
    ],
  });
  expect(popupAnswersSchema.safeParse(body.answers).success).toBe(true);
  expect((call[1]!.headers as Record<string, string>)['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
});

test('sin premio da las gracias en el mismo diálogo y «Cerrar» lo cierra', async () => {
  const { onDone } = show(survey, { [`POST /galaxy/api/popups/${ID}/answer`]: () => jsonResponse(200, ok(null)) });
  fireEvent.click(screen.getByRole('radio', { name: '5' }));
  fireEvent.click(send());
  expect(await screen.findByText(copy.popups.thanks)).toBeInTheDocument();
  expect(screen.queryByText(copy.popups.rewardIn)).toBeNull();
  expect(playClaim).not.toHaveBeenCalled();
  const close = screen.getByRole('button', { name: copy.popups.close });
  expect(close).toHaveFocus();
  fireEvent.click(close);
  expect(onDone).toHaveBeenCalledTimes(1);
});

test('con premio lo anuncia antes de enviar y al enviar suena y lo revela', async () => {
  const coins = { kind: 'currency', currency: 'coins', amount: 500 } as const;
  const { onDone } = show({ ...survey, reward: [coins] }, { [`POST /galaxy/api/popups/${ID}/answer`]: () => jsonResponse(200, ok([{ gift: coins, outcome: 'granted' }])) });
  expect(screen.getByText(copy.popups.rewardLead)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: '3' }));
  fireEvent.click(send());
  const reveal = await screen.findByRole('dialog', { name: copy.mail.reveal.title });
  expect(within(reveal).getByText(/500/)).toBeInTheDocument();
  expect(screen.getByText(copy.popups.rewardIn)).toBeInTheDocument();
  await waitFor(() => expect(playClaim).toHaveBeenCalledWith(expect.objectContaining({ coins: 500 }), false));
  fireEvent.click(within(reveal).getByRole('button', { name: copy.mail.reveal.close }));
  expect(onDone).toHaveBeenCalledTimes(1);
});

test('un error al enviar se dice con su texto y deja intentarlo otra vez', async () => {
  show(survey, { [`POST /galaxy/api/popups/${ID}/answer`]: () => jsonResponse(409, { error: 'popup_answered' }) });
  fireEvent.click(screen.getByRole('radio', { name: '2' }));
  fireEvent.click(send());
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.errors.popup_answered);
  expect(screen.queryByText(copy.popups.thanks)).toBeNull();
});

const promo: PopupView = {
  ...base,
  kind: 'promotion',
  title: 'Copa de hielo',
  body: 'El primer torneo de la temporada ya está aquí',
  image: 'https://example.test/banner.png',
  link: { kind: 'route', to: '/temporada', label: 'Ver la temporada' },
  questions: [],
};

test('una promoción lleva a su enlace con «Ver más» y lo cuenta como pulsado', async () => {
  const { fetch, onDone } = show(promo, { [`POST /galaxy/api/popups/${ID}/seen`]: () => jsonResponse(204) });
  expect(screen.getByRole('dialog', { name: 'Copa de hielo' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: 'Ver la temporada' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith(`/galaxy/api/popups/${ID}/seen`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ clicked: true }) })));
  expect(onDone).toHaveBeenCalledTimes(1);
  expect(locationOf(screen.getByTestId('location')).pathname).toBe('/temporada');
});

test('una web se abre en otra pestaña y lo dice', () => {
  show({ ...promo, link: { kind: 'url', href: 'https://discord.gg/galaxy', label: 'Únete' } });
  const more = screen.getByRole('link', { name: `Únete. ${copy.popups.opensOutside}` });
  expect(more).toHaveAttribute('href', 'https://discord.gg/galaxy');
  expect(more).toHaveAttribute('target', '_blank');
  expect(more).toHaveAttribute('rel', 'noopener noreferrer');
});

test('cerrar una promoción, con su botón o con Escape, la cuenta como vista sin pulsar', async () => {
  const { fetch, onDone } = show(promo, { [`POST /galaxy/api/popups/${ID}/seen`]: () => jsonResponse(204) });
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() => expect(fetch).toHaveBeenCalledWith(`/galaxy/api/popups/${ID}/seen`, expect.objectContaining({ body: JSON.stringify({ clicked: false }) })));
  expect(onDone).toHaveBeenCalledTimes(1);
});

test('una promoción sin enlace cierra con su botón redondo cuando el texto cabe', async () => {
  const { fetch, onDone } = show({ ...promo, link: null }, { [`POST /galaxy/api/popups/${ID}/seen`]: () => jsonResponse(204) });
  const buttons = screen.getAllByRole('button', { name: copy.popups.close });
  fireEvent.click(buttons[buttons.length - 1]!);
  await waitFor(() => expect(fetch).toHaveBeenCalledWith(`/galaxy/api/popups/${ID}/seen`, expect.objectContaining({ body: JSON.stringify({ clicked: false }) })));
  expect(onDone).toHaveBeenCalledTimes(1);
});

test('en línea (la vista previa del panel) no manda nada y enseña las gracias', () => {
  const onDone = vi.fn();
  const fetch = mockApi({});
  renderAt('/', { '/': <CampaignPopup popup={survey} onDone={onDone} inline /> });
  expect(screen.queryByRole('dialog')).toBeNull();
  const box = screen.getByRole('region', { name: survey.title });
  fireEvent.click(within(box).getByRole('radio', { name: '4' }));
  fireEvent.click(within(box).getByRole('button', { name: copy.popups.send }));
  expect(within(box).getByText(copy.popups.thanks)).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});
