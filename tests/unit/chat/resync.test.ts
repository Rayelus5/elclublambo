import { describe, expect, it } from "vitest";
import { keepSignedUrls, replaceNewest } from "@/lib/chat/model";
import { makeMessage } from "./fixtures";

const at = (h: number) => new Date(Date.UTC(2026, 9, 17, h, 0, 0)).toISOString();

describe("replaceNewest (resync)", () => {
  const a = makeMessage({ createdAt: at(9) });
  const b = makeMessage({ createdAt: at(10) });
  const c = makeMessage({ createdAt: at(11) });

  it("keeps what is older than the fresh page and replaces the rest, so hard-deleted messages disappear", () => {
    const out = replaceNewest([a, b, c], [b], true);
    expect(out.map((m) => m.id)).toEqual([a.id, b.id]);
  });

  it("when the fresh page is the whole history it is the window", () => {
    expect(replaceNewest([a, b, c], [c], false).map((m) => m.id)).toEqual([c.id]);
  });

  it("an empty fresh page empties the window", () => {
    expect(replaceNewest([a, b], [], false)).toEqual([]);
  });

  it("adds messages that appeared meanwhile", () => {
    expect(replaceNewest([a], [b, c], true).map((m) => m.id)).toEqual([a.id, b.id, c.id]);
  });
});

describe("keepSignedUrls", () => {
  const att = (id: string, url: string | null) => ({ id, url, mime: "image/png", width: 1, height: 1 });

  it("reuses the existing URL of the same attachment so images are not downloaded again", () => {
    const old = makeMessage({ attachments: [att("1", "https://old/1")] });
    const fresh = { ...old, attachments: [att("1", "https://new/1"), att("2", "https://new/2")] };
    const out = keepSignedUrls([old], [fresh]);
    expect(out[0]!.attachments.map((x) => x.url)).toEqual(["https://old/1", "https://new/2"]);
  });

  it("leaves messages without a previous copy alone, and replaces a missing old URL", () => {
    const lone = makeMessage({ attachments: [att("1", "https://new/1")] });
    expect(keepSignedUrls([], [lone])).toEqual([lone]);
    const old = { ...lone, attachments: [att("1", null)] };
    expect(keepSignedUrls([old], [lone])[0]!.attachments[0]!.url).toBe("https://new/1");
  });
});
