import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
);
vi.mock("next/navigation", () => ({ redirect }));

import DaoPage from "@/app/(forum)/dao/page";
import RafflePage from "@/app/(forum)/dao/sorteos/[id]/page";
import TreasuryPage from "@/app/(forum)/dao/tesoreria/page";

describe("legacy /dao routes", () => {
  it("/dao redirects to /donar", () => {
    expect(() => DaoPage()).toThrow("NEXT_REDIRECT:/donar");
  });
  it("/dao/tesoreria redirects to /donar", () => {
    expect(() => TreasuryPage()).toThrow("NEXT_REDIRECT:/donar");
  });
  it("/dao/sorteos/[id] redirects to /sorteos", () => {
    expect(() => RafflePage()).toThrow("NEXT_REDIRECT:/sorteos");
  });
});
