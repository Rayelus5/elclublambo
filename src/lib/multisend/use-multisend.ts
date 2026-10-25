"use client";

import { useCallback, useRef, useState } from "react";
import { erc20Abi } from "viem";
import { useCapabilities, useConfig, useSendCalls, type Config } from "wagmi";
import { getBlockNumber, getPublicClient, waitForCallsStatus, waitForTransactionReceipt } from "wagmi/actions";
import { assetsFor } from "@/lib/economy/assets";
import { NETWORKS, type ChainId } from "@/lib/economy/networks";
import { readAssetBalance } from "@/lib/payments/balances";
import { useEnsureChain } from "@/lib/payments/use-ensure-chain";
import { useSendTransfer } from "@/lib/payments/use-send-transfer";
import { dataSuffixFor } from "@/lib/web3/builder-code";
import { sentAtNow } from "@/lib/web3/signing";
import { findTransfer, scanCapFor } from "./find-transfer";
import type { ParsedLine } from "./parse";
import { alignProgress, inheritAttempts, loadProgress, mergeProgress, progressKey, recentAttempts, recentConfirmed, type RowState } from "./progress";
import { Run, type CallsResult, type Deps, type MultisendError, type Receipt } from "./run";
import { walletRunKey, withRunLock } from "./run-lock";
import { readWalletIdle } from "./wallet-idle";

export type { MultisendError } from "./run";
export { RECHECK_TIMEOUT_MS } from "./run";

type Address = `0x${string}`;

export type MultisendMode = "atomic" | "sequential" | "checking";

/**
 * Every run's rows, per progress key, for this page session: the source of truth when storage is unavailable
 * (finding 1), merged with storage so a resume never resets a confirmed or attempted line.
 */
const memory = new Map<string, RowState[]>();
/** For tests. */
export function resetMultisendMemory(): void {
  memory.clear();
}

type Wallet = {
  ensure(chain: ChainId): Promise<boolean>;
  sendTransfer: ReturnType<typeof useSendTransfer>["send"];
  sendCallsAsync: ReturnType<typeof useSendCalls>["sendCallsAsync"];
};

/** The run's dependencies on wagmi, the chain and storage, for `owner` on `chain`. */
function wagmiDeps(config: Config, chain: ChainId, owner: Address, lines: readonly ParsedLine[], key: string, wallet: Wallet, ownsRun: () => boolean): Deps {
  const usdc = NETWORKS[chain].usdc;
  const client = () => getPublicClient(config, { chainId: chain });
  const chainAssets = assetsFor([chain]);
  return {
    waitReceipt: (hash, timeout) => waitForTransactionReceipt(config, { hash, chainId: chain, ...(timeout ? { timeout } : {}) }) as unknown as Promise<Receipt>,
    waitCalls: (id, timeout) => waitForCallsStatus(config, { id, ...(timeout ? { timeout } : {}) }) as unknown as Promise<CallsResult>,
    scan: (row, block) =>
      findTransfer(client() as Parameters<typeof findTransfer>[0], {
        usdc,
        from: owner,
        to: row.to,
        amount: BigInt(row.amount),
        fromBlock: block,
        maxBlocks: scanCapFor(chain),
      }),
    walletIdle: () =>
      readWalletIdle(client() as Parameters<typeof readWalletIdle>[0], owner).then(
        (v) => v === "idle",
        () => false,
      ),
    blockNumber: () => getBlockNumber(config, { chainId: chain }),
    balances: () =>
      Promise.all([
        readAssetBalance(config, chainAssets.find((a) => a.token === "USDC")!, owner),
        readAssetBalance(config, chainAssets.find((a) => a.token === "ETH")!, owner),
      ]).then(
        ([u, e]): [bigint, bigint] => [u, e],
        () => null,
      ),
    ensure: () => wallet.ensure(chain),
    sendOne: (r) => wallet.sendTransfer({ chain, token: "USDC", to: r.to, amount: BigInt(r.amount), account: owner }),
    sendBatch: async (rs) => {
      const suffix = dataSuffixFor(chain);
      const { id } = await wallet.sendCallsAsync({
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
    loadStored: () => alignProgress(loadProgress(owner, chain, key), lines),
    ownsRun,
    readRecord: () => {
      const now = sentAtNow();
      const mine = (e: { from?: string }) => e.from === undefined || e.from.toLowerCase() === owner.toLowerCase();
      return { attempts: recentAttempts(chain, owner, now), confirmed: recentConfirmed(chain, now).filter(mine) };
    },
  };
}

/**
 * Sends USDC to up to 20 recipients from `owner` on `chain` (P6-R3), signing only from `owner` (pinned) after moving
 * the wallet to `chain`, with the Builder Code on Base only (per call in a batch). Atomic in one `wallet_sendCalls`
 * (`forceAtomic`) when the wallet reports `atomic` supported or ready; one transfer at a time otherwise.
 *
 * Never pays a line twice (see Run): a line is signed only while `todo` (approved by the user in the confirmation) or
 * `not_found` after a successful scan and ticked (`released`), and one attempted before only with an idle wallet. One
 * run at a time per wallet and chain, in any tab (withRunLock, NEW-5); the run's starting rows are read inside the
 * lock, merged from storage, this
 * page session's memory, and the attempts of the 24 h record (NEW-4). With storage unavailable, memory is the record
 * (`storageOk` false: the form tells the user).
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
      const runKey = progressKey(owner, chain, key);
      let outcome: MultisendError | null = "failed";
      try {
        const out = await withRunLock(walletRunKey(owner, chain), (ownsRun) => {
          const startedAt = sentAtNow();
          const deps = wagmiDeps(config, chain, owner, lines, key, { ensure, sendTransfer, sendCallsAsync }, ownsRun);
          const fresh = lines.map((l): RowState => ({ id: l.id, to: l.to, amount: l.amount.toString(), status: "todo" }));
          const known = mergeProgress(deps.loadStored(), alignProgress(memory.get(runKey) ?? null, lines)) ?? fresh;
          const start = inheritAttempts(known, recentAttempts(chain, owner, sentAtNow()));
          memory.set(runKey, start);
          setRun({ key: runKey, rows: start });
          const r = new Run(
            start,
            {
              chain,
              owner,
              key,
              usdc: NETWORKS[chain].usdc,
              startedAt,
              remember: (rows) => void memory.set(runKey, rows),
              onChange: (rows, ok) => (setRun({ key: runKey, rows }), setStorageOk(ok)),
            },
            deps,
          );
          return r.execute(approved, released, mode === "atomic");
        });
        outcome = out.ran ? out.value : "locked";
      } catch {
        outcome = "failed";
      } finally {
        setError(outcome);
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
