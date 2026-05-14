import { Color3, Color4, GlowLayer, Tools, Vector3 } from "@babylonjs/core";
import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Scene as BabylonScene } from "@babylonjs/core/scene";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useScene } from "reactylon";
import {
  bombLooks,
  crateLooks,
  effectColors,
  explosionColors,
  floorLooks,
  lightingColors,
  wallLooks
} from "../catalog";
import type { ArenaState, ExplosionCue, ExplosionStyle } from "../types";

interface ArenaContentProps {
  arena: ArenaState;
}

interface Cell {
  x: number;
  z: number;
}

interface ActiveBomb {
  id: number;
  cell: Cell;
  explodeAt: number;
  radius: number;
}

interface ActiveBlast {
  id: number;
  cells: Cell[];
  style: ExplosionStyle;
}

const size = 23;
const center = (size - 1) / 2;
const playerStart: Cell = { x: center, z: size - 2 };
const bombFuseMs = 3000;
const defaultBombRadius = 3;

export function ArenaContent({ arena }: ArenaContentProps) {
  const scene = useScene();
  const floor = floorLooks[arena.floor];
  const walls = wallLooks[arena.walls];
  const crates = crateLooks[arena.crates];
  const bomb = bombLooks[arena.bomb];
  const lighting = lightingColors[arena.lighting];

  const wallCells = useMemo(() => createWallCells(), []);
  const wallSet = useMemo(() => toCellSet(wallCells), [wallCells]);
  const floorCells = useMemo(() => createFloorCells(), []);
  const initialDestructibles = useMemo(() => createDestructibleCells(wallSet), [wallSet]);

  const [playerCell, setPlayerCell] = useState<Cell>(playerStart);
  const [destructibleCells, setDestructibleCells] = useState<Cell[]>(initialDestructibles);
  const [bombs, setBombs] = useState<ActiveBomb[]>([]);
  const [blasts, setBlasts] = useState<ActiveBlast[]>([]);
  const bombCellSetRef = useRef<Set<string>>(new Set());
  const bombTimerIdsRef = useRef<Map<number, number>>(new Map());

  useSceneRuntime(scene, arena);

  const destructibleSet = useMemo(() => toCellSet(destructibleCells), [destructibleCells]);
  const bombSet = useMemo(() => toCellSet(bombs.map(activeBomb => activeBomb.cell)), [bombs]);

  useEffect(() => {
    bombCellSetRef.current = bombSet;
  }, [bombSet]);

  useEffect(
    () => () => {
      for (const timerId of bombTimerIdsRef.current.values()) {
        window.clearTimeout(timerId);
      }
      bombTimerIdsRef.current.clear();
    },
    []
  );

  const explodeBomb = useCallback(
    (activeBomb: ActiveBomb) => {
      setDestructibleCells(currentDestructibles => {
        const currentSet = toCellSet(currentDestructibles);
        const blastCells = computeBlastCells(activeBomb.cell, activeBomb.radius, wallSet, currentSet);
        const destroyed = new Set(
          blastCells.filter(cell => currentSet.has(cellKey(cell))).map(cell => cellKey(cell))
        );

        setBlasts(currentBlasts => [
          ...currentBlasts,
          {
            id: activeBomb.id,
            cells: blastCells,
            style: themeExplosionStyle(arena.theme)
          }
        ]);

        window.setTimeout(() => {
          setBlasts(currentBlasts => currentBlasts.filter(blast => blast.id !== activeBomb.id));
        }, 1500);

        return currentDestructibles.filter(cell => !destroyed.has(cellKey(cell)));
      });
    },
    [arena.theme, wallSet]
  );

  const placeBomb = useCallback(() => {
    const bombCellKey = cellKey(playerCell);
    if (bombCellSetRef.current.has(bombCellKey)) {
      return;
    }

    bombCellSetRef.current = new Set([...bombCellSetRef.current, bombCellKey]);

    const activeBomb: ActiveBomb = {
      id: Date.now(),
      cell: playerCell,
      explodeAt: performance.now() + bombFuseMs,
      radius: defaultBombRadius
    };

    setBombs(currentBombs => [...currentBombs, activeBomb]);

    const timerId = window.setTimeout(() => {
      setBombs(currentBombs => currentBombs.filter(currentBomb => currentBomb.id !== activeBomb.id));
      bombTimerIdsRef.current.delete(activeBomb.id);
      bombCellSetRef.current.delete(bombCellKey);
      explodeBomb(activeBomb);
    }, bombFuseMs);

    bombTimerIdsRef.current.set(activeBomb.id, timerId);
  }, [explodeBomb, playerCell]);

  const movePlayer = useCallback(
    (dx: number, dz: number) => {
      setPlayerCell(current => {
        const next = { x: current.x + dx, z: current.z + dz };
        if (!isWalkable(next, wallSet, destructibleSet, bombSet)) {
          return current;
        }

        return next;
      });
    },
    [bombSet, destructibleSet, wallSet]
  );

  useEffect(() => {
    const canvas = document.getElementById("reactylon-canvas") as HTMLCanvasElement | null;
    canvas?.setAttribute("tabindex", "0");

    const focusCanvas = () => {
      canvas?.focus();
    };

    canvas?.addEventListener("pointerdown", focusCanvas);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        target?.tagName === "TEXTAREA" || target?.tagName === "INPUT" || target?.isContentEditable === true;
      if (isTypingTarget) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "arrowup" || key === "w") {
        event.preventDefault();
        movePlayer(0, -1);
      } else if (key === "arrowdown" || key === "s") {
        event.preventDefault();
        movePlayer(0, 1);
      } else if (key === "arrowleft" || key === "a") {
        event.preventDefault();
        movePlayer(-1, 0);
      } else if (key === "arrowright" || key === "d") {
        event.preventDefault();
        movePlayer(1, 0);
      } else if (key === " " || key === "b") {
        event.preventDefault();
        placeBomb();
      }
    };

    const handlePlaceBombEvent = () => {
      placeBomb();
      focusCanvas();
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("arena:place-bomb", handlePlaceBombEvent);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("arena:place-bomb", handlePlaceBombEvent);
      canvas?.removeEventListener("pointerdown", focusCanvas);
    };
  }, [movePlayer, placeBomb]);

  return (
    <>
      <arcRotateCamera
        name="arena-camera"
        alpha={Tools.ToRadians(45)}
        beta={Tools.ToRadians(60)}
        radius={27}
        target={new Vector3(0, 0, 0)}
        onCreate={(camera: ArcRotateCamera) => {
          scene.activeCamera = camera;
          camera.lowerRadiusLimit = 18;
          camera.upperRadiusLimit = 34;
        }}
      />
      <hemisphericLight
        name="ambient-light"
        direction={new Vector3(0, 1, 0)}
        diffuse={Color3.FromHexString(lighting.diffuse)}
        groundColor={Color3.FromHexString(lighting.ground)}
        intensity={0.82}
      />
      <pointLight
        name="arena-core-light"
        position={new Vector3(0, 9, 0)}
        diffuse={Color3.FromHexString(lighting.point)}
        specular={Color3.FromHexString(arena.palette.accent)}
        intensity={2.15}
      />
      <spotLight
        name="arena-scan-light"
        position={new Vector3(-9, 11, -10)}
        direction={new Vector3(0.8, -1, 0.9)}
        angle={0.92}
        exponent={1.6}
        diffuse={Color3.FromHexString(arena.palette.secondary)}
        specular={Color3.FromHexString(arena.palette.accent)}
        intensity={1.12}
      />

      <EnergyGrid arena={arena} />
      <ArenaBeacon arena={arena} />
      <MutationWave arena={arena} />

      {floorCells.map(cell => (
        <box
          key={`floor-${cell.x}-${cell.z}-${arena.floor}`}
          name={`floor-${cell.x}-${cell.z}`}
          position={cellPosition(cell.x, cell.z, -0.07)}
          options={{ width: 0.94, height: 0.14, depth: 0.94 }}
        >
          <standardMaterial
            name={`floor-material-${cell.x}-${cell.z}`}
            diffuseColor={Color3.FromHexString(floor.diffuse)}
            emissiveColor={Color3.FromHexString(floor.emissive)}
            specularColor={Color3.FromHexString(floor.specular)}
            alpha={floor.alpha ?? 1}
          />
        </box>
      ))}

      {wallCells.map(cell => (
        <box
          key={`wall-${cell.x}-${cell.z}-${arena.walls}`}
          name={`wall-${cell.x}-${cell.z}`}
          position={cellPosition(cell.x, cell.z, 0.5)}
          options={{ width: 0.9, height: 1.1, depth: 0.9 }}
        >
          <standardMaterial
            name={`wall-material-${cell.x}-${cell.z}`}
            diffuseColor={Color3.FromHexString(walls.diffuse)}
            emissiveColor={Color3.FromHexString(walls.emissive)}
            specularColor={Color3.FromHexString(walls.specular)}
            alpha={walls.alpha ?? 1}
          />
        </box>
      ))}

      {destructibleCells.map((cell, index) => (
        <box
          key={`crate-${cell.x}-${cell.z}-${arena.crates}`}
          name={`destructible-${cell.x}-${cell.z}`}
          position={cellPosition(cell.x, cell.z, 0.34 + Math.sin(index) * 0.02)}
          rotationY={(index % 4) * 0.08}
          options={{ width: 0.74, height: 0.72, depth: 0.74 }}
        >
          <standardMaterial
            name={`crate-material-${cell.x}-${cell.z}`}
            diffuseColor={Color3.FromHexString(crates.diffuse)}
            emissiveColor={Color3.FromHexString(crates.emissive)}
            specularColor={Color3.FromHexString(crates.specular)}
            alpha={crates.alpha ?? 1}
          />
        </box>
      ))}

      {bombs.map(activeBomb => (
        <sphere
          key={`bomb-${activeBomb.id}-${arena.bomb}`}
          name={`bomb-${activeBomb.id}`}
          position={cellPosition(activeBomb.cell.x, activeBomb.cell.z, 0.4)}
          options={{ diameter: 0.66, segments: 32 }}
        >
          <standardMaterial
            name={`bomb-material-${activeBomb.id}`}
            diffuseColor={Color3.FromHexString(bomb.diffuse)}
            emissiveColor={Color3.FromHexString(bomb.emissive)}
            specularColor={Color3.FromHexString(bomb.specular)}
          />
        </sphere>
      ))}

      <Player cell={playerCell} arena={arena} />
      <ParticleMotes arena={arena} />
      {blasts.map(blast => (
        <BlastCells key={blast.id} blast={blast} />
      ))}
      {arena.explosion ? <DirectedExplosion cue={arena.explosion} wallSet={wallSet} destructibleSet={destructibleSet} /> : null}
    </>
  );
}

