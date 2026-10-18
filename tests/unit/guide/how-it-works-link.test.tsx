import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HowItWorksLink } from "@/components/guide/how-it-works-link";

describe("HowItWorksLink", () => {
  it("links to the section in the same tab with a descriptive name", () => {
    render(<HowItWorksLink section="dao" />);
    const link = screen.getByRole("link", { name: "¿Cómo funciona? Guía: DAO y shares" });
    expect(link).toHaveAttribute("href", "/guia/dao");
    expect(link).not.toHaveAttribute("target");
    expect(link).toHaveTextContent("¿Cómo funciona?");
  });
});
