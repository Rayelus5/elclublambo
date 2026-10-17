import { describe, expect, it } from "vitest";
import { docToPlainText, extractMentions, sanitizeDoc, type TiptapNode } from "@/lib/chat/content";

const t = (text: string, marks?: unknown[]) => ({ type: "text", text, ...(marks ? { marks } : {}) });
const p = (...c: unknown[]) => ({ type: "paragraph", content: c });
const doc = (...c: unknown[]) => ({ type: "doc", content: c });

describe("sanitizeDoc", () => {
  it("never throws and returns an empty doc for malformed input", () => {
    for (const bad of [null, undefined, 1, "x", [], {}, { type: "paragraph" }, { type: "doc", content: "no" }, { type: "doc", content: [null, 3, "x"] }]) {
      expect(sanitizeDoc(bad)).toEqual({ type: "doc", content: [] });
    }
  });

  it("keeps allowed nodes and marks", () => {
    const out = sanitizeDoc(doc(p(t("hola", [{ type: "bold" }, { type: "italic" }, { type: "strike" }, { type: "code" }]))));
    expect(out.content[0]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "hola", marks: [{ type: "bold" }, { type: "italic" }, { type: "strike" }, { type: "code" }] }],
    });
  });

  it("drops unknown marks and unknown/extra attributes", () => {
    const out = sanitizeDoc(
      doc({ type: "paragraph", attrs: { onclick: "x()", style: "color:red" }, content: [t("a", [{ type: "underline" }, { type: "bold", attrs: { style: "x" } }])] }),
    );
    expect(out.content[0]).toEqual({ type: "paragraph", content: [{ type: "text", text: "a", marks: [{ type: "bold" }] }] });
  });

  it("only keeps http(s) link hrefs and strips other link attrs", () => {
    const mk = (href: unknown) => sanitizeDoc(doc(p(t("x", [{ type: "link", attrs: { href, onclick: "x()", target: "_self" } }]))));
    const ok = mk("https://github.com/a").content[0]!.content?.[0];
    expect(ok?.marks).toEqual([{ type: "link", attrs: { href: "https://github.com/a" } }]);
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "vbscript:x", "/rel", 5, null, undefined]) {
      expect(mk(bad).content[0]!.content?.[0]).toEqual({ type: "text", text: "x" });
    }
  });

  it("drops unknown nodes but keeps their text", () => {
    const out = sanitizeDoc(
      doc({ type: "script", content: [t("alert(1)")] }, p(t("a"), { type: "iframe", attrs: { src: "x" }, content: [t("inside")] }, t("b"))),
    );
    expect(docToPlainText(out)).toBe("alert(1)\nainsideb");
    expect(JSON.stringify(out)).not.toContain("iframe");
    expect(JSON.stringify(out)).not.toContain("script");
  });

  it("clamps heading level to 1-3", () => {
    const lvl = (level: unknown) => sanitizeDoc(doc({ type: "heading", attrs: { level }, content: [t("h")] })).content[0]!.attrs?.level;
    expect(lvl(1)).toBe(1);
    expect(lvl(3)).toBe(3);
    expect(lvl(4)).toBe(2);
    expect(lvl("x")).toBe(2);
    expect(lvl(0)).toBe(2);
  });

  it("keeps only plain text inside code blocks", () => {
    const out = sanitizeDoc(doc({ type: "codeBlock", attrs: { language: "js\"><script>" }, content: [t("a < b", [{ type: "bold" }]), { type: "mention", attrs: { kind: "everyone" } }] }));
    expect(out.content[0]).toEqual({ type: "codeBlock", content: [{ type: "text", text: "a < b" }] });
  });

  it("keeps tables, lists, quotes and rules", () => {
    const out = sanitizeDoc(
      doc(
        { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 2, rowspan: 1, evil: 1 }, content: [p(t("H"))] }] }, { type: "tableRow", content: [{ type: "tableCell", content: [p(t("c"))] }] }] },
        { type: "bulletList", content: [{ type: "listItem", content: [p(t("i"))] }] },
        { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [p(t("j"))] }] },
        { type: "blockquote", content: [p(t("q"))] },
        { type: "horizontalRule" },
      ),
    );
    expect(out.content.map((n) => n.type)).toEqual(["table", "bulletList", "orderedList", "blockquote", "horizontalRule"]);
    expect(out.content[0]!.content?.[0]!.content?.[0]!.attrs).toEqual({ colspan: 2, rowspan: 1 });
    expect(out.content[2]!.attrs).toEqual({ start: 3 });
  });

  it("wraps stray inline content of block containers into paragraphs", () => {
    const out = sanitizeDoc(doc(t("suelto"), { type: "blockquote", content: [t("q")] }));
    expect(out.content[0]).toEqual({ type: "paragraph", content: [{ type: "text", text: "suelto" }] });
    expect(out.content[1]!.content?.[0]!.type).toBe("paragraph");
  });

  it("keeps kind/id/label on mentions and nothing else", () => {
    const m = sanitizeDoc(doc(p({ type: "mention", attrs: { kind: "member", id: "11111111-1111-1111-1111-111111111111", label: "Fake Admin", style: "x" } })));
    expect(m.content[0]!.content?.[0]).toEqual({ type: "mention", attrs: { kind: "member", id: "11111111-1111-1111-1111-111111111111", label: "Fake Admin" } });
  });

  it("drops mentions with an invalid kind or id", () => {
    const m = sanitizeDoc(doc(p({ type: "mention", attrs: { kind: "admin", id: "x" } }, { type: "mention", attrs: { kind: "member", id: "not-a-uuid" } })));
    expect(m.content[0]?.content ?? []).toEqual([]);
  });

  it("drops nodes deeper than 40 levels (SQL cutoff) without throwing", () => {
    let node: unknown = t("deep");
    for (let i = 0; i < 100; i++) node = { type: "blockquote", content: [node] };
    const out = sanitizeDoc({ type: "doc", content: [node] });
    expect(JSON.stringify(out)).not.toContain("deep");
  });

  it("keeps content within depth 40", () => {
    let node: unknown = p(t("ok"));
    for (let i = 0; i < 30; i++) node = { type: "blockquote", content: [node] };
    expect(JSON.stringify(sanitizeDoc({ type: "doc", content: [node] }))).toContain("ok");
  });

  it("caps the total number of nodes", () => {
    const many = Array.from({ length: 20000 }, () => p(t("x")));
    const out = sanitizeDoc({ type: "doc", content: many });
    const count = (n: TiptapNode): number => 1 + (n.content ?? []).reduce((a, c) => a + count(c), 0);
    expect(count(out)).toBeLessThanOrEqual(5001);
  });

  it.each(["__proto__", "constructor", "toString", "hasOwnProperty"])("drops nodes whose type is %s", (type) => {
    const out = sanitizeDoc(JSON.parse(`{"type":"doc","content":[{"type":"${type}","content":[{"type":"paragraph","content":[{"type":"text","text":"a"}]}]}]}`));
    expect(JSON.stringify(out)).not.toContain(type);
    expect(docToPlainText(out)).toBe("a");
  });

  it("ignores prototype pollution style keys", () => {
    const evil = JSON.parse('{"type":"doc","__proto__":{"x":1},"content":[{"type":"paragraph","attrs":{"__proto__":{"y":1}},"content":[{"type":"text","text":"a"}]}]}');
    const out = sanitizeDoc(evil);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(out.content[0]!.content?.[0]!.text).toBe("a");
  });
});

