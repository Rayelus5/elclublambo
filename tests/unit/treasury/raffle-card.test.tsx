import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const enterRaffleAction = vi.hoisted(() => vi.fn());
const leaveRaffleAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/treasury/raffle-actions", () => ({ enterRaffleAction, leaveRaffleAction }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { RaffleCard } from "@/components/treasury/raffles/raffle-card";
import { RaffleList } from "@/components/treasury/raffles/raffle-list";
import { formatWhen } from "@/lib/treasury/panel";
import type { RaffleCard as Card } from "@/lib/treasury/raffles";

const ID = "11111111-1111-4111-8111-111111111111";
const COMMIT = `0x${"ab".repeat(32)}`;
const SEED = `0x${"cd".repeat(32)}`;
const FUTURE = new Date(Date.now() + 3 * 86_400_000).toISOString();
const PAST = new Date(Date.now() - 3600_000).toISOString();

const base: Card = {
  id: ID,
  title: "Sorteo de bienvenida",
  prizeToken: "USDC",
  prizeAmount: 10_000000n,
  mode: "equal",
  closesAt: FUTURE,
  status: "open",
  entries: 3,
  iEntered: false,
  myWeight: null,
  totalWeight: null,
  commit: COMMIT,
  seedReveal: null,
  drawBlockNumber: null,
  winnerLabel: null,
  iWon: false,
  unpaid: false,
  paidLate: false,
  payoutRecorded: false,
  cancelReason: null,
  createdAt: "2026-10-19T10:00:00Z",
};
const show = (over: Partial<Card> = {}, extra: { unlockedShares?: bigint } = {}) => render(<RaffleCard raffle={{ ...base, ...over }} {...extra} />);

beforeEach(() => {
  enterRaffleAction.mockReset();
  leaveRaffleAction.mockReset();
});

