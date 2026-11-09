import { eventWarnings, type GameEvent } from '@galaxy/shared';
import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { type ConfigKeyRow, useConfigKeys, usePublishBatch } from '../../api/config';
import { errorText } from '../../auth/useMe';
import { copy } from '../../copy/es';
import { Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { PublishFields } from '../PublishFields';
import { type Banner, duration, type Phase, phaseOf, range, rewardText, scannerOf, t, totals, warningText } from './shared';

// Eventos (polish phase 4): the events by when they happen, each with its dates, goals, rewards and scanner, and what
// can be done with it (edit, duplicate, end now, remove). Creating and editing go through the wizard; ending and
// removing publish here, with a reason and the password, the event and its scanner together.

const MAX = 10;
const ORDER: Phase[] = ['live', 'next', 'past'];

type Action = { kind: 'end' | 'remove'; event: GameEvent };

function ActionDialog({ action, events, banners, onClose }: { action: Action; events: ConfigKeyRow; banners: ConfigKeyRow; onClose: () => void }) {
  const publish = usePublishBatch();
  const e = action.event;
  const list = (events.data.list as GameEvent[]) ?? [];
  const all = (banners.data.banners as Banner[]) ?? [];
  const now = new Date();
  now.setSeconds(0, 0);
  const nextList = action.kind === 'remove' ? list.filter((x) => x.id !== e.id) : list.map((x) => (x.id === e.id ? { ...x, endsAt: now.toISOString() } : x));
  const scanner = scannerOf(e, all);
  const nextBanners = !scanner ? all : action.kind === 'remove' ? all.filter((b) => b !== scanner) : all.map((b) => (b === scanner ? { ...b, endsAt: now.toISOString() } : b));
  const title = action.kind === 'remove' ? t.removeTitle(e.name) : t.endTitle(e.name);
  return (
    <Dialog title={title} role="alertdialog" className="admin-dialog" onClose={onClose}>
      <p>{action.kind === 'remove' ? t.removeText : t.endText}</p>
      {scanner ? <p className="panel-note">{t.withScanner}</p> : null}
      <PublishFields
        busy={publish.isPending}
        disabled={false}
        error={publish.error}
        label={action.kind === 'remove' ? t.remove : t.endNow}
        onPublish={(reason, password) =>
          publish.mutate(
            {
              items: [
                { key: 'events', data: { list: nextList }, baseVersion: events.version },
                ...(scanner ? [{ key: 'gacha' as const, data: { banners: nextBanners }, baseVersion: banners.version }] : []),
              ],
              reason,
              password,
            },
            { onSuccess: onClose },
          )
        }
      />
    </Dialog>
  );
}

function EventCard({ e, phase, banners, warnings, onAction, full }: { e: GameEvent; phase: Phase; banners: Banner[]; warnings: string[]; onAction: (a: Action) => void; full: boolean }) {
  const scanner = scannerOf(e, banners);
  const personal = totals(e.goals, 'personal');
  const clan = totals(e.goals, 'clan');
  const hasClan = e.goals.some((g) => g.scope === 'clan');
  return (
    <li className={`lip panel ev-card ${phase}`}>
      <header>
        <span className="ev-icon" aria-hidden="true">
          <Icon name="comet" />
        </span>
        <div>
          <h3>{e.name}</h3>
          <p>{e.description}</p>
        </div>
        <span className={`ev-phase ${phase}`}>{t.phases[phase]}</span>
      </header>
      <dl className="ev-facts">
        <div>
          <dt>{t.when}</dt>
          <dd>
            {range(e.startsAt, e.endsAt)} <small>{duration(e.startsAt, e.endsAt)}</small>
          </dd>
        </div>
        <div>
          <dt>{t.goals}</dt>
          <dd>{t.goalCount(e.goals.length, e.goals.filter((g) => g.scope === 'clan').length)}</dd>
        </div>
        <div>
          <dt>{t.perPlayer}</dt>
          <dd>
            {rewardText(personal)}
            {hasClan ? <small>{t.plusClan(rewardText(clan))}</small> : null}
          </dd>
        </div>
        <div>
          <dt>{t.scanner}</dt>
          <dd>{scanner ? `${scanner.name}${scanner.featured ? `: ${copy.traitNames[scanner.featured.trait] ?? scanner.featured.trait} ${copy.traitValues[scanner.featured.trait as keyof typeof copy.traitValues]?.[scanner.featured.value as never] ?? scanner.featured.value}` : ''}` : t.noScanner}</dd>
        </div>
      </dl>
      {warnings.length ? (
        <ul className="ev-warnings">
          {warnings.map((w) => (
            <li key={w}>
              <Icon name="alert" />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="ev-actions">
        <Link to={`/admin/eventos/${e.id}`} className="lip pill small">
          <Icon name="wrench" />
          <span>{t.edit}</span>
        </Link>
        {full ? null : (
          <Link to={`/admin/eventos/nuevo?desde=${e.id}`} className="lip pill small">
            <Icon name="copy" />
            <span>{t.duplicate}</span>
          </Link>
        )}
        {phase === 'live' ? (
          <button type="button" className="lip pill small" onClick={() => onAction({ kind: 'end', event: e })}>
            <Icon name="pause" />
            <span>{t.endNow}</span>
          </button>
        ) : null}
        <button type="button" className="lip pill small danger" onClick={() => onAction({ kind: 'remove', event: e })}>
          <Icon name="trash" />
          <span>{t.remove}</span>
        </button>
      </div>
    </li>
  );
}

export function EventsScreen() {
  const keys = useConfigKeys();
  const { state } = useLocation() as { state: { published?: string } | null };
  const [action, setAction] = useState<Action | null>(null);
  const events = keys.data?.find((k) => k.key === 'events');
  const gacha = keys.data?.find((k) => k.key === 'gacha');
  const list = ((events?.data.list as GameEvent[] | undefined) ?? []).slice();
  const banners = (gacha?.data.banners as Banner[] | undefined) ?? [];
  const names = Object.fromEntries(list.map((e) => [e.id, e.name]));
  const warnings = eventWarnings(list, banners);
  const full = list.length >= MAX;
  const orphans = warnings.filter((w) => w.code === 'scanner_without_event').map((w) => warningText(w, names));
  return (
    <section className="admin-page">
      <div className="ev-top">
        <div>
          <h1>{copy.admin.sections.events}</h1>
          <p className="panel-note">{t.lead}</p>
        </div>
        {full ? (
          <span className="panel-note">{t.full(MAX)}</span>
        ) : (
          <Link to="/admin/eventos/nuevo" className="lip pill pill-solar">
            <Icon name="plus" />
            <span>{t.create}</span>
          </Link>
        )}
      </div>
      {state?.published ? (
        <p className="admin-done" role="status">
          {t.published(state.published)}
        </p>
      ) : null}
      {keys.error ? <p className="field-error">{errorText(keys.error, copy.errors)}</p> : null}
      {keys.data ? <p className="panel-note">{t.used(list.length, MAX)}</p> : null}
      {orphans.length ? (
        <ul className="ev-warnings">
          {orphans.map((w) => (
            <li key={w}>
              <Icon name="alert" />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {keys.data && list.length === 0 ? (
        <div className="lip panel ev-empty">
          <Icon name="comet" />
          <p>{t.empty}</p>
        </div>
      ) : null}
      {ORDER.map((phase) => {
        const here = list.filter((e) => phaseOf(e) === phase).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
        if (!here.length) return null;
        return (
          <section key={phase} className="ev-group" aria-label={t.groups[phase]}>
            <h2>{t.groups[phase]}</h2>
            <ul>
              {here.map((e) => (
                <EventCard
                  key={e.id}
                  e={e}
                  phase={phase}
                  banners={banners}
                  full={full}
                  warnings={warnings.filter((w) => 'event' in w && w.event === e.id).map((w) => warningText(w, names))}
                  onAction={setAction}
                />
              ))}
            </ul>
          </section>
        );
      })}
      {action && events && gacha ? <ActionDialog action={action} events={events} banners={gacha} onClose={() => setAction(null)} /> : null}
    </section>
  );
}
