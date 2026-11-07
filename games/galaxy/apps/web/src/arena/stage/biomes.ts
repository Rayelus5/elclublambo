import type { BiomeId } from '@galaxy/sim';

// The look of each sector's ground (DESIGN_SYSTEM §8 quater): the three tones of the dithered nebula (bright, mid,
// deep), the starfield's three brightnesses, the braille dust and the three rocks. All dark and low in contrast, so the
// fauna, the bullets and the warnings (always in the Static's red) read the same on every one.

export interface BiomeLook {
  nebula: [string, string, string];
  stars: [string, string, string];
  dust: string;
  rocks: [string, string, string];
}

export const BIOME_LOOK: Record<BiomeId, BiomeLook> = {
  // M3a's ground, unchanged.
  nebula: { nebula: ['#251d5a', '#171845', '#0d1534'], stars: ['#bfe3ff', '#8890c4', '#2a2f5e'], dust: '#8890c4', rocks: ['rock-1', 'rock-2', 'rock-3'] },
  // Cold blue haze and white stars.
  ice: { nebula: ['#1c3560', '#132849', '#0b1b36'], stars: ['#f3f5ff', '#9fc4e8', '#2a3f66'], dust: '#9fc4e8', rocks: ['ice-1', 'ice-2', 'ice-3'] },
  // Violet and teal glow of a reef in the dark.
  reef: { nebula: ['#3a1a4c', '#16304a', '#0c2230'], stars: ['#ffd6e6', '#5fc9bb', '#2a2f5e'], dust: '#5fc9bb', rocks: ['coral-1', 'coral-2', 'coral-3'] },
  // Smoke and embers: deep brown, never close to the warnings' red.
  forge: { nebula: ['#3a1e1a', '#2a1519', '#170e16'], stars: ['#ffd7a8', '#b0745a', '#3a2430'], dust: '#b0745a', rocks: ['slag-1', 'slag-2', 'slag-3'] },
  // The rift: violet static.
  rift: { nebula: ['#3a1050', '#1f0d3a', '#0f0b26'], stars: ['#f0b8ff', '#6fe3ff', '#2a2050'], dust: '#b39dff', rocks: ['rift-1', 'rift-2', 'rift-3'] },
};
