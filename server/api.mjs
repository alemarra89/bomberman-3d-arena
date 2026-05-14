import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(root, "schemas", "arena-mutation-plan.schema.json");
const codexCommand = process.env.CODEX_CLI ?? "codex";
const port = Number(process.env.API_PORT ?? 8787);
const planCache = new Map();

const catalog = {
  themes: ["classic", "space_base", "ice_dungeon", "volcano_arena", "cyberpunk_city", "dark_corruption"],
  floorAssets: ["classic_floor", "space_metal_grid", "ice_slab", "lava_plate", "neon_asphalt", "corrupted_stone"],
  wallAssets: ["classic_wall", "sci_fi_panels", "frozen_wall", "basalt_wall", "neon_wall", "shadow_obelisk"],
  crateAssets: ["wood_crate", "energy_crate", "ice_crate", "magma_crate", "arcade_crate", "void_crate"],
  bombAssets: ["classic_bomb", "plasma_core", "freeze_charge", "magma_bomb", "neon_pulse", "dark_orb"],
  effects: ["blue_energy_dust", "steam_puffs", "snow_sparks", "ember_rain", "hologram_grid", "purple_fog"],
  explosionStyles: ["classic_cross", "energy_cross", "ice_cross", "lava_cross", "neon_cross", "void_cross"],
  lightingPresets: ["neutral", "emergency_neon", "frozen_blue", "volcano_glow", "cyberpunk_magenta", "dark_ritual"]
};

const systemPrompt = `You are the AI director of a 3D bomber-arena game.

Convert the user's request into an ArenaMutationPlan.

Rules:
- Return only JSON matching the provided schema.
- Do not generate code, JSX, markdown, prose, or comments.
- Do not invent assets, themes, effects, lighting presets, or action types.
- Use only the catalog below.
- The result must be dramatic on stage: include a short timeline with lighting, material swaps, particles, camera motion, and one demo explosion.
- Keep timeline durations under 3200ms.
- Prefer concrete visual direction over generic labels.

Catalog:
${JSON.stringify(catalog, null, 2)}
`;

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(payload);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

function validatePlan(plan) {
  if (!plan || typeof plan !== "object") {
    throw new Error("Codex did not return an object.");
  }

  for (const key of ["theme", "mood", "palette", "timeline"]) {
    if (!(key in plan)) {
      throw new Error(`Plan is missing "${key}".`);
    }
  }

  if (!catalog.themes.includes(plan.theme)) {
    throw new Error(`Unsupported theme "${plan.theme}".`);
  }

  if (!Array.isArray(plan.timeline) || plan.timeline.length < 4) {
    throw new Error("Plan timeline must contain at least 4 actions.");
  }

  const allowedActions = new Set([
    "show_overlay",
    "camera_shake",
    "camera_orbit",
    "set_lighting",
    "set_fog",
    "replace_floor",
    "replace_walls",
    "replace_crates",
    "change_bomb_skin",
    "spawn_particles",
    "trigger_demo_explosion"
  ]);

  for (const action of plan.timeline) {
    if (!allowedActions.has(action.type)) {
      throw new Error(`Unsupported action "${action.type}".`);
    }
  }

  return plan;
}

function extractJson(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return JSON.parse(trimmed);
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    return JSON.parse(fenced[1]);
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return JSON.parse(trimmed.slice(first, last + 1));
  }

  throw new Error("No JSON object found in Codex output.");
}

async function runCodex(userPrompt) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "bomber-director-"));
  const outputFile = path.join(tempDir, "plan.json");

  const prompt = `${systemPrompt}

User request:
${userPrompt}
`;

  const args = [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--output-schema",
    schemaPath,
    "--output-last-message",
    outputFile,
    "-C",
    root,
    "-"
  ];

  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(codexCommand, args, {
        cwd: root,
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error("codex exec timed out after 75 seconds"));
      }, 75000);

      child.stdout.on("data", data => {
        stdout += data.toString();
      });

      child.stderr.on("data", data => {
        stderr += data.toString();
      });

      child.on("error", reject);
      child.on("exit", code => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(stderr || stdout || `codex exec exited with code ${code}`));
          return;
        }

        resolve({ stdout, stderr });
      });

      child.stdin.end(prompt);
    });

    const lastMessage = await readFile(outputFile, "utf8").catch(() => result.stdout);
    return validatePlan(extractJson(lastMessage));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function normalizePrompt(prompt) {
  return prompt.toLocaleLowerCase("it").replace(/\s+/g, " ").trim();
}

