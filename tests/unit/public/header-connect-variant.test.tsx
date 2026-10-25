import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const connect = vi.hoisted(() => vi.fn<(props: Record<string, unknown>) => null>(() => null));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/public/public-connect-lazy", () => ({ PublicConnectLazy: connect }));
vi.mock("wagmi", () => ({ useDisconnect: () => ({ disconnect: vi.fn() }) }));

import { PublicHeader } from "@/components/public/public-header";

// R2: one Base Blue fill per screen. The header's connect button is a secondary action (outline); the page's own call to
// action, when it has one, is the screen's only brand fill.
describe("PublicHeader connect button", () => {
  it("asks for the outline variant, so it never competes with the page's brand fill", () => {
    render(<PublicHeader lang="es" session={null} />);
    expect(connect).toHaveBeenCalled();
    expect(connect.mock.calls[0]?.[0]).toMatchObject({ variant: "outline" });
  });
});
