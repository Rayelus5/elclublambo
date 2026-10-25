"use client";

import { useCallback, useRef, useState } from "react";
import { erc20Abi } from "viem";
import { useCapabilities, useConfig, useSendCalls } from "wagmi";
import { getBlockNumber, getPublicClient, waitForCallsStatus, waitForTransactionReceipt } from "wagmi/actions";
import { assetsFor } from "@/lib/economy/assets";
import { NETWORKS, type ChainId } from "@/lib/economy/networks";
import { readAssetBalance } from "@/lib/payments/balances";
import { useEnsureChain } from "@/lib/payments/use-ensure-chain";
import { useSendTransfer } from "@/lib/payments/use-send-transfer";
import { dataSuffixFor } from "@/lib/web3/builder-code";
import { isSentFresh, isUserRejection, sentAtNow, writeErrorKind } from "@/lib/web3/signing";
import { findTransfer } from "./find-transfer";
import type { ParsedLine } from "./parse";
import { alignProgress, loadProgress, progressKey, recordConfirmed, saveProgress, type RowState } from "./progress";

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
  | "atomic_failed"
  | "insufficient"
  | "no_gas";

/** How long a resume waits for the receipt (or batch status) of a line already sent before judging it otherwise. */
export const RECHECK_TIMEOUT_MS = 30_000;

class Stop extends Error {
  constructor(readonly code: MultisendError) {
    super(code);
  }
}

/** The rows a run may sign: approved todo/failed lines, and «sin confirmar» lines the user released (C1). */
export function signable(row: RowState, approved: ReadonlySet<string>, released: ReadonlySet<string>): boolean {
  return ((row.status === "todo" || row.status === "failed") && approved.has(row.id)) || (row.status === "unconfirmed" && released.has(row.id));
}

