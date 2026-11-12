import { SHOP_CURRENCIES, type ShopAmounts } from '@galaxy/shared';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { revokeCosmetic } from '../cosmetics/service';
import { debitUpTo } from '../economy/wallet';
import type { GatewayCharge, GatewayDispute } from './gateway';
import type { ShopDeps } from './service';

// After a purchase (shop and lab plan, F4; owner's decision): a refund or a dispute takes back what is left of what it
// gave, its share for a partial refund and all of it for a dispute, never below 0. Then the account's shop is blocked
// until an admin opens it, the panel gets an alert (with what could not be taken back: spent, or moved on the market)
// and the player a message in the mailbox. Each step is idempotent: a refund is cumulative (Stripe sends the total
// refunded so far), so only the new share is taken, and a purchase row lock keeps two events from racing.

type Db = Kysely<DB>;

const NONE: ShopAmounts = { coins: 0, dust: 0, components: 0 };
const NAMES: Record<keyof ShopAmounts, string> = { coins: 'monedas', dust: 'de polvo', components: 'componentes' };

/** What `granted` × `share` asks back beyond what was asked already (`clawed`), and what the balances let take. */
async function takeBack(trx: Db, account: string, purchase: string, product: string, granted: ShopAmounts, clawed: ShopAmounts, target: ShopAmounts): Promise<{ taken: ShopAmounts; short: ShopAmounts }> {
  const taken = { ...NONE };
  const short = { ...NONE };
  for (const c of SHOP_CURRENCIES) {
    const want = Math.min(target[c], granted[c]) - (clawed[c] ?? 0);
    if (want <= 0) continue;
    taken[c] = await debitUpTo(trx, account, c, want, 'shop_clawback', { purchase, product }, `shop:${purchase}`);
    short[c] = want - taken[c];
  }
  return { taken, short };
}

/** A refunded or disputed cosmetic (Nov plan C5): its piece goes, and comes off if worn. */
async function takePiece(trx: Db, account: string, snapshot: unknown): Promise<void> {
  const piece = (snapshot as { cosmetic?: { kind: 'avatar' | 'frame' | 'title'; id: string } | null } | null)?.cosmetic;
  if (piece) await revokeCosmetic(trx, account, piece.kind, piece.id);
}

async function blockShop(trx: Db, account: string, purchase: string, reason: string): Promise<void> {
  await trx.insertInto('galaxy.shop_blocks').values({ account_id: account, reason, purchase_id: purchase }).onConflict((oc) => oc.column('account_id').doNothing()).execute();
}

