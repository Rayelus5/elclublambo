import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  save: vi.fn(async (): Promise<{ error?: string }> => ({})),
  del: vi.fn(async (): Promise<{ error?: string }> => ({})),
}));
vi.mock("@/lib/notifications/actions", () => ({
  savePushSubscriptionAction: h.save,
  deletePushSubscriptionAction: h.del,
}));

import { PushToggle } from "@/components/notifications/push-toggle";

const KEY = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";

function fakeSupport(opts: { permission?: NotificationPermission; subscribed?: boolean; request?: NotificationPermission }) {
  const sub = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "pk", auth: "ak" } }),
    unsubscribe: vi.fn(async () => true),
  };
  const pushManager = {
    getSubscription: vi.fn(async () => (opts.subscribed ? sub : null)),
    subscribe: vi.fn(async () => sub),
  };
  const registration = { pushManager };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register: vi.fn(async () => registration), ready: Promise.resolve(registration), getRegistration: vi.fn(async () => registration) },
  });
  vi.stubGlobal("PushManager", class {});
  const requestPermission = vi.fn(async () => opts.request ?? "granted");
  vi.stubGlobal("Notification", { permission: opts.permission ?? "default", requestPermission });
  return { sub, pushManager, requestPermission };
}

function removeSupport() {
  Reflect.deleteProperty(navigator, "serviceWorker");
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  vi.unstubAllGlobals();
  removeSupport();
});

describe("PushToggle", () => {
  it("renders nothing without the public key", async () => {
    fakeSupport({});
    const { container } = render(<PushToggle publicKey={undefined} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("renders nothing without browser support", async () => {
    removeSupport();
    const { container } = render(<PushToggle publicKey={KEY} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("asks permission only on click, subscribes with userVisibleOnly and saves", async () => {
    const f = fakeSupport({});
    render(<PushToggle publicKey={KEY} />);
    const btn = await screen.findByRole("button", { name: "Activar avisos en este dispositivo" });
    expect(f.requestPermission).not.toHaveBeenCalled();
    await userEvent.click(btn);
    expect(f.requestPermission).toHaveBeenCalledTimes(1);
    expect(f.pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) }),
    );
    expect(h.save).toHaveBeenCalledWith({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      keys: { p256dh: "pk", auth: "ak" },
    });
    expect(await screen.findByRole("button", { name: "Desactivar avisos en este dispositivo" })).toBeInTheDocument();
  });

  it("does not subscribe when the user declines", async () => {
    const f = fakeSupport({ request: "denied" });
    render(<PushToggle publicKey={KEY} />);
    await userEvent.click(await screen.findByRole("button", { name: "Activar avisos en este dispositivo" }));
    expect(f.pushManager.subscribe).not.toHaveBeenCalled();
    expect(h.save).not.toHaveBeenCalled();
  });

  it("explains how to re-enable when permission is denied", async () => {
    fakeSupport({ permission: "denied" });
    render(<PushToggle publicKey={KEY} />);
    expect(await screen.findByText(/bloqueado los avisos/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("unsubscribes and deletes the server row", async () => {
    const f = fakeSupport({ permission: "granted", subscribed: true });
    render(<PushToggle publicKey={KEY} />);
    await userEvent.click(await screen.findByRole("button", { name: "Desactivar avisos en este dispositivo" }));
    expect(h.del).toHaveBeenCalledWith("https://fcm.googleapis.com/fcm/send/abc");
    expect(f.sub.unsubscribe).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Activar avisos en este dispositivo" })).toBeInTheDocument();
  });

  it("surfaces a server delete error and keeps the browser subscription so it can be retried", async () => {
    h.del.mockResolvedValueOnce({ error: "forbidden" });
    const f = fakeSupport({ permission: "granted", subscribed: true });
    render(<PushToggle publicKey={KEY} />);
    await userEvent.click(await screen.findByRole("button", { name: "Desactivar avisos en este dispositivo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/No se pudieron desactivar/);
    expect(f.sub.unsubscribe).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Desactivar avisos en este dispositivo" })).toBeEnabled();
  });

  it("re-saves an existing browser subscription on load so the server row exists", async () => {
    fakeSupport({ permission: "granted", subscribed: true });
    render(<PushToggle publicKey={KEY} />);
    await screen.findByRole("button", { name: "Desactivar avisos en este dispositivo" });
    await waitFor(() =>
      expect(h.save).toHaveBeenCalledWith({
        endpoint: "https://fcm.googleapis.com/fcm/send/abc",
        keys: { p256dh: "pk", auth: "ak" },
      }),
    );
    expect(h.save).toHaveBeenCalledTimes(1);
  });

  it("does not save anything on load without a browser subscription", async () => {
    fakeSupport({ permission: "granted", subscribed: false });
    render(<PushToggle publicKey={KEY} />);
    await screen.findByRole("button", { name: "Activar avisos en este dispositivo" });
    expect(h.save).not.toHaveBeenCalled();
  });
});
