import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const saveProfileAction = vi.hoisted(() => vi.fn());
const setHandleAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/profile/actions", () => ({ saveProfileAction, setHandleAction }));

import { ProfileForm } from "@/components/profile/profile-form";

const base = { handle: "ana", displayName: "Ana", bio: "", links: [] as string[], handleNextChangeAt: null as string | null };

describe("ProfileForm", () => {
  beforeEach(() => {
    saveProfileAction.mockReset();
    setHandleAction.mockReset();
  });

  it("shows when the handle can be changed again while in cooldown", () => {
    const next = "2026-11-17T10:00:00.000Z";
    render(<ProfileForm {...base} handleNextChangeAt={next} />);
    const date = new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "UTC" }).format(new Date(next));
    expect(screen.getByText(`Podrás cambiarlo de nuevo el ${date}`)).toBeTruthy();
    expect((screen.getByLabelText("@handle") as HTMLInputElement).disabled).toBe(true);
  });

  it("counts the bio down from 280 and blocks at 281", () => {
    render(<ProfileForm {...base} />);
    expect(screen.getByText("280")).toBeTruthy();
    const bio = screen.getByLabelText("Bio");
    fireEvent.change(bio, { target: { value: "a".repeat(280) } });
    expect(screen.getByText("0")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Guardar perfil" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(bio, { target: { value: "a".repeat(281) } });
    expect(screen.getByText("-1")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Guardar perfil" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("counts the bio by code points, not UTF-16 units", () => {
    render(<ProfileForm {...base} />);
    fireEvent.change(screen.getByLabelText("Bio"), { target: { value: "😀".repeat(280) } });
    expect(screen.getByText("0")).toBeTruthy();
  });

  it("hides 'Añadir enlace' at 3 links", async () => {
    const user = userEvent.setup();
    render(<ProfileForm {...base} links={["https://a.com"]} />);
    await user.click(screen.getByRole("button", { name: "Añadir enlace" }));
    await user.click(screen.getByRole("button", { name: "Añadir enlace" }));
    expect(screen.queryByRole("button", { name: "Añadir enlace" })).toBeNull();
    expect(screen.getAllByLabelText(/^Enlace \d$/)).toHaveLength(3);
  });

  it("submits trimmed values and drops empty links", async () => {
    saveProfileAction.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<ProfileForm {...base} />);
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "  Ana Pérez  " } });
    fireEvent.change(screen.getByLabelText("Bio"), { target: { value: "  hola  " } });
    await user.click(screen.getByRole("button", { name: "Añadir enlace" }));
    await user.click(screen.getByRole("button", { name: "Añadir enlace" }));
    fireEvent.change(screen.getByLabelText("Enlace 1"), { target: { value: " https://a.com " } });
    await user.click(screen.getByRole("button", { name: "Guardar perfil" }));
    await waitFor(() => expect(saveProfileAction).toHaveBeenCalledTimes(1));
    expect(saveProfileAction).toHaveBeenCalledWith({ displayName: "Ana Pérez", bio: "hola", links: ["https://a.com"] });
  });

  it("shows the server error", async () => {
    saveProfileAction.mockResolvedValue({ ok: false, error: "Ese nombre ya está en uso" });
    const user = userEvent.setup();
    render(<ProfileForm {...base} />);
    await user.click(screen.getByRole("button", { name: "Guardar perfil" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Ese nombre ya está en uso");
  });

  it("changes the handle through setHandleAction", async () => {
    setHandleAction.mockResolvedValue({ ok: true, handle: "ray_l" });
    const user = userEvent.setup();
    render(<ProfileForm {...base} />);
    fireEvent.change(screen.getByLabelText("@handle"), { target: { value: "Ray_L" } });
    await user.click(screen.getByRole("button", { name: "Cambiar @handle" }));
    await waitFor(() => expect(setHandleAction).toHaveBeenCalledWith("Ray_L"));
  });
});
