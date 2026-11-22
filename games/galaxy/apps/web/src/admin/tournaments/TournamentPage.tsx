import { useParams, useSearchParams } from 'react-router';
import { Link } from 'react-router';
import { useAdminTournament, useAdminTournaments } from '../../api/admin-tournaments';
import { useAdminSeasons } from '../../api/seasons';
import { errorText } from '../../auth/useMe';
import { copy } from '../../copy/es';
import { useGiftCatalog } from '../../gifts/useGiftCatalog';
import { Icon } from '../../ui/Icon';
import { ReviewPanel } from './ReviewPanel';
import { seasonFor, type Step, t } from './shared';
import { TournamentSummary, TournamentWizard } from './TournamentWizard';

// /admin/torneos/nuevo (?desde=<id> for a copy) and /admin/torneos/<id> (plan «temporadas como fichas», part 5): a new
// tournament or a draft opens the wizard (at its review with ?paso=revision, where «Programar» on the list leads); a
// scheduled one is shown as players will see it (it is changed only after taking it back); one running, in review,
// finished or cancelled opens its review panel.

const PASOS: Record<string, Step> = { datos: 'data', fechas: 'dates', 'como-se-gana': 'metric', inscripcion: 'entry', premios: 'prizes', revision: 'review' };

export function TournamentPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const isNew = !id || id === 'nuevo';
  const from = isNew ? search.get('desde') : null;
  const one = useAdminTournament(isNew ? null : id);
  const source = useAdminTournament(from);
  const seasons = useAdminSeasons();
  const list = useAdminTournaments();
  const { catalog } = useGiftCatalog();
  const state = one.data?.state;
  if (!isNew && state && state !== 'draft' && state !== 'scheduled') return <ReviewPanel id={id} />;

  const own = isNew ? null : (one.data ?? null);
  const error = one.error ?? seasons.error ?? list.error;
  const ready = !!seasons.data && !!list.data && (isNew ? !from || !!source.data || !!source.error : !!own);
  const taken = new Set((list.data?.tournaments ?? []).filter((x) => x.id !== own?.id).map((x) => x.record.slug));
  return (
    <section className="admin-page atn-page">
      <Link to="/admin/torneos" className="lip pill small">
        <Icon name="back" />
        <span>{copy.admin.sections.tournaments}</span>
      </Link>
      <h1>{isNew ? t.createTitle : state === 'scheduled' ? t.viewTitle : t.editTitle}</h1>
      {error ? <p className="field-error">{(error as { status?: number }).status === 404 ? t.notFound : errorText(error, copy.errors)}</p> : null}
      {ready && own?.state === 'scheduled' ? (
        <>
          <p className="panel-note">{t.scheduledNote}</p>
          <TournamentSummary record={own.record} season={seasonFor(seasons.data!.seasons, own.record.startsAt)} catalog={catalog} entrants={own.entrants} />
        </>
      ) : ready ? (
        <TournamentWizard
          key={`${id ?? 'nuevo'}:${from ?? ''}`}
          seasons={seasons.data!.seasons}
          taken={taken}
          own={own}
          source={isNew ? (source.data ?? null) : null}
          initial={PASOS[search.get('paso') ?? ''] ?? 'data'}
        />
      ) : null}
    </section>
  );
}
