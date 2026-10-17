import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/reports/actions", () => ({ reportMessageAction: vi.fn() }));
vi.mock("@/lib/chat/actions", () => ({
  searchMentionTargetsAction: vi.fn(async () => ({ members: [], roles: [] })),
}));
const composerProps = vi.hoisted(() => ({ last: null as null | Record<string, unknown> }));
vi.mock("@/components/chat/composer", () => ({
  Composer: (props: Record<string, unknown>) => {
    composerProps.last = props;
    return <div data-testid="thread-composer" />;
  },
}));

import { ThreadPanel, type ThreadPanelProps } from "@/components/chat/thread-panel";
import { CHANNEL, directory, doc, makeMessage, viewer } from "./fixtures";

function setup(props: Partial<ThreadPanelProps> = {}) {
  const onClose = vi.fn();
  const root = props.root ?? makeMessage({ body: doc("mensaje raíz"), replyCount: 2 });
  const utils = render(
    <ThreadPanel
      root={root}
      replies={[makeMessage({ threadRootId: root.id, body: doc("primera respuesta") }), makeMessage({ threadRootId: root.id, body: doc("segunda respuesta") })]}
      loading={false}
      directory={directory}
      allowedDomains={[]}
      viewer={viewer()}
      channelId={CHANNEL}
      slowmodeSeconds={0}
      onClose={onClose}
      {...props}
    />,
  );
  return { onClose, root, ...utils };
}

describe("ThreadPanel", () => {
  it("shows the root, the replies and a composer bound to the thread", () => {
    const { root } = setup();
    expect(screen.getByRole("heading", { name: "Hilo" })).toBeInTheDocument();
    expect(screen.getByText("mensaje raíz")).toBeInTheDocument();
    expect(screen.getByText("primera respuesta")).toBeInTheDocument();
    expect(screen.getByText("segunda respuesta")).toBeInTheDocument();
    expect(screen.getByTestId("thread-composer")).toBeInTheDocument();
    expect(composerProps.last).toMatchObject({ channelId: CHANNEL, threadRootId: root.id, canPost: true });
  });

  it("moves focus to the panel heading when it opens", async () => {
    setup();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Hilo" })).toHaveFocus());
  });

  it("closes with the button", async () => {
    const { onClose } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Cerrar hilo" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes with Escape", async () => {
    const { onClose } = setup();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Hilo" })).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("replaces the composer with a notice when the member cannot reply in threads", () => {
    setup({ viewer: viewer({ canThread: false }) });
    expect(screen.queryByTestId("thread-composer")).not.toBeInTheDocument();
    expect(screen.getByText("No puedes responder en hilos de este canal.")).toBeInTheDocument();
  });

  it("shows a loading state", () => {
    setup({ root: null, replies: [], loading: true });
    expect(screen.getByRole("status")).toHaveTextContent("Cargando hilo");
  });

  it("explains when the thread is gone", () => {
    setup({ root: null, replies: [], loading: false });
    expect(screen.getByText("Este hilo ya no existe o no puedes verlo.")).toBeInTheDocument();
  });

  it("keeps a soft-deleted root as a placeholder with its replies", () => {
    setup({ root: makeMessage({ deletedAt: "2026-10-17T11:00:00+00:00", replyCount: 2 }) });
    expect(screen.getByText("Mensaje eliminado")).toBeInTheDocument();
    expect(screen.getByText("primera respuesta")).toBeInTheDocument();
  });

  it("tells the reader when the anchored reply is not among the loaded replies and clears the highlight", () => {
    const onTargetMissing = vi.fn();
    setup({ highlightId: "99999999-9999-4999-8999-999999999999", onTargetMissing });
    expect(screen.getByRole("status")).toHaveTextContent("Esta respuesta es demasiado antigua para mostrarla en el hilo.");
    expect(onTargetMissing).toHaveBeenCalledTimes(1);
  });

  it("shows no notice while loading or when the anchored reply is present", () => {
    const onTargetMissing = vi.fn();
    const root = makeMessage({ body: doc("raíz") });
    const reply = makeMessage({ threadRootId: root.id, body: doc("hija") });
    const { unmount } = setup({ root, replies: [reply], highlightId: reply.id, onTargetMissing });
    expect(screen.queryByText(/demasiado antigua/)).not.toBeInTheDocument();
    unmount();
    setup({ root, replies: [], loading: true, highlightId: "99999999-9999-4999-8999-999999999999", onTargetMissing });
    expect(screen.queryByText(/demasiado antigua/)).not.toBeInTheDocument();
    expect(onTargetMissing).not.toHaveBeenCalled();
  });
});
