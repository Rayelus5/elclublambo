import { describe, expect, it } from "vitest";
import { isProductionSite } from "@/lib/start/site";

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
