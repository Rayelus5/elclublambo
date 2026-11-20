import { DISCORD_URL } from '@galaxy/shared';

// The public facts of galaxysurvivor.es (plan «galaxysurvivor.es», PR 4).
export const SITE = {
  origin: 'https://galaxysurvivor.es',
  name: 'Galaxy Survivor',
  company: 'GALAXY SURVIVOR',
  contact: 'contacto@rayelus.com',
  discord: DISCORD_URL,
  /** Where «Jugar gratis» and «Ya tengo cuenta» go: the game, which stays under /galaxy. */
  play: '/galaxy/crear-cuenta',
  login: '/galaxy/entrar',
  /** The social card (public/og); a new design gets a new version in its name. */
  ogImage: '/og/og-es-v1.jpg',
  /** Fixed-name screenshots for structured data (public/shots). */
  shots: ['/shots/incursion.webp', '/shots/nucleo.webp', '/shots/grupo.webp'],
} as const;