function useSceneRuntime(scene: BabylonScene, arena: ArenaState) {
  const glowRef = useRef<GlowLayer | null>(null);

  useEffect(() => {
    scene.clearColor = Color4.FromHexString(`${arena.palette.primary}FF`);
    scene.ambientColor = Color3.FromHexString(arena.palette.secondary);
    scene.fogEnabled = arena.fog;
    scene.fogMode = BabylonScene.FOGMODE_EXP2;
    scene.fogDensity = arena.fog ? 0.024 : 0;
    scene.fogColor = Color3.FromHexString(arena.palette.primary);
  }, [arena.fog, arena.palette.primary, arena.palette.secondary, scene]);

  useEffect(() => {
    if (!glowRef.current) {
      glowRef.current = new GlowLayer("mutation-glow", scene);
    }

    glowRef.current.intensity = arena.fog ? 0.72 : 0.38;

    return () => {
      glowRef.current?.dispose();
      glowRef.current = null;
    };
  }, [arena.fog, scene]);

  useEffect(() => {
    const camera = scene.getCameraByName("arena-camera") as ArcRotateCamera | null;
    if (!camera) {
      return;
    }

    const baseRadius = 27;
    const baseAlpha = Tools.ToRadians(45);
    const start = performance.now();
    const observer = scene.onBeforeRenderObservable.add(() => {
      const elapsed = performance.now() - start;
      const shake = Math.max(0, 1 - elapsed / 700) * arena.cameraKick;
      const orbitPulse = Math.max(0, 1 - elapsed / 1200) * arena.cameraOrbit;
      camera.alpha = baseAlpha + Math.sin(elapsed * 0.02) * shake * 0.006;
      camera.beta = Tools.ToRadians(60 + Math.sin(elapsed * 0.04) * shake * 0.35);
      camera.radius = baseRadius - orbitPulse * 1.35 + Math.sin(elapsed * 0.07) * shake * 0.16;
      camera.target.x = Math.sin(elapsed * 0.05) * shake * 0.08;
      camera.target.z = Math.cos(elapsed * 0.04) * shake * 0.08;
    });

    return () => {
      scene.onBeforeRenderObservable.remove(observer);
    };
  }, [arena.cameraKick, arena.cameraOrbit, scene]);
}

