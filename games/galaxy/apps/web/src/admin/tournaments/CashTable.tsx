import type { AdminTournamentCash } from '@galaxy/shared';
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router';
import { useMarkCashPaid } from '../../api/admin-tournaments';
import { Dialog } from '../../ui/Dialog';
import { HScroll } from '../../ui/HScroll';
import { PublishFields } from '../PublishFields';
import { euros, t, when } from './shared';

// Money prizes (plan «temporadas como fichas», part 5, decision 5): the game never pays them nor asks for bank details.
// An admin writes to the winner through the mailbox, pays outside the game and marks it paid here, with a reason and
// the password (audited). The unpaid first; the paid stay behind «Ver los pagados».

/** A change that asks for a reason and the admin's password, in a confirmation dialog. */
export function ConfirmDialog({
  title,
  label,
  busy,
  error,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  label: string;
  busy: boolean;
  error: unknown;
  onConfirm: (reason: string, password: string) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog title={title} role="alertdialog" className="admin-dialog" onClose={onClose}>
      {children}
      <PublishFields busy={busy} disabled={false} error={error} label={label} onPublish={onConfirm} />
    </Dialog>
  );
}

export function CashTable({ cash, showTournament = true, onDone }: { cash: readonly AdminTournamentCash[]; showTournament?: boolean; onDone: (text: string) => void }) {
  const paid = useMarkCashPaid();
  const [asking, setAsking] = useState<AdminTournamentCash | null>(null);
  const [all, setAll] = useState(false);
  const c = t.cash;
  const unpaid = cash.filter((x) => !x.paidAt);
  const done = cash.filter((x) => x.paidAt);
  const rows = all ? [...unpaid, ...done] : unpaid;
  return (
    <>
      {unpaid.length === 0 ? <p className="panel-note">{c.empty}</p> : null}
      {rows.length > 0 ? (
        <HScroll variant="table" className="admin-table-wrap">
          <table className="admin-table atn-cash-table">
            <thead>
              <tr>
                {showTournament ? <th scope="col">{c.cols.tournament}</th> : null}
                <th scope="col">{c.cols.player}</th>
                <th scope="col">{c.cols.place}</th>
                <th scope="col">{c.cols.amount}</th>
                <th scope="col">{c.cols.note}</th>
                <th scope="col">{c.cols.state}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={`${x.tournamentId}:${x.username}`} className={x.paidAt ? 'atn-paid' : undefined}>
                  {showTournament ? (
                    <td>
                      <Link to={`/admin/torneos/${x.tournamentId}`}>{x.title}</Link>
                    </td>
                  ) : null}
                  <td>
                    <span className="atn-cash-player">
                      <Link to={`/admin/jugadores/${encodeURIComponent(x.username)}`}>{x.username}</Link>
                      {/* Arranging the payment goes through the mailbox: a personal message to them, the subject written. */}
                      <Link
                        className="lip pill small"
                        to={`/admin/comunicacion?para=${encodeURIComponent(x.username)}&asunto=${encodeURIComponent(c.subject(x.title))}`}
                        aria-label={c.writeTo(x.username)}
                      >
                        {c.write}
                      </Link>
                    </span>
                  </td>
                  <td>{c.place(x.rank)}</td>
                  <td className="atn-money">{euros(x.amountEur)}</td>
                  <td>{x.note || '—'}</td>
                  <td>
                    {x.paidAt ? (
                      <span className="admin-chip ok">{c.paid(x.paidBy, when(x.paidAt))}</span>
                    ) : (
                      <button type="button" className="lip pill small" aria-haspopup="dialog" aria-label={c.markPaidOf(x.username)} onClick={() => setAsking(x)}>
                        {c.markPaid}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </HScroll>
      ) : null}
      {done.length > 0 && !all ? (
        <button type="button" className="cf-link atn-show-paid" onClick={() => setAll(true)}>
          {c.showPaid(done.length)}
        </button>
      ) : null}
      {asking ? (
        <ConfirmDialog
          title={c.paidTitle(asking.username)}
          label={c.markPaid}
          busy={paid.isPending}
          error={paid.error}
          onClose={() => {
            setAsking(null);
            paid.reset();
          }}
          onConfirm={(reason, password) =>
            paid.mutate(
              { id: asking.tournamentId, username: asking.username, reason, password },
              {
                onSuccess: () => {
                  onDone(t.done.paid(asking.username));
                  setAsking(null);
                },
              },
            )
          }
        >
          <p>{c.paidText(euros(asking.amountEur), asking.title)}</p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
