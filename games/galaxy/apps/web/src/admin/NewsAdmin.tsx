import {
  type AdminNewsPost,
  type MediaAsset,
  MEDIA_MAX_BYTES,
  NEWS_GALLERY,
  NEWS_ROUTES,
  NEWS_SECTIONS,
  type NewsImage,
  type NewsKind,
  type NewsLink,
  type NewsPostInput,
  type NewsRoute,
  type NewsSection,
  newsPostInputSchema,
} from '@galaxy/shared';
import { type DragEvent, useId, useRef, useState } from 'react';
import { useAdminMedia, useAdminNews, useDeleteMedia, useNewsAction, useOrderNews, useSaveNews, useUploadMedia } from '../api/news';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { type AutoData, boardCard, useAutoData } from '../news/cards';
import { galleryUrl, imageUrl } from '../news/gallery';
import { NewsCard } from '../news/NewsCard';
import { DateField } from '../ui/DateField';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { Select } from '../ui/Select';
import { formatBytes } from './StorageScreen';

// «Tablón» in the panel (the owner, 2026-11-14: «totalmente personalizable de forma intuitiva desde admin … la
// mayoria de imagenes podrán ser pulsables para que te lleven a alguna parte de la web o a una URL»). Each section of
// the board with its cards in the order the players see them: move them up and down, edit, hide and show again, delete
// the panel's own (the automatic ones, which say what the game has now, are only hidden). «Nueva tarjeta» and «Editar»
// open the same editor: section, title and text, an image (the game's gallery, the uploaded ones, or a new one dropped
// or chosen), where it leads (a screen of the game from a list, or an https page), featured or not, from and until
// when, and a reason; with the card exactly as the players will see it. Below, the uploaded images, what they weigh and
// how many cards use them (an image in use is never deleted). Admins only; every change is audited by the server.

const t = copy.admin.news;
type LinkKind = 'none' | 'route' | 'url';
type Action = 'hide' | 'show' | 'delete';

