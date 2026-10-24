import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createPollAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/polls/actions", () => ({ createPollAction }));

import { PollDialog } from "@/components/chat/poll-dialog";

const CH = "11111111-1111-4111-8111-111111111111";

function setup(initialQuestion = "") {
  const onSlowmode = vi.fn();
  const onPosted = vi.fn();
  const onOpenChange = vi.fn();
  render(<PollDialog open onOpenChange={onOpenChange} channelId={CH} initialQuestion={initialQuestion} onPosted={onPosted} onSlowmode={onSlowmode} />);
  return { onPosted, onSlowmode, onOpenChange, user: userEvent.setup() };
}

const publish = () => screen.getByRole("button", { name: "Publicar encuesta" });

async function fill(user: ReturnType<typeof userEvent.setup>, q = "¿Dónde quedamos?", a = "Madrid", b = "Lisboa") {
  await user.clear(screen.getByLabelText("Pregunta"));
  await user.type(screen.getByLabelText("Pregunta"), q);
  await user.type(screen.getByLabelText("Opción 1"), a);
  await user.type(screen.getByLabelText("Opción 2"), b);
}

beforeEach(() => createPollAction.mockReset());

describe("PollDialog", () => {
  it("shows the title, the secrecy note and the guide link", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Nueva encuesta" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "El voto es secreto: nadie, tampoco los admins, verá qué vota cada uno (a nivel de la aplicación). Los resultados se publican al cerrar, si votan al menos 3 personas. La encuesta es consultiva: no ejecuta nada por sí sola.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /¿Cómo funciona\?/ })).toHaveAttribute("href", "/guia/encuestas");
  });

  it("starts from the composer text and counts characters", () => {
    setup("¿Hola?");
    expect(screen.getByLabelText("Pregunta")).toHaveValue("¿Hola?");
    expect(screen.getByText("6/300")).toBeInTheDocument();
  });

  it("adds and removes options between 2 and 10", async () => {
    const { user } = setup();
    expect(screen.queryByRole("button", { name: /Quitar opción/ })).not.toBeInTheDocument();
    for (let i = 3; i <= 10; i++) await user.click(screen.getByRole("button", { name: "Añadir opción" }));
    expect(screen.getByLabelText("Opción 10")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Añadir opción" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quitar opción 2" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Quitar opción 10" }));
    expect(screen.queryByLabelText("Opción 10")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Añadir opción" })).toBeInTheDocument();
  });

  it("offers the close presets, with a date input only for «Otra fecha»", async () => {
    const { user } = setup();
    for (const n of ["1 hora", "1 día", "3 días", "7 días", "Otra fecha"]) expect(screen.getByRole("radio", { name: n })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "1 día" })).toBeChecked();
    expect(screen.getByText("Entre 1 hora y 30 días desde ahora.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Fecha de cierre")).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Otra fecha" }));
    expect(screen.getByLabelText("Fecha de cierre")).toHaveAttribute("type", "datetime-local");
  });

  it("offers no weight mode: one person, one vote", () => {
    setup();
    expect(screen.queryByRole("group", { name: "Peso del voto" })).not.toBeInTheDocument();
    expect(screen.queryAllByRole("radio", { name: /participación/ })).toHaveLength(0);
    expect(screen.queryByText(/participaciones/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ponderad/i)).not.toBeInTheDocument();
  });

  it("counts the question after normalization, like the server", async () => {
    setup("  hola   mundo \n ");
    expect(screen.getByText("10/300")).toBeInTheDocument();
  });

  it("never truncates an option in the browser (M8): the validator counts code points, as the server does", async () => {
    const { user } = setup();
    const option = screen.getByLabelText("Opción 1");
    expect(option).not.toHaveAttribute("maxlength");
    // 41 emoji: 82 UTF-16 units but 41 characters, well inside the 80-character limit.
    fireEvent.change(option, { target: { value: "😀".repeat(41) } });
    expect(option).toHaveValue("😀".repeat(41));
    await user.type(screen.getByLabelText("Pregunta"), "¿Cuál?");
    await user.type(screen.getByLabelText("Opción 2"), "b");
    createPollAction.mockResolvedValue({ ok: true, messageId: "m1" });
    await user.click(publish());
    await waitFor(() => expect(createPollAction).toHaveBeenCalledTimes(1));
    expect(createPollAction.mock.calls[0]![0].options[0]).toBe("😀".repeat(41));
  });

  it("states the results floor of 3 voters", () => {
    setup();
    expect(screen.getByText(/Los resultados se publican al cerrar, si votan al menos 3 personas\./)).toBeInTheDocument();
  });

  it("adds the application-level qualifier to the secrecy note", () => {
    setup();
    expect(screen.getByText(/a nivel de la aplicación/)).toBeInTheDocument();
  });

  it("focuses the first invalid field on a failed submit", async () => {
    const { user } = setup();
    await user.click(publish());
    expect(screen.getByLabelText("Pregunta")).toHaveFocus();
    await user.type(screen.getByLabelText("Pregunta"), "¿Sí?");
    await user.type(screen.getByLabelText("Opción 1"), "a");
    await user.click(publish());
    expect(screen.getByLabelText("Opción 1")).toHaveFocus();
  });

  it("submits a custom date, and refuses an empty or out-of-range one", async () => {
    const { user } = setup();
    await fill(user);
    await user.click(screen.getByRole("radio", { name: "Otra fecha" }));
    await user.click(publish());
    expect(screen.getByLabelText("Fecha de cierre")).toHaveFocus();
    expect(createPollAction).not.toHaveBeenCalled();
    const d = new Date(Date.now() + 2 * 86_400_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    fireEvent.change(screen.getByLabelText("Fecha de cierre"), { target: { value: "2000-01-01T10:00" } });
    await user.click(publish());
    expect(createPollAction).not.toHaveBeenCalled();
    createPollAction.mockResolvedValue({ ok: true, messageId: "m2" });
    fireEvent.change(screen.getByLabelText("Fecha de cierre"), { target: { value: local } });
    await user.click(publish());
    expect(createPollAction).toHaveBeenCalledTimes(1);
    expect(Date.parse(createPollAction.mock.calls[0]![0].closesAt)).toBe(new Date(local).getTime());
  });

  it("flags an empty question on the field without calling the server", async () => {
    const { user } = setup();
    await user.click(publish());
    const q = screen.getByLabelText("Pregunta");
    expect(q).toHaveAttribute("aria-invalid", "true");
    const msg = screen.getByText("Escribe la pregunta, de 1 a 300 caracteres.");
    expect(q.getAttribute("aria-describedby")).toContain(msg.id);
    expect(createPollAction).not.toHaveBeenCalled();
  });

  it("flags a duplicate option without calling the server", async () => {
    const { user } = setup();
    await fill(user, "¿Dónde?", "Madrid", " madrid ");
    await user.click(publish());
    expect(screen.getByText("Pon de 2 a 10 opciones distintas, de 1 a 80 caracteres cada una.")).toBeInTheDocument();
    expect(createPollAction).not.toHaveBeenCalled();
  });

  it("publishes once, even on a double click, with closesAt = now + preset", async () => {
    let resolve!: (v: unknown) => void;
    createPollAction.mockReturnValue(new Promise((r) => (resolve = r)));
    const { user, onPosted, onOpenChange } = setup();
    await fill(user);
    await user.click(screen.getByRole("radio", { name: "3 días" }));
    const before = Date.now();
    await user.dblClick(publish());
    expect(createPollAction).toHaveBeenCalledTimes(1);
    const arg = createPollAction.mock.calls[0]![0];
    expect(arg).toMatchObject({ channelId: CH, question: "¿Dónde quedamos?", options: ["Madrid", "Lisboa"] });
    expect(arg).not.toHaveProperty("weightMode");
    const diff = Date.parse(arg.closesAt) - before;
    expect(diff).toBeGreaterThanOrEqual(3 * 86_400_000 - 1000);
    expect(diff).toBeLessThanOrEqual(3 * 86_400_000 + 10_000);
    resolve({ ok: true, messageId: "m1" });
    await waitFor(() => expect(onPosted).toHaveBeenCalledWith("m1"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("starts the slowmode countdown on slowmode", async () => {
    createPollAction.mockResolvedValue({ ok: false, code: "slowmode", error: "Modo lento", slowmodeSeconds: 30 });
    const { user, onSlowmode, onPosted } = setup();
    await fill(user);
    await user.click(publish());
    await waitFor(() => expect(onSlowmode).toHaveBeenCalledWith(30));
    expect(onPosted).not.toHaveBeenCalled();
  });

  it("shows other errors in an alert", async () => {
    createPollAction.mockResolvedValue({ ok: false, code: "forbidden", error: "No tienes permiso." });
    const { user } = setup();
    await fill(user);
    await user.click(publish());
    expect(await screen.findByRole("alert")).toHaveTextContent("No tienes permiso.");
  });
});