/**
 * Sends USDC to up to 20 recipients from `owner` on `chain` (P6-R3), signing only from `owner` (pinned) after moving
 * the wallet to `chain`, with the Builder Code on Base only. Atomic in one `wallet_sendCalls` (`forceAtomic`, the
 * suffix in every call) when the wallet reports `atomic` supported or ready for the chain; one transfer at a time in
 * any other case (an error included).
 *
 * Never pays a line twice. Every hash (or batch id) is stored the moment the wallet returns it, with the block read just
 * before signing. A run first re-checks the lines already sent (receipt or batch status) and the «sin confirmar» ones:
 * past the give-up window without an answer, a USDC Transfer log scan decides (C1): found → confirmed with that hash;
 * not found or the scan failed → «sin confirmar», never sent again unless `released`. Only lines in `approved` (todo or
 * failed when the user confirmed) or `released` are signed; a line that changed state during the re-check is not (C2).
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
  /** After an atomic failure (P6-R3): the next run goes one transfer at a time. Never automatic. */
  sendOneByOne(): void;
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
      let rows: RowState[] =
        alignProgress(loadProgress(owner, chain, key), lines) ?? lines.map((l) => ({ id: l.id, to: l.to, amount: l.amount.toString(), status: "todo" as const }));
      const runKey = progressKey(owner, chain, key);
      const commit = (next: RowState[]) => {
        rows = next;
        saveProgress(owner, chain, key, next);
        setRun({ key: runKey, rows: next });
      };
      const patch = (pick: (r: RowState, i: number) => boolean, change: Partial<RowState>) => {
        const now = sentAtNow();
        commit(
          rows.map((r, i) => {
            if (!pick(r, i)) return r;
            const next = { ...r, ...change };
            if (next.status === "confirmed" && r.status !== "confirmed") {
              recordConfirmed({ chain, to: next.to, amount: next.amount, ...(next.hash ? { hash: next.hash } : {}) }, now);
            }
            return next;
          }),
        );
      };
      setRun({ key: runKey, rows });
      let notice: MultisendError | null = null;

      /** C1: a Transfer log of this line from `owner`; null when none, or when the scan failed. */
      const scan = async (r: RowState): Promise<Hash | null> => {
        try {
          const others = new Set(rows.filter((x) => x.id !== r.id && x.hash).map((x) => x.hash!));
          return await findTransfer(getPublicClient(config, { chainId: chain }) as Parameters<typeof findTransfer>[0], {
            usdc,
            from: owner,
            to: r.to,
            amount: BigInt(r.amount),
            fromBlock: r.fromBlock ? BigInt(r.fromBlock) : undefined,
            exclude: others,
          });
        } catch {
          return null;
        }
      };
      const settleUnknown = async (i: number) => {
        const found = await scan(rows[i]!);
        if (found) patch((_, j) => j === i, { status: "confirmed", hash: found });
        else {
          patch((_, j) => j === i, { status: "unconfirmed" });
          notice = "unconfirmed";
        }
      };

      // Decided before the re-check: a line whose state changes during it (e.g. a sent one found reverted) is not signed now.
      const chosen = new Set(rows.filter((r) => signable(r, approved, released)).map((r) => r.id));

      try {
        // 1. Lines already sent, or «sin confirmar»: what the chain says now decides. They are never signed in this pass.
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i]!;
          if (r.status === "unconfirmed") {
            await settleUnknown(i);
            continue;
          }
          if (r.status !== "sent") continue;
          try {
            if (r.callsId) {
              const id = r.callsId;
              const res = await waitForCallsStatus(config, { id, timeout: RECHECK_TIMEOUT_MS });
              const hash = res.receipts?.[0]?.transactionHash;
              patch((x) => x.callsId === id && x.status === "sent", { status: res.status === "success" ? "confirmed" : "failed", ...(hash ? { hash } : {}) });
              if (res.status !== "success") notice = "atomic_failed";
            } else if (r.hash) {
              const receipt = await waitForTransactionReceipt(config, { hash: r.hash, chainId: chain, timeout: RECHECK_TIMEOUT_MS });
              patch((_, j) => j === i, { status: receipt.status === "success" ? "confirmed" : "failed" });
              if (receipt.status !== "success") notice = "reverted";
            } else {
              throw new Error("sent without a hash");
            }
          } catch {
            const fresh = r.sentAt !== undefined && isSentFresh({ hash: r.hash ?? "0x", sentAt: r.sentAt }, sentAtNow());
            if (fresh) notice ??= "pending";
            else await settleUnknown(i);
          }
        }

        const left = rows.map((r, i) => ({ r, i })).filter(({ r }) => chosen.has(r.id) && signable(r, approved, released));
        if (left.length === 0) return;
        const total = left.reduce((sum, { r }) => sum + BigInt(r.amount), 0n);

        // 2. The balance against what will be signed, read now (a failed read never blocks: the wallet still protects).
        const chainAssets = assetsFor([chain]);
        const [usdcAsset, ethAsset] = [chainAssets.find((a) => a.token === "USDC")!, chainAssets.find((a) => a.token === "ETH")!];
        const balances = await Promise.all([readAssetBalance(config, usdcAsset, owner), readAssetBalance(config, ethAsset, owner)]).catch(() => null);
        if (balances && balances[0] < total) throw new Stop("insufficient");
        if (balances && balances[1] <= 0n) throw new Stop("no_gas");

        // 3. The wallet on the right chain first; a refused switch signs nothing.
        if (!(await ensure(chain))) throw new Stop("switch");
        const suffix = dataSuffixFor(chain);
        // Where a later log scan starts (C1); unknown → the scan looks at the last window.
        const fromBlock = await getBlockNumber(config, { chainId: chain }).then(String, () => undefined);

        if (mode === "atomic") {
          let id: string;
          try {
            ({ id } = await sendCallsAsync({
              chainId: chain,
              account: owner,
              forceAtomic: true,
              calls: left.map(({ r }) => ({
                to: usdc,
                abi: erc20Abi,
                functionName: "transfer" as const,
                args: [r.to, BigInt(r.amount)] as const,
                ...(suffix ? { dataSuffix: suffix } : {}),
              })),
            }));
          } catch (err) {
            throw new Stop(isUserRejection(err) ? "cancelled" : "atomic_failed");
          }
          const batch = new Set(left.map(({ i }) => i));
          patch((_, j) => batch.has(j), { status: "sent", callsId: id, sentAt: sentAtNow(), hash: undefined, ...(fromBlock ? { fromBlock } : {}) });
          let res: Awaited<ReturnType<typeof waitForCallsStatus>>;
          try {
            res = await waitForCallsStatus(config, { id });
          } catch {
            throw new Stop("pending");
          }
          const hash = res.receipts?.[0]?.transactionHash;
          if (res.status !== "success") {
            patch((_, j) => batch.has(j), { status: "failed" });
            throw new Stop("atomic_failed");
          }
          patch((_, j) => batch.has(j), { status: "confirmed", ...(hash ? { hash } : {}) });
          return;
        }

        // 4. One by one, in order: send, store the hash, wait for the receipt.
        for (const { r, i } of left) {
          let hash: Hash;
          try {
            hash = await sendTransfer({ chain, token: "USDC", to: r.to, amount: BigInt(r.amount), account: owner });
          } catch (err) {
            // Nothing was sent: an unconfirmed line stays unconfirmed, anything else is failed (resendable).
            if (r.status !== "unconfirmed") patch((_, j) => j === i, { status: "failed" });
            const kind = writeErrorKind(err);
            throw new Stop(kind === "switch" ? "switch" : kind === "cancelled" ? "cancelled" : "failed");
          }
          patch((_, j) => j === i, { status: "sent", hash, sentAt: sentAtNow(), callsId: undefined, fromBlock });
          let ok: boolean;
          try {
            ok = (await waitForTransactionReceipt(config, { hash, chainId: chain })).status === "success";
          } catch {
            throw new Stop("pending");
          }
          patch((_, j) => j === i, { status: ok ? "confirmed" : "failed" });
          if (!ok) throw new Stop("reverted");
        }
      } catch (err) {
        notice = err instanceof Stop ? err.code : "failed";
      } finally {
        setError(notice);
        busy.current = false;
        setRunning(false);
      }
    },
    [chain, config, ensure, mode, sendCallsAsync, sendTransfer],
  );

  const sendOneByOne = useCallback(() => {
    setOneByOne(true);
    setError(null);
  }, []);

  return { mode, send, rows: run.rows, runKey: run.key, running, switching, error, sendOneByOne };
}