interface Draft {
  id: string | null;
  kind: NewsKind;
  section: NewsSection;
  title: string;
  body: string;
  image: NewsImage | null;
  linkKind: LinkKind;
  route: NewsRoute;
  url: string;
  label: string;
  featured: boolean;
  /** The date fields' values («2026-11-14T10:30», local), '' for none. */
  startsAt: string;
  endsAt: string;
  reason: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
function toLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const toIso = (v: string) => (v ? new Date(v).toISOString() : null);

const blank = (section: NewsSection): Draft => ({ id: null, kind: 'custom', section, title: '', body: '', image: null, linkKind: 'none', route: NEWS_ROUTES[0], url: '', label: '', featured: false, startsAt: '', endsAt: '', reason: '' });

function draftOf(p: AdminNewsPost): Draft {
  const link = p.link;
  return {
    id: p.id,
    kind: p.kind,
    section: p.section,
    title: p.title,
    body: p.body,
    image: p.image,
    linkKind: link ? link.kind : 'none',
    route: link?.kind === 'route' ? link.to : NEWS_ROUTES[0],
    url: link?.kind === 'url' ? link.href : '',
    label: link?.label ?? '',
    featured: p.featured,
    startsAt: toLocal(p.startsAt),
    endsAt: toLocal(p.endsAt),
    reason: '',
  };
}

function linkOf(d: Draft): NewsLink | null {
  const label = d.label.trim();
  if (d.linkKind === 'route') return { kind: 'route', to: d.route, label };
  if (d.linkKind === 'url') return { kind: 'url', href: d.url.trim(), label };
  return null;
}

function inputOf(d: Draft): NewsPostInput {
  const custom = d.kind === 'custom';
  return { section: d.section, title: custom ? d.title.trim() : '', body: custom ? d.body.trim() : '', image: d.image, link: linkOf(d), featured: d.featured, startsAt: toIso(d.startsAt), endsAt: toIso(d.endsAt) };
}

/** What is still missing or wrong in a draft (null: it can be saved). */
function problem(d: Draft): string | null {
  if (d.kind === 'custom' && !d.title.trim()) return t.need.title;
  if (d.linkKind !== 'none' && !d.label.trim()) return t.need.label;
  if (d.linkKind === 'url' && !/^https:\/\/[^\s/]+\.[^\s]+$/.test(d.url.trim())) return t.need.url;
  if (d.startsAt && d.endsAt && new Date(d.startsAt) >= new Date(d.endsAt)) return t.need.dates;
  if (!newsPostInputSchema.safeParse(inputOf(d)).success) return t.need.fields;
  if (d.reason.trim().length < 3) return t.need.reason;
  return null;
}

/** A card as it shows now (the automatic ones, with what the game has now). */
const shownAs = (p: Pick<AdminNewsPost, 'id' | 'kind' | 'section' | 'featured' | 'title' | 'body' | 'image' | 'link' | 'updatedAt'>, data: AutoData) => boardCard(p, data);

function ImagePicker({ value, onChange, assets }: { value: NewsImage | null; onChange: (v: NewsImage | null) => void; assets: MediaAsset[] }) {
  const ids = useId();
  const file = useRef<HTMLInputElement>(null);
  const upload = useUploadMedia();
  const [wrong, setWrong] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const send = (f: File | undefined) => {
    if (!f) return;
    setWrong(null);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) return setWrong(t.image.wrongType);
    if (f.size > MEDIA_MAX_BYTES) return setWrong(t.image.tooBig(formatBytes(MEDIA_MAX_BYTES)));
    upload.mutate(f, { onSuccess: (r) => onChange({ kind: 'asset', id: r.id }) });
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    send(e.dataTransfer.files[0]);
  };
  const is = (v: NewsImage | null) => (v === null ? value === null : value !== null && JSON.stringify(v) === JSON.stringify(value));
  const option = (key: string, v: NewsImage | null, src: string | null, label: string) => (
    <label key={key} className={`news-pick${is(v) ? ' on' : ''}`}>
      <input type="radio" name={`${ids}-image`} checked={is(v)} onChange={() => onChange(v)} />
      {src ? <img src={src} alt="" loading="lazy" draggable={false} /> : <span className="news-pick-none" aria-hidden="true" />}
      <span>{label}</span>
    </label>
  );
  return (
    <fieldset className="news-picker">
      <legend>{t.fields.image}</legend>
      <div className="news-picks" role="presentation">
        {option('none', null, null, t.image.none)}
        {NEWS_GALLERY.map((k) => option(k, { kind: 'gallery', key: k }, galleryUrl(k), t.gallery[k]))}
        {assets.map((a) => option(a.id, { kind: 'asset', id: a.id }, imageUrl({ kind: 'asset', id: a.id }), a.name))}
      </div>
      <div
        className={`news-drop${over ? ' over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        <Icon name="plus" />
        <p>
          <b>{t.image.drop}</b>
          <span>{t.image.dropHint(formatBytes(MEDIA_MAX_BYTES))}</span>
        </p>
        <button type="button" className="lip pill small" disabled={upload.isPending} aria-busy={upload.isPending || undefined} onClick={() => file.current?.click()}>
          {upload.isPending ? t.image.uploading : t.image.choose}
        </button>
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          aria-label={t.image.choose}
          onChange={(e) => {
            send(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
      {wrong || upload.error ? (
        <p className="field-error" role="alert">
          {wrong ?? errorText(upload.error, copy.errors)}
        </p>
      ) : null}
    </fieldset>
  );
}

function Editor({ draft: initial, assets, data, onClose }: { draft: Draft; assets: MediaAsset[]; data: AutoData; onClose: () => void }) {
  const ids = useId();
  const [d, setD] = useState(initial);
  const save = useSaveNews();
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const custom = d.kind === 'custom';
  const missing = problem(d);
  const card = shownAs({ id: d.id ?? 'preview', kind: d.kind, section: d.section, featured: d.featured, title: d.title.trim() || t.previewTitle, body: d.body.trim(), image: d.image, link: d.linkKind === 'none' ? null : { ...linkOf(d)!, label: d.label.trim() || t.previewCta } as NewsLink, updatedAt: '' }, data);
  const hero = d.section === 'destacado' || d.featured;
  const text = (k: 'title' | 'label' | 'url' | 'reason', max: number, hint?: string) => (
    <div className="field">
      <label htmlFor={`${ids}-${k}`}>{t.fields[k]}</label>
      <div className="control">
        <input id={`${ids}-${k}`} type={k === 'url' ? 'url' : 'text'} inputMode={k === 'url' ? 'url' : undefined} autoComplete="off" maxLength={max} value={d[k]} placeholder={k === 'url' ? 'https://' : undefined} onChange={(e) => set({ [k]: e.target.value })} aria-describedby={hint ? `${ids}-${k}-hint` : undefined} />
      </div>
      {hint ? (
        <p className="hint" id={`${ids}-${k}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
  return (
    <Dialog title={initial.id ? t.editTitle : t.create} onClose={onClose} className="notes-editor news-editor" closeOnVeil={false}>
      <form
        className="notes-editor-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (missing || save.isPending) return;
          save.mutate({ id: d.id, post: inputOf(d), reason: d.reason.trim() }, { onSuccess: onClose });
        }}
      >
        <div className="notes-editor-form">
          {!custom ? (
            <p className="panel-note news-auto-note">
              <Icon name="info" />
              <span>{t.autoNote(t.kinds[d.kind])}</span>
            </p>
          ) : null}
          <div className="notes-editor-row news-editor-row">
            <div className="field">
              <label id={`${ids}-section-label`}>{t.fields.section}</label>
              <div className="control">
                <Select<NewsSection> aria-labelledby={`${ids}-section-label`} block value={d.section} options={NEWS_SECTIONS.map((s) => ({ value: s, label: copy.news.board.sections[s] }))} onChange={(section) => set({ section })} />
              </div>
            </div>
            <label className="admin-check news-featured">
              <input type="checkbox" checked={d.featured || d.section === 'destacado'} disabled={d.section === 'destacado'} onChange={(e) => set({ featured: e.target.checked })} />
              <span>{t.fields.featured}</span>
            </label>
          </div>
          {custom ? (
            <>
              {text('title', 60)}
              <div className="field">
                <label htmlFor={`${ids}-body`}>{t.fields.body}</label>
                <div className="control">
                  <textarea id={`${ids}-body`} className="news-textarea" rows={3} maxLength={400} value={d.body} onChange={(e) => set({ body: e.target.value })} />
                </div>
              </div>
            </>
          ) : null}
          <ImagePicker value={d.image} assets={assets} onChange={(image) => set({ image })} />
          <fieldset className="news-link">
            <legend>{t.fields.link}</legend>
            <div className="news-link-kinds" role="radiogroup" aria-label={t.fields.link}>
              {(['none', 'route', 'url'] as const).map((k) => (
                <label key={k} className={`news-link-kind${d.linkKind === k ? ' on' : ''}`}>
                  <input type="radio" name={`${ids}-link`} checked={d.linkKind === k} onChange={() => set({ linkKind: k })} />
                  <span>{t.linkKinds[k]}</span>
                </label>
              ))}
            </div>
            {d.linkKind === 'route' ? (
              <div className="field">
                <label id={`${ids}-route-label`}>{t.fields.route}</label>
                <div className="control">
                  <Select<NewsRoute> aria-labelledby={`${ids}-route-label`} block value={d.route} options={NEWS_ROUTES.map((r) => ({ value: r, label: t.routes[r] }))} onChange={(route) => set({ route })} />
                </div>
              </div>
            ) : null}
            {d.linkKind === 'url' ? text('url', 300, t.urlHint) : null}
            {d.linkKind !== 'none' ? text('label', 32, t.labelHint) : null}
          </fieldset>
          <div className="notes-editor-row news-dates">
            {(['startsAt', 'endsAt'] as const).map((k) => (
              <div className="field" key={k}>
                <label htmlFor={`${ids}-${k}`}>{t.fields[k]}</label>
                <div className="control">
                  <DateField id={`${ids}-${k}`} time value={d[k]} onChange={(v) => set({ [k]: v })} />
                </div>
              </div>
            ))}
          </div>
          <p className="news-hint">{t.datesHint}</p>
          {text('reason', 200)}
          {save.error ? (
            <p className="field-error" role="alert">
              {errorText(save.error, copy.errors)}
            </p>
          ) : missing && d.reason ? (
            <p className="news-hint news-missing">{missing}</p>
          ) : null}
          <div className="modal-actions">
            <button type="button" className="lip pill" onClick={onClose}>
              {t.cancel}
            </button>
            <button type="submit" className="lip pill pill-solar" disabled={!!missing || save.isPending} aria-busy={save.isPending || undefined}>
              {save.isPending ? t.saving : t.save}
            </button>
          </div>
        </div>
        <section className="notes-editor-preview news-preview" aria-label={t.preview}>
          <h3>{t.preview}</h3>
          {card ? (
            <div className={`news-preview-card ${hero ? 'is-hero' : 'is-tile'}`} inert>
              <NewsCard card={card} variant={hero ? 'hero' : 'tile'} />
            </div>
          ) : (
            <p className="panel-note">{t.previewSilent}</p>
          )}
          <p className="news-hint">{hero ? t.previewHero : t.previewTile(copy.news.board.sections[d.section])}</p>
        </section>
      </form>
    </Dialog>
  );
}

