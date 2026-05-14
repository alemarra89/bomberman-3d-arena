import { themeDefaults } from "./catalog";
import type { ArenaState, DirectorAction } from "./types";

export const initialArenaState: ArenaState = {
  theme: "classic",
  mood: themeDefaults.classic.mood,
  palette: themeDefaults.classic.palette,
  floor: themeDefaults.classic.floor,
  walls: themeDefaults.classic.walls,
  crates: themeDefaults.classic.crates,
  bomb: themeDefaults.classic.bomb,
  lighting: themeDefaults.classic.lighting,
  fog: themeDefaults.classic.fog,
  particles: themeDefaults.classic.particles,
  overlay: "AI BOMBER ARENA READY",
  cameraKick: 0,
  cameraOrbit: 0,
  explosion: null,
  mutationId: 0
};

export function applyDirectorAction(state: ArenaState, action: DirectorAction): ArenaState {
  switch (action.type) {
    case "show_overlay":
      return {
        ...state,
        overlay: action.message ?? "AI WORLD MUTATION APPLIED",
        cameraKick: state.cameraKick + 0.18,
        mutationId: Date.now()
      };
    case "camera_shake":
      return { ...state, cameraKick: state.cameraKick + (action.intensity ?? 0.5) };
    case "camera_orbit":
      return { ...state, cameraOrbit: state.cameraOrbit + (action.intensity ?? 0.5) };
    case "set_lighting":
      return action.preset ? { ...state, lighting: action.preset } : state;
    case "set_fog":
      return { ...state, fog: action.enabled ?? true };
    case "replace_floor":
      return action.asset ? { ...state, floor: action.asset as ArenaState["floor"] } : state;
    case "replace_walls":
      return action.asset ? { ...state, walls: action.asset as ArenaState["walls"] } : state;
    case "replace_crates":
      return action.asset ? { ...state, crates: action.asset as ArenaState["crates"] } : state;
    case "change_bomb_skin":
      return action.asset ? { ...state, bomb: action.asset as ArenaState["bomb"] } : state;
    case "spawn_particles":
      if (!action.effect || state.particles.includes(action.effect)) {
        return state;
      }
      return { ...state, particles: [...state.particles, action.effect] };
    case "trigger_demo_explosion":
      return {
        ...state,
        cameraKick: state.cameraKick + 0.8,
        explosion: {
          id: Date.now(),
          style: action.style ?? "classic_cross",
          cell: action.cell ?? [5, 5]
        }
      };
    default:
      return state;
  }
}

export function applyPlanTheme(state: ArenaState, theme: ArenaState["theme"], mood: string, palette: ArenaState["palette"]): ArenaState {
  const defaults = themeDefaults[theme];

  return {
    ...state,
    theme,
    mood: mood || defaults.mood,
    palette,
    floor: defaults.floor,
    walls: defaults.walls,
    crates: defaults.crates,
    bomb: defaults.bomb,
    lighting: defaults.lighting,
    fog: defaults.fog,
    particles: defaults.particles,
    mutationId: Date.now()
  };
}