describe("RaffleCard: open", () => {
  it("shows the prize, close, mode, participants and the commit with its help", () => {
    show();
    expect(screen.getByRole("heading", { name: "Sorteo de bienvenida" })).toBeInTheDocument();
    expect(screen.getByText("Premio: 10 USDC")).toBeInTheDocument();
    expect(screen.getByText(`Cierra el ${formatWhen(FUTURE)}`)).toBeInTheDocument();
    expect(screen.getByText("Igualitario")).toBeInTheDocument();
    expect(screen.getByText("Participantes: 3")).toBeInTheDocument();
    expect(screen.getByText(`Compromiso: ${COMMIT}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copiar compromiso/ })).toBeInTheDocument();
    expect(
      screen.getByText("Es el hash de una semilla secreta. La semilla se revela al sortear, así que nadie puede saber antes quién ganará."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver participantes y cómo comprobarlo" })).toHaveAttribute("href", `/foro/dao/sorteos/${ID}`);
  });

  it("says weighted mode in words", () => {
    show({ mode: "weighted" });
    expect(screen.getByText("Ponderado por participación")).toBeInTheDocument();
  });

  it("joins once even on a double click, then offers to leave", async () => {
    let done!: (v: { ok: true }) => void;
    enterRaffleAction.mockReturnValue(new Promise((r) => (done = r)));
    show();
    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: "Participar" });
    await user.dblClick(button);
    expect(enterRaffleAction).toHaveBeenCalledTimes(1);
    expect(enterRaffleAction).toHaveBeenCalledWith(ID);
    done({ ok: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "Salir del sorteo" })).toBeInTheDocument());
    expect(screen.getByText("Estás dentro")).toBeInTheDocument();
  });

  it("leaves a raffle I am in", async () => {
    leaveRaffleAction.mockResolvedValue({ ok: true });
    show({ iEntered: true });
    expect(screen.getByText("Estás dentro")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Salir del sorteo" }));
    expect(leaveRaffleAction).toHaveBeenCalledWith(ID);
    await waitFor(() => expect(screen.getByRole("button", { name: "Participar" })).toBeInTheDocument());
  });

  it("shows the mapped error in role=alert", async () => {
    enterRaffleAction.mockResolvedValue({ ok: false, code: "raffle_closed", error: "El sorteo ya está cerrado." });
    show();
    await userEvent.setup().click(screen.getByRole("button", { name: "Participar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("El sorteo ya está cerrado.");
    expect(screen.getByRole("button", { name: "Participar" })).toBeInTheDocument();
  });

  it("is disabled on the very first paint once closesAt has passed (the cron has not closed it yet)", () => {
    show({ closesAt: PAST });
    expect(screen.getByRole("button", { name: "Participar" })).toBeDisabled();
  });
});

describe("RaffleCard: weighted", () => {
  it("warns a member without unlocked participaciones, who may still join", () => {
    show({ mode: "weighted" }, { unlockedShares: 0n });
    expect(
      screen.getByText(
        "En este sorteo pesan tus participaciones sin bloquear al cerrar. Ahora no tienes: puedes apuntarte, pero pesarías 0 y no podrías ganar.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Participar" })).toBeEnabled();
  });

  it("explains when the weights are taken and what a weighted list reveals", () => {
    show({ mode: "weighted" }, { unlockedShares: 5n * 10n ** 18n });
    expect(screen.getByText(/al procesar el cierre/)).toBeInTheDocument();
    expect(screen.getByText(/en un club pequeño puede deducirse quién es un miembro oculto/)).toBeInTheDocument();
    expect(screen.queryByText(/pesarías 0/)).toBeNull();
  });

  it("shows my weight after the close", () => {
    show({ mode: "weighted", status: "closed", closesAt: PAST, iEntered: true, myWeight: 3n * 10n ** 18n, totalWeight: 10n * 10n ** 18n });
    expect(screen.getByText("Tu peso: 3 participaciones de 10 participaciones")).toBeInTheDocument();
  });
});

describe("RaffleCard: WETH", () => {
  it("names the token and why it is WETH", () => {
    show({ prizeToken: "WETH", prizeAmount: 10n ** 16n });
    expect(screen.getByText("Premio: 0,01 WETH")).toBeInTheDocument();
    expect(
      screen.getByText("Se paga en WETH: un envío de ETH nativo desde la Safe no deja un registro que el foro pueda comprobar."),
    ).toBeInTheDocument();
  });
});

describe("RaffleCard: after the close", () => {
  it("closed: waits for the draw block", () => {
    show({ status: "closed", closesAt: PAST });
    expect(screen.getByText("Cerrado · esperando el bloque del sorteo")).toBeInTheDocument();
    expect(
      screen.getByText("El ganador sale cuando la red finaliza el primer bloque posterior al cierre (puede tardar unas horas)."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Participar" })).toBeNull();
  });

  it("drawn: winner, status, seed and block", () => {
    show({ status: "drawn", closesAt: PAST, winnerLabel: "ana", seedReveal: SEED, drawBlockNumber: 1234n });
    expect(screen.getByText("Ganador: ana")).toBeInTheDocument();
    expect(screen.getByText("Resuelto · pendiente de pago")).toBeInTheDocument();
    expect(screen.getByText(`Semilla: ${SEED}`)).toBeInTheDocument();
    expect(screen.getByText("Bloque: 1234")).toBeInTheDocument();
    expect(screen.queryByText("¡Has ganado!")).toBeNull();
  });

  it("a hidden winner is Anónimo", () => {
    show({ status: "drawn", winnerLabel: null, seedReveal: SEED, drawBlockNumber: 5n });
    expect(screen.getByText("Ganador: Anónimo")).toBeInTheDocument();
  });

  it("congratulates the winner", () => {
    show({ status: "drawn", winnerLabel: "yo", iWon: true, seedReveal: SEED, drawBlockNumber: 5n });
    expect(screen.getByText("¡Has ganado!")).toBeInTheDocument();
  });

  it("unpaid is text with a warning icon", () => {
    show({ status: "drawn", winnerLabel: "ana", unpaid: true, seedReveal: SEED, drawBlockNumber: 5n });
    const label = screen.getByText("Impagado · más de 14 días sin pagar");
    expect(label.parentElement?.querySelector("svg")).not.toBeNull();
  });

  it("void: no winner", () => {
    show({ status: "void", seedReveal: SEED });
    expect(screen.getByText("Sin ganador: nadie con peso se apuntó.")).toBeInTheDocument();
  });

  it("cancelled shows the reason", () => {
    show({ status: "cancelled", cancelReason: "Error en el premio" });
    expect(screen.getByText("Cancelado: Error en el premio")).toBeInTheDocument();
  });

  it("every card links to the raffle page", () => {
    show({ status: "paid", winnerLabel: "ana" });
    expect(screen.getByRole("link", { name: "Ver participantes y cómo comprobarlo" })).toHaveAttribute("href", `/foro/dao/sorteos/${ID}`);
  });
});

describe("RaffleList", () => {
  it("puts Activos before Pasados", () => {
    render(
      <RaffleList
        raffles={[
          { ...base, id: "a", title: "Abierto uno" },
          { ...base, id: "b", title: "Pasado uno", status: "paid", winnerLabel: "ana" },
        ]}
      />,
    );
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["Activos", "Pasados"]);
    const cards = screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
    expect(cards).toEqual(["Abierto uno", "Pasado uno"]);
  });

  it("says so when there are none", () => {
    render(<RaffleList raffles={[]} />);
    expect(screen.getByText("No hay sorteos todavía.")).toBeInTheDocument();
  });
});
