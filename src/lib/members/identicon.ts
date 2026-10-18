/** 5x5 grid mirrored around the middle column, plus a hue (0-359), derived only from the wallet. */
export function identicon(wallet: string): { cells: boolean[]; hue: number } {
  const hex = wallet.toLowerCase().replace(/^0x/, "");
  const nib = (i: number) => {
    const n = parseInt(hex[i % Math.max(hex.length, 1)] ?? "0", 16);
    return Number.isNaN(n) ? (hex.charCodeAt(i % hex.length) || 0) % 16 : n;
  };
  const cells: boolean[] = new Array(25).fill(false);
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 3; c++) {
      const on = (nib(r * 3 + c) & 1) === 1;
      cells[r * 5 + c] = on;
      cells[r * 5 + 4 - c] = on;
    }
  }
  const hue = (nib(36) * 4096 + nib(37) * 256 + nib(38) * 16 + nib(39)) % 360;
  return { cells, hue };
}
