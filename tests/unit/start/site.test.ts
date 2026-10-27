import { describe, expect, it } from "vitest";
import { isProductionSite, publicOrigin } from "@/lib/start/site";

describe("isProductionSite", () => {
  it.each(["https://www.elclub.party", "https://elclub.party", "https://www.elclub.party/", "https://ELCLUB.party"])("%s is production", (url) =>
    expect(isProductionSite(url)).toBe(true),
  );
  it.each([
    undefined,
    "",
    "not a url",
    "https://pre.elclub.party",
    "http://localhost:3000",
    "https://elclub.party.evil.com",
    "https://www.elclub.partyx",
  ])("%s is not production", (url) => expect(isProductionSite(url)).toBe(false));
});

// Docker (standalone) binds HOSTNAME=0.0.0.0:3000 behind the Cloudflare Tunnel: the request URL is the bind address, never
// the public host. Server-side absolute redirects must be built on the site URL when it is set.
describe("publicOrigin", () => {
  const docker = { nextUrl: new URL("http://0.0.0.0:3000/login/complete?mode=public") };

  it.each(["https://pre.elclub.party", "https://pre.elclub.party/", "https://pre.elclub.party/some/path"])(
    "uses the site URL %s over the bind address",
    (env) => expect(publicOrigin(docker, env)).toBe("https://pre.elclub.party"),
  );

  it.each([undefined, "", "not a url", "ftp://pre.elclub.party", "javascript:alert(1)"])(
    "falls back to the request origin when the site URL is %s",
    (env) => expect(publicOrigin({ nextUrl: new URL("http://localhost:3000/x") }, env)).toBe("http://localhost:3000"),
  );
});
