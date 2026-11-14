import { type MyTrades, TIERS, type Tier, type TradePostView } from '@galaxy/shared';
import { useId, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useCancelPost, useMyPosts, useTradeBoard } from '../api/trades';
import { errorText } from '../auth/useMe';
import { GalaxyCard } from '../cards/GalaxyCard';
import { copy } from '../copy/es';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { PostComposer } from './PostComposer';
import { Wants } from './PostWants';
import { TradeComposer } from './TradeComposer';
import { TradesPanel } from './TradesPanel';

const t = copy.trades;
const b = t.board;
const day = (iso: string) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' }).format(new Date(iso));
/** One post: who, what it gives (cards and coins), what it is after, its note, until when, and answering it. */
function PostCard({ p, canTrade, onAnswer, onWithdraw }: { p: TradePostView; canTrade: boolean; onAnswer: () => void; onWithdraw: () => void }) {
  const titleId = useId();
  return (
    <article className={`lip panel post-card${p.mine ? ' mine' : ''}`} aria-labelledby={titleId}>
      <header className="trade-card-head">
        <h3 id={titleId}>
          {p.mine ? (
            b.yours
          ) : (
            <Link to={`/perfil/${encodeURIComponent(p.author)}`}>{p.author}</Link>
          )}
        </h3>
        <span className="panel-note">{b.until(day(p.expiresAt))}</span>
      </header>
      <div className="post-body">
        <section className="post-gives" aria-label={b.gives}>
          <h4>{b.gives}</h4>
          {p.galaxies.length ? (
            <ul className={`trade-cards n${p.galaxies.length}`}>
              {p.galaxies.map((g) => (
                <li key={g.id}>
                  <GalaxyCard galaxy={g} size={p.galaxies.length > 1 ? 104 : 132} />
                </li>
              ))}
            </ul>
          ) : null}
          {p.coins > 0 ? (
            <p className="trade-coins-chip">
              <Icon name="coin" />
              <span>{t.coinsChip(p.coins)}</span>
            </p>
          ) : null}
        </section>
        <section className="post-seeks" aria-label={b.seeks}>
          <h4>{b.seeks}</h4>
          <Wants w={p.wants} />
          {p.note ? <blockquote className="post-note">{p.note}</blockquote> : null}
        </section>
      </div>
      <footer className="post-foot">
        <span className="panel-note">{b.answers(p.answers)}</span>
        {p.mine ? (
          <button type="button" className="lip pill small danger" aria-haspopup="dialog" aria-label={b.withdrawOf(day(p.createdAt))} onClick={onWithdraw}>
            {b.withdraw}
          </button>
        ) : p.myAnswer ? (
          <Link to="/mercado?pestana=trueques" className="lip pill small">
            {b.seeAnswer}
          </Link>
        ) : (
          <button type="button" className="lip pill small pill-solar" aria-haspopup="dialog" aria-label={b.answerOf(p.author)} disabled={!canTrade} onClick={onAnswer}>
            {b.answer}
          </button>
        )}
      </footer>
    </article>
  );
}

/**
 * The public trade board (the owner, 2026-11-14: «un tablón público»): «Publicar», my open posts, then everyone's, the
 * newest first, filtered by the rarity they give, with «Cargar más». Answering opens the trade composer with what the
 * post gives fixed; withdrawing one of mine asks first.
 */
