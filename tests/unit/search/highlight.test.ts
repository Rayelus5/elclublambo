import { describe, expect, it } from "vitest";
import { highlight, searchTerms } from "@/lib/search/highlight";

const joined = (parts: Array<{ text: string; match: boolean }>) => parts.map((p) => p.text).join("");
const marked = (parts: Array<{ text: string; match: boolean }>) => parts.filter((p) => p.match).map((p) => p.text);

describe("searchTerms (mirrors public._search_tsquery)", () => {
  it("splits on non-alphanumerics, lowercases, drops accents and one-letter terms", () => {
    expect(searchTerms("  Línea, ÁRBOL-7 ")).toEqual(["linea", "arbol"]);
  });
  it("drops one-letter terms BEFORE the 8-term cap", () => {
    expect(searchTerms("a b c d e f g h i j aa bb cc dd ee ff gg hh ii")).toEqual(["aa", "bb", "cc", "dd", "ee", "ff", "gg", "hh"]);
  });
  it("trims and cuts to 100 chars before tokenizing", () => {
    const q = `${"x".repeat(98)} yy zz`;
    // the 100-char cut leaves "x…x y": the one-letter tail is dropped
    expect(searchTerms(`   ${q}`)).toEqual(["x".repeat(98)]);
  });
  it("returns nothing for punctuation, emoji and tsquery syntax characters", () => {
    expect(searchTerms("& | ! : * ' \\ % _ 🙂")).toEqual([]);
    expect(searchTerms("a & b | !c:*")).toEqual([]);
  });
  it("keeps digits and non-latin letters", () => {
    expect(searchTerms("año 2026 привет")).toEqual(["ano", "2026", "привет"]);
  });
});

describe("highlight", () => {
  it("marks prefixes ignoring accents and case, without altering the text", () => {
    const parts = highlight("La línea de Árboles", "lin arb");
    expect(joined(parts)).toBe("La línea de Árboles");
    expect(marked(parts)).toEqual(["lín", "Árb"]);
  });
  it("matches by prefix only, not inside a word", () => {
    expect(marked(highlight("la línea", "nea"))).toEqual([]);
  });
  it("returns one plain segment when nothing matches or the query has no terms", () => {
    expect(highlight("hola mundo", "zzz")).toEqual([{ text: "hola mundo", match: false }]);
    expect(highlight("hola mundo", "h")).toEqual([{ text: "hola mundo", match: false }]);
    expect(highlight("", "hola")).toEqual([]);
  });
  it("never produces HTML: markup stays as literal text", () => {
    const parts = highlight("<b>hola</b> & <script>", "hola script");
    expect(joined(parts)).toBe("<b>hola</b> & <script>");
    expect(marked(parts)).toEqual(["hola", "script"]);
  });
  it("handles decomposed accents and emoji", () => {
    const parts = highlight("café 🙂 café", "cafe");
    expect(joined(parts)).toBe("café 🙂 café");
    expect(marked(parts)).toEqual(["café", "café"]);
  });
});
