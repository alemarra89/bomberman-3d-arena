import type {
  ArenaPalette,
  BombAsset,
  CrateAsset,
  EffectName,
  ExplosionStyle,
  FloorAsset,
  LightingPreset,
  Theme,
  WallAsset
} from "./types";

export interface MaterialLook {
  diffuse: string;
  emissive: string;
  specular: string;
  alpha?: number;
}

export interface ThemeDefaults {
  mood: string;
  palette: ArenaPalette;
  floor: FloorAsset;
  walls: WallAsset;
  crates: CrateAsset;
  bomb: BombAsset;
  lighting: LightingPreset;
  fog: boolean;
  particles: EffectName[];
  explosion: ExplosionStyle;
}

export const themeDefaults: Record<Theme, ThemeDefaults> = {
  classic: {
    mood: "arcade concrete",
    palette: { primary: "#1D2838", secondary: "#E2E8F0", accent: "#F97316" },
    floor: "classic_floor",
    walls: "classic_wall",
    crates: "wood_crate",
    bomb: "classic_bomb",
    lighting: "neutral",
    fog: false,
    particles: [],
    explosion: "classic_cross"
  },
  space_base: {
    mood: "abandoned orbital facility",
    palette: { primary: "#06111F", secondary: "#18D9FF", accent: "#FF4FD8" },
    floor: "space_metal_grid",
    walls: "sci_fi_panels",
    crates: "energy_crate",
    bomb: "plasma_core",
    lighting: "emergency_neon",
    fog: true,
    particles: ["blue_energy_dust", "hologram_grid"],
    explosion: "energy_cross"
  },
  ice_dungeon: {
    mood: "frozen ruins",
    palette: { primary: "#082F49", secondary: "#BAE6FD", accent: "#67E8F9" },
    floor: "ice_slab",
    walls: "frozen_wall",
    crates: "ice_crate",
    bomb: "freeze_charge",
    lighting: "frozen_blue",
    fog: true,
    particles: ["snow_sparks"],
    explosion: "ice_cross"
  },
  volcano_arena: {
    mood: "unstable lava reactor",
    palette: { primary: "#220A05", secondary: "#F97316", accent: "#FACC15" },
    floor: "lava_plate",
    walls: "basalt_wall",
    crates: "magma_crate",
    bomb: "magma_bomb",
    lighting: "volcano_glow",
    fog: true,
    particles: ["ember_rain", "steam_puffs"],
    explosion: "lava_cross"
  },
  cyberpunk_city: {
    mood: "rainy neon back alley",
    palette: { primary: "#08111A", secondary: "#2DD4BF", accent: "#F472B6" },
    floor: "neon_asphalt",
    walls: "neon_wall",
    crates: "arcade_crate",
    bomb: "neon_pulse",
    lighting: "cyberpunk_magenta",
    fog: true,
    particles: ["hologram_grid", "steam_puffs"],
    explosion: "neon_cross"
  },
  dark_corruption: {
    mood: "ritual void arena",
    palette: { primary: "#09090B", secondary: "#A855F7", accent: "#22D3EE" },
    floor: "corrupted_stone",
    walls: "shadow_obelisk",
    crates: "void_crate",
    bomb: "dark_orb",
    lighting: "dark_ritual",
    fog: true,
    particles: ["purple_fog"],
    explosion: "void_cross"
  },
  toy_world: {
    mood: "playful toy workshop",
    palette: { primary: "#6DBD72", secondary: "#FDE68A", accent: "#FB7185" },
    floor: "foam_tiles",
    walls: "toy_blocks",
    crates: "gift_box",
    bomb: "windup_bomb",
    lighting: "playroom_warm",
    fog: false,
    particles: ["confetti_sparks"],
    explosion: "pop_cross"
  }
};

export const floorLooks: Record<FloorAsset, MaterialLook> = {
  classic_floor: { diffuse: "#253142", emissive: "#050A10", specular: "#94A3B8" },
  space_metal_grid: { diffuse: "#0C1828", emissive: "#062A3C", specular: "#7DD3FC" },
  ice_slab: { diffuse: "#78C8E8", emissive: "#0B4C6B", specular: "#E0F2FE", alpha: 0.92 },
  lava_plate: { diffuse: "#321008", emissive: "#6B2105", specular: "#FDBA74" },
  neon_asphalt: { diffuse: "#111827", emissive: "#07151A", specular: "#5EEAD4" },
  corrupted_stone: { diffuse: "#18111E", emissive: "#220A35", specular: "#C084FC" },
  foam_tiles: { diffuse: "#6DBD72", emissive: "#102311", specular: "#DCFCE7" }
};

