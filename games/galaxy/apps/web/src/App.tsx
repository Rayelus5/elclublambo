import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { useMe } from './auth/useMe';
import { CollectionScreen } from './collection/CollectionScreen';
import { HangarScreen } from './hangar/HangarScreen';
import { ProbeTestScreen } from './probe-test/ProbeTest';
import { StationScreen } from './station/StationScreen';
import { LabScreen } from './lab/LabScreen';
import { PlanetariumScreen } from './planetarium/PlanetariumScreen';
import { VisitScreen } from './planetarium/VisitScreen';
import { LeaderboardScreen } from './social/LeaderboardScreen';
import { MarketScreen } from './market/MarketScreen';
import { AdminHome, AdminLayout, AdminOnly } from './admin/AdminLayout';
import { AuditScreen } from './admin/AuditScreen';
import { CommunicationScreen } from './admin/CommunicationScreen';
import { ConfigKeyScreen, ConfigScreen } from './admin/ConfigScreen';
import { ClanList, ClanPage } from './admin/ModClans';
import { Alerts, Commerce } from './admin/ModMarket';
import { LiveChat, ModerationLayout, Mutes, Reports } from './admin/ModerationScreen';
import { PlayerScreen } from './admin/PlayerScreen';
import { PlayersScreen } from './admin/PlayersScreen';
import { ClanScreen } from './clans/ClanScreen';
import { ClansScreen } from './clans/ClansScreen';
import { ProfileScreen } from './social/ProfileScreen';
import { PublicCollectionScreen } from './social/PublicCollectionScreen';
import { ScannerScreen } from './scanner/ScannerScreen';
import { ChatHost } from './chat/ChatPanel';
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
  // The chat sheet sits above every screen (M5b-2).
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/escaner" element={<SignedIn><ScannerScreen /></SignedIn>} />
        <Route path="/coleccion" element={<SignedIn><CollectionScreen /></SignedIn>} />
        <Route path="/coleccion/:id" element={<SignedIn><CollectionScreen /></SignedIn>} />
        <Route path="/incursion" element={<SignedIn><HangarScreen /></SignedIn>} />
        <Route path="/sonda" element={<SignedIn><ProbeTestScreen /></SignedIn>} />
        <Route path="/estacion" element={<SignedIn><StationScreen /></SignedIn>} />
        <Route path="/laboratorio" element={<SignedIn><LabScreen /></SignedIn>} />
        <Route path="/planetario" element={<SignedIn><PlanetariumScreen /></SignedIn>} />
        <Route path="/planetario/:username" element={<SignedIn><VisitScreen /></SignedIn>} />
        <Route path="/clasificacion" element={<SignedIn><LeaderboardScreen /></SignedIn>} />
        <Route path="/clanes" element={<SignedIn><ClansScreen /></SignedIn>} />
        <Route path="/mercado" element={<SignedIn><MarketScreen /></SignedIn>} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminHome />} />
          <Route element={<AdminOnly />}>
            <Route path="jugadores" element={<PlayersScreen />} />
            <Route path="jugadores/:username" element={<PlayerScreen />} />
            <Route path="auditoria" element={<AuditScreen />} />
            <Route path="configuracion" element={<ConfigScreen />} />
            <Route path="configuracion/:key" element={<ConfigKeyScreen />} />
            <Route path="comunicacion" element={<CommunicationScreen />} />
          </Route>
          <Route path="moderacion" element={<ModerationLayout />}>
            <Route index element={<Reports />} />
            <Route path="chat" element={<LiveChat />} />
            <Route path="silencios" element={<Mutes />} />
            <Route element={<AdminOnly />}>
              <Route path="clanes" element={<ClanList />} />
              <Route path="clanes/:tag" element={<ClanPage />} />
              <Route path="comercio" element={<Commerce />} />
              <Route path="alertas" element={<Alerts />} />
            </Route>
          </Route>
        </Route>
        <Route path="/clanes/:tag" element={<SignedIn><ClanScreen /></SignedIn>} />
        <Route path="/perfil/:username" element={<SignedIn><ProfileScreen /></SignedIn>} />
        <Route path="/perfil/:username/coleccion" element={<SignedIn><PublicCollectionScreen /></SignedIn>} />
        <Route element={<AuthLayout />}>
          <Route path="/entrar" element={<GuestOnly><Entrar /></GuestOnly>} />
          <Route path="/crear-cuenta" element={<GuestOnly to="/sonda"><CrearCuenta /></GuestOnly>} />
          <Route path="/verificar" element={<Verificar />} />
          <Route path="/recuperar" element={<Recuperar />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ChatHost />
    </>
  );
}
