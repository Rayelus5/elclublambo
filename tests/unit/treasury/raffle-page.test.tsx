import { render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ rpc: async () => ({ data: null, error: null }) }) }));

const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);
vi.mock("next/navigation", () => ({ notFound, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/treasury/dao-live", () => ({ DaoLive: () => null }));
vi.mock("@/lib/economy/config", () => ({ getEconomyConfig: async () => ({ legacyDaoEnabled: true }) }));
vi.mock("@/lib/treasury/raffle-verify-chain", () => ({ fetchDrawBlocks: vi.fn() }));

const getRaffleDetail = vi.hoisted(() => vi.fn());
vi.mock("@/lib/treasury/raffles", async (orig) => ({ ...(await orig<object>()), getRaffleDetail }));

import RafflePage from "@/app/(forum)/dao/sorteos/[id]/page";
import type { RaffleDetail } from "@/lib/treasury/raffles";

const ID = "11111111-1111-4111-8111-111111111111";
const SEED = `0x${"cd".repeat(32)}`;
const HASH = `0x${"ef".repeat(32)}`;

const detail: RaffleDetail = {
  id: ID,
  title: "Gran sorteo",
  prizeToken: "USDC",
  prizeAmount: 10_000000n,
  mode: "equal",
  closesAt: "2026-10-19T12:00:00.000Z",
  status: "drawn",
  entries: 2,
  iEntered: true,
  myWeight: 3n,
  totalWeight: 7n,
  commit: `0x${"ab".repeat(32)}`,
  seedReveal: SEED,
  drawBlockNumber: 4242n,
  winnerLabel: "ana",
  iWon: false,
  unpaid: false,
  paidLate: false,
  payoutRecorded: false,
  cancelReason: null,
  createdAt: "2026-10-19T10:00:00Z",
  chainId: 59141,
  drawBlockHash: HASH,
  drawBlockTime: "2026-10-19T12:00:04.000Z",
  drawParentBlockTime: "2026-10-19T11:59:58.000Z",
  drawRandom: 5n,
  winnerPosition: 2,
  payoutTxHash: null,
  entryList: [
    { position: 1, label: "Anónimo #1", weight: 4n, isMe: false },
    { position: 2, label: "yo", weight: 3n, isMe: true },
  ],
};

async function content(id: string): Promise<ReactElement> {
  const suspense = RafflePage({ params: Promise.resolve({ id }) }) as ReactElement<{ children: ReactElement }>;
  const el = suspense.props.children as ReactElement<object> & { type: (p: object) => Promise<ReactElement> };
  return el.type(el.props);
}

beforeEach(() => {
  notFound.mockClear();
  getRaffleDetail.mockReset();
  getRaffleDetail.mockResolvedValue(detail);
});

describe("/dao/sorteos/[id]", () => {
  it("is a 404 when the raffle does not exist", async () => {
    getRaffleDetail.mockResolvedValue(null);
    await expect(content(ID)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("is a 404 for a malformed id, without calling the database", async () => {
    await expect(content("no-es-un-uuid")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getRaffleDetail).not.toHaveBeenCalled();
  });

  it("shows the title, the data, the participants and the five steps", async () => {
    render(await content(ID));
    expect(screen.getByRole("heading", { level: 1, name: "Gran sorteo" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Datos del sorteo" })).toBeInTheDocument();
    expect(screen.getByText(SEED)).toBeInTheDocument();
    expect(screen.getByText(HASH)).toBeInTheDocument();
    const block = screen.getByRole("link", { name: "4242" });
    expect(block).toHaveAttribute("href", "https://sepolia.lineascan.build/block/4242");

    const list = screen.getByRole("list", { name: "Participantes" });
    const items = within(list).getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toBe("#1 · Anónimo #1 · peso 4");
    expect(items[1]).toBe("#2 · yo (tú) · peso 3");

    const steps = within(screen.getByRole("list", { name: "Pasos para comprobarlo" })).getAllByRole("listitem").map((li) => li.textContent);
    expect(steps).toEqual([
      "Comprueba que keccak256(semilla) coincide con el compromiso publicado al crear el sorteo.",
      "Abre el bloque 4242 en el explorador: es el primero con hora posterior al cierre. Copia su hash.",
      "Calcula keccak256(semilla seguida del hash del bloque, 64 bytes) y léelo como un número entero.",
      "Divide ese número entre el peso total (7) y quédate con el resto r.",
      "Recorre la lista en orden sumando pesos: gana el primero cuya suma supera r.",
    ]);
    expect(screen.getByRole("button", { name: "Comprobar en este navegador" })).toBeInTheDocument();
  });

  it("before the draw the seed is not there and the button is replaced", async () => {
    getRaffleDetail.mockResolvedValue({ ...detail, status: "open", seedReveal: null, drawBlockNumber: null, drawBlockHash: null, winnerPosition: null, totalWeight: null });
    render(await content(ID));
    expect(screen.getByText("La semilla se publicará al resolver el sorteo.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Comprobar en este navegador" })).toBeNull();
  });

  it("says when the weights are taken and what weighted lists reveal", async () => {
    getRaffleDetail.mockResolvedValue({ ...detail, mode: "weighted" });
    render(await content(ID));
    expect(screen.getByText(/al procesar el cierre/)).toBeInTheDocument();
    expect(screen.getByText(/en un club pequeño puede deducirse quién es un miembro oculto/)).toBeInTheDocument();
  });
});