/** Hiding, showing or deleting a card: always with a reason. */
function Confirm({ post, action, title, onClose }: { post: AdminNewsPost; action: Action; title: string; onClose: () => void }) {
  const ids = useId();
  const [reason, setReason] = useState('');
  const act = useNewsAction();
  const ready = reason.trim().length >= 3 && !act.isPending;
  return (
    <Dialog title={t.confirmTitle[action](title)} role="alertdialog" onClose={onClose}>
      <form
        className="news-confirm"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) act.mutate({ id: post.id, action, reason: reason.trim() }, { onSuccess: onClose });
        }}
      >
        <p>{t.confirmBody[action]}</p>
        <div className="field">
          <label htmlFor={`${ids}-reason`}>{t.fields.reason}</label>
          <div className="control">
            <input id={`${ids}-reason`} type="text" autoComplete="off" maxLength={200} value={reason} data-autofocus onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        {act.error ? (
          <p className="field-error" role="alert">
            {errorText(act.error, copy.errors)}
          </p>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="lip pill" onClick={onClose}>
            {t.cancel}
          </button>
          <button type="submit" className="lip pill pill-solar" disabled={!ready} aria-busy={act.isPending || undefined}>
            {t.actions[action]}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function stateOf(p: AdminNewsPost, shown: boolean, at: number): { label: string; tone: 'ok' | 'warn' | 'bad' } {
  if (p.hidden) return { label: t.states.hidden, tone: 'warn' };
  if (!p.live) return p.startsAt && new Date(p.startsAt).getTime() > at ? { label: t.states.scheduled, tone: 'warn' } : { label: t.states.ended, tone: 'bad' };
  if (!shown) return { label: t.states.silent, tone: 'warn' };
  return { label: t.states.live, tone: 'ok' };
}

function destination(p: AdminNewsPost): string | null {
  if (!p.link) return p.kind === 'auto:patch' ? t.routes['/notas-de-version'] : null;
  return p.link.kind === 'route' ? t.routes[p.link.to] : p.link.href.replace(/^https:\/\//, '');
}

function Section({ section, posts, data, at, onEdit, onAsk }: { section: NewsSection; posts: AdminNewsPost[]; data: AutoData; at: number; onEdit: (d: Draft) => void; onAsk: (p: AdminNewsPost, a: Action, title: string) => void }) {
  const order = useOrderNews();
  const headId = useId();
  const move = (i: number, by: -1 | 1) => {
    const list = posts.map((p) => p.id);
    const [id] = list.splice(i, 1);
    list.splice(i + by, 0, id!);
    order.mutate({ section, ids: list });
  };
  return (
    <section className={`lip panel news-admin-section section-${section}`} aria-labelledby={headId}>
      <header className="news-admin-head">
        <h2 id={headId}>{copy.news.board.sections[section]}</h2>
        <span className="admin-chip">{t.count(posts.length)}</span>
        <p className="news-hint">{t.sectionHints[section]}</p>
        <button type="button" className="lip pill small" aria-haspopup="dialog" aria-label={t.createIn(copy.news.board.sections[section])} onClick={() => onEdit(blank(section))}>
          <Icon name="plus" />
          <span>{t.add}</span>
        </button>
      </header>
      {order.error ? (
        <p className="field-error" role="alert">
          {errorText(order.error, copy.errors)}
        </p>
      ) : null}
      {posts.length === 0 ? <p className="panel-note">{t.emptySection}</p> : null}
      <ol className="news-admin-list">
        {posts.map((p, i) => {
          const card = shownAs(p, data);
          const title = card?.title || (p.kind === 'custom' ? p.title : t.kinds[p.kind]);
          const state = stateOf(p, card !== null, at);
          const src = imageUrl(p.image);
          const to = destination(p);
          return (
            <li key={p.id} className={`news-admin-row${p.hidden ? ' is-hidden' : ''}`}>
              <span className="news-admin-move">
                <button type="button" className="lip iconbtn" aria-label={t.up(title)} title={t.up(title)} disabled={i === 0 || order.isPending} onClick={() => move(i, -1)}>
                  <Icon name="up" />
                </button>
                <button type="button" className="lip iconbtn" aria-label={t.down(title)} title={t.down(title)} disabled={i === posts.length - 1 || order.isPending} onClick={() => move(i, 1)}>
                  <Icon name="down" />
                </button>
              </span>
              <span className="news-admin-thumb" aria-hidden="true">
                {src ? <img src={src} alt="" loading="lazy" draggable={false} /> : null}
              </span>
              <div className="news-admin-main">
                <b className="news-admin-title">{title}</b>
                <span className="news-admin-chips">
                  <span className={`admin-chip ${state.tone}`}>{state.label}</span>
                  {p.kind !== 'custom' ? <span className="admin-chip">{t.autoChip(t.kinds[p.kind])}</span> : null}
                  {p.featured && section !== 'destacado' ? <span className="admin-chip">{t.featuredChip}</span> : null}
                  {to ? (
                    <span className="news-admin-to">
                      <Icon name="next" />
                      {to}
                    </span>
                  ) : null}
                </span>
              </div>
              <span className="news-admin-actions">
                <button type="button" className="lip pill small" aria-haspopup="dialog" aria-label={t.editOf(title)} onClick={() => onEdit(draftOf(p))}>
                  {t.edit}
                </button>
                <button type="button" className="lip pill small" aria-haspopup="dialog" aria-label={`${t.actions[p.hidden ? 'show' : 'hide']}: ${title}`} onClick={() => onAsk(p, p.hidden ? 'show' : 'hide', title)}>
                  {t.actions[p.hidden ? 'show' : 'hide']}
                </button>
                {p.kind === 'custom' ? (
                  <button type="button" className="lip pill small" aria-haspopup="dialog" aria-label={`${t.actions.delete}: ${title}`} onClick={() => onAsk(p, 'delete', title)}>
                    {t.actions.delete}
                  </button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Media({ assets, total }: { assets: MediaAsset[]; total: number }) {
  const ids = useId();
  const del = useDeleteMedia();
  const [asking, setAsking] = useState<MediaAsset | null>(null);
  const [reason, setReason] = useState('');
  return (
    <section className="lip panel news-admin-section news-media" aria-labelledby={`${ids}-media`}>
      <header className="news-admin-head">
        <h2 id={`${ids}-media`}>{t.media.title}</h2>
        <span className="admin-chip">{t.media.total(assets.length, formatBytes(total))}</span>
        <p className="news-hint">{t.media.hint}</p>
      </header>
      {assets.length === 0 ? <p className="panel-note">{t.media.empty}</p> : null}
      <ul className="news-media-grid">
        {assets.map((a) => (
          <li key={a.id} className="news-media-item">
            <img src={imageUrl({ kind: 'asset', id: a.id }) ?? ''} alt="" loading="lazy" draggable={false} />
            <b>{a.name}</b>
            <span>{t.media.meta(a.width, a.height, formatBytes(a.bytes))}</span>
            <span>{t.media.uses(a.uses)}</span>
            <button type="button" className="lip pill small" aria-haspopup="dialog" aria-label={`${t.actions.delete}: ${a.name}`} disabled={a.uses > 0} title={a.uses > 0 ? t.media.inUse : undefined} onClick={() => setAsking(a)}>
              {t.actions.delete}
            </button>
          </li>
        ))}
      </ul>
      {asking ? (
        <Dialog title={t.media.deleteTitle(asking.name)} role="alertdialog" onClose={() => setAsking(null)}>
          <form
            className="news-confirm"
            onSubmit={(e) => {
              e.preventDefault();
              if (reason.trim().length < 3 || del.isPending) return;
              del.mutate(
                { id: asking.id, reason: reason.trim() },
                {
                  onSuccess: () => {
                    setAsking(null);
                    setReason('');
                  },
                },
              );
            }}
          >
            <p>{t.media.deleteBody}</p>
            <div className="field">
              <label htmlFor={`${ids}-reason`}>{t.fields.reason}</label>
              <div className="control">
                <input id={`${ids}-reason`} type="text" autoComplete="off" maxLength={200} value={reason} data-autofocus onChange={(e) => setReason(e.target.value)} />
              </div>
            </div>
            {del.error ? (
              <p className="field-error" role="alert">
                {errorText(del.error, copy.errors)}
              </p>
            ) : null}
            <div className="modal-actions">
              <button type="button" className="lip pill" onClick={() => setAsking(null)}>
                {t.cancel}
              </button>
              <button type="submit" className="lip pill pill-solar" disabled={reason.trim().length < 3 || del.isPending}>
                {t.actions.delete}
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </section>
  );
}

export function NewsAdmin() {
  const news = useAdminNews();
  const media = useAdminMedia();
  const data = useAutoData();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [asking, setAsking] = useState<{ post: AdminNewsPost; action: Action; title: string } | null>(null);
  const posts = news.data?.posts ?? [];
  const assets = media.data?.assets ?? [];
  const bySection = (s: NewsSection) => posts.filter((p) => p.section === s).sort((a, b) => a.order - b.order);
  return (
    <section className="admin-page news-admin">
      <h1>{t.title}</h1>
      <p className="panel-note">{t.intro}</p>
      <div className="notes-admin-tools">
        <button type="button" className="lip pill pill-solar" aria-haspopup="dialog" onClick={() => setEditing(blank('comunidad'))}>
          <Icon name="plus" />
          <span>{t.create}</span>
        </button>
      </div>
      {news.isError ? (
        <p className="field-error" role="alert">
          {errorText(news.error, copy.errors)}
        </p>
      ) : null}
      {news.data
        ? NEWS_SECTIONS.map((s) => (
            <Section key={s} section={s} posts={bySection(s)} data={data} at={news.dataUpdatedAt} onEdit={setEditing} onAsk={(post, action, title) => setAsking({ post, action, title })} />
          ))
        : null}
      {media.data ? <Media assets={assets} total={media.data.totalBytes} /> : null}
      {editing ? <Editor draft={editing} assets={assets} data={data} onClose={() => setEditing(null)} /> : null}
      {asking ? <Confirm post={asking.post} action={asking.action} title={asking.title} onClose={() => setAsking(null)} /> : null}
    </section>
  );
}