export function TradeBoard({ trades }: { trades: MyTrades }) {
  const r = trades.rules;
  const navigate = useNavigate();
  const [tier, setTier] = useState<Tier | undefined>(undefined);
  const board = useTradeBoard(tier);
  const mine = useMyPosts();
  const cancel = useCancelPost();
  const [posting, setPosting] = useState(false);
  const [answering, setAnswering] = useState<TradePostView | null>(null);
  const [withdrawing, setWithdrawing] = useState<TradePostView | null>(null);
  const rules = mine.data?.rules ?? board.data?.pages[0]?.rules;
  const posts = (board.data?.pages.flatMap((p) => p.posts) ?? []).filter((p) => !p.mine);
  const open = (mine.data?.posts ?? []).filter((p) => p.status === 'open');
  const canPost = !!rules && rules.canPost && rules.openLeft > 0 && rules.todayLeft > 0;
  const noteId = useId();
  return (
    <div className="trade-board">
      <div className="post-bar">
        <div className="market-chips" role="group" aria-label={b.filter}>
          {([undefined, ...TIERS] as const).map((x) => (
            <button key={x ?? 'all'} type="button" className="chip" aria-pressed={tier === x} data-tier={x} onClick={() => setTier(x)}>
              {x ? <i aria-hidden="true" /> : null}
              {x ? copy.tiers[x] : b.all}
            </button>
          ))}
        </div>
        <button type="button" className="lip pill pill-solar" aria-haspopup="dialog" disabled={!canPost} aria-describedby={noteId} onClick={() => setPosting(true)}>
          <Icon name="plus" />
          <span>{b.publish}</span>
        </button>
        <p className="panel-note" id={noteId}>
          {rules ? (canPost ? b.left(rules.openLeft, rules.todayLeft) : b.none) : null}
        </p>
      </div>
      {cancel.error ? (
        <p className="field-error" role="alert">
          {errorText(cancel.error, copy.errors)}
        </p>
      ) : null}
      {open.length ? (
        <section className="post-mine" aria-labelledby={`${noteId}-mine`}>
          <h2 id={`${noteId}-mine`}>{b.mine}</h2>
          <div className="post-list">
            {open.map((p) => (
              <PostCard key={p.id} p={p} canTrade={r.canTrade} onAnswer={() => {}} onWithdraw={() => setWithdrawing(p)} />
            ))}
          </div>
        </section>
      ) : null}
      {board.error ? (
        <p className="field-error" role="alert">
          {errorText(board.error, copy.errors)}
        </p>
      ) : !board.data ? (
        <p className="planetarium-wait" role="status" aria-label={copy.loading}>
          ⠋⠙⠹
        </p>
      ) : posts.length === 0 ? (
        <div className="lip panel lb-empty">
          <p>{tier ? b.emptyTier : b.empty}</p>
        </div>
      ) : (
        <div className="post-list">
          {posts.map((p) => (
            <PostCard key={p.id} p={p} canTrade={r.canTrade} onAnswer={() => setAnswering(p)} onWithdraw={() => {}} />
          ))}
        </div>
      )}
      {board.hasNextPage ? (
        <button type="button" className="lip pill market-more" disabled={board.isFetchingNextPage} onClick={() => void board.fetchNextPage()}>
          {copy.collection.loadMore}
        </button>
      ) : null}
      {posting && rules ? <PostComposer rules={rules} max={r.tradeGalaxies} onClose={() => setPosting(false)} /> : null}
      {answering ? (
        <TradeComposer
          username={answering.author}
          post={answering}
          rules={r}
          onDone={() => {
            setAnswering(null);
            navigate('/mercado?pestana=trueques');
          }}
          onClose={() => setAnswering(null)}
        />
      ) : null}
      {withdrawing ? (
        <Dialog role="alertdialog" title={b.withdrawTitle} onClose={() => setWithdrawing(null)} className="confirm">
          <p>{b.withdrawBody}</p>
          <div className="confirm-actions">
            <button type="button" className="lip pill" data-autofocus onClick={() => setWithdrawing(null)}>
              {t.keep}
            </button>
            <button
              type="button"
              className="lip pill danger"
              onClick={() => {
                cancel.mutate(withdrawing.id);
                setWithdrawing(null);
              }}
            >
              {b.withdraw}
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

/** The Trueques tab: «Mis trueques» or «Tablón», each with its own address (`vista=tablon`) so going back keeps it. */
export function TradesTab({ trades, gateId }: { trades: MyTrades; gateId: string | undefined }) {
  const [params] = useSearchParams();
  const view = params.get('vista') === 'tablon' ? 'board' : 'mine';
  return (
    <>
      <nav className="deal-kinds trade-views" aria-label={b.viewsLabel}>
        {(['mine', 'board'] as const).map((v) => (
          <Link key={v} to={v === 'board' ? '/mercado?pestana=trueques&vista=tablon' : '/mercado?pestana=trueques'} className="lip pill small" aria-current={view === v ? 'page' : undefined}>
            {b.views[v]}
          </Link>
        ))}
      </nav>
      {view === 'board' ? <TradeBoard trades={trades} /> : <TradesPanel trades={trades} gateId={gateId} />}
    </>
  );
}
