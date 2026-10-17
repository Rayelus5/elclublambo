import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const report = vi.hoisted(() => vi.fn(async (): Promise<{ error?: string }> => ({})));
vi.mock("@/lib/reports/actions", () => ({ reportMessageAction: report }));

import { ReportDialog } from "@/components/reports/report-dialog";

const MSG = "11111111-1111-4111-8111-111111111111";

function setup() {
  const onOpenChange = vi.fn();
  render(<ReportDialog messageId={MSG} open onOpenChange={onOpenChange} />);
  return { onOpenChange };
}

let user: ReturnType<typeof userEvent.setup>;
beforeEach(() => {
  user = userEvent.setup();
  report.mockReset().mockResolvedValue({});
});

describe("ReportDialog", () => {
  it("offers the four reasons as radios and an optional note", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Reportar mensaje" })).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(["scam", "spam", "abuse", "other"]);
    expect(screen.getByLabelText(/Nota/)).toBeInTheDocument();
  });

  it("requires a reason before sending", async () => {
    setup();
    await user.click(screen.getByRole("button", { name: "Enviar reporte" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Elige un motivo.");
    expect(report).not.toHaveBeenCalled();
  });

  it("rejects a note over 500 characters (and the counter shows it)", async () => {
    setup();
    await user.click(screen.getByRole("radio", { name: /Spam/ }));
    const note = screen.getByLabelText(/Nota/) as HTMLTextAreaElement;
    // maxLength is not enforced by paste in jsdom: use fireEvent-like value set through the user API
    await user.click(note);
    await user.paste("x".repeat(501));
    expect(screen.getByText("501/500")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Enviar reporte" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/500 caracteres/);
    expect(report).not.toHaveBeenCalled();
  });

  it("the counter uses the trimmed length, like the validation", async () => {
    setup();
    await user.click(screen.getByRole("radio", { name: /Spam/ }));
    await user.click(screen.getByLabelText(/Nota/));
    await user.paste("  " + "x".repeat(500) + "  ");
    expect(screen.getByText("500/500")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Enviar reporte" }));
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("sends reason and trimmed note, then confirms", async () => {
    setup();
    await user.click(screen.getByRole("radio", { name: /Estafa/ }));
    await user.type(screen.getByLabelText(/Nota/), "  enlace sospechoso ");
    await user.click(screen.getByRole("button", { name: "Enviar reporte" }));
    expect(report).toHaveBeenCalledWith(MSG, "scam", "enlace sospechoso");
    expect(await screen.findByText(/Gracias/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enviar reporte" })).toBeNull();
  });

  it("sends a null note when it is empty", async () => {
    setup();
    await user.click(screen.getByRole("radio", { name: /Otro/ }));
    await user.click(screen.getByRole("button", { name: "Enviar reporte" }));
    expect(report).toHaveBeenCalledWith(MSG, "other", null);
  });

  it.each([
    ["already_reported", /Ya has reportado/],
    ["rate_limited", /demasiadas acciones/],
    ["forbidden", /No tienes permiso/],
  ])("shows the copy for %s and stays open", async (code, copy) => {
    report.mockResolvedValueOnce({ error: code });
    setup();
    await user.click(screen.getByRole("radio", { name: /Spam/ }));
    await user.click(screen.getByRole("button", { name: "Enviar reporte" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(copy);
    await waitFor(() => expect(screen.getByRole("button", { name: "Enviar reporte" })).toBeEnabled());
  });

  it("never shows the error next to a still-pending (Enviando…) button", async () => {
    report.mockResolvedValueOnce({ error: "forbidden" });
    setup();
    let inconsistent = false;
    const obs = new MutationObserver(() => {
      if (screen.queryByRole("alert") && screen.queryByRole("button", { name: "Enviando…" })) inconsistent = true;
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    await user.click(screen.getByRole("radio", { name: /Spam/ }));
    await user.click(screen.getByRole("button", { name: "Enviar reporte" }));
    await screen.findByRole("alert");
    await waitFor(() => expect(screen.getByRole("button", { name: "Enviar reporte" })).toBeEnabled());
    obs.disconnect();
    expect(inconsistent).toBe(false);
  });

  it("shows a generic error when the action throws", async () => {
    report.mockRejectedValueOnce(new Error("net"));
    setup();
    await user.click(screen.getByRole("radio", { name: /Spam/ }));
    await user.click(screen.getByRole("button", { name: "Enviar reporte" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Algo falló/);
  });

  it("cancel closes without sending", async () => {
    const { onOpenChange } = setup();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(report).not.toHaveBeenCalled();
  });
});
