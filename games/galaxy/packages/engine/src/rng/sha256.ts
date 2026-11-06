import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

// Synchronous SHA-256 (WebCrypto's is async): seeds and DNA are hashed inside tight loops.
const encoder = new TextEncoder();

export function sha256(text: string): Uint8Array {
  return nobleSha256(encoder.encode(text));
}

export function sha256Hex(text: string): string {
  return bytesToHex(sha256(text));
}