function Player({ cell, arena }: { cell: Cell; arena: ArenaState }) {
  return (
    <>
      <sphere
        name="player-body"
        position={cellPosition(cell.x, cell.z, 0.44)}
        options={{ diameter: 0.58, segments: 32 }}
      >
        <standardMaterial
          name="player-body-material"
          diffuseColor={Color3.FromHexString("#F8FAFC")}
          emissiveColor={Color3.FromHexString(arena.palette.accent)}
          specularColor={Color3.FromHexString("#FFFFFF")}
        />
      </sphere>
      <sphere
        name="player-head"
        position={cellPosition(cell.x, cell.z, 0.86)}
        options={{ diameter: 0.34, segments: 24 }}
      >
        <standardMaterial
          name="player-head-material"
          diffuseColor={Color3.FromHexString("#111827")}
          emissiveColor={Color3.FromHexString(arena.palette.secondary)}
          specularColor={Color3.FromHexString("#FFFFFF")}
        />
      </sphere>
    </>
  );
}

function ParticleMotes({ arena }: { arena: ArenaState }) {
  const motes = useMemo(
    () =>
      arena.particles.flatMap((effect, effectIndex) =>
        Array.from({ length: 44 }, (_, index) => ({
          id: `${effect}-${index}`,
          effect,
          x: ((index * 7 + effectIndex * 3) % 24) - 11.5,
          z: ((index * 5 + effectIndex * 4) % 24) - 11.5,
          y: 0.55 + ((index * 11) % 13) / 4.5,
          size: 0.055 + ((index + effectIndex) % 5) * 0.02
        }))
      ),
    [arena.particles]
  );

  return (
    <>
      {motes.map(mote => (
        <sphere
          key={mote.id}
          name={`mote-${mote.id}`}
          position={new Vector3(mote.x, mote.y, mote.z)}
          options={{ diameter: mote.size, segments: 12 }}
        >
          <standardMaterial
            name={`mote-material-${mote.id}`}
            emissiveColor={Color3.FromHexString(effectColors[mote.effect])}
            diffuseColor={Color3.FromHexString(effectColors[mote.effect])}
            alpha={0.86}
          />
        </sphere>
      ))}
    </>
  );
}

