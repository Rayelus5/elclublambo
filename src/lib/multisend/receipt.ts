import { erc20Abi, parseEventLogs, type Log } from "viem";

type Address = `0x${string}`;

/**
 * Whether these logs hold the USDC `Transfer(from → to, value == amount)` of a line: the only thing that confirms it
 * (fix round 2). A receipt with status success is not enough: a wallet «cancel» or a replacement is a successful tx
 * that moves no USDC. Pure.
 */
export function paysLine(logs: readonly Log[] | undefined, { usdc, from, to, amount }: { usdc: Address; from: Address; to: Address; amount: bigint }): boolean {
  if (!logs?.length) return false;
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  return parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: [...logs], strict: true }).some(
    (l) => same(l.address, usdc) && same(l.args.from, from) && same(l.args.to, to) && l.args.value === amount,
  );
}
