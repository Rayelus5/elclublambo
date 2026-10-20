import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarketRow } from "@/components/market/market-row";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

// The row is the big touch target; the name link stays the one keyboard/screen-reader affordance (T-003 review).
function renderRow() {
  render(
    <table>
      <tbody>
        <MarketRow href="/mercado/bitcoin">
          <td>
            {/* A plain anchor stands in for the next/link in the real name cell. */}
            <a href="#bitcoin">Bitcoin</a>
          </td>
          <td data-testid="price">67.234,56 USD</td>
          <td>
            <button type="button">Otra acción</button>
          </td>
        </MarketRow>
      </tbody>
    </table>,
  );
  return screen.getByRole("row");
}

describe("MarketRow", () => {
  beforeEach(() => push.mockClear());
  afterEach(() => vi.restoreAllMocks());

  it("opens the coin on a plain click anywhere in the row", () => {
    renderRow();
    fireEvent.click(screen.getByTestId("price"));
    expect(push).toHaveBeenCalledWith("/mercado/bitcoin");
  });

  it("leaves clicks on the real link and on other controls alone", () => {
    renderRow();
    fireEvent.click(screen.getByRole("link", { name: "Bitcoin" }));
    fireEvent.click(screen.getByRole("button", { name: "Otra acción" }));
    expect(push).not.toHaveBeenCalled();
  });

  it("ignores modifier and non-primary clicks", () => {
    renderRow();
    const price = screen.getByTestId("price");
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) fireEvent.click(price, init);
    expect(push).not.toHaveBeenCalled();
  });

  it("ignores the click that ends a text selection", () => {
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "67.234", isCollapsed: false } as unknown as Selection);
    renderRow();
    fireEvent.click(screen.getByTestId("price"));
    expect(push).not.toHaveBeenCalled();
  });

  it("looks clickable, highlights on hover and press, and rings with an outline when its link has keyboard focus", () => {
    const row = renderRow();
    expect(row).toHaveClass("cursor-pointer", "hover:bg-surface-2", "active:bg-surface-2");
    // An outline (not a box-shadow ring) survives forced-colors mode.
    expect(row.className).toMatch(/has-\[a:focus-visible\]:outline-2/);
    expect(row.className).not.toMatch(/relative/);
  });
});
