import type { Log } from "viem";
import type { ChainId } from "@/lib/economy/networks";
import { isUserRejection, NOT_FOUND_GIVE_UP_MS, sentAtNow } from "@/lib/web3/signing";
import { mergeProgress, recordAttempt, recordConfirmed, saveProgress, type RowState } from "./progress";
import { paysLine } from "./receipt";

type Address = `0x${string}`;
type Hash = `0x${string}`;

/** Why the last run stopped, or what it left behind (the form words it from the dictionary). */
export type MultisendError =
  | "switch"
  | "cancelled"
  | "failed"
  | "reverted"
  | "pending"
  | "unconfirmed"
  | "scan_failed"
  | "atomic_failed"
  | "insufficient"
  | "no_gas"
  /** R1: a line attempted before (or released) was not signed because the wallet has a pending tx (or unread nonces). */
  | "wallet_pending"
  /** R3: the block at send could not be read: nothing was signed. */
  | "rpc"
  /** R5/NEW-3: another tab is running this list, or took it over (or wrote it) during this run. */
  | "locked";

/** How long a run waits, in total, for the receipts (or batch statuses) of the lines already sent. */
export const RECHECK_TIMEOUT_MS = 30_000;

export class Stop extends Error {
  constructor(readonly code: MultisendError) {
    super(code);
  }
}

export type Receipt = { status: string; transactionHash: Hash; logs: readonly Log[] };
export type CallsResult = { status?: string; receipts?: readonly Receipt[] };

/** What a run needs from the wallet, the chain and the browser (built from wagmi in the hook). */
export type Deps = {
  waitReceipt(hash: Hash, timeout?: number): Promise<Receipt>;
  waitCalls(id: string, timeout?: number): Promise<CallsResult>;
  /** The tx hash of a matching Transfer log, null when none; throws when the scan itself fails or is past the cap. */
  scan(row: RowState, block: bigint): Promise<Hash | null>;
  /** R1: true only when the wallet's pending and latest nonces were read and are equal. */
  walletIdle(): Promise<boolean>;
  blockNumber(): Promise<bigint>;
  /** [USDC, ETH] of the owner on the chain, null when unknown. */
  balances(): Promise<[bigint, bigint] | null>;
  ensure(): Promise<boolean>;
  sendOne(row: RowState): Promise<Hash>;
  sendBatch(rows: readonly RowState[]): Promise<string>;
  /** The stored rows of this list, in its order; null when there are none or no storage. */
  loadStored(): RowState[] | null;
  /** NEW-3: whether this tab still runs the list (always true under a Web Lock). */
  ownsRun(): boolean;
};

export type RunContext = {
  chain: ChainId;
  owner: Address;
  key: string;
  usdc: Address;
  /** Every change, as it is committed (memory, for the page session). */
  remember(rows: RowState[]): void;
  onChange(rows: RowState[], storageOk: boolean): void;
};

/** A line that may only be signed while the wallet is idle (R1): released, or attempted before (NEW-2). */
const gated = (r: RowState) => r.status === "not_found" || r.attempt !== undefined;

/**
 * One run over one list, inside the run lock. Holds the rows and writes every change to memory and storage at once,
 * merged with what storage holds (another tab's newer write of a line is kept, NEW-3). Records every attempt and every
 * confirmation in the 24 h record (NEW-4). Runs the phases in order: plan, verify, scan, hold back, preflight, then per
 * prompt: guard, persist the attempts, sign. Only `todo` lines the user approved, and `not_found` lines the user
 * released, are ever signed; a line attempted before also needs an idle wallet.
 */
export class Run {
  storageOk = true;
  /** R1 kept some lines back in this run. */
  held = false;

  constructor(
    public rows: RowState[],
    private readonly ctx: RunContext,
    private readonly deps: Deps,
  ) {}

  private commit(next: RowState[]) {
    const merged = mergeProgress(next, this.deps.loadStored()) ?? next;
    this.rows = merged;
    this.ctx.remember(merged);
    if (!saveProgress(this.ctx.owner, this.ctx.chain, this.ctx.key, merged)) this.storageOk = false;
    this.ctx.onChange(merged, this.storageOk);
  }

