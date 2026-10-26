import { describe, expect, it } from "vitest";
import { es } from "../../../src/lib/i18n/dictionaries/es";
import { en } from "../../../src/lib/i18n/dictionaries/en";

// Criterio de títulos de la web pública: directos, sin símbolos «especiales»
// y sin punto final (el punto de la marca «ElClub.» sí se queda).
const KEYS = new Set([
  "title", "kicker", "metaTitle", "ogKicker", "ogFooter", "ogFoot", "ogTagline", "tagline", "builtOn",
]);
const SECTIONS = [
  "connect", "giveaways", "landing", "tools", "start", "checker", "pay", "donate",
  "vouches", "approvals", "multisend", "gas", "footer",
];
// Maquetas de ejemplo de /start.
const SKIP = [/^start\.noise\.thread(\.|$)/, /^start\.noise\.chatter(\.|$)/, /^start\.ticker(\.|$)/];

function collect(node: unknown, path: string, out: [string, string][]) {
  if (SKIP.some((re) => re.test(path))) return;
  if (typeof node === "string") {
    const last = path.split(".").pop() as string;
    if (KEYS.has(last)) out.push([path, node]);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => collect(v, `${path}.${i}`, out));
    return;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) collect(v, path ? `${path}.${k}` : k, out);
  }
}

function casesFor(lang: string, dict: Record<string, unknown>) {
  const out: [string, string][] = [];
  for (const s of SECTIONS) collect(dict[s], s, out);
  return out.map(([p, t]) => [`${lang}:${p}`, t, p] as const);
}

const cases = [...casesFor("es", es), ...casesFor("en", en)];

describe("estilo de títulos", () => {
  it("encuentra títulos que comprobar", () => expect(cases.length).toBeGreaterThan(40));

  it.each(cases)("%s: %s es un título directo", (_id, text, path) => {
    const body = /^(landing|start)\.metaTitle$/.test(path) ? text.replace(/^ElClub\. · /, "") : text;
    expect(body).not.toMatch(/[·:—→]|\/\//);
    expect(body.replace(/ElClub\.$/, "ElClub")).not.toMatch(/\.$/);
  });

  it("el español dice cripto", () => expect(JSON.stringify(es)).not.toMatch(/\bcrypto\b/i));

  it("fija las elecciones del dueño", () => {
    expect(es.landing.hero.title).toBe("Herramientas cripto gratis y seguras");
    expect(en.landing.hero.title).toBe("Free and safe crypto tools");
    expect(es.landing.hero.kicker).toBe("En Base y Arbitrum");
    expect(es.landing.demo.title).toBe("Un sorteo en la blockchain");
    expect(es.landing.networks.title).toBe("Construido en Base y Arbitrum");
    expect(es.landing.club.title).toBe("Un foro privado por invitación");
    expect(es.landing.final.title).toBe("Empieza gratis");
    expect(es.landing.metaTitle).toBe("ElClub. · Herramientas cripto gratis y seguras");
    expect(es.start.hero.tagline).toBe("Foro cripto privado para todos los niveles");
    expect(en.start.hero.tagline).toBe("A private crypto forum for every level");
  });
});
