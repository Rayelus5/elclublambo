import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));
const invalidateSiteState = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin/site-state", () => ({ invalidateSiteState }));

import {
  addAccessWalletAction,
  removeAccessWalletAction,
  setMaintenanceAction,
  setMaintenancePasswordAction,
  setSwitchAction,
} from "@/lib/admin/actions";

const WALLET = "0x1234567890abcdef1234567890abcdef1234abcd";

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ error: null });
});

describe("setSwitchAction", () => {
  it("rejects an unknown key without calling the RPC", async () => {
    expect(await setSwitchAction("nope" as never, false)).toEqual({ ok: false, error: "invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
    expect(invalidateSiteState).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean flag", async () => {
    expect(await setSwitchAction("gas", "no" as never)).toEqual({ ok: false, error: "invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls admin_set_switch, drops the site-state cache and revalidates the tab", async () => {
    expect(await setSwitchAction("gas", false)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("admin_set_switch", { p_key: "gas", p_enabled: false });
    expect(invalidateSiteState).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/foro/settings/administracion");
  });

  it("maps forbidden from the RPC and keeps the cache", async () => {
    rpc.mockResolvedValue({ error: { message: "forbidden" } });
    expect(await setSwitchAction("gas", false)).toEqual({ ok: false, error: "forbidden" });
    expect(invalidateSiteState).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("setMaintenanceAction", () => {
  it("default mode sends null in every other field", async () => {
    expect(
      await setMaintenanceAction({
        enabled: true,
        mode: "default",
        messageEs: "x",
        messageEn: "y",
        returnAt: "2030-01-01T00:00:00.000Z",
        startsAt: "2030-01-01T00:00:00.000Z",
        endsAt: "2030-01-02T00:00:00.000Z",
      }),
    ).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("admin_set_maintenance", {
      p_enabled: true,
      p_mode: "default",
      p_message_es: null,
      p_message_en: null,
      p_return_at: null,
      p_starts_at: null,
      p_ends_at: null,
    });
    expect(invalidateSiteState).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/foro/settings/administracion");
  });

  it("custom mode passes the messages and dates through", async () => {
    await setMaintenanceAction({
      enabled: false,
      mode: "custom",
      messageEs: "Hola",
      messageEn: "Hi",
      returnAt: null,
      startsAt: "2030-11-01T09:00:00.000Z",
      endsAt: "2030-11-01T11:00:00.000Z",
    });
    expect(rpc).toHaveBeenCalledWith("admin_set_maintenance", {
      p_enabled: false,
      p_mode: "custom",
      p_message_es: "Hola",
      p_message_en: "Hi",
      p_return_at: null,
      p_starts_at: "2030-11-01T09:00:00.000Z",
      p_ends_at: "2030-11-01T11:00:00.000Z",
    });
  });

  it.each([
    [{ enabled: "yes", mode: "default" }],
    [{ enabled: true, mode: "other" }],
    [{ enabled: true, mode: "custom", messageEs: 5, messageEn: "x" }],
    [{ enabled: true, mode: "custom", messageEs: "x", messageEn: "y", startsAt: "not a date" }],
    [{ enabled: true, mode: "custom", messageEs: "x".repeat(501), messageEn: "y" }],
    [null],
  ])("rejects a malformed input %j without calling the RPC", async (input) => {
    expect(await setMaintenanceAction(input as never)).toEqual({ ok: false, error: "invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps maintenance_invalid from the RPC", async () => {
    rpc.mockResolvedValue({ error: { message: "maintenance_invalid" } });
    expect(await setMaintenanceAction({ enabled: true, mode: "custom", messageEs: "", messageEn: "" })).toEqual({
      ok: false,
      error: "maintenance_invalid",
    });
  });
});

describe("setMaintenancePasswordAction", () => {
  it.each(["short", "x".repeat(11), "x".repeat(129)])("rejects %s with password_invalid without calling the RPC", async (p) => {
    expect(await setMaintenancePasswordAction(p)).toEqual({ ok: false, error: "password_invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a non-string", async () => {
    expect(await setMaintenancePasswordAction(123 as never)).toEqual({ ok: false, error: "password_invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("hashes the password with scrypt and never sends it in clear", async () => {
    const password = "correct horse battery";
    expect(await setMaintenancePasswordAction(password)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0]! as [string, { p_hash: string }];
    expect(fn).toBe("admin_set_maintenance_password");
    expect(Object.keys(args)).toEqual(["p_hash"]);
    expect(args.p_hash.startsWith("scrypt$")).toBe(true);
    expect(args.p_hash).not.toContain(password);
    expect(invalidateSiteState).toHaveBeenCalledTimes(1);
  });

  it("maps forbidden from the RPC", async () => {
    rpc.mockResolvedValue({ error: { message: "forbidden" } });
    expect(await setMaintenancePasswordAction("correct horse battery")).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("access list actions", () => {
  it("adds a wallet with its note", async () => {
    expect(await addAccessWalletAction(WALLET, "Ana — moderadora")).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("admin_add_access_wallet", { p_wallet: WALLET, p_note: "Ana — moderadora" });
    expect(invalidateSiteState).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/foro/settings/administracion");
  });

  it("rejects a malformed wallet as wallet_invalid without calling the RPC", async () => {
    expect(await addAccessWalletAction("0x12", "")).toEqual({ ok: false, error: "wallet_invalid" });
    expect(await removeAccessWalletAction("nope")).toEqual({ ok: false, error: "wallet_invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a non-string note or one over 80 characters", async () => {
    expect(await addAccessWalletAction(WALLET, 5 as never)).toEqual({ ok: false, error: "invalid_input" });
    expect(await addAccessWalletAction(WALLET, "x".repeat(81))).toEqual({ ok: false, error: "note_invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("removes a wallet", async () => {
    expect(await removeAccessWalletAction(WALLET)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("admin_remove_access_wallet", { p_wallet: WALLET });
    expect(invalidateSiteState).toHaveBeenCalledTimes(1);
  });

  it("maps forbidden from the RPC", async () => {
    rpc.mockResolvedValue({ error: { message: "forbidden" } });
    expect(await removeAccessWalletAction(WALLET)).toEqual({ ok: false, error: "forbidden" });
  });
});
