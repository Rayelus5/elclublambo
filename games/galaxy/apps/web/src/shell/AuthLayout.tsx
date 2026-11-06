import type { CSSProperties } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { copy } from '../copy/es';
import { AuthBackdrop } from '../scene/AuthBackdrop';
import { useUi } from '../state/ui';
import { Icon } from '../ui/Icon';

export function Logo() {
  return (
    <div className="logo enter" style={{ '--d': '.5s' } as CSSProperties}>
      <h1>
        <span className="l1">Galaxy</span>
        <span className="l2">Survivor</span>
      </h1>
      <div className="braille" aria-hidden="true">
        {copy.brailleBrand}
      </div>
      <span className="beta">{copy.beta}</span>
    </div>
  );
}

export function MaintenanceNotice() {
  const on = useUi((s) => s.maintenance);
  if (!on) return null;
  return (
    <p className="notice" role="status">
      <Icon name="wrench" />
      <span>{copy.maintenance}</span>
    </p>
  );
}

/** Access screens: living sky, logo and one tactile panel with Entrar / Crear cuenta. */
export function AuthLayout() {
  const { pathname } = useLocation();
  const loginSide = pathname !== '/crear-cuenta';
  return (
    <div className="screen-root">
      <AuthBackdrop />
      <div className="ui">
        <Logo />
        <main className="lip panel auth enter" style={{ '--d': '.8s' } as CSSProperties}>
          <nav className="tabs" aria-label={copy.brand}>
            <NavLink to="/entrar" className={loginSide ? 'active' : undefined} aria-current={loginSide ? 'page' : undefined}>
              {copy.tabs.entrar}
            </NavLink>
            <NavLink to="/crear-cuenta">{copy.tabs.crear}</NavLink>
          </nav>
          <MaintenanceNotice />
          <div className="swap" key={pathname}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
