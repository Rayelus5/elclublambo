import { describe, expect, it, vi } from "vitest";
import { analyzeLink } from "@/lib/checker/link/analyze";
import { CRYPTO_BRANDS, SHORTENERS } from "@/lib/checker/link/lists";

const KNOWN = ["elclub.party", "github.com", ...CRYPTO_BRANDS];

function ok(input: string, known: readonly string[] = KNOWN) {
  const r = analyzeLink(input, known);
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r;
}
const codes = (input: string, known: readonly string[] = KNOWN) => ok(input, known).alerts.map((a) => a.code);

describe("analyzeLink (P4-R3)", () => {
  it("a known domain has no alerts", () => {
    const r = ok("https://github.com/x");
    expect(r.isKnown).toBe(true);
    expect(r.alerts).toEqual([]);
    expect(r.host).toBe("github.com");
    expect(r.scheme).toBe("https");
  });

  it("a subdomain of a known domain is known", () => {
    expect(ok("https://gist.github.com/x").isKnown).toBe(true);
    expect(codes("https://gist.github.com/x")).toEqual([]);
  });

  it("input without a scheme is assumed https", () => {
    const r = ok("elclub.party");
    expect(r.scheme).toBe("https");
    expect(r.url).toBe("https://elclub.party/");
    expect(r.alerts).toEqual([]);
  });

  it("host:port without a scheme is not mistaken for a scheme", () => {
    expect(ok("elclub.party:8080/x").host).toBe("elclub.party");
  });

  it.each(["javascript:alert(1)", "data:text/html,<b>x</b>", "ftp://x.com", "file:///etc/passwd", "mailto:a@b.c", "", "   ", "not a url", "http://", "https://exa mple.com"])(
    "%j is invalid_url",
    (input) => {
      expect(analyzeLink(input, KNOWN)).toEqual({ ok: false, error: "invalid_url" });
    },
  );

  it("longer than 2048 chars is invalid_url", () => {
    expect(analyzeLink(`https://x.com/${"a".repeat(2100)}`, KNOWN)).toEqual({ ok: false, error: "invalid_url" });
  });

  it("punycode: a Cyrillic look-alike of elclub.party warns (punycode + lookalike)", () => {
    const host = new URL("https://еlclub.party").hostname;
    expect(host.startsWith("xn--")).toBe(true);
    const r = ok(`https://${host}/`);
    const c = r.alerts.map((a) => a.code);
    expect(c).toContain("punycode");
    expect(c).toContain("lookalike");
    expect(r.hostUnicode).toBe("еlclub.party");
    expect(r.isKnown).toBe(false);
  });

  it("punycode: xn--elclb-bva.party (elclúb) warns and looks like elclub.party", () => {
    expect(codes("https://xn--elclb-bva.party/")).toEqual(expect.arrayContaining(["punycode", "lookalike"]));
  });

  it("subdomain trick: elclub.party.evil.io", () => {
    const r = ok("https://elclub.party.evil.io");
    expect(r.alerts.find((a) => a.code === "subdomain_trick")?.severity).toBe("high");
    expect(r.isKnown).toBe(false);
  });

  it("subdomain trick in the middle: login.github.com.evil.io", () => {
    expect(codes("https://login.github.com.evil.io")).toContain("subdomain_trick");
  });

  it("a true subdomain of a known domain is not a trick", () => {
    expect(codes("https://www.elclub.party")).toEqual([]);
  });

  it("lookalike by confusable skeleton: e1club.party, elc1ub.party, rn-for-m, vv-for-w", () => {
    expect(codes("https://e1club.party")).toContain("lookalike");
    expect(codes("https://elc1ub.party")).toContain("lookalike");
    expect(codes("https://rnetamask.io")).toContain("lookalike");
    expect(codes("https://vvikipedia.org", ["wikipedia.org"])).toContain("lookalike");
    expect(codes("https://0pensea.io")).toContain("lookalike");
  });

  it("lookalike by edit distance <= 2: transposition and omission", () => {
    expect(codes("https://elcub.party")).toContain("lookalike");
    expect(codes("https://elclbu.party")).toContain("lookalike");
    expect(codes("https://binence.com")).toContain("lookalike");
  });

  it("an unrelated domain is not a lookalike", () => {
    expect(codes("https://example.com")).toEqual(["unknown_domain"]);
  });

  it("an exact known registrable domain is not a lookalike of itself", () => {
    expect(codes("https://uniswap.org")).toEqual([]);
  });

  it("not_https: http:// warns", () => {
    expect(codes("http://elclub.party")).toEqual(["not_https"]);
    expect(ok("http://elclub.party").scheme).toBe("http");
  });

  it("credentials: user:pass@host warns high, and hides nothing", () => {
    const r = ok("https://user:pass@example.com/");
    expect(r.alerts.find((a) => a.code === "credentials")?.severity).toBe("high");
    expect(r.host).toBe("example.com");
  });

  it("credentials trick: https://elclub.party@evil.io", () => {
    const r = ok("https://elclub.party@evil.io/");
    expect(r.host).toBe("evil.io");
    expect(r.isKnown).toBe(false);
    expect(r.alerts.map((a) => a.code)).toContain("credentials");
  });

  it("ip_host: IPv4, IPv6 and obfuscated numeric hosts", () => {
    expect(codes("https://1.2.3.4/")).toContain("ip_host");
    expect(codes("https://[2001:db8::1]/")).toContain("ip_host");
    expect(codes("http://0x7f.1/")).toContain("ip_host");
    expect(codes("https://2130706433/")).toContain("ip_host");
  });

  it("shortener: listed hosts warn", () => {
    for (const s of SHORTENERS) expect(codes(`https://${s}/abc`)).toContain("shortener");
    expect(codes("https://www.bit.ly/abc")).toContain("shortener");
    expect(SHORTENERS).toContain("bit.ly");
    expect(SHORTENERS).toContain("t.ly");
  });

  it("unknown_domain is info and never says safe", () => {
    const a = ok("https://example.com").alerts;
    expect(a).toEqual([{ code: "unknown_domain", severity: "info" }]);
  });

  it("trailing dot and uppercase host normalise", () => {
    expect(ok("https://ELCLUB.PARTY./x").isKnown).toBe(true);
  });

  it("does not need the network (pure)", () => {
    const spy = vi.spyOn(globalThis, "fetch");
    expect(ok("https://example.com").url).toBe("https://example.com/");
    ok("https://elclub.party.evil.io");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("subdomain trick works with a unicode known domain (compared as punycode)", () => {
    const known = ["elclúb.party"];
    expect(codes("https://xn--elclb-bva.party.evil.io", known)).toContain("subdomain_trick");
  });

  describe("brand in the name", () => {
    it.each([
      "https://metamask-support.io",
      "https://coinbase-login.com",
      "https://elclub-party.com",
      "https://secure-elclub.party",
      "https://metamask.evil.com",
      "https://elclub.pages.dev",
    ])("%s warns brand_impersonation (medium)", (url) => {
      const a = ok(url).alerts.find((x) => x.code === "brand_impersonation");
      expect(a?.severity).toBe("medium");
      expect(a?.detail).toBeTruthy();
    });

    it.each([
      "https://database.com",
      "https://github.com/x",
      "https://basecamp.com",
      "https://safebrowsing.google.com",
      "https://www.safe-example.org",
      "https://elclub.party",
      "https://app.metamask.io",
    ])("%s has no medium/high alert", (url) => {
      const bad = ok(url).alerts.filter((x) => x.severity !== "info");
      expect(bad).toEqual([]);
    });
  });
  describe("lookalike false positives (final review item 2)", () => {
    const sev = (url: string, code: string) => ok(url).alerts.find((a) => a.code === code)?.severity;

    it.each([
      "https://gitlab.com",
      "https://linear.app",
      "https://x.ai",
      "https://finance.yahoo.com",
      "https://case.com",
      "https://leader.com",
    ])("%s has no high alert", (url) => {
      expect(ok(url).alerts.filter((a) => a.severity === "high")).toEqual([]);
    });

    it.each(["https://portal.arbitrum.one", "https://arbitrum.foundation", "https://arbitrum.blockscout.com", "https://base.blockscout.com/address/0x1"])(
      "the official alias %s is known, with no medium/high alert",
      (url) => {
        const r = ok(url);
        expect(r.isKnown).toBe(true);
        expect(r.alerts.filter((a) => a.severity !== "info")).toEqual([]);
      },
    );

    it("CRYPTO_BRANDS lists the official aliases", () => {
      expect(CRYPTO_BRANDS).toEqual(expect.arrayContaining(["arbitrum.one", "arbitrum.foundation", "blockscout.com"]));
    });

    it("short labels (<= 5) match by skeleton only, not by distance", () => {
      expect(codes("https://case.com")).not.toContain("lookalike");
      expect(codes("https://bose.org")).not.toContain("lookalike");
      expect(codes("https://0pensea.io")).toContain("lookalike");
    });

    it("same skeleton → high; distance only → medium", () => {
      expect(sev("https://elc1ub.party", "lookalike")).toBe("high");
      expect(sev("https://e1club.party", "lookalike")).toBe("high");
      expect(sev("https://uniswap.com", "lookalike")).toBe("high");
      expect(sev("https://elcub.party", "lookalike")).toBe("medium");
      expect(sev("https://binence.com", "lookalike")).toBe("medium");
      expect(sev("https://metamaskk.io", "lookalike")).toBe("medium");
    });

    it("skeleton equality needs labels of 3+ characters", () => {
      expect(codes("https://x.ai", ["x.com"])).not.toContain("lookalike");
      expect(codes("https://ab.io", ["ab.com"])).not.toContain("lookalike");
      expect(codes("https://abc.io", ["abc.com"])).toContain("lookalike");
    });

    it("the phishing cases still alert", () => {
      expect(codes("https://metamask-support.io")).toContain("brand_impersonation");
      expect(codes("https://rnetamask.io")).toContain("lookalike");
      expect(codes("https://elclub.party.evil.io")).toContain("subdomain_trick");
      expect(codes("https://arbitrum-claim.io")).toContain("brand_impersonation");
    });
  });
});