function DirectedExplosion({
  cue,
  wallSet,
  destructibleSet
}: {
  cue: ExplosionCue;
  wallSet: Set<string>;
  destructibleSet: Set<string>;
}) {
  return (
    <BlastCells
      blast={{
        id: cue.id,
        cells: computeBlastCells({ x: cue.cell[0], z: cue.cell[1] }, defaultBombRadius, wallSet, destructibleSet),
        style: cue.style
      }}
    />
  );
}

function BlastCells({ blast }: { blast: ActiveBlast; key?: number }) {
  const scene = useScene();
  const color = explosionColors[blast.style];
  const centerCell = blast.cells[0] ?? playerStart;
  const centerPosition = cellPosition(centerCell.x, centerCell.z, 0.16);

  useTimedMeshAnimation(scene, `blast-${blast.id}`, 1500, progress => {
    const ease = 1 - Math.pow(1 - progress, 3);
    const fade = Math.max(0, 1 - progress);

    for (const mesh of scene.meshes) {
      if (!mesh.name.includes(`blast-${blast.id}`)) {
        continue;
      }

      mesh.scaling.x = 1 + ease * 0.72;
      mesh.scaling.z = 1 + ease * 0.72;
      mesh.scaling.y = 1 + Math.sin(progress * Math.PI) * 1.55;
      const material = mesh.material;
      if (material && "alpha" in material) {
        material.alpha = Math.max(0, fade * 0.9);
      }
    }
  });

  return (
    <>
      <torus
        name={`blast-${blast.id}-ring`}
        position={centerPosition}
        rotationX={Tools.ToRadians(90)}
        options={{ diameter: 1.5, thickness: 0.08, tessellation: 96 }}
      >
        <standardMaterial
          name={`blast-ring-material-${blast.id}`}
          emissiveColor={Color3.FromHexString(color)}
          diffuseColor={Color3.FromHexString(color)}
          alpha={0.82}
        />
      </torus>

      {blast.cells.map((cell, index) => (
        <box
          key={`blast-${blast.id}-${cell.x}-${cell.z}-${index}`}
          name={`blast-${blast.id}-${cell.x}-${cell.z}-${index}`}
          position={cellPosition(cell.x, cell.z, 0.18)}
          options={{ width: 0.88, height: 0.1, depth: 0.88 }}
        >
          <standardMaterial
            name={`blast-material-${blast.id}-${cell.x}-${cell.z}-${index}`}
            diffuseColor={Color3.FromHexString(color)}
            emissiveColor={Color3.FromHexString(color)}
            alpha={0.86}
          />
        </box>
      ))}
    </>
  );
}

