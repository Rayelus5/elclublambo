"use client";

import { useCallback, useRef, useState } from "react";
import { erc20Abi } from "viem";
import { useCapabilities, useConfig, useSendCalls } from "wagmi";
import { waitForCallsStatus, waitForTransactionReceipt } from "wagmi/actions";
import { assetsFor } from "@/lib/economy/assets";
import { NETWORKS, type ChainId } from "@/lib/economy/networks";
import { readAssetBalance } from "@/lib/payments/balances";
import { useEnsureChain } from "@/lib/payments/use-ensure-chain";
import { useSendTransfer } from "@/lib/payments/use-send-transfer";
import { dataSuffixFor } from "@/lib/web3/builder-code";
import { isSentFresh, isUserRejection, sentAtNow, writeErrorKind } from "@/lib/web3/signing";
import type { ParsedLine } from "./parse";
import { loadProgress, matchesList, progressKey, saveProgress, type RowState } from "./progress";

type Address = `0x${string}`;

export type MultisendMode = "atomic" | "sequential" | "checking";
/** Why the last run stopped (the form words it from the dictionary). */
export type MultisendError =
  | "switch"
  | "cancelled"
  | "failed"
  | "reverted"
  | "pending"
  | "not_found"
  | "atomic_failed"
  | "insufficient"
  | "no_gas";

/** How long a resume waits for the receipt (or batch status) of a line already sent before calling it pending. */
export const RECHECK_TIMEOUT_MS = 30_000;

class Stop extends Error {
  constructor(readonly code: MultisendError) {
    super(code);
  }
}

/**
 * Sends USDC to up to 20 recipients from `owner` on `chain` (P6-R3), signing only from `owner` (pinned) after moving
 * the wallet to `chain`, with the Builder Code on Base only. Atomic in one `wallet_sendCalls` (`forceAtomic`, the
 * suffix in every call) when the wallet reports `atomic` supported or ready for the chain; one transfer at a time in
 * any other case (an error included). Never pays a line twice: every hash (or batch id) is stored the moment the wallet
 * returns it, and a resume re-checks lines already sent before sending the rest. A line the chain does not know after
 * the give-up window turns `failed` with `not_found`, so the user checks it in the explorer before continuing.
 */
export function useMultisend(chain: ChainId): {
  mode: MultisendMode;
  send(rows: ParsedLine[], owner: Address, key: string): Promise<void>;
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
    async (lines: ParsedLine[], owner: Address, key: string) => {
      if (busy.current || lines.length === 0) return;
      busy.current = true;
      setRunning(true);
      setError(null);
      const stored = loadProgress(owner, chain, key);
      let rows: RowState[] = matchesList(stored, lines)
        ? stored
        : lines.map((l) => ({ to: l.to, amount: l.amount.toString(), status: "todo" as const }));
      const runKey = progressKey(owner, chain, key);
      const commit = (next: RowState[]) => {
        rows = next;
        saveProgress(owner, chain, key, next);
        setRun({ key: runKey, rows: next });
      };
      const patch = (pick: (r: RowState, i: number) => boolean, change: Partial<RowState>) =>
        commit(rows.map((r, i) => (pick(r, i) ? { ...r, ...change } : r)));
      setRun({ key: runKey, rows });

      try {
        // 1. Lines already sent: what the chain says now decides; nothing is sent while one is unknown.
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i]!;
          if (r.status !== "sent") continue;
          const fresh = r.sentAt !== undefined && isSentFresh({ hash: r.hash ?? "0x", sentAt: r.sentAt }, sentAtNow());
          try {
            if (r.callsId) {
              const id = r.callsId;
              const res = await waitForCallsStatus(config, { id, timeout: RECHECK_TIMEOUT_MS });
              const hash = res.receipts?.[0]?.transactionHash;
              patch((x) => x.callsId === id && x.status === "sent", {
                status: res.status === "success" ? "confirmed" : "failed",
                ...(hash ? { hash } : {}),
              });
            } else if (r.hash) {
              const receipt = await waitForTransactionReceipt(config, { hash: r.hash, chainId: chain, timeout: RECHECK_TIMEOUT_MS });
              patch((_, j) => j === i, { status: receipt.status === "success" ? "confirmed" : "failed" });
            } else {
              throw new Error("sent without a hash");
            }
          } catch {
            if (fresh) throw new Stop("pending");
            patch((_, j) => j === i, { status: "failed" });
            throw new Stop("not_found");
          }
        }

        const left = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.status === "todo" || r.status === "failed");
        if (left.length === 0) return;
        const total = left.reduce((sum, { i }) => sum + lines[i]!.amount, 0n);

        // 2. The balance against what is left to send, read now (a failed read never blocks: the wallet still protects).
        const [usdcAsset, ethAsset] = [assetsFor([chain]).find((a) => a.token === "USDC")!, assetsFor([chain]).find((a) => a.token === "ETH")!];
        const balances = await Promise.all([readAssetBalance(config, usdcAsset, owner), readAssetBalance(config, ethAsset, owner)]).catch(() => null);
        if (balances && balances[0] < total) throw new Stop("insufficient");
        if (balances && balances[1] <= 0n) throw new Stop("no_gas");

        // 3. The wallet on the right chain first; a refused switch signs nothing.
        if (!(await ensure(chain))) throw new Stop("switch");
        const usdc = NETWORKS[chain].usdc;
        const suffix = dataSuffixFor(chain);

        if (mode === "atomic") {
          let id: string;
          try {
            ({ id } = await sendCallsAsync({
              chainId: chain,
              account: owner,
              forceAtomic: true,
              calls: left.map(({ i }) => ({
                to: usdc,
                abi: erc20Abi,
                functionName: "transfer" as const,
                args: [lines[i]!.to, lines[i]!.amount] as const,
                ...(suffix ? { dataSuffix: suffix } : {}),
              })),
            }));
          } catch (err) {
            throw new Stop(isUserRejection(err) ? "cancelled" : "atomic_failed");
          }
          const batch = new Set(left.map(({ i }) => i));
          patch((_, j) => batch.has(j), { status: "sent", callsId: id, sentAt: sentAtNow() });
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
        for (const { i } of left) {
          let hash: `0x${string}`;
          try {
            hash = await sendTransfer({ chain, token: "USDC", to: lines[i]!.to, amount: lines[i]!.amount, account: owner });
          } catch (err) {
            patch((_, j) => j === i, { status: "failed" });
            const kind = writeErrorKind(err);
            throw new Stop(kind === "switch" ? "switch" : kind === "cancelled" ? "cancelled" : "failed");
          }
          patch((_, j) => j === i, { status: "sent", hash, sentAt: sentAtNow(), callsId: undefined });
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
        setError(err instanceof Stop ? err.code : "failed");
      } finally {
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
