import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const recordVouchAction = vi.hoisted(() => vi.fn());
const recordRevocationAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/vouches/actions", () => ({ recordVouchAction, recordRevocationAction }));
const attest = vi.hoisted(() => vi.fn());
const revoke = vi.hoisted(() => vi.fn());
vi.mock("@/lib/vouches/use-vouch-write", () => ({ CHAIN_SWITCH_FAILED: "chain_switch_failed", useVouchWrite: () => ({ attest, revoke, switching: false }) }));
const account = vi.hoisted(() => ({ isConnected: true, address: "0x1111111111111111111111111111111111111111" as string | undefined }));
vi.mock("wagmi", () => ({ useAccount: () => account }));

import { GivenVouches } from "@/components/vouches/given-vouches";
import { VouchForm } from "@/components/vouches/vouch-form";
import { getDictionary } from "@/lib/i18n";
import type { GivenVouch } from "@/lib/vouches/types";

const t = getDictionary("es").vouches;
const ME = "0x1111111111111111111111111111111111111111";
const TO = "0x3333333333333333333333333333333333333333";
const HASH = `0x${"cd".repeat(32)}` as const;
const UID = `0x${"ab".repeat(32)}` as const;
const NO_WAIT = [0, 0, 0, 0];

const given = (over: Partial<GivenVouch> = {}): GivenVouch => ({
  uid: UID,
  chainId: 84532,
  kind: 2,
  recipient: TO,
  recipientAlias: null,
  attestedAt: "2026-10-20T10:00:00Z",
  ...over,
});

function setup(props: { defaultRecipient?: string; given?: GivenVouch[] } = {}) {
  return render(
    <VouchForm t={t} chainId={84532} sessionWallet={ME} defaultRecipient={props.defaultRecipient ?? ""} given={props.given ?? []} retryDelaysMs={NO_WAIT} />,
  );
}

async function fillAndSubmit(recipient: string, kindLabel: string) {
  const field = screen.getByLabelText(t.form.recipient);
  await userEvent.clear(field);
  if (recipient) await userEvent.type(field, recipient);
  await userEvent.click(screen.getByRole("radio", { name: kindLabel }));
  await userEvent.click(screen.getByRole("button", { name: t.form.submit }));
}

beforeEach(() => {
  refresh.mockReset();
  attest.mockReset().mockResolvedValue(HASH);
  revoke.mockReset().mockResolvedValue(HASH);
  recordVouchAction.mockReset().mockResolvedValue({ ok: true, uid: UID, already: false });
  recordRevocationAction.mockReset().mockResolvedValue({ ok: true, uid: UID });
  account.isConnected = true;
  account.address = ME;
  window.localStorage.clear();
});

