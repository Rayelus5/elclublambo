import { describe, expect, it } from "vitest";
import { classifyLink, parseExternalUrl } from "@/lib/chat/links";

const allowed = ["github.com", "Example.org"];

describe("classifyLink", () => {
  it.each(["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,<b>x</b>", "vbscript:msgbox(1)", "file:///etc/passwd", "ftp://github.com/x", "//github.com/x", "/relative", "github.com", "", " https://github.com", "java\tscript:alert(1)"])(
    "%j is text",
    (href) => expect(classifyLink(href, allowed)).toEqual({ kind: "text" }),
  );

  it("treats credentials in the URL as text", () => {
    expect(classifyLink("https://user:pass@github.com", allowed).kind).toBe("text");
    expect(classifyLink("https://github.com@evil.io/", allowed).kind).toBe("text");
    expect(classifyLink("https://user@github.com", allowed).kind).toBe("text");
  });

  it("exact host and dot-boundary subdomains are direct", () => {
    expect(classifyLink("https://github.com/a?b=1", allowed)).toEqual({ kind: "direct", href: "https://github.com/a?b=1" });
    expect(classifyLink("https://sub.github.com", allowed).kind).toBe("direct");
    expect(classifyLink("http://a.b.github.com/x", allowed).kind).toBe("direct");
    expect(classifyLink("https://example.org", allowed).kind).toBe("direct");
  });

  it("is case-insensitive on scheme and host", () => {
    expect(classifyLink("HTTPS://GitHub.com/x", allowed)).toEqual({ kind: "direct", href: "https://github.com/x" });
  });

  it("everything else http(s) is guarded through /out", () => {
    const evil = classifyLink("https://github.com.evil.io/x", allowed);
    expect(evil).toEqual({ kind: "guarded", href: `/out?u=${encodeURIComponent("https://github.com.evil.io/x")}` });
    expect(classifyLink("https://notgithub.com", allowed).kind).toBe("guarded");
    expect(classifyLink("https://evilgithub.com", allowed).kind).toBe("guarded");
    expect(classifyLink("https://github.com.", allowed).kind).toBe("guarded");
    expect(classifyLink("https://other.dev", []).kind).toBe("guarded");
  });

  it("IDN hosts compare in punycode and are guarded", () => {
    const r = classifyLink("https://gıthub.com/login", allowed);
    expect(r.kind).toBe("guarded");
    expect(r.href).toContain(encodeURIComponent("xn--gthub-"));
    expect(classifyLink("https://xn--gthub-cta.com", allowed).kind).toBe("guarded");
  });

  it("allowed domains given in unicode match their punycode form", () => {
    expect(classifyLink("https://xn--bcher-kva.example", ["bücher.example"]).kind).toBe("direct");
    expect(classifyLink("https://shop.bücher.example", ["bücher.example"]).kind).toBe("direct");
  });

  it("rejects over-long hrefs", () => {
    expect(classifyLink(`https://github.com/${"a".repeat(2100)}`, allowed).kind).toBe("text");
  });
});

describe("parseExternalUrl", () => {
  it("accepts http(s) and exposes punycode and unicode hosts", () => {
    const r = parseExternalUrl("https://bücher.example/x?y=1");
    expect(r).not.toBeNull();
    expect(r?.host).toBe("xn--bcher-kva.example");
    expect(r?.unicodeHost).toBe("bücher.example");
    expect(r?.href).toBe("https://xn--bcher-kva.example/x?y=1");
  });
  it.each([undefined, "", "javascript:alert(1)", "ftp://x.com", "https://u:p@x.com", "/rel", "not a url", `https://x.com/${"a".repeat(2100)}`])(
    "%j is invalid",
    (u) => expect(parseExternalUrl(u)).toBeNull(),
  );
});
