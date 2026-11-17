import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { InstallPill } from '../src/pwa/InstallPill';
import { resetInstall, watchInstall } from '../src/pwa/install';
import { DisplaySection } from '../src/settings/SettingsSections';

// The installable app in the game's own screens (galaxysurvivor.es plan, PR 3): Ajustes › Pantalla installs it or says
// how, and turns full screen on and off (Escape still pauses the run); the title screen's foot offers it in a small
// pill that the player can hide for good. Nothing of it inside a run.

const t = copy.settings;

function offer() {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
  event.prompt = vi.fn(async () => {});
  event.userChoice = Promise.resolve({ outcome: 'accepted' });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

function standalone(on: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q === '(display-mode: standalone)', addEventListener() {}, removeEventListener() {} }));
}

/** The manifest link the server writes on the game's own host. */
function linkManifest() {
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = '/galaxy/manifest.webmanifest';
  document.head.append(link);
}

/** A browser with the Fullscreen API and keyboard lock (Chrome, Edge), driven by hand. */
function fullscreenApi() {
  let element: Element | null = null;
  const change = (el: Element | null) => {
    element = el;
    document.dispatchEvent(new Event('fullscreenchange'));
  };
  Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true });
  Object.defineProperty(document, 'fullscreenElement', { get: () => element, configurable: true });
  const request = vi.fn(async function (this: Element) {
    change(this);
  });
  const exit = vi.fn(async () => change(null));
  const keyboard = { lock: vi.fn(async () => {}), unlock: vi.fn() };
  Object.defineProperty(document.documentElement, 'requestFullscreen', { value: request, configurable: true });
  Object.defineProperty(document, 'exitFullscreen', { value: exit, configurable: true });
  Object.defineProperty(navigator, 'keyboard', { value: keyboard, configurable: true });
  return { request, exit, keyboard, change };
}

let stop: () => void = () => {};
beforeEach(() => {
  resetInstall();
  standalone(false);
  stop = watchInstall(window);
});
afterEach(() => {
  stop();
  vi.unstubAllGlobals();
  document.head.querySelectorAll('link[rel="manifest"]').forEach((l) => l.remove());
  for (const key of ['fullscreenEnabled', 'fullscreenElement', 'exitFullscreen'] as const) delete (document as unknown as Record<string, unknown>)[key];
  delete (document.documentElement as unknown as Record<string, unknown>)['requestFullscreen'];
  delete (navigator as unknown as Record<string, unknown>)['keyboard'];
  localStorage.clear();
});

describe('Ajustes › Pantalla: instalar el juego', () => {
  test('con la oferta del navegador, «Instalar» la abre', async () => {
    linkManifest();
    render(<DisplaySection />);
    expect(screen.getByText(t.install)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t.installButton })).toBeNull();
    const event = offer();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: t.installButton })));
    expect(event.prompt).toHaveBeenCalledOnce();
  });

  test('en la app instalada dice que ya la tienes', () => {
    stop();
    standalone(true);
    stop = watchInstall(window);
    linkManifest();
    render(<DisplaySection />);
    expect(screen.getByText(t.installDone)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t.installButton })).toBeNull();
  });

  test('al instalarla desde aquí también lo dice', () => {
    linkManifest();
    render(<DisplaySection />);
    offer();
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(screen.getByText(t.installDone)).toBeInTheDocument();
  });

  test('sin oferta (otro navegador, o ya instalada) explica dónde está el icono', () => {
    linkManifest();
    render(<DisplaySection />);
    expect(screen.getByText(t.installHow)).toBeInTheDocument();
  });

  test('donde no se puede instalar (sin manifest) y en una incursión, no sale', () => {
    render(<DisplaySection />);
    expect(screen.queryByText(t.install)).toBeNull();
    linkManifest();
    render(<DisplaySection inRun />);
    expect(screen.queryByText(t.install)).toBeNull();
  });
});

describe('Ajustes › Pantalla: pantalla completa', () => {
  test('el interruptor entra con el teclado bloqueado para Esc, y sale', async () => {
    const api = fullscreenApi();
    render(<DisplaySection />);
    const toggle = screen.getByRole('switch', { name: t.fullscreen });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await act(async () => fireEvent.click(toggle));
    expect(api.request).toHaveBeenCalledOnce();
    expect(api.keyboard.lock).toHaveBeenCalledWith(['Escape']);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await act(async () => fireEvent.click(toggle));
    expect(api.keyboard.unlock).toHaveBeenCalled();
    expect(api.exit).toHaveBeenCalledOnce();
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  test('sigue al navegador cuando se sale de otra forma (Esc mantenido)', async () => {
    const api = fullscreenApi();
    render(<DisplaySection />);
    const toggle = screen.getByRole('switch', { name: t.fullscreen });
    await act(async () => fireEvent.click(toggle));
    act(() => api.change(null));
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  test('sin la API (o en una incursión) no sale', () => {
    render(<DisplaySection />);
    expect(screen.queryByRole('switch', { name: t.fullscreen })).toBeNull();
    fullscreenApi();
    render(<DisplaySection inRun />);
    expect(screen.queryByRole('switch', { name: t.fullscreen })).toBeNull();
  });
});

describe('la píldora de instalar en el pie de la pantalla de título', () => {
  const pill = () =>
    render(
      <MemoryRouter>
        <InstallPill />
      </MemoryRouter>,
    );

  test('solo sale cuando el navegador ofrece instalar, y abre la oferta', async () => {
    pill();
    expect(screen.queryByRole('button', { name: copy.hub.install })).toBeNull();
    const event = offer();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: copy.hub.install })));
    expect(event.prompt).toHaveBeenCalledOnce();
    // Used: it goes until the browser offers it again.
    expect(screen.queryByRole('button', { name: copy.hub.install })).toBeNull();
  });

  test('nunca en la app instalada', () => {
    stop();
    standalone(true);
    stop = watchInstall(window);
    pill();
    offer();
    expect(screen.queryByRole('button', { name: copy.hub.install })).toBeNull();
  });

  test('se puede ocultar para siempre', () => {
    const view = pill();
    offer();
    fireEvent.click(screen.getByRole('button', { name: copy.hub.installHide }));
    expect(screen.queryByRole('button', { name: copy.hub.install })).toBeNull();
    expect(localStorage.getItem('galaxy.install.hidden')).toBe('1');
    view.unmount();
    pill();
    expect(screen.queryByRole('button', { name: copy.hub.install })).toBeNull();
  });

  test('sin localStorage se oculta igual en esta visita', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      pill();
      offer();
      fireEvent.click(screen.getByRole('button', { name: copy.hub.installHide }));
      expect(screen.queryByRole('button', { name: copy.hub.install })).toBeNull();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});
