import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const connection = vi.hoisted(() => vi.fn(async () => void calls.push("connection")));
vi.mock("next/server", () => ({ connection }));
const getSiteState = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin/site-state", () => ({ getSiteState: (...a: unknown[]) => (calls.push("getSiteState"), getSiteState(...a)) }));
// The panel is tested on its own (team-access.test.tsx); here only its closed state matters.
vi.mock("@/components/status/team-access-sign", () => ({ TeamAccessSign: () => null }));

import { MaintenanceContent } from "@/components/status/maintenance-content";
import { UnavailableContent } from "@/components/status/unavailable-content";
import * as maintenancePage from "@/app/status/[lang]/maintenance/page";
import * as unavailablePage from "@/app/status/[lang]/unavailable/page";
import { getDictionary } from "@/lib/i18n";
import { OPEN_STATE, type MaintenanceConfig } from "@/lib/admin/state";

const es = getDictionary("es").status;
const en = getDictionary("en").status;
const RETURN_AT = "2026-10-27T15:30:00.000Z";

function withMaintenance(m: Partial<MaintenanceConfig>) {
  getSiteState.mockResolvedValue({ ...OPEN_STATE, maintenance: { ...OPEN_STATE.maintenance, enabled: true, ...m } });
}

const fills = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("*")].filter((el) => el.className.toString().split(/\s+/).includes("bg-accent-fill"));

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  withMaintenance({});
});

describe("maintenance page", () => {
  it("default in ES: title and text, read only after connection()", async () => {
    render(await MaintenanceContent({ lang: "es" }));
    expect(screen.getByRole("heading", { level: 1, name: es.maintenanceTitle })).toBeInTheDocument();
    expect(screen.getByText(es.maintenanceText)).toBeInTheDocument();
    expect(screen.getByText("503")).toBeInTheDocument();
    expect(calls).toEqual(["connection", "getSiteState"]);
  });

  it("default in EN has no Spanish strings and marks the language", async () => {
    const { container } = render(await MaintenanceContent({ lang: "en" }));
    expect(screen.getByRole("heading", { level: 1, name: en.maintenanceTitle })).toBeInTheDocument();
    expect(screen.getByText(en.maintenanceText)).toBeInTheDocument();
    expect(container.textContent).not.toContain(es.maintenanceTitle);
    expect(container.textContent).not.toContain(es.teamAccess);
    expect(container.querySelector("main")?.getAttribute("lang")).toBe("en");
  });

  it("custom: shows messageEn in EN (line breaks kept) and the estimated return as a <time>", async () => {
    withMaintenance({ mode: "custom", messageEs: "Volvemos pronto", messageEn: "Upgrading the vaults.\nBack soon.", returnAt: RETURN_AT });
    const { container } = render(await MaintenanceContent({ lang: "en" }));
    const msg = screen.getByText(/Upgrading the vaults\./);
    expect(msg.textContent).toBe("Upgrading the vaults.\nBack soon.");
    expect(msg.className).toContain("whitespace-pre-line");
    expect(screen.queryByText(en.maintenanceText)).not.toBeInTheDocument();
    const line = screen.getByText(/Estimated return:/);
    const time = line.querySelector("time");
    expect(time?.getAttribute("dateTime")).toBe(RETURN_AT);
    expect(container.textContent).not.toContain("Volvemos pronto");
  });

  it("custom in ES shows messageEs", async () => {
    withMaintenance({ mode: "custom", messageEs: "Cambiando las tuberías.", messageEn: "Changing pipes." });
    render(await MaintenanceContent({ lang: "es" }));
    expect(screen.getByText("Cambiando las tuberías.")).toBeInTheDocument();
    expect(screen.queryByText(/Vuelta estimada/)).not.toBeInTheDocument();
  });

  it("no brand fill before «Acceso del equipo» is opened, and the team button is there", async () => {
    const { container } = render(await MaintenanceContent({ lang: "es" }));
    expect(fills(container)).toHaveLength(0);
    expect(screen.getByRole("button", { name: es.teamAccess })).toBeInTheDocument();
  });

  it("metadata: noindex, es/en params, not instant", async () => {
    const meta = await maintenancePage.generateMetadata({ params: Promise.resolve({ lang: "en" }) } as never);
    expect((meta.robots as { index: boolean }).index).toBe(false);
    expect(String(meta.title)).toContain(en.maintenanceTitle);
    expect(maintenancePage.generateStaticParams()).toEqual([{ lang: "es" }, { lang: "en" }]);
    expect(maintenancePage.instant).toBe(false);
  });
});

describe("unavailable page", () => {
  it.each([
    ["es", "/herramientas", es],
    ["en", "/en/tools", en],
  ] as const)("%s: title, text, seeTools → %s as the only fill; rendered at request time", async (lang, href, t) => {
    const { container } = render(await UnavailableContent({ lang }));
    expect(screen.getByRole("heading", { level: 1, name: t.unavailableTitle })).toBeInTheDocument();
    expect(screen.getByText(t.unavailableText)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: t.seeTools })).toHaveAttribute("href", href);
    expect(fills(container)).toHaveLength(1);
    expect(connection).toHaveBeenCalled();
  });

  it("metadata: noindex", async () => {
    const meta = await unavailablePage.generateMetadata({ params: Promise.resolve({ lang: "es" }) } as never);
    expect((meta.robots as { index: boolean }).index).toBe(false);
    expect(unavailablePage.generateStaticParams()).toEqual([{ lang: "es" }, { lang: "en" }]);
  });
});

describe("status pages are rendered per request (never a cacheable prerender)", () => {
  it.each([
    ["maintenance", maintenancePage.default],
    ["unavailable", unavailablePage.default],
  ] as const)("%s awaits connection() before it renders anything", async (_name, Page) => {
    let connected = false;
    connection.mockImplementationOnce(async () => {
      await Promise.resolve();
      connected = true;
    });
    const el = await Page({ params: Promise.resolve({ lang: "es" }) } as never);
    expect(connected).toBe(true);
    expect(el).toBeTruthy();
  });
});
