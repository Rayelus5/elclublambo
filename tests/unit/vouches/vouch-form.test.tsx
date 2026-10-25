import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const recordVouchAction = vi.hoisted(() => vi.fn());
const recordRevocationAction = vi.hoisted(() => vi.fn());
const refreshVouchAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/vouches/actions", () => ({ recordVouchAction, recordRevocationAction, refreshVouchAction }));
const attest = vi.hoisted(() => vi.fn());
const revoke = vi.hoisted(() => vi.fn());
vi.mock("@/lib/vouches/use-vouch-write", () => ({ useVouchWrite: () => ({ attest, revoke, switching: false }) }));
const account = vi.hoisted(() => ({ isConnected: true, status: "connected" as string, address: "0x1111111111111111111111111111111111111111" as string | undefined }));
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
  refreshVouchAction.mockReset().mockResolvedValue({ ok: true, state: "active" });
  account.isConnected = true;
  account.status = "connected";
  account.address = ME;
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const KEY = `elclub:vouch:${TO}`;
const MINUTE = 60_000;

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

  it("a connected wallet other than the session's: the warning up front, «Avalar» disabled, nothing signed", async () => {
    account.address = "0x9999999999999999999999999999999999999999";
    setup({ defaultRecipient: TO });
    expect(screen.getByText(/0x1111…1111/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.form.submit })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: t.kinds.in_person }));
    await userEvent.click(screen.getByRole("button", { name: t.form.submit }));
    expect(attest).not.toHaveBeenCalled();
  });

  it("no wallet connected: the same warning and «Avalar» disabled; while reconnecting only disabled", () => {
    account.isConnected = false;
    account.address = undefined;
    account.status = "disconnected";
    const { unmount } = setup({ defaultRecipient: TO });
    expect(screen.getByText(/0x1111…1111/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.form.submit })).toBeDisabled();
    unmount();
    account.status = "reconnecting";
    setup({ defaultRecipient: TO });
    expect(screen.queryByText(/0x1111…1111/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.form.submit })).toBeDisabled();
  });

  it("a cancelled signature shows its text and nothing is recorded", async () => {
    attest.mockRejectedValue(Object.assign(new Error("User rejected the request."), { name: "UserRejectedRequestError" }));
    setup({ defaultRecipient: TO });
    await userEvent.click(screen.getByRole("radio", { name: t.kinds.in_person }));
    await userEvent.click(screen.getByRole("button", { name: t.form.submit }));
    expect(await screen.findByText(t.form.cancelled)).toBeInTheDocument();
    expect(recordVouchAction).not.toHaveBeenCalled();
  });

  it("tx_not_found long after sending (dropped or replaced tx): the stored hash is dropped and «Avalar» comes back", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ hash: HASH, sentAt: Date.now() - 11 * MINUTE }));
    recordVouchAction.mockResolvedValue({ ok: false, error: "tx_not_found" });
    setup({ defaultRecipient: TO });
    await userEvent.click(screen.getByRole("button", { name: t.form.checkAgain }));
    expect(await screen.findByText(t.form.errors.tx_not_found)).toBeInTheDocument();
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(screen.getByRole("button", { name: t.form.submit })).toBeEnabled();
    expect(recordVouchAction).toHaveBeenCalledTimes(1);
  });

  it("tx_not_found right after sending keeps the hash (the node may not have seen it yet)", async () => {
    recordVouchAction.mockResolvedValue({ ok: false, error: "tx_not_found" });
    setup({ defaultRecipient: TO });
    await userEvent.click(screen.getByRole("radio", { name: t.kinds.in_person }));
    await userEvent.click(screen.getByRole("button", { name: t.form.submit }));
    expect(await screen.findByText(t.form.errors.tx_not_found)).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toMatchObject({ hash: HASH });
    expect(screen.getByRole("button", { name: t.form.checkAgain })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t.form.submit })).not.toBeInTheDocument();
  });

  it("storage that throws: the vouch still goes through and, while pending, the in-memory hash blocks a second signature", async () => {
    for (const m of ["getItem", "setItem", "removeItem"] as const) {
      vi.spyOn(Storage.prototype, m).mockImplementation(() => {
        throw new Error("blocked");
      });
    }
    recordVouchAction.mockResolvedValue({ ok: false, error: "pending" });
    setup({ defaultRecipient: TO });
    await userEvent.click(screen.getByRole("radio", { name: t.kinds.in_person }));
    await userEvent.click(screen.getByRole("button", { name: t.form.submit }));
    expect(await screen.findByText(t.form.pending)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t.form.submit })).not.toBeInTheDocument();
    recordVouchAction.mockReset().mockResolvedValue({ ok: true, uid: UID, already: false });
    await userEvent.click(screen.getByRole("button", { name: t.form.checkAgain }));
    expect(await screen.findByText(t.form.done)).toBeInTheDocument();
    expect(recordVouchAction).toHaveBeenCalledWith({ chainId: 84532, txHash: HASH });
    expect(attest).toHaveBeenCalledTimes(1);
  });
});

