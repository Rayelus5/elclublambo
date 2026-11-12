import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { DesktopGate } from './shell/DesktopGate';
import { applyPrefs, prefersReduced } from './settings/prefs';
import { applyCursor, readCursor } from './ui/cursor';
import './styles/app.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

// The game's own preferences on <html> (motion, colour vision), before anything paints.
applyPrefs();

// One orchestrated entrance per screen (DESIGN_SYSTEM §5): `.ready` starts it, `.settled` removes the delays.
const reduce = prefersReduced();
requestAnimationFrame(() => document.body.classList.add('ready'));
window.setTimeout(() => document.body.classList.add('settled'), reduce ? 0 : 2200);

// The game's own cursor (open beta), as this browser left it.
applyCursor(readCursor());
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/galaxy">
        <DesktopGate>
          <App />
        </DesktopGate>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