export const wallLooks: Record<WallAsset, MaterialLook> = {
  classic_wall: { diffuse: "#748094", emissive: "#101722", specular: "#CBD5E1" },
  sci_fi_panels: { diffuse: "#182033", emissive: "#05384B", specular: "#38BDF8" },
  frozen_wall: { diffuse: "#A7F3FF", emissive: "#0E7490", specular: "#ECFEFF", alpha: 0.95 },
  basalt_wall: { diffuse: "#30241F", emissive: "#471103", specular: "#FB923C" },
  neon_wall: { diffuse: "#151522", emissive: "#34134B", specular: "#F0ABFC" },
  shadow_obelisk: { diffuse: "#100B14", emissive: "#3B0764", specular: "#E879F9" },
  toy_blocks: { diffuse: "#F7D08A", emissive: "#241506", specular: "#FFF7ED" }
};

export const crateLooks: Record<CrateAsset, MaterialLook> = {
  wood_crate: { diffuse: "#9A5A28", emissive: "#201006", specular: "#FDBA74" },
  energy_crate: { diffuse: "#0F2337", emissive: "#036985", specular: "#67E8F9" },
  ice_crate: { diffuse: "#BAE6FD", emissive: "#155E75", specular: "#FFFFFF", alpha: 0.9 },
  magma_crate: { diffuse: "#5B1C08", emissive: "#B45309", specular: "#FED7AA" },
  arcade_crate: { diffuse: "#1E1B4B", emissive: "#7E22CE", specular: "#F9A8D4" },
  void_crate: { diffuse: "#0B0710", emissive: "#581C87", specular: "#22D3EE" },
  gift_box: { diffuse: "#F59E0B", emissive: "#3A1802", specular: "#FDE68A" }
};

export const bombLooks: Record<BombAsset, MaterialLook> = {
  classic_bomb: { diffuse: "#111827", emissive: "#000000", specular: "#E5E7EB" },
  plasma_core: { diffuse: "#0F172A", emissive: "#0891B2", specular: "#A5F3FC" },
  freeze_charge: { diffuse: "#E0F2FE", emissive: "#0EA5E9", specular: "#FFFFFF" },
  magma_bomb: { diffuse: "#1C0A05", emissive: "#EA580C", specular: "#FDE68A" },
  neon_pulse: { diffuse: "#18181B", emissive: "#DB2777", specular: "#F0FDFA" },
  dark_orb: { diffuse: "#030207", emissive: "#9333EA", specular: "#67E8F9" },
  windup_bomb: { diffuse: "#334155", emissive: "#7C2D12", specular: "#FDE68A" }
};

export const lightingColors: Record<LightingPreset, { diffuse: string; ground: string; point: string }> = {
  neutral: { diffuse: "#E5E7EB", ground: "#1F2937", point: "#F97316" },
  emergency_neon: { diffuse: "#67E8F9", ground: "#03101A", point: "#FF4FD8" },
  frozen_blue: { diffuse: "#DDF8FF", ground: "#083344", point: "#67E8F9" },
  volcano_glow: { diffuse: "#FED7AA", ground: "#220A05", point: "#FB923C" },
  cyberpunk_magenta: { diffuse: "#F0ABFC", ground: "#021A18", point: "#2DD4BF" },
  dark_ritual: { diffuse: "#C084FC", ground: "#030207", point: "#22D3EE" },
  playroom_warm: { diffuse: "#FFF7ED", ground: "#14532D", point: "#FB7185" }
};

export const effectColors: Record<EffectName, string> = {
  blue_energy_dust: "#18D9FF",
  steam_puffs: "#E5E7EB",
  snow_sparks: "#E0F2FE",
  ember_rain: "#FB923C",
  hologram_grid: "#22D3EE",
  purple_fog: "#A855F7",
  confetti_sparks: "#FB7185"
};

export const explosionColors: Record<ExplosionStyle, string> = {
  classic_cross: "#F97316",
  energy_cross: "#18D9FF",
  ice_cross: "#BAE6FD",
  lava_cross: "#FB923C",
  neon_cross: "#F472B6",
  void_cross: "#A855F7",
  pop_cross: "#FDE68A"
};
