import type { MeResponse } from '@galaxy/shared';
import { FirstSteps } from './FirstSteps';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api/client';
import { useCollection, useGacha } from '../api/economy';
import { ME_KEY } from '../auth/useMe';
import { GalaxyBackdrop } from '../scene/GalaxyBackdrop';
import { backdropSeeds } from '../scene/backdrop-seeds';
import { Logo, MaintenanceNotice } from '../shell/AuthLayout';
import { SeasonSummary } from '../social/SeasonSummary';
import { MainMenu } from './MainMenu';
import { TopBar } from './TopBar';

const BEST = { sort: 'rarity', limit: 6 } as const;

/**
 * The title screen (GDD §4): the hub every session starts from. Top bar with balances, the main menu on the left,
 * the season on the right (M5a) and the player's own rarest galaxies drifting in the sky between them.
 */
export function TitleScreen({ me }: { me: MeResponse }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const gacha = useGacha();
  const best = useCollection(BEST);
  const seeds = useMemo(() => backdropSeeds(best.data?.items ?? []), [best.data]);
  const logout = useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      qc.clear();
      qc.setQueryData(ME_KEY, null);
      navigate('/entrar', { replace: true });
    },
  });
  const total = best.data ? Object.values(best.data.counts).reduce((n, c) => n + c, 0) : undefined;
  return (
    <div className="screen-root hub-root">
      <GalaxyBackdrop seeds={seeds} />
      <div className="hub">
        <TopBar
          me={me}
          wallet={gacha.data?.wallet}
          freePull={gacha.data?.freePullAvailable ?? false}
          scanner={false}
          onLogout={() => logout.mutate()}
          leaving={logout.isPending}
        />
        <main className="hub-main">
          <MaintenanceNotice />
          <FirstSteps />
          <Logo />
          <MainMenu galaxies={total} />
        </main>
        <SeasonSummary />
      </div>
    </div>
  );
}
