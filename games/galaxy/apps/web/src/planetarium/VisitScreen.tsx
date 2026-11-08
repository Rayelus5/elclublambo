import type { PublicGalaxy } from '@galaxy/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '../api/client';
import { useVisit } from '../api/planetarium';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';
import { Dome, PrestigePanel, ShownCard, VisitForm } from './Dome';
import { BackLink } from '../ui/BackLink';
import { Inspector } from '../inspector/Inspector';

// A visit to someone's planetarium (GDD §10.5, §14.2; DESIGN_SYSTEM §8 decies): the owner's name, their cards on the
// pedestals, each one inspectable in 3D (the owner's request), their prestige and visits. A name without a planetarium
// says so and leads back.

const t = copy.planetarium;

export function VisitScreen() {
  const { username = '' } = useParams();
  const visit = useVisit(username);
  const v = visit.data;
  const [inspecting, setInspecting] = useState<PublicGalaxy | null>(null);
  // A name that cannot exist (400) is as missing as one that does not (404).
  const missing = visit.error instanceof ApiError && (visit.error.status === 404 || visit.error.status === 400);
  return (
    <div className="screen-root planetarium-root">
      <div className="planetarium">
        <header className="collection-bar">
          <BackLink fallback="/planetario">
            <Icon name="back" />
            <span>{t.backToMine}</span>
          </BackLink>
          <h1>{v ? t.of(v.owner) : t.title}</h1>
        </header>
        {missing ? (
          <div className="planetarium-missing">
            <div className="lip panel">
              <p>{copy.errors.planetarium_not_found}</p>
              <p className="prestige-hint">{t.notFoundHint}</p>
            </div>
            <VisitForm />
          </div>
        ) : visit.error ? (
          <p className="field-error" role="alert">
            {errorText(visit.error, copy.errors)}
          </p>
        ) : null}
        {v ? (
          <div className="planetarium-body">
            <Dome
              empty={v.exhibits.every((g) => g === null) ? t.emptyVisit : undefined}
              items={v.exhibits.map((g) =>
                g ? (
                  <ShownCard galaxy={g}>
                    {/* A click on the card opens it in 3D (the owner's request). */}
                    <button type="button" className="gcard-hit" aria-label={copy.inspector.openOf(g.name)} onClick={() => setInspecting(g)} />
                  </ShownCard>
                ) : (
                  <span className="pedestal-vacant" />
                ),
              )}
            />
            <aside className="planetarium-side">
              <PrestigePanel prestige={v.prestige} visits={v.visits} />
              <Link to={`/perfil/${encodeURIComponent(v.owner)}`} className="lip pill">
                <Icon name="probe" />
                <span>{copy.social.seeProfile}</span>
              </Link>
              <VisitForm />
            </aside>
          </div>
        ) : visit.isPending ? (
          <p className="planetarium-wait" role="status" aria-label={copy.loading}>
            ⠋⠙⠹
          </p>
        ) : null}
      </div>
      {inspecting ? <Inspector galaxy={inspecting} onClose={() => setInspecting(null)} /> : null}
    </div>
  );
}
