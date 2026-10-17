import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

// jsdom no trae ResizeObserver (Radix y dnd-kit lo usan).
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom no calcula layout: ProseMirror (Tiptap) pide rectángulos al hacer scrollIntoView / coordsAtPos.
const emptyRect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON() {} };
const noRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
if (typeof Range !== "undefined") {
  Range.prototype.getClientRects ??= noRects;
  Range.prototype.getBoundingClientRect ??= () => emptyRect as DOMRect;
}
if (typeof Text !== "undefined") {
  (Text.prototype as unknown as { getClientRects?: () => DOMRectList }).getClientRects ??= noRects;
}
