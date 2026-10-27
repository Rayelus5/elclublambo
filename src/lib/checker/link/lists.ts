/** Well-known crypto brands the link checker compares against besides the club's allowed domains (P4-R3). */
export const CRYPTO_BRANDS: readonly string[] = [
  "metamask.io",
  "coinbase.com",
  "binance.com",
  "uniswap.org",
  "opensea.io",
  "base.org",
  "arbitrum.io",
  // Official aliases: without them their own sites read as imitations of arbitrum.io (same label) or as brand use.
  "arbitrum.one",
  "arbitrum.foundation",
  "blockscout.com",
  "etherscan.io",
  "basescan.org",
  "arbiscan.io",
  "rabby.io",
  "phantom.app",
  "ledger.com",
  "trezor.io",
  "safe.global",
  "elclub.party",
];

/** Link shorteners: the destination is hidden, so the checker cannot say where the link goes. */
export const SHORTENERS: readonly string[] = [
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "ow.ly",
  "is.gd",
  "buff.ly",
  "cutt.ly",
  "rebrand.ly",
  "shorturl.at",
  "rb.gy",
  "t.ly",
];
