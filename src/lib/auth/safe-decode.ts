/** decodeURIComponent that never throws: malformed input falls back to the raw string. */
export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
