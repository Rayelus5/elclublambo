import { describe, it, expect } from "vitest";
import { NextResponse } from "next/server";
import { applySessionHeaders } from "@/lib/auth/session-headers";

const cookies = [{ name: "sb-access", value: "tok", options: { path: "/" } }];
const headers = { "Cache-Control": "private, no-store", Pragma: "no-cache" };

describe("applySessionHeaders", () => {
  it("sets cookies and cache headers on a normal response", () => {
    const r = applySessionHeaders(NextResponse.next(), cookies, headers);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("pragma")).toBe("no-cache");
    expect(r.cookies.get("sb-access")?.value).toBe("tok");
  });
  it("sets them on a redirect response too", () => {
    const r = applySessionHeaders(NextResponse.redirect("http://localhost/login"), cookies, headers);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.cookies.get("sb-access")?.value).toBe("tok");
  });
});
