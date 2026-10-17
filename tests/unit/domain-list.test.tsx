import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
const addDomainAction = vi.hoisted(() => vi.fn());
const removeDomainAction = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/domains/actions", () => ({ addDomainAction, removeDomainAction }));

import { DomainList } from "@/components/settings/domain-list";

beforeEach(() => {
  refresh.mockReset();
  addDomainAction.mockReset().mockResolvedValue({});
  removeDomainAction.mockReset().mockResolvedValue({});
});

describe("DomainList", () => {
  it("lists domains", () => {
    render(<DomainList domains={["github.com", "x.com"]} />);
    expect(screen.getByText("github.com")).toBeInTheDocument();
    expect(screen.getByText("x.com")).toBeInTheDocument();
  });

  it("rejects invalid format client-side", async () => {
    const user = userEvent.setup();
    render(<DomainList domains={[]} />);
    await user.type(screen.getByLabelText("Dominio"), "https://foo");
    await user.click(screen.getByRole("button", { name: "Añadir" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(addDomainAction).not.toHaveBeenCalled();
  });

  it("trims and lowercases before adding", async () => {
    const user = userEvent.setup();
    render(<DomainList domains={[]} />);
    await user.type(screen.getByLabelText("Dominio"), "  Example.COM ");
    await user.click(screen.getByRole("button", { name: "Añadir" }));
    await waitFor(() => expect(addDomainAction).toHaveBeenCalledWith("example.com"));
    expect(refresh).toHaveBeenCalled();
  });

  it("removes after confirmation", async () => {
    const user = userEvent.setup();
    render(<DomainList domains={["x.com"]} />);
    await user.click(screen.getByRole("button", { name: "Quitar x.com" }));
    expect(removeDomainAction).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: "Quitar" }));
    await waitFor(() => expect(removeDomainAction).toHaveBeenCalledWith("x.com"));
  });
});
