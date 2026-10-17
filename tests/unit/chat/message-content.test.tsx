import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MessageContent } from "@/components/chat/message-content";

const t = (text: string, marks?: unknown[]) => ({ type: "text", text, ...(marks ? { marks } : {}) });
const p = (...c: unknown[]) => ({ type: "paragraph", content: c });
const doc = (...c: unknown[]) => ({ type: "doc", content: c });
const link = (href: string) => [{ type: "link", attrs: { href } }];
const dir = { members: {}, roles: {} };
const M = "11111111-1111-1111-1111-111111111111";
const R = "22222222-2222-2222-2222-222222222222";

function renderDoc(d: unknown, opts: { allowLinks?: boolean; allowed?: string[]; mentionsDir?: typeof dir } = {}) {
  return render(
    <MessageContent doc={d} allowLinks={opts.allowLinks ?? true} allowedDomains={opts.allowed ?? ["github.com"]} mentionsDir={opts.mentionsDir ?? dir} />,
  );
}

describe("MessageContent links", () => {
  it.each(["javascript:alert(1)", "data:text/html,x", "vbscript:x"])("%s renders as plain text", (href) => {
    const { container } = renderDoc(doc(p(t("clic", link(href)))));
    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByText("clic")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("javascript:");
  });

  it("allowed domain is a direct link with safe rel/target", () => {
    renderDoc(doc(p(t("repo", link("https://sub.github.com/x")))));
    const a = screen.getByRole("link", { name: /^repo ?\(abre en una pestaña nueva\)$/ });
    expect(a).toHaveAttribute("href", "https://sub.github.com/x");
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noopener noreferrer nofollow ugc");
  });

  it("lookalike domains go through /out", () => {
    renderDoc(doc(p(t("x", link("https://github.com.evil.io/p?a=1")))));
    const a = screen.getByRole("link", { name: /^x ?\(sale de El Club, abre en una pestaña nueva\)$/ });
    expect(a).toHaveAttribute("href", `/out?u=${encodeURIComponent("https://github.com.evil.io/p?a=1")}`);
    expect(a).toHaveAttribute("rel", "noopener noreferrer nofollow ugc");
    expect(a).toHaveAttribute("target", "_blank");
  });

  it("allowLinks=false renders text only", () => {
    const { container } = renderDoc(doc(p(t("repo", link("https://github.com/x")))), { allowLinks: false });
    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByText("repo")).toBeInTheDocument();
  });

  it("credentials in URL render as text", () => {
    const { container } = renderDoc(doc(p(t("x", link("https://user:pass@github.com")))));
    expect(container.querySelector("a")).toBeNull();
  });
});

describe("MessageContent sanitization", () => {
  it("drops onclick/style attributes and unknown nodes but keeps text", () => {
    const { container } = renderDoc(
      doc({ type: "paragraph", attrs: { onclick: "x()", style: "color:red" }, content: [t("seguro")] }, { type: "script", content: [t("texto")] }),
    );
    expect(container.innerHTML).not.toContain("onclick");
    expect(container.innerHTML).not.toContain("style=");
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("seguro")).toBeInTheDocument();
    expect(screen.getByText("texto")).toBeInTheDocument();
  });

  it("escapes HTML in text and code blocks", () => {
    const { container } = renderDoc(doc(p(t("<img src=x onerror=alert(1)>")), { type: "codeBlock", content: [t("<b>a</b>")] }));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("pre code")?.textContent).toBe("<b>a</b>");
  });

  it("renders marks, headings, lists, quotes and rules", () => {
    const { container } = renderDoc(
      doc(
        { type: "heading", attrs: { level: 2 }, content: [t("Titulo")] },
        p(t("b", [{ type: "bold" }]), t("i", [{ type: "italic" }]), t("s", [{ type: "strike" }]), t("c", [{ type: "code" }])),
        { type: "bulletList", content: [{ type: "listItem", content: [p(t("uno"))] }] },
        { type: "orderedList", content: [{ type: "listItem", content: [p(t("dos"))] }] },
        { type: "blockquote", content: [p(t("cita"))] },
        { type: "horizontalRule" },
      ),
    );
    expect(screen.getByRole("heading", { name: "Titulo" })).toBeInTheDocument();
    expect(container.querySelector("strong")?.textContent).toBe("b");
    expect(container.querySelector("em")?.textContent).toBe("i");
    expect(container.querySelector("s")?.textContent).toBe("s");
    expect(container.querySelector("p code")?.textContent).toBe("c");
    expect(container.querySelector("ul li")?.textContent).toBe("uno");
    expect(container.querySelector("ol li")?.textContent).toBe("dos");
    expect(container.querySelector("blockquote")?.textContent).toBe("cita");
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders tables with headers", () => {
    renderDoc(
      doc({
        type: "table",
        content: [
          { type: "tableRow", content: [{ type: "tableHeader", content: [p(t("Col"))] }] },
          { type: "tableRow", content: [{ type: "tableCell", content: [p(t("Val"))] }] },
        ],
      }),
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Col" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Val" })).toBeInTheDocument();
  });

  it("renders malformed docs as empty", () => {
    const { container } = renderDoc(null);
    expect(container.textContent).toBe("");
  });
});

describe("MessageContent mentions", () => {
  const mentionsDir = {
    members: { [M]: { name: "Ana" } },
    roles: { [R]: { name: "Mods", color: "#22d3ee" } },
  };
  const mention = (attrs: Record<string, unknown>) => ({ type: "mention", attrs });

  it("ignores a forged label and renders the resolved member name", () => {
    renderDoc(doc(p(mention({ kind: "member", id: M, label: "Admin Oficial" }))), { mentionsDir });
    expect(screen.getByText("@Ana")).toBeInTheDocument();
    expect(screen.queryByText(/Admin Oficial/)).toBeNull();
  });

  it("renders role chip with resolved name and color as border/dot only", () => {
    renderDoc(doc(p(mention({ kind: "role", id: R, label: "Fake" }))), { mentionsDir });
    const chip = screen.getByText("@Mods");
    const root = chip.closest("[data-mention]") as HTMLElement;
    expect(root).toHaveAttribute("data-mention", "role");
    expect(chip.style.color).toBe("");
    expect(root.style.color).toBe("");
    expect(root.getAttribute("style")).toContain("border-color");
  });

  it("everyone and unknown ids", () => {
    renderDoc(
      doc(
        p(
          mention({ kind: "everyone", label: "otro" }),
          t(" "),
          mention({ kind: "member", id: "33333333-3333-3333-3333-333333333333", label: "Ana" }),
          t(" "),
          mention({ kind: "role", id: "44444444-4444-4444-4444-444444444444" }),
        ),
      ),
      { mentionsDir },
    );
    expect(screen.getByText("@everyone")).toBeInTheDocument();
    expect(screen.getAllByText("@desconocido")).toHaveLength(2);
    expect(screen.queryByText("@otro")).toBeNull();
  });

  it("rejects non-hex role colors", () => {
    renderDoc(doc(p(mention({ kind: "role", id: R }))), { mentionsDir: { members: {}, roles: { [R]: { name: "X", color: "red;background:url(x)" } } } });
    expect(screen.getByText("@X").closest("[data-mention]")?.getAttribute("style") ?? "").not.toContain("url");
  });
});
