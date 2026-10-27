import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
const session = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/public-session", () => ({ getPublicSession: session }));
const getMyPublicProfile = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pay/queries", () => ({ getMyPublicProfile }));
vi.mock("@/components/pay/profile-form", () => ({
  ProfileForm: (p: { initial: { acceptNetworks: string[] } | null }) => <div data-testid="profile-form" data-networks={p.initial?.acceptNetworks.join(",") ?? ""} />,
}));
vi.mock("@/components/pay/link-builder", () => ({ LinkBuilder: () => <div data-testid="link-builder" /> }));
vi.mock("@/components/pay/embed-snippet", () => ({ EmbedSnippet: () => <div data-testid="embed" /> }));
vi.mock("@/components/public/public-connect-lazy", () => ({ PublicConnectLazy: () => <div data-testid="public-connect" /> }));

import { PayToolGate } from "@/components/pay/pay-tool-gate";
import { getDictionary } from "@/lib/i18n";

const es = getDictionary("es").pay.tool;
const en = getDictionary("en").pay.tool;

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue({ userId: "u1", wallet: "0x1111111111111111111111111111111111111111", isMember: false });
});

describe("PayToolGate", () => {
  it("a failed profile read shows a retry state, never the form (D22: no empty form defaulting to every network)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getMyPublicProfile.mockRejectedValue(new Error("db down"));
    render(await PayToolGate({ lang: "es" }));
    expect(screen.getByRole("alert")).toHaveTextContent(es.loadFailed);
    expect(screen.getByRole("link", { name: es.retry }).getAttribute("href")).toBe("/herramientas/pay");
    expect(screen.queryByTestId("profile-form")).not.toBeInTheDocument();
    expect(screen.queryByTestId("link-builder")).not.toBeInTheDocument();
  });

  it("the retry state is localised", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getMyPublicProfile.mockRejectedValue(new Error("db down"));
    render(await PayToolGate({ lang: "en" }));
    expect(screen.getByRole("alert")).toHaveTextContent(en.loadFailed);
    expect(screen.getByRole("link", { name: en.retry }).getAttribute("href")).toBe("/en/tools/pay");
  });

  it("with a profile: the form with its saved networks, the link and the button", async () => {
    getMyPublicProfile.mockResolvedValue({ alias: "rayelus", displayName: null, address: "0x1", acceptNetworks: ["base"], showMemberBadge: false });
    render(await PayToolGate({ lang: "es" }));
    expect(screen.getByTestId("profile-form").dataset.networks).toBe("base");
    expect(screen.getByTestId("link-builder")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("no profile yet: the empty form, no link", async () => {
    getMyPublicProfile.mockResolvedValue(null);
    render(await PayToolGate({ lang: "es" }));
    expect(screen.getByTestId("profile-form")).toBeInTheDocument();
    expect(screen.queryByTestId("link-builder")).not.toBeInTheDocument();
  });

  it("without a session: the connect button", async () => {
    session.mockResolvedValue(null);
    render(await PayToolGate({ lang: "es" }));
    expect(screen.getByTestId("public-connect")).toBeInTheDocument();
    expect(getMyPublicProfile).not.toHaveBeenCalled();
  });
});