// Shared samples with the SQL _doc_text (supabase/migrations/20261016200002_message_rpcs.sql).
describe("docToPlainText (mirrors SQL _doc_text)", () => {
  const mention = { type: "mention", attrs: { kind: "member", id: "11111111-1111-1111-1111-111111111111", label: "ana" } };
  const cases: Array<[string, unknown, string]> = [
    ["single paragraph", doc(p(t("hola"))), "hola"],
    ["inline joined with ''", doc(p(t("a"), t("b", [{ type: "bold" }]), t("c"))), "abc"],
    ["blocks separated by newline", doc(p(t("a")), p(t("b"))), "a\nb"],
    ["mention uses label", doc(p(t("hi "), mention)), "hi @ana"],
    ["mention without label is '@'", doc(p(t("x"), { type: "mention", attrs: { kind: "everyone" } }, t("y"))), "x@y"],
    ["hardBreak is newline", doc(p(t("a"), { type: "hardBreak" }, t("b"))), "a\nb"],
    ["nested lists", doc({ type: "bulletList", content: [{ type: "listItem", content: [p(t("a"))] }, { type: "listItem", content: [p(t("b"))] }] }), "a\nb"],
    ["table cells separated by newline", doc({ type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [p(t("a"))] }, { type: "tableCell", content: [p(t("b"))] }] }] }), "a\nb"],
    ["a non-object sibling between inlines is transparent (SQL NULL tri-state)", doc(p(t("a"), 5, t("b"))), "ab"],
    ["a typeless sibling between inlines is transparent", doc(p(t("a"), {}, t("b"))), "ab"],
    ["a typeless first sibling does not add a newline before an inline", doc(p({}, t("b"))), "b"],
    ["typeless block between blocks", doc(p(t("a")), {}, p(t("b"))), "a\n\nb"],
    ["empty paragraph between", doc(p(t("a")), p(), p(t("b"))), "a\n\nb"],
    ["horizontalRule between blocks", doc(p(t("a")), { type: "horizontalRule" }, p(t("b"))), "a\n\nb"],
    ["leading/trailing whitespace trimmed", doc(p(t("  a  ")), p()), "a"],
    ["unknown node: children joined", doc({ type: "weird", content: [t("x"), t("y")] }), "xy"],
    ["non-string text ignored", doc(p({ type: "text", text: 5 }, t("a"))), "a"],
    ["non-object children yield separators only", doc(p(t("a")), 5, p(t("b"))), "a\n\nb"],
    ["null / non-object doc", null, ""],
    ["text node root", t("solo"), "solo"],
  ];
  it.each(cases)("%s", (_n, input, expected) => expect(docToPlainText(input)).toBe(expected));

  it("ignores nesting deeper than 40 levels", () => {
    const build = (levels: number) => {
      let node: unknown = t("deep");
      for (let i = 0; i < levels; i++) node = { type: "blockquote", content: [node] };
      return node;
    };
    // root at depth 0; the text node sits at depth `levels` -> included only if levels <= 40
    expect(docToPlainText(build(40))).toBe("deep");
    expect(docToPlainText(build(41))).toBe("");
  });
});

