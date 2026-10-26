// `#gastos=<payload>`: the whole split lives in the URL fragment (P6-R4), which never reaches the server, its logs or the
// Referer, and leaves nothing stored on the device. `v1.` = base64url(deflate-raw(JSON)) with CompressionStream;
// `j1.` = base64url(JSON) where the browser lacks it. Anything malformed or too big decodes to null.

import { toAddress } from "@/lib/multisend/parse";
import { normalizeAlias } from "@/lib/pay/alias";
import { parseAmount } from "@/lib/payments/amounts";

export type SplitState = { v: 1; people: Array<{ n: string; p: string; t?: string }> };

export const SPLIT_PREFIX = "gastos=";
export const MAX_PEOPLE = 20;
export const MAX_NAME = 24;
/**
 * Input caps for «Pagó» and «Dirección o alias». With MAX_NAME they keep a maxed split (20 people, names of escaped
 * control characters, full addresses) under MAX_SPLIT_FRAGMENT even uncompressed (pinned by state.test.ts).
 */
export const MAX_AMOUNT_INPUT = 20;
export const MAX_TARGET_INPUT = 64;
/** The longest payload accepted, in characters. */
export const MAX_SPLIT_FRAGMENT = 8192;
/** The most bytes a payload may inflate to (a deflate bomb stops here). */
const MAX_JSON_BYTES = 16_384;
const B64URL = /^[A-Za-z0-9_-]+$/;
const FORMAT = "deflate-raw";

/** Characters as people count them (an emoji is one), for the name limit. */
export const nameLength = (name: string) => [...name].length;

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!B64URL.test(text)) return null;
  try {
    return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** A deflate-raw stream, or null where the browser has none (or not this format). */
function stream(kind: "compress" | "decompress"): TransformStream<Uint8Array, Uint8Array> | null {
  try {
    const Ctor = kind === "compress" ? globalThis.CompressionStream : globalThis.DecompressionStream;
    return typeof Ctor === "function" ? (new Ctor(FORMAT) as TransformStream<Uint8Array, Uint8Array>) : null;
  } catch {
    return null;
  }
}

/** Pushes `bytes` through `ts` and collects the output; null past `cap` bytes or on a stream error. */
async function pipe(ts: TransformStream<Uint8Array, Uint8Array>, bytes: Uint8Array, cap: number): Promise<Uint8Array | null> {
  const writer = ts.writable.getWriter();
  // A corrupt input errors the readable side; these promises then reject and are read through the reader instead.
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  const reader = ts.readable.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > cap) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** The payload (without `#gastos=`) for this split: compressed when the browser can, plain otherwise. */
export async function encodeSplit(s: SplitState): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(s));
  const ts = stream("compress");
  const packed = ts ? await pipe(ts, json, Number.MAX_SAFE_INTEGER) : null;
  return packed ? `v1.${toBase64Url(packed)}` : `j1.${toBase64Url(json)}`;
}

/**
 * Where a person gets paid: a full address, or an ElClub Pay alias (normalized, not reserved). "0x…" must be a whole
 * address that the multisend list would accept too (a mixed-case address needs a valid EIP-55 checksum).
 */
export function validTarget(t: unknown): t is string {
  if (typeof t !== "string") return false;
  if (/^0x/i.test(t)) return toAddress(t) !== null;
  const a = normalizeAlias(t);
  return a.ok && a.alias === t;
}

/** A clean SplitState from parsed JSON, or null when anything is off. Unknown keys are dropped. */
function validate(raw: unknown): SplitState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { v, people } = raw as { v?: unknown; people?: unknown };
  if (v !== 1 || !Array.isArray(people) || people.length < 1 || people.length > MAX_PEOPLE) return null;
  const out: SplitState["people"] = [];
  for (const person of people as unknown[]) {
    if (typeof person !== "object" || person === null) return null;
    const { n, p, t } = person as { n?: unknown; p?: unknown; t?: unknown };
    if (typeof n !== "string" || nameLength(n) > MAX_NAME) return null;
    if (typeof p !== "string" || parseAmount(p, "USDC") === null) return null;
    if (t !== undefined && !validTarget(t)) return null;
    out.push(t === undefined ? { n, p } : { n, p, t });
  }
  return { v: 1, people: out };
}

/** The split in a fragment (`#gastos=…`, `gastos=…` or the bare payload); null for anything malformed or too big. */
export async function decodeSplit(fragment: string): Promise<SplitState | null> {
  let h = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  if (h.startsWith(SPLIT_PREFIX)) h = h.slice(SPLIT_PREFIX.length);
  if (h.length > MAX_SPLIT_FRAGMENT) return null;
  const version = h.slice(0, 3);
  if (version !== "v1." && version !== "j1.") return null;
  const bytes = fromBase64Url(h.slice(3));
  if (bytes === null || bytes.byteLength === 0) return null;
  let json: Uint8Array | null = bytes;
  if (version === "v1.") {
    const ts = stream("decompress");
    json = ts ? await pipe(ts, bytes, MAX_JSON_BYTES) : null;
  } else if (bytes.byteLength > MAX_JSON_BYTES) {
    return null;
  }
  if (json === null) return null;
  try {
    return validate(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json)));
  } catch {
    return null;
  }
}