  private row(id: string): RowState {
    return this.rows.find((r) => r.id === id)!;
  }

  /** Changes these lines; each changed copy gets a newer `updated` than its last one, so a merge keeps it. */
  patch(ids: ReadonlySet<string>, change: Partial<RowState> | ((r: RowState) => Partial<RowState>)) {
    const now = sentAtNow();
    this.commit(
      this.rows.map((r) => {
        if (!ids.has(r.id)) return r;
        const next: RowState = { ...r, ...(typeof change === "function" ? change(r) : change), updated: Math.max(now, (r.updated ?? 0) + 1) };
        if (next.status === "confirmed" && r.status !== "confirmed") {
          const { chain, owner } = this.ctx;
          recordConfirmed({ chain, from: owner, to: next.to, amount: next.amount, ...(next.hash ? { hash: next.hash } : {}), attemptAt: next.attempt?.at }, now);
        }
        return next;
      }),
    );
  }

  private pays(r: RowState, logs: readonly Log[] | undefined) {
    return paysLine(logs, { usdc: this.ctx.usdc, from: this.ctx.owner, to: r.to, amount: BigInt(r.amount) });
  }

  /** The whole run. Returns why it stopped, or what it left behind. */
  async execute(approved: ReadonlySet<string>, released: ReadonlySet<string>, atomic: boolean): Promise<MultisendError | null> {
    try {
      const chosen = this.plan(approved, released);
      await this.verify();
      await this.scan();
      const left = await this.holdBack(this.signable(chosen));
      if (left.length > 0) {
        await this.preflight(left);
        // R3: every attempt carries its block at send; without it nothing is signed.
        const block = await this.deps.blockNumber().then(String, () => undefined);
        if (block === undefined) throw new Stop("rpc");
        if (atomic) await this.signAtomic(left, block);
        else await this.signSequential(left, block);
      }
    } catch (err) {
      return err instanceof Stop ? err.code : "failed";
    }
    return this.held ? "wallet_pending" : this.notice();
  }

  /** 1. Plan: decided before any check, so a line that changes state during the checks is never signed in this run. */
  plan(approved: ReadonlySet<string>, released: ReadonlySet<string>): Set<string> {
    return new Set(this.rows.filter((r) => (r.status === "todo" && approved.has(r.id)) || (r.status === "not_found" && released.has(r.id))).map((r) => r.id));
  }

  /**
   * 2. Verify the lines already sent, all at once under one shared timeout (finding 8), one wait per batch id. Only a
   * receipt holding the line's Transfer confirms it; anything else (no Transfer, a non-successful batch, no answer)
   * makes it `unconfirmed`, for the scan.
   */
  async verify(): Promise<void> {
    const sent = this.rows.filter((r) => r.status === "sent");
    const batches = [...new Set(sent.filter((r) => r.callsId).map((r) => r.callsId!))];
    const singles = sent.filter((r) => !r.callsId && r.hash);
    const orphans = sent.filter((r) => !r.callsId && !r.hash);
    if (orphans.length) this.patch(new Set(orphans.map((r) => r.id)), { status: "unconfirmed" });
    const timeout = RECHECK_TIMEOUT_MS;
    await Promise.all([
      ...singles.map(async (r) => {
        const receipt = await this.deps.waitReceipt(r.hash!, timeout).catch(() => null);
        this.settleReceipt(r.id, receipt);
      }),
      ...batches.map(async (id) => {
        const res = await this.deps.waitCalls(id, timeout).catch(() => null);
        this.settleBatch(new Set(this.rows.filter((r) => r.callsId === id && r.status === "sent").map((r) => r.id)), res);
      }),
    ]);
  }

  settleReceipt(id: string, receipt: Receipt | null): boolean {
    const ok = receipt !== null && receipt.status === "success" && this.pays(this.row(id), receipt.logs);
    this.patch(new Set([id]), ok ? { status: "confirmed", hash: receipt.transactionHash } : { status: "unconfirmed" });
    return ok;
  }

