import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TicketBody } from "@/components/tickets/ticket-body";

describe("TicketBody", () => {
  it("keeps whitespace and renders markup as plain text", () => {
    const { container } = render(
      <TicketBody text={'línea 1\n\n<img src=x onerror=alert(1)> **no negrita**'} allowLinks={true} allowedDomains={[]} />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("whitespace-pre-wrap");
    expect(root.textContent).toBe('línea 1\n\n<img src=x onerror=alert(1)> **no negrita**');
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("strong")).toBeNull();
  });

  it("an author without allow_links gets text, not anchors", () => {
    render(<TicketBody text="mira https://evil.example/x" allowLinks={false} allowedDomains={[]} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/https:\/\/evil\.example\/x/)).toBeInTheDocument();
  });

  it("an allowed domain is linked directly, any other goes through /out", () => {
    render(<TicketBody text="a https://docs.club.test/p y https://otro.example/x?a=1" allowLinks allowedDomains={["club.test"]} />);
    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", "https://docs.club.test/p");
    expect(links[1]).toHaveAttribute("href", `/out?u=${encodeURIComponent("https://otro.example/x?a=1")}`);
    for (const l of links) {
      expect(l).toHaveAttribute("rel", expect.stringContaining("noopener"));
      expect(l).toHaveAttribute("target", "_blank");
    }
  });

  it("never links javascript: or other schemes", () => {
    render(<TicketBody text="javascript:alert(1) ftp://x.com" allowLinks allowedDomains={[]} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
