import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { useMe } from './auth/useMe';
import { copy } from './copy/es';
import { CrearCuenta } from './routes/CrearCuenta';
import { Entrar } from './routes/Entrar';
import { Inicio } from './routes/Inicio';
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

/** Signed-out only: a live session goes straight home. */
function GuestOnly({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isPending) return <Splash />;
  return me.data ? <Navigate to="/" replace /> : <>{children}</>;
}

function Home() {
  const me = useMe();
  if (me.isPending) return <Splash />;
  return me.data ? <Inicio me={me.data} /> : <Navigate to="/entrar" replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route element={<AuthLayout />}>
        <Route path="/entrar" element={<GuestOnly><Entrar /></GuestOnly>} />
        <Route path="/crear-cuenta" element={<GuestOnly><CrearCuenta /></GuestOnly>} />
        <Route path="/verificar" element={<Verificar />} />
        <Route path="/recuperar" element={<Recuperar />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
