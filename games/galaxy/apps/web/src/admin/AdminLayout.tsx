import { Link, Navigate, NavLink, Outlet } from 'react-router';
import { isAdmin, useMe } from '../auth/useMe';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';

const t = copy.admin;

/**
 * The admin area (GDD §16; DESIGN_SYSTEM §8 sedecies): only for an admin signed in with TOTP (anyone else goes home).
 * A side nav with what works now and what comes in the next milestones, and the page on the right.
 */
export function AdminLayout() {
  const me = useMe();
  if (me.isPending) return null;
  if (!me.data || !isAdmin(me.data) || !me.data.mfa) return <Navigate to="/" replace />;
  return (
    <div className="screen-root admin-root">
      <aside className="admin-side">
        <p className="admin-brand">{t.title}</p>
        <nav aria-label={t.nav}>
          <ul>
            <li>
              <NavLink to="/admin/jugadores">{t.sections.players}</NavLink>
            </li>
            <li>
              <NavLink to="/admin/auditoria">{t.sections.audit}</NavLink>
            </li>
            <li>
              <NavLink to="/admin/configuracion">{t.sections.config}</NavLink>
            </li>
            {(['moderation', 'communication', 'stats'] as const).map((k) => (
              <li key={k} className="admin-soon">
                <span>{t.sections[k]}</span>
                <small>{t.soon}</small>
              </li>
            ))}
          </ul>
        </nav>
        <Link to="/" className="lip pill small admin-back">
          <Icon name="back" />
          <span>{t.back}</span>
        </Link>
      </aside>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
