import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
);
vi.mock("next/navigation", () => ({ redirect }));

import DaoPage from "@/app/foro/(forum)/dao/page";
import RafflePage from "@/app/foro/(forum)/dao/sorteos/[id]/page";
import TreasuryPage from "@/app/foro/(forum)/dao/tesoreria/page";

describe("legacy /foro/dao routes", () => {
  it("/dao redirects to /foro/donar", () => {
    expect(() => DaoPage()).toThrow("NEXT_REDIRECT:/foro/donar");
  });
  it("/dao/tesoreria redirects to /foro/donar", () => {
    expect(() => TreasuryPage()).toThrow("NEXT_REDIRECT:/foro/donar");
  });
  it("/dao/sorteos/[id] redirects to /foro/sorteos", () => {
    expect(() => RafflePage()).toThrow("NEXT_REDIRECT:/foro/sorteos");
  });
});
