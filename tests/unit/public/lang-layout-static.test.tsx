import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The public layout wraps every public page: a request-time read here (the session) made every page view, crawlers
// included, run a function. The header now resolves the session in the browser.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/public-session", () => ({
  getPublicSession: async () => {
    throw new Error("the public layout must not read the session on the server");
  },
}));
vi.mock("@/components/public/public-header-live", () => ({
  PublicHeaderLive: ({ lang }: { lang: string }) => <header data-testid="header">{lang}</header>,
}));
vi.mock("@/components/public/public-footer", () => ({ PublicFooter: () => null }));

import PublicLangLayout from "@/app/(public)/[lang]/layout";

describe("public [lang] layout", () => {
  it("renders the browser-resolved header and the page, without reading the session", async () => {
    const tree = await PublicLangLayout({ children: <p>page</p>, params: Promise.resolve({ lang: "en" }) } as never);
    render(tree);
    expect(screen.getByTestId("header")).toHaveTextContent("en");
    expect(screen.getByText("page")).toBeInTheDocument();
  });
});