describe("extractMentions", () => {
  const A = "11111111-1111-1111-1111-111111111111";
  const B = "22222222-2222-2222-2222-222222222222";
  it("returns deduped valid mentions in order", () => {
    const d = doc(
      p({ type: "mention", attrs: { kind: "member", id: A } }, { type: "mention", attrs: { kind: "role", id: B } }),
      p({ type: "mention", attrs: { kind: "member", id: A.toUpperCase() } }, { type: "mention", attrs: { kind: "everyone" } }, { type: "mention", attrs: { kind: "everyone", id: "ignored" } }),
    );
    expect(extractMentions(d)).toEqual([
      { kind: "member", id: A },
      { kind: "role", id: B },
      { kind: "everyone", id: null },
    ]);
  });
  it("skips invalid ids and kinds and malformed input", () => {
    expect(extractMentions(doc(p({ type: "mention", attrs: { kind: "member", id: "nope" } }, { type: "mention", attrs: { kind: "x", id: A } })))).toEqual([]);
    expect(extractMentions(null)).toEqual([]);
  });
  it("caps at 50", () => {
    const ms = Array.from({ length: 80 }, (_, i) => ({ type: "mention", attrs: { kind: "member", id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}` } }));
    expect(extractMentions(doc(p(...ms)))).toHaveLength(50);
  });
});