/** A personal message in the player's mailbox (its audience is the account alone). */
async function tellPlayer(trx: Db, account: string, title: string, body: string, now: Date): Promise<void> {
  const a = await trx.selectFrom('galaxy.accounts').select('username').where('id', '=', account).executeTakeFirstOrThrow();
  const m = await trx
    .insertInto('galaxy.mailbox_messages')
    .values({
      title,
      body,
      gifts: JSON.stringify({}),
      audience: JSON.stringify({ kind: 'segment', usernames: [a.username.toLowerCase()] }),
      created_by: null,
      created_at: now,
      expires_at: new Date(now.getTime() + 30 * 86_400_000),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await trx.insertInto('galaxy.mailbox_receipts').values({ message_id: m.id, account_id: account }).execute();
}

const amounts = (a: ShopAmounts) =>
  SHOP_CURRENCIES.filter((c) => a[c] > 0)
    .map((c) => `${a[c].toLocaleString('es-ES')} ${NAMES[c]}`)
    .join(', ');

/** The purchase of a payment, locked (null: not the shop's). */
async function lockedByIntent(trx: Db, paymentIntent: string | null) {
  if (!paymentIntent) return null;
  return (
    (await trx
      .selectFrom('galaxy.shop_purchases')
      .select(['id', 'account_id', 'product', 'status', 'amount_cents', 'refunded_cents', 'granted', 'clawed', 'snapshot'])
      .where('stripe_payment_intent', '=', paymentIntent)
      .forUpdate()
      .executeTakeFirst()) ?? null
  );
}

/** A refund, total or partial (`charge.refunded`): returns the purchase it was about. */
export async function applyRefund(deps: ShopDeps, charge: GatewayCharge): Promise<string | null> {
  return inTransaction(deps.db, async (trx) => {
    const r = await lockedByIntent(trx, charge.paymentIntent);
    if (!r) return null;
    const refunded = Math.min(charge.amountRefunded, r.amount_cents);
    if (refunded <= r.refunded_cents) return r.id;
    const now = deps.now();
    const granted = (r.granted as ShopAmounts | null) ?? NONE;
    const clawed = { ...NONE, ...(r.clawed as Partial<ShopAmounts>) };
    const full = refunded >= r.amount_cents;
    const target = { ...NONE };
    for (const c of SHOP_CURRENCIES) target[c] = full ? granted[c] : Math.floor((granted[c] * refunded) / r.amount_cents);
    const { taken, short } = await takeBack(trx, r.account_id, r.id, r.product, granted, clawed, target);
    await takePiece(trx, r.account_id, r.snapshot);
    const status = r.status === 'disputed' ? 'disputed' : full ? 'refunded' : 'partially_refunded';
    const nextClawed = { ...clawed };
    for (const c of SHOP_CURRENCIES) nextClawed[c] = Math.max(clawed[c], Math.min(target[c], granted[c]));
    await trx.updateTable('galaxy.shop_purchases').set({ refunded_cents: refunded, clawed: JSON.stringify(nextClawed), status, updated_at: now }).where('id', '=', r.id).execute();
    await blockShop(trx, r.account_id, r.id, full ? 'Compra devuelta' : 'Compra devuelta en parte');
    await trx
      .insertInto('galaxy.shop_alerts')
      .values({ kind: 'refund', account_id: r.account_id, purchase_id: r.id, details: JSON.stringify({ refundedCents: refunded, amountCents: r.amount_cents, taken, short }) })
      .execute();
    const back = amounts(taken);
    await tellPlayer(
      trx,
      r.account_id,
      'Compra devuelta',
      `Hemos recibido la devolución de una compra de la tienda.${back ? ` Hemos retirado ${back}.` : ''} Tu tienda queda bloqueada hasta que la revisemos.`,
      now,
    );
    deps.log?.info({ purchase: r.id, refunded }, 'shop_refund');
    return r.id;
  });
}

/** A dispute (chargeback): opened takes everything back and blocks; closed only tells the admin how it ended. */
export async function applyDispute(deps: ShopDeps, dispute: GatewayDispute, closed: boolean): Promise<string | null> {
  return inTransaction(deps.db, async (trx) => {
    const r = await lockedByIntent(trx, dispute.paymentIntent);
    if (!r) return null;
    const now = deps.now();
    if (closed) {
      await trx
        .insertInto('galaxy.shop_alerts')
        .values({ kind: 'dispute_closed', account_id: r.account_id, purchase_id: r.id, details: JSON.stringify({ dispute: dispute.id, status: dispute.status }) })
        .execute();
      return r.id;
    }
    if (r.status === 'disputed') return r.id;
    const granted = (r.granted as ShopAmounts | null) ?? NONE;
    const clawed = { ...NONE, ...(r.clawed as Partial<ShopAmounts>) };
    const { taken, short } = await takeBack(trx, r.account_id, r.id, r.product, granted, clawed, granted);
    await takePiece(trx, r.account_id, r.snapshot);
    await trx.updateTable('galaxy.shop_purchases').set({ status: 'disputed', clawed: JSON.stringify(granted), updated_at: now }).where('id', '=', r.id).execute();
    await blockShop(trx, r.account_id, r.id, 'Contracargo');
    await trx
      .insertInto('galaxy.shop_alerts')
      .values({ kind: 'dispute', account_id: r.account_id, purchase_id: r.id, details: JSON.stringify({ dispute: dispute.id, reason: dispute.reason, amountCents: dispute.amount, taken, short }) })
      .execute();
    await tellPlayer(trx, r.account_id, 'Compra en disputa', 'Tu banco ha abierto una reclamación sobre una compra de la tienda. Hemos retirado lo que te dio y tu tienda queda bloqueada hasta que se resuelva.', now);
    deps.log?.info({ purchase: r.id }, 'shop_dispute');
    return r.id;
  });
}
