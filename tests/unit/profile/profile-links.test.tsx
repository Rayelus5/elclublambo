import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProfileLinks } from "@/components/profile/profile-links";

const ALLOWED = ["github.com"];

describe("ProfileLinks", () => {
  it("renders an allowed-domain link directly", () => {
    render(<ProfileLinks links={["https://github.com/ana"]} allowedDomains={ALLOWED} />);
    const a = screen.getByRole("link", { name: /github\.com\/ana/ });
    expect(a.getAttribute("href")).toBe("https://github.com/ana");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer nofollow ugc");
    expect(a.getAttribute("target")).toBe("_blank");
  });

  it("sends any other domain through /out", () => {
    render(<ProfileLinks links={["https://example.org/x"]} allowedDomains={ALLOWED} />);
    const a = screen.getByRole("link", { name: /example\.org/ });
    expect(a.getAttribute("href")).toBe(`/out?u=${encodeURIComponent("https://example.org/x")}`);
    expect(a.getAttribute("rel")).toBe("noopener noreferrer nofollow ugc");
  });

  it("warns about punycode hosts and still guards them", () => {
    render(<ProfileLinks links={["https://xn--80ak6aa92e.com/"]} allowedDomains={ALLOWED} />);
    expect(screen.getByText(/caracteres internacionales/i)).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")!.startsWith("/out?u=")).toBe(true);
  });

  it("never renders non-https or malformed entries as links", () => {
    render(<ProfileLinks links={["javascript:alert(1)", "http://x.com", "nope"]} allowedDomains={ALLOWED} />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
