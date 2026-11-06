import type { CSSProperties } from 'react';
import type { MeResponse } from '@galaxy/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { api } from '../api/client';
import { ME_KEY, isAdmin } from '../auth/useMe';
import { copy } from '../copy/es';
import { AuthBackdrop } from '../scene/AuthBackdrop';
import { Logo, MaintenanceNotice } from '../shell/AuthLayout';
import { Icon } from '../ui/Icon';

/** Provisional home until the title screen (later milestones): greeting, admin badge and logout. */
export function Inicio({ me }: { me: MeResponse }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const logout = useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      qc.setQueryData(ME_KEY, null);
      navigate('/entrar', { replace: true });
    },
  });
  return (
    <div className="screen-root">
      <AuthBackdrop />
      <div className="ui">
        <Logo />
        <main className="lip panel auth home enter" style={{ '--d': '.8s' } as CSSProperties}>
          <MaintenanceNotice />
          <div className="hello">
            <h2>{copy.inicio.hello(me.username)}</h2>
            {isAdmin(me) ? <span className="badge-admin">{copy.inicio.adminBadge}</span> : null}
          </div>
          <p className="lead">{copy.inicio.lead}</p>
          <button type="button" className="lip pill" onClick={() => logout.mutate()} disabled={logout.isPending}>
            <Icon name="exit" />
            <span>{copy.inicio.logout}</span>
          </button>
        </main>
      </div>
    </div>
  );
}
