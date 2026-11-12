import type { CollectionPage, CosmeticsView, ProfileCosmeticsRequest } from '@galaxy/shared';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client';
import { useSaveCosmetics } from '../api/cosmetics';
import { collectionPath } from '../api/economy';
import { errorText } from '../auth/useMe';
import { GalaxyCard } from '../cards/GalaxyCard';
import { copy } from '../copy/es';
import { Avatar } from '../hub/Avatar';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { TitleText } from './TitleText';

// «Personalizar» (Nov plan C2, spec §6): an inventory of avatars, frames, titles and banners, one tab each, with a
// live preview of how others will see me. What I lack stays visible, locked, saying how to get it (the shop's lead to
// the shop). Saving sends only what changed; «Tu firma», «Sin marco»… take a piece off.
const t = copy.customize;
type Tab = 'avatar' | 'frame' | 'title' | 'banner';
type Choice = { avatar: string | null; frame: string | null; title: string | null; banner: string | null };

function Piece({
  selected,
  locked,
  onPick,
  label,
  rarity,
  hint,
  shop,
  children,
}: {
  selected: boolean;
  locked: boolean;
  onPick: () => void;
  label: string;
  rarity?: string;
  hint?: string;
  shop?: boolean;
  children: ReactNode;
}) {
  return (
    <li className={`cz-piece${selected ? ' selected' : ''}${locked ? ' locked' : ''}`} data-rarity={rarity}>
      <button type="button" role="radio" aria-checked={selected} disabled={locked} onClick={onPick} className="cz-pick">
        <span className="cz-art">{children}</span>
        <span className="cz-name">{label}</span>
        {rarity ? <span className="cz-rarity">{t.rarity[rarity] ?? rarity}</span> : null}
        {locked ? <Icon name="lock" /> : selected ? <Icon name="check" /> : null}
      </button>
      {locked && hint ? <small className="cz-hint">{hint}</small> : null}
      {locked && shop ? (
        <Link to="/tienda?pestana=estilo" className="cz-shop">
          {t.inShop}
        </Link>
      ) : null}
    </li>
  );
}

