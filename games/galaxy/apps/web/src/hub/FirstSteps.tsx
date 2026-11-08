import { ONBOARDING_STEPS, type OnboardingStep, type OnboardingView } from '@galaxy/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';

// The first steps (GDD §12.2; M7c, DESIGN_SYSTEM §8 octovicies): five things a new operator does, each ticking itself,
// each leading where it is done. Skippable (hidden for this browser) and gone once all are done.

const t = copy.firstSteps;
const HIDDEN = 'galaxy.firstSteps.hidden';
const WHERE: Record<OnboardingStep, string> = { probeTest: '/sonda', firstRun: '/incursion', welcomePulls: '/escaner', repairRoom: '/estacion', equipRelic: '/incursion' };

function hiddenNow(): boolean {
  try {
    return localStorage.getItem(HIDDEN) === '1';
  } catch {
    return false;
  }
}

export function FirstSteps() {
  const steps = useQuery({ queryKey: ['onboarding'], queryFn: () => api<OnboardingView>('/onboarding'), staleTime: 30_000 });
  const [hidden, setHidden] = useState(hiddenNow);
  const v = steps.data;
  if (!v || hidden || ONBOARDING_STEPS.every((s) => v[s])) return null;
  const done = ONBOARDING_STEPS.filter((s) => v[s]).length;
  const next = ONBOARDING_STEPS.find((s) => !v[s]);
  return (
    <section className="lip panel first-steps" aria-labelledby="first-steps-title">
      <div className="first-steps-head">
        <h2 id="first-steps-title">{t.title}</h2>
        <span className="first-steps-count">{t.count(done, ONBOARDING_STEPS.length)}</span>
        <button
          type="button"
          className="lip pill small"
          onClick={() => {
            try {
              localStorage.setItem(HIDDEN, '1');
            } catch {
              // Private mode: hidden for this visit only.
            }
            setHidden(true);
          }}
        >
          {t.hide}
        </button>
      </div>
      <ol className="first-steps-list">
        {ONBOARDING_STEPS.map((s) => (
          <li key={s} className={v[s] ? 'done' : s === next ? 'next' : ''}>
            <Icon name={v[s] ? 'check' : 'compass'} />
            {v[s] ? <span>{t.steps[s]}</span> : <Link to={WHERE[s]}>{t.steps[s]}</Link>}
          </li>
        ))}
      </ol>
      <Link to="/guia" className="first-steps-guide">
        {t.guide}
      </Link>
    </section>
  );
}
