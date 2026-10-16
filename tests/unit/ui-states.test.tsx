import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Checkbox } from "@/components/ui/checkbox";

describe("shadcn state variants", () => {
  it("checkbox exposes Radix data-state and the data-checked utilities", () => {
    render(<Checkbox checked aria-label="acepto" />);
    const box = screen.getByRole("checkbox", { name: "acepto" });
    expect(box).toHaveAttribute("data-state", "checked");
    expect(box.className).toContain("data-checked:bg-primary");
  });

  it("globals.css imports shadcn/tailwind.css, which defines the data-* custom variants", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toContain('@import "shadcn/tailwind.css"');
    const variants = readFileSync(
      join(process.cwd(), "node_modules/shadcn/dist/tailwind.css"),
      "utf8",
    );
    for (const v of ["data-open", "data-closed", "data-checked"]) {
      expect(variants).toContain(`@custom-variant ${v}`);
    }
  });
});