export function CustomizeDialog({ username, view, onClose }: { username: string; view: CosmeticsView; onClose: () => void }) {
  const save = useSaveCosmetics();
  const [tab, setTab] = useState<Tab>('avatar');
  const [choice, setChoice] = useState<Choice>(view.equipped);
  const tabsId = useId();
  const set = (k: keyof Choice, v: string | null) => setChoice((c) => ({ ...c, [k]: v }));
  const owned = useMemo(
    () => ({ avatars: new Set(view.owned.avatars), frames: new Set(view.owned.frames), titles: new Set(view.owned.titles) }),
    [view.owned],
  );
  // My galaxies, rarest first (a banner shows off its finish), only once the banner tab is open.
  const galaxies = useQuery({ queryKey: ['collection', 'banner'], queryFn: () => api<CollectionPage>(collectionPath({ sort: 'rarity', limit: 48 })), enabled: tab === 'banner' });
  // Titles: the styled ones in the catalog plus every title I earned.
  const titles = useMemo(() => {
    const listed = view.catalog.titles.map((x) => ({ text: x.text, rarity: x.rarity, hint: x.hint, shop: x.source === 'shop' }));
    const extra = view.owned.titles.filter((x) => !listed.some((l) => l.text === x)).map((x) => ({ text: x, rarity: undefined, hint: undefined, shop: false }));
    return [...extra, ...listed];
  }, [view]);

  function onSave(): void {
    const req: ProfileCosmeticsRequest = {};
    for (const k of ['avatar', 'frame', 'title', 'banner'] as const) if (choice[k] !== view.equipped[k]) req[k] = choice[k];
    if (Object.keys(req).length === 0) return onClose();
    save.mutate(req, { onSuccess: onClose });
  }

  const tabs: Tab[] = ['avatar', 'frame', 'title', 'banner'];
  return (
    <Dialog title={t.title} onClose={onClose} className="customize">
      <div className="cz-preview" aria-label={t.preview} role="group">
        <Avatar name={username} avatar={choice.avatar} frame={choice.frame} size={64} />
        <div>
          <b>{username}</b>
          {choice.title ? <TitleText text={choice.title} catalog={view.catalog} /> : null}
        </div>
      </div>
      <div className="tabs cz-tabs" role="tablist" aria-label={t.title}>
        {tabs.map((k) => (
          <button key={k} type="button" role="tab" id={`${tabsId}-${k}`} aria-selected={tab === k} aria-controls={`${tabsId}-panel`} onClick={() => setTab(k)}>
            {t.tabs[k]}
          </button>
        ))}
      </div>
      <div className="cz-panel" role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${tab}`}>
        <ul className={`cz-grid cz-${tab}`} role="radiogroup" aria-label={t.tabs[tab]}>
          {tab === 'avatar' ? (
            <>
              <Piece selected={choice.avatar === null} locked={false} onPick={() => set('avatar', null)} label={t.signature} hint={t.signatureHint}>
                <Avatar name={username} size={64} />
              </Piece>
              {view.catalog.avatars.map((a) => (
                <Piece
                  key={a.id}
                  selected={choice.avatar === a.id}
                  locked={a.source !== 'default' && !owned.avatars.has(a.id)}
                  onPick={() => set('avatar', a.id)}
                  label={a.name}
                  rarity={a.rarity}
                  hint={a.hint}
                  shop={a.source === 'shop'}
                >
                  <Avatar name={username} avatar={a.id} size={64} />
                </Piece>
              ))}
            </>
          ) : null}
          {tab === 'frame' ? (
            <>
              <Piece selected={choice.frame === null} locked={false} onPick={() => set('frame', null)} label={t.noFrame}>
                <Avatar name={username} avatar={choice.avatar} size={64} />
              </Piece>
              {view.catalog.frames.map((f) => (
                <Piece key={f.id} selected={choice.frame === f.id} locked={!owned.frames.has(f.id)} onPick={() => set('frame', f.id)} label={f.name} rarity={f.rarity} hint={f.hint} shop={f.source === 'shop'}>
                  <Avatar name={username} avatar={choice.avatar} frame={f.id} size={64} />
                </Piece>
              ))}
            </>
          ) : null}
          {tab === 'title' ? (
            <>
              <Piece selected={choice.title === null} locked={false} onPick={() => set('title', null)} label={t.noTitle}>
                <span className="cz-title-none">—</span>
              </Piece>
              {titles.map((x) => (
                <Piece key={x.text} selected={choice.title === x.text} locked={!owned.titles.has(x.text)} onPick={() => set('title', x.text)} label={x.text} rarity={x.rarity} hint={x.hint} shop={x.shop}>
                  <TitleText text={x.text} catalog={view.catalog} />
                </Piece>
              ))}
            </>
          ) : null}
          {tab === 'banner' ? (
            <>
              <Piece selected={choice.banner === null} locked={false} onPick={() => set('banner', null)} label={t.noBanner}>
                <span className="cz-title-none">—</span>
              </Piece>
              {(galaxies.data?.items ?? []).map((g) => (
                <Piece key={g.id} selected={choice.banner === g.id} locked={false} onPick={() => set('banner', g.id)} label={g.name}>
                  <GalaxyCard galaxy={g} size={112} />
                </Piece>
              ))}
            </>
          ) : null}
        </ul>
        {tab === 'banner' ? <p className="cz-note">{galaxies.data && galaxies.data.items.length === 0 ? t.noGalaxies : t.bannerHint}</p> : null}
      </div>
      {save.error ? (
        <p className="summary error" role="alert">
          <Icon name="alert" />
          <span>{errorText(save.error, copy.errors)}</span>
        </p>
      ) : null}
      <div className="cz-actions">
        <button type="button" className="lip pill" onClick={onClose}>
          {t.cancel}
        </button>
        <button type="button" className="lip pill pill-solar" disabled={save.isPending} aria-busy={save.isPending || undefined} onClick={onSave}>
          {t.save}
        </button>
      </div>
    </Dialog>
  );
}
