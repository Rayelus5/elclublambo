import { readFile } from "node:fs/promises";
import { join } from "node:path";

const font = (file: string) => readFile(join(process.cwd(), "src/assets/fonts", file));

/** The share cards' fonts, read from the app's own files (no external origin). */
export async function ogFonts() {
  const [archivo, dmSans, mono] = await Promise.all([
    font("archivo-expanded-black.ttf"),
    font("dm-sans-regular.ttf"),
    font("jetbrains-mono-regular.ttf"),
  ]);
  return [
    { name: "Archivo", data: archivo, weight: 900 as const, style: "normal" as const },
    { name: "DM Sans", data: dmSans, weight: 400 as const, style: "normal" as const },
    { name: "JetBrains Mono", data: mono, weight: 400 as const, style: "normal" as const },
  ];
}