describe("GivenVouches", () => {
  it("«Retirar» revokes the uid and records the revocation, retrying while pending", async () => {
    recordRevocationAction.mockResolvedValueOnce({ ok: false, error: "pending" }).mockResolvedValue({ ok: true, uid: UID });
    render(<GivenVouches lang="es" t={t} given={[given()]} chainId={84532} sessionWallet={ME} retryDelaysMs={NO_WAIT} />);
    await userEvent.click(screen.getByRole("button", { name: t.given.revoke }));
    await waitFor(() => expect(recordRevocationAction).toHaveBeenCalledTimes(2));
    expect(revoke).toHaveBeenCalledWith(UID);
    expect(recordRevocationAction).toHaveBeenCalledWith({ chainId: 84532, txHash: HASH });
    expect(await screen.findByText(t.given.revoked)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("«Retirar» is an outline button and an error shows its text", async () => {
    recordRevocationAction.mockResolvedValue({ ok: false, error: "rate_limited" });
    render(<GivenVouches lang="es" t={t} given={[given()]} chainId={84532} sessionWallet={ME} retryDelaysMs={NO_WAIT} />);
    const btn = screen.getByRole("button", { name: t.given.revoke });
    expect(btn.dataset.variant).toBe("outline");
    await userEvent.click(btn);
    expect(await screen.findByText(t.form.errors.rate_limited)).toBeInTheDocument();
  });

  it("a revocation still pending after five calls offers «Comprobar de nuevo» on the same hash, never a second signature", async () => {
    recordRevocationAction.mockResolvedValue({ ok: false, error: "pending" });
    render(<GivenVouches lang="es" t={t} given={[given()]} chainId={84532} sessionWallet={ME} retryDelaysMs={NO_WAIT} />);
    await userEvent.click(screen.getByRole("button", { name: t.given.revoke }));
    expect(await screen.findByRole("button", { name: t.form.checkAgain })).toBeInTheDocument();
    expect(recordRevocationAction).toHaveBeenCalledTimes(5);
    expect(screen.queryByRole("button", { name: t.given.revoke })).not.toBeInTheDocument();
    recordRevocationAction.mockReset().mockResolvedValue({ ok: true, uid: UID });
    await userEvent.click(screen.getByRole("button", { name: t.form.checkAgain }));
    expect(await screen.findByText(t.given.revoked)).toBeInTheDocument();
    expect(recordRevocationAction).toHaveBeenCalledWith({ chainId: 84532, txHash: HASH });
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it("a wallet other than the session's: «Retirar» disabled, the warning left to the form above (shown once per page)", () => {
    account.address = "0x9999999999999999999999999999999999999999";
    render(<GivenVouches lang="es" t={t} given={[given()]} chainId={84532} sessionWallet={ME} retryDelaysMs={NO_WAIT} />);
    expect(screen.queryByText(/0x1111…1111/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.given.revoke })).toBeDisabled();
    expect(screen.getByRole("button", { name: t.summary.refresh })).toBeEnabled();
  });

  const REVOKE_KEY = `elclub:vouch-revoke:${UID}`;
  const props = { lang: "es" as const, t, chainId: 84532 as const, sessionWallet: ME as `0x${string}`, retryDelaysMs: NO_WAIT };

  it("a withdrawal shows a confirmation outside the list that survives the refresh removing the row", async () => {
    const view = render(<GivenVouches {...props} given={[given()]} />);
    await userEvent.click(screen.getByRole("button", { name: t.given.revoke }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    view.rerender(<GivenVouches {...props} given={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent(t.given.revoked);
    expect(screen.getByText(t.given.empty)).toBeInTheDocument();
  });

  it("the signed revocation hash is stored with sentAt and resumed after a reload, never signed twice", async () => {
    recordRevocationAction.mockResolvedValue({ ok: false, error: "pending" });
    const view = render(<GivenVouches {...props} given={[given()]} />);
    await userEvent.click(screen.getByRole("button", { name: t.given.revoke }));
    expect(await screen.findByRole("button", { name: t.form.checkAgain })).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(REVOKE_KEY)!)).toMatchObject({ hash: HASH, sentAt: expect.any(Number) });
    view.unmount();

    recordRevocationAction.mockReset().mockResolvedValue({ ok: true, uid: UID });
    render(<GivenVouches {...props} given={[given()]} />);
    await userEvent.click(screen.getByRole("button", { name: t.form.checkAgain }));
    await waitFor(() => expect(recordRevocationAction).toHaveBeenCalledWith({ chainId: 84532, txHash: HASH }));
    expect(revoke).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(window.localStorage.getItem(REVOKE_KEY)).toBeNull());
  });

  it("storage that throws: the withdrawal still goes through", async () => {
    for (const m of ["getItem", "setItem", "removeItem"] as const) {
      vi.spyOn(Storage.prototype, m).mockImplementation(() => {
        throw new Error("blocked");
      });
    }
    render(<GivenVouches {...props} given={[given()]} />);
    await userEvent.click(screen.getByRole("button", { name: t.given.revoke }));
    expect(await screen.findByText(t.given.revoked)).toBeInTheDocument();
  });

  it("a revoke the wallet cannot send (revoked elsewhere): re-reads the chain, refreshes and confirms", async () => {
    revoke.mockRejectedValue(new Error("execution reverted: AlreadyRevoked()"));
    refreshVouchAction.mockResolvedValue({ ok: true, state: "revoked" });
    const view = render(<GivenVouches {...props} given={[given()]} />);
    await userEvent.click(screen.getByRole("button", { name: t.given.revoke }));
    await waitFor(() => expect(refreshVouchAction).toHaveBeenCalledWith(UID));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    view.rerender(<GivenVouches {...props} given={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent(t.given.revoked);
  });

  it("a reverted revocation (tx_failed): re-reads the chain; still active, the error stays and nothing refreshes", async () => {
    recordRevocationAction.mockResolvedValue({ ok: false, error: "tx_failed" });
    render(<GivenVouches {...props} given={[given()]} />);
    await userEvent.click(screen.getByRole("button", { name: t.given.revoke }));
    expect(await screen.findByText(t.form.errors.tx_failed)).toBeInTheDocument();
    expect(refreshVouchAction).toHaveBeenCalledWith(UID);
    expect(refresh).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(REVOKE_KEY)).toBeNull();
    expect(screen.getByRole("button", { name: t.given.revoke })).toBeInTheDocument();
  });

  it("a uid the chain no longer knows: the re-read removes it and says so", async () => {
    recordRevocationAction.mockResolvedValue({ ok: false, error: "tx_failed" });
    refreshVouchAction.mockResolvedValue({ ok: true, state: "removed" });
    const view = render(<GivenVouches {...props} given={[given()]} />);
    await userEvent.click(screen.getByRole("button", { name: t.given.revoke }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    view.rerender(<GivenVouches {...props} given={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent(t.given.removed);
  });

  it("a cancelled signature does not re-read the chain", async () => {
    revoke.mockRejectedValue(Object.assign(new Error("rejected"), { code: 4001 }));
    render(<GivenVouches {...props} given={[given()]} />);
    await userEvent.click(screen.getByRole("button", { name: t.given.revoke }));
    expect(await screen.findByText(t.form.cancelled)).toBeInTheDocument();
    expect(refreshVouchAction).not.toHaveBeenCalled();
  });

  it("each row has «Actualizar» (ghost): a revocation made outside the app leaves the list with a confirmation", async () => {
    refreshVouchAction.mockResolvedValue({ ok: true, state: "revoked" });
    const view = render(<GivenVouches {...props} given={[given()]} />);
    const btn = screen.getByRole("button", { name: t.summary.refresh });
    expect(btn.dataset.variant).toBe("ghost");
    await userEvent.click(btn);
    expect(refreshVouchAction).toHaveBeenCalledWith(UID);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    view.rerender(<GivenVouches {...props} given={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent(t.given.revoked);
  });

  it("nothing given: the empty text", () => {
    render(<GivenVouches lang="es" t={t} given={[]} chainId={84532} sessionWallet={ME} />);
    expect(screen.getByText(t.given.empty)).toBeInTheDocument();
  });
});
