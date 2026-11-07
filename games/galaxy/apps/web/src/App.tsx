import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { useMe } from './auth/useMe';
import { CollectionScreen } from './collection/CollectionScreen';
import { HangarScreen } from './hangar/HangarScreen';
import { ProbeTestScreen } from './probe-test/ProbeTest';
import { StationScreen } from './station/StationScreen';
import { ScannerScreen } from './scanner/ScannerScreen';
import { copy } from './copy/es';
import { TitleScreen } from './hub/TitleScreen';
import { CrearCuenta } from './routes/CrearCuenta';
import { Entrar } from './routes/Entrar';
import { Recuperar } from './routes/Recuperar';
import { Verificar } from './routes/Verificar';
import { AuthLayout } from './shell/AuthLayout';

function Splash() {
  return (
    <div className="splash" role="status" aria-label={copy.loading}>
      <span aria-hidden="true">⠋⠙⠹</span>
    </div>
  );
}

/**
 * Signed-out only: a live session goes to `to` (home by default). The screen that signs in also navigates; both must
 * aim at the same place, because the router's navigation is a transition and this guard re-renders before it lands.
 */
function GuestOnly({ children, to = '/' }: { children: ReactNode; to?: string }) {
  const me = useMe();
  if (me.isPending) return <Splash />;
  return me.data ? <Navigate to={to} replace /> : <>{children}</>;
}

/** Signed-in only: without a session, Entrar. */
function SignedIn({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isPending) return <Splash />;
  return me.data ? <>{children}</> : <Navigate to="/entrar" replace />;
}

function Home() {
  const me = useMe();
  if (me.isPending) return <Splash />;
  return me.data ? <TitleScreen me={me.data} /> : <Navigate to="/entrar" replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/escaner" element={<SignedIn><ScannerScreen /></SignedIn>} />
      <Route path="/coleccion" element={<SignedIn><CollectionScreen /></SignedIn>} />
      <Route path="/coleccion/:id" element={<SignedIn><CollectionScreen /></SignedIn>} />
      <Route path="/incursion" element={<SignedIn><HangarScreen /></SignedIn>} />
      <Route path="/sonda" element={<SignedIn><ProbeTestScreen /></SignedIn>} />
      <Route path="/estacion" element={<SignedIn><StationScreen /></SignedIn>} />
      <Route element={<AuthLayout />}>
        <Route path="/entrar" element={<GuestOnly><Entrar /></GuestOnly>} />
        <Route path="/crear-cuenta" element={<GuestOnly to="/sonda"><CrearCuenta /></GuestOnly>} />
        <Route path="/verificar" element={<Verificar />} />
        <Route path="/recuperar" element={<Recuperar />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
