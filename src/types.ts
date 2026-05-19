export type Theme =
  | "classic"
  | "space_base"
  | "ice_dungeon"
  | "volcano_arena"
  | "cyberpunk_city"
  | "dark_corruption"
  | "toy_world";

export type LightingPreset =
  | "neutral"
  | "emergency_neon"
  | "frozen_blue"
  | "volcano_glow"
  | "cyberpunk_magenta"
  | "dark_ritual"
  | "playroom_warm";

export type FloorAsset =
  | "classic_floor"
  | "space_metal_grid"
  | "ice_slab"
  | "lava_plate"
  | "neon_asphalt"
  | "corrupted_stone"
  | "foam_tiles";

export type WallAsset =
  | "classic_wall"
  | "sci_fi_panels"
  | "frozen_wall"
  | "basalt_wall"
  | "neon_wall"
  | "shadow_obelisk"
  | "toy_blocks";

export type CrateAsset =
  | "wood_crate"
  | "energy_crate"
  | "ice_crate"
  | "magma_crate"
  | "arcade_crate"
  | "void_crate"
  | "gift_box";

export type BombAsset =
  | "classic_bomb"
  | "plasma_core"
  | "freeze_charge"
  | "magma_bomb"
  | "neon_pulse"
  | "dark_orb"
  | "windup_bomb";

export type EffectName =
  | "blue_energy_dust"
  | "steam_puffs"
  | "snow_sparks"
  | "ember_rain"
  | "hologram_grid"
  | "purple_fog"
  | "confetti_sparks";

export type ExplosionStyle =
  | "classic_cross"
  | "energy_cross"
  | "ice_cross"
  | "lava_cross"
  | "neon_cross"
  | "void_cross"
  | "pop_cross";

export type ViewMode = "top_down" | "three_d" | "fps";
export type VisualStyle = "arcade_premium" | "toy_like" | "neon_cinematic";

export type DirectorActionType =
  | "show_overlay"
  | "camera_shake"
  | "camera_orbit"
  | "set_lighting"
  | "set_fog"
  | "replace_floor"
  | "replace_walls"
  | "replace_crates"
  | "change_bomb_skin"
  | "spawn_particles"
  | "trigger_demo_explosion";

export interface ArenaPalette {
  primary: string;
  secondary: string;
  accent: string;
}

export interface DirectorAction {
  atMs: number;
  type: DirectorActionType;
  message?: string;
  intensity?: number;
  enabled?: boolean;
  preset?: LightingPreset;
  asset?: FloorAsset | WallAsset | CrateAsset | BombAsset;
  effect?: EffectName;
  style?: ExplosionStyle;
  cell?: [number, number];
}

export interface ArenaMutationPlan {
  theme: Theme;
  mood: string;
  palette: ArenaPalette;
  timeline: DirectorAction[];
}

export interface ExplosionCue {
  id: number;
  style: ExplosionStyle;
  cell: [number, number];
}

export interface ArenaState {
  theme: Theme;
  mood: string;
  palette: ArenaPalette;
  floor: FloorAsset;
  walls: WallAsset;
  crates: CrateAsset;
  bomb: BombAsset;
  lighting: LightingPreset;
  fog: boolean;
  particles: EffectName[];
  overlay: string;
  cameraKick: number;
  cameraOrbit: number;
  explosion: ExplosionCue | null;
  mutationId: number;
}
