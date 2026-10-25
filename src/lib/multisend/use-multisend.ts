"use client";

import { useCallback, useRef, useState } from "react";
import { erc20Abi, type Log } from "viem";
import { useCapabilities, useConfig, useSendCalls } from "wagmi";
import { getBlockNumber, getPublicClient, waitForCallsStatus, waitForTransactionReceipt } from "wagmi/actions";
import { assetsFor } from "@/lib/economy/assets";
import { NETWORKS, type ChainId } from "@/lib/economy/networks";
import { readAssetBalance } from "@/lib/payments/balances";
import { useEnsureChain } from "@/lib/payments/use-ensure-chain";
import { useSendTransfer } from "@/lib/payments/use-send-transfer";
import { dataSuffixFor } from "@/lib/web3/builder-code";
import { isUserRejection, NOT_FOUND_GIVE_UP_MS, sentAtNow } from "@/lib/web3/signing";
import { findTransfer } from "./find-transfer";
import type { ParsedLine } from "./parse";
import { alignProgress, loadProgress, mergeProgress, progressKey, recordConfirmed, saveProgress, type RowState } from "./progress";
import { paysLine } from "./receipt";

type Address = `0x${string}`;
type Hash = `0x${string}`;

export type MultisendMode = "atomic" | "sequential" | "checking";
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
  | "no_gas";

/** How long a run waits, in total, for the receipts (or batch statuses) of the lines already sent. */
export const RECHECK_TIMEOUT_MS = 30_000;

/**
 * Every run's rows, per progress key, for this page session: the source of truth when storage is unavailable
 * (finding 1), merged with storage so a resume never resets a confirmed or attempted line.
 */
const memory = new Map<string, RowState[]>();
/** For tests. */
export function resetMultisendMemory(): void {
  memory.clear();
}

class Stop extends Error {
  constructor(readonly code: MultisendError) {
    super(code);
  }
}

type Receipt = { status: string; transactionHash: Hash; logs: readonly Log[] };
type CallsResult = { status?: string; receipts?: readonly Receipt[] };

/** What a run needs from the wallet and the chain (built from wagmi in the hook). */
type Deps = {
  waitReceipt(hash: Hash, timeout?: number): Promise<Receipt>;
  waitCalls(id: string, timeout?: number): Promise<CallsResult>;
  /** The tx hash of a matching Transfer log, null when none; throws when the scan itself fails. */
  scan(row: RowState, block: bigint | undefined, exclude: ReadonlySet<string>): Promise<Hash | null>;
  blockNumber(): Promise<bigint>;
  /** [USDC, ETH] of the owner on the chain, null when unknown. */
  balances(): Promise<[bigint, bigint] | null>;
  ensure(): Promise<boolean>;
  sendOne(row: RowState): Promise<Hash>;
  sendBatch(rows: readonly RowState[]): Promise<string>;
};

/**
 * One run over one list. Holds the rows and writes every change to memory and storage at once, records each line that
 * becomes confirmed in the 24 h record, and runs the phases in order: plan, verify, scan, (preflight), persist the
 * attempts, sign. Only `todo` lines the user approved, and `not_found` lines the user released, are ever signed.
 */
class Run {
  storageOk = true;
  constructor(
    public rows: RowState[],
    private readonly ctx: { chain: ChainId; owner: Address; key: string; runKey: string; usdc: Address; onChange(rows: RowState[], storageOk: boolean): void },
    private readonly deps: Deps,
  ) {}

  private commit(next: RowState[]) {
    this.rows = next;
    memory.set(this.ctx.runKey, next);
    if (!saveProgress(this.ctx.owner, this.ctx.chain, this.ctx.key, next)) this.storageOk = false;
    this.ctx.onChange(next, this.storageOk);
  }

  patch(ids: ReadonlySet<string>, change: Partial<RowState> | ((r: RowState) => Partial<RowState>)) {
    const now = sentAtNow();
    this.commit(
      this.rows.map((r) => {
        if (!ids.has(r.id)) return r;
        const next = { ...r, ...(typeof change === "function" ? change(r) : change) };
        if (next.status === "confirmed" && r.status !== "confirmed") {
          recordConfirmed({ chain: this.ctx.chain, to: next.to, amount: next.amount, ...(next.hash ? { hash: next.hash } : {}) }, now);
        }
        return next;
      }),
    );
  }

  private pays(r: RowState, logs: readonly Log[] | undefined) {
    return paysLine(logs, { usdc: this.ctx.usdc, from: this.ctx.owner, to: r.to, amount: BigInt(r.amount) });
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
    const r = this.rows.find((x) => x.id === id)!;
    const ok = receipt !== null && receipt.status === "success" && this.pays(r, receipt.logs);
    this.patch(new Set([id]), ok ? { status: "confirmed", hash: receipt.transactionHash } : { status: "unconfirmed" });
    return ok;
  }