function EnergyGrid({ arena }: { arena: ArenaState }) {
  const accent = arena.palette.accent;
  const secondary = arena.palette.secondary;
  const glow = arena.theme === "classic" ? 0.18 : 0.7;

  return (
    <>
      {Array.from({ length: size + 1 }, (_, index) => {
        const offset = index - center - 0.5;

        return (
          <box
            key={`grid-x-${index}-${arena.theme}`}
            name={`energy-grid-x-${index}`}
            position={new Vector3(offset, 0.025, 0)}
            options={{ width: 0.02, height: 0.025, depth: size + 0.12 }}
          >
            <standardMaterial
              name={`energy-grid-x-material-${index}`}
              diffuseColor={Color3.FromHexString(secondary)}
              emissiveColor={Color3.FromHexString(accent)}
              alpha={glow}
            />
          </box>
        );
      })}
      {Array.from({ length: size + 1 }, (_, index) => {
        const offset = index - center - 0.5;

        return (
          <box
            key={`grid-z-${index}-${arena.theme}`}
            name={`energy-grid-z-${index}`}
            position={new Vector3(0, 0.03, offset)}
            options={{ width: size + 0.12, height: 0.025, depth: 0.02 }}
          >
            <standardMaterial
              name={`energy-grid-z-material-${index}`}
              diffuseColor={Color3.FromHexString(secondary)}
              emissiveColor={Color3.FromHexString(accent)}
              alpha={glow}
            />
          </box>
        );
      })}
    </>
  );
}

function ArenaBeacon({ arena }: { arena: ArenaState }) {
  return (
    <>
      <torus
        key={`beacon-ring-${arena.theme}`}
        name="arena-beacon-ring"
        position={new Vector3(0, 0.08, 0)}
        rotationX={Tools.ToRadians(90)}
        options={{ diameter: 2.05, thickness: 0.035, tessellation: 96 }}
      >
        <standardMaterial
          name="arena-beacon-ring-material"
          diffuseColor={Color3.FromHexString(arena.palette.secondary)}
          emissiveColor={Color3.FromHexString(arena.palette.accent)}
          alpha={arena.theme === "classic" ? 0.24 : 0.62}
        />
      </torus>
      <cylinder
        key={`beacon-column-${arena.theme}`}
        name="arena-beacon-column"
        position={new Vector3(0, 0.78, 0)}
        options={{ height: 1.55, diameterTop: 0.18, diameterBottom: 0.55, tessellation: 64 }}
      >
        <standardMaterial
          name="arena-beacon-column-material"
          diffuseColor={Color3.FromHexString(arena.palette.secondary)}
          emissiveColor={Color3.FromHexString(arena.palette.accent)}
          alpha={arena.theme === "classic" ? 0.14 : 0.3}
        />
      </cylinder>
    </>
  );
}

function MutationWave({ arena }: { arena: ArenaState }) {
  const scene = useScene();

  useTimedMeshAnimation(scene, `mutation-wave-${arena.mutationId}`, 1200, progress => {
    const ease = 1 - Math.pow(1 - progress, 3);
    const mesh = scene.getMeshByName(`mutation-wave-${arena.mutationId}`);
    if (!mesh) {
      return;
    }

    mesh.scaling.x = 0.8 + ease * 13;
    mesh.scaling.z = 0.8 + ease * 13;
    const material = mesh.material;
    if (material && "alpha" in material) {
      material.alpha = Math.max(0, 0.5 * (1 - progress));
    }
  });

  if (!arena.mutationId) {
    return null;
  }

  return (
    <torus
      name={`mutation-wave-${arena.mutationId}`}
      position={new Vector3(0, 0.22, 0)}
      rotationX={Tools.ToRadians(90)}
      options={{ diameter: 1.2, thickness: 0.06, tessellation: 128 }}
    >
      <standardMaterial
        name={`mutation-wave-material-${arena.mutationId}`}
        diffuseColor={Color3.FromHexString(arena.palette.secondary)}
        emissiveColor={Color3.FromHexString(arena.palette.accent)}
        alpha={0.5}
      />
    </torus>
  );
}

