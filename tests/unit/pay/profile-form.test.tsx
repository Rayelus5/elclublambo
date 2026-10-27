import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const savePublicProfileAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pay/actions", () => ({ savePublicProfileAction }));

import { ProfileForm } from "@/components/pay/profile-form";
import { getDictionary } from "@/lib/i18n";

const en = getDictionary("en").pay.tool;
const es = getDictionary("es").pay.tool;
const PROFILE = {
  alias: "rayelus",
  displayName: null,
  address: "0x1111111111111111111111111111111111111111",
  acceptNetworks: ["base", "arbitrum"] as ("base" | "arbitrum")[],
  showMemberBadge: false,
};

function setup(props: Partial<React.ComponentProps<typeof ProfileForm>> = {}) {
  return render(<ProfileForm lang="en" t={en} initial={null} isMember={false} {...props} />);
}

beforeEach(() => {
  refresh.mockReset();
  savePublicProfileAction.mockReset().mockResolvedValue({ ok: true, profile: PROFILE });
});

describe("ProfileForm", () => {
  it("shows the labels, the exchange/smart-wallet warning and the public address notice", () => {
    setup();
    expect(screen.getByLabelText(en.aliasLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(en.displayNameLabel)).toBeInTheDocument();
    expect(screen.getByText(en.networksHint)).toBeInTheDocument();
    expect(screen.getByText(en.addressNotice)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Base/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Arbitrum/ })).toBeChecked();
  });

  it("shows the Spanish copy with lang=es", () => {
    render(<ProfileForm lang="es" t={es} initial={null} isMember={false} />);
    expect(screen.getByLabelText(es.aliasLabel)).toBeInTheDocument();
    expect(screen.queryByLabelText(en.aliasLabel)).not.toBeInTheDocument();
  });

  it("hides the member badge toggle unless the viewer is a member", () => {
    const { unmount } = setup({ isMember: false });
    expect(screen.queryByLabelText(en.badgeLabel)).not.toBeInTheDocument();
    unmount();
    setup({ isMember: true });
    expect(screen.getByLabelText(en.badgeLabel)).toBeInTheDocument();
  });

  it("prefills from the saved profile", () => {
    setup({ initial: { ...PROFILE, displayName: "Rayelus", acceptNetworks: ["base"] } });
    expect(screen.getByLabelText(en.aliasLabel)).toHaveValue("rayelus");
    expect(screen.getByLabelText(en.displayNameLabel)).toHaveValue("Rayelus");
    expect(screen.getByRole("checkbox", { name: /Arbitrum/ })).not.toBeChecked();
  });

  it("saves the normalised input, refreshes and confirms", async () => {
    setup();
    await userEvent.type(screen.getByLabelText(en.aliasLabel), "Rayelus");
    await userEvent.click(screen.getByRole("button", { name: en.save }));
    await waitFor(() =>
      expect(savePublicProfileAction).toHaveBeenCalledWith({ alias: "rayelus", displayName: "", acceptNetworks: ["base", "arbitrum"], showMemberBadge: false }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(await screen.findByText(en.saved)).toBeInTheDocument();
  });

  it("alias_taken is shown next to the alias field", async () => {
    savePublicProfileAction.mockResolvedValue({ ok: false, error: "alias_taken" });
    setup();
    await userEvent.type(screen.getByLabelText(en.aliasLabel), "rayelus");
    await userEvent.click(screen.getByRole("button", { name: en.save }));
    const err = await screen.findByText(en.errors.alias_taken);
    const field = screen.getByLabelText(en.aliasLabel);
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field.getAttribute("aria-describedby")).toContain(err.id);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("rejects a malformed alias before sending, next to the field", async () => {
    setup();
    await userEvent.type(screen.getByLabelText(en.aliasLabel), "a!");
    await userEvent.click(screen.getByRole("button", { name: en.save }));
    expect(await screen.findByText(en.errors.alias_invalid)).toBeInTheDocument();
    expect(savePublicProfileAction).not.toHaveBeenCalled();
  });

  it("needs at least one network", async () => {
    setup();
    await userEvent.type(screen.getByLabelText(en.aliasLabel), "rayelus");
    await userEvent.click(screen.getByRole("checkbox", { name: /Base/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Arbitrum/ }));
    await userEvent.click(screen.getByRole("button", { name: en.save }));
    expect(await screen.findByText(en.errors.networks_invalid)).toBeInTheDocument();
    expect(savePublicProfileAction).not.toHaveBeenCalled();
  });

  it("a rate limit is a form-level error", async () => {
    savePublicProfileAction.mockResolvedValue({ ok: false, error: "rate_limited" });
    setup();
    await userEvent.type(screen.getByLabelText(en.aliasLabel), "rayelus");
    await userEvent.click(screen.getByRole("button", { name: en.save }));
    expect(await screen.findByText(en.errors.rate_limited)).toBeInTheDocument();
  });
});
