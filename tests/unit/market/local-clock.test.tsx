// The viewer is in New York here (not UTC), so a server-zone time would be visibly wrong. Set before any import.
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.TZ = "America/New_York";
});

import { act, render } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { LocalClock } from "@/components/market/local-clock";
import { MarketStatus } from "@/components/market/market-status";

const AT = "2026-10-18T10:05:00.000Z"; // 06:05 in New York (EDT)

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LocalClock", () => {
  it("server output is stable (UTC) with a machine-readable dateTime", () => {
    const html = renderToString(<LocalClock iso={AT} />);
    expect(html).toContain(`dateTime="${AT}"`);
    expect(html).toContain(">10:05<");
  });

  it("renders HH:MM in the viewer's time zone on the client", () => {
    const { container } = render(<LocalClock iso={AT} />);
    const time = container.querySelector("time")!;
    expect(time).toHaveAttribute("dateTime", AT);
    expect(time).toHaveTextContent(/^06:05$/);
  });

  it("hydrates the server HTML without a mismatch and then shows the viewer's time", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const host = document.createElement("div");
    host.innerHTML = renderToString(<LocalClock iso={AT} />);
    document.body.appendChild(host);
    await act(async () => {
      hydrateRoot(host, <LocalClock iso={AT} />);
    });
    expect(host.querySelector("time")).toHaveTextContent(/^06:05$/);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("an invalid date renders a dash, never 'Invalid Date'", () => {
    const { container } = render(<LocalClock iso="nope" />);
    expect(container).toHaveTextContent("—");
  });

  it("MarketStatus uses it for both the fresh and the stale copy", () => {
    const fresh = render(<MarketStatus fetchedAt={AT} stale={false} />);
    expect(fresh.container).toHaveTextContent("Actualizado a las 06:05");
    expect(fresh.container.querySelector(`time[datetime="${AT}"]`)).not.toBeNull();
    fresh.unmount();
    const stale = render(<MarketStatus fetchedAt={AT} stale />);
    expect(stale.container).toHaveTextContent("No se pudo actualizar. Datos de las 06:05.");
  });
});
