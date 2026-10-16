import { describe, expect, it } from "vitest";
import { buildTree, findPath, formatSlowmode, type ChannelRow } from "@/lib/channels/tree";

const row = (id: string, parentId: string | null, kind: ChannelRow["kind"], position: number): ChannelRow => ({
  id,
  parentId,
  kind,
  name: id,
  topic: null,
  position,
});

describe("buildTree", () => {
  it("sorts siblings by position and nests children", () => {
    const tree = buildTree([
      row("b", null, "category", 2),
      row("a", null, "category", 1),
      row("a2", "a", "text", 2),
      row("a1", "a", "forum", 1),
      row("a1x", "a1", "text", 1),
    ]);
    expect(tree.map((n) => n.id)).toEqual(["a", "b"]);
    expect(tree[0]!.children.map((n) => n.id)).toEqual(["a1", "a2"]);
    expect(tree[0]!.children[0]!.children.map((n) => n.id)).toEqual(["a1x"]);
    expect(tree[1]!.children).toEqual([]);
  });

  it("drops orphans whose parent is not visible (and their descendants)", () => {
    const tree = buildTree([row("a", null, "category", 1), row("x", "hidden", "forum", 1), row("y", "x", "text", 1)]);
    expect(tree.map((n) => n.id)).toEqual(["a"]);
    expect(JSON.stringify(tree)).not.toContain('"y"');
  });

  it("returns an empty tree for no rows", () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe("formatSlowmode", () => {
  it.each([
    [5, "5 s"],
    [90, "90 s"],
    [60, "1 min"],
    [120, "2 min"],
    [3600, "1 h"],
    [7200, "2 h"],
    [86400, "1 día"],
    [172800, "2 días"],
    [604800, "1 semana"],
    [3661, "3661 s"],
  ])("%i -> %s", (s, text) => {
    expect(formatSlowmode(s)).toBe(text);
  });
});

describe("findPath", () => {
  const tree = buildTree([
    row("cat", null, "category", 1),
    row("forum", "cat", "forum", 1),
    row("leaf", "forum", "text", 1),
  ]);

  it("returns root-to-node ids", () => {
    expect(findPath(tree, "leaf").map((n) => n.id)).toEqual(["cat", "forum", "leaf"]);
    expect(findPath(tree, "cat").map((n) => n.id)).toEqual(["cat"]);
  });

  it("returns an empty path when absent", () => {
    expect(findPath(tree, "nope")).toEqual([]);
  });
});
