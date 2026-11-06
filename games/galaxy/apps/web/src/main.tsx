import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { DesktopGate } from './shell/DesktopGate';
import './styles/app.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

// One orchestrated entrance per screen (DESIGN_SYSTEM §5): `.ready` starts it, `.settled` removes the delays.
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
requestAnimationFrame(() => document.body.classList.add('ready'));
window.setTimeout(() => document.body.classList.add('settled'), reduce ? 0 : 2200);

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
