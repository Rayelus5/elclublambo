import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../../fixtures/raffle-draw.json";

const fetchDrawBlocks = vi.hoisted(() => vi.fn());
vi.mock("@/lib/treasury/raffle-verify-chain", () => ({ fetchDrawBlocks }));

import { RaffleVerifier } from "@/components/treasury/raffles/raffle-verifier";
import type { RaffleDetail } from "@/lib/treasury/raffles";

type Draw = { name: string; seed: `0x${string}`; blockHash: `0x${string}`; weights: string[]; commit: `0x${string}`; random: string; winnerPosition: number | null };
const draws = fixture.draws as Draw[];
const equal3 = draws.find((d) => d.name === "equal-3")!;
const allZero = draws.find((d) => d.name === "all-zero")!;

const CLOSES = "2026-10-19T12:00:00.000Z";
const BLOCK_TIME = "2026-10-19T12:00:04.000Z";
const PARENT_TIME = "2026-10-19T11:59:58.000Z";
const sec = (iso: string) => BigInt(Date.parse(iso) / 1000);

function detailOf(d: Draw, over: Partial<RaffleDetail> = {}): RaffleDetail {
  const weights = d.weights.map((w) => BigInt(w));
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "T",
    prizeToken: "USDC",
    prizeAmount: 10_000000n,
    mode: "equal",
    closesAt: CLOSES,
    status: d.winnerPosition === null ? "void" : "drawn",
    entries: weights.length,
    iEntered: false,
    myWeight: null,
    totalWeight: weights.reduce((a, w) => a + w, 0n),
    commit: d.commit,
    seedReveal: d.seed,
    drawBlockNumber: 777n,
    winnerLabel: null,
    iWon: false,
    unpaid: false,
    paidLate: false,
    payoutRecorded: false,
    cancelReason: null,
    createdAt: "2026-10-19T10:00:00Z",
    chainId: 59141,
    drawBlockHash: d.blockHash,
    drawBlockTime: BLOCK_TIME,
    drawParentBlockTime: PARENT_TIME,
    drawRandom: BigInt(d.random),
    winnerPosition: d.winnerPosition,
    payoutTxHash: null,
    entryList: weights.map((w, i) => ({ position: i + 1, label: `m${i + 1}`, weight: w, isMe: false })),
    ...over,
  };
}

const chainOk = (d: Draw) => ({
  hash: d.blockHash,
  timestamp: sec(BLOCK_TIME),
  parentTimestamp: sec(PARENT_TIME),
});

beforeEach(() => {
  fetchDrawBlocks.mockReset();
});

async function run(detail: RaffleDetail) {
  render(<RaffleVerifier detail={detail} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Comprobar en este navegador" }));
}

describe("RaffleVerifier", () => {
  it("confirms a real draw and shows r", async () => {
    fetchDrawBlocks.mockResolvedValue(chainOk(equal3));
    await run(detailOf(equal3));
    expect(await screen.findByText("Comprobado: el compromiso coincide y gana la participación #3.")).toBeInTheDocument();
    const r = BigInt(equal3.random) % 3n;
    expect(screen.getByText(`r = ${r}`)).toBeInTheDocument();
    expect(fetchDrawBlocks).toHaveBeenCalledWith(59141, 777n);
  });

  it("checks the block against the chain, each check with its mark and text", async () => {
    fetchDrawBlocks.mockResolvedValue(chainOk(equal3));
    await run(detailOf(equal3));
    const list = await screen.findByRole("list", { name: "Comprobaciones" });
    const items = within(list).getAllByRole("listitem").map((li) => li.textContent);
    expect(items.some((t) => t!.startsWith("✓") && /hash del bloque 777 coincide/.test(t!))).toBe(true);
    expect(items.some((t) => t!.startsWith("✓") && /hora del bloque coincide/.test(t!))).toBe(true);
    expect(items.some((t) => t!.startsWith("✓") && /primer bloque posterior al cierre/.test(t!))).toBe(true);
  });

  it("flags a block hash that differs from the chain's", async () => {
    fetchDrawBlocks.mockResolvedValue({ ...chainOk(equal3), hash: `0x${"11".repeat(32)}` });
    await run(detailOf(equal3));
    const list = await screen.findByRole("list", { name: "Comprobaciones" });
    const bad = within(list).getAllByRole("listitem").find((li) => /hash del bloque 777/.test(li.textContent!))!;
    expect(bad.textContent!.startsWith("✗")).toBe(true);
    expect(await screen.findByRole("alert")).toHaveTextContent("No coincide");
  });

  it("flags a draw block that is not the first after the close", async () => {
    fetchDrawBlocks.mockResolvedValue({ ...chainOk(equal3), parentTimestamp: sec(CLOSES) + 1n });
    await run(detailOf(equal3));
    const list = await screen.findByRole("list", { name: "Comprobaciones" });
    const bad = within(list).getAllByRole("listitem").find((li) => /primer bloque posterior al cierre/.test(li.textContent!))!;
    expect(bad.textContent!.startsWith("✗")).toBe(true);
  });

  it("says so when the chain cannot be read, without calling the draw wrong", async () => {
    fetchDrawBlocks.mockRejectedValue(new Error("rpc down"));
    await run(detailOf(equal3));
    expect(await screen.findByText("Comprobado: el compromiso coincide y gana la participación #3.")).toBeInTheDocument();
    expect(screen.getByText(/No se pudo consultar la red/)).toBeInTheDocument();
  });

  it("a tampered seed does not match the commitment", async () => {
    fetchDrawBlocks.mockResolvedValue(chainOk(equal3));
    await run(detailOf(equal3, { seedReveal: `0x${"01".repeat(32)}` }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No coincide: la semilla no corresponde al compromiso.");
  });

  it("a wrong winner shows the computed one", async () => {
    fetchDrawBlocks.mockResolvedValue(chainOk(equal3));
    await run(detailOf(equal3, { winnerPosition: 1 }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No coincide: el ganador calculado es la participación #3.");
  });

  it("void: nobody had weight", async () => {
    fetchDrawBlocks.mockResolvedValue(chainOk(allZero));
    await run(detailOf(allZero));
    expect(await screen.findByText("Comprobado: nadie tenía peso, así que no hay ganador.")).toBeInTheDocument();
  });

  it("malformed inputs say Datos no válidos instead of a mismatch", async () => {
    fetchDrawBlocks.mockResolvedValue(chainOk(equal3));
    await run(detailOf(equal3, { seedReveal: "0x1234" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Datos no válidos");
    expect(screen.queryByText(/No coincide/)).toBeNull();
  });

  it("a negative weight is Datos no válidos", async () => {
    const d = detailOf(equal3);
    d.entryList[0] = { ...d.entryList[0]!, weight: -1n };
    await run(d);
    expect(await screen.findByRole("alert")).toHaveTextContent("Datos no válidos");
  });

  it("a total weight that differs from the list is Datos no válidos", async () => {
    await run(detailOf(equal3, { totalWeight: 99n }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Datos no válidos");
  });

  it("explains that the seed arrives at the draw instead of the button", () => {
    render(<RaffleVerifier detail={detailOf(equal3, { status: "closed", seedReveal: null, drawBlockHash: null, winnerPosition: null })} />);
    expect(screen.getByText("La semilla se publicará al resolver el sorteo.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Comprobar en este navegador" })).toBeNull();
  });
});