  /** Any batch status but success (600 partial, failure, unknown, no answer) leaves every line unconfirmed. */
  settleBatch(ids: ReadonlySet<string>, res: CallsResult | null): boolean {
    const success = res?.status === "success";
    this.patch(ids, (r) => {
      const paid = success ? res.receipts?.find((rc) => rc.status === "success" && this.pays(r, rc.logs)) : undefined;
      return paid ? { status: "confirmed", hash: paid.transactionHash } : { status: "unconfirmed" };
    });
    return success;
  }

  /**
   * 3. Scan every attempted line not confirmed yet for its Transfer log (C1). Found → confirmed with that hash. The scan
   * failed → `scan_failed` (never signable). Nothing: a rejected `todo` stays `todo`; otherwise `unconfirmed` while the
   * attempt is fresh (the tx may still be pending) and `not_found` (tickable) once it is past the give-up window.
   */
  async scan(): Promise<void> {
    for (const r of this.rows) {
      const needs = r.status === "unconfirmed" || r.status === "not_found" || r.status === "scan_failed" || (r.status === "todo" && r.attempt);
      if (!needs) continue;
      const exclude = new Set(this.rows.filter((x) => x.id !== r.id && x.hash).map((x) => x.hash!));
      let found: Hash | null;
      try {
        found = await this.deps.scan(r, r.attempt?.block ? BigInt(r.attempt.block) : undefined, exclude);
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

  /** 4. Preflight: a balance known to be short signs nothing (finding 12); an unknown one does not block. */
  async preflight(left: readonly RowState[]): Promise<void> {
    const total = left.reduce((sum, r) => sum + BigInt(r.amount), 0n);
    const balances = await this.deps.balances();
    if (balances && balances[0] < total) throw new Stop("insufficient");
    if (balances && balances[1] <= 0n) throw new Stop("no_gas");
    if (!(await this.deps.ensure())) throw new Stop("switch");
  }

  /** 5. Persist the attempt of these lines before the wallet prompt opens: from here on they are `unconfirmed`. */
  persistAttempts(ids: ReadonlySet<string>, block: string | undefined): void {
    const at = sentAtNow();
    this.patch(ids, (r) => {
      // The scan starts at the earliest block of any attempt of the line.
      const earliest = r.attempt?.block && block ? (BigInt(r.attempt.block) < BigInt(block) ? r.attempt.block : block) : (r.attempt?.block ?? block);
      return { status: "unconfirmed", attempt: { ...(earliest ? { block: earliest } : {}), at }, hash: undefined, callsId: undefined };
    });
  }

  /** 6a. Sign the lines in one atomic batch. A definitive rejection returns them to `todo` (attempt kept). */
  async signAtomic(left: readonly RowState[], block: string | undefined): Promise<void> {
    const ids = new Set(left.map((r) => r.id));
    this.persistAttempts(ids, block);
    let id: string;
    try {
      id = await this.deps.sendBatch(left);
    } catch (err) {
      if (isUserRejection(err)) {
        this.patch(ids, { status: "todo" });
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

  /** 6b. Sign the lines one at a time, each with its attempt persisted just before its prompt. */
  async signSequential(left: readonly RowState[], block: string | undefined): Promise<void> {
    for (const r of left) {
      const ids = new Set([r.id]);
      this.persistAttempts(ids, block);
      let hash: Hash;
      try {
        hash = await this.deps.sendOne(r);
      } catch (err) {
        if (isUserRejection(err)) {
          this.patch(ids, { status: "todo" });
          throw new Stop("cancelled");
        }
        // The wallet may have broadcast before failing: unconfirmed, scanned before anything else.
        throw new Stop("failed");
      }
      this.patch(ids, { status: "sent", hash });
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

/**
 * Sends USDC to up to 20 recipients from `owner` on `chain` (P6-R3), signing only from `owner` (pinned) after moving
 * the wallet to `chain`, with the Builder Code on Base only (per call in a batch). Atomic in one `wallet_sendCalls`
 * (`forceAtomic`) when the wallet reports `atomic` supported or ready; one transfer at a time otherwise.
 *
 * Never pays a line twice (fix round 2): a line is signed only while `todo` (approved by the user in the confirmation)
 * or `not_found` after a successful scan and ticked (`released`). Every attempt is persisted before the prompt; a line
 * with an attempt and no verified Transfer is `unconfirmed` until a scan settles it. With storage unavailable, this
 * page session's memory is the record (`storageOk` false: the form tells the user).
 */
export function useMultisend(chain: ChainId): {
  mode: MultisendMode;
  send(rows: ParsedLine[], owner: Address, key: string, approved: ReadonlySet<string>, released?: ReadonlySet<string>): Promise<void>;
  rows: RowState[];
  /** The progress key of `rows` (progressKey), null before any run. */
  runKey: string | null;
  running: boolean;
  switching: boolean;
  error: MultisendError | null;
  /** False once storage refused a write: progress lives only in this page session. */
  storageOk: boolean;
  /** How many runs ended (the form clears its ticks on each). */
  runs: number;
  /** After an atomic failure (P6-R3): the next run goes one transfer at a time. Never automatic. */
  sendOneByOne(): void;
  /** Drops this session's in-memory progress of a list (with its storage, for «Nuevo envío con esta lista»). */
  forget(owner: Address, key: string): void;
} {
  const config = useConfig();
  const caps = useCapabilities({ chainId: chain, query: { retry: false } });
  const { sendCallsAsync } = useSendCalls();
  const { ensure, switching } = useEnsureChain();
  const { send: sendTransfer } = useSendTransfer();
  const [oneByOne, setOneByOne] = useState(false);
  const [run, setRun] = useState<{ key: string | null; rows: RowState[] }>({ key: null, rows: [] });
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<MultisendError | null>(null);
  const [storageOk, setStorageOk] = useState(true);
  const [runs, setRuns] = useState(0);
  const busy = useRef(false);

  const status = (caps.data as { atomic?: { status?: string } } | undefined)?.atomic?.status;
  const mode: MultisendMode = oneByOne
    ? "sequential"
    : caps.error
      ? "sequential"
      : status === "supported" || status === "ready"
        ? "atomic"
        : caps.data === undefined && caps.fetchStatus === "fetching"
          ? "checking"
          : "sequential";

  const send = useCallback(
    async (lines: ParsedLine[], owner: Address, key: string, approved: ReadonlySet<string>, released: ReadonlySet<string> = new Set()) => {
      if (busy.current || lines.length === 0) return;
      busy.current = true;
      setRunning(true);
      setError(null);
      const usdc = NETWORKS[chain].usdc;
      const runKey = progressKey(owner, chain, key);
      const fresh = lines.map((l): RowState => ({ id: l.id, to: l.to, amount: l.amount.toString(), status: "todo" }));
      const start = mergeProgress(alignProgress(loadProgress(owner, chain, key), lines), alignProgress(memory.get(runKey) ?? null, lines)) ?? fresh;
      const chainAssets = assetsFor([chain]);
      const deps: Deps = {
        waitReceipt: (hash, timeout) =>
          waitForTransactionReceipt(config, { hash, chainId: chain, ...(timeout ? { timeout } : {}) }) as unknown as Promise<Receipt>,
        waitCalls: (id, timeout) => waitForCallsStatus(config, { id, ...(timeout ? { timeout } : {}) }) as unknown as Promise<CallsResult>,
        scan: (row, block, exclude) =>
          findTransfer(getPublicClient(config, { chainId: chain }) as Parameters<typeof findTransfer>[0], {
            usdc,
            from: owner,
            to: row.to,
            amount: BigInt(row.amount),
            fromBlock: block,
            exclude,
          }),
        blockNumber: () => getBlockNumber(config, { chainId: chain }),
        balances: () =>
          Promise.all([
            readAssetBalance(config, chainAssets.find((a) => a.token === "USDC")!, owner),
            readAssetBalance(config, chainAssets.find((a) => a.token === "ETH")!, owner),
          ]).then(
            ([u, e]): [bigint, bigint] => [u, e],
            () => null,
          ),
        ensure: () => ensure(chain),
        sendOne: (r) => sendTransfer({ chain, token: "USDC", to: r.to, amount: BigInt(r.amount), account: owner }),
        sendBatch: async (rs) => {
          const suffix = dataSuffixFor(chain);
          const { id } = await sendCallsAsync({
            chainId: chain,
            account: owner,
            forceAtomic: true,
            calls: rs.map((r) => ({
              to: usdc,
              abi: erc20Abi,
              functionName: "transfer" as const,
              args: [r.to, BigInt(r.amount)] as const,
              ...(suffix ? { dataSuffix: suffix } : {}),
            })),
          });
          return id;
        },
      };
      const r = new Run(start, { chain, owner, key, runKey, usdc, onChange: (rows, ok) => (setRun({ key: runKey, rows }), setStorageOk(ok)) }, deps);
      memory.set(runKey, start);
      setRun({ key: runKey, rows: start });

      let stop: MultisendError | null = null;
      try {
        const chosen = r.plan(approved, released);
        await r.verify();
        await r.scan();
        const left = r.signable(chosen);
        if (left.length > 0) {
          await r.preflight(left);
          const block = await deps.blockNumber().then(String, () => undefined);
          if (mode === "atomic") await r.signAtomic(left, block);
          else await r.signSequential(left, block);
        }
      } catch (err) {
        stop = err instanceof Stop ? err.code : "failed";
      } finally {
        setError(stop ?? r.notice());
        busy.current = false;
        setRunning(false);
        setRuns((n) => n + 1);
      }
    },
    [chain, config, ensure, mode, sendCallsAsync, sendTransfer],
  );

  const sendOneByOne = useCallback(() => {
    setOneByOne(true);
    setError(null);
  }, []);

  const forget = useCallback((owner: Address, key: string) => void memory.delete(progressKey(owner, chain, key)), [chain]);

  return { mode, send, rows: run.rows, runKey: run.key, running, switching, error, storageOk, runs, sendOneByOne, forget };
}
