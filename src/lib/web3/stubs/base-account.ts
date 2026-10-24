// Stub de `@base-org/account`: el conector Base Account de wagmi (no se usa: solo
// MetaMask y OKX) lo importa dinámicamente y arrastra @coinbase/cdp-sdk -> @x402/*,
// que no resuelven con Turbopack. Ver next.config.ts.
export function createBaseAccountSDK(): never {
  throw new Error("Base Account no está habilitado en ElClub.");
}
