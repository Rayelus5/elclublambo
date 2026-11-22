import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { useAdminPopup } from '../../api/admin-popups';
import { useLiveContent } from '../../api/content';
import { errorText } from '../../auth/useMe';
import { copy } from '../../copy/es';
import { useGiftCatalog } from '../../gifts/useGiftCatalog';
import { Icon } from '../../ui/Icon';
import { type PopupAction, PopupActionDialog } from './PopupActions';
import { PopupPreview } from './PopupPreview';
import { PopupFacts, PopupWizard } from './PopupWizard';
import { canUnpublish, PASOS, t, viewOfRecord } from './shared';

// /admin/encuestas/nueva (?desde=<id> for a copy) and /admin/encuestas/<id> (plan 2026-11-22, part A): a new campaign or
// a draft opens the wizard (at a step with ?paso=, as «Publicar» on the list leads to its review); a scheduled one is
// shown as players will see it, with «Volver a borrador» while nobody saw it and «Terminar ya» (it is changed only
// after taking it back); a live or ended one opens its results.

export function PopupPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const isNew = !id || id === 'nueva';
  const from = isNew ? search.get('desde') : null;
  const one = useAdminPopup(isNew ? null : id);
  const source = useAdminPopup(from);
  const { catalog } = useGiftCatalog();
  const content = useLiveContent();
  const [action, setAction] = useState<PopupAction | null>(null);
  const [now] = useState(() => Date.now());
  const own = isNew ? null : (one.data ?? null);
  const view = useMemo(() => (own ? viewOfRecord(own.record, content, own.id) : null), [own, content]);
  const state = own?.state;
  if (!isNew && (state === 'live' || state === 'ended')) return <Navigate to={`/admin/encuestas/${id}/resultados`} replace />;

  const error = one.error ?? source.error;
  const ready = isNew ? !from || !!source.data || !!source.error : !!own;
  return (
    <section className="admin-page apop-page">
      <Link to="/admin/encuestas" className="lip pill small">
        <Icon name="back" />
        <span>{copy.admin.sections.popups}</span>
      </Link>
      <h1>{isNew ? t.createTitle : state === 'scheduled' ? t.viewTitle : t.editTitle}</h1>
      {error ? <p className="field-error">{(error as { status?: number }).status === 404 ? t.notFound : errorText(error, copy.errors)}</p> : null}
      {ready && own?.state === 'scheduled' && view ? (
        <>
          <p className="panel-note">{t.scheduledNote}</p>
          <div className="ev-actions apop-page-actions">
            {canUnpublish(own, now) ? (
              <button type="button" className="lip pill small" aria-haspopup="dialog" onClick={() => setAction({ kind: 'unpublish', popup: own })}>
                <Icon name="pause" />
                <span>{t.actions.unpublish}</span>
              </button>
            ) : null}
            <button type="button" className="lip pill small danger" aria-haspopup="dialog" onClick={() => setAction({ kind: 'end', popup: own })}>
              <Icon name="close" />
              <span>{t.actions.end}</span>
            </button>
            <Link to={`/admin/encuestas/nueva?desde=${own.id}`} className="lip pill small">
              <Icon name="copy" />
              <span>{t.actions.duplicate}</span>
            </Link>
          </div>
          <div className="apop-review">
            <PopupFacts record={own.record} catalog={catalog} />
            <PopupPreview view={view} />
          </div>
        </>
      ) : ready ? (
        <PopupWizard key={`${id ?? 'nueva'}:${from ?? ''}`} own={own} source={isNew ? (source.data ?? null) : null} initial={PASOS[search.get('paso') ?? ''] ?? 'kind'} />
      ) : null}
      {action ? (
        <PopupActionDialog
          action={action}
          onClose={(text) => {
            setAction(null);
            if (text) navigate('/admin/encuestas', { state: { done: text } });
          }}
        />
      ) : null}
    </section>
  );
}
