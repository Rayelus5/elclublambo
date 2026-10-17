import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportGroup } from "@/lib/reports/queries";

const h = vi.hoisted(() => ({
  del: vi.fn(async (): Promise<{ error?: string }> => ({})),
  resolve: vi.fn(async (): Promise<{ error?: string }> => ({})),
  ban: vi.fn(async (): Promise<{ error?: string }> => ({})),
  refresh: vi.fn(),
  order: [] as string[],
}));
vi.mock("@/lib/chat/actions", () => ({ deleteMessageAction: h.del }));
vi.mock("@/lib/reports/actions", () => ({ resolveReportAction: h.resolve }));
vi.mock("@/lib/moderation/actions", () => ({ banMemberAction: h.ban, toggleSponsorRoleAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));

import { ReportQueue } from "@/components/reports/report-queue";

const MSG = "22222222-2222-4222-8222-222222222222";
const REPORT = "33333333-3333-4333-8333-333333333333";
const CH = "11111111-1111-4111-8111-111111111111";

const group = (over: Partial<ReportGroup> = {}): ReportGroup => ({
  key: `${MSG}:open`,
  reportId: REPORT,
  status: "open",
  messageId: MSG,
  messageDeleted: false,
  count: 3,
  reasons: [
    { reason: "spam", count: 2 },
    { reason: "scam", count: 1 },
  ],
  notes: ["parece una estafa"],
  snapshotText: "compra cripto ya",
  author: {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Ana",
    walletAddress: "0x1111111111111111111111111111111111111111",
    status: "active",
    sponsor: null,
    sponsorIsAdmin: false,
  },
  channel: { id: CH, name: "general" },
  latestAt: "2026-10-17T10:00:00+00:00",
  resolvedAt: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.del.mockResolvedValue({});
  h.resolve.mockResolvedValue({});
  h.ban.mockResolvedValue({});
});

describe("ReportQueue", () => {
  it("shows an empty state", () => {
    render(<ReportQueue groups={[]} status="open" canBan />);
    expect(screen.getByText(/No hay reportes abiertos/)).toBeInTheDocument();
  });

  it("shows the count, reasons, notes, snapshot, author and channel link", () => {
    render(<ReportQueue groups={[group()]} status="open" canBan />);
    const card = screen.getByRole("article");
    expect(within(card).getByText("3 reportes")).toBeInTheDocument();
    expect(within(card).getByText(/Spam ×2/)).toBeInTheDocument();
    expect(within(card).getByText(/Estafa ×1/)).toBeInTheDocument();
    expect(within(card).getByText("parece una estafa")).toBeInTheDocument();
    expect(within(card).getByText("compra cripto ya")).toBeInTheDocument();
    expect(within(card).getByText("Ana")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /#general/ })).toHaveAttribute("href", `/c/${CH}`);
  });

  it("keeps showing the snapshot when the message was deleted, without a delete button", () => {
    render(<ReportQueue groups={[group({ messageDeleted: true })]} status="open" canBan />);
    expect(screen.getByText("compra cripto ya")).toBeInTheDocument();
    expect(screen.getByText(/mensaje ya no está/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Borrar mensaje" })).toBeNull();
    expect(screen.getByRole("button", { name: "Marcar como resuelto" })).toBeInTheDocument();
  });

  it("deletes the message and then resolves as actioned, in that order", async () => {
    const order: string[] = [];
    h.del.mockImplementation(async () => (order.push("delete"), {}));
    h.resolve.mockImplementation(async () => (order.push("resolve"), {}));
    render(<ReportQueue groups={[group()]} status="open" canBan />);
    await userEvent.click(screen.getByRole("button", { name: "Borrar mensaje" }));
    await userEvent.click(await screen.findByRole("button", { name: "Borrar y resolver" }));
    await waitFor(() => expect(h.resolve).toHaveBeenCalledWith(REPORT, "actioned"));
    expect(h.del).toHaveBeenCalledWith(MSG);
    expect(order).toEqual(["delete", "resolve"]);
    await waitFor(() => expect(h.refresh).toHaveBeenCalled());
  });

  it("does not resolve when deleting fails, and shows the error", async () => {
    h.del.mockResolvedValueOnce({ error: "forbidden" });
    render(<ReportQueue groups={[group()]} status="open" canBan />);
    await userEvent.click(screen.getByRole("button", { name: "Borrar mensaje" }));
    await userEvent.click(await screen.findByRole("button", { name: "Borrar y resolver" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/No tienes permiso/);
    expect(h.resolve).not.toHaveBeenCalled();
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("dismisses", async () => {
    render(<ReportQueue groups={[group()]} status="open" canBan />);
    await userEvent.click(screen.getByRole("button", { name: "Descartar" }));
    await waitFor(() => expect(h.resolve).toHaveBeenCalledWith(REPORT, "dismissed"));
    expect(h.del).not.toHaveBeenCalled();
    await waitFor(() => expect(h.refresh).toHaveBeenCalled());
  });

  it("shows the resolve error and does not refresh", async () => {
    h.resolve.mockResolvedValueOnce({ error: "forbidden" });
    render(<ReportQueue groups={[group()]} status="open" canBan />);
    await userEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/No tienes permiso/);
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("bans through the BanDialog and then resolves as actioned", async () => {
    render(<ReportQueue groups={[group()]} status="open" canBan />);
    await userEvent.click(screen.getByRole("button", { name: "Banear a Ana" }));
    await userEvent.type(screen.getByLabelText("Motivo"), "estafa reiterada");
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Banear" }));
    await waitFor(() => expect(h.ban).toHaveBeenCalled());
    await waitFor(() => expect(h.resolve).toHaveBeenCalledWith(REPORT, "actioned"));
    await waitFor(() => expect(h.refresh).toHaveBeenCalled());
  });

  it("hides the ban button without BAN_MEMBERS or when the author is not active", () => {
    const { rerender } = render(<ReportQueue groups={[group()]} status="open" canBan={false} />);
    expect(screen.queryByRole("button", { name: /Banear a/ })).toBeNull();
    rerender(<ReportQueue groups={[group({ author: { ...group().author!, status: "banned" } })]} status="open" canBan />);
    expect(screen.queryByRole("button", { name: /Banear a/ })).toBeNull();
  });

  it("the closed tab is read-only and shows the outcome", () => {
    render(
      <ReportQueue
        groups={[group({ status: "actioned", resolvedAt: "2026-10-17T12:00:00+00:00" })]}
        status="closed"
        canBan
      />,
    );
    expect(screen.getByText("Acción tomada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Descartar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Borrar mensaje" })).toBeNull();
  });

  it("singular count", () => {
    render(<ReportQueue groups={[group({ count: 1, reasons: [{ reason: "abuse", count: 1 }] })]} status="open" canBan />);
    expect(screen.getByText("1 reporte")).toBeInTheDocument();
  });
});