function fallbackPlan(userPrompt) {
  const normalized = normalizePrompt(userPrompt);
  if (normalized.includes("vulcan") || normalized.includes("lava") || normalized.includes("fuoco")) {
    return makePlan({
      theme: "volcano_arena",
      mood: "reattore vulcanico instabile con casse incandescenti e bombe magmatiche",
      palette: { primary: "#220A05", secondary: "#F97316", accent: "#FACC15" },
      floor: "lava_plate",
      walls: "basalt_wall",
      crates: "magma_crate",
      bomb: "magma_bomb",
      lighting: "volcano_glow",
      particle: "ember_rain",
      explosion: "lava_cross",
      overlay: "VOLCANO CORE ONLINE"
    });
  }

  if (normalized.includes("ghiaccio") || normalized.includes("ice") || normalized.includes("fredd")) {
    return makePlan({
      theme: "ice_dungeon",
      mood: "dungeon glaciale con superfici cristalline e cariche congelanti",
      palette: { primary: "#082F49", secondary: "#BAE6FD", accent: "#67E8F9" },
      floor: "ice_slab",
      walls: "frozen_wall",
      crates: "ice_crate",
      bomb: "freeze_charge",
      lighting: "frozen_blue",
      particle: "snow_sparks",
      explosion: "ice_cross",
      overlay: "CRYO ARENA MUTATION"
    });
  }

  if (normalized.includes("cyber") || normalized.includes("neon") || normalized.includes("80")) {
    return makePlan({
      theme: "cyberpunk_city",
      mood: "back alley cyberpunk con griglia al neon e bombe pulse",
      palette: { primary: "#08111A", secondary: "#2DD4BF", accent: "#F472B6" },
      floor: "neon_asphalt",
      walls: "neon_wall",
      crates: "arcade_crate",
      bomb: "neon_pulse",
      lighting: "cyberpunk_magenta",
      particle: "hologram_grid",
      explosion: "neon_cross",
      overlay: "NEON GRID ACTIVATED"
    });
  }

  if (normalized.includes("oscuro") || normalized.includes("horror") || normalized.includes("ritual")) {
    return makePlan({
      theme: "dark_corruption",
      mood: "arena corrotta da energia rituale con nebbia viola e nucleo instabile",
      palette: { primary: "#09090B", secondary: "#A855F7", accent: "#22D3EE" },
      floor: "corrupted_stone",
      walls: "shadow_obelisk",
      crates: "void_crate",
      bomb: "dark_orb",
      lighting: "dark_ritual",
      particle: "purple_fog",
      explosion: "void_cross",
      overlay: "DARK CORRUPTION APPLIED"
    });
  }

  return makePlan({
    theme: "space_base",
    mood: "base spaziale abbandonata attraversata da energia instabile",
    palette: { primary: "#06111F", secondary: "#18D9FF", accent: "#FF4FD8" },
    floor: "space_metal_grid",
    walls: "sci_fi_panels",
    crates: "energy_crate",
    bomb: "plasma_core",
    lighting: "emergency_neon",
    particle: "blue_energy_dust",
    explosion: "energy_cross",
    overlay: "ORBITAL BASE MUTATION"
  });
}

function makePlan(config) {
  return {
    theme: config.theme,
    mood: config.mood,
    palette: config.palette,
    timeline: [
      action(0, "show_overlay", { message: config.overlay, intensity: 1 }),
      action(120, "camera_shake", { intensity: 0.55 }),
      action(260, "set_lighting", { preset: config.lighting, intensity: 1 }),
      action(420, "set_fog", { enabled: true, intensity: 0.7 }),
      action(620, "replace_floor", { asset: config.floor }),
      action(820, "replace_walls", { asset: config.walls }),
      action(1040, "replace_crates", { asset: config.crates }),
      action(1260, "change_bomb_skin", { asset: config.bomb }),
      action(1480, "spawn_particles", { effect: config.particle, intensity: 1, cell: [5, 5] }),
      action(1850, "camera_orbit", { intensity: 0.9 }),
      action(2450, "trigger_demo_explosion", { style: config.explosion, intensity: 1, cell: [5, 5] })
    ]
  };
}

function action(atMs, type, overrides = {}) {
  return {
    atMs,
    type,
    message: null,
    intensity: null,
    enabled: null,
    preset: null,
    asset: null,
    effect: null,
    style: null,
    cell: null,
    ...overrides
  };
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 200, {});
    return;
  }

  if (req.method === "GET" && req.url === "/api/health") {
    sendJson(res, 200, { ok: true, codexCommand });
    return;
  }

  if (req.method !== "POST" || req.url !== "/api/transform-world") {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const prompt = String(body.prompt ?? "").trim();

    if (prompt.length < 4) {
      sendJson(res, 400, { error: "Prompt is too short." });
      return;
    }

    const cacheKey = normalizePrompt(prompt);
    if (planCache.has(cacheKey)) {
      sendJson(res, 200, { plan: planCache.get(cacheKey), source: "cache" });
      return;
    }

    try {
      const plan = await runCodex(prompt);
      planCache.set(cacheKey, plan);
      sendJson(res, 200, { plan, source: "codex" });
    } catch (codexError) {
      const plan = validatePlan(fallbackPlan(prompt));
      planCache.set(cacheKey, plan);
      sendJson(res, 200, {
        plan,
        source: "fallback",
        warning: codexError instanceof Error ? codexError.message : "Codex fallback used"
      });
    }
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Unknown server error"
    });
  }
});

server.listen(port, () => {
  console.log(`AI Bomber Arena API listening on http://localhost:${port}`);
});
