export const GUIDE_SECTIONS = [
  { slug: "propinas", title: "Propinas", summary: "Cómo premiar un mensaje o un perfil con ETH o USDC, sin intermediarios." },
  { slug: "bounties", title: "Bounties", summary: "Cómo pedir ayuda con una recompensa y cómo se paga a quien resuelve." },
  { slug: "dao", title: "DAO y shares", summary: "Cómo aportar USDC a la tesorería común y qué significa tu porcentaje." },
  { slug: "fondo", title: "El fondo común", summary: "Cómo se valora el fondo, qué es el Fondo del club y qué riesgo asumes al donar." },
  { slug: "encuestas", title: "Encuestas", summary: "Cómo se vota en secreto, cuánto pesa tu voto y cuándo se ven los resultados." },
  { slug: "candados", title: "Canales con candado", summary: "Qué requisitos piden algunos canales y dónde ves si los cumples." },
  { slug: "redes", title: "Redes y seguridad", summary: "Modo prueba o dinero real, y cómo reconocer un intento de estafa." },
] as const;

export type GuideSlug = (typeof GUIDE_SECTIONS)[number]["slug"];

export function isGuideSlug(value: string): value is GuideSlug {
  return GUIDE_SECTIONS.some((s) => s.slug === value);
}
