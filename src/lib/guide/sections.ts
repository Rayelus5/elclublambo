export const GUIDE_SECTIONS = [
  { slug: "propinas", title: "Propinas", summary: "Cómo premiar un mensaje o un perfil con ETH o USDC, sin intermediarios." },
  { slug: "bounties", title: "Bounties", summary: "Cómo pedir ayuda con una recompensa y cómo se paga a quien resuelve." },
  { slug: "donaciones", title: "Donaciones y Mecenas", summary: "Cómo donar a la Safe del club, qué recibes y cómo ver en qué se gasta." },
  { slug: "sorteos", title: "Sorteos", summary: "Sorteos gratis con la misma probabilidad para todos, y cómo comprobar al ganador." },
  { slug: "encuestas", title: "Encuestas", summary: "Cómo se vota en secreto, un miembro un voto, y cuándo se ven los resultados." },
  { slug: "candados", title: "Canales con candado", summary: "Qué canales piden haber donado y cuáles abre el rol Mecenas." },
  { slug: "redes", title: "Redes y seguridad", summary: "Modo prueba o dinero real, y cómo reconocer un intento de estafa." },
] as const;

export type GuideSlug = (typeof GUIDE_SECTIONS)[number]["slug"];

export function isGuideSlug(value: string): value is GuideSlug {
  return GUIDE_SECTIONS.some((s) => s.slug === value);
}
