import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const vote = vi.hoisted(() => vi.fn());
vi.mock("@/lib/polls/actions", () => ({ votePollAction: (...a: unknown[]) => vote(...a) }));

import { PollCard } from "@/components/chat/poll-card";
import { formatWhen } from "@/lib/treasury/panel";
import type { PollDetail } from "@/lib/polls/polls";

const A = "a0000000-0000-4000-8000-000000000001";
const B = "a0000000-0000-4000-8000-000000000002";
const C = "a0000000-0000-4000-8000-000000000003";
const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

const poll = (over: Partial<PollDetail> = {}): PollDetail => ({
  messageId: "m1",
  weightMode: "equal",
  closesAt: iso(NOW + 2 * 3_600_000),
  closed: false,
  voterCount: 2,
  options: [
    { id: A, label: "Sí", position: 0 },
    { id: B, label: "No", position: 1 },
    { id: C, label: "Una opción con un texto bastante largo que debe hacer salto de línea en móvil", position: 2 },
  ],
  myOptionId: null,
  iVoted: false,
  myHasWeight: null,
  results: { status: "pending" },
  ...over,
});

const now = () => NOW;

beforeEach(() => {
  vote.mockReset();
  vote.mockResolvedValue({ ok: true, status: "cast", voterCount: 3 });
});
afterEach(() => vi.useRealTimers());

