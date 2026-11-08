import type { OnboardingView } from '@galaxy/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { FirstSteps } from '../src/hub/FirstSteps';
import { GuideScreen } from '../src/hub/GuideScreen';
import { jsonResponse, mockApi, renderAt } from './render';

// The first steps and the Guía (GDD §12.2; M7c).
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const halfway: OnboardingView = { probeTest: true, firstRun: true, welcomePulls: false, repairRoom: false, equipRelic: false };

test('los primeros pasos tachan lo hecho, llevan a lo que falta y se pueden ocultar', async () => {
  mockApi({ 'GET /galaxy/api/onboarding': () => jsonResponse(200, halfway) });
  renderAt('/', { '/': <FirstSteps /> });
  expect(await screen.findByText(copy.firstSteps.count(2, 5))).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: copy.firstSteps.steps.probeTest })).toBeNull();
  expect(screen.getByRole('link', { name: copy.firstSteps.steps.welcomePulls })).toHaveAttribute('href', '/escaner');
  await userEvent.click(screen.getByRole('button', { name: copy.firstSteps.hide }));
  expect(screen.queryByText(copy.firstSteps.title)).toBeNull();
  expect(localStorage.getItem('galaxy.firstSteps.hidden')).toBe('1');
});

test('con todo hecho no se enseñan', async () => {
  const all: OnboardingView = { probeTest: true, firstRun: true, welcomePulls: true, repairRoom: true, equipRelic: true };
  let asked = 0;
  mockApi({ 'GET /galaxy/api/onboarding': () => (asked++, jsonResponse(200, all)) });
  renderAt('/', { '/': <FirstSteps /> });
  await vi.waitFor(() => expect(asked).toBe(1));
  expect(screen.queryByText(copy.firstSteps.title)).toBeNull();
});

test('la Guía cambia de capítulo con sus puntos', async () => {
  renderAt('/guia', { '/guia': <GuideScreen /> });
  expect(screen.getByRole('heading', { level: 2, name: copy.guide.chapters.run.title })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: copy.guide.chapters.station.title }));
  expect(screen.getByRole('heading', { level: 2, name: copy.guide.chapters.station.title })).toBeInTheDocument();
  expect(screen.getByText(copy.guide.chapters.station.points[0])).toBeInTheDocument();
  expect(screen.getByRole('button', { name: copy.guide.chapters.station.title })).toHaveAttribute('aria-pressed', 'true');
});
