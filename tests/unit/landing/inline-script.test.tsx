import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InlineScript } from "@/components/landing/inline-script";

afterEach(() => vi.restoreAllMocks());

describe("InlineScript", () => {
  // The intro's boot script lives in the [lang] layout. A client navigation into the public tree (/foro → /) renders
  // that layout on the client, where React creates the <script> and, in development, logs «Encountered a script tag…».
  // Pattern from the Next docs (Preventing flash before hydration): executable on the server, a data block on the client.
  it("renders an inert data block on the client, without React's script-tag console.error", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(<InlineScript html="window.__ran = true" />);
    const script = container.querySelector("script");
    expect(script).not.toBeNull();
    expect(script).toHaveAttribute("type", "text/plain");
    expect(script?.innerHTML).toBe("window.__ran = true");
    expect(error).not.toHaveBeenCalled();
  });

  it("is a Client Component, so the client (not the server's RSC payload) decides its type", () => {
    const src = readFileSync(join(process.cwd(), "src/components/landing/inline-script.tsx"), "utf8");
    expect(src.trimStart().startsWith('"use client";')).toBe(true);
  });
});
