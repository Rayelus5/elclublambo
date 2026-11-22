import { type AdminSeason, configJsonSchema, type Gift, type SeasonIssue, type SeasonReward, SEASON_TIERS } from '@galaxy/shared';
import { useId, useState } from 'react';
import { copy } from '../../copy/es';
import { GiftTile } from '../../gifts/GiftArt';
import { GiftPicker } from '../../gifts/GiftPicker';
import { type GiftCatalog, giftWords as words } from '../../gifts/words';
import { Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { pick } from '../events/shared';
import { ConfigForm, NumberInput } from '../forms/ConfigForm';
import { issuesByPath } from '../forms/issues';

// The wizard's editors for what a season pays (plan «temporadas como fichas», PR 4, 2026-11-22; the owner: «muy
// intuitivo para admins poco técnicos»): the route's steps, the shop's items with its currency, the closing prizes by
// tier, podium and range of places, and the season's missions. Every prize is a list of gifts chosen with the mail's
// picker (packs included, copied in); an old reward is shown as the gifts it gives and each of its parts can be taken
// out, so a season copied from before keeps paying exactly what it paid until someone changes it. The seasonal lab
// tree is shown read-only (its editor is out of this PR's scope): it is copied or imported with the rest.

const t = copy.admin.seasons;
type Route = AdminSeason['route'];
type Draft = Pick<AdminSeason, 'id' | 'route' | 'missions' | 'lab'>;
const MAX_GIFTS = 20;

/** The old reward's parts, each a gift to show and a field to clear. */
type LegacyField = 'coins' | 'dust' | 'signal' | 'shards' | 'title' | 'frame' | 'avatar' | 'skin';
function legacyEntries(reward: SeasonReward, seasonId: string): { field: LegacyField; gift: Gift }[] {
  const out: { field: LegacyField; gift: Gift }[] = [];
  for (const c of ['coins', 'dust', 'signal'] as const) if (reward[c] > 0) out.push({ field: c, gift: { kind: 'currency', currency: c, amount: reward[c] } });
  // The season's own currency, drawn with its name whatever the id says yet.
  if (reward.shards > 0) out.push({ field: 'shards', gift: { kind: 'currency', currency: `season:${/^[a-z0-9-]{1,32}$/.test(seasonId) ? seasonId : 'temporada'}`, amount: reward.shards } });
  for (const piece of ['title', 'frame', 'avatar', 'skin'] as const) {
    const id = reward[piece];
    if (id) out.push({ field: piece, gift: { kind: 'cosmetic', piece, id } });
  }
  return out;
}
const cleared = (reward: SeasonReward, field: LegacyField): SeasonReward => ({ ...reward, [field]: field === 'coins' || field === 'dust' || field === 'signal' || field === 'shards' ? 0 : null });

/** The issues of one place and below it. */
export const issuesUnder = (issues: readonly SeasonIssue[], path: string) => issues.filter((i) => i.path === path || i.path.startsWith(`${path}.`));

interface Shared {
  catalog: GiftCatalog | null;
  issues: readonly SeasonIssue[];
  say: (i: SeasonIssue) => string;
}

/**
 * One prize: what it gives as tiles (its old reward's parts first), each with «Quitar», and «Añadir premio», which
 * opens the mail's picker for it. `path` is where its gifts sit in the record (their problems show on their tile).
 */
function PrizeEditor({ label, reward, gifts, onChange, path, catalog, issues, say, seasonId, allowTitle = true }: Shared & { label: string; reward: SeasonReward; gifts: readonly Gift[]; onChange: (reward: SeasonReward, gifts: Gift[]) => void; path: string; seasonId: string; allowTitle?: boolean }) {
  const [open, setOpen] = useState(false);
  const legacy = legacyEntries(reward, seasonId);
  const problem = (k: number) => {
    const i = issues.find((x) => x.path === `${path}.${k}`);
    return i ? say(i) : null;
  };
  const list = (
    <ul className="sw-gifts" aria-label={t.gifts.title(label)}>
      {legacy.map((e) =>
        catalog ? (
          <GiftTile key={e.field} gift={e.gift} catalog={catalog}>
            <RemoveButton label={t.gifts.remove(words(e.gift, catalog))} onClick={() => onChange(cleared(reward, e.field), [...gifts])} />
          </GiftTile>
        ) : null,
      )}
      {gifts.map((g, k) =>
        catalog ? (
          <GiftTile key={`g${k}`} gift={g} catalog={catalog} problem={problem(k)}>
            <RemoveButton label={t.gifts.remove(words(g, catalog))} onClick={() => onChange(reward, gifts.filter((_, j) => j !== k))} />
          </GiftTile>
        ) : null,
      )}
    </ul>
  );
  const empty = legacy.length === 0 && gifts.length === 0;
  return (
    <div className="sw-prize">
      {empty ? <p className="sw-gifts-none">{t.gifts.none}</p> : list}
      <button type="button" className="lip pill small" aria-label={t.gifts.addTo(label)} disabled={!catalog} onClick={() => setOpen(true)}>
        <Icon name="plus" />
        <span>{t.gifts.add}</span>
      </button>
      {open && catalog ? (
        <Dialog title={t.gifts.title(label)} className="sw-gift-dialog" onClose={() => setOpen(false)}>
          {empty ? <p className="sw-gifts-none">{t.gifts.none}</p> : list}
          {allowTitle ? <TitleField key={reward.title ?? ''} value={reward.title} onSet={(title) => onChange({ ...reward, title }, [...gifts])} /> : null}
          <GiftPicker
            catalog={catalog}
            packsChosen={[]}
            itemsFull={gifts.length >= MAX_GIFTS}
            packsFull={false}
            showSeasonPoints={false}
            onAdd={(g) => onChange(reward, gifts.length >= MAX_GIFTS ? [...gifts] : [...gifts, g])}
            // A pack's gifts are copied in: the library can change later without changing the season.
            onAddPack={(id) => {
              const pack = catalog.packs.find((p) => p.id === id);
              if (pack) onChange(reward, [...gifts, ...pack.items].slice(0, MAX_GIFTS));
            }}
          />
          <div className="modal-actions">
            <button type="button" className="lip pill pill-solar" onClick={() => setOpen(false)}>
              {t.gifts.done}
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="lip iconbtn small" aria-label={label} title={label} onClick={onClick}>
      <Icon name="close" />
    </button>
  );
}

/** A free-text title (the season's own, like «Leyenda de la Temporada 3»): one per prize, in its old reward. */
function TitleField({ value, onSet }: { value: string | null; onSet: (title: string | null) => void }) {
  const id = useId();
  const [text, setText] = useState(value ?? '');
  const clean = text.trim();
  return (
    <div className="sw-title-field">
      <label htmlFor={id}>{t.gifts.titleField}</label>
      <div className="sw-title-row">
        <input id={id} type="text" maxLength={30} value={text} aria-describedby={`${id}-hint`} onChange={(e) => setText(e.target.value)} />
        <button type="button" className="lip pill small" disabled={clean.length === 0 || clean === value} onClick={() => onSet(clean)}>
          {t.gifts.titleSet}
        </button>
      </div>
      <small id={`${id}-hint`}>{t.gifts.titleHint}</small>
    </div>
  );
}

/** A row's own problems (not its gifts', which show on their tiles). */
function RowProblems({ issues, path, giftsPath, say }: { issues: readonly SeasonIssue[]; path: string; giftsPath: string; say: (i: SeasonIssue) => string }) {
  const own = issuesUnder(issues, path).filter((i) => !i.path.startsWith(`${giftsPath}.`));
  if (own.length === 0) return null;
  return (
    <ul className="sw-row-problems" role="alert">
      {own.map((i) => (
        <li key={i.path + i.message}>{say(i)}</li>
      ))}
    </ul>
  );
}

const nextAt = (steps: Route['steps']) => {
  const last = steps.at(-1)?.at ?? 0;
  const prev = steps.at(-2)?.at ?? 0;
  return last + Math.max(100, last - prev);
};

/** The route: its steps by points, each with what it pays. Changing a step's points sorts them once it is left. */
export function RouteEditor({ draft, onRoute, catalog, issues, say }: Shared & { draft: Draft; onRoute: (route: Route) => void }) {
  const ids = useId();
  const route = draft.route;
  const setSteps = (steps: Route['steps']) => onRoute({ ...route, steps });
  const sorted = () => {
    if (route.steps.some((s, i) => i > 0 && s.at < route.steps[i - 1]!.at)) setSteps([...route.steps].sort((a, b) => a.at - b.at));
  };
  return (
    <div className="sw-editor">
      {route.steps.length === 0 ? <p className="panel-note">{t.route.empty}</p> : null}
      <ol className="sw-rows" aria-label={t.route.listLabel}>
        {route.steps.map((s, i) => {
          const name = t.route.step(i + 1);
          return (
            <li key={i} className="sw-row sw-step">
              <div className="sw-row-head">
                <span className="sw-row-n" aria-hidden="true">
                  {i + 1}
                </span>
                <div className="cf-field sw-row-field" onBlur={sorted}>
                  <label htmlFor={`${ids}-at-${i}`}>{t.route.at}</label>
                  <NumberInput id={`${ids}-at-${i}`} value={s.at} info={{ label: t.route.at, unit: 'points' }} onChange={(v) => setSteps(route.steps.map((x, j) => (j === i ? { ...x, at: v ?? 0 } : x)))} />
                </div>
                <RemoveButton label={t.route.remove(i + 1)} onClick={() => setSteps(route.steps.filter((_, j) => j !== i))} />
              </div>
              <PrizeEditor
                label={name}
                reward={s.reward}
                gifts={s.gifts}
                path={`route.steps.${i}.gifts`}
                seasonId={draft.id}
                catalog={catalog}
                issues={issues}
                say={say}
                onChange={(reward, gifts) => setSteps(route.steps.map((x, j) => (j === i ? { ...x, reward, gifts } : x)))}
              />
              <RowProblems issues={issues} path={`route.steps.${i}`} giftsPath={`route.steps.${i}.gifts`} say={say} />
            </li>
          );
        })}
      </ol>
      <button type="button" className="lip pill small sw-add" disabled={route.steps.length >= 60} onClick={() => setSteps([...route.steps, { at: nextAt(route.steps), reward: EMPTY, gifts: [] }])}>
        <Icon name="plus" />
        <span>{t.route.add}</span>
      </button>
    </div>
  );
}

const EMPTY: SeasonReward = { coins: 0, dust: 0, signal: 0, shards: 0, title: null, frame: null, avatar: null, skin: null };

/** A new item's id: from its name, or `articulo-<n>`, never one the shop has. */
function freshId(shop: Route['shop']): string {
  const taken = new Set(shop.map((i) => i.id));
  let n = shop.length + 1;
  while (taken.has(`articulo-${n}`)) n++;
  return `articulo-${n}`;
}

/** The shop: its currency (name, how much a point gives, what is left becomes at the close) and its items. */
export function ShopEditor({ draft, onRoute, catalog, issues, say }: Shared & { draft: Draft; onRoute: (route: Route) => void }) {
  const ids = useId();
  const route = draft.route;
  const c = route.currency;
  const setShop = (shop: Route['shop']) => onRoute({ ...route, shop });
  const setItem = (i: number, patch: Partial<Route['shop'][number]>) => setShop(route.shop.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="sw-editor">
      <fieldset className="sw-currency">
        <legend>{t.shop.currencyTitle}</legend>
        <div className="cf-grid">
          <div className="cf-field">
            <label htmlFor={`${ids}-cur`}>{t.shop.currencyName}</label>
            <input id={`${ids}-cur`} type="text" maxLength={24} value={c.name} onChange={(e) => onRoute({ ...route, currency: { ...c, name: e.target.value } })} />
          </div>
          <div className="cf-field">
            <label htmlFor={`${ids}-pp`}>{t.shop.perPoint}</label>
            <NumberInput id={`${ids}-pp`} value={c.perPoint} info={{ label: t.shop.perPoint }} onChange={(v) => onRoute({ ...route, currency: { ...c, perPoint: v ?? 0 } })} />
          </div>
          <div className="cf-field">
            <label htmlFor={`${ids}-dr`}>{t.shop.dustRate}</label>
            <NumberInput id={`${ids}-dr`} value={c.dustRate} info={{ label: t.shop.dustRate }} onChange={(v) => onRoute({ ...route, currency: { ...c, dustRate: v ?? 0 } })} />
          </div>
        </div>
        <RowProblems issues={issues} path="route.currency" giftsPath="route.currency.-" say={say} />
      </fieldset>
      {route.shop.length === 0 ? <p className="panel-note">{t.shop.empty}</p> : null}
      <ul className="sw-rows" aria-label={t.shop.listLabel}>
        {route.shop.map((item, i) => {
          const name = t.shop.item(item.name, i + 1);
          return (
            <li key={i} className="sw-row">
              <div className="sw-row-head sw-item-head">
                <div className="cf-field">
                  <label htmlFor={`${ids}-name-${i}`}>{t.shop.name}</label>
                  <input id={`${ids}-name-${i}`} type="text" maxLength={40} value={item.name} onChange={(e) => setItem(i, { name: e.target.value })} />
                </div>
                <div className="cf-field">
                  <label htmlFor={`${ids}-id-${i}`}>{t.shop.id}</label>
                  <input id={`${ids}-id-${i}`} type="text" maxLength={32} value={item.id} aria-describedby={`${ids}-idh`} onChange={(e) => setItem(i, { id: e.target.value.toLowerCase() })} />
                </div>
                <div className="cf-field">
                  <label htmlFor={`${ids}-price-${i}`}>{t.shop.price}</label>
                  <NumberInput id={`${ids}-price-${i}`} value={item.price} info={{ label: t.shop.price }} onChange={(v) => setItem(i, { price: v ?? 0 })} />
                </div>
                <div className="cf-field">
                  <label htmlFor={`${ids}-limit-${i}`}>{t.shop.limit}</label>
                  <NumberInput id={`${ids}-limit-${i}`} value={item.limit} info={{ label: t.shop.limit }} onChange={(v) => setItem(i, { limit: v ?? 0 })} />
                </div>
                <RemoveButton label={t.shop.remove(name)} onClick={() => setShop(route.shop.filter((_, j) => j !== i))} />
              </div>
              <PrizeEditor label={name} reward={item.reward} gifts={item.gifts} path={`route.shop.${i}.gifts`} seasonId={draft.id} catalog={catalog} issues={issues} say={say} onChange={(reward, gifts) => setItem(i, { reward, gifts })} />
              <RowProblems issues={issues} path={`route.shop.${i}`} giftsPath={`route.shop.${i}.gifts`} say={say} />
            </li>
          );
        })}
      </ul>
      <p id={`${ids}-idh`} className="hint">
        {t.shop.idHint}
      </p>
      <button type="button" className="lip pill small sw-add" disabled={route.shop.length >= 30} onClick={() => setShop([...route.shop, { id: freshId(route.shop), name: '', price: 100, limit: 1, reward: EMPTY, gifts: [] }])}>
        <Icon name="plus" />
        <span>{t.shop.add}</span>
      </button>
    </div>
  );
}

/** The close's prizes: by tier, the podium's (with how many places it reaches) and by ranges of places. */
export function ClosingEditor({ draft, onRoute, catalog, issues, say }: Shared & { draft: Draft; onRoute: (route: Route) => void }) {
  const ids = useId();
  const route = draft.route;
  const c = route.closing;
  const setClosing = (patch: Partial<Route['closing']>) => onRoute({ ...route, closing: { ...c, ...patch } });
  const places = c.places;
  const setPlace = (i: number, patch: Partial<Route['closing']['places'][number]>) => setClosing({ places: places.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  return (
    <div className="sw-editor">
      <section className="sw-block" aria-labelledby={`${ids}-tiers`}>
        <h3 id={`${ids}-tiers`}>{t.closing.tiersTitle}</h3>
        <p className="hint">{t.closing.tiersHint}</p>
        <ol className="sw-rows">
          {[...SEASON_TIERS].reverse().map((tier) => {
            const i = SEASON_TIERS.indexOf(tier);
            const name = t.closing.tier(t.tierNames[i]!);
            return (
              <li key={tier} className="sw-row" data-tier-row={tier}>
                <h4 className="sw-row-title">{name}</h4>
                <PrizeEditor
                  label={name}
                  reward={c.tiers[i]!}
                  gifts={c.tierGifts[i] ?? []}
                  path={`route.closing.tierGifts.${i}`}
                  seasonId={draft.id}
                  catalog={catalog}
                  issues={issues}
                  say={say}
                  onChange={(reward, gifts) => setClosing({ tiers: c.tiers.map((x, j) => (j === i ? reward : x)), tierGifts: c.tierGifts.map((x, j) => (j === i ? gifts : x)) })}
                />
                <RowProblems issues={issues} path={`route.closing.tiers.${i}`} giftsPath="-" say={say} />
                <RowProblems issues={issues} path={`route.closing.tierGifts.${i}`} giftsPath={`route.closing.tierGifts.${i}`} say={say} />
              </li>
            );
          })}
        </ol>
      </section>
      <section className="sw-block" aria-labelledby={`${ids}-podium`}>
        <h3 id={`${ids}-podium`}>{t.closing.podiumTitle}</h3>
        <p className="hint">{t.closing.podiumHint}</p>
        <div className="sw-row">
          <div className="cf-field sw-row-field">
            <label htmlFor={`${ids}-psize`}>{t.closing.podiumSize}</label>
            <NumberInput id={`${ids}-psize`} value={c.podiumSize} info={{ label: t.closing.podiumSize }} onChange={(v) => setClosing({ podiumSize: v ?? 0 })} />
          </div>
          <PrizeEditor label={t.closing.podium} reward={c.podium} gifts={c.podiumGifts} path="route.closing.podiumGifts" seasonId={draft.id} catalog={catalog} issues={issues} say={say} onChange={(podium, podiumGifts) => setClosing({ podium, podiumGifts })} />
          <RowProblems issues={issues} path="route.closing.podiumSize" giftsPath="-" say={say} />
          <RowProblems issues={issues} path="route.closing.podium" giftsPath="-" say={say} />
          <RowProblems issues={issues} path="route.closing.podiumGifts" giftsPath="route.closing.podiumGifts" say={say} />
        </div>
      </section>
      <section className="sw-block" aria-labelledby={`${ids}-places`}>
        <h3 id={`${ids}-places`}>{t.closing.placesTitle}</h3>
        <p className="hint">{t.closing.placesHint}</p>
        {places.length === 0 ? <p className="panel-note">{t.closing.empty}</p> : null}
        <ol className="sw-rows">
          {places.map((p, i) => {
            const name = t.closing.place(p.from, p.to);
            return (
              <li key={i} className="sw-row">
                <div className="sw-row-head">
                  <div className="cf-field sw-row-field">
                    <label htmlFor={`${ids}-from-${i}`}>{t.closing.from}</label>
                    <NumberInput id={`${ids}-from-${i}`} value={p.from} info={{ label: t.closing.from }} onChange={(v) => setPlace(i, { from: v ?? 0 })} />
                  </div>
                  <div className="cf-field sw-row-field">
                    <label htmlFor={`${ids}-to-${i}`}>{t.closing.to}</label>
                    <NumberInput id={`${ids}-to-${i}`} value={p.to} info={{ label: t.closing.to }} onChange={(v) => setPlace(i, { to: v ?? 0 })} />
                  </div>
                  <RemoveButton label={t.closing.remove(name)} onClick={() => setClosing({ places: places.filter((_, j) => j !== i) })} />
                </div>
                <PrizeEditor
                  label={name}
                  reward={EMPTY}
                  gifts={p.gifts}
                  path={`route.closing.places.${i}.gifts`}
                  seasonId={draft.id}
                  catalog={catalog}
                  issues={issues}
                  say={say}
                  allowTitle={false}
                  onChange={(_, gifts) => setPlace(i, { gifts })}
                />
                <RowProblems issues={issues} path={`route.closing.places.${i}`} giftsPath={`route.closing.places.${i}.gifts`} say={say} />
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          className="lip pill small sw-add"
          disabled={places.length >= 20}
          onClick={() => {
            const from = (places.at(-1)?.to ?? 0) + 1;
            setClosing({ places: [...places, { from, to: from, gifts: [] }] });
          }}
        >
          <Icon name="plus" />
          <span>{t.closing.add}</span>
        </button>
      </section>
    </div>
  );
}

/** The season's missions with the panel's own form (the key `missions`' season list). */
export function MissionsEditor({ draft, onMissions, issues }: { draft: Draft; onMissions: (missions: Draft['missions']) => void; issues: readonly SeasonIssue[] }) {
  const [autoIds] = useState(() => new Set<string>());
  const schema = pick(configJsonSchema('missions'), ['season']);
  // The record's `missions.<n>…` are the key's `season.<n>…`.
  const byPath = issuesByPath(issuesUnder(issues, 'missions').map((i) => ({ ...i, path: `season${i.path.slice('missions'.length)}` })));
  return (
    <div className="sw-editor">
      {draft.missions.length === 0 ? <p className="panel-note">{t.missionsEmpty}</p> : null}
      <ConfigForm cfgKey="missions" schema={schema} value={{ season: draft.missions }} onChange={(v) => onMissions(((v as { season?: Draft['missions'] }).season ?? []) as Draft['missions'])} issues={byPath} options={{}} autoIds={autoIds} />
    </div>
  );
}

/** The seasonal lab tree, read-only: what each node gives and up to which level. */
export function LabSummary({ draft }: { draft: Draft }) {
  return (
    <div className="sw-editor">
      <p className="sw-readonly">
        <Icon name="lock" />
        <span>{t.labReadonly}</span>
      </p>
      {draft.lab.length === 0 ? (
        <p className="panel-note">{t.labEmpty}</p>
      ) : (
        <ul className="sw-lab">
          {draft.lab.map((n) => (
            <li key={n.id}>{t.labNode(n.name, n.max)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
