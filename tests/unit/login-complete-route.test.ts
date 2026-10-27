import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const completeLogin = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/actions", () => ({ completeLogin }));

import { GET } from "@/app/foro/(gate)/login/complete/route";

const call = (qs = "", site: string | null = "none") =>
  GET(
    new NextRequest(`http://localhost:3000/foro/login/complete${qs}`, {
      headers: site === null ? {} : { "sec-fetch-site": site },
    }),
  );

describe("GET /foro/login/complete", () => {
  beforeEach(() => {
    completeLogin.mockReset();
  });

  it("passes the invite code and redirects to the outcome", async () => {
    completeLogin.mockResolvedValue({ redirectTo: "/foro/invite/abc?error=invite_expired" });
    const res = await call("?invite=abc");
    expect(completeLogin).toHaveBeenCalledWith("abc");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/foro/invite/abc?error=invite_expired");
  });

  it("passes null without an invite", async () => {
    completeLogin.mockResolvedValue({ redirectTo: "/foro/no-access" });
    const res = await call();
    expect(completeLogin).toHaveBeenCalledWith(null);
    expect(res.headers.get("location")).toBe("http://localhost:3000/foro/no-access");
  });

  it.each(["invite_not_found", "unknown"])("passes the specific error %s through to /foro/no-access like the JS path", async (error) => {
    completeLogin.mockResolvedValue({ redirectTo: "/foro/no-access", error });
    const res = await call("?invite=abc");
    expect(res.headers.get("location")).toBe(`http://localhost:3000/foro/no-access?error=${error}`);
  });

  it("honours a safe next only when the outcome is the club home", async () => {
    completeLogin.mockResolvedValue({ redirectTo: "/foro" });
    expect((await call("?next=/foro/invites")).headers.get("location")).toBe("http://localhost:3000/foro/invites");
  });

  it("club login with next=/ lands on the club home, not the landing", async () => {
    completeLogin.mockResolvedValue({ redirectTo: "/foro" });
    expect((await call("?next=/")).headers.get("location")).toBe("http://localhost:3000/foro");
  });

  it("ignores an unsafe next (back to the club home, R1-R4)", async () => {
    completeLogin.mockResolvedValue({ redirectTo: "/foro" });
    expect((await call("?next=//evil.com")).headers.get("location")).toBe("http://localhost:3000/foro");
    expect((await call("?next=/foro/login")).headers.get("location")).toBe("http://localhost:3000/foro");
  });

  it.each(["/%09/evil.com", "/%0a/evil.com", "/%20/evil.com", "/%5cevil.com"])(
    "never redirects off-origin for next=%s",
    async (next) => {
      completeLogin.mockResolvedValue({ redirectTo: "/foro" });
      const loc = (await call(`?next=${next}`)).headers.get("location")!;
      expect(new URL(loc).origin).toBe("http://localhost:3000");
      expect(loc).toBe("http://localhost:3000/foro");
    },
  );

  it("falls back to the club home if the target resolves off-origin", async () => {
    completeLogin.mockResolvedValue({ redirectTo: "//evil.com" });
    expect((await call()).headers.get("location")).toBe("http://localhost:3000/foro");
  });

  it("never lets next override a non-home outcome", async () => {
    completeLogin.mockResolvedValue({ redirectTo: "/foro/banned" });
    expect((await call("?next=/foro/invites")).headers.get("location")).toBe("http://localhost:3000/foro/banned");
  });

  it("public mode (P2-R16): completeLogin in public mode, back to next with its query", async () => {
    completeLogin.mockResolvedValue({ redirectTo: "public" });
    const res = await call("?mode=public&next=" + encodeURIComponent("/herramientas/sorteos/x?join=1"));
    expect(completeLogin).toHaveBeenCalledWith(null, "public");
    expect(res.headers.get("location")).toBe("http://localhost:3000/herramientas/sorteos/x?join=1");
  });

  it("public mode never redeems an invite and sends a banned wallet to /foro/banned", async () => {
    completeLogin.mockResolvedValue({ redirectTo: "/foro/banned" });
    const res = await call("?mode=public&invite=abc&next=/en/tools");
    expect(completeLogin).toHaveBeenCalledWith(null, "public");
    expect(res.headers.get("location")).toBe("http://localhost:3000/foro/banned");
  });

  it("public mode with the session lost (/foro/login) goes back to the public page, not to the club login", async () => {
    completeLogin.mockResolvedValue({ redirectTo: "/foro/login" });
    const res = await call("?mode=public&next=" + encodeURIComponent("/en/tools/giveaways"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/en/tools/giveaways");
  });

  it("public mode with registration closed goes back to next flagged ?registration=closed, keeping its query (A-R13)", async () => {
    completeLogin.mockResolvedValue({ redirectTo: "public", error: "registration_closed" });
    expect((await call("?mode=public&next=" + encodeURIComponent("/herramientas/sorteos/x?join=1"))).headers.get("location")).toBe(
      "http://localhost:3000/herramientas/sorteos/x?join=1&registration=closed",
    );
    expect((await call("?mode=public&next=//evil.com")).headers.get("location")).toBe("http://localhost:3000/?registration=closed");
  });

  it("public mode ignores an unsafe next (back to the landing)", async () => {
    completeLogin.mockResolvedValue({ redirectTo: "public" });
    expect((await call("?mode=public&next=//evil.com")).headers.get("location")).toBe("http://localhost:3000/");
    expect((await call("?mode=public")).headers.get("location")).toBe("http://localhost:3000/");
  });

  it.each(["same-origin", "none"])("proceeds when Sec-Fetch-Site is %s", async (site) => {
    completeLogin.mockResolvedValue({ redirectTo: "/foro" });
    await call("", site);
    expect(completeLogin).toHaveBeenCalledTimes(1);
  });

  it.each(["cross-site", "same-site", null])("does not run completeLogin when Sec-Fetch-Site is %s", async (site) => {
    const res = await call("?invite=abc", site);
    expect(completeLogin).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("http://localhost:3000/foro/login");
  });
});

// Docker standalone on PRE: Next binds HOSTNAME=0.0.0.0:3000 behind the Cloudflare Tunnel, so the request URL is the
// bind address. Every redirect must point at the public site (NEXT_PUBLIC_SITE_URL), never at https://0.0.0.0:3000.
describe("GET /foro/login/complete behind the tunnel (public origin)", () => {
  const docker = (qs: string, site: string | null = "none") =>
    GET(
      new NextRequest(`http://0.0.0.0:3000/foro/login/complete${qs}`, {
        headers: site === null ? {} : { "sec-fetch-site": site },
      }),
    );

  beforeEach(() => {
    completeLogin.mockReset();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://pre.elclub.party");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("public mode goes back to next on the public host", async () => {
    completeLogin.mockResolvedValue({ redirectTo: "public" });
    const res = await docker("?mode=public&next=/herramientas");
    expect(res.headers.get("location")).toBe("https://pre.elclub.party/herramientas");
  });

  it("public mode with a lost session keeps next's query on the public host", async () => {
    completeLogin.mockResolvedValue({ redirectTo: "/foro/login" });
    const res = await docker("?mode=public&next=" + encodeURIComponent("/herramientas/sorteos/x?join=1"));
    expect(res.headers.get("location")).toBe("https://pre.elclub.party/herramientas/sorteos/x?join=1");
  });

  it("public mode sends a banned wallet to /foro/banned on the public host", async () => {
    completeLogin.mockResolvedValue({ redirectTo: "/foro/banned" });
    expect((await docker("?mode=public&next=/en/tools")).headers.get("location")).toBe("https://pre.elclub.party/foro/banned");
  });

  it("public mode falls back to the public / for an unsafe next", async () => {
    completeLogin.mockResolvedValue({ redirectTo: "public" });
    expect((await docker("?mode=public&next=//evil.com")).headers.get("location")).toBe("https://pre.elclub.party/");
  });

  it("club login honours next on the public host", async () => {
    completeLogin.mockResolvedValue({ redirectTo: "/foro" });
    expect((await docker("?next=/foro/invites")).headers.get("location")).toBe("https://pre.elclub.party/foro/invites");
  });

  it("club login sends the outcome to the public host", async () => {
    completeLogin.mockResolvedValue({ redirectTo: "/foro/no-access", error: "unknown" });
    expect((await docker("?invite=abc")).headers.get("location")).toBe("https://pre.elclub.party/foro/no-access?error=unknown");
  });

  it("an off-origin outcome falls back to the club home on the public host", async () => {
    completeLogin.mockResolvedValue({ redirectTo: "//evil.com" });
    expect((await docker("")).headers.get("location")).toBe("https://pre.elclub.party/foro");
  });

  it("a cross-site navigation goes to the public /foro/login", async () => {
    const res = await docker("?invite=abc", "cross-site");
    expect(completeLogin).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("https://pre.elclub.party/foro/login");
  });
});
