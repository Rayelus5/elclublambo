import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { AnomalyTag } from '../src/hub/AnomalyTag';
import { copy } from '../src/copy/es';
import { jsonResponse, mockApi, renderAt } from './render';

// The season's anomaly as a tag (the multipliers moved to Noticias and Condiciones de hoy: news.test, today.test).
afterEach(() => vi.unstubAllGlobals());

test('la anomalía es una etiqueta con su nombre, y lo que hace sale en una ventana al pedir más información (pulido de M8)', async () => {
  const anomaly = { id: 'contagion', name: 'Corrosión contagiosa', description: 'Un enemigo corroído que cae corroe a los que tiene cerca' };
  mockApi({ 'GET /galaxy/api/boosts': () => jsonResponse(200, { boosts: [], anomaly }) });
  renderAt('/', { '/': <AnomalyTag /> });
  expect(await screen.findByText(copy.anomaly.tag(anomaly.name))).toBeInTheDocument();
  expect(screen.queryByText(anomaly.description)).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: copy.anomaly.more(anomaly.name) }));
  const dialog = screen.getByRole('dialog', { name: anomaly.name });
  expect(dialog).toHaveTextContent(anomaly.description);
  await userEvent.click(within(dialog).getByRole('button', { name: copy.anomaly.close }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
