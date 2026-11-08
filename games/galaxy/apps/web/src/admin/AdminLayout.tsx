import { Link, Navigate, NavLink, Outlet } from 'react-router';
import { isAdmin, isStaff, useMe } from '../auth/useMe';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';

const t = copy.admin;

/**
 * The admin area (GDD §16; DESIGN_SYSTEM §8 sedecies, §8 octodecies): for staff signed in with TOTP (anyone else goes
 * home). Admins see every section; moderators only Moderación (§16.1). A side nav with what works now and what comes
 * in the next milestones, and the page on the right.
 */
export function AdminLayout() {
  const me = useMe();
  if (me.isPending) return null;
  if (!me.data || !isStaff(me.data) || !me.data.mfa) return <Navigate to="/" replace />;
  const admin = isAdmin(me.data);
  return (
    <div className="screen-root admin-root">
      <aside className="admin-side">
        <p className="admin-brand">{t.title}</p>
        <nav aria-label={t.nav}>
          <ul>
            {admin ? (
              <>
                <li>
                  <NavLink to="/admin/jugadores">{t.sections.players}</NavLink>
                </li>
                <li>
                  <NavLink to="/admin/auditoria">{t.sections.audit}</NavLink>
                </li>
                <li>
                  <NavLink to="/admin/configuracion">{t.sections.config}</NavLink>
                </li>
                <li>
                  <NavLink to="/admin/comunicacion">{t.sections.communication}</NavLink>
                </li>
              </>
            ) : null}
            <li>
              <NavLink to="/admin/moderacion">{t.sections.moderation}</NavLink>
            </li>
            {admin
              ? (['stats'] as const).map((k) => (
                  <li key={k} className="admin-soon">
                    <span>{t.sections[k]}</span>
                    <small>{t.soon}</small>
                  </li>
                ))
              : null}
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

/** The panel's first page: Jugadores for an admin, Moderación for a moderator. */
export function AdminHome() {
  const me = useMe();
  if (me.isPending) return null;
  return <Navigate to={isAdmin(me.data) ? '/admin/jugadores' : '/admin/moderacion'} replace />;
}

/** The sections only admins reach; a moderator who opens one lands on Moderación. */
export function AdminOnly() {
  const me = useMe();
  if (me.isPending) return null;
  return isAdmin(me.data) ? <Outlet /> : <Navigate to="/admin/moderacion" replace />;
}