  /**
   * Any batch status but success (600 partial, failure, unknown, no answer) leaves every line unconfirmed, keeping the
   * batch's tx hash when the wallet gave one (the line's explorer link).
   */
  settleBatch(ids: ReadonlySet<string>, res: CallsResult | null): boolean {
    const success = res?.status === "success";
    const batchTx = res?.receipts?.[0]?.transactionHash;
    this.patch(ids, (r) => {
      const paid = success ? res.receipts?.find((rc) => rc.status === "success" && this.pays(r, rc.logs)) : undefined;
      if (paid) return { status: "confirmed", hash: paid.transactionHash };
      return { status: "unconfirmed", ...(batchTx ? { hash: batchTx } : {}) };
    });
    return success;
  }

  /**
   * 3. Scan every attempted line not confirmed yet for its own Transfer log (C1). Found → confirmed with that hash
   * (one batch tx confirms each of its lines, NEW-1). The scan failed → `scan_failed` (never signable). Nothing: a
   * rejected `todo` stays `todo`; otherwise `unconfirmed` while the attempt is fresh (the tx may still be pending) and
   * `not_found` (tickable) once it is past the give-up window.
   */
  async scan(): Promise<void> {
    for (const r of this.rows) {
      const needs = r.status === "unconfirmed" || r.status === "not_found" || r.status === "scan_failed" || (r.status === "todo" && r.attempt);
      if (!needs) continue;
      let found: Hash | null;
      try {
        // R3: the scan starts at the block at send; without it, it cannot be scanned at all.
        if (!r.attempt?.block) throw new Error("no block at send");
        found = await this.deps.scan(r, BigInt(r.attempt.block));
      } catch {
        this.patch(new Set([r.id]), { status: "scan_failed" });
        continue;
      }
      if (found) this.patch(new Set([r.id]), { status: "confirmed", hash: found });
      else if (r.status === "todo") continue;
      else {
        const fresh = r.attempt !== undefined && sentAtNow() - r.attempt.at < NOT_FOUND_GIVE_UP_MS;
        this.patch(new Set([r.id]), { status: fresh ? "unconfirmed" : "not_found" });
      }
    }
  }

  /** What is still signable among the planned lines, after the checks. */
  signable(chosen: ReadonlySet<string>): RowState[] {
    return this.rows.filter((r) => chosen.has(r.id) && (r.status === "todo" || r.status === "not_found"));
  }

  /**
   * R1: a released line, or one attempted before (NEW-2), goes only while the wallet has no pending tx: one could
   * still be its transfer, mined late. A failed nonce read holds them back too. Checked once before the preflight and
   * again right before every prompt.
   */
  private async holdBack(rows: readonly RowState[]): Promise<RowState[]> {
    if (!rows.some(gated) || (await this.deps.walletIdle())) return [...rows];
    this.held = true;
    return rows.filter((r) => !gated(r));
  }

  /** 4. Preflight: a balance known to be short signs nothing (finding 12); an unknown one does not block. */
  async preflight(left: readonly RowState[]): Promise<void> {
    const total = left.reduce((sum, r) => sum + BigInt(r.amount), 0n);
    const balances = await this.deps.balances();
    if (balances && balances[0] < total) throw new Stop("insufficient");
    if (balances && balances[1] <= 0n) throw new Stop("no_gas");
    if (!(await this.deps.ensure())) throw new Stop("switch");
  }

  /**
   * 5. Right before a wallet prompt: R1 again for the gated lines; then, with no await before the prompt, stops if
   * this tab no longer runs the list (NEW-3), re-reads storage (the commit merges it) and stops if any of these lines
   * moved since they were planned (another writer). Returns the lines to prompt now.
   */
  private async guard(planned: readonly RowState[]): Promise<RowState[]> {
    const going = await this.holdBack(planned);
    if (!this.deps.ownsRun()) throw new Stop("locked");
    this.commit(this.rows);
    const current = going.map((p) => this.row(p.id));
    if (current.some((r, i) => r.status !== going[i]!.status || r.attempt?.at !== going[i]!.attempt?.at)) throw new Stop("locked");
    return current;
  }

