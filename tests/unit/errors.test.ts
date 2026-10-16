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
