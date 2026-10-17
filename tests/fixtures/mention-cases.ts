import fixture from "./mention-parity.json";

// Builds the bodies of tests/fixtures/mention-parity.json. One fixture, two suites: the TS extractMentions unit test
// and the SQL _insert_mentions integration test (real DB), so the two walks cannot drift apart unnoticed.

export interface MentionCase {
  name: string;
  expected: number;
  body: unknown;
}

const EV = { type: "mention", attrs: { kind: "everyone" } };
const para = (...content: unknown[]) => ({ type: "paragraph", content });
const hola = para({ type: "text", text: "hola" });

function substitute(v: unknown, ids: { member: string; role: string }): unknown {
  if (v === "$EV") return EV;
  if (v === "$MEMBER") return ids.member;
  if (v === "$ROLE") return ids.role;
  if (Array.isArray(v)) return v.map((x) => substitute(x, ids));
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, substitute(x, ids)]));
  }
  return v;
}

function generate(spec: { nest?: number; listPairs?: number }): unknown {
  if (spec.nest !== undefined) {
    // doc is depth 0: the mention sits at depth nest + 2
    let v: unknown = para(EV);
    for (let i = 0; i < spec.nest; i++) v = { type: "blockquote", content: [v] };
    return { type: "doc", content: [hola, v] };
  }
  if (spec.listPairs !== undefined) {
    // Each loose hardBreak in a list costs the sanitizer a listItem wrap + a paragraph wrap + itself.
    const items: unknown[] = [];
    for (let i = 0; i < spec.listPairs; i++) items.push({ type: "hardBreak" }, { type: "listItem" });
    return { type: "doc", content: [{ type: "bulletList", content: items }, para(EV)] };
  }
  throw new Error("unknown generator");
}

export function mentionCases(ids: { member: string; role: string }): MentionCase[] {
  return fixture.cases.map((c) => ({
    name: c.name,
    expected: c.expected,
    body: "generate" in c && c.generate ? generate(c.generate) : substitute((c as { body: unknown }).body, ids),
  }));
}
