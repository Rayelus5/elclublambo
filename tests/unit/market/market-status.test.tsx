import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarketStatus } from "@/components/market/market-status";
import { formatTime } from "@/lib/market/format";

const AT = "2026-10-18T10:05:00.000Z";

describe("MarketStatus", () => {
  it("fresh: Actualizado a las HH:MM, no alert", () => {
    const { container } = render(<MarketStatus fetchedAt={AT} stale={false} />);
    // The time is a <time> element inside the sentence (LocalClock, viewer's zone).
    expect(container.querySelector("p")).toHaveTextContent(`Actualizado a las ${formatTime(AT)}`);
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("stale: status role with the copy time", () => {
    render(<MarketStatus fetchedAt={AT} stale />);
    expect(screen.getByRole("status")).toHaveTextContent(`No se pudo actualizar. Datos de las ${formatTime(AT)}.`);
  });
  it("always attributes CoinGecko with a safe external link", () => {
    render(<MarketStatus fetchedAt={AT} stale={false} />);
    const a = screen.getByRole("link", { name: "Datos de CoinGecko" });
    expect(a).toHaveAttribute("href", "https://www.coingecko.com");
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noopener noreferrer");
  });
});