function useTimedMeshAnimation(scene: BabylonScene, key: string, durationMs: number, update: (progress: number) => void) {
  useEffect(() => {
    const start = performance.now();
    const observer = scene.onBeforeRenderObservable.add(() => {
      const progress = Math.min(1, (performance.now() - start) / durationMs);
      update(progress);

      if (progress >= 1) {
        scene.onBeforeRenderObservable.remove(observer);
      }
    });

    return () => {
      scene.onBeforeRenderObservable.remove(observer);
    };
  }, [durationMs, key, scene, update]);
}

function createFloorCells(): Cell[] {
  const cells: Cell[] = [];

  for (let x = 0; x < size; x += 1) {
    for (let z = 0; z < size; z += 1) {
      cells.push({ x, z });
    }
  }

  return cells;
}

function createWallCells(): Cell[] {
  const cells: Cell[] = [];

  for (let x = 0; x < size; x += 1) {
    for (let z = 0; z < size; z += 1) {
      const perimeter = x === 0 || z === 0 || x === size - 1 || z === size - 1;
      const pillar = x % 2 === 0 && z % 2 === 0;

      if (perimeter || pillar) {
        cells.push({ x, z });
      }
    }
  }

  return cells;
}

function createDestructibleCells(wallSet: Set<string>): Cell[] {
  const cells: Cell[] = [];

  for (let x = 1; x < size - 1; x += 1) {
    for (let z = 1; z < size - 1; z += 1) {
      const cell = { x, z };
      if (wallSet.has(cellKey(cell)) || isSpawnSafeCell(cell)) {
        continue;
      }

      const seeded = (x * 17 + z * 31 + x * z * 7) % 10;
      if (seeded <= 4) {
        cells.push(cell);
      }
    }
  }

  return cells;
}

function computeBlastCells(origin: Cell, radius: number, wallSet: Set<string>, destructibleSet: Set<string>): Cell[] {
  const cells = [origin];
  const directions = [
    { x: 1, z: 0 },
    { x: -1, z: 0 },
    { x: 0, z: 1 },
    { x: 0, z: -1 }
  ];

  for (const direction of directions) {
    for (let distance = 1; distance <= radius; distance += 1) {
      const cell = { x: origin.x + direction.x * distance, z: origin.z + direction.z * distance };
      const key = cellKey(cell);
      if (wallSet.has(key)) {
        break;
      }

      cells.push(cell);

      if (destructibleSet.has(key)) {
        break;
      }
    }
  }

  return cells;
}

function isWalkable(cell: Cell, wallSet: Set<string>, destructibleSet: Set<string>, bombSet: Set<string>) {
  if (cell.x < 1 || cell.x >= size - 1 || cell.z < 1 || cell.z >= size - 1) {
    return false;
  }

  const key = cellKey(cell);
  return !wallSet.has(key) && !destructibleSet.has(key) && !bombSet.has(key);
}

function isSpawnSafeCell(cell: Cell) {
  const frontSpawn = Math.abs(cell.x - center) <= 2 && cell.z >= size - 4;
  const originalSpawn = (cell.x <= 2 && cell.z <= 2) || (cell.x === 1 && cell.z === 3) || (cell.x === 3 && cell.z === 1);
  return frontSpawn || originalSpawn;
}

function themeExplosionStyle(theme: ArenaState["theme"]): ExplosionStyle {
  switch (theme) {
    case "space_base":
      return "energy_cross";
    case "ice_dungeon":
      return "ice_cross";
    case "volcano_arena":
      return "lava_cross";
    case "cyberpunk_city":
      return "neon_cross";
    case "dark_corruption":
      return "void_cross";
    default:
      return "classic_cross";
  }
}

function toCellSet(cells: Cell[]) {
  return new Set(cells.map(cell => cellKey(cell)));
}

function sameCell(a: Cell, b: Cell) {
  return a.x === b.x && a.z === b.z;
}

function cellKey(cell: Cell) {
  return `${cell.x},${cell.z}`;
}

function cellPosition(x: number, z: number, y: number) {
  return new Vector3(x - center, y, z - center);
}
