import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const back = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ back, push }) }));

import { OutView } from "@/components/chat/out-view";
import { isPublicPath } from "@/lib/auth/public-paths";

describe("OutView", () => {
  it.each([undefined, "", "javascript:alert(1)", "https://u:p@x.com", "ftp://x.com", `https://x.com/${"a".repeat(2100)}`])(
    "%j shows the invalid message",
    (u) => {
      render(<OutView u={u} />);
      expect(screen.getByText("Enlace no válido.")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /Continuar/ })).toBeNull();
    },
  );

  it("shows host, full URL, warning and buttons", () => {
    render(<OutView u="https://example.com/path?q=1" />);
    expect(screen.getByRole("heading", { name: "Vas a salir de El Club" })).toBeInTheDocument();
    expect(screen.getAllByText("example.com").length).toBeGreaterThan(0);
    expect(screen.getByText("https://example.com/path?q=1")).toBeInTheDocument();
    expect(screen.getByText(/Nunca conectes tu wallet ni firmes nada en webs que no conoces\. El staff jamás te pedirá tu frase semilla\./)).toBeInTheDocument();
    const go = screen.getByRole("link", { name: "Continuar a example.com" });
    expect(go).toHaveAttribute("href", "https://example.com/path?q=1");
    expect(go).toHaveAttribute("rel", "noopener noreferrer");
    expect(go).not.toHaveAttribute("target", "_blank");
    expect(screen.getByRole("button", { name: "Volver" })).toBeInTheDocument();
  });

  it("shows punycode and unicode with a homograph warning for IDN hosts", () => {
    render(<OutView u="https://xn--gthub-n4a.com/login" />);
    expect(screen.getAllByText("xn--gthub-n4a.com").length).toBeGreaterThan(0);
    expect(screen.getByText("gıthub.com")).toBeInTheDocument();
    expect(screen.getByText(/caracteres que se parecen/i)).toBeInTheDocument();
  });

  it("does not show the homograph warning for ASCII hosts", () => {
    render(<OutView u="https://example.com" />);
    expect(screen.queryByText(/caracteres que se parecen/i)).toBeNull();
  });
});

describe("/out access", () => {
  it("is not a public path (proxy requires a session)", () => {
    expect(isPublicPath("/out")).toBe(false);
    expect(isPublicPath("/out/x")).toBe(false);
  });
});