  /**
   * 6. Persist the attempt of these lines before the wallet prompt opens: from here on they are `unconfirmed`, here
   * and in the 24 h record. Keeps the last known hash (the line's link). Returns the lines as they were, to restore on
   * a definitive rejection.
   */
  private persistAttempts(rows: readonly RowState[], block: string): Map<string, RowState> {
    const before = new Map(rows.map((r) => [r.id, r]));
    const at = sentAtNow();
    this.patch(new Set(before.keys()), (r) => {
      // The scan starts at the earliest block of any attempt of the line.
      const earliest = r.attempt?.block && BigInt(r.attempt.block) < BigInt(block) ? r.attempt.block : block;
      return { status: "unconfirmed", attempt: { block: earliest, at }, callsId: undefined };
    });
    for (const id of before.keys()) this.recordAttempt(this.row(id));
    return before;
  }

  private recordAttempt(r: RowState, hash?: Hash) {
    const { chain, owner } = this.ctx;
    recordAttempt({ chain, from: owner, to: r.to, amount: r.amount, ...(r.attempt?.block ? { block: r.attempt.block } : {}), ...(hash ? { hash } : {}) }, r.attempt!.at);
  }

  /**
   * NEW-2: a definitive rejection restores each line's state from before the attempt (a released `not_found` stays
   * `not_found` and needs a new tick). The attempt marker stays, keeping its earliest block and the earlier time when
   * there was one, so a never-attempted line is now `todo` with an attempt: scanned and R1-gated before it is signed.
   */
  private restore(before: ReadonlyMap<string, RowState>) {
    this.patch(new Set(before.keys()), (r) => {
      const prev = before.get(r.id)!;
      return { status: prev.status, hash: prev.hash, callsId: prev.callsId, attempt: { ...r.attempt!, at: prev.attempt?.at ?? r.attempt!.at } };
    });
  }

  /** 7a. Sign the lines in one atomic batch. */
  async signAtomic(left: readonly RowState[], block: string): Promise<void> {
    const going = await this.guard(left);
    if (going.length === 0) return;
    const ids = new Set(going.map((r) => r.id));
    const before = this.persistAttempts(going, block);
    let id: string;
    try {
      id = await this.deps.sendBatch(going);
    } catch (err) {
      if (isUserRejection(err)) {
        this.restore(before);
        throw new Stop("cancelled");
      }
      throw new Stop("atomic_failed");
    }
    this.patch(ids, { status: "sent", callsId: id });
    let res: CallsResult | null;
    try {
      res = await this.deps.waitCalls(id);
    } catch {
      this.settleBatch(ids, null);
      throw new Stop("pending");
    }
    if (!this.settleBatch(ids, res)) throw new Stop("atomic_failed");
  }

  /** 7b. Sign the lines one at a time, each guarded and with its attempt persisted just before its own prompt. */
  async signSequential(left: readonly RowState[], block: string): Promise<void> {
    for (const planned of left) {
      const [r] = await this.guard([planned]);
      if (!r) continue;
      const ids = new Set([r.id]);
      const before = this.persistAttempts([r], block);
      let hash: Hash;
      try {
        hash = await this.deps.sendOne(r);
      } catch (err) {
        if (isUserRejection(err)) {
          this.restore(before);
          throw new Stop("cancelled");
        }
        // The wallet may have broadcast before failing: unconfirmed, scanned before anything else.
        throw new Stop("failed");
      }
      this.patch(ids, { status: "sent", hash });
      this.recordAttempt(this.row(r.id), hash);
      let receipt: Receipt | null;
      try {
        receipt = await this.deps.waitReceipt(hash);
      } catch {
        receipt = null;
      }
      if (receipt === null) {
        this.patch(ids, { status: "unconfirmed" });
        throw new Stop("pending");
      }
      if (!this.settleReceipt(r.id, receipt)) throw new Stop("reverted");
    }
  }

  /** What the run leaves behind when it did not stop on an error (finding 7: derived from the final rows). */
  notice(): MultisendError | null {
    if (this.rows.some((r) => r.status === "scan_failed")) return "scan_failed";
    if (this.rows.some((r) => r.status === "unconfirmed" || r.status === "not_found")) return "unconfirmed";
    if (this.rows.some((r) => r.status === "sent")) return "pending";
    return null;
  }
}