describe("PollCard: header", () => {
  it("shows the badge, mode, time left with the close date, voter count, secrecy, advisory note and guide link", () => {
    const p = poll();
    render(<PollCard poll={p} onChanged={() => {}} now={now} />);
    expect(screen.getByText("Encuesta")).toBeInTheDocument();
    expect(screen.getByText("1 persona, 1 voto")).toBeInTheDocument();
    const left = screen.getByText("Cierra en 2 h");
    expect(left).toHaveAttribute("title", `Cierra el ${formatWhen(p.closesAt)}`);
    expect(screen.getByText("2 votantes")).toBeInTheDocument();
    expect(screen.getByText("Voto secreto · resultados al cerrar")).toBeInTheDocument();
    expect(screen.getByText("Consultiva: el resultado no se aplica solo.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /¿Cómo funciona\?/ })).toHaveAttribute("href", "/guia/encuestas");
  });

  it("announces the voter count politely", () => {
    render(<PollCard poll={poll()} onChanged={() => {}} now={now} />);
    expect(screen.getByText("2 votantes").closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
  });
});

describe("PollCard: open, not voted", () => {
  it("renders a radiogroup of 44px radios and Votar disabled until one is picked", async () => {
    render(<PollCard poll={poll()} onChanged={() => {}} now={now} />);
    const group = screen.getByRole("radiogroup", { name: "Opciones" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(3);
    for (const r of radios) expect(r.className).toMatch(/min-h-11/);
    expect(screen.getByText("Aún no has votado.")).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: "Votar" });
    expect(btn).toBeDisabled();
    await userEvent.click(radios[1]!);
    expect(radios[1]).toHaveAttribute("aria-checked", "true");
    expect(btn).toBeEnabled();
  });

  it("votes once even on a double click, then calls onChanged", async () => {
    let release!: (v: unknown) => void;
    vote.mockReturnValue(new Promise((r) => (release = r)));
    const onChanged = vi.fn();
    render(<PollCard poll={poll()} onChanged={onChanged} now={now} />);
    await userEvent.click(screen.getByRole("radio", { name: "No" }));
    const btn = screen.getByRole("button", { name: "Votar" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(vote).toHaveBeenCalledTimes(1);
    expect(vote).toHaveBeenCalledWith("m1", B);
    await act(async () => release({ ok: true, status: "cast", voterCount: 3 }));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("moves the selection with the arrow keys", async () => {
    render(<PollCard poll={poll()} onChanged={() => {}} now={now} />);
    const first = screen.getByRole("radio", { name: "Sí" });
    first.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("radio", { name: "No" })).toHaveAttribute("aria-checked", "true");
  });

  it("renders no percentage while results are pending", () => {
    render(<PollCard poll={poll({ myOptionId: A, iVoted: true })} onChanged={() => {}} now={now} />);
    expect(document.body.textContent).not.toMatch(/%/);
  });
});

describe("PollCard: open, voted", () => {
  const voted = () => poll({ myOptionId: A, iVoted: true });

  it("shows the own vote, lets change it only to a different option", async () => {
    render(<PollCard poll={voted()} onChanged={() => {}} now={now} />);
    expect(screen.getByText("Tu voto: Sí")).toBeInTheDocument();
    expect(screen.getByText("Puedes cambiarlo hasta el cierre.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Sí" })).toHaveAttribute("aria-checked", "true");
    const btn = screen.getByRole("button", { name: "Cambiar voto" });
    expect(btn).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "No" }));
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    expect(vote).toHaveBeenCalledWith("m1", B);
  });

  it("shows the mapped error in an alert and does not call onChanged", async () => {
    vote.mockResolvedValue({ ok: false, code: "forbidden", error: "No tienes permiso para hacer esto." });
    const onChanged = vi.fn();
    render(<PollCard poll={voted()} onChanged={onChanged} now={now} />);
    await userEvent.click(screen.getByRole("radio", { name: "No" }));
    await userEvent.click(screen.getByRole("button", { name: "Cambiar voto" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No tienes permiso para hacer esto.");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("after a successful vote the pick yields to the server's vote once re-read (no stale highlight)", async () => {
    const { rerender } = render(<PollCard poll={voted()} onChanged={() => {}} now={now} />);
    await userEvent.click(screen.getByRole("radio", { name: "No" }));
    await userEvent.click(screen.getByRole("button", { name: "Cambiar voto" }));
    expect(vote).toHaveBeenCalledWith("m1", B);
    // The re-read brings the new vote: nothing left to submit.
    rerender(<PollCard poll={poll({ myOptionId: B, iVoted: true })} onChanged={() => {}} now={now} />);
    expect(screen.getByText("Tu voto: No")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "No" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Cambiar voto" })).toBeDisabled();
    // The vote changes elsewhere (another tab): the card follows the server, not the old local pick.
    rerender(<PollCard poll={poll({ myOptionId: A, iVoted: true })} onChanged={() => {}} now={now} />);
    expect(screen.getByRole("radio", { name: "Sí" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "No" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("button", { name: "Cambiar voto" })).toBeDisabled();
  });

  it("reverts the highlight to the server's vote when voting fails", async () => {
    vote.mockResolvedValue({ ok: false, code: "forbidden", error: "No tienes permiso para hacer esto." });
    render(<PollCard poll={voted()} onChanged={() => {}} now={now} />);
    await userEvent.click(screen.getByRole("radio", { name: "No" }));
    await userEvent.click(screen.getByRole("button", { name: "Cambiar voto" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Sí" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "No" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("button", { name: "Cambiar voto" })).toBeDisabled();
  });

  it("re-reads the poll when the server says it is already closed", async () => {
    vote.mockResolvedValue({ ok: false, code: "poll_closed", error: "La encuesta ya está cerrada." });
    const onChanged = vi.fn();
    render(<PollCard poll={poll()} onChanged={onChanged} now={now} />);
    await userEvent.click(screen.getByRole("radio", { name: "No" }));
    await userEvent.click(screen.getByRole("button", { name: "Votar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("La encuesta ya está cerrada.");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});

describe("PollCard: weighted", () => {
  it("explains a zero-weight vote", () => {
    render(<PollCard poll={poll({ weightMode: "linear", myHasWeight: false })} onChanged={() => {}} now={now} />);
    expect(
      screen.getByText(
        "Tu voto pesa 0: en esta encuesta cuentan las participaciones sin bloquear que tenías al crearla, y no tenías. Puedes votar igualmente.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Ponderada · lineal según participación")).toBeInTheDocument();
  });

  it("explains a weighted vote", () => {
    render(<PollCard poll={poll({ weightMode: "quadratic", myHasWeight: true })} onChanged={() => {}} now={now} />);
    expect(screen.getByText("Tu voto pesa según tus participaciones al crear la encuesta.")).toBeInTheDocument();
  });

  it("shows neither note in an equal poll", () => {
    render(<PollCard poll={poll()} onChanged={() => {}} now={now} />);
    expect(screen.queryByText(/Tu voto pesa/)).not.toBeInTheDocument();
  });
});

describe("PollCard: closed", () => {
  const closed = (over: Partial<PollDetail> = {}) =>
    poll({ closed: true, closesAt: iso(NOW - 1000), voterCount: 4, ...over });

  it("says Cerrada and Votaste without naming the option, and has no radios", () => {
    render(<PollCard poll={closed({ iVoted: true })} onChanged={() => {}} now={now} />);
    expect(screen.getByText("Cerrada")).toBeInTheDocument();
    expect(screen.getByText("Votaste")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Votar|Cambiar voto/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Tu voto:/)).not.toBeInTheDocument();
  });

  it("does not say Votaste to someone who did not vote", () => {
    render(<PollCard poll={closed()} onChanged={() => {}} now={now} />);
    expect(screen.queryByText("Votaste")).not.toBeInTheDocument();
  });

  it("does not leak the option even if a stale myOptionId is present", () => {
    render(<PollCard poll={closed({ iVoted: true, myOptionId: A })} onChanged={() => {}} now={now} />);
    expect(screen.queryByText(/Tu voto/)).not.toBeInTheDocument();
  });

  it("shows no percentage while results are pending", () => {
    render(<PollCard poll={closed()} onChanged={() => {}} now={now} />);
    expect(document.body.textContent).not.toMatch(/%/);
  });
});

describe("PollCard: published", () => {
  it("lists one bar per option in order, with the % as text; equal mode keeps one decimal", () => {
    const p = poll({
      closed: true,
      closesAt: iso(NOW - 1000),
      voterCount: 3,
      results: { status: "published", tenths: { [A]: 667, [B]: 333, [C]: 0 } },
    });
    render(<PollCard poll={p} onChanged={() => {}} now={now} />);
    const list = screen.getByRole("list", { name: "Resultados" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Sí");
    expect(items[0]).toHaveTextContent("66,7 %");
    expect(items[1]).toHaveTextContent("33,3 %");
    expect(items[2]).toHaveTextContent("0 %");
    const bar = items[0]!.querySelector('[data-testid="poll-bar"]') as HTMLElement;
    expect(bar).toHaveAttribute("aria-hidden", "true");
    expect(bar.style.width).toBe("66.7%");
    expect(screen.getByText("3 votantes · % de los votos")).toBeInTheDocument();
  });

  it("weighted modes show whole percentages, never a 100 % total, and the weight footer", () => {
    const p = poll({
      weightMode: "quadratic",
      closed: true,
      closesAt: iso(NOW - 1000),
      voterCount: 6,
      results: { status: "published", tenths: { [A]: 580, [B]: 270, [C]: 150 } },
    });
    render(<PollCard poll={p} onChanged={() => {}} now={now} />);
    expect(screen.getByText("58 %")).toBeInTheDocument();
    expect(screen.getByText("27 %")).toBeInTheDocument();
    expect(screen.getByText("6 votantes · % del peso total")).toBeInTheDocument();
    expect(screen.queryByText("100 %")).not.toBeInTheDocument();
  });

  it("copes with bars that add up to more than 100 %", () => {
    const p = poll({
      weightMode: "quadratic",
      closed: true,
      closesAt: iso(NOW - 1000),
      voterCount: 6,
      results: { status: "published", tenths: { [A]: 500, [B]: 260, [C]: 250 } },
    });
    render(<PollCard poll={p} onChanged={() => {}} now={now} />);
    expect(screen.getByText("25 %")).toBeInTheDocument();
  });
});

describe("PollCard: insufficient", () => {
  const insufficient = (over: Partial<PollDetail> = {}) =>
    poll({ closed: true, closesAt: iso(NOW - 1000), voterCount: 2, results: { status: "insufficient" }, ...over });

  it("explains the equal case with the voter count", () => {
    render(<PollCard poll={insufficient()} onChanged={() => {}} now={now} />);
    expect(screen.getByText("Muy pocos votos para mostrar los resultados sin revelar quién votó qué.")).toBeInTheDocument();
    expect(screen.getByText("2 votantes")).toBeInTheDocument();
    expect(screen.queryByText(/hacen falta/)).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Resultados" })).not.toBeInTheDocument();
  });

  it("adds the weighted requirement (5 voters with participaciones, F4e-R3)", () => {
    render(<PollCard poll={insufficient({ weightMode: "linear", voterCount: 7 })} onChanged={() => {}} now={now} />);
    expect(
      screen.getByText("En una encuesta ponderada hacen falta al menos 5 votantes con participaciones."),
    ).toBeInTheDocument();
  });
});

describe("PollCard: readOnly", () => {
  it("renders no vote controls", () => {
    render(<PollCard poll={poll({ weightMode: "linear", myHasWeight: true })} onChanged={() => {}} now={now} readOnly />);
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Encuesta")).toBeInTheDocument();
  });
});

describe("PollCard: live", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  it("updates the time left every minute", () => {
    render(<PollCard poll={poll({ closesAt: iso(NOW + 3 * 60_000 + 30_000) })} onChanged={() => {}} />);
    expect(screen.getByText("Cierra en 3 min")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(60_000));
    expect(screen.getByText("Cierra en 2 min")).toBeInTheDocument();
  });

  it("calls onChanged once when closesAt passes and shows it closed", () => {
    const onChanged = vi.fn();
    render(<PollCard poll={poll({ closesAt: iso(NOW + 90_000), myOptionId: A, iVoted: true })} onChanged={onChanged} />);
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(89_000));
    expect(onChanged).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(2_000));
    expect(onChanged).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(5 * 60_000));
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.getByText("Votaste")).toBeInTheDocument();
    expect(screen.queryByText(/Tu voto:/)).not.toBeInTheDocument();
  });

  it("arms no close timer while 24 h or more remain, and arms it once the minute ticker sees < 24 h", () => {
    const spy = vi.spyOn(globalThis, "setTimeout");
    const onChanged = vi.fn();
    render(<PollCard poll={poll({ closesAt: iso(NOW + 24 * 3_600_000 + 30_000) })} onChanged={onChanged} />);
    const longTimers = () => spy.mock.calls.filter((c) => (c[1] as number) > 2 ** 31 - 1 || (c[1] as number) > 24 * 3_600_000);
    expect(longTimers()).toHaveLength(0);
    expect(spy.mock.calls.some((c) => (c[1] as number) > 3_600_000)).toBe(false);
    act(() => void vi.advanceTimersByTime(60_000));
    expect(spy.mock.calls.some((c) => (c[1] as number) > 3_600_000 && (c[1] as number) < 24 * 3_600_000)).toBe(true);
    spy.mockRestore();
  });

  it("does not call onChanged for a poll the server already reports closed", () => {
    const onChanged = vi.fn();
    render(<PollCard poll={poll({ closed: true, closesAt: iso(NOW - 5000) })} onChanged={onChanged} />);
    act(() => void vi.advanceTimersByTime(120_000));
    expect(onChanged).not.toHaveBeenCalled();
  });
});