describe("VouchForm", () => {
  it("the session's own wallet as recipient: the self text, the button disabled and nothing signed", async () => {
    setup({ defaultRecipient: ME.toUpperCase().replace("0X", "0x") });
    expect(screen.getByText(t.form.self)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.form.submit })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: t.kinds.in_person }));
    await userEvent.click(screen.getByRole("button", { name: t.form.submit }));
    expect(attest).not.toHaveBeenCalled();
  });

  it("an invalid address: the error next to the field, nothing signed", async () => {
    setup();
    await fillAndSubmit("0x1234", t.kinds.in_person);
    const field = screen.getByLabelText(t.form.recipient);
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(t.form.invalid).id).toBe(field.getAttribute("aria-describedby")?.split(" ")[0]);
    expect(attest).not.toHaveBeenCalled();
  });

  it("no kind chosen: asks for one, nothing signed", async () => {
    setup({ defaultRecipient: TO });
    await userEvent.click(screen.getByRole("button", { name: t.form.submit }));
    expect(screen.getByText(t.form.kindRequired)).toBeInTheDocument();
    expect(attest).not.toHaveBeenCalled();
  });

  it("the kind radios are 44 px targets with the three labels", () => {
    setup();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    for (const r of radios) expect(r.closest("label")?.className).toMatch(/min-h-11/);
    expect(screen.getByRole("radio", { name: t.kinds.reliable_trade })).toBeInTheDocument();
  });

  it("ok: attest(recipient, kind), then recordVouchAction with the chain and hash, then a refresh", async () => {
    setup();
    await fillAndSubmit(TO, t.kinds.worked_together);
    await waitFor(() => expect(recordVouchAction).toHaveBeenCalledWith({ chainId: 84532, txHash: HASH }));
    expect(attest).toHaveBeenCalledWith(TO, 2);
    expect(await screen.findByText(t.form.done)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
  });

  it("pending retries (at most five calls) and ends in done", async () => {
    recordVouchAction
      .mockResolvedValueOnce({ ok: false, error: "pending" })
      .mockResolvedValueOnce({ ok: false, error: "pending" })
      .mockResolvedValue({ ok: true, uid: UID, already: false });
    setup({ defaultRecipient: TO });
    await userEvent.click(screen.getByRole("radio", { name: t.kinds.in_person }));
    await userEvent.click(screen.getByRole("button", { name: t.form.submit }));
    expect(await screen.findByText(t.form.done)).toBeInTheDocument();
    expect(recordVouchAction).toHaveBeenCalledTimes(3);
    expect(attest).toHaveBeenCalledTimes(1);
  });

  it("still pending after five calls: keeps the hash for this recipient and offers to check again instead of signing", async () => {
    recordVouchAction.mockResolvedValue({ ok: false, error: "pending" });
    const { unmount } = setup({ defaultRecipient: TO });
    await userEvent.click(screen.getByRole("radio", { name: t.kinds.in_person }));
    await userEvent.click(screen.getByRole("button", { name: t.form.submit }));
    expect(await screen.findByText(t.form.pending)).toBeInTheDocument();
    expect(recordVouchAction).toHaveBeenCalledTimes(5);
    unmount();

    // A reload resumes on the stored hash: no second signature.
    recordVouchAction.mockReset().mockResolvedValue({ ok: true, uid: UID, already: false });
    setup({ defaultRecipient: TO });
    expect(screen.queryByRole("button", { name: t.form.submit })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: t.form.checkAgain }));
    expect(await screen.findByText(t.form.done)).toBeInTheDocument();
    expect(recordVouchAction).toHaveBeenCalledWith({ chainId: 84532, txHash: HASH });
    expect(attest).toHaveBeenCalledTimes(1);
  });

  it("wrong_attester shows its text", async () => {
    recordVouchAction.mockResolvedValue({ ok: false, error: "wrong_attester" });
    setup({ defaultRecipient: TO });
    await userEvent.click(screen.getByRole("radio", { name: t.kinds.in_person }));
    await userEvent.click(screen.getByRole("button", { name: t.form.submit }));
    expect(await screen.findByText(t.form.errors.wrong_attester)).toBeInTheDocument();
  });

  it("a refused chain switch shows its text", async () => {
    attest.mockRejectedValue(new Error("chain_switch_failed"));
    setup({ defaultRecipient: TO });
    await userEvent.click(screen.getByRole("radio", { name: t.kinds.in_person }));
    await userEvent.click(screen.getByRole("button", { name: t.form.submit }));
    expect(await screen.findByText(t.form.switchFailed)).toBeInTheDocument();
    expect(recordVouchAction).not.toHaveBeenCalled();
  });

  it("an existing vouch of the same kind to the same recipient: the already text, nothing signed", async () => {
    setup({ defaultRecipient: TO.toUpperCase().replace("0X", "0x"), given: [given({ kind: 2 })] });
    await userEvent.click(screen.getByRole("radio", { name: t.kinds.worked_together }));
    expect(screen.getByText(t.form.already)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: t.form.submit }));
    expect(attest).not.toHaveBeenCalled();
    // Another kind to the same recipient is fine.
    await userEvent.click(screen.getByRole("radio", { name: t.kinds.in_person }));
    expect(screen.queryByText(t.form.already)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: t.form.submit }));
    await waitFor(() => expect(attest).toHaveBeenCalledWith(TO.toUpperCase().replace("0X", "0x"), 1));
  });

  it("a connected wallet other than the session's: asks for the session's wallet, nothing signed", async () => {
    account.address = "0x9999999999999999999999999999999999999999";
    setup({ defaultRecipient: TO });
    await userEvent.click(screen.getByRole("radio", { name: t.kinds.in_person }));
    await userEvent.click(screen.getByRole("button", { name: t.form.submit }));
    expect(await screen.findByText(/0x1111…1111/)).toBeInTheDocument();
    expect(attest).not.toHaveBeenCalled();
  });
});

describe("GivenVouches", () => {
  it("«Retirar» revokes the uid and records the revocation, retrying while pending", async () => {
    recordRevocationAction.mockResolvedValueOnce({ ok: false, error: "pending" }).mockResolvedValue({ ok: true, uid: UID });
    render(<GivenVouches lang="es" t={t} given={[given()]} chainId={84532} retryDelaysMs={NO_WAIT} />);
    await userEvent.click(screen.getByRole("button", { name: t.given.revoke }));
    await waitFor(() => expect(recordRevocationAction).toHaveBeenCalledTimes(2));
    expect(revoke).toHaveBeenCalledWith(UID);
    expect(recordRevocationAction).toHaveBeenCalledWith({ chainId: 84532, txHash: HASH });
    expect(await screen.findByText(t.given.revoked)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("«Retirar» is an outline button and an error shows its text", async () => {
    recordRevocationAction.mockResolvedValue({ ok: false, error: "rate_limited" });
    render(<GivenVouches lang="es" t={t} given={[given()]} chainId={84532} retryDelaysMs={NO_WAIT} />);
    const btn = screen.getByRole("button", { name: t.given.revoke });
    expect(btn.dataset.variant).toBe("outline");
    await userEvent.click(btn);
    expect(await screen.findByText(t.form.errors.rate_limited)).toBeInTheDocument();
  });

  it("nothing given: the empty text", () => {
    render(<GivenVouches lang="es" t={t} given={[]} chainId={84532} />);
    expect(screen.getByText(t.given.empty)).toBeInTheDocument();
  });
});
