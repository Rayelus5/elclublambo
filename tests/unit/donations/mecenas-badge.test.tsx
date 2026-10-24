import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MecenasBadge } from "@/components/donations/mecenas-badge";

describe("MecenasBadge", () => {
  it("is a chip that reads «Mecenas»", () => {
    render(<MecenasBadge />);
    expect(screen.getByText("Mecenas")).toBeInTheDocument();
  });
});
