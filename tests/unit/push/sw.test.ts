import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// public/sw.js is a plain script: run it against a fake ServiceWorkerGlobalScope.
function loadSw() {
  const handlers = new Map<string, (e: unknown) => void>();
  const showNotification = vi.fn(async () => {});
  const self = {
    location: { origin: "https://club.example" },
    registration: { showNotification },
    clients: { claim: vi.fn(), matchAll: vi.fn(async () => []), openWindow: vi.fn(async () => {}) },
    skipWaiting: vi.fn(),
    addEventListener: (name: string, fn: (e: unknown) => void) => handlers.set(name, fn),
  };
  const code = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
  new Function("self", code)(self);
  const push = (data: { json: () => unknown } | null) => {
    const waits: Promise<unknown>[] = [];
    handlers.get("push")!({ data, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    return Promise.all(waits);
  };
  return { showNotification, push };
}

describe("public/sw.js push handler", () => {
  it("shows the payload", async () => {
    const { push, showNotification } = loadSw();
    await push({ json: () => ({ title: "T", body: "B", url: "/c/1", tag: "x" }) });
    expect(showNotification).toHaveBeenCalledWith("T", expect.objectContaining({ body: "B", data: { url: "https://club.example/c/1" } }));
  });

  it.each([null, 42, "texto", true])("tolerates a non-object JSON payload (%j)", async (value) => {
    const { push, showNotification } = loadSw();
    await push({ json: () => value });
    expect(showNotification).toHaveBeenCalledWith("El Club Lambo", expect.objectContaining({ body: "", data: { url: "https://club.example/" } }));
  });

  it("tolerates missing data and unparsable JSON", async () => {
    const a = loadSw();
    await a.push(null);
    expect(a.showNotification).toHaveBeenCalledTimes(1);
    const b = loadSw();
    await b.push({
      json: () => {
        throw new Error("bad");
      },
    });
    expect(b.showNotification).toHaveBeenCalledTimes(1);
  });

  it("falls back to home for a cross-origin url", async () => {
    const { push, showNotification } = loadSw();
    await push({ json: () => ({ url: "https://evil.example/x" }) });
    expect(showNotification).toHaveBeenCalledWith("El Club Lambo", expect.objectContaining({ data: { url: "https://club.example/" } }));
  });
});
