// Shapes of packages/engine/config/*.yaml (ENGINE_PORT §4). Field names stay snake_case, as in the YAML and in the
// Python engine, so every number can be traced back to its line. Mappings whose order matters are arrays or Maps.

export type TraitKey =
  | 'galaxy_type'
  | 'arms'
  | 'size'
  | 'inclination'
  | 'core'
  | 'star_density'
  | 'palette'
  | 'background'
  | 'phenomenon';

/** Traits of one galaxy, keys in draw order. `arms` and `inclination` only exist for some galaxy types. */
export type Traits = {
  galaxy_type: string;
  arms?: string;
  size: string;
  inclination?: string;
  core: string;
  star_density: string;
  palette: string;
  background: string;
  phenomenon: string;
};

export type Condition = Readonly<Record<string, readonly string[]>>;

export interface TraitValueSpec {
  readonly value: string;
  readonly name: string;
  readonly weight: number;
  readonly requires?: Condition;
}

export interface TraitSpec {
  readonly key: TraitKey;
  readonly label: string;
  readonly requires?: Condition;
  /** Candidate order = YAML order (it decides which value each random number picks). */
  readonly values: readonly TraitValueSpec[];
}

export type TraitRule =
  | { readonly forbid: Condition }
  | { readonly force: { readonly when: Readonly<Record<string, string>>; readonly set: Readonly<Record<string, string>> } };

export interface TraitsConfig {
  readonly drawOrder: readonly TraitKey[];
  readonly traits: Readonly<Record<TraitKey, TraitSpec>>;
  readonly rules: readonly TraitRule[];
}

export type Range = readonly [number, number];

export interface ScanlinesConfig {
  readonly period: number;
  readonly depth: number;
}

export interface GlowConfig {
  readonly enabled: boolean;
  readonly strength: number;
  readonly radii: readonly number[];
  readonly weights: readonly number[];
}

export interface PostfxConfig {
  readonly glow: GlowConfig;
  readonly vignette: number;
  readonly grain: number;
  readonly scanlines: false | ScanlinesConfig;
  readonly chromatic_aberration: number;
}

/** A palette's own post-processing: it replaces the global values (glow is merged key by key). */
export type PostfxOverride = Partial<Omit<PostfxConfig, 'glow'>> & { readonly glow?: Partial<GlowConfig> };

export interface PaletteSpec {
  readonly stops: readonly string[];
  readonly accent: string;
  readonly mode?: 'normal' | 'angular' | 'inverted';
  readonly background?: string;
  readonly blackbody_mix?: number;
  readonly detail?: { readonly color: string; readonly regions?: number; readonly halo?: number; readonly stars?: number };
  readonly postfx?: PostfxOverride;
}

export interface CoreVisual {
  readonly amplitude: number;
  readonly radius: number;
  readonly point?: number;
  readonly spikes?: number;
  readonly separation?: number;
}

export interface StarDensityVisual {
  readonly gain: number;
  readonly stars: number;
  readonly glints: number;
}

export interface BackgroundVisual {
  readonly stars: number;
  readonly level: number;
  readonly brightness: number;
  readonly distant_galaxies?: number;
}

/** Per-phenomenon numbers; each phenomenon reads its own keys (ENGINE_PORT §5.7). */
export type PhenomenonVisual = Readonly<Record<string, number | Range | PostfxOverride>>;

export interface VisualsConfig {
  readonly size: Readonly<Record<string, Range>>;
  readonly inclination: Readonly<Record<string, Range>>;
  readonly shape: Readonly<Record<string, Range>>;
  readonly core: Readonly<Record<string, CoreVisual>>;
  readonly core_scale: Readonly<Record<string, number>>;
  readonly star_density: Readonly<Record<string, StarDensityVisual>>;
  readonly background: Readonly<Record<string, BackgroundVisual>>;
  readonly phenomenon: Readonly<Record<string, PhenomenonVisual>>;
}

export interface RenderConfig {
  readonly width: number;
  readonly height: number;
  readonly format: string;
  readonly background_color: string;
  readonly blackbody_mix: number;
  readonly density_gain: number;
  readonly braille: {
    readonly columns: number;
    readonly dot_radius: number;
    readonly glint_radius: number;
    readonly dither: string;
    readonly dither_jitter: number;
    readonly min_density: number;
  };
}
