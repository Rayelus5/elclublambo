import { describe, it, expect } from "vitest";
import { rpcErrorMessage, rpcErrorCode, knownErrorCode } from "@/lib/errors";

describe("knownErrorCode", () => {
  it("allowlists known codes only", () => {
    expect(knownErrorCode("forbidden")).toBe("forbidden");
    expect(knownErrorCode("<script>")).toBeNull();
    expect(knownErrorCode("toString")).toBeNull();
    expect(knownErrorCode(undefined)).toBeNull();
    expect(knownErrorCode(["forbidden"])).toBeNull();
  });
});

const FALLBACK = "Algo falló. Inténtalo de nuevo.";

describe("rpcErrorMessage", () => {
  it("F4a-R12 safe_change_blocked has Spanish copy and is allowlisted", () => {
    expect(rpcErrorCode({ message: "safe_change_blocked" })).toBe("safe_change_blocked");
    expect(rpcErrorMessage("safe_change_blocked")).toMatch(/Safe/);
    expect(rpcErrorMessage("safe_change_blocked")).toMatch(/participaciones|donaciones/);
  });
  it("F4c safe_changed has its exact Spanish copy and is allowlisted", () => {
    expect(rpcErrorCode({ message: "safe_changed" })).toBe("safe_changed");
    expect(rpcErrorMessage("safe_changed")).toBe("La Safe de esta red cambió durante la operación. Vuelve a intentarlo.");
  });
  it.each([
    ["invite_expired", "caducado"],
    ["invite_exhausted", "agotada"],
    ["invite_revoked", "anulada"],
    ["invite_not_found", "no existe"],
    ["already_member", "ya eres miembro"],
    ["forbidden", "No tienes permiso"],
  ])("%s contains %s", (code, text) => {
    expect(rpcErrorMessage(code)).toContain(text);
  });
  it.each(["bootstrap_closed", "wallet_mismatch", "hierarchy", "invalid_input", "not_authenticated", "not_member"])(
    "%s has specific copy",
    (code) => {
      expect(rpcErrorMessage(code)).not.toBe(FALLBACK);
    },
  );
  it("has Spanish copy for tree errors", () => {
    expect(rpcErrorMessage("not_empty")).toBe("El canal tiene subcanales; muévelos o bórralos antes.");
    expect(rpcErrorMessage("invalid_tree")).toBe("Ese movimiento rompería la estructura del árbol.");
    expect(rpcErrorMessage("depth_limit")).toBe("Se ha superado la profundidad máxima (6 niveles).");
    expect(rpcErrorCode({ message: "depth_limit" })).toBe("depth_limit");
    expect(knownErrorCode("not_empty")).toBe("not_empty");
  });
  it.each(["slowmode", "not_a_contract", "too_long", "too_many_attachments", "too_many_reactions", "thread_invalid"])(
    "chat error %s has specific copy and is allowlisted",
    (code) => {
      expect(rpcErrorMessage(code)).not.toBe(FALLBACK);
      expect(rpcErrorCode({ message: code })).toBe(code);
    },
  );
  it.each(["rate_limited", "already_reported", "ticket_closed", "too_many_open_tickets"])(
    "F2c error %s has specific copy and is allowlisted",
    (code) => {
      expect(rpcErrorMessage(code)).not.toBe(FALLBACK);
      expect(rpcErrorCode({ message: code })).toBe(code);
      expect(knownErrorCode(code)).toBe(code);
    },
  );
  it("slowmode copy", () =>
    expect(rpcErrorMessage("slowmode")).toBe("Vas demasiado rápido. Espera un poco antes de volver a escribir."));
  it("hierarchy copy covers rank and missing permissions", () => {
    expect(rpcErrorMessage("hierarchy")).toBe(
      "No puedes hacerlo: afecta a un rango igual o superior al tuyo o a permisos que no tienes.",
    );
  });
  it("has Spanish copy for safe_equals_platform", () => {
    expect(rpcErrorCode({ message: "safe_equals_platform" })).toBe("safe_equals_platform");
    expect(rpcErrorMessage("safe_equals_platform")).toBe("La wallet de la plataforma no puede ser la misma que la Safe de la tesorería.");
  });
  it("has Spanish copy for bounty_has_solution", () => {
    expect(rpcErrorCode({ message: "bounty_has_solution" })).toBe("bounty_has_solution");
    expect(rpcErrorMessage("bounty_has_solution")).toBe("No puedes borrar un bounty con una solución elegida sin pagar.");
  });
  it.each([
    ["withdrawals_disabled", "Las retiradas no están activadas en esta red."],
    ["withdrawal_exists", "Ya tienes una retirada en curso. Cancélala o espera a que se resuelva."],
    ["insufficient_shares", "No tienes tantas participaciones."],
    ["amount_too_small", "La retirada mínima es de 1 USDC, salvo que retires todas tus participaciones."],
    ["nav_not_ready", "El fondo aún no tiene valoración. Inténtalo tras la próxima."],
    ["reason_required", "Escribe un motivo de 1 a 280 caracteres."],
    ["approval_expired", "La aprobación de esta retirada caducó. Vuelve a aprobarla al precio actual."],
  ])("F4c withdrawal error %s has its exact copy", (code, copy) => {
    expect(rpcErrorCode({ message: code })).toBe(code);
    expect(rpcErrorMessage(code)).toBe(copy);
  });
  it.each([
    ["raffle_closed", "El sorteo ya está cerrado."],
    ["raffle_drawn", "Un sorteo ya resuelto no se puede cancelar: el premio es del ganador."],
    ["weighted_raffles_disabled", "Los sorteos ponderados no están activados en esta red."],
    ["prize_too_small", "El premio mínimo es 1 USDC o 0,001 WETH."],
    ["prize_too_large", "El premio no puede superar la mitad del valor del fondo."],
    ["closes_at_invalid", "El cierre debe estar entre 1 hora y 30 días desde ahora."],
    ["title_required", "Escribe un título de 1 a 80 caracteres."],
    ["draw_block_invalid", "Ese bloque no es el primero posterior al cierre."],
  ])("F4d raffle error %s has its exact copy", (code, copy) => {
    expect(rpcErrorCode({ message: code })).toBe(code);
    expect(rpcErrorMessage(code)).toBe(copy);
  });
  it("falls back for unknown", () => expect(rpcErrorMessage("zzz")).toBe(FALLBACK));
});

describe("rpcErrorCode", () => {
  it("extracts a known code", () => expect(rpcErrorCode({ message: "invite_expired" })).toBe("invite_expired"));
  it("maps deadlock/serialization pg codes to retry", () => {
    expect(rpcErrorCode({ code: "40P01", message: "deadlock detected" })).toBe("retry");
    expect(rpcErrorCode({ code: "40001", message: "could not serialize" })).toBe("retry");
    expect(rpcErrorMessage("retry")).toBe("Hubo un conflicto con otra acción. Inténtalo de nuevo.");
  });
  it("unknown otherwise", () => {
    expect(rpcErrorCode({ message: "boom" })).toBe("unknown");
    expect(rpcErrorCode(null)).toBe("unknown");
    expect(rpcErrorCode(undefined)).toBe("unknown");
  });
});
