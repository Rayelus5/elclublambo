import { render, screen, waitFor } from "@testing-library/react";
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
        "El voto es secreto: nadie, tampoco los admins, verá qué vota cada uno. Los resultados se publican al cerrar, si votan al menos 3 personas. La encuesta es consultiva: no ejecuta nada por sí sola.",
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

  it("offers the weight modes with their help and the few-voters warning (F4e-R3)", () => {
    setup();
    expect(screen.getByRole("radio", { name: "1 persona, 1 voto" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Lineal según participación" })).toHaveAccessibleDescription(
      "Cada voto pesa lo que sumaban tus participaciones sin bloquear al crear la encuesta.",
    );
    expect(screen.getByRole("radio", { name: "Cuadrática según participación" })).toHaveAccessibleDescription(
      "Cada voto pesa la raíz cuadrada de esas participaciones: quien más aportó pesa más, pero menos que en lineal.",
    );
    expect(screen.getByText(/Con pocos votantes, un voto ponderado puede delatar la participación de alguien/)).toBeInTheDocument();
    expect(screen.getByText(/al menos 5 votantes con participaciones \(en 1 persona, 1 voto: 3\)/)).toBeInTheDocument();
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
    await user.click(screen.getByRole("radio", { name: "Lineal según participación" }));
    const before = Date.now();
    await user.dblClick(publish());
    expect(createPollAction).toHaveBeenCalledTimes(1);
    const arg = createPollAction.mock.calls[0]![0];
    expect(arg).toMatchObject({ channelId: CH, question: "¿Dónde quedamos?", options: ["Madrid", "Lisboa"], weightMode: "linear" });
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
