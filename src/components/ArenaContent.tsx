import { Camera, Color3, Color4, GlowLayer, Mesh, MeshBuilder, StandardMaterial, Tools, Vector3 } from "@babylonjs/core";
import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Scene as BabylonScene } from "@babylonjs/core/scene";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useScene } from "reactylon";
import {
  bombLooks,
  crateLooks,
  effectColors,
  explosionColors,
  floorLooks,
  lightingColors,
  type MaterialLook,
  wallLooks
} from "../catalog";
import type { ArenaState, ExplosionCue, ExplosionStyle, ViewMode, VisualStyle } from "../types";

interface ArenaContentProps {
  arena: ArenaState;
  viewMode: ViewMode;
  visualStyle: VisualStyle;
  onHudChange?: (hud: ArenaHudState) => void;
  key?: number;
}

interface Cell {
  x: number;
  z: number;
}

type MoveCommand = "forward" | "backward" | "left" | "right";
type ArenaElementKind = "floor" | "wall" | "crate" | "bomb";
type PowerUpType = "bomb_capacity" | "blast_radius" | "speed_up" | "bomb_kick" | "throw_bomb";
type GameStatus = "playing" | "won" | "lost";
type EnemyType = "wanderer" | "chaser" | "ghost";

export interface ArenaHudState {
  elapsedSeconds: number;
  availableBombs: number;
  bombCapacity: number;
  blastRadius: number;
  collectedPowerUps: number;
  enemiesRemaining: number;
  speedLevel: number;
  canKickBombs: boolean;
  canThrowBombs: boolean;
  status: GameStatus;
}

interface ActiveBomb {
  id: number;
  cell: Cell;
  explodeAt: number;
}

interface ActiveBlast {
  id: number;
  cells: Cell[];
  style: ExplosionStyle;
}

interface BlastReach {
  fireCells: Cell[];
  destroyedCrateCells: Cell[];
}

interface ActivePowerUp {
  id: string;
  cell: Cell;
  type: PowerUpType;
}

interface ActiveEnemy {
  id: string;
  type: EnemyType;
  cell: Cell;
  visualFromCell: Cell;
  visualMoveStartedAt: number;
  visualMoveDurationMs: number;
  direction: Cell;
  nextMoveAt: number;
}

interface FeedbackCue {
  id: number;
  kind: "pickup" | "enemy_down";
  cell: Cell;
}

interface PlayerMovementDecision {
  direction: Cell;
  stopAtCellCenter?: Cell;
}

interface GeneratedLevel {
  wallCells: Cell[];
  destructibleCells: Cell[];
  enemies: ActiveEnemy[];
}

const size = 23;
const center = (size - 1) / 2;
const playerStart: Cell = { x: center, z: size - 2 };
const bombFuseMs = 3000;
const blastDurationMs = 700;
const initialBlastRadius = 1;
const directedExplosionRadius = 3;
const basePlayerMoveDurationMs = 400;
const minimumPlayerMoveDurationMs = 220;
const speedUpStepMs = 35;
const playerTurnBufferMs = 180;
const maxPlayerFrameDeltaMs = 96;
const initialBombCapacity = 1;
const initialEnemyCount = 5;
const minEnemySpawnPathDistance = 10;
const fixedBlockDensityMin = 0.14;
const fixedBlockDensityMax = 0.19;
const destructibleBlockDensityMin = 0.38;
const destructibleBlockDensityMax = 0.47;
const fallbackFixedBlockDensity = 0.11;
const fallbackDestructibleBlockDensity = 0.32;
const enemyTickMs = 80;
const enemyVisualMoveDurationRatio = 0.62;
const fpsDefaultCameraRadius = 1.85;
const fpsMinCameraRadius = 0.9;
const fpsMaxCameraRadius = 2.35;
const threeDDefaultCameraAlpha = 90;
const threeDDefaultCameraBeta = 48;
const threeDDefaultCameraRadius = 24.5;
const threeDPlayerTargetForwardOffset = 5.2;
const threeDPlayerTargetHeight = 0.12;
const gamepadMoveKey = "gamepad:move";
const gamepadMoveDeadZone = 0.35;
const gamepadCameraDeadZone = 0.18;
const gamepadCameraSpeed3D = 1.55;
const gamepadCameraSpeedFps = 2.15;
const gamepadZoomDeadZone = 0.08;
const gamepadZoomSpeed3D = 13;
const gamepadZoomSpeedFps = 1.2;

export function ArenaContent({ arena, viewMode, visualStyle, onHudChange }: ArenaContentProps) {
  const scene = useScene();
  const floor = floorLooks[arena.floor];
  const walls = wallLooks[arena.walls];
  const crates = crateLooks[arena.crates];
  const bomb = bombLooks[arena.bomb];
  const lighting = lightingColors[arena.lighting];
  const isTopDown = viewMode === "top_down";
  const floorMaterial = materialLookForView("floor", floor, isTopDown, visualStyle);
  const wallMaterial = materialLookForView("wall", walls, isTopDown, visualStyle);
  const crateMaterial = materialLookForView("crate", crates, isTopDown, visualStyle);
  const bombMaterial = materialLookForView("bomb", bomb, isTopDown, visualStyle);

  const generatedLevel = useMemo(() => createGeneratedLevel(), []);
  const wallCells = generatedLevel.wallCells;
  const wallSet = useMemo(() => toCellSet(wallCells), [wallCells]);
  const floorCells = useMemo(() => createFloorCells(), []);
  const initialDestructibles = generatedLevel.destructibleCells;
  const initialDestructibleSet = useMemo(() => toCellSet(initialDestructibles), [initialDestructibles]);
  const initialEnemies = generatedLevel.enemies;

  const [destructibleCells, setDestructibleCells] = useState<Cell[]>(initialDestructibles);
  const [bombs, setBombs] = useState<ActiveBomb[]>([]);
  const [blasts, setBlasts] = useState<ActiveBlast[]>([]);
  const [powerUps, setPowerUps] = useState<ActivePowerUp[]>([]);
  const [enemies, setEnemies] = useState<ActiveEnemy[]>(initialEnemies);
  const [bombCapacity, setBombCapacity] = useState(initialBombCapacity);
  const [blastRadius, setBlastRadius] = useState(initialBlastRadius);
  const [collectedPowerUps, setCollectedPowerUps] = useState(0);
  const [speedLevel, setSpeedLevel] = useState(0);
  const [canKickBombs, setCanKickBombs] = useState(false);
  const [canThrowBombs, setCanThrowBombs] = useState(false);
  const [gameStatus, setGameStatus] = useState<GameStatus>("playing");
  const [feedbackCues, setFeedbackCues] = useState<FeedbackCue[]>([]);
  const bombCellSetRef = useRef<Set<string>>(new Set());
  const playerPassableBombCellKeysRef = useRef<Set<string>>(new Set());
  const bombTimerIdsRef = useRef<Map<number, number>>(new Map());
  const bombsRef = useRef<ActiveBomb[]>([]);
  const blastsRef = useRef<ActiveBlast[]>([]);
  const blastRadiusRef = useRef(initialBlastRadius);
  const destructibleCellsRef = useRef(destructibleCells);
  const powerUpsRef = useRef<ActivePowerUp[]>([]);
  const enemiesRef = useRef<ActiveEnemy[]>(initialEnemies);
  const playerVisualPositionRef = useRef(cellPosition(playerStart.x, playerStart.z, 0.44));
  const playerCellRef = useRef(playerStart);
  const playerDirectionRef = useRef<Cell | null>(null);
  const heldMoveCommandsRef = useRef<Map<string, MoveCommand>>(new Map());
  const bufferedMoveRef = useRef<{ command: MoveCommand; expiresAt: number } | null>(null);
  const gamepadMoveCommandRef = useRef<MoveCommand | null>(null);
  const gamepadButtonStateRef = useRef({ placeBomb: false, throwBomb: false });
  const gameStartedAtRef = useRef(performance.now());
  const gameEndedAtRef = useRef<number | null>(null);
  const gameStatusRef = useRef<GameStatus>("playing");
  const lastPlayerDirectionRef = useRef<Cell>({ x: 0, z: -1 });
  const playerMoveDurationMs = Math.max(minimumPlayerMoveDurationMs, basePlayerMoveDurationMs - speedLevel * speedUpStepMs);

  useSceneRuntime(scene, arena, isTopDown);

  const destructibleSet = useMemo(() => toCellSet(destructibleCells), [destructibleCells]);
  const bombSet = useMemo(() => toCellSet(bombs.map(activeBomb => activeBomb.cell)), [bombs]);
  const destructibleSetRef = useRef(destructibleSet);
  const bombSetRef = useRef(bombSet);

  useEffect(() => {
    bombCellSetRef.current = bombSet;
    bombSetRef.current = bombSet;
    bombsRef.current = bombs;
  }, [bombSet]);

  useEffect(() => {
    destructibleSetRef.current = destructibleSet;
    destructibleCellsRef.current = destructibleCells;
  }, [destructibleSet]);

  useEffect(() => {
    powerUpsRef.current = powerUps;
  }, [powerUps]);

  useEffect(() => {
    enemiesRef.current = enemies;
  }, [enemies]);

  useEffect(() => {
    blastsRef.current = blasts;
  }, [blasts]);

  useEffect(() => {
    blastRadiusRef.current = blastRadius;
  }, [blastRadius]);

  useEffect(() => {
    gameStatusRef.current = gameStatus;
  }, [gameStatus]);

  useEffect(
    () => () => {
      for (const timerId of bombTimerIdsRef.current.values()) {
        window.clearTimeout(timerId);
      }
      bombTimerIdsRef.current.clear();
    },
    []
  );

  const emitHud = useCallback(() => {
    onHudChange?.({
      elapsedSeconds: Math.floor(((gameEndedAtRef.current ?? performance.now()) - gameStartedAtRef.current) / 1000),
      availableBombs: Math.max(0, bombCapacity - bombs.length),
      bombCapacity,
      blastRadius,
      collectedPowerUps,
      enemiesRemaining: enemies.length,
      speedLevel,
      canKickBombs,
      canThrowBombs,
      status: gameStatus
    });
  }, [
    blastRadius,
    bombCapacity,
    bombs.length,
    canKickBombs,
    canThrowBombs,
    collectedPowerUps,
    enemies.length,
    gameStatus,
    onHudChange,
    speedLevel
  ]);

  useEffect(() => {
    emitHud();
    const timerId = window.setInterval(emitHud, 1000);
    return () => {
      window.clearInterval(timerId);
    };
  }, [emitHud]);

  const finishGame = useCallback((status: Exclude<GameStatus, "playing">) => {
    if (gameStatusRef.current !== "playing") {
      return;
    }

    gameStatusRef.current = status;
    gameEndedAtRef.current = performance.now();
    heldMoveCommandsRef.current.clear();
    gamepadMoveCommandRef.current = null;
    gamepadButtonStateRef.current = { placeBomb: false, throwBomb: false };
    playerPassableBombCellKeysRef.current.clear();
    bufferedMoveRef.current = null;
    playerDirectionRef.current = null;
    setGameStatus(status);
  }, []);

  const explodeBombCascade = useCallback(
    (firstBomb: ActiveBomb) => {
      const pendingBombs = [firstBomb];
      const explodedIds = new Set<number>();
      let nextBombs = bombsRef.current;
      let nextDestructibles = destructibleCellsRef.current;
      let nextPowerUps = powerUpsRef.current;
      let nextEnemies = enemiesRef.current;
      const nextBlasts: ActiveBlast[] = [];
      let playerWasHit = false;

      while (pendingBombs.length > 0) {
        const explosionNow = performance.now();
        const activeBomb = pendingBombs.shift();
        if (!activeBomb || explodedIds.has(activeBomb.id)) {
          continue;
        }

        const bombToExplode = nextBombs.find(currentBomb => currentBomb.id === activeBomb.id);
        if (!bombToExplode) {
          continue;
        }

        explodedIds.add(activeBomb.id);
        const timerId = bombTimerIdsRef.current.get(activeBomb.id);
        if (timerId !== undefined) {
          window.clearTimeout(timerId);
          bombTimerIdsRef.current.delete(activeBomb.id);
        }

        nextBombs = nextBombs.filter(currentBomb => currentBomb.id !== activeBomb.id);
        const currentDestructibleSet = toCellSet(nextDestructibles);
        const blastReach = computeBlastReach(bombToExplode.cell, blastRadiusRef.current, wallSet, currentDestructibleSet);
        const blastCellKeys = new Set(blastReach.fireCells.map(cellKey));
        const destroyedCrateKeys = new Set(blastReach.destroyedCrateCells.map(cellKey));
        const destroyedCrates = nextDestructibles.filter(cell => destroyedCrateKeys.has(cellKey(cell)));
        const currentPlayerCell = nearestCellFromPosition(playerVisualPositionRef.current);

        nextDestructibles = nextDestructibles.filter(cell => !destroyedCrateKeys.has(cellKey(cell)));
        nextPowerUps = [
          ...nextPowerUps.filter(powerUp => !blastCellKeys.has(cellKey(powerUp.cell))),
          ...destroyedCrates.flatMap(cell => {
            const drop = powerUpDropForCell(cell);
            return drop ? [{ id: `powerup-${cell.x}-${cell.z}`, cell, type: drop }] : [];
          })
        ];
        const defeatedEnemies = nextEnemies.filter(enemy =>
          blastCellKeys.has(cellKey(enemyCollisionCell(enemy, explosionNow)))
        );
        nextEnemies = nextEnemies.filter(enemy => !blastCellKeys.has(cellKey(enemyCollisionCell(enemy, explosionNow))));
        if (defeatedEnemies.length > 0) {
          emitFeedback(
            defeatedEnemies.map(enemy => ({ kind: "enemy_down" as const, cell: enemyCollisionCell(enemy, explosionNow) })),
            setFeedbackCues
          );
          playGameTone("enemy_down");
        }
        playerWasHit ||= blastCellKeys.has(cellKey(currentPlayerCell));

        nextBlasts.push({
          id: activeBomb.id,
          cells: blastReach.fireCells,
          style: themeExplosionStyle(arena.theme)
        });

        for (const chainedBomb of nextBombs) {
          if (blastCellKeys.has(cellKey(chainedBomb.cell))) {
            pendingBombs.push(chainedBomb);
          }
        }
      }

      bombsRef.current = nextBombs;
      destructibleCellsRef.current = nextDestructibles;
      powerUpsRef.current = nextPowerUps;
      enemiesRef.current = nextEnemies;
      bombCellSetRef.current = toCellSet(nextBombs.map(activeBomb => activeBomb.cell));
      bombSetRef.current = bombCellSetRef.current;
      playerPassableBombCellKeysRef.current = keepExistingBombKeys(
        playerPassableBombCellKeysRef.current,
        bombCellSetRef.current
      );
      destructibleSetRef.current = toCellSet(nextDestructibles);

      setBombs(nextBombs);
      setDestructibleCells(nextDestructibles);
      setPowerUps(nextPowerUps);
      setEnemies(nextEnemies);
      blastsRef.current = [...blastsRef.current, ...nextBlasts];
      setBlasts(blastsRef.current);

      if (playerWasHit) {
        finishGame("lost");
      } else if (nextEnemies.length === 0) {
        finishGame("won");
      }

      for (const blast of nextBlasts) {
        window.setTimeout(() => {
          blastsRef.current = blastsRef.current.filter(currentBlast => currentBlast.id !== blast.id);
          setBlasts(blastsRef.current);
        }, blastDurationMs);
      }
    },
    [arena.theme, finishGame, wallSet]
  );

  const placeBomb = useCallback(() => {
    if (gameStatusRef.current !== "playing") {
      return;
    }

    if (bombsRef.current.length >= bombCapacity) {
      return;
    }

    const currentPlayerCell = nearestCellFromPosition(playerVisualPositionRef.current);
    const bombCellKey = cellKey(currentPlayerCell);
    if (bombCellSetRef.current.has(bombCellKey)) {
      return;
    }

    bombCellSetRef.current = new Set([...bombCellSetRef.current, bombCellKey]);
    bombSetRef.current = bombCellSetRef.current;
    playerPassableBombCellKeysRef.current.add(bombCellKey);

    const activeBomb: ActiveBomb = {
      id: Date.now(),
      cell: currentPlayerCell,
      explodeAt: performance.now() + bombFuseMs
    };

    const nextBombs = [...bombsRef.current, activeBomb];
    bombsRef.current = nextBombs;
    setBombs(nextBombs);

    const timerId = window.setTimeout(() => {
      explodeBombCascade(activeBomb);
    }, bombFuseMs);

    bombTimerIdsRef.current.set(activeBomb.id, timerId);
  }, [bombCapacity, explodeBombCascade]);

  const relocateBomb = useCallback(
    (bombToMove: ActiveBomb, destination: Cell) => {
      playerPassableBombCellKeysRef.current.delete(cellKey(bombToMove.cell));
      const nextBombs = bombsRef.current.map(activeBomb =>
        activeBomb.id === bombToMove.id ? { ...activeBomb, cell: destination } : activeBomb
      );
      bombsRef.current = nextBombs;
      bombCellSetRef.current = toCellSet(nextBombs.map(activeBomb => activeBomb.cell));
      bombSetRef.current = bombCellSetRef.current;
      setBombs(nextBombs);

      const movedBomb = nextBombs.find(activeBomb => activeBomb.id === bombToMove.id);
      if (movedBomb && isCellInActiveBlast(destination, blastsRef.current)) {
        explodeBombCascade(movedBomb);
      }
    },
    [explodeBombCascade]
  );

  const tryKickBomb = useCallback(
    (bombCell: Cell, direction: Cell) => {
      const bombToKick = bombsRef.current.find(activeBomb => sameCell(activeBomb.cell, bombCell));
      if (!bombToKick) {
        return false;
      }

      let currentCell = bombCell;
      let nextCell = { x: currentCell.x + direction.x, z: currentCell.z + direction.z };
      while (
        isBombTravelCellFree(nextCell, wallSet, destructibleSetRef.current, bombCellSetRef.current, bombCell)
      ) {
        currentCell = nextCell;
        nextCell = { x: currentCell.x + direction.x, z: currentCell.z + direction.z };
      }

      if (sameCell(currentCell, bombCell)) {
        return false;
      }

      relocateBomb(bombToKick, currentCell);
      return true;
    },
    [relocateBomb, wallSet]
  );

  const throwBomb = useCallback(() => {
    if (gameStatusRef.current !== "playing" || !canThrowBombs) {
      return;
    }

    const playerCurrentCell = nearestCellFromPosition(playerVisualPositionRef.current);
    const bombToThrow = bombsRef.current.find(activeBomb => sameCell(activeBomb.cell, playerCurrentCell));
    if (!bombToThrow) {
      return;
    }

    const destination = findThrownBombLandingCell(
      playerCurrentCell,
      lastPlayerDirectionRef.current,
      wallSet,
      destructibleSetRef.current,
      bombCellSetRef.current
    );
    if (!destination) {
      return;
    }

    relocateBomb(bombToThrow, destination);
  }, [canThrowBombs, relocateBomb, wallSet]);

  const collectPowerUpAtCell = useCallback((cell: Cell) => {
    const collectedPowerUp = powerUpsRef.current.find(powerUp => sameCell(powerUp.cell, cell));
    if (!collectedPowerUp) {
      return;
    }

    const nextPowerUps = powerUpsRef.current.filter(powerUp => powerUp.id !== collectedPowerUp.id);
    powerUpsRef.current = nextPowerUps;
    setPowerUps(nextPowerUps);
    setCollectedPowerUps(currentCount => currentCount + 1);
    emitFeedback([{ kind: "pickup", cell }], setFeedbackCues);
    playGameTone("pickup");

    switch (collectedPowerUp.type) {
      case "bomb_capacity":
        setBombCapacity(currentCapacity => currentCapacity + 1);
        break;
      case "blast_radius":
        setBlastRadius(currentRadius => currentRadius + 1);
        break;
      case "speed_up":
        setSpeedLevel(currentSpeed => currentSpeed + 1);
        break;
      case "bomb_kick":
        setCanKickBombs(true);
        break;
      case "throw_bomb":
        setCanThrowBombs(true);
        break;
    }
  }, []);

  const enterableCellInDirection = useCallback(
    (cell: Cell, direction: Cell) => {
      const destinationKey = cellKey(cell);
      const destinationHasBlockingBomb =
        bombSetRef.current.has(destinationKey) && !playerPassableBombCellKeysRef.current.has(destinationKey);
      if (destinationHasBlockingBomb && (!canKickBombs || !tryKickBomb(cell, direction))) {
        return false;
      }

      return isPlayerWalkable(
        cell,
        wallSet,
        destructibleSetRef.current,
        bombSetRef.current,
        playerPassableBombCellKeysRef.current
      );
    },
    [canKickBombs, tryKickBomb, wallSet]
  );

  const syncPlayerLogicalCell = useCallback(() => {
    const nextCell = nearestCellFromPosition(playerVisualPositionRef.current);
    if (sameCell(nextCell, playerCellRef.current)) {
      return;
    }

    playerPassableBombCellKeysRef.current.delete(cellKey(playerCellRef.current));
    playerCellRef.current = nextCell;
    collectPowerUpAtCell(nextCell);

    if (isCellInActiveBlast(nextCell, blastsRef.current) || enemyOccupiesCell(nextCell, enemiesRef.current)) {
      finishGame("lost");
    }
  }, [collectPowerUpAtCell, finishGame]);

  const requestedPlayerDirections = useCallback(() => {
    const now = performance.now();
    const bufferedMove =
      bufferedMoveRef.current && bufferedMoveRef.current.expiresAt >= now ? bufferedMoveRef.current : null;
    if (bufferedMoveRef.current && !bufferedMove) {
      bufferedMoveRef.current = null;
    }

    const commands = [...Array.from(heldMoveCommandsRef.current.values()), bufferedMove?.command].filter(
      (command, index, candidates): command is MoveCommand =>
        command !== undefined && candidates.indexOf(command) === index
    );

    return commands.map(command => ({
      command,
      direction: resolveMoveDirection(scene, viewMode, command),
      buffered: bufferedMove?.command === command
    }));
  }, [scene, viewMode]);

  const choosePlayerDirection = useCallback((): PlayerMovementDecision | null => {
    const position = playerVisualPositionRef.current;
    const currentCell = nearestCellFromPosition(position);
    const laneAxis = playerLaneAxis(position);

    for (const candidate of requestedPlayerDirections()) {
      if (laneAxis && directionAxis(candidate.direction) !== laneAxis) {
        const turnOriginCell = nearestTurnableCell(
          position,
          laneAxis,
          candidate.direction,
          wallSet,
          destructibleSetRef.current,
          bombSetRef.current,
          playerPassableBombCellKeysRef.current
        );
        if (!turnOriginCell) {
          continue;
        }

        const centeringDirection = directionTowardCellCenter(position, turnOriginCell, laneAxis);
        if (centeringDirection) {
          return {
            direction: centeringDirection,
            stopAtCellCenter: turnOriginCell
          };
        }

        if (sameCell(turnOriginCell, currentCell)) {
          if (candidate.buffered) {
            bufferedMoveRef.current = null;
          }
          return { direction: candidate.direction };
        }
        continue;
      }

      if (!canAdvanceFromPosition(position, candidate.direction, enterableCellInDirection)) {
        continue;
      }

      if (candidate.buffered) {
        bufferedMoveRef.current = null;
      }
      return { direction: candidate.direction };
    }

    return null;
  }, [enterableCellInDirection, requestedPlayerDirections, wallSet]);

  useEffect(() => {
    let previousFrameAt = performance.now();
    const observer = scene.onBeforeRenderObservable.add(() => {
      const now = performance.now();
      const elapsedMs = Math.min(maxPlayerFrameDeltaMs, now - previousFrameAt);
      previousFrameAt = now;

      if (gameStatusRef.current !== "playing") {
        return;
      }

      const movementDecision = choosePlayerDirection();
      playerDirectionRef.current = movementDecision?.direction ?? null;
      if (!movementDecision) {
        return;
      }

      const { direction } = movementDecision;
      lastPlayerDirectionRef.current = direction;
      const requestedDistance = elapsedMs / playerMoveDurationMs;
      const position = playerVisualPositionRef.current;
      const currentCell = nearestCellFromPosition(position);
      const bufferedTurn = requestedPlayerDirections().find(
        candidate =>
          candidate.buffered &&
          isPerpendicularDirection(direction, candidate.direction) &&
          isPlayerWalkable(
            { x: currentCell.x + candidate.direction.x, z: currentCell.z + candidate.direction.z },
            wallSet,
            destructibleSetRef.current,
            bombSetRef.current,
            playerPassableBombCellKeysRef.current
          )
      );
      const distanceToCenter = distanceToCurrentCellCenter(position, currentCell, direction);
      const distanceToExplicitStop =
        movementDecision.stopAtCellCenter !== undefined
          ? distanceToCellCenter(position, movementDecision.stopAtCellCenter, directionAxis(direction))
          : null;
      const movementDistance =
        distanceToExplicitStop !== null
          ? Math.min(requestedDistance, distanceToExplicitStop)
          : bufferedTurn && distanceToCenter > 0.0001
            ? Math.min(requestedDistance, distanceToCenter)
            : requestedDistance;

      movePlayerContinuously(position, direction, movementDistance, enterableCellInDirection);
      syncPlayerLogicalCell();
    });

    return () => {
      scene.onBeforeRenderObservable.remove(observer);
    };
  }, [
    choosePlayerDirection,
    enterableCellInDirection,
    playerMoveDurationMs,
    requestedPlayerDirections,
    scene,
    syncPlayerLogicalCell,
    wallSet
  ]);

  useEffect(() => {
    const canvas = document.getElementById("reactylon-canvas") as HTMLCanvasElement | null;
    canvas?.setAttribute("tabindex", "0");

    const focusCanvas = () => {
      canvas?.focus();
    };

    canvas?.addEventListener("pointerdown", focusCanvas);

    const clearHeldMovement = () => {
      heldMoveCommandsRef.current.clear();
      bufferedMoveRef.current = null;
      playerDirectionRef.current = null;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (gameStatusRef.current !== "playing") {
        return;
      }

      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        target?.tagName === "TEXTAREA" || target?.tagName === "INPUT" || target?.isContentEditable === true;
      if (isTypingTarget) {
        return;
      }

      const key = event.key.toLowerCase();
      const moveCommand = moveCommandForKey(key);
      if (moveCommand) {
        event.preventDefault();
        if (!heldMoveCommandsRef.current.has(key)) {
          heldMoveCommandsRef.current.set(key, moveCommand);
          bufferedMoveRef.current = {
            command: moveCommand,
            expiresAt: performance.now() + playerTurnBufferMs
          };
        }
      } else if ((key === " " || key === "b") && !event.repeat) {
        event.preventDefault();
        placeBomb();
      } else if (key === "t" && !event.repeat) {
        event.preventDefault();
        throwBomb();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!moveCommandForKey(key)) {
        return;
      }

      event.preventDefault();
      heldMoveCommandsRef.current.delete(key);
      if (heldMoveCommandsRef.current.size === 0) {
        playerDirectionRef.current = null;
      }
    };

    const handlePlaceBombEvent = () => {
      placeBomb();
      focusCanvas();
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp, { capture: true });
    window.addEventListener("blur", clearHeldMovement);
    window.addEventListener("arena:place-bomb", handlePlaceBombEvent);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyUp, { capture: true });
      window.removeEventListener("blur", clearHeldMovement);
      window.removeEventListener("arena:place-bomb", handlePlaceBombEvent);
      canvas?.removeEventListener("pointerdown", focusCanvas);
      clearHeldMovement();
    };
  }, [placeBomb, throwBomb]);

  useEffect(() => {
    let previousFrameAt = performance.now();

    const clearGamepadMovement = () => {
      heldMoveCommandsRef.current.delete(gamepadMoveKey);
      gamepadMoveCommandRef.current = null;
      if (heldMoveCommandsRef.current.size === 0) {
        playerDirectionRef.current = null;
      }
    };

    const observer = scene.onBeforeRenderObservable.add(() => {
      const now = performance.now();
      const elapsedSeconds = Math.min(0.05, (now - previousFrameAt) / 1000);
      previousFrameAt = now;

      const gamepad = firstConnectedGamepad();
      if (!gamepad) {
        clearGamepadMovement();
        gamepadButtonStateRef.current = { placeBomb: false, throwBomb: false };
        return;
      }

      applyGamepadCamera(scene, viewMode, gamepad, elapsedSeconds);

      if (gameStatusRef.current !== "playing") {
        clearGamepadMovement();
        gamepadButtonStateRef.current = {
          placeBomb: gamepadButtonPressed(gamepad, 0),
          throwBomb: gamepadButtonPressed(gamepad, 3)
        };
        return;
      }

      const nextMoveCommand = gamepadMoveCommand(gamepad);
      if (nextMoveCommand !== gamepadMoveCommandRef.current) {
        heldMoveCommandsRef.current.delete(gamepadMoveKey);
        gamepadMoveCommandRef.current = nextMoveCommand;

        if (nextMoveCommand) {
          heldMoveCommandsRef.current.set(gamepadMoveKey, nextMoveCommand);
          bufferedMoveRef.current = {
            command: nextMoveCommand,
            expiresAt: now + playerTurnBufferMs
          };
        } else if (heldMoveCommandsRef.current.size === 0) {
          playerDirectionRef.current = null;
        }
      }

      const placeBombPressed = gamepadButtonPressed(gamepad, 0);
      const throwBombPressed = gamepadButtonPressed(gamepad, 3);
      if (placeBombPressed && !gamepadButtonStateRef.current.placeBomb) {
        placeBomb();
      }
      if (throwBombPressed && !gamepadButtonStateRef.current.throwBomb) {
        throwBomb();
      }

      gamepadButtonStateRef.current = {
        placeBomb: placeBombPressed,
        throwBomb: throwBombPressed
      };
    });

    return () => {
      scene.onBeforeRenderObservable.remove(observer);
      clearGamepadMovement();
      gamepadButtonStateRef.current = { placeBomb: false, throwBomb: false };
    };
  }, [placeBomb, scene, throwBomb, viewMode]);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      if (gameStatusRef.current !== "playing") {
        return;
      }

      const now = performance.now();
      const currentEnemies = enemiesRef.current;
      if (currentEnemies.length === 0) {
        return;
      }

      const occupiedEnemyCells = new Set(currentEnemies.map(enemy => cellKey(enemy.cell)));
      let enemyPositionsChanged = false;
      const nextEnemies = currentEnemies.map(enemy => {
        if (enemy.nextMoveAt > now) {
          return enemy;
        }

        occupiedEnemyCells.delete(cellKey(enemy.cell));
        const nextDirection = chooseEnemyDirection(
          enemy,
          playerCellRef.current,
          wallSet,
          destructibleSetRef.current,
          bombSetRef.current,
          occupiedEnemyCells
        );
        const nextCell = nextDirection
          ? { x: enemy.cell.x + nextDirection.x, z: enemy.cell.z + nextDirection.z }
          : enemy.cell;
        const didMove = !sameCell(nextCell, enemy.cell);
        enemyPositionsChanged ||= didMove;
        const movedEnemy = {
          ...enemy,
          cell: nextCell,
          visualFromCell: didMove ? enemy.cell : nextCell,
          visualMoveStartedAt: didMove ? now : enemy.visualMoveStartedAt,
          visualMoveDurationMs: didMove ? enemyVisualMoveDurationMs(enemy.type) : 0,
          direction: nextDirection ?? enemy.direction,
          nextMoveAt: now + enemyMoveIntervalMs(enemy.type)
        };
        occupiedEnemyCells.add(cellKey(movedEnemy.cell));
        return movedEnemy;
      });

      enemiesRef.current = nextEnemies;
      if (enemyPositionsChanged) {
        setEnemies(nextEnemies);
      }

      const playerCurrentCell = nearestCellFromPosition(playerVisualPositionRef.current);
      const enemyTouchedPlayer = nextEnemies.some(enemy => sameCell(enemyCollisionCell(enemy, now), playerCurrentCell));
      if (
        enemyTouchedPlayer ||
        nextEnemies.some(enemy => isEnemyInActiveBlast(enemy, blastsRef.current, now))
      ) {
        const defeatedEnemies = nextEnemies.filter(enemy => isEnemyInActiveBlast(enemy, blastsRef.current, now));
        const survivingEnemies = nextEnemies.filter(enemy => !isEnemyInActiveBlast(enemy, blastsRef.current, now));
        if (survivingEnemies.length !== nextEnemies.length) {
          enemiesRef.current = survivingEnemies;
          setEnemies(survivingEnemies);
          emitFeedback(
            defeatedEnemies.map(enemy => ({ kind: "enemy_down" as const, cell: enemyCollisionCell(enemy, now) })),
            setFeedbackCues
          );
          playGameTone("enemy_down");
        }

        if (enemyTouchedPlayer) {
          finishGame("lost");
          return;
        }

        if (survivingEnemies.length === 0) {
          finishGame("won");
        }
      }
    }, enemyTickMs);

    return () => {
      window.clearInterval(timerId);
    };
  }, [finishGame, wallSet]);

  return (
    <>
      <ArenaCamera
        viewMode={viewMode}
        playerVisualPositionRef={playerVisualPositionRef}
      />
      <hemisphericLight
        name="ambient-light"
        direction={new Vector3(0, 1, 0)}
        diffuse={Color3.FromHexString(lighting.diffuse)}
        groundColor={Color3.FromHexString(lighting.ground)}
        intensity={isTopDown ? 0.82 : 0.9}
      />
      {!isTopDown ? (
        <>
          <directionalLight
            name="arena-fill-light"
            direction={new Vector3(-0.32, -1, 0.24)}
            diffuse={Color3.FromHexString(lighting.diffuse)}
            specular={Color3.FromHexString(arena.palette.secondary)}
            intensity={0.28}
          />
          <PerimeterAccentLights arena={arena} visualStyle={visualStyle} />

          <EnergyGrid arena={arena} visualStyle={visualStyle} />
          <ArenaBeacon arena={arena} visualStyle={visualStyle} />
          <StageDetails arena={arena} visualStyle={visualStyle} />
          <MutationWave arena={arena} />
        </>
      ) : null}

      {isTopDown ? (
        <TopDownStaticArenaLayer
          arena={arena}
          visualStyle={visualStyle}
          floorCells={floorCells}
          wallCells={wallCells}
          destructibleCells={destructibleCells}
        />
      ) : (
        <StaticArenaLayer3D
          arena={arena}
          visualStyle={visualStyle}
          floorCells={floorCells}
          wallCells={wallCells}
          destructibleCells={destructibleCells}
          floorMaterial={floorMaterial}
          wallMaterial={wallMaterial}
          crateMaterial={crateMaterial}
        />
      )}

      {bombs.map(activeBomb =>
        isTopDown ? (
          <TopDownBombSprite key={`bomb-${activeBomb.id}-${arena.bomb}`} bomb={activeBomb} arena={arena} visualStyle={visualStyle} />
        ) : (
          <BombToken key={`bomb-${activeBomb.id}-${arena.bomb}`} bomb={activeBomb} material={bombMaterial} visualStyle={visualStyle} />
        )
      )}

      {powerUps.map(powerUp =>
        isTopDown ? (
          <TopDownPowerUpSprite key={powerUp.id} powerUp={powerUp} visualStyle={visualStyle} />
        ) : (
          <PowerUpToken key={powerUp.id} powerUp={powerUp} isTopDown={isTopDown} visualStyle={visualStyle} />
        )
      )}

      {enemies.map(enemy =>
        isTopDown ? (
          <TopDownEnemySprite key={enemy.id} enemy={enemy} visualStyle={visualStyle} />
        ) : (
          <EnemyToken key={enemy.id} enemy={enemy} isTopDown={isTopDown} visualStyle={visualStyle} />
        )
      )}

      {isTopDown ? (
        <TopDownPlayerSprite visualPositionRef={playerVisualPositionRef} visualStyle={visualStyle} />
      ) : (
        <Player
          arena={arena}
          isTopDown={isTopDown}
          visualStyle={visualStyle}
          visualPositionRef={playerVisualPositionRef}
          lastDirectionRef={lastPlayerDirectionRef}
        />
      )}
      {!isTopDown ? <ParticleMotes arena={arena} /> : null}
      {blasts.map(blast => (
        isTopDown ? <TopDownBlastCells key={blast.id} blast={blast} /> : <BlastCells key={blast.id} blast={blast} />
      ))}
      {feedbackCues.map(cue => (
        <FeedbackPulse key={cue.id} cue={cue} onComplete={() => setFeedbackCues(current => current.filter(item => item.id !== cue.id))} />
      ))}
      {arena.explosion ? <DirectedExplosion cue={arena.explosion} wallSet={wallSet} destructibleSet={destructibleSet} isTopDown={isTopDown} /> : null}
    </>
  );
}

function PerimeterAccentLights({ arena, visualStyle }: { arena: ArenaState; visualStyle: VisualStyle }) {
  const intensity = visualStyle === "toy_like" ? 0.08 : visualStyle === "arcade_premium" ? 0.1 : 0.1;
  const accents = [
    { position: new Vector3(-10, 3.2, -10), color: arena.palette.accent },
    { position: new Vector3(10, 3.2, -10), color: arena.palette.secondary },
    { position: new Vector3(-10, 3.2, 10), color: arena.palette.secondary },
    { position: new Vector3(10, 3.2, 10), color: arena.palette.accent }
  ];

  return (
    <>
      {accents.map((accent, index) => (
        <pointLight
          key={`perimeter-light-${index}-${arena.theme}-${visualStyle}`}
          name={`perimeter-light-${index}`}
          position={accent.position}
          diffuse={Color3.FromHexString(accent.color)}
          specular={Color3.FromHexString(accent.color)}
          intensity={intensity}
          range={7}
        />
      ))}
    </>
  );
}

interface TopDownVisualPalette {
  floor: string;
  floorAccent: string;
  wall: string;
  wallLight: string;
  wallShadow: string;
  crate: string;
  crateLight: string;
  crateDark: string;
  outline: string;
  playerSuit: string;
  playerFace: string;
  playerTrim: string;
  playerGlove: string;
  playerBoot: string;
  bomb: string;
  fuse: string;
  ink: string;
  panel: string;
  wanderer: string;
  chaser: string;
  ghost: string;
}

type TopDownMergedBoxSpec = {
  name: string;
  cells: Cell[];
  material: StandardMaterial;
  options: { width: number; height: number; depth: number };
  position: (cell: Cell) => Vector3;
};

type MergedPrimitiveSpec = {
  name: string;
  cells: Cell[];
  material: StandardMaterial;
  createMesh: (cell: Cell, index: number) => Mesh;
};

function StaticArenaLayer3D({
  arena,
  visualStyle,
  floorCells,
  wallCells,
  destructibleCells,
  floorMaterial,
  wallMaterial,
  crateMaterial
}: {
  arena: ArenaState;
  visualStyle: VisualStyle;
  floorCells: Cell[];
  wallCells: Cell[];
  destructibleCells: Cell[];
  floorMaterial: MaterialLook;
  wallMaterial: MaterialLook;
  crateMaterial: MaterialLook;
}) {
  const scene = useScene();
  const styleKey = [
    arena.theme,
    arena.palette.primary,
    arena.palette.secondary,
    arena.palette.accent,
    visualStyle,
    floorMaterial.diffuse,
    floorMaterial.emissive,
    floorMaterial.specular,
    floorMaterial.alpha ?? 1,
    wallMaterial.diffuse,
    wallMaterial.emissive,
    wallMaterial.specular,
    wallMaterial.alpha ?? 1,
    crateMaterial.diffuse,
    crateMaterial.emissive,
    crateMaterial.specular,
    crateMaterial.alpha ?? 1
  ].join("|");

  useLayoutEffect(() => {
    const materials: StandardMaterial[] = [];
    const registerMaterial = (name: string, look: MaterialLook) => {
      const material = createStaticMaterialFromLook(scene, name, look);
      materials.push(material);
      return material;
    };
    const stripeCells = floorCells.filter(cell => floorHasStripe(cell));
    const floorBaseMaterial = registerMaterial("static-3d-floor-material", floorMaterial);
    const wallBaseMaterial = registerMaterial("static-3d-wall-material", wallMaterial);
    const meshes = [
      createMergedPrimitiveGroup(scene, {
        name: "static-3d-floor",
        cells: floorCells,
        material: floorBaseMaterial,
        createMesh: (cell, index) =>
          createSourceBox(scene, `static-3d-floor-source-${index}`, cellPosition(cell.x, cell.z, -0.07), {
            width: 0.94,
            height: 0.14,
            depth: 0.94
          })
      }),
      createMergedPrimitiveGroup(scene, {
        name: "static-3d-wall",
        cells: wallCells,
        material: wallBaseMaterial,
        createMesh: (cell, index) =>
          createSourceBox(scene, `static-3d-wall-source-${index}`, cellPosition(cell.x, cell.z, 0.5), {
            width: 0.9,
            height: 1.1,
            depth: 0.9
          })
      })
    ];

    if (visualStyle === "arcade_premium") {
      const floorInlayMaterial = registerMaterial("static-3d-floor-inlay-material", materialLook("#CBD5E1"));
      const wallCapMaterial = registerMaterial("static-3d-wall-cap-material", materialLook("#E2E8F0"));
      meshes.push(
        createMergedPrimitiveGroup(scene, {
          name: "static-3d-floor-inlay",
          cells: stripeCells,
          material: floorInlayMaterial,
          createMesh: (cell, index) =>
            createSourceBox(scene, `static-3d-floor-inlay-source-${index}`, cellPosition(cell.x, cell.z, 0.012), {
              width: 0.58,
              height: 0.018,
              depth: 0.05
            })
        }),
        createMergedPrimitiveGroup(scene, {
          name: "static-3d-wall-cap",
          cells: wallCells,
          material: wallCapMaterial,
          createMesh: (cell, index) =>
            createSourceBox(scene, `static-3d-wall-cap-source-${index}`, cellPosition(cell.x, cell.z, 1.09), {
              width: 0.78,
              height: 0.08,
              depth: 0.78
            })
        })
      );
    }

    if (visualStyle === "toy_like") {
      const floorDotMaterial = registerMaterial("static-3d-floor-dot-material", materialLook("#FFFFFF", "#000000", "#FFFFFF", 0.48));
      const wallBumpMaterial = registerMaterial("static-3d-wall-bump-material", materialLook("#FFFFFF", "#000000", "#FFFFFF", 0.42));
      meshes.push(
        createMergedPrimitiveGroup(scene, {
          name: "static-3d-floor-dot",
          cells: stripeCells,
          material: floorDotMaterial,
          createMesh: (cell, index) =>
            createSourceCylinder(scene, `static-3d-floor-dot-source-${index}`, cellPosition(cell.x, cell.z, 0.012), {
              height: 0.02,
              diameter: 0.16,
              tessellation: 24
            })
        }),
        createMergedPrimitiveGroup(scene, {
          name: "static-3d-wall-bump",
          cells: wallCells,
          material: wallBumpMaterial,
          createMesh: (cell, index) =>
            createSourceSphere(scene, `static-3d-wall-bump-source-${index}`, cellPosition(cell.x, cell.z, 1.08), {
              diameter: 0.34,
              segments: 20
            })
        })
      );
    }

    if (visualStyle === "neon_cinematic") {
      const floorNeonMaterial = registerMaterial("static-3d-floor-neon-material", materialLook("#67E8F9", "#0E7490", "#A5F3FC", 0.58));
      const wallStripAccentMaterial = registerMaterial(
        "static-3d-wall-strip-a-material",
        materialLook(arena.palette.accent, softenHex(arena.palette.accent, 0.38), "#F8FAFC")
      );
      const wallStripSecondaryMaterial = registerMaterial(
        "static-3d-wall-strip-b-material",
        materialLook(arena.palette.secondary, softenHex(arena.palette.secondary, 0.38), "#F8FAFC")
      );
      meshes.push(
        createMergedPrimitiveGroup(scene, {
          name: "static-3d-floor-neon",
          cells: stripeCells,
          material: floorNeonMaterial,
          createMesh: (cell, index) =>
            createSourceBox(scene, `static-3d-floor-neon-source-${index}`, cellPosition(cell.x, cell.z, 0.014), {
              width: 0.72,
              height: 0.02,
              depth: 0.035
            })
        }),
        createMergedPrimitiveGroup(scene, {
          name: "static-3d-wall-strip-a",
          cells: wallCells,
          material: wallStripAccentMaterial,
          createMesh: (cell, index) =>
            createSourceBox(scene, `static-3d-wall-strip-a-source-${index}`, cellPosition(cell.x, cell.z - 0.46, 0.52), {
              width: 0.54,
              height: 0.06,
              depth: 0.03
            })
        }),
        createMergedPrimitiveGroup(scene, {
          name: "static-3d-wall-strip-b",
          cells: wallCells,
          material: wallStripSecondaryMaterial,
          createMesh: (cell, index) =>
            createSourceBox(scene, `static-3d-wall-strip-b-source-${index}`, cellPosition(cell.x, cell.z + 0.46, 0.52), {
              width: 0.54,
              height: 0.06,
              depth: 0.03
            })
        })
      );
    }

    const mergedMeshes = meshes.filter((mesh): mesh is Mesh => mesh !== null);
    return () => {
      disposeMergedLayer(mergedMeshes, materials);
    };
  }, [arena.palette.accent, arena.palette.secondary, floorCells, floorMaterial, scene, styleKey, visualStyle, wallCells, wallMaterial]);

  useLayoutEffect(() => {
    const materials: StandardMaterial[] = [];
    const registerMaterial = (name: string, look: MaterialLook) => {
      const material = createStaticMaterialFromLook(scene, name, look);
      materials.push(material);
      return material;
    };
    const crateBaseMaterial = registerMaterial("static-3d-crate-material", crateMaterial);
    const meshes = [
      createMergedPrimitiveGroup(scene, {
        name: "static-3d-crate",
        cells: destructibleCells,
        material: crateBaseMaterial,
        createMesh: (cell, index) => {
          const variant = crateVisualVariant(cell);
          return createSourceBox(
            scene,
            `static-3d-crate-source-${index}`,
            cellPosition(cell.x, cell.z, 0.34 + variant.heightOffset),
            {
              width: visualStyle === "toy_like" ? 0.78 : 0.74,
              height: visualStyle === "toy_like" ? 0.76 : 0.72,
              depth: visualStyle === "toy_like" ? 0.78 : 0.74
            },
            { rotationY: variant.rotationY }
          );
        }
      })
    ];

    if (visualStyle === "arcade_premium") {
      const crateBandMaterial = registerMaterial("static-3d-crate-band-material", materialLook("#FED7AA"));
      const crateLineMaterial = registerMaterial("static-3d-crate-line-material", materialLook("#F0C58A", "#000000", "#FDE68A"));
      const crateSeamMaterial = registerMaterial("static-3d-crate-seam-material", materialLook("#7C4A22", "#000000", "#F59E0B"));
      meshes.push(
        createMergedPrimitiveGroup(scene, {
          name: "static-3d-crate-top-panel",
          cells: destructibleCells,
          material: crateLineMaterial,
          createMesh: (cell, index) =>
            createSourceBox(scene, `static-3d-crate-top-panel-source-${index}`, cellPosition(cell.x, cell.z, 0.72), {
              width: 0.62,
              height: 0.035,
              depth: 0.62
            })
        }),
        createMergedPrimitiveGroup(scene, {
          name: "static-3d-crate-band-x",
          cells: destructibleCells,
          material: crateBandMaterial,
          createMesh: (cell, index) =>
            createSourceBox(scene, `static-3d-crate-band-x-source-${index}`, cellPosition(cell.x, cell.z, 0.36), {
              width: 0.8,
              height: 0.08,
              depth: 0.1
            })
        }),
        createMergedPrimitiveGroup(scene, {
          name: "static-3d-crate-band-z",
          cells: destructibleCells,
          material: crateBandMaterial,
          createMesh: (cell, index) =>
            createSourceBox(scene, `static-3d-crate-band-z-source-${index}`, cellPosition(cell.x, cell.z, 0.36), {
              width: 0.1,
              height: 0.08,
              depth: 0.8
            })
        }),
        createMergedPrimitiveGroup(scene, {
          name: "static-3d-crate-front-line-a",
          cells: destructibleCells,
          material: crateLineMaterial,
          createMesh: (cell, index) =>
            createSourceBox(scene, `static-3d-crate-front-line-a-source-${index}`, cellPosition(cell.x, cell.z - 0.39, 0.52), {
              width: 0.62,
              height: 0.055,
              depth: 0.035
            })
        }),
        createMergedPrimitiveGroup(scene, {
          name: "static-3d-crate-front-line-b",
          cells: destructibleCells,
          material: crateSeamMaterial,
          createMesh: (cell, index) =>
            createSourceBox(scene, `static-3d-crate-front-line-b-source-${index}`, cellPosition(cell.x, cell.z - 0.39, 0.34), {
              width: 0.62,
              height: 0.05,
              depth: 0.035
            })
        }),
        createMergedPrimitiveGroup(scene, {
          name: "static-3d-crate-back-line-a",
          cells: destructibleCells,
          material: crateLineMaterial,
          createMesh: (cell, index) =>
            createSourceBox(scene, `static-3d-crate-back-line-a-source-${index}`, cellPosition(cell.x, cell.z + 0.39, 0.52), {
              width: 0.62,
              height: 0.055,
              depth: 0.035
            })
        }),
        createMergedPrimitiveGroup(scene, {
          name: "static-3d-crate-back-line-b",
          cells: destructibleCells,
          material: crateSeamMaterial,
          createMesh: (cell, index) =>
            createSourceBox(scene, `static-3d-crate-back-line-b-source-${index}`, cellPosition(cell.x, cell.z + 0.39, 0.34), {
              width: 0.62,
              height: 0.05,
              depth: 0.035
            })
        }),
        createMergedPrimitiveGroup(scene, {
          name: "static-3d-crate-left-line-a",
          cells: destructibleCells,
          material: crateLineMaterial,
          createMesh: (cell, index) =>
            createSourceBox(scene, `static-3d-crate-left-line-a-source-${index}`, cellPosition(cell.x - 0.39, cell.z, 0.52), {
              width: 0.035,
              height: 0.055,
              depth: 0.62
            })
        }),
        createMergedPrimitiveGroup(scene, {
          name: "static-3d-crate-left-line-b",
          cells: destructibleCells,
          material: crateSeamMaterial,
          createMesh: (cell, index) =>
            createSourceBox(scene, `static-3d-crate-left-line-b-source-${index}`, cellPosition(cell.x - 0.39, cell.z, 0.34), {
              width: 0.035,
              height: 0.05,
              depth: 0.62
            })
        }),
        createMergedPrimitiveGroup(scene, {
          name: "static-3d-crate-right-line-a",
          cells: destructibleCells,
          material: crateLineMaterial,
          createMesh: (cell, index) =>
            createSourceBox(scene, `static-3d-crate-right-line-a-source-${index}`, cellPosition(cell.x + 0.39, cell.z, 0.52), {
              width: 0.035,
              height: 0.055,
              depth: 0.62
            })
        }),
        createMergedPrimitiveGroup(scene, {
          name: "static-3d-crate-right-line-b",
          cells: destructibleCells,
          material: crateSeamMaterial,
          createMesh: (cell, index) =>
            createSourceBox(scene, `static-3d-crate-right-line-b-source-${index}`, cellPosition(cell.x + 0.39, cell.z, 0.34), {
              width: 0.035,
              height: 0.05,
              depth: 0.62
            })
        })
      );
    }

    if (visualStyle === "toy_like") {
      const crateStickerMaterial = registerMaterial("static-3d-crate-sticker-material", materialLook("#FFFFFF"));
      meshes.push(
        createMergedPrimitiveGroup(scene, {
          name: "static-3d-crate-sticker",
          cells: destructibleCells,
          material: crateStickerMaterial,
          createMesh: (cell, index) =>
            createSourceSphere(scene, `static-3d-crate-sticker-source-${index}`, cellPosition(cell.x, cell.z - 0.39, 0.42), {
              diameter: 0.18,
              segments: 18
            })
        })
      );
    }

    if (visualStyle === "neon_cinematic") {
      const crateRuneMaterial = registerMaterial("static-3d-crate-rune-material", materialLook("#F472B6", "#831843", "#FBCFE8"));
      meshes.push(
        createMergedPrimitiveGroup(scene, {
          name: "static-3d-crate-rune",
          cells: destructibleCells,
          material: crateRuneMaterial,
          createMesh: (cell, index) =>
            createSourceBox(scene, `static-3d-crate-rune-source-${index}`, cellPosition(cell.x, cell.z - 0.39, 0.42), {
              width: 0.42,
              height: 0.06,
              depth: 0.03
            })
        })
      );
    }

    const mergedMeshes = meshes.filter((mesh): mesh is Mesh => mesh !== null);
    return () => {
      disposeMergedLayer(mergedMeshes, materials);
    };
  }, [crateMaterial, destructibleCells, scene, styleKey, visualStyle]);

  return null;
}

function TopDownStaticArenaLayer({
  arena,
  visualStyle,
  floorCells,
  wallCells,
  destructibleCells
}: {
  arena: ArenaState;
  visualStyle: VisualStyle;
  floorCells: Cell[];
  wallCells: Cell[];
  destructibleCells: Cell[];
}) {
  const scene = useScene();
  const palette = topDownVisualPalette(arena, visualStyle);
  const paletteKey = [
    arena.theme,
    arena.palette.primary,
    arena.palette.secondary,
    visualStyle,
    palette.floor,
    palette.floorAccent,
    palette.wall,
    palette.wallLight,
    palette.wallShadow,
    palette.crate,
    palette.crateLight,
    palette.crateDark,
    palette.outline
  ].join("|");

  useLayoutEffect(() => {
    const floorMaterial = createTopDownStaticMaterial(scene, "topdown-static-floor-material", palette.floor);
    const floorAccentMaterial = createTopDownStaticMaterial(
      scene,
      "topdown-static-floor-accent-material",
      palette.floorAccent,
      0.7
    );
    const wallOutlineMaterial = createTopDownStaticMaterial(scene, "topdown-static-wall-outline-material", palette.outline);
    const wallMaterial = createTopDownStaticMaterial(scene, "topdown-static-wall-material", palette.wall);
    const wallLightMaterial = createTopDownStaticMaterial(scene, "topdown-static-wall-light-material", palette.wallLight);
    const wallShadowMaterial = createTopDownStaticMaterial(scene, "topdown-static-wall-shadow-material", palette.wallShadow);

    const stripeCells = floorCells.filter(cell => topDownFloorHasStripe(cell));
    const meshes = [
      createMergedTopDownBoxes(scene, {
        name: "topdown-static-floor",
        cells: floorCells,
        material: floorMaterial,
        options: { width: 1, height: 0.08, depth: 1 },
        position: cell => cellPosition(cell.x, cell.z, -0.055)
      }),
      createMergedTopDownBoxes(scene, {
        name: "topdown-static-floor-accent",
        cells: stripeCells,
        material: floorAccentMaterial,
        options: { width: 0.58, height: 0.012, depth: 0.05 },
        position: cell => cellPosition(cell.x, cell.z, -0.008)
      }),
      createMergedTopDownBoxes(scene, {
        name: "topdown-static-wall-outline",
        cells: wallCells,
        material: wallOutlineMaterial,
        options: { width: 0.94, height: 0.08, depth: 0.94 },
        position: cell => cellPosition(cell.x, cell.z, 0.045)
      }),
      createMergedTopDownBoxes(scene, {
        name: "topdown-static-wall",
        cells: wallCells,
        material: wallMaterial,
        options: { width: 0.84, height: 0.1, depth: 0.84 },
        position: cell => cellPosition(cell.x, cell.z, 0.09)
      }),
      createMergedTopDownBoxes(scene, {
        name: "topdown-static-wall-highlight-top",
        cells: wallCells,
        material: wallLightMaterial,
        options: { width: 0.68, height: 0.018, depth: 0.08 },
        position: cell => cellPosition(cell.x, cell.z - 0.33, 0.15)
      }),
      createMergedTopDownBoxes(scene, {
        name: "topdown-static-wall-highlight-left",
        cells: wallCells,
        material: wallLightMaterial,
        options: { width: 0.08, height: 0.018, depth: 0.68 },
        position: cell => cellPosition(cell.x - 0.33, cell.z, 0.15)
      }),
      createMergedTopDownBoxes(scene, {
        name: "topdown-static-wall-shadow-bottom",
        cells: wallCells,
        material: wallShadowMaterial,
        options: { width: 0.72, height: 0.018, depth: 0.08 },
        position: cell => cellPosition(cell.x, cell.z + 0.34, 0.15)
      }),
      createMergedTopDownBoxes(scene, {
        name: "topdown-static-wall-shadow-right",
        cells: wallCells,
        material: wallShadowMaterial,
        options: { width: 0.08, height: 0.018, depth: 0.72 },
        position: cell => cellPosition(cell.x + 0.34, cell.z, 0.15)
      })
    ].filter((mesh): mesh is Mesh => mesh !== null);
    const materials = [floorMaterial, floorAccentMaterial, wallOutlineMaterial, wallMaterial, wallLightMaterial, wallShadowMaterial];

    return () => {
      disposeTopDownMergedLayer(meshes, materials);
    };
  }, [floorCells, paletteKey, scene, wallCells]);

  useLayoutEffect(() => {
    const crateOutlineMaterial = createTopDownStaticMaterial(scene, "topdown-static-crate-outline-material", palette.outline);
    const crateMaterial = createTopDownStaticMaterial(scene, "topdown-static-crate-material", palette.crate);
    const crateLightMaterial = createTopDownStaticMaterial(scene, "topdown-static-crate-light-material", palette.crateLight);
    const crateDarkMaterial = createTopDownStaticMaterial(scene, "topdown-static-crate-dark-material", palette.crateDark);

    const meshes = [
      createMergedTopDownBoxes(scene, {
        name: "topdown-static-crate-outline",
        cells: destructibleCells,
        material: crateOutlineMaterial,
        options: { width: 0.94, height: 0.08, depth: 0.94 },
        position: cell => cellPosition(cell.x, cell.z, 0.045)
      }),
      createMergedTopDownBoxes(scene, {
        name: "topdown-static-crate",
        cells: destructibleCells,
        material: crateMaterial,
        options: { width: 0.84, height: 0.1, depth: 0.84 },
        position: cell => cellPosition(cell.x, cell.z, 0.09)
      }),
      createMergedTopDownBoxes(scene, {
        name: "topdown-static-crate-line-a",
        cells: destructibleCells,
        material: crateLightMaterial,
        options: { width: 0.72, height: 0.018, depth: 0.07 },
        position: cell => cellPosition(cell.x, cell.z - 0.21, 0.15)
      }),
      createMergedTopDownBoxes(scene, {
        name: "topdown-static-crate-line-b",
        cells: destructibleCells,
        material: crateDarkMaterial,
        options: { width: 0.72, height: 0.018, depth: 0.07 },
        position: cell => cellPosition(cell.x, cell.z + 0.05, 0.15)
      }),
      createMergedTopDownBoxes(scene, {
        name: "topdown-static-crate-line-c",
        cells: destructibleCells,
        material: crateLightMaterial,
        options: { width: 0.72, height: 0.018, depth: 0.07 },
        position: cell => cellPosition(cell.x, cell.z + 0.29, 0.15)
      }),
      createMergedTopDownBoxes(scene, {
        name: "topdown-static-crate-seam-a",
        cells: destructibleCells,
        material: crateDarkMaterial,
        options: { width: 0.07, height: 0.018, depth: 0.24 },
        position: cell => cellPosition(cell.x - 0.18, cell.z - 0.08, 0.16)
      }),
      createMergedTopDownBoxes(scene, {
        name: "topdown-static-crate-seam-b",
        cells: destructibleCells,
        material: crateDarkMaterial,
        options: { width: 0.07, height: 0.018, depth: 0.24 },
        position: cell => cellPosition(cell.x + 0.2, cell.z + 0.17, 0.16)
      })
    ].filter((mesh): mesh is Mesh => mesh !== null);
    const materials = [crateOutlineMaterial, crateMaterial, crateLightMaterial, crateDarkMaterial];

    return () => {
      disposeTopDownMergedLayer(meshes, materials);
    };
  }, [destructibleCells, paletteKey, scene]);

  return null;
}

function createTopDownStaticMaterial(scene: BabylonScene, name: string, diffuse: string, alpha = 1) {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = Color3.FromHexString(diffuse);
  material.emissiveColor = Color3.FromHexString("#000000");
  material.specularColor = Color3.Black();
  material.specularPower = 0;
  material.alpha = alpha;
  material.freeze();
  return material;
}

function materialLook(diffuse: string, emissive = "#000000", specular = "#FFFFFF", alpha = 1): MaterialLook {
  return { diffuse, emissive, specular, alpha };
}

function createStaticMaterialFromLook(scene: BabylonScene, name: string, look: MaterialLook) {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = Color3.FromHexString(look.diffuse);
  material.emissiveColor = Color3.FromHexString(look.emissive);
  material.specularColor = Color3.FromHexString(look.specular);
  material.alpha = look.alpha ?? 1;
  material.freeze();
  return material;
}

function createMergedTopDownBoxes(scene: BabylonScene, spec: TopDownMergedBoxSpec) {
  if (spec.cells.length === 0) {
    return null;
  }

  const sourceMeshes = spec.cells.map((cell, index) => {
    const mesh = MeshBuilder.CreateBox(`${spec.name}-source-${index}`, spec.options, scene);
    mesh.position.copyFrom(spec.position(cell));
    mesh.material = spec.material;
    return mesh;
  });
  const mergedMesh = Mesh.MergeMeshes(sourceMeshes, true, true);
  if (!mergedMesh) {
    return null;
  }

  mergedMesh.name = spec.name;
  mergedMesh.material = spec.material;
  mergedMesh.isPickable = false;
  mergedMesh.freezeWorldMatrix();
  return mergedMesh;
}

function createMergedPrimitiveGroup(scene: BabylonScene, spec: MergedPrimitiveSpec) {
  if (spec.cells.length === 0) {
    return null;
  }

  const sourceMeshes = spec.cells.map((cell, index) => {
    const mesh = spec.createMesh(cell, index);
    mesh.material = spec.material;
    return mesh;
  });
  const mergedMesh = Mesh.MergeMeshes(sourceMeshes, true, true);
  if (!mergedMesh) {
    return null;
  }

  mergedMesh.name = spec.name;
  mergedMesh.material = spec.material;
  mergedMesh.isPickable = false;
  mergedMesh.freezeWorldMatrix();
  return mergedMesh;
}

function createSourceBox(
  scene: BabylonScene,
  name: string,
  position: Vector3,
  options: { width: number; height: number; depth: number },
  transform?: { rotationY?: number }
) {
  const mesh = MeshBuilder.CreateBox(name, options, scene);
  mesh.position.copyFrom(position);
  if (transform?.rotationY !== undefined) {
    mesh.rotation.y = transform.rotationY;
  }
  return mesh;
}

function createSourceCylinder(
  scene: BabylonScene,
  name: string,
  position: Vector3,
  options: { height: number; diameter: number; tessellation: number }
) {
  const mesh = MeshBuilder.CreateCylinder(name, options, scene);
  mesh.position.copyFrom(position);
  return mesh;
}

function createSourceSphere(
  scene: BabylonScene,
  name: string,
  position: Vector3,
  options: { diameter: number; segments: number }
) {
  const mesh = MeshBuilder.CreateSphere(name, options, scene);
  mesh.position.copyFrom(position);
  return mesh;
}

function disposeTopDownMergedLayer(meshes: Mesh[], materials: StandardMaterial[]) {
  meshes.forEach(mesh => mesh.dispose());
  materials.forEach(material => material.dispose());
}

function disposeMergedLayer(meshes: Mesh[], materials: StandardMaterial[]) {
  meshes.forEach(mesh => mesh.dispose());
  materials.forEach(material => material.dispose());
}

function topDownFloorHasStripe(cell: Cell) {
  return (cell.x * 3 + cell.z * 5) % 7 === 0;
}

function floorHasStripe(cell: Cell) {
  return (cell.x + cell.z) % 4 === 0;
}

function TopDownFloorTile({
  cell,
  arena,
  visualStyle
}: {
  cell: Cell;
  arena: ArenaState;
  visualStyle: VisualStyle;
  key?: string;
}) {
  const palette = topDownVisualPalette(arena, visualStyle);
  const stripe = topDownFloorHasStripe(cell);

  return (
    <>
      <box name={`topdown-floor-${cell.x}-${cell.z}`} position={cellPosition(cell.x, cell.z, -0.055)} options={{ width: 1, height: 0.08, depth: 1 }}>
        <standardMaterial
          name={`topdown-floor-material-${cell.x}-${cell.z}`}
          diffuseColor={Color3.FromHexString(palette.floor)}
          emissiveColor={Color3.FromHexString("#000000")}
          specularColor={Color3.FromHexString("#000000")}
        />
      </box>
      {stripe ? (
        <box
          name={`topdown-floor-accent-${cell.x}-${cell.z}`}
          position={cellPosition(cell.x, cell.z, -0.008)}
          options={{ width: 0.58, height: 0.012, depth: 0.05 }}
        >
          <standardMaterial
            name={`topdown-floor-accent-material-${cell.x}-${cell.z}`}
            diffuseColor={Color3.FromHexString(palette.floorAccent)}
            emissiveColor={Color3.FromHexString("#000000")}
            specularColor={Color3.FromHexString("#000000")}
            alpha={0.7}
          />
        </box>
      ) : null}
    </>
  );
}

function TopDownWallTile({
  cell,
  arena,
  visualStyle
}: {
  cell: Cell;
  arena: ArenaState;
  visualStyle: VisualStyle;
  key?: string;
}) {
  const palette = topDownVisualPalette(arena, visualStyle);

  return (
    <>
      <box name={`topdown-wall-outline-${cell.x}-${cell.z}`} position={cellPosition(cell.x, cell.z, 0.045)} options={{ width: 0.94, height: 0.08, depth: 0.94 }}>
        <standardMaterial name={`topdown-wall-outline-material-${cell.x}-${cell.z}`} diffuseColor={Color3.FromHexString(palette.outline)} emissiveColor={Color3.FromHexString("#000000")} />
      </box>
      <box name={`topdown-wall-${cell.x}-${cell.z}`} position={cellPosition(cell.x, cell.z, 0.09)} options={{ width: 0.84, height: 0.1, depth: 0.84 }}>
        <standardMaterial name={`topdown-wall-material-${cell.x}-${cell.z}`} diffuseColor={Color3.FromHexString(palette.wall)} emissiveColor={Color3.FromHexString("#000000")} />
      </box>
      <box name={`topdown-wall-highlight-top-${cell.x}-${cell.z}`} position={cellPosition(cell.x, cell.z - 0.33, 0.15)} options={{ width: 0.68, height: 0.018, depth: 0.08 }}>
        <standardMaterial name={`topdown-wall-highlight-top-material-${cell.x}-${cell.z}`} diffuseColor={Color3.FromHexString(palette.wallLight)} emissiveColor={Color3.FromHexString("#000000")} />
      </box>
      <box name={`topdown-wall-highlight-left-${cell.x}-${cell.z}`} position={cellPosition(cell.x - 0.33, cell.z, 0.15)} options={{ width: 0.08, height: 0.018, depth: 0.68 }}>
        <standardMaterial name={`topdown-wall-highlight-left-material-${cell.x}-${cell.z}`} diffuseColor={Color3.FromHexString(palette.wallLight)} emissiveColor={Color3.FromHexString("#000000")} />
      </box>
      <box name={`topdown-wall-shadow-bottom-${cell.x}-${cell.z}`} position={cellPosition(cell.x, cell.z + 0.34, 0.15)} options={{ width: 0.72, height: 0.018, depth: 0.08 }}>
        <standardMaterial name={`topdown-wall-shadow-bottom-material-${cell.x}-${cell.z}`} diffuseColor={Color3.FromHexString(palette.wallShadow)} emissiveColor={Color3.FromHexString("#000000")} />
      </box>
      <box name={`topdown-wall-shadow-right-${cell.x}-${cell.z}`} position={cellPosition(cell.x + 0.34, cell.z, 0.15)} options={{ width: 0.08, height: 0.018, depth: 0.72 }}>
        <standardMaterial name={`topdown-wall-shadow-right-material-${cell.x}-${cell.z}`} diffuseColor={Color3.FromHexString(palette.wallShadow)} emissiveColor={Color3.FromHexString("#000000")} />
      </box>
    </>
  );
}

function TopDownCrateTile({
  cell,
  arena,
  visualStyle
}: {
  cell: Cell;
  arena: ArenaState;
  visualStyle: VisualStyle;
  key?: string;
}) {
  const palette = topDownVisualPalette(arena, visualStyle);

  return (
    <>
      <box name={`topdown-crate-outline-${cell.x}-${cell.z}`} position={cellPosition(cell.x, cell.z, 0.045)} options={{ width: 0.94, height: 0.08, depth: 0.94 }}>
        <standardMaterial name={`topdown-crate-outline-material-${cell.x}-${cell.z}`} diffuseColor={Color3.FromHexString(palette.outline)} emissiveColor={Color3.FromHexString("#000000")} />
      </box>
      <box name={`topdown-crate-${cell.x}-${cell.z}`} position={cellPosition(cell.x, cell.z, 0.09)} options={{ width: 0.84, height: 0.1, depth: 0.84 }}>
        <standardMaterial name={`topdown-crate-material-${cell.x}-${cell.z}`} diffuseColor={Color3.FromHexString(palette.crate)} emissiveColor={Color3.FromHexString("#000000")} />
      </box>
      <box name={`topdown-crate-line-a-${cell.x}-${cell.z}`} position={cellPosition(cell.x, cell.z - 0.21, 0.15)} options={{ width: 0.72, height: 0.018, depth: 0.07 }}>
        <standardMaterial name={`topdown-crate-line-a-material-${cell.x}-${cell.z}`} diffuseColor={Color3.FromHexString(palette.crateLight)} emissiveColor={Color3.FromHexString("#000000")} />
      </box>
      <box name={`topdown-crate-line-b-${cell.x}-${cell.z}`} position={cellPosition(cell.x, cell.z + 0.05, 0.15)} options={{ width: 0.72, height: 0.018, depth: 0.07 }}>
        <standardMaterial name={`topdown-crate-line-b-material-${cell.x}-${cell.z}`} diffuseColor={Color3.FromHexString(palette.crateDark)} emissiveColor={Color3.FromHexString("#000000")} />
      </box>
      <box name={`topdown-crate-line-c-${cell.x}-${cell.z}`} position={cellPosition(cell.x, cell.z + 0.29, 0.15)} options={{ width: 0.72, height: 0.018, depth: 0.07 }}>
        <standardMaterial name={`topdown-crate-line-c-material-${cell.x}-${cell.z}`} diffuseColor={Color3.FromHexString(palette.crateLight)} emissiveColor={Color3.FromHexString("#000000")} />
      </box>
      <box name={`topdown-crate-seam-a-${cell.x}-${cell.z}`} position={cellPosition(cell.x - 0.18, cell.z - 0.08, 0.16)} options={{ width: 0.07, height: 0.018, depth: 0.24 }}>
        <standardMaterial name={`topdown-crate-seam-a-material-${cell.x}-${cell.z}`} diffuseColor={Color3.FromHexString(palette.crateDark)} emissiveColor={Color3.FromHexString("#000000")} />
      </box>
      <box name={`topdown-crate-seam-b-${cell.x}-${cell.z}`} position={cellPosition(cell.x + 0.2, cell.z + 0.17, 0.16)} options={{ width: 0.07, height: 0.018, depth: 0.24 }}>
        <standardMaterial name={`topdown-crate-seam-b-material-${cell.x}-${cell.z}`} diffuseColor={Color3.FromHexString(palette.crateDark)} emissiveColor={Color3.FromHexString("#000000")} />
      </box>
    </>
  );
}

function TopDownBombSprite({
  bomb,
  arena,
  visualStyle
}: {
  bomb: ActiveBomb;
  arena: ArenaState;
  visualStyle: VisualStyle;
  key?: string;
}) {
  const scene = useScene();
  const palette = topDownVisualPalette(arena, visualStyle);

  useTimedMeshAnimation(scene, `topdown-bomb-warning-${bomb.id}`, Math.max(1, bomb.explodeAt - performance.now()), progress => {
    const urgency = bombWarningUrgency(progress);
    const pulseWave = bombWarningPulse(progress);
    const pulse = 0.8 + pulseWave * (0.1 + urgency * 0.08);
    const warning = scene.getMeshByName(`topdown-bomb-warning-${bomb.id}`);
    const dangerCore = scene.getMeshByName(`topdown-bomb-danger-core-${bomb.id}`);
    const body = scene.getMeshByName(`topdown-bomb-${bomb.id}`);
    const spark = scene.getMeshByName(`topdown-bomb-spark-${bomb.id}`);
    if (warning) {
      warning.scaling.x = 0.84 + progress * 0.28 + urgency * 0.3;
      warning.scaling.z = 0.84 + progress * 0.28 + urgency * 0.3;
      const warningMaterial = warning.material;
      if (warningMaterial && "alpha" in warningMaterial) {
        warningMaterial.alpha = 0.16 + progress * 0.22 + urgency * (0.24 + Math.max(0, pulseWave) * 0.18);
      }
    }
    if (dangerCore) {
      const dangerScale = 0.24 + urgency * (0.48 + Math.max(0, pulseWave) * 0.18);
      dangerCore.scaling.x = dangerScale;
      dangerCore.scaling.z = dangerScale;
      const dangerMaterial = dangerCore.material;
      if (dangerMaterial && "alpha" in dangerMaterial) {
        dangerMaterial.alpha = urgency * (0.16 + Math.max(0, pulseWave) * 0.42);
      }
    }
    if (body) {
      body.scaling.x = pulse;
      body.scaling.z = pulse;
    }
    if (spark) {
      const sparkPulse = 0.7 + Math.sin(progress * Math.PI * 12) * 0.24;
      spark.scaling.x = sparkPulse;
      spark.scaling.z = sparkPulse;
    }
  });

  return (
    <>
      <torus
        name={`topdown-bomb-warning-${bomb.id}`}
        position={cellPosition(bomb.cell.x, bomb.cell.z, 0.16)}
        rotationX={Tools.ToRadians(90)}
        options={{ diameter: 0.86, thickness: 0.06, tessellation: 40 }}
      >
        <standardMaterial name={`topdown-bomb-warning-material-${bomb.id}`} diffuseColor={Color3.FromHexString("#FDE047")} emissiveColor={Color3.FromHexString("#F97316")} alpha={0.16} />
      </torus>
      <cylinder
        name={`topdown-bomb-danger-core-${bomb.id}`}
        position={cellPosition(bomb.cell.x, bomb.cell.z, 0.17)}
        options={{ height: 0.025, diameter: 0.92, tessellation: 32 }}
      >
        <standardMaterial
          name={`topdown-bomb-danger-core-material-${bomb.id}`}
          diffuseColor={Color3.FromHexString("#FB7185")}
          emissiveColor={Color3.FromHexString("#F97316")}
          alpha={0}
        />
      </cylinder>
      <cylinder name={`topdown-bomb-outline-${bomb.id}`} position={cellPosition(bomb.cell.x, bomb.cell.z, 0.19)} options={{ height: 0.05, diameter: 0.76, tessellation: 40 }}>
        <standardMaterial name={`topdown-bomb-outline-material-${bomb.id}`} diffuseColor={Color3.FromHexString(palette.outline)} emissiveColor={Color3.FromHexString("#000000")} />
      </cylinder>
      <cylinder name={`topdown-bomb-${bomb.id}`} position={cellPosition(bomb.cell.x, bomb.cell.z, 0.22)} options={{ height: 0.05, diameter: 0.62, tessellation: 40 }}>
        <standardMaterial name={`topdown-bomb-material-${bomb.id}`} diffuseColor={Color3.FromHexString(palette.bomb)} emissiveColor={Color3.FromHexString("#000000")} />
      </cylinder>
      <cylinder name={`topdown-bomb-shine-${bomb.id}`} position={cellPosition(bomb.cell.x - 0.14, bomb.cell.z - 0.15, 0.25)} options={{ height: 0.025, diameter: 0.16, tessellation: 24 }}>
        <standardMaterial name={`topdown-bomb-shine-material-${bomb.id}`} diffuseColor={Color3.FromHexString("#F8FAFC")} emissiveColor={Color3.FromHexString("#000000")} />
      </cylinder>
      <box name={`topdown-bomb-fuse-${bomb.id}`} position={cellPosition(bomb.cell.x + 0.2, bomb.cell.z - 0.24, 0.25)} rotationY={Tools.ToRadians(45)} options={{ width: 0.08, height: 0.025, depth: 0.34 }}>
        <standardMaterial name={`topdown-bomb-fuse-material-${bomb.id}`} diffuseColor={Color3.FromHexString(palette.fuse)} emissiveColor={Color3.FromHexString("#000000")} />
      </box>
      <cylinder name={`topdown-bomb-spark-${bomb.id}`} position={cellPosition(bomb.cell.x + 0.32, bomb.cell.z - 0.36, 0.27)} options={{ height: 0.025, diameter: 0.16, tessellation: 12 }}>
        <standardMaterial name={`topdown-bomb-spark-material-${bomb.id}`} diffuseColor={Color3.FromHexString("#FDE047")} emissiveColor={Color3.FromHexString("#F59E0B")} />
      </cylinder>
    </>
  );
}

function TopDownPlayerSprite({
  visualPositionRef,
  visualStyle
}: {
  visualPositionRef: { current: Vector3 };
  visualStyle: VisualStyle;
}) {
  const scene = useScene();
  const palette = topDownVisualPalette(null, visualStyle);
  const position = visualPositionRef.current;

  useEffect(() => {
    const observer = scene.onBeforeRenderObservable.add(() => {
      const anchor = visualPositionRef.current;
      for (const part of topDownPlayerParts) {
        positionPlayerDetail(scene, part.name, new Vector3(anchor.x + part.x, part.y, anchor.z + part.z));
      }
    });

    return () => {
      scene.onBeforeRenderObservable.remove(observer);
    };
  }, [scene, visualPositionRef]);

  return (
    <>
      <cylinder name="topdown-player-shadow" position={new Vector3(position.x, 0.17, position.z + 0.27)} options={{ height: 0.025, diameter: 0.64, tessellation: 32 }}>
        <standardMaterial name="topdown-player-shadow-material" diffuseColor={Color3.FromHexString("#020617")} emissiveColor={Color3.FromHexString("#000000")} alpha={0.34} />
      </cylinder>
      <cylinder name="topdown-player-boot-left" position={new Vector3(position.x - 0.22, 0.25, position.z + 0.34)} options={{ height: 0.05, diameter: 0.28, tessellation: 24 }}>
        <standardMaterial name="topdown-player-boot-left-material" diffuseColor={Color3.FromHexString(palette.playerBoot)} emissiveColor={Color3.FromHexString("#000000")} />
      </cylinder>
      <cylinder name="topdown-player-boot-right" position={new Vector3(position.x + 0.22, 0.25, position.z + 0.34)} options={{ height: 0.05, diameter: 0.28, tessellation: 24 }}>
        <standardMaterial name="topdown-player-boot-right-material" diffuseColor={Color3.FromHexString(palette.playerBoot)} emissiveColor={Color3.FromHexString("#000000")} />
      </cylinder>
      <box name="topdown-player-leg-left" position={new Vector3(position.x - 0.16, 0.27, position.z + 0.21)} options={{ width: 0.18, height: 0.05, depth: 0.28 }}>
        <standardMaterial name="topdown-player-leg-left-material" diffuseColor={Color3.FromHexString(palette.playerSuit)} emissiveColor={Color3.FromHexString("#000000")} />
      </box>
      <box name="topdown-player-leg-right" position={new Vector3(position.x + 0.16, 0.27, position.z + 0.21)} options={{ width: 0.18, height: 0.05, depth: 0.28 }}>
        <standardMaterial name="topdown-player-leg-right-material" diffuseColor={Color3.FromHexString(palette.playerSuit)} emissiveColor={Color3.FromHexString("#000000")} />
      </box>
      <box name="topdown-player-body-outline" position={new Vector3(position.x, 0.28, position.z + 0.02)} options={{ width: 0.54, height: 0.055, depth: 0.48 }}>
        <standardMaterial name="topdown-player-body-outline-material" diffuseColor={Color3.FromHexString(palette.outline)} emissiveColor={Color3.FromHexString("#000000")} />
      </box>
      <box name="topdown-player-body" position={new Vector3(position.x, 0.31, position.z + 0.02)} options={{ width: 0.48, height: 0.055, depth: 0.42 }}>
        <standardMaterial name="topdown-player-body-material" diffuseColor={Color3.FromHexString(palette.playerSuit)} emissiveColor={Color3.FromHexString("#000000")} />
      </box>
      <box name="topdown-player-belt" position={new Vector3(position.x, 0.34, position.z + 0.1)} options={{ width: 0.44, height: 0.03, depth: 0.11 }}>
        <standardMaterial name="topdown-player-belt-material" diffuseColor={Color3.FromHexString(palette.playerTrim)} emissiveColor={Color3.FromHexString("#000000")} />
      </box>
      <cylinder name="topdown-player-glove-left" position={new Vector3(position.x - 0.37, 0.33, position.z - 0.02)} options={{ height: 0.05, diameter: 0.28, tessellation: 24 }}>
        <standardMaterial name="topdown-player-glove-left-material" diffuseColor={Color3.FromHexString(palette.playerGlove)} emissiveColor={Color3.FromHexString("#000000")} />
      </cylinder>
      <cylinder name="topdown-player-glove-right" position={new Vector3(position.x + 0.37, 0.33, position.z - 0.02)} options={{ height: 0.05, diameter: 0.28, tessellation: 24 }}>
        <standardMaterial name="topdown-player-glove-right-material" diffuseColor={Color3.FromHexString(palette.playerGlove)} emissiveColor={Color3.FromHexString("#000000")} />
      </cylinder>
      <cylinder name="topdown-player-helmet-outline" position={new Vector3(position.x, 0.36, position.z - 0.22)} options={{ height: 0.055, diameter: 0.72, tessellation: 40 }}>
        <standardMaterial name="topdown-player-helmet-outline-material" diffuseColor={Color3.FromHexString(palette.outline)} emissiveColor={Color3.FromHexString("#000000")} />
      </cylinder>
      <cylinder name="topdown-player-helmet" position={new Vector3(position.x, 0.39, position.z - 0.22)} options={{ height: 0.055, diameter: 0.62, tessellation: 40 }}>
        <standardMaterial name="topdown-player-helmet-material" diffuseColor={Color3.FromHexString(palette.playerSuit)} emissiveColor={Color3.FromHexString("#000000")} />
      </cylinder>
      <box name="topdown-player-face" position={new Vector3(position.x, 0.42, position.z - 0.2)} options={{ width: 0.38, height: 0.03, depth: 0.24 }}>
        <standardMaterial name="topdown-player-face-material" diffuseColor={Color3.FromHexString(palette.playerFace)} emissiveColor={Color3.FromHexString("#000000")} />
      </box>
      <box name="topdown-player-eye-left" position={new Vector3(position.x - 0.11, 0.45, position.z - 0.22)} options={{ width: 0.045, height: 0.03, depth: 0.12 }}>
        <standardMaterial name="topdown-player-eye-left-material" diffuseColor={Color3.FromHexString(palette.ink)} emissiveColor={Color3.FromHexString("#000000")} />
      </box>
      <box name="topdown-player-eye-right" position={new Vector3(position.x + 0.11, 0.45, position.z - 0.22)} options={{ width: 0.045, height: 0.03, depth: 0.12 }}>
        <standardMaterial name="topdown-player-eye-right-material" diffuseColor={Color3.FromHexString(palette.ink)} emissiveColor={Color3.FromHexString("#000000")} />
      </box>
      <box name="topdown-player-antenna" position={new Vector3(position.x + 0.18, 0.43, position.z - 0.56)} rotationY={Tools.ToRadians(45)} options={{ width: 0.05, height: 0.03, depth: 0.24 }}>
        <standardMaterial name="topdown-player-antenna-material" diffuseColor={Color3.FromHexString(palette.outline)} emissiveColor={Color3.FromHexString("#000000")} />
      </box>
      <cylinder name="topdown-player-antenna-tip" position={new Vector3(position.x + 0.27, 0.46, position.z - 0.66)} options={{ height: 0.03, diameter: 0.13, tessellation: 18 }}>
        <standardMaterial name="topdown-player-antenna-tip-material" diffuseColor={Color3.FromHexString(palette.playerGlove)} emissiveColor={Color3.FromHexString("#000000")} />
      </cylinder>
    </>
  );
}

const topDownPlayerParts = [
  { name: "topdown-player-shadow", x: 0, y: 0.17, z: 0.27 },
  { name: "topdown-player-boot-left", x: -0.22, y: 0.25, z: 0.34 },
  { name: "topdown-player-boot-right", x: 0.22, y: 0.25, z: 0.34 },
  { name: "topdown-player-leg-left", x: -0.16, y: 0.27, z: 0.21 },
  { name: "topdown-player-leg-right", x: 0.16, y: 0.27, z: 0.21 },
  { name: "topdown-player-body-outline", x: 0, y: 0.28, z: 0.02 },
  { name: "topdown-player-body", x: 0, y: 0.31, z: 0.02 },
  { name: "topdown-player-belt", x: 0, y: 0.34, z: 0.1 },
  { name: "topdown-player-glove-left", x: -0.37, y: 0.33, z: -0.02 },
  { name: "topdown-player-glove-right", x: 0.37, y: 0.33, z: -0.02 },
  { name: "topdown-player-helmet-outline", x: 0, y: 0.36, z: -0.22 },
  { name: "topdown-player-helmet", x: 0, y: 0.39, z: -0.22 },
  { name: "topdown-player-face", x: 0, y: 0.42, z: -0.2 },
  { name: "topdown-player-eye-left", x: -0.11, y: 0.45, z: -0.22 },
  { name: "topdown-player-eye-right", x: 0.11, y: 0.45, z: -0.22 },
  { name: "topdown-player-antenna", x: 0.18, y: 0.43, z: -0.56 },
  { name: "topdown-player-antenna-tip", x: 0.27, y: 0.46, z: -0.66 }
] as const;

function useSmoothEnemyPosition(enemy: ActiveEnemy, y: number) {
  const scene = useScene();
  const [position, setPosition] = useState(() => enemyInterpolatedPosition(enemy, y));
  const currentPositionRef = useRef(position.clone());

  useEffect(() => {
    const updatePosition = () => {
      const nextPosition = enemyInterpolatedPosition(enemy, y);
      if (Vector3.DistanceSquared(currentPositionRef.current, nextPosition) < 0.000001) {
        return;
      }

      currentPositionRef.current.copyFrom(nextPosition);
      setPosition(nextPosition);
    };

    updatePosition();
    const observer = scene.onBeforeRenderObservable.add(updatePosition);

    return () => {
      scene.onBeforeRenderObservable.remove(observer);
    };
  }, [
    enemy.cell.x,
    enemy.cell.z,
    enemy.visualFromCell.x,
    enemy.visualFromCell.z,
    enemy.visualMoveDurationMs,
    enemy.visualMoveStartedAt,
    scene,
    y
  ]);

  return position;
}

function enemyInterpolatedPosition(enemy: ActiveEnemy, y: number, now = performance.now()) {
  const targetPosition = cellPosition(enemy.cell.x, enemy.cell.z, y);
  if (enemy.visualMoveDurationMs <= 0) {
    return targetPosition;
  }

  const fromPosition = cellPosition(enemy.visualFromCell.x, enemy.visualFromCell.z, y);
  const progress = Math.min(1, Math.max(0, (now - enemy.visualMoveStartedAt) / enemy.visualMoveDurationMs));
  const easedProgress = progress * progress * (3 - 2 * progress);
  return Vector3.Lerp(fromPosition, targetPosition, easedProgress);
}

function enemyCollisionCell(enemy: ActiveEnemy, now = performance.now()) {
  return nearestCellFromPosition(enemyInterpolatedPosition(enemy, 0.42, now));
}

function isEnemyInActiveBlast(enemy: ActiveEnemy, blasts: ActiveBlast[], now = performance.now()) {
  return isCellInActiveBlast(enemyCollisionCell(enemy, now), blasts);
}

function enemyVisualPosition(anchor: Vector3, offsetX: number, offsetZ: number, y: number) {
  return new Vector3(anchor.x + offsetX, y, anchor.z + offsetZ);
}

function TopDownEnemySprite({
  enemy,
  visualStyle
}: {
  enemy: ActiveEnemy;
  visualStyle: VisualStyle;
  key?: string;
}) {
  const palette = topDownVisualPalette(null, visualStyle);
  const position = useSmoothEnemyPosition(enemy, 0.28);

  if (enemy.type === "chaser") {
    return (
      <>
        <box name={`topdown-enemy-outline-${enemy.id}`} position={enemyVisualPosition(position, 0, 0, 0.22)} rotationY={Tools.ToRadians(45)} options={{ width: 0.74, height: 0.05, depth: 0.74 }}>
          <standardMaterial name={`topdown-enemy-outline-material-${enemy.id}`} diffuseColor={Color3.FromHexString(palette.outline)} emissiveColor={Color3.FromHexString("#000000")} />
        </box>
        <box name={`topdown-enemy-${enemy.id}`} position={position} rotationY={Tools.ToRadians(45)} options={{ width: 0.62, height: 0.06, depth: 0.62 }}>
          <standardMaterial name={`topdown-enemy-material-${enemy.id}`} diffuseColor={Color3.FromHexString(palette.chaser)} emissiveColor={Color3.FromHexString("#000000")} />
        </box>
        <box name={`topdown-enemy-eye-left-${enemy.id}`} position={enemyVisualPosition(position, -0.13, -0.12, 0.33)} options={{ width: 0.08, height: 0.03, depth: 0.13 }}>
          <standardMaterial name={`topdown-enemy-eye-left-material-${enemy.id}`} diffuseColor={Color3.FromHexString("#F8FAFC")} emissiveColor={Color3.FromHexString("#000000")} />
        </box>
        <box name={`topdown-enemy-eye-right-${enemy.id}`} position={enemyVisualPosition(position, 0.13, -0.12, 0.33)} options={{ width: 0.08, height: 0.03, depth: 0.13 }}>
          <standardMaterial name={`topdown-enemy-eye-right-material-${enemy.id}`} diffuseColor={Color3.FromHexString("#F8FAFC")} emissiveColor={Color3.FromHexString("#000000")} />
        </box>
        <box name={`topdown-enemy-brow-${enemy.id}`} position={enemyVisualPosition(position, 0, -0.22, 0.35)} options={{ width: 0.34, height: 0.03, depth: 0.05 }}>
          <standardMaterial name={`topdown-enemy-brow-material-${enemy.id}`} diffuseColor={Color3.FromHexString(palette.ink)} emissiveColor={Color3.FromHexString("#000000")} />
        </box>
      </>
    );
  }

  if (enemy.type === "ghost") {
    return (
      <>
        <cylinder name={`topdown-enemy-outline-${enemy.id}`} position={enemyVisualPosition(position, 0, -0.08, 0.22)} options={{ height: 0.05, diameter: 0.72, tessellation: 36 }}>
          <standardMaterial name={`topdown-enemy-outline-material-${enemy.id}`} diffuseColor={Color3.FromHexString(palette.outline)} emissiveColor={Color3.FromHexString("#000000")} />
        </cylinder>
        <box name={`topdown-enemy-ghost-skirt-${enemy.id}`} position={enemyVisualPosition(position, 0, 0.17, 0.24)} options={{ width: 0.62, height: 0.05, depth: 0.32 }}>
          <standardMaterial name={`topdown-enemy-ghost-skirt-material-${enemy.id}`} diffuseColor={Color3.FromHexString(palette.ghost)} emissiveColor={Color3.FromHexString("#000000")} />
        </box>
        <cylinder name={`topdown-enemy-${enemy.id}`} position={enemyVisualPosition(position, 0, -0.08, 0.28)} options={{ height: 0.06, diameter: 0.62, tessellation: 36 }}>
          <standardMaterial name={`topdown-enemy-material-${enemy.id}`} diffuseColor={Color3.FromHexString(palette.ghost)} emissiveColor={Color3.FromHexString("#000000")} />
        </cylinder>
        {[-0.21, 0, 0.21].map((offset, index) => (
          <cylinder key={`${enemy.id}-ghost-foot-${index}`} name={`topdown-enemy-ghost-foot-${index}-${enemy.id}`} position={enemyVisualPosition(position, offset, 0.31, 0.3)} options={{ height: 0.05, diameter: 0.22, tessellation: 20 }}>
            <standardMaterial name={`topdown-enemy-ghost-foot-${index}-material-${enemy.id}`} diffuseColor={Color3.FromHexString(palette.ghost)} emissiveColor={Color3.FromHexString("#000000")} />
          </cylinder>
        ))}
        <cylinder name={`topdown-enemy-eye-left-${enemy.id}`} position={enemyVisualPosition(position, -0.13, -0.12, 0.34)} options={{ height: 0.03, diameter: 0.12, tessellation: 20 }}>
          <standardMaterial name={`topdown-enemy-eye-left-material-${enemy.id}`} diffuseColor={Color3.FromHexString("#F8FAFC")} emissiveColor={Color3.FromHexString("#000000")} />
        </cylinder>
        <cylinder name={`topdown-enemy-eye-right-${enemy.id}`} position={enemyVisualPosition(position, 0.13, -0.12, 0.34)} options={{ height: 0.03, diameter: 0.12, tessellation: 20 }}>
          <standardMaterial name={`topdown-enemy-eye-right-material-${enemy.id}`} diffuseColor={Color3.FromHexString("#F8FAFC")} emissiveColor={Color3.FromHexString("#000000")} />
        </cylinder>
      </>
    );
  }

  return (
    <>
      <cylinder name={`topdown-enemy-outline-${enemy.id}`} position={enemyVisualPosition(position, 0, 0, 0.22)} options={{ height: 0.05, diameter: 0.78, tessellation: 36 }}>
        <standardMaterial name={`topdown-enemy-outline-material-${enemy.id}`} diffuseColor={Color3.FromHexString(palette.outline)} emissiveColor={Color3.FromHexString("#000000")} />
      </cylinder>
      <cylinder name={`topdown-enemy-${enemy.id}`} position={position} options={{ height: 0.06, diameter: 0.66, tessellation: 36 }}>
        <standardMaterial name={`topdown-enemy-material-${enemy.id}`} diffuseColor={Color3.FromHexString(palette.wanderer)} emissiveColor={Color3.FromHexString("#000000")} />
      </cylinder>
      <cylinder name={`topdown-enemy-eye-left-${enemy.id}`} position={enemyVisualPosition(position, -0.13, -0.12, 0.34)} options={{ height: 0.03, diameter: 0.12, tessellation: 20 }}>
        <standardMaterial name={`topdown-enemy-eye-left-material-${enemy.id}`} diffuseColor={Color3.FromHexString("#F8FAFC")} emissiveColor={Color3.FromHexString("#000000")} />
      </cylinder>
      <cylinder name={`topdown-enemy-eye-right-${enemy.id}`} position={enemyVisualPosition(position, 0.13, -0.12, 0.34)} options={{ height: 0.03, diameter: 0.12, tessellation: 20 }}>
        <standardMaterial name={`topdown-enemy-eye-right-material-${enemy.id}`} diffuseColor={Color3.FromHexString("#F8FAFC")} emissiveColor={Color3.FromHexString("#000000")} />
      </cylinder>
      <box name={`topdown-enemy-mouth-${enemy.id}`} position={enemyVisualPosition(position, 0, 0.12, 0.34)} options={{ width: 0.22, height: 0.03, depth: 0.05 }}>
        <standardMaterial name={`topdown-enemy-mouth-material-${enemy.id}`} diffuseColor={Color3.FromHexString(palette.ink)} emissiveColor={Color3.FromHexString("#000000")} />
      </box>
    </>
  );
}

function TopDownPowerUpSprite({
  powerUp,
  visualStyle
}: {
  powerUp: ActivePowerUp;
  visualStyle: VisualStyle;
  key?: string;
}) {
  const palette = topDownVisualPalette(null, visualStyle);
  const look = powerUpLook(powerUp.type);

  return (
    <>
      <box name={`topdown-powerup-outline-${powerUp.type}-${powerUp.cell.x}-${powerUp.cell.z}`} position={cellPosition(powerUp.cell.x, powerUp.cell.z, 0.2)} options={{ width: 0.76, height: 0.05, depth: 0.76 }}>
        <standardMaterial name={`topdown-powerup-outline-material-${powerUp.type}-${powerUp.cell.x}-${powerUp.cell.z}`} diffuseColor={Color3.FromHexString(palette.outline)} emissiveColor={Color3.FromHexString("#000000")} />
      </box>
      <box name={`topdown-powerup-panel-${powerUp.type}-${powerUp.cell.x}-${powerUp.cell.z}`} position={cellPosition(powerUp.cell.x, powerUp.cell.z, 0.24)} options={{ width: 0.66, height: 0.05, depth: 0.66 }}>
        <standardMaterial name={`topdown-powerup-panel-material-${powerUp.type}-${powerUp.cell.x}-${powerUp.cell.z}`} diffuseColor={Color3.FromHexString(look.color)} emissiveColor={Color3.FromHexString("#000000")} />
      </box>
      <TopDownPowerUpGlyph powerUp={powerUp} ink={palette.panel} />
    </>
  );
}

function TopDownPowerUpGlyph({ powerUp, ink }: { powerUp: ActivePowerUp; ink: string }) {
  const x = powerUp.cell.x;
  const z = powerUp.cell.z;
  const material = (
    <standardMaterial
      name={`topdown-powerup-glyph-material-${powerUp.type}-${x}-${z}`}
      diffuseColor={Color3.FromHexString(ink)}
      emissiveColor={Color3.FromHexString("#000000")}
    />
  );

  switch (powerUp.type) {
    case "bomb_capacity":
      return (
        <>
          <cylinder name={`topdown-powerup-bomb-${x}-${z}`} position={cellPosition(x, z + 0.03, 0.29)} options={{ height: 0.03, diameter: 0.28, tessellation: 28 }}>
            {material}
          </cylinder>
          <box name={`topdown-powerup-bomb-fuse-${x}-${z}`} position={cellPosition(x + 0.14, z - 0.17, 0.3)} rotationY={Tools.ToRadians(45)} options={{ width: 0.05, height: 0.03, depth: 0.22 }}>
            {material}
          </box>
        </>
      );
    case "blast_radius":
      return (
        <>
          <box name={`topdown-powerup-radius-x-${x}-${z}`} position={cellPosition(x, z, 0.29)} options={{ width: 0.42, height: 0.03, depth: 0.08 }}>
            {material}
          </box>
          <box name={`topdown-powerup-radius-z-${x}-${z}`} position={cellPosition(x, z, 0.29)} options={{ width: 0.08, height: 0.03, depth: 0.42 }}>
            {material}
          </box>
        </>
      );
    case "speed_up":
      return (
        <>
          <box name={`topdown-powerup-speed-tail-${x}-${z}`} position={cellPosition(x - 0.12, z, 0.29)} rotationY={Tools.ToRadians(45)} options={{ width: 0.2, height: 0.03, depth: 0.2 }}>
            {material}
          </box>
          <box name={`topdown-powerup-speed-head-${x}-${z}`} position={cellPosition(x + 0.12, z, 0.29)} rotationY={Tools.ToRadians(45)} options={{ width: 0.28, height: 0.03, depth: 0.28 }}>
            {material}
          </box>
        </>
      );
    case "bomb_kick":
      return (
        <>
          <box name={`topdown-powerup-kick-shaft-${x}-${z}`} position={cellPosition(x - 0.03, z, 0.29)} options={{ width: 0.36, height: 0.03, depth: 0.1 }}>
            {material}
          </box>
          <box name={`topdown-powerup-kick-foot-${x}-${z}`} position={cellPosition(x + 0.18, z + 0.12, 0.29)} options={{ width: 0.12, height: 0.03, depth: 0.22 }}>
            {material}
          </box>
        </>
      );
    case "throw_bomb":
      return (
        <>
          <box name={`topdown-powerup-throw-stem-${x}-${z}`} position={cellPosition(x, z + 0.06, 0.29)} options={{ width: 0.08, height: 0.03, depth: 0.34 }}>
            {material}
          </box>
          <box name={`topdown-powerup-throw-arm-${x}-${z}`} position={cellPosition(x + 0.12, z - 0.1, 0.29)} rotationY={Tools.ToRadians(-45)} options={{ width: 0.08, height: 0.03, depth: 0.24 }}>
            {material}
          </box>
        </>
      );
  }
}

function BombToken({
  bomb,
  material,
  visualStyle
}: {
  bomb: ActiveBomb;
  material: MaterialLook;
  visualStyle: VisualStyle;
  key?: string;
}) {
  const scene = useScene();

  useTimedMeshAnimation(scene, `bomb-warning-${bomb.id}`, Math.max(1, bomb.explodeAt - performance.now()), progress => {
    const urgency = bombWarningUrgency(progress);
    const pulseWave = bombWarningPulse(progress);
    const pulse = 0.72 + pulseWave * (0.12 + urgency * 0.1);
    const warning = scene.getMeshByName(`bomb-warning-${bomb.id}`);
    const dangerCore = scene.getMeshByName(`bomb-danger-core-${bomb.id}`);
    const body = scene.getMeshByName(`bomb-${bomb.id}`);
    if (warning) {
      warning.scaling.x = 0.82 + progress * 0.28 + urgency * 0.32;
      warning.scaling.z = 0.82 + progress * 0.28 + urgency * 0.32;
      const warningMaterial = warning.material;
      if (warningMaterial && "alpha" in warningMaterial) {
        warningMaterial.alpha = 0.18 + progress * 0.2 + urgency * (0.24 + Math.max(0, pulseWave) * 0.18);
      }
    }
    if (dangerCore) {
      const dangerScale = 0.24 + urgency * (0.5 + Math.max(0, pulseWave) * 0.2);
      dangerCore.scaling.x = dangerScale;
      dangerCore.scaling.z = dangerScale;
      const dangerMaterial = dangerCore.material;
      if (dangerMaterial && "alpha" in dangerMaterial) {
        dangerMaterial.alpha = urgency * (0.16 + Math.max(0, pulseWave) * 0.42);
      }
    }
    if (body) {
      body.scaling.x = pulse;
      body.scaling.y = pulse;
      body.scaling.z = pulse;
    }
  });

  return (
    <>
      <torus
        name={`bomb-warning-${bomb.id}`}
        position={cellPosition(bomb.cell.x, bomb.cell.z, 0.12)}
        rotationX={Tools.ToRadians(90)}
        options={{ diameter: 0.84, thickness: 0.06, tessellation: 48 }}
      >
        <standardMaterial
          name={`bomb-warning-material-${bomb.id}`}
          diffuseColor={Color3.FromHexString("#FDE047")}
          emissiveColor={Color3.FromHexString("#FB7185")}
          alpha={0.18}
        />
      </torus>
      <cylinder
        name={`bomb-danger-core-${bomb.id}`}
        position={cellPosition(bomb.cell.x, bomb.cell.z, 0.13)}
        options={{ height: 0.03, diameter: 0.94, tessellation: 36 }}
      >
        <standardMaterial
          name={`bomb-danger-core-material-${bomb.id}`}
          diffuseColor={Color3.FromHexString("#FB7185")}
          emissiveColor={Color3.FromHexString("#F97316")}
          alpha={0}
        />
      </cylinder>
      <sphere
        name={`bomb-${bomb.id}`}
        position={cellPosition(bomb.cell.x, bomb.cell.z, 0.4)}
        options={{ diameter: 0.66, segments: 32 }}
      >
        <standardMaterial
          name={`bomb-material-${bomb.id}`}
          diffuseColor={Color3.FromHexString(material.diffuse)}
          emissiveColor={Color3.FromHexString(material.emissive)}
          specularColor={Color3.FromHexString(material.specular)}
        />
      </sphere>
      {visualStyle === "arcade_premium" ? (
        <cylinder
          name={`bomb-fuse-${bomb.id}`}
          position={cellPosition(bomb.cell.x, bomb.cell.z, 0.78)}
          options={{ height: 0.22, diameter: 0.08, tessellation: 12 }}
        >
          <standardMaterial
            name={`bomb-fuse-material-${bomb.id}`}
            diffuseColor={Color3.FromHexString("#FDE68A")}
            emissiveColor={Color3.FromHexString("#F97316")}
          />
        </cylinder>
      ) : null}
      {visualStyle === "toy_like" ? (
        <sphere
          name={`bomb-cap-${bomb.id}`}
          position={cellPosition(bomb.cell.x, bomb.cell.z, 0.73)}
          options={{ diameter: 0.18, segments: 16 }}
        >
          <standardMaterial
            name={`bomb-cap-material-${bomb.id}`}
            diffuseColor={Color3.FromHexString("#F8FAFC")}
            emissiveColor={Color3.FromHexString("#F8FAFC")}
          />
        </sphere>
      ) : null}
      {visualStyle === "neon_cinematic" ? (
        <torus
          name={`bomb-core-${bomb.id}`}
          position={cellPosition(bomb.cell.x, bomb.cell.z, 0.4)}
          rotationX={Tools.ToRadians(90)}
          options={{ diameter: 0.54, thickness: 0.05, tessellation: 48 }}
        >
          <standardMaterial
            name={`bomb-core-material-${bomb.id}`}
            diffuseColor={Color3.FromHexString("#67E8F9")}
            emissiveColor={Color3.FromHexString("#22D3EE")}
          />
        </torus>
      ) : null}
    </>
  );
}

function FloorTile({
  cell,
  material,
  visualStyle
}: {
  cell: Cell;
  material: MaterialLook;
  visualStyle: VisualStyle;
  key?: string;
}) {
  const stripe = floorHasStripe(cell);

  return (
    <>
      <box
        name={`floor-${cell.x}-${cell.z}`}
        position={cellPosition(cell.x, cell.z, -0.07)}
        options={{ width: 0.94, height: 0.14, depth: 0.94 }}
      >
        <standardMaterial
          name={`floor-material-${cell.x}-${cell.z}`}
          diffuseColor={Color3.FromHexString(material.diffuse)}
          emissiveColor={Color3.FromHexString(material.emissive)}
          specularColor={Color3.FromHexString(material.specular)}
          alpha={material.alpha ?? 1}
        />
      </box>
      {visualStyle === "arcade_premium" && stripe ? (
        <box name={`floor-inlay-${cell.x}-${cell.z}`} position={cellPosition(cell.x, cell.z, 0.012)} options={{ width: 0.58, height: 0.018, depth: 0.05 }}>
          <standardMaterial name={`floor-inlay-material-${cell.x}-${cell.z}`} diffuseColor={Color3.FromHexString("#CBD5E1")} emissiveColor={Color3.FromHexString("#000000")} />
        </box>
      ) : null}
      {visualStyle === "toy_like" && stripe ? (
        <cylinder name={`floor-dot-${cell.x}-${cell.z}`} position={cellPosition(cell.x, cell.z, 0.012)} options={{ height: 0.02, diameter: 0.16, tessellation: 24 }}>
          <standardMaterial name={`floor-dot-material-${cell.x}-${cell.z}`} diffuseColor={Color3.FromHexString("#FFFFFF")} emissiveColor={Color3.FromHexString("#000000")} alpha={0.48} />
        </cylinder>
      ) : null}
      {visualStyle === "neon_cinematic" && stripe ? (
        <box name={`floor-neon-${cell.x}-${cell.z}`} position={cellPosition(cell.x, cell.z, 0.014)} options={{ width: 0.72, height: 0.02, depth: 0.035 }}>
          <standardMaterial name={`floor-neon-material-${cell.x}-${cell.z}`} diffuseColor={Color3.FromHexString("#67E8F9")} emissiveColor={Color3.FromHexString("#22D3EE")} alpha={0.72} />
        </box>
      ) : null}
    </>
  );
}

function WallBlock({
  cell,
  material,
  visualStyle,
  arena
}: {
  cell: Cell;
  material: MaterialLook;
  visualStyle: VisualStyle;
  arena: ArenaState;
  key?: string;
}) {
  return (
    <>
      <box name={`wall-${cell.x}-${cell.z}`} position={cellPosition(cell.x, cell.z, 0.5)} options={{ width: 0.9, height: 1.1, depth: 0.9 }}>
        <standardMaterial
          name={`wall-material-${cell.x}-${cell.z}`}
          diffuseColor={Color3.FromHexString(material.diffuse)}
          emissiveColor={Color3.FromHexString(material.emissive)}
          specularColor={Color3.FromHexString(material.specular)}
          alpha={material.alpha ?? 1}
        />
      </box>
      {visualStyle === "arcade_premium" ? (
        <box name={`wall-cap-${cell.x}-${cell.z}`} position={cellPosition(cell.x, cell.z, 1.09)} options={{ width: 0.78, height: 0.08, depth: 0.78 }}>
          <standardMaterial name={`wall-cap-material-${cell.x}-${cell.z}`} diffuseColor={Color3.FromHexString("#E2E8F0")} emissiveColor={Color3.FromHexString("#000000")} />
        </box>
      ) : null}
      {visualStyle === "toy_like" ? (
        <sphere name={`wall-bump-${cell.x}-${cell.z}`} position={cellPosition(cell.x, cell.z, 1.08)} options={{ diameter: 0.34, segments: 20 }}>
          <standardMaterial name={`wall-bump-material-${cell.x}-${cell.z}`} diffuseColor={Color3.FromHexString("#FFFFFF")} emissiveColor={Color3.FromHexString("#000000")} alpha={0.42} />
        </sphere>
      ) : null}
      {visualStyle === "neon_cinematic" ? (
        <>
          <box name={`wall-strip-a-${cell.x}-${cell.z}`} position={cellPosition(cell.x, cell.z - 0.46, 0.52)} options={{ width: 0.54, height: 0.06, depth: 0.03 }}>
            <standardMaterial name={`wall-strip-a-material-${cell.x}-${cell.z}`} diffuseColor={Color3.FromHexString(arena.palette.accent)} emissiveColor={Color3.FromHexString(arena.palette.accent)} />
          </box>
          <box name={`wall-strip-b-${cell.x}-${cell.z}`} position={cellPosition(cell.x, cell.z + 0.46, 0.52)} options={{ width: 0.54, height: 0.06, depth: 0.03 }}>
            <standardMaterial name={`wall-strip-b-material-${cell.x}-${cell.z}`} diffuseColor={Color3.FromHexString(arena.palette.secondary)} emissiveColor={Color3.FromHexString(arena.palette.secondary)} />
          </box>
        </>
      ) : null}
    </>
  );
}

function CrateBlock({
  cell,
  material,
  variant,
  visualStyle,
  isTopDown
}: {
  cell: Cell;
  material: MaterialLook;
  variant: ReturnType<typeof crateVisualVariant>;
  visualStyle: VisualStyle;
  isTopDown: boolean;
  key?: string;
}) {
  const position = cellPosition(cell.x, cell.z, 0.34 + (isTopDown ? 0 : variant.heightOffset));

  return (
    <>
      <box
        name={`destructible-${cell.x}-${cell.z}`}
        position={position}
        rotationY={isTopDown ? 0 : variant.rotationY}
        options={{ width: visualStyle === "toy_like" ? 0.78 : 0.74, height: visualStyle === "toy_like" ? 0.76 : 0.72, depth: visualStyle === "toy_like" ? 0.78 : 0.74 }}
      >
        <standardMaterial
          name={`crate-material-${cell.x}-${cell.z}`}
          diffuseColor={Color3.FromHexString(material.diffuse)}
          emissiveColor={Color3.FromHexString(material.emissive)}
          specularColor={Color3.FromHexString(material.specular)}
          alpha={material.alpha ?? 1}
        />
      </box>
      {visualStyle === "arcade_premium" ? (
        <>
          <box name={`crate-band-x-${cell.x}-${cell.z}`} position={cellPosition(cell.x, cell.z, 0.36)} options={{ width: 0.8, height: 0.08, depth: 0.1 }}>
            <standardMaterial name={`crate-band-x-material-${cell.x}-${cell.z}`} diffuseColor={Color3.FromHexString("#FED7AA")} emissiveColor={Color3.FromHexString("#000000")} />
          </box>
          <box name={`crate-band-z-${cell.x}-${cell.z}`} position={cellPosition(cell.x, cell.z, 0.36)} options={{ width: 0.1, height: 0.08, depth: 0.8 }}>
            <standardMaterial name={`crate-band-z-material-${cell.x}-${cell.z}`} diffuseColor={Color3.FromHexString("#FED7AA")} emissiveColor={Color3.FromHexString("#000000")} />
          </box>
        </>
      ) : null}
      {visualStyle === "toy_like" ? (
        <sphere name={`crate-sticker-${cell.x}-${cell.z}`} position={cellPosition(cell.x, cell.z - 0.39, 0.42)} options={{ diameter: 0.18, segments: 18 }}>
          <standardMaterial name={`crate-sticker-material-${cell.x}-${cell.z}`} diffuseColor={Color3.FromHexString("#FFFFFF")} emissiveColor={Color3.FromHexString("#000000")} />
        </sphere>
      ) : null}
      {visualStyle === "neon_cinematic" ? (
        <box name={`crate-rune-${cell.x}-${cell.z}`} position={cellPosition(cell.x, cell.z - 0.39, 0.42)} options={{ width: 0.42, height: 0.06, depth: 0.03 }}>
          <standardMaterial name={`crate-rune-material-${cell.x}-${cell.z}`} diffuseColor={Color3.FromHexString("#F472B6")} emissiveColor={Color3.FromHexString("#F472B6")} />
        </box>
      ) : null}
    </>
  );
}

const ArenaCamera = memo(function ArenaCamera({
  viewMode,
  playerVisualPositionRef
}: {
  viewMode: ViewMode;
  playerVisualPositionRef: { current: Vector3 };
}) {
  const scene = useScene();
  const playerTarget = playerVisualPositionRef.current.add(new Vector3(0, 0.42, 0));

  useEffect(() => {
    const camera = scene.getCameraByName("arena-camera") as ArcRotateCamera | null;
    if (!camera || viewMode !== "three_d") {
      return;
    }

    const smoothedTarget = camera.target.clone();
    const observer = scene.onBeforeRenderObservable.add(() => {
      const desiredTarget = threeDPlayerBiasedTarget(camera, playerVisualPositionRef.current);
      Vector3.LerpToRef(smoothedTarget, desiredTarget, 0.12, smoothedTarget);
      camera.setTarget(smoothedTarget);
    });

    return () => {
      scene.onBeforeRenderObservable.remove(observer);
    };
  }, [playerVisualPositionRef, scene, viewMode]);

  useEffect(() => {
    const camera = scene.getCameraByName("arena-camera") as ArcRotateCamera | null;
    if (!camera || viewMode !== "fps") {
      return;
    }

    const smoothedTarget = camera.target.clone();
    const observer = scene.onBeforeRenderObservable.add(() => {
      const desiredTarget = playerVisualPositionRef.current.add(new Vector3(0, 0.42, 0));
      Vector3.LerpToRef(smoothedTarget, desiredTarget, 0.42, smoothedTarget);
      camera.setTarget(smoothedTarget);
    });

    return () => {
      scene.onBeforeRenderObservable.remove(observer);
    };
  }, [playerVisualPositionRef, scene, viewMode]);

  useEffect(() => {
    const camera = scene.getCameraByName("arena-camera") as ArcRotateCamera | null;
    if (!camera || viewMode !== "top_down") {
      return;
    }

    const smoothedTarget = camera.target.clone();
    const observer = scene.onBeforeRenderObservable.add(() => {
      const zoomProgress = topDownFollowProgress(camera);
      const desiredTarget = Vector3.Lerp(
        Vector3.Zero(),
        playerVisualPositionRef.current.add(new Vector3(0, 0.24, 0)),
        zoomProgress
      );
      Vector3.LerpToRef(smoothedTarget, desiredTarget, 0.14, smoothedTarget);
      camera.setTarget(smoothedTarget);
    });

    return () => {
      scene.onBeforeRenderObservable.remove(observer);
    };
  }, [playerVisualPositionRef, scene, viewMode]);

  return (
    <arcRotateCamera
      key={viewMode}
      name="arena-camera"
      alpha={
        viewMode === "top_down"
          ? Tools.ToRadians(90)
          : Tools.ToRadians(viewMode === "three_d" ? threeDDefaultCameraAlpha : 45)
      }
      beta={
        viewMode === "top_down"
          ? 0.01
          : Tools.ToRadians(viewMode === "three_d" ? threeDDefaultCameraBeta : 56)
      }
      radius={viewMode === "fps" ? fpsDefaultCameraRadius : viewMode === "top_down" ? 31 : threeDDefaultCameraRadius}
      target={
        viewMode === "fps"
          ? playerTarget
          : viewMode === "three_d"
            ? threeDInitialTarget(playerVisualPositionRef.current)
            : new Vector3(0, 0, 0)
      }
      onCreate={(camera: ArcRotateCamera) => {
        const canvas = scene.getEngine().getRenderingCanvas();
        scene.activeCamera = camera;
        camera.panningSensibility = 0;

        if (viewMode === "top_down") {
          camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
          camera.lowerRadiusLimit = camera.upperRadiusLimit = 31;
          camera.lowerBetaLimit = camera.upperBetaLimit = 0.01;
          configureOrthographicCamera(camera, scene);
          return;
        }

        camera.lowerBetaLimit = Tools.ToRadians(24);
        camera.upperBetaLimit = Tools.ToRadians(82);
        camera.fov = viewMode === "fps" ? Tools.ToRadians(88) : Tools.ToRadians(50);
        camera.wheelDeltaPercentage = viewMode === "fps" ? 0.02 : 0.024;
        camera.lowerRadiusLimit = viewMode === "fps" ? fpsMinCameraRadius : 18;
        camera.upperRadiusLimit = viewMode === "fps" ? fpsMaxCameraRadius : 33;
        // The gameplay layer owns keyboard movement. Keep camera controls mouse-only
        // so the arrow keys do not rotate the camera while also moving the player.
        camera.keysUp = [];
        camera.keysDown = [];
        camera.keysLeft = [];
        camera.keysRight = [];
        camera.attachControl(canvas, true);
      }}
    />
  );
});

function useSceneRuntime(scene: BabylonScene, arena: ArenaState, isTopDown: boolean) {
  const glowRef = useRef<GlowLayer | null>(null);

  useEffect(() => {
    scene.clearColor = Color4.FromHexString(`${arena.palette.primary}FF`);
    scene.ambientColor = Color3.FromHexString(isTopDown ? "#000000" : darkenHex(arena.palette.secondary, 0.34));
    scene.fogEnabled = isTopDown ? false : arena.fog;
    scene.fogMode = BabylonScene.FOGMODE_EXP2;
    scene.fogDensity = !isTopDown && arena.fog ? 0.024 : 0;
    scene.fogColor = Color3.FromHexString(arena.palette.primary);
  }, [arena.fog, arena.palette.primary, arena.palette.secondary, isTopDown, scene]);

  useEffect(() => {
    if (!glowRef.current) {
      glowRef.current = new GlowLayer("mutation-glow", scene);
    }

    glowRef.current.intensity = isTopDown ? 0 : arena.fog ? 0.24 : 0.14;

    return () => {
      glowRef.current?.dispose();
      glowRef.current = null;
    };
  }, [arena.fog, isTopDown, scene]);

  useEffect(() => {
    if (!isTopDown) {
      return;
    }

    const flattenTopDownMaterial = (material: unknown) => {
      if (!(material instanceof StandardMaterial) || !material.name.startsWith("topdown-")) {
        return;
      }

      material.specularColor = Color3.Black();
      material.specularPower = 0;
    };

    scene.materials.forEach(flattenTopDownMaterial);
    const observer = scene.onNewMaterialAddedObservable.add(flattenTopDownMaterial);

    return () => {
      scene.onNewMaterialAddedObservable.remove(observer);
    };
  }, [isTopDown, scene]);

  useEffect(() => {
    const camera = scene.getCameraByName("arena-camera") as ArcRotateCamera | null;
    if (!camera || (!arena.cameraKick && !arena.cameraOrbit)) {
      return;
    }

    const baseRadius = camera.radius;
    const baseAlpha = camera.alpha;
    const baseBeta = camera.beta;
    const baseTarget = camera.target.clone();
    const start = performance.now();
    const observer = scene.onBeforeRenderObservable.add(() => {
      const elapsed = performance.now() - start;
      const shake = Math.max(0, 1 - elapsed / 700) * arena.cameraKick;
      const orbitPulse = Math.max(0, 1 - elapsed / 1200) * arena.cameraOrbit;
      camera.alpha = baseAlpha + Math.sin(elapsed * 0.02) * shake * 0.006;
      camera.beta = baseBeta + Tools.ToRadians(Math.sin(elapsed * 0.04) * shake * 0.35);
      camera.radius = baseRadius - orbitPulse * 1.35 + Math.sin(elapsed * 0.07) * shake * 0.16;
      camera.target.x = baseTarget.x + Math.sin(elapsed * 0.05) * shake * 0.08;
      camera.target.z = baseTarget.z + Math.cos(elapsed * 0.04) * shake * 0.08;

      if (elapsed >= 1200) {
        camera.alpha = baseAlpha;
        camera.beta = baseBeta;
        camera.radius = baseRadius;
        camera.setTarget(baseTarget);
        scene.onBeforeRenderObservable.remove(observer);
      }
    });

    return () => {
      scene.onBeforeRenderObservable.remove(observer);
    };
  }, [arena.cameraKick, arena.cameraOrbit, scene]);
}

function Player({
  arena,
  isTopDown,
  visualStyle,
  visualPositionRef,
  lastDirectionRef
}: {
  arena: ArenaState;
  isTopDown: boolean;
  visualStyle: VisualStyle;
  visualPositionRef: { current: Vector3 };
  lastDirectionRef: { current: Cell };
}) {
  const scene = useScene();
  const bodyPositionRef = useRef(visualPositionRef.current.clone());
  const headPositionRef = useRef(visualPositionRef.current.add(new Vector3(0, 0.42, 0)));
  const facingYawRef = useRef(0);

  useEffect(() => {
    const body = scene.getMeshByName("player-body");
    const head = scene.getMeshByName("player-head");
    if (!body || !head) {
      return;
    }

    const observer = scene.onBeforeRenderObservable.add(() => {
      const bodyPosition = visualPositionRef.current;
      const headPosition = bodyPosition.add(new Vector3(0, 0.42, 0));
      const targetYaw = playerFacingYaw(lastDirectionRef.current);
      const yaw = smoothAngle(facingYawRef.current, targetYaw, 0.22);
      facingYawRef.current = yaw;

      body.position.copyFrom(bodyPosition);
      body.rotation.y = yaw;
      head.position.copyFrom(headPosition);
      head.rotation.y = yaw;
      positionPlayerPart(scene, "player-visor", headPosition, new Vector3(0, 0.11, -0.225), yaw);
      positionPlayerPart(scene, "player-face-panel", headPosition, new Vector3(0, -0.02, -0.235), yaw);
      positionPlayerPart(scene, "player-eye-left", headPosition, new Vector3(-0.085, -0.015, -0.27), yaw);
      positionPlayerPart(scene, "player-eye-right", headPosition, new Vector3(0.085, -0.015, -0.27), yaw);
      positionPlayerPart(scene, "player-antenna", headPosition, new Vector3(0, 0.3, 0), yaw);
      positionPlayerPart(scene, "player-antenna-tip", headPosition, new Vector3(0, 0.43, 0), yaw);
      positionPlayerDetail(scene, "player-halo", headPosition, yaw);
      positionPlayerPart(scene, "player-left-hand", bodyPosition, new Vector3(-0.3, 0.08, 0), yaw);
      positionPlayerPart(scene, "player-right-hand", bodyPosition, new Vector3(0.3, 0.08, 0), yaw);
      positionPlayerPart(scene, "player-left-boot", bodyPosition, new Vector3(-0.18, -0.31, 0), yaw);
      positionPlayerPart(scene, "player-right-boot", bodyPosition, new Vector3(0.18, -0.31, 0), yaw);
      positionPlayerPart(scene, "player-backpack", bodyPosition, new Vector3(0, 0.02, 0.24), yaw);
      positionPlayerPart(scene, "player-belt", bodyPosition, new Vector3(0, 0.03, -0.34), yaw);
      positionPlayerDetail(scene, "player-ground-shadow", new Vector3(bodyPosition.x, 0.024, bodyPosition.z + 0.05));
      positionPlayerDetail(scene, "player-locator-ring", new Vector3(bodyPosition.x, 0.085, bodyPosition.z));
      positionPlayerDetail(scene, "player-locator-arrow", new Vector3(bodyPosition.x, 1.55, bodyPosition.z));
      positionPlayerDetail(scene, "player-locator-arrow-stem", new Vector3(bodyPosition.x, 1.8, bodyPosition.z));
      positionPlayerDetail(scene, "player-topdown-base", new Vector3(bodyPosition.x, 0.075, bodyPosition.z));
      positionPlayerDetail(scene, "player-topdown-ring", new Vector3(bodyPosition.x, 0.11, bodyPosition.z));
      const pointer = scene.getMeshByName("player-topdown-pointer");
      if (pointer) {
        pointer.position.copyFrom(playerTopDownPointerPosition(bodyPosition, lastDirectionRef.current));
        pointer.rotation.y = directionYaw(lastDirectionRef.current);
      }
      bodyPositionRef.current.copyFrom(body.position);
      headPositionRef.current.copyFrom(head.position);
    });

    return () => {
      scene.onBeforeRenderObservable.remove(observer);
    };
  }, [lastDirectionRef, scene, visualPositionRef]);

  return (
    <>
      <sphere
        name="player-body"
        position={bodyPositionRef.current}
        options={{ diameter: isTopDown ? 0.68 : visualStyle === "toy_like" ? 0.68 : 0.72, segments: 32 }}
      >
        <standardMaterial
          name="player-body-material"
          diffuseColor={Color3.FromHexString("#F8FAFC")}
          emissiveColor={Color3.FromHexString("#000000")}
          specularColor={Color3.FromHexString(isTopDown ? "#000000" : "#FFFFFF")}
        />
      </sphere>
      <sphere
        name="player-head"
        position={headPositionRef.current}
        options={{ diameter: isTopDown ? 0.4 : visualStyle === "toy_like" ? 0.4 : 0.44, segments: 24 }}
      >
        <standardMaterial
          name="player-head-material"
          diffuseColor={Color3.FromHexString("#F8FAFC")}
          emissiveColor={Color3.FromHexString("#000000")}
          specularColor={Color3.FromHexString(isTopDown ? "#000000" : "#FFFFFF")}
        />
      </sphere>
      {isTopDown ? (
        <PlayerTopDownMarker arena={arena} position={visualPositionRef.current} direction={lastDirectionRef.current} />
      ) : null}
      <PlayerDetails arena={arena} isTopDown={isTopDown} visualStyle={visualStyle} position={visualPositionRef.current} />
    </>
  );
}

function positionPlayerDetail(scene: BabylonScene, name: string, position: Vector3, rotationY?: number) {
  const mesh = scene.getMeshByName(name);
  if (!mesh) {
    return;
  }

  mesh.position.copyFrom(position);
  if (rotationY !== undefined) {
    mesh.rotation.y = rotationY;
  }
}

function positionPlayerPart(scene: BabylonScene, name: string, anchor: Vector3, localOffset: Vector3, yaw: number) {
  positionPlayerDetail(scene, name, anchor.add(rotatePlayerOffset(localOffset, yaw)), yaw);
}

function rotatePlayerOffset(offset: Vector3, yaw: number) {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return new Vector3(offset.x * cos - offset.z * sin, offset.y, offset.x * sin + offset.z * cos);
}

function playerFacingYaw(direction: Cell) {
  return Math.atan2(direction.x, -direction.z);
}

function smoothAngle(current: number, target: number, factor: number) {
  return current + shortestAngleDelta(current, target) * factor;
}

function shortestAngleDelta(current: number, target: number) {
  return Math.atan2(Math.sin(target - current), Math.cos(target - current));
}

function PlayerTopDownMarker({
  arena,
  position,
  direction
}: {
  arena: ArenaState;
  position: Vector3;
  direction: Cell;
}) {
  const accent = Color3.FromHexString(arena.palette.accent);

  return (
    <>
      <box
        name="player-topdown-base"
        position={new Vector3(position.x, 0.075, position.z)}
        rotationY={Tools.ToRadians(45)}
        options={{ width: 0.76, height: 0.045, depth: 0.76 }}
      >
        <standardMaterial
          name="player-topdown-base-material"
          diffuseColor={accent}
          emissiveColor={accent}
          specularColor={Color3.FromHexString("#000000")}
        />
      </box>
      <torus
        name="player-topdown-ring"
        position={new Vector3(position.x, 0.11, position.z)}
        rotationX={Tools.ToRadians(90)}
        options={{ diameter: 1, thickness: 0.1, tessellation: 48 }}
      >
        <standardMaterial
          name="player-topdown-ring-material"
          diffuseColor={Color3.FromHexString("#F8FAFC")}
          emissiveColor={accent}
          specularColor={Color3.FromHexString("#000000")}
        />
      </torus>
      <box
        name="player-topdown-pointer"
        position={playerTopDownPointerPosition(position, direction)}
        rotationY={directionYaw(direction)}
        options={{ width: 0.22, height: 0.055, depth: 0.34 }}
      >
        <standardMaterial
          name="player-topdown-pointer-material"
          diffuseColor={accent}
          emissiveColor={accent}
          specularColor={Color3.FromHexString("#000000")}
        />
      </box>
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

function PlayerDetails({
  arena,
  isTopDown,
  visualStyle,
  position
}: {
  arena: ArenaState;
  isTopDown: boolean;
  visualStyle: VisualStyle;
  position: Vector3;
}) {
  const white = Color3.FromHexString("#F8FAFC");
  const dark = Color3.FromHexString("#111827");
  const accent = Color3.FromHexString(arena.palette.accent);
  const playerBlue = Color3.FromHexString("#2563EB");
  const playerPink = Color3.FromHexString("#FB7185");
  const playerSkin = Color3.FromHexString("#FDE7B2");

  if (visualStyle === "toy_like") {
    return (
      <>
        <sphere name="player-left-hand" position={position.add(new Vector3(-0.24, 0.06, 0))} options={{ diameter: 0.18, segments: 16 }}>
          <standardMaterial name="player-left-hand-material" diffuseColor={white} emissiveColor={isTopDown ? dark : white} />
        </sphere>
        <sphere name="player-right-hand" position={position.add(new Vector3(0.24, 0.06, 0))} options={{ diameter: 0.18, segments: 16 }}>
          <standardMaterial name="player-right-hand-material" diffuseColor={white} emissiveColor={isTopDown ? dark : white} />
        </sphere>
        <sphere name="player-left-boot" position={position.add(new Vector3(-0.16, -0.28, 0))} options={{ diameter: 0.18, segments: 16 }}>
          <standardMaterial name="player-left-boot-material" diffuseColor={Color3.FromHexString("#FB7185")} emissiveColor={Color3.FromHexString("#000000")} />
        </sphere>
        <sphere name="player-right-boot" position={position.add(new Vector3(0.16, -0.28, 0))} options={{ diameter: 0.18, segments: 16 }}>
          <standardMaterial name="player-right-boot-material" diffuseColor={Color3.FromHexString("#FB7185")} emissiveColor={Color3.FromHexString("#000000")} />
        </sphere>
      </>
    );
  }

  if (visualStyle === "neon_cinematic") {
    return (
      <>
        <torus name="player-halo" position={position.add(new Vector3(0, 0.42, 0))} rotationX={Tools.ToRadians(90)} options={{ diameter: 0.46, thickness: 0.045, tessellation: 48 }}>
          <standardMaterial name="player-halo-material" diffuseColor={accent} emissiveColor={accent} />
        </torus>
        <box name="player-visor" position={position.add(new Vector3(0, 0.43, -0.18))} options={{ width: 0.28, height: 0.11, depth: 0.04 }}>
          <standardMaterial name="player-visor-material" diffuseColor={Color3.FromHexString("#67E8F9")} emissiveColor={Color3.FromHexString("#67E8F9")} />
        </box>
        <box name="player-backpack" position={position.add(new Vector3(0, 0.02, 0.2))} options={{ width: 0.28, height: 0.34, depth: 0.16 }}>
          <standardMaterial name="player-backpack-material" diffuseColor={Color3.FromHexString("#0F172A")} emissiveColor={accent} />
        </box>
        <box name="player-left-boot" position={position.add(new Vector3(-0.16, -0.28, 0))} options={{ width: 0.18, height: 0.14, depth: 0.22 }}>
          <standardMaterial name="player-left-boot-material" diffuseColor={Color3.FromHexString("#0F172A")} emissiveColor={Color3.FromHexString("#67E8F9")} />
        </box>
        <box name="player-right-boot" position={position.add(new Vector3(0.16, -0.28, 0))} options={{ width: 0.18, height: 0.14, depth: 0.22 }}>
          <standardMaterial name="player-right-boot-material" diffuseColor={Color3.FromHexString("#0F172A")} emissiveColor={Color3.FromHexString("#67E8F9")} />
        </box>
      </>
    );
  }

  return (
    <>
      {!isTopDown ? (
        <>
          <cylinder
            name="player-ground-shadow"
            position={new Vector3(position.x, 0.024, position.z + 0.05)}
            options={{ height: 0.018, diameter: 0.86, tessellation: 40 }}
          >
            <standardMaterial
              name="player-ground-shadow-material"
              diffuseColor={Color3.FromHexString("#020617")}
              emissiveColor={Color3.FromHexString("#000000")}
              specularColor={Color3.FromHexString("#000000")}
              alpha={0.44}
            />
          </cylinder>
          <torus
            name="player-locator-ring"
            position={new Vector3(position.x, 0.085, position.z)}
            rotationX={Tools.ToRadians(90)}
            options={{ diameter: 1.1, thickness: 0.055, tessellation: 56 }}
          >
            <standardMaterial
              name="player-locator-ring-material"
              diffuseColor={playerBlue}
              emissiveColor={Color3.FromHexString("#1D4ED8")}
              specularColor={white}
              alpha={0.74}
            />
          </torus>
          <cylinder
            name="player-locator-arrow"
            position={new Vector3(position.x, 1.55, position.z)}
            options={{ height: 0.34, diameterTop: 0.42, diameterBottom: 0, tessellation: 4 }}
          >
            <standardMaterial
              name="player-locator-arrow-material"
              diffuseColor={Color3.FromHexString("#FDE047")}
              emissiveColor={Color3.FromHexString("#A16207")}
              specularColor={white}
            />
          </cylinder>
          <cylinder
            name="player-locator-arrow-stem"
            position={new Vector3(position.x, 1.8, position.z)}
            options={{ height: 0.24, diameter: 0.09, tessellation: 16 }}
          >
            <standardMaterial
              name="player-locator-arrow-stem-material"
              diffuseColor={Color3.FromHexString("#FDE047")}
              emissiveColor={Color3.FromHexString("#A16207")}
              specularColor={white}
            />
          </cylinder>
        </>
      ) : null}
      <box name="player-face-panel" position={position.add(new Vector3(0, 0.4, -0.235))} options={{ width: 0.36, height: 0.2, depth: 0.055 }}>
        <standardMaterial name="player-face-panel-material" diffuseColor={playerSkin} emissiveColor={Color3.FromHexString("#000000")} specularColor={white} />
      </box>
      <box name="player-eye-left" position={position.add(new Vector3(-0.085, 0.405, -0.27))} options={{ width: 0.045, height: 0.13, depth: 0.035 }}>
        <standardMaterial name="player-eye-left-material" diffuseColor={dark} emissiveColor={Color3.FromHexString("#000000")} />
      </box>
      <box name="player-eye-right" position={position.add(new Vector3(0.085, 0.405, -0.27))} options={{ width: 0.045, height: 0.13, depth: 0.035 }}>
        <standardMaterial name="player-eye-right-material" diffuseColor={dark} emissiveColor={Color3.FromHexString("#000000")} />
      </box>
      <box name="player-visor" position={position.add(new Vector3(0, 0.53, -0.225))} options={{ width: 0.38, height: 0.045, depth: 0.06 }}>
        <standardMaterial name="player-visor-material" diffuseColor={playerBlue} emissiveColor={isTopDown ? dark : Color3.FromHexString("#1E3A8A")} specularColor={white} />
      </box>
      <cylinder name="player-antenna" position={position.add(new Vector3(0, 0.72, 0))} options={{ height: 0.2, diameter: 0.045, tessellation: 12 }}>
        <standardMaterial name="player-antenna-material" diffuseColor={dark} emissiveColor={isTopDown ? dark : accent} />
      </cylinder>
      <sphere name="player-antenna-tip" position={position.add(new Vector3(0, 0.85, 0))} options={{ diameter: 0.13, segments: 16 }}>
        <standardMaterial name="player-antenna-tip-material" diffuseColor={accent} emissiveColor={isTopDown ? dark : accent} />
      </sphere>
      <sphere name="player-left-hand" position={position.add(new Vector3(-0.3, 0.08, 0))} options={{ diameter: 0.2, segments: 16 }}>
        <standardMaterial
          name="player-left-hand-material"
          diffuseColor={playerPink}
          emissiveColor={isTopDown ? dark : Color3.FromHexString("#7F1D1D")}
          specularColor={isTopDown ? dark : white}
        />
      </sphere>
      <sphere name="player-right-hand" position={position.add(new Vector3(0.3, 0.08, 0))} options={{ diameter: 0.2, segments: 16 }}>
        <standardMaterial
          name="player-right-hand-material"
          diffuseColor={playerPink}
          emissiveColor={isTopDown ? dark : Color3.FromHexString("#7F1D1D")}
          specularColor={isTopDown ? dark : white}
        />
      </sphere>
      <box name="player-belt" position={position.add(new Vector3(0, 0.03, -0.34))} options={{ width: 0.48, height: 0.12, depth: 0.045 }}>
        <standardMaterial name="player-belt-material" diffuseColor={playerBlue} emissiveColor={isTopDown ? dark : Color3.FromHexString("#1E3A8A")} specularColor={white} />
      </box>
      <box name="player-backpack" position={position.add(new Vector3(0, 0.02, 0.24))} options={{ width: 0.28, height: 0.32, depth: 0.16 }}>
        <standardMaterial name="player-backpack-material" diffuseColor={dark} emissiveColor={isTopDown ? dark : Color3.FromHexString(arena.palette.secondary)} />
      </box>
      <box name="player-left-boot" position={position.add(new Vector3(-0.18, -0.31, 0))} options={{ width: 0.22, height: 0.16, depth: 0.26 }}>
        <standardMaterial name="player-left-boot-material" diffuseColor={playerPink} emissiveColor={isTopDown ? dark : Color3.FromHexString("#7F1D1D")} specularColor={white} />
      </box>
      <box name="player-right-boot" position={position.add(new Vector3(0.18, -0.31, 0))} options={{ width: 0.22, height: 0.16, depth: 0.26 }}>
        <standardMaterial name="player-right-boot-material" diffuseColor={playerPink} emissiveColor={isTopDown ? dark : Color3.FromHexString("#7F1D1D")} specularColor={white} />
      </box>
    </>
  );
}

function EnemyDetails({
  enemy,
  isTopDown,
  visualStyle,
  position
}: {
  enemy: ActiveEnemy;
  isTopDown: boolean;
  visualStyle: VisualStyle;
  position: Vector3;
}) {
  const eyeColor = Color3.FromHexString(visualStyle === "neon_cinematic" ? "#F8FAFC" : "#111827");
  const eyeEmissive = Color3.FromHexString(isTopDown ? "#000000" : visualStyle === "neon_cinematic" ? "#FFFFFF" : "#F8FAFC");
  const leftEye = enemyVisualPosition(position, -0.14, -0.24, enemy.type === "ghost" ? 0.56 : 0.48);
  const rightEye = enemyVisualPosition(position, 0.14, -0.24, enemy.type === "ghost" ? 0.56 : 0.48);

  return (
    <>
      <sphere name={`enemy-eye-left-${enemy.id}`} position={leftEye} options={{ diameter: 0.1, segments: 12 }}>
        <standardMaterial name={`enemy-eye-left-material-${enemy.id}`} diffuseColor={eyeColor} emissiveColor={eyeEmissive} />
      </sphere>
      <sphere name={`enemy-eye-right-${enemy.id}`} position={rightEye} options={{ diameter: 0.1, segments: 12 }}>
        <standardMaterial name={`enemy-eye-right-material-${enemy.id}`} diffuseColor={eyeColor} emissiveColor={eyeEmissive} />
      </sphere>
      {enemy.type === "wanderer" ? (
        <torus name={`enemy-collar-${enemy.id}`} position={position} rotationX={Tools.ToRadians(90)} options={{ diameter: 0.7, thickness: 0.045, tessellation: 36 }}>
          <standardMaterial name={`enemy-collar-material-${enemy.id}`} diffuseColor={Color3.FromHexString("#FDE68A")} emissiveColor={eyeEmissive} />
        </torus>
      ) : null}
      {enemy.type === "chaser" ? (
        <>
          <box name={`enemy-fin-left-${enemy.id}`} position={enemyVisualPosition(position, -0.36, 0, 0.44)} rotationZ={Tools.ToRadians(35)} options={{ width: 0.22, height: 0.08, depth: 0.18 }}>
            <standardMaterial name={`enemy-fin-left-material-${enemy.id}`} diffuseColor={Color3.FromHexString("#FBCFE8")} emissiveColor={eyeEmissive} />
          </box>
          <box name={`enemy-fin-right-${enemy.id}`} position={enemyVisualPosition(position, 0.36, 0, 0.44)} rotationZ={Tools.ToRadians(-35)} options={{ width: 0.22, height: 0.08, depth: 0.18 }}>
            <standardMaterial name={`enemy-fin-right-material-${enemy.id}`} diffuseColor={Color3.FromHexString("#FBCFE8")} emissiveColor={eyeEmissive} />
          </box>
        </>
      ) : null}
      {enemy.type === "ghost" ? (
        <torus name={`enemy-ghost-ring-${enemy.id}`} position={enemyVisualPosition(position, 0, 0, 0.14)} rotationX={Tools.ToRadians(90)} options={{ diameter: 0.74, thickness: 0.05, tessellation: 36 }}>
          <standardMaterial name={`enemy-ghost-ring-material-${enemy.id}`} diffuseColor={Color3.FromHexString("#DDD6FE")} emissiveColor={eyeEmissive} alpha={0.8} />
        </torus>
      ) : null}
    </>
  );
}

function EnemyTopDownMarker({ enemy }: { enemy: ActiveEnemy }) {
  const position = cellPosition(enemy.cell.x, enemy.cell.z, 0.11);

  switch (enemy.type) {
    case "wanderer":
      return (
        <torus
          name={`enemy-topdown-ring-${enemy.id}`}
          position={position}
          rotationX={Tools.ToRadians(90)}
          options={{ diameter: 0.86, thickness: 0.08, tessellation: 40 }}
        >
          <standardMaterial
            name={`enemy-topdown-ring-material-${enemy.id}`}
            diffuseColor={Color3.FromHexString("#FDE68A")}
            emissiveColor={Color3.FromHexString("#F59E0B")}
            specularColor={Color3.FromHexString("#000000")}
          />
        </torus>
      );
    case "chaser":
      return (
        <box
          name={`enemy-topdown-diamond-${enemy.id}`}
          position={position}
          rotationY={Tools.ToRadians(45)}
          options={{ width: 0.82, height: 0.05, depth: 0.82 }}
        >
          <standardMaterial
            name={`enemy-topdown-diamond-material-${enemy.id}`}
            diffuseColor={Color3.FromHexString("#FBCFE8")}
            emissiveColor={Color3.FromHexString("#EC4899")}
            specularColor={Color3.FromHexString("#000000")}
          />
        </box>
      );
    case "ghost":
      return (
        <>
          <cylinder
            name={`enemy-topdown-aura-${enemy.id}`}
            position={cellPosition(enemy.cell.x, enemy.cell.z, 0.08)}
            options={{ height: 0.03, diameter: 0.84, tessellation: 40 }}
          >
            <standardMaterial
              name={`enemy-topdown-aura-material-${enemy.id}`}
              diffuseColor={Color3.FromHexString("#DDD6FE")}
              emissiveColor={Color3.FromHexString("#A78BFA")}
              specularColor={Color3.FromHexString("#000000")}
              alpha={0.34}
            />
          </cylinder>
          <torus
            name={`enemy-topdown-ghost-ring-${enemy.id}`}
            position={position}
            rotationX={Tools.ToRadians(90)}
            options={{ diameter: 0.88, thickness: 0.06, tessellation: 40 }}
          >
            <standardMaterial
              name={`enemy-topdown-ghost-ring-material-${enemy.id}`}
              diffuseColor={Color3.FromHexString("#EDE9FE")}
              emissiveColor={Color3.FromHexString("#A78BFA")}
              specularColor={Color3.FromHexString("#000000")}
              alpha={0.92}
            />
          </torus>
        </>
      );
  }
}

function StageDetails({ arena, visualStyle }: { arena: ArenaState; visualStyle: VisualStyle }) {
  const accents =
    visualStyle === "toy_like"
      ? [
          { x: -10.2, z: -10.2, color: "#FDE68A" },
          { x: 10.2, z: -10.2, color: "#FBCFE8" },
          { x: -10.2, z: 10.2, color: "#BFDBFE" },
          { x: 10.2, z: 10.2, color: "#BBF7D0" }
        ]
      : [
          { x: -10.2, z: -10.2, color: arena.palette.accent },
          { x: 10.2, z: -10.2, color: arena.palette.secondary },
          { x: -10.2, z: 10.2, color: arena.palette.secondary },
          { x: 10.2, z: 10.2, color: arena.palette.accent }
        ];

  return (
    <>
      {accents.map((accent, index) =>
        visualStyle === "neon_cinematic" ? (
          <cylinder key={`stage-accent-${index}`} name={`stage-accent-${index}`} position={new Vector3(accent.x, 0.75, accent.z)} options={{ height: 1.5, diameter: 0.18, tessellation: 24 }}>
            <standardMaterial name={`stage-accent-material-${index}`} diffuseColor={Color3.FromHexString(accent.color)} emissiveColor={Color3.FromHexString(softenHex(accent.color, 0.38))} alpha={0.68} />
          </cylinder>
        ) : (
          <box key={`stage-accent-${index}`} name={`stage-accent-${index}`} position={new Vector3(accent.x, 0.28, accent.z)} rotationY={Tools.ToRadians(index * 18)} options={{ width: 0.52, height: visualStyle === "toy_like" ? 0.52 : 0.38, depth: 0.52 }}>
            <standardMaterial name={`stage-accent-material-${index}`} diffuseColor={Color3.FromHexString(accent.color)} emissiveColor={Color3.FromHexString(visualStyle === "toy_like" ? "#000000" : accent.color)} />
          </box>
        )
      )}
    </>
  );
}

function PowerUpToken({
  powerUp,
  isTopDown,
  visualStyle
}: {
  powerUp: ActivePowerUp;
  isTopDown: boolean;
  visualStyle: VisualStyle;
  key?: string;
}) {
  const look = powerUpLook(powerUp.type);

  if (!isTopDown) {
    return (
      <>
        <box
          name={`powerup-outline-${powerUp.type}-${powerUp.cell.x}-${powerUp.cell.z}`}
          position={cellPosition(powerUp.cell.x, powerUp.cell.z, 0.22)}
          options={{ width: 0.78, height: 0.12, depth: 0.78 }}
        >
          <standardMaterial
            name={`powerup-outline-material-${powerUp.type}-${powerUp.cell.x}-${powerUp.cell.z}`}
            diffuseColor={Color3.FromHexString("#111827")}
            emissiveColor={Color3.FromHexString("#000000")}
            specularColor={Color3.FromHexString("#FFFFFF")}
          />
        </box>
        <box
          name={`powerup-panel-${powerUp.type}-${powerUp.cell.x}-${powerUp.cell.z}`}
          position={cellPosition(powerUp.cell.x, powerUp.cell.z, 0.31)}
          options={{ width: 0.66, height: 0.12, depth: 0.66 }}
        >
          <standardMaterial
            name={`powerup-panel-material-${powerUp.type}-${powerUp.cell.x}-${powerUp.cell.z}`}
            diffuseColor={Color3.FromHexString(look.color)}
            emissiveColor={Color3.FromHexString("#000000")}
            specularColor={Color3.FromHexString("#FFFFFF")}
          />
        </box>
        <box
          name={`powerup-shine-${powerUp.type}-${powerUp.cell.x}-${powerUp.cell.z}`}
          position={cellPosition(powerUp.cell.x - 0.18, powerUp.cell.z - 0.18, 0.385)}
          options={{ width: 0.18, height: 0.025, depth: 0.08 }}
        >
          <standardMaterial
            name={`powerup-shine-material-${powerUp.type}-${powerUp.cell.x}-${powerUp.cell.z}`}
            diffuseColor={Color3.FromHexString("#F8FAFC")}
            emissiveColor={Color3.FromHexString("#000000")}
            specularColor={Color3.FromHexString("#FFFFFF")}
            alpha={0.72}
          />
        </box>
        <PowerUpMarker powerUp={powerUp} isTopDown={false} />
      </>
    );
  }

  return (
    <>
      {isTopDown ? (
        <cylinder
          name={`powerup-outline-${powerUp.type}-${powerUp.cell.x}-${powerUp.cell.z}`}
          position={cellPosition(powerUp.cell.x, powerUp.cell.z, 0.09)}
          options={{
            height: 0.08,
            diameter: look.diameter + 0.16,
            tessellation: look.tessellation
          }}
        >
          <standardMaterial
            name={`powerup-outline-material-${powerUp.type}-${powerUp.cell.x}-${powerUp.cell.z}`}
            diffuseColor={Color3.FromHexString("#F8FAFC")}
            emissiveColor={Color3.FromHexString("#F8FAFC")}
            specularColor={Color3.FromHexString("#000000")}
          />
        </cylinder>
      ) : null}
      <cylinder
        name={`powerup-${powerUp.type}-${powerUp.cell.x}-${powerUp.cell.z}`}
        position={cellPosition(powerUp.cell.x, powerUp.cell.z, 0.18)}
        options={{
          height: isTopDown ? 0.18 : 0.22,
          diameter: isTopDown ? look.diameter + 0.06 : look.diameter,
          tessellation: look.tessellation
        }}
      >
        <standardMaterial
          name={`powerup-material-${powerUp.type}-${powerUp.cell.x}-${powerUp.cell.z}`}
          diffuseColor={Color3.FromHexString(look.color)}
          emissiveColor={Color3.FromHexString(isTopDown ? "#000000" : visualStyle === "neon_cinematic" ? look.color : "#000000")}
          specularColor={Color3.FromHexString(isTopDown ? "#000000" : "#FFFFFF")}
        />
      </cylinder>
      <PowerUpMarker powerUp={powerUp} isTopDown={isTopDown} />
    </>
  );
}

function PowerUpMarker({ powerUp, isTopDown }: { powerUp: ActivePowerUp; isTopDown: boolean }) {
  const position = cellPosition(powerUp.cell.x, powerUp.cell.z, isTopDown ? 0.38 : 0.405);
  const markerColor = isTopDown ? "#F8FAFC" : "#FFFFFF";
  const markerMaterial = (
    <standardMaterial
      name={`powerup-marker-material-${powerUp.type}-${powerUp.cell.x}-${powerUp.cell.z}`}
      diffuseColor={Color3.FromHexString(markerColor)}
      emissiveColor={Color3.FromHexString(isTopDown ? "#000000" : markerColor)}
      specularColor={Color3.FromHexString("#000000")}
    />
  );

  switch (powerUp.type) {
    case "bomb_capacity":
      return (
        <>
          <cylinder
            name={`powerup-marker-bomb-${powerUp.cell.x}-${powerUp.cell.z}`}
            position={cellPosition(powerUp.cell.x, powerUp.cell.z + 0.03, isTopDown ? 0.38 : 0.43)}
            options={{ height: isTopDown ? 0.08 : 0.055, diameter: isTopDown ? 0.24 : 0.3, tessellation: 24 }}
          >
            {markerMaterial}
          </cylinder>
          <box
            name={`powerup-marker-bomb-fuse-${powerUp.cell.x}-${powerUp.cell.z}`}
            position={cellPosition(powerUp.cell.x + 0.16, powerUp.cell.z - 0.16, isTopDown ? 0.4 : 0.46)}
            rotationY={Tools.ToRadians(45)}
            options={{ width: 0.06, height: isTopDown ? 0.08 : 0.055, depth: 0.22 }}
          >
            {markerMaterial}
          </box>
        </>
      );
    case "blast_radius":
      return (
        <>
          <box name={`powerup-marker-radius-x-${powerUp.cell.x}-${powerUp.cell.z}`} position={position} options={{ width: isTopDown ? 0.34 : 0.42, height: isTopDown ? 0.08 : 0.06, depth: isTopDown ? 0.08 : 0.1 }}>
            {markerMaterial}
          </box>
          <box name={`powerup-marker-radius-z-${powerUp.cell.x}-${powerUp.cell.z}`} position={position} options={{ width: isTopDown ? 0.08 : 0.1, height: isTopDown ? 0.08 : 0.06, depth: isTopDown ? 0.34 : 0.42 }}>
            {markerMaterial}
          </box>
        </>
      );
    case "speed_up":
      return (
        <>
          <box name={`powerup-marker-speed-tail-${powerUp.cell.x}-${powerUp.cell.z}`} position={cellPosition(powerUp.cell.x - 0.12, powerUp.cell.z, isTopDown ? 0.38 : 0.405)} rotationY={Tools.ToRadians(45)} options={{ width: isTopDown ? 0.2 : 0.22, height: isTopDown ? 0.08 : 0.06, depth: isTopDown ? 0.2 : 0.22 }}>
            {markerMaterial}
          </box>
          <box name={`powerup-marker-speed-head-${powerUp.cell.x}-${powerUp.cell.z}`} position={cellPosition(powerUp.cell.x + 0.12, powerUp.cell.z, isTopDown ? 0.38 : 0.405)} rotationY={Tools.ToRadians(45)} options={{ width: isTopDown ? 0.28 : 0.3, height: isTopDown ? 0.08 : 0.06, depth: isTopDown ? 0.28 : 0.3 }}>
            {markerMaterial}
          </box>
        </>
      );
    case "bomb_kick":
      return (
        <>
          <box name={`powerup-marker-kick-shaft-${powerUp.cell.x}-${powerUp.cell.z}`} position={cellPosition(powerUp.cell.x - 0.03, powerUp.cell.z, isTopDown ? 0.38 : 0.405)} options={{ width: isTopDown ? 0.36 : 0.38, height: isTopDown ? 0.08 : 0.06, depth: isTopDown ? 0.1 : 0.12 }}>
            {markerMaterial}
          </box>
          <box name={`powerup-marker-kick-foot-${powerUp.cell.x}-${powerUp.cell.z}`} position={cellPosition(powerUp.cell.x + 0.18, powerUp.cell.z + 0.12, isTopDown ? 0.38 : 0.405)} options={{ width: isTopDown ? 0.12 : 0.14, height: isTopDown ? 0.08 : 0.06, depth: isTopDown ? 0.22 : 0.24 }}>
            {markerMaterial}
          </box>
        </>
      );
    case "throw_bomb":
      return (
        <>
          <box name={`powerup-marker-throw-stem-${powerUp.cell.x}-${powerUp.cell.z}`} position={cellPosition(powerUp.cell.x, powerUp.cell.z + 0.06, isTopDown ? 0.38 : 0.405)} options={{ width: isTopDown ? 0.08 : 0.1, height: isTopDown ? 0.08 : 0.06, depth: isTopDown ? 0.34 : 0.36 }}>
            {markerMaterial}
          </box>
          <box name={`powerup-marker-throw-arm-${powerUp.cell.x}-${powerUp.cell.z}`} position={cellPosition(powerUp.cell.x + 0.12, powerUp.cell.z - 0.1, isTopDown ? 0.38 : 0.405)} rotationY={Tools.ToRadians(-45)} options={{ width: isTopDown ? 0.08 : 0.1, height: isTopDown ? 0.08 : 0.06, depth: isTopDown ? 0.24 : 0.26 }}>
            {markerMaterial}
          </box>
        </>
      );
  }
}

function FeedbackPulse({ cue, onComplete }: { cue: FeedbackCue; onComplete: () => void; key?: number }) {
  const scene = useScene();
  const color = cue.kind === "pickup" ? "#86EFAC" : "#FCA5A5";
  const duration = cue.kind === "pickup" ? 520 : 680;

  useTimedMeshAnimation(scene, `feedback-${cue.id}`, duration, progress => {
    const mesh = scene.getMeshByName(`feedback-${cue.id}`);
    if (!mesh) {
      return;
    }
    mesh.scaling.x = 0.6 + progress * 1.5;
    mesh.scaling.z = 0.6 + progress * 1.5;
    mesh.scaling.y = 1 + Math.sin(progress * Math.PI) * 1.2;
    const material = mesh.material;
    if (material && "alpha" in material) {
      material.alpha = Math.max(0, 0.92 * (1 - progress));
    }
    if (progress >= 1) {
      onComplete();
    }
  });

  return (
    <torus
      name={`feedback-${cue.id}`}
      position={cellPosition(cue.cell.x, cue.cell.z, cue.kind === "pickup" ? 0.22 : 0.3)}
      rotationX={Tools.ToRadians(90)}
      options={{ diameter: cue.kind === "pickup" ? 0.68 : 0.82, thickness: cue.kind === "pickup" ? 0.06 : 0.09, tessellation: 48 }}
    >
      <standardMaterial
        name={`feedback-material-${cue.id}`}
        diffuseColor={Color3.FromHexString(color)}
        emissiveColor={Color3.FromHexString(color)}
        alpha={0.92}
      />
    </torus>
  );
}

function EnemyToken({
  enemy,
  isTopDown,
  visualStyle
}: {
  enemy: ActiveEnemy;
  isTopDown: boolean;
  visualStyle: VisualStyle;
  key?: string;
}) {
  const colorByType: Record<EnemyType, string> = {
    wanderer: "#EF4444",
    chaser: "#EC4899",
    ghost: "#A78BFA"
  };
  const color = colorByType[enemy.type];

  const bodyPosition = useSmoothEnemyPosition(enemy, 0.42);
  return (
    <>
      {isTopDown ? <EnemyTopDownMarker enemy={enemy} /> : null}
      {visualStyle === "toy_like" ? (
        <sphere name={`enemy-${enemy.id}`} position={bodyPosition} options={{ diameter: enemy.type === "ghost" ? 0.62 : 0.7, segments: 24 }}>
          <standardMaterial name={`enemy-material-${enemy.id}`} diffuseColor={Color3.FromHexString(color)} emissiveColor={Color3.FromHexString(isTopDown ? "#000000" : color)} specularColor={Color3.FromHexString(isTopDown ? "#000000" : "#FFFFFF")} alpha={enemy.type === "ghost" ? 0.82 : 1} />
        </sphere>
      ) : enemy.type === "chaser" ? (
        <box name={`enemy-${enemy.id}`} position={bodyPosition} rotationY={Tools.ToRadians(45)} options={{ width: 0.58, height: 0.58, depth: 0.58 }}>
          <standardMaterial name={`enemy-material-${enemy.id}`} diffuseColor={Color3.FromHexString(color)} emissiveColor={Color3.FromHexString(isTopDown ? "#000000" : color)} specularColor={Color3.FromHexString(isTopDown ? "#000000" : "#FFFFFF")} />
        </box>
      ) : enemy.type === "ghost" ? (
        <cylinder name={`enemy-${enemy.id}`} position={bodyPosition} options={{ height: 0.7, diameterTop: 0.28, diameterBottom: 0.62, tessellation: 24 }}>
          <standardMaterial name={`enemy-material-${enemy.id}`} diffuseColor={Color3.FromHexString(color)} emissiveColor={Color3.FromHexString(isTopDown ? "#000000" : color)} specularColor={Color3.FromHexString(isTopDown ? "#000000" : "#FFFFFF")} alpha={0.82} />
        </cylinder>
      ) : (
        <sphere name={`enemy-${enemy.id}`} position={bodyPosition} options={{ diameter: 0.62, segments: 20 }}>
          <standardMaterial name={`enemy-material-${enemy.id}`} diffuseColor={Color3.FromHexString(color)} emissiveColor={Color3.FromHexString(isTopDown ? "#000000" : color)} specularColor={Color3.FromHexString(isTopDown ? "#000000" : "#FFFFFF")} />
        </sphere>
      )}
      <EnemyDetails enemy={enemy} isTopDown={isTopDown} visualStyle={visualStyle} position={bodyPosition} />
    </>
  );
}

function DirectedExplosion({
  cue,
  wallSet,
  destructibleSet,
  isTopDown
}: {
  cue: ExplosionCue;
  wallSet: Set<string>;
  destructibleSet: Set<string>;
  isTopDown: boolean;
}) {
  const blast = {
    id: cue.id,
    cells: computeBlastReach({ x: cue.cell[0], z: cue.cell[1] }, directedExplosionRadius, wallSet, destructibleSet)
      .fireCells,
    style: cue.style
  };

  return isTopDown ? <TopDownBlastCells blast={blast} /> : <BlastCells blast={blast} />;
}

function TopDownBlastCells({ blast }: { blast: ActiveBlast; key?: number }) {
  const scene = useScene();
  const color = explosionColors[blast.style];
  const centerCell = blast.cells[0] ?? playerStart;

  useTimedMeshAnimation(scene, `topdown-blast-${blast.id}`, blastDurationMs, progress => {
    const fade = Math.max(0, 1 - progress);
    const pulse = 0.92 + Math.sin(progress * Math.PI) * 0.18;
    for (const mesh of scene.meshes) {
      if (!mesh.name.includes(`topdown-blast-${blast.id}`)) {
        continue;
      }
      mesh.scaling.x = pulse;
      mesh.scaling.z = pulse;
      const material = mesh.material;
      if (material && "alpha" in material) {
        material.alpha = Math.max(0, fade * 0.94);
      }
    }
  });

  return (
    <>
      <torus
        name={`topdown-blast-${blast.id}-ring`}
        position={cellPosition(centerCell.x, centerCell.z, 0.3)}
        rotationX={Tools.ToRadians(90)}
        options={{ diameter: 1.05, thickness: 0.08, tessellation: 40 }}
      >
        <standardMaterial
          name={`topdown-blast-ring-material-${blast.id}`}
          diffuseColor={Color3.FromHexString("#FDE047")}
          emissiveColor={Color3.FromHexString(color)}
          alpha={0.94}
        />
      </torus>
      {blast.cells.map((cell, index) => [
          <box
            key={`topdown-blast-outer-${blast.id}-${cell.x}-${cell.z}-${index}`}
            name={`topdown-blast-${blast.id}-outer-${cell.x}-${cell.z}-${index}`}
            position={cellPosition(cell.x, cell.z, 0.24)}
            options={{ width: 0.82, height: 0.05, depth: 0.82 }}
          >
            <standardMaterial
              name={`topdown-blast-outer-material-${blast.id}-${cell.x}-${cell.z}-${index}`}
              diffuseColor={Color3.FromHexString(color)}
              emissiveColor={Color3.FromHexString(color)}
              alpha={0.94}
            />
          </box>,
          <box
            key={`topdown-blast-core-x-${blast.id}-${cell.x}-${cell.z}-${index}`}
            name={`topdown-blast-${blast.id}-core-x-${cell.x}-${cell.z}-${index}`}
            position={cellPosition(cell.x, cell.z, 0.28)}
            options={{ width: 0.56, height: 0.03, depth: 0.18 }}
          >
            <standardMaterial
              name={`topdown-blast-core-x-material-${blast.id}-${cell.x}-${cell.z}-${index}`}
              diffuseColor={Color3.FromHexString("#FEF08A")}
              emissiveColor={Color3.FromHexString("#FDE047")}
              alpha={0.94}
            />
          </box>,
          <box
            key={`topdown-blast-core-z-${blast.id}-${cell.x}-${cell.z}-${index}`}
            name={`topdown-blast-${blast.id}-core-z-${cell.x}-${cell.z}-${index}`}
            position={cellPosition(cell.x, cell.z, 0.28)}
            options={{ width: 0.18, height: 0.03, depth: 0.56 }}
          >
            <standardMaterial
              name={`topdown-blast-core-z-material-${blast.id}-${cell.x}-${cell.z}-${index}`}
              diffuseColor={Color3.FromHexString("#FEF08A")}
              emissiveColor={Color3.FromHexString("#FDE047")}
              alpha={0.94}
            />
          </box>
      ])}
    </>
  );
}

function BlastCells({ blast }: { blast: ActiveBlast; key?: number }) {
  const scene = useScene();
  const color = explosionColors[blast.style];
  const centerCell = blast.cells[0] ?? playerStart;
  const centerPosition = cellPosition(centerCell.x, centerCell.z, 0.16);

  useTimedMeshAnimation(scene, `blast-${blast.id}`, blastDurationMs, progress => {
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

function EnergyGrid({ arena, visualStyle }: { arena: ArenaState; visualStyle: VisualStyle }) {
  const accent = arena.palette.accent;
  const secondary = arena.palette.secondary;
  const glow = visualStyle === "toy_like" ? 0.06 : visualStyle === "arcade_premium" ? 0.12 : arena.theme === "classic" ? 0.14 : 0.14;
  const emissive = visualStyle === "neon_cinematic" ? softenHex(accent, 0.34) : accent;

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
              emissiveColor={Color3.FromHexString(emissive)}
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
              emissiveColor={Color3.FromHexString(emissive)}
              alpha={glow}
            />
          </box>
        );
      })}
    </>
  );
}

function ArenaBeacon({ arena, visualStyle }: { arena: ArenaState; visualStyle: VisualStyle }) {
  const ringAlpha = visualStyle === "toy_like" ? 0.08 : visualStyle === "neon_cinematic" ? 0.14 : arena.theme === "classic" ? 0.08 : 0.16;
  const columnAlpha = visualStyle === "toy_like" ? 0.035 : visualStyle === "neon_cinematic" ? 0.06 : arena.theme === "classic" ? 0.035 : 0.07;

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
          emissiveColor={Color3.FromHexString(visualStyle === "neon_cinematic" ? softenHex(arena.palette.accent, 0.34) : arena.palette.accent)}
          alpha={ringAlpha}
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
          emissiveColor={Color3.FromHexString(visualStyle === "neon_cinematic" ? softenHex(arena.palette.accent, 0.28) : arena.palette.accent)}
          alpha={columnAlpha}
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
  const updateRef = useRef(update);

  useEffect(() => {
    updateRef.current = update;
  }, [update]);

  useEffect(() => {
    const start = performance.now();
    const observer = scene.onBeforeRenderObservable.add(() => {
      const progress = Math.min(1, (performance.now() - start) / durationMs);
      updateRef.current(progress);

      if (progress >= 1) {
        scene.onBeforeRenderObservable.remove(observer);
      }
    });

    return () => {
      scene.onBeforeRenderObservable.remove(observer);
    };
  }, [durationMs, key, scene]);
}

function configureOrthographicCamera(camera: ArcRotateCamera, scene: BabylonScene) {
  const minHalfBoard = 4.6;
  const maxHalfBoard = size / 2 + 1.2;
  let halfBoard = maxHalfBoard;

  const updateBounds = () => {
    const engine = scene.getEngine();
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    const halfHeight = aspect >= 1 ? halfBoard : halfBoard / aspect;
    const halfWidth = aspect >= 1 ? halfBoard * aspect : halfBoard;
    camera.orthoLeft = -halfWidth;
    camera.orthoRight = halfWidth;
    camera.orthoTop = halfHeight;
    camera.orthoBottom = -halfHeight;
  };

  updateBounds();
  const resizeObserver = scene.getEngine().onResizeObservable.add(updateBounds);
  const canvas = scene.getEngine().getRenderingCanvas();
  const handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    const zoomFactor = event.deltaY > 0 ? 1.12 : 0.88;
    halfBoard = Math.min(maxHalfBoard, Math.max(minHalfBoard, halfBoard * zoomFactor));
    camera.metadata = { ...(camera.metadata ?? {}), topDownHalfBoard: halfBoard, topDownMaxHalfBoard: maxHalfBoard };
    updateBounds();
  };

  camera.metadata = { ...(camera.metadata ?? {}), topDownHalfBoard: halfBoard, topDownMaxHalfBoard: maxHalfBoard };
  canvas?.addEventListener("wheel", handleWheel, { passive: false });
  camera.onDisposeObservable.add(() => {
    scene.getEngine().onResizeObservable.remove(resizeObserver);
    canvas?.removeEventListener("wheel", handleWheel);
  });
}

function topDownFollowProgress(camera: ArcRotateCamera) {
  const metadata = camera.metadata as { topDownHalfBoard?: number; topDownMaxHalfBoard?: number } | undefined;
  const halfBoard = metadata?.topDownHalfBoard;
  const maxHalfBoard = metadata?.topDownMaxHalfBoard;
  if (!halfBoard || !maxHalfBoard) {
    return 0;
  }

  const minHalfBoard = 4.6;
  return Math.min(1, Math.max(0, (maxHalfBoard - halfBoard) / (maxHalfBoard - minHalfBoard)));
}

function threeDPlayerBiasedTarget(camera: ArcRotateCamera, playerPosition: Vector3) {
  const forward = camera.target.subtract(camera.position);
  forward.y = 0;
  if (forward.lengthSquared() < 0.0001) {
    return threeDInitialTarget(playerPosition);
  }

  forward.normalize();
  return playerPosition.add(
    new Vector3(
      forward.x * threeDPlayerTargetForwardOffset,
      threeDPlayerTargetHeight,
      forward.z * threeDPlayerTargetForwardOffset
    )
  );
}

function threeDInitialTarget(playerPosition: Vector3) {
  const alpha = Tools.ToRadians(threeDDefaultCameraAlpha);
  const forward = new Vector3(-Math.cos(alpha), 0, -Math.sin(alpha));
  return playerPosition.add(
    new Vector3(
      forward.x * threeDPlayerTargetForwardOffset,
      threeDPlayerTargetHeight,
      forward.z * threeDPlayerTargetForwardOffset
    )
  );
}

function resolveMoveDirection(
  scene: BabylonScene,
  viewMode: ViewMode,
  command: MoveCommand
) {
  if (viewMode === "top_down") {
    return topDownDirection(command);
  }

  const camera = scene.activeCamera as ArcRotateCamera | null;
  if (!camera) {
    return topDownDirection(command);
  }

  const forward = camera.target.subtract(camera.position);
  forward.y = 0;
  if (forward.lengthSquared() < 0.0001) {
    return topDownDirection(command);
  }

  forward.normalize();
  const snappedForward = snapToGrid(forward);
  const snappedRight = { x: snappedForward.z, z: -snappedForward.x };

  switch (command) {
    case "forward":
      return snappedForward;
    case "backward":
      return { x: -snappedForward.x, z: -snappedForward.z };
    case "left":
      return { x: -snappedRight.x, z: -snappedRight.z };
    case "right":
      return snappedRight;
  }
}

function topDownDirection(command: MoveCommand) {
  switch (command) {
    case "forward":
      return { x: 0, z: -1 };
    case "backward":
      return { x: 0, z: 1 };
    case "left":
      return { x: 1, z: 0 };
    case "right":
      return { x: -1, z: 0 };
  }
}

function moveCommandForKey(key: string): MoveCommand | null {
  switch (key) {
    case "arrowup":
    case "w":
      return "forward";
    case "arrowdown":
    case "s":
      return "backward";
    case "arrowleft":
    case "a":
      return "left";
    case "arrowright":
    case "d":
      return "right";
    default:
      return null;
  }
}

function firstConnectedGamepad(): Gamepad | null {
  if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") {
    return null;
  }

  const gamepads = navigator.getGamepads();
  for (const gamepad of gamepads) {
    if (gamepad?.connected) {
      return gamepad;
    }
  }

  return null;
}

function gamepadMoveCommand(gamepad: Gamepad): MoveCommand | null {
  const dpadVertical = gamepadButtonPressed(gamepad, 12) ? -1 : gamepadButtonPressed(gamepad, 13) ? 1 : 0;
  const dpadHorizontal = gamepadButtonPressed(gamepad, 14) ? -1 : gamepadButtonPressed(gamepad, 15) ? 1 : 0;

  if (dpadVertical !== 0 || dpadHorizontal !== 0) {
    return Math.abs(dpadHorizontal) > Math.abs(dpadVertical)
      ? dpadHorizontal > 0
        ? "right"
        : "left"
      : dpadVertical > 0
        ? "backward"
        : "forward";
  }

  const x = gamepadAxis(gamepad, 0);
  const y = gamepadAxis(gamepad, 1);
  if (Math.max(Math.abs(x), Math.abs(y)) < gamepadMoveDeadZone) {
    return null;
  }

  if (Math.abs(x) > Math.abs(y)) {
    return x > 0 ? "right" : "left";
  }

  return y > 0 ? "backward" : "forward";
}

function applyGamepadCamera(scene: BabylonScene, viewMode: ViewMode, gamepad: Gamepad, elapsedSeconds: number) {
  if (viewMode === "top_down") {
    return;
  }

  const camera = scene.getCameraByName("arena-camera") as ArcRotateCamera | null;
  if (!camera) {
    return;
  }

  const x = gamepadAxis(gamepad, 2);
  const y = gamepadAxis(gamepad, 3);
  if (Math.max(Math.abs(x), Math.abs(y)) >= gamepadCameraDeadZone) {
    const speed = viewMode === "fps" ? gamepadCameraSpeedFps : gamepadCameraSpeed3D;
    camera.alpha -= applyAxisDeadZone(x, gamepadCameraDeadZone) * speed * elapsedSeconds;
    camera.beta = clamp(
      camera.beta - applyAxisDeadZone(y, gamepadCameraDeadZone) * speed * elapsedSeconds,
      camera.lowerBetaLimit ?? 0.01,
      camera.upperBetaLimit ?? Math.PI - 0.01
    );
  }

  const leftTrigger = gamepadButtonValue(gamepad, 6);
  const rightTrigger = gamepadButtonValue(gamepad, 7);
  const zoomIntent = applyTriggerDeadZone(leftTrigger - rightTrigger, gamepadZoomDeadZone);
  if (zoomIntent !== 0) {
    const zoomSpeed = viewMode === "fps" ? gamepadZoomSpeedFps : gamepadZoomSpeed3D;
    camera.radius = clamp(
      camera.radius + zoomIntent * zoomSpeed * elapsedSeconds,
      camera.lowerRadiusLimit ?? 0.1,
      camera.upperRadiusLimit ?? 100
    );
  }
}

function gamepadAxis(gamepad: Gamepad, index: number) {
  return gamepad.axes[index] ?? 0;
}

function applyAxisDeadZone(value: number, deadZone: number) {
  const magnitude = Math.abs(value);
  if (magnitude <= deadZone) {
    return 0;
  }

  return Math.sign(value) * ((magnitude - deadZone) / (1 - deadZone));
}

function gamepadButtonPressed(gamepad: Gamepad, index: number) {
  const button = gamepad.buttons[index];
  return Boolean(button?.pressed || (button?.value ?? 0) > 0.55);
}

function gamepadButtonValue(gamepad: Gamepad, index: number) {
  return gamepad.buttons[index]?.value ?? 0;
}

function applyTriggerDeadZone(value: number, deadZone: number) {
  const magnitude = Math.abs(value);
  if (magnitude <= deadZone) {
    return 0;
  }

  return Math.sign(value) * ((magnitude - deadZone) / (1 - deadZone));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function materialLookForView(
  kind: ArenaElementKind,
  look: MaterialLook,
  isTopDown: boolean,
  visualStyle: VisualStyle
): MaterialLook {
  if (!isTopDown) {
    if (visualStyle === "toy_like") {
      return {
        diffuse: softenHex(look.diffuse),
        emissive: "#000000",
        specular: "#FFFFFF",
        alpha: look.alpha
      };
    }

    if (visualStyle === "neon_cinematic") {
      const controlledNeonByKind: Record<ArenaElementKind, MaterialLook> = {
        floor: {
          diffuse: darkenHex(look.diffuse, 0.72),
          emissive: darkenHex(look.emissive, 0.62),
          specular: look.specular,
          alpha: look.alpha
        },
        wall: {
          diffuse: darkenHex(look.diffuse, 0.78),
          emissive: darkenHex(look.emissive, 0.56),
          specular: look.specular,
          alpha: look.alpha
        },
        crate: {
          diffuse: darkenHex(look.diffuse, 0.74),
          emissive: darkenHex(look.emissive, 0.52),
          specular: look.specular,
          alpha: look.alpha
        },
        bomb: {
          diffuse: look.diffuse,
          emissive: softenHex(look.emissive, 0.56),
          specular: look.specular,
          alpha: look.alpha
        }
      };

      return controlledNeonByKind[kind];
    }

    return look;
  }

  const topDownDiffuseByKind: Record<ArenaElementKind, string> = {
    floor: "#334155",
    wall: "#CBD5E1",
    crate: "#B45309",
    bomb: "#111827"
  };

  return {
    diffuse: topDownDiffuseByKind[kind],
    emissive: "#000000",
    specular: "#000000",
    alpha: 1
  };
}

function softenHex(hex: string, amount = 0.28) {
  const color = Color3.FromHexString(hex);
  const softened = new Color3(
    Math.min(1, color.r * (1 - amount) + amount),
    Math.min(1, color.g * (1 - amount) + amount),
    Math.min(1, color.b * (1 - amount) + amount)
  );
  return softened.toHexString();
}

function darkenHex(hex: string, factor: number) {
  const color = Color3.FromHexString(hex);
  return new Color3(color.r * factor, color.g * factor, color.b * factor).toHexString();
}

function topDownVisualPalette(arena: ArenaState | null, visualStyle: VisualStyle): TopDownVisualPalette {
  if (visualStyle === "toy_like") {
    return {
      floor: "#A7D79A",
      floorAccent: "#8CCB7B",
      wall: "#CBD5E1",
      wallLight: "#F8FAFC",
      wallShadow: "#64748B",
      crate: "#C08457",
      crateLight: "#F0C58A",
      crateDark: "#7C4A22",
      outline: "#334155",
      playerSuit: "#FFFFFF",
      playerFace: "#FDE7C2",
      playerTrim: "#60A5FA",
      playerGlove: "#FB7185",
      playerBoot: "#FB7185",
      bomb: "#334155",
      fuse: "#475569",
      ink: "#0F172A",
      panel: "#FFF7ED",
      wanderer: "#FB7185",
      chaser: "#F472B6",
      ghost: "#C4B5FD"
    };
  }

  if (visualStyle === "neon_cinematic") {
    return {
      floor: arena?.theme === "classic" ? "#08111A" : arena?.palette.primary ?? "#08111A",
      floorAccent: arena?.palette.secondary ?? "#164E63",
      wall: "#1E293B",
      wallLight: "#67E8F9",
      wallShadow: "#0F172A",
      crate: "#312E81",
      crateLight: "#F472B6",
      crateDark: "#111827",
      outline: "#020617",
      playerSuit: "#E0F2FE",
      playerFace: "#BAE6FD",
      playerTrim: "#22D3EE",
      playerGlove: "#F472B6",
      playerBoot: "#F472B6",
      bomb: "#111827",
      fuse: "#22D3EE",
      ink: "#020617",
      panel: "#F8FAFC",
      wanderer: "#FB7185",
      chaser: "#F472B6",
      ghost: "#A78BFA"
    };
  }

  return {
    floor: arena?.theme === "classic" ? "#08751E" : arena?.palette.primary ?? "#08751E",
    floorAccent: arena?.theme === "classic" ? "#075F19" : arena?.palette.secondary ?? "#075F19",
    wall: "#94A3B8",
    wallLight: "#CBD5E1",
    wallShadow: "#475569",
    crate: "#A16207",
    crateLight: "#D99B4E",
    crateDark: "#4B2C0F",
    outline: "#111827",
    playerSuit: "#F8FAFC",
    playerFace: "#FDE7B2",
    playerTrim: "#2563EB",
    playerGlove: "#F43F5E",
    playerBoot: "#F43F5E",
    bomb: "#6366A7",
    fuse: "#4B5563",
    ink: "#111827",
    panel: "#F8FAFC",
    wanderer: "#EF4444",
    chaser: "#EC4899",
    ghost: "#A78BFA"
  };
}

function crateVisualVariant(cell: Cell) {
  return {
    heightOffset: 0,
    rotationY: 0
  };
}

function powerUpDropForCell(cell: Cell): PowerUpType | null {
  const seed = Math.abs(cell.x * 11 + cell.z * 5 + cell.x * cell.x + cell.z * cell.z) % 23;
  if (seed <= 1) {
    return "bomb_capacity";
  }

  if (seed <= 3) {
    return "blast_radius";
  }

  if (seed === 4 || seed === 5) {
    return "speed_up";
  }

  if (seed === 6) {
    return "bomb_kick";
  }

  if (seed === 7) {
    return "throw_bomb";
  }

  return null;
}

function powerUpLook(type: PowerUpType) {
  switch (type) {
    case "bomb_capacity":
      return { color: "#22D3EE", diameter: 0.46, tessellation: 6 };
    case "blast_radius":
      return { color: "#F59E0B", diameter: 0.52, tessellation: 24 };
    case "speed_up":
      return { color: "#22C55E", diameter: 0.48, tessellation: 3 };
    case "bomb_kick":
      return { color: "#F43F5E", diameter: 0.5, tessellation: 4 };
    case "throw_bomb":
      return { color: "#A78BFA", diameter: 0.5, tessellation: 5 };
  }
}

function emitFeedback(
  events: Array<Pick<FeedbackCue, "kind" | "cell">>,
  setFeedbackCues: Dispatch<SetStateAction<FeedbackCue[]>>
) {
  if (events.length === 0) {
    return;
  }

  const now = Date.now();
  setFeedbackCues(current => [
    ...current,
    ...events.map((event, index) => ({
      id: now + index,
      ...event
    }))
  ]);
}

function playGameTone(kind: FeedbackCue["kind"]) {
  const AudioContextClass =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) {
    return;
  }

  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const now = context.currentTime;

  oscillator.type = kind === "pickup" ? "triangle" : "sawtooth";
  oscillator.frequency.setValueAtTime(kind === "pickup" ? 660 : 190, now);
  oscillator.frequency.exponentialRampToValueAtTime(kind === "pickup" ? 960 : 90, now + 0.18);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(kind === "pickup" ? 0.07 : 0.08, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (kind === "pickup" ? 0.22 : 0.28));

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + (kind === "pickup" ? 0.23 : 0.29));
  oscillator.addEventListener("ended", () => {
    void context.close();
  });
}

function bombWarningUrgency(progress: number) {
  return smoothStep(0.62, 1, progress);
}

function bombWarningPulse(progress: number) {
  const pulseCycles = 3.5 + progress * 7.5;
  return Math.sin(progress * Math.PI * pulseCycles);
}

function smoothStep(edge0: number, edge1: number, value: number) {
  const normalized = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return normalized * normalized * (3 - 2 * normalized);
}

function snapToGrid(vector: Vector3): Cell {
  if (Math.abs(vector.x) > Math.abs(vector.z)) {
    return { x: Math.sign(vector.x), z: 0 };
  }

  return { x: 0, z: Math.sign(vector.z) };
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

function createGeneratedLevel(): GeneratedLevel {
  const baseSeed = Math.floor((Date.now() + Math.random() * 0xffffffff) % 0xffffffff);
  const maxAttempts = 80;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const rng = createSeededRandom((baseSeed + attempt * 0x9e3779b9) >>> 0);
    const isRelaxedAttempt = attempt >= maxAttempts * 0.65;
    const fixedBlockDensity = isRelaxedAttempt
      ? fallbackFixedBlockDensity
      : randomBetween(rng, fixedBlockDensityMin, fixedBlockDensityMax);
    const destructibleDensity = isRelaxedAttempt
      ? fallbackDestructibleBlockDensity
      : randomBetween(rng, destructibleBlockDensityMin, destructibleBlockDensityMax);
    const wallCells = createRandomWallCells(rng, fixedBlockDensity);
    const wallSet = toCellSet(wallCells);
    const destructibleCells = createRandomDestructibleCells(wallSet, rng, destructibleDensity);
    const destructibleSet = toCellSet(destructibleCells);
    const enemies = createInitialEnemies(wallSet, destructibleSet, rng);

    if (
      enemies.length === initialEnemyCount &&
      isPassableAreaConnected(wallSet, new Set()) &&
      isPassableAreaConnected(wallSet, destructibleSet)
    ) {
      return {
        wallCells,
        destructibleCells,
        enemies
      };
    }
  }

  const fallbackRng = createSeededRandom(baseSeed ^ 0xa5a5a5a5);
  const wallCells = createRandomWallCells(fallbackRng, fallbackFixedBlockDensity);
  const wallSet = toCellSet(wallCells);
  const destructibleCells = createRandomDestructibleCells(wallSet, fallbackRng, fallbackDestructibleBlockDensity);
  const destructibleSet = toCellSet(destructibleCells);

  return {
    wallCells,
    destructibleCells,
    enemies: createInitialEnemies(wallSet, destructibleSet, fallbackRng)
  };
}

function createRandomWallCells(rng: () => number, density: number): Cell[] {
  const wallSet = new Set<string>();

  for (let x = 0; x < size; x += 1) {
    for (let z = 0; z < size; z += 1) {
      if (x === 0 || z === 0 || x === size - 1 || z === size - 1) {
        wallSet.add(cellKey({ x, z }));
      }
    }
  }

  for (const cell of shuffleCells(createInteriorCells(), rng)) {
    if (isSpawnSafeCell(cell) || rng() > density) {
      continue;
    }

    const key = cellKey(cell);
    wallSet.add(key);

    if (!isPassableAreaConnected(wallSet, new Set()) || createsOvertightWallPocket(cell, wallSet)) {
      wallSet.delete(key);
    }
  }

  return sortedCellsFromSet(wallSet);
}

function createRandomDestructibleCells(wallSet: Set<string>, rng: () => number, density: number): Cell[] {
  const destructibleSet = new Set<string>();

  for (const cell of shuffleCells(createInteriorCells(), rng)) {
    const key = cellKey(cell);
    if (wallSet.has(key) || isSpawnSafeCell(cell) || rng() > density) {
      continue;
    }

    destructibleSet.add(key);

    if (!isPassableAreaConnected(wallSet, destructibleSet)) {
      destructibleSet.delete(key);
    }
  }

  return sortedCellsFromSet(destructibleSet);
}

function createInitialEnemies(wallSet: Set<string>, destructibleSet: Set<string>, rng: () => number): ActiveEnemy[] {
  const now = performance.now();
  const distanceMap = computePathDistanceMap(playerStart, wallSet, destructibleSet);
  const candidateCells = createInteriorCells()
    .map(cell => ({
      cell,
      distance: distanceMap.get(cellKey(cell)) ?? -1,
      jitter: rng()
    }))
    .filter(({ cell, distance }) => {
      const key = cellKey(cell);
      return !wallSet.has(key) && !destructibleSet.has(key) && !isSpawnSafeCell(cell) && distance >= minEnemySpawnPathDistance;
    })
    .sort((a, b) => b.distance - a.distance || b.jitter - a.jitter)
    .map(candidate => candidate.cell);

  return selectSpreadCells(candidateCells, initialEnemyCount, rng).map((cell, index) => {
    const type = enemyTypeForIndex(index);
    return {
      id: `enemy-${index}`,
      type,
      cell,
      visualFromCell: cell,
      visualMoveStartedAt: now,
      visualMoveDurationMs: 0,
      direction: randomCardinalDirection(rng),
      nextMoveAt: now + 450 + index * 120
    };
  });
}

function createInteriorCells(): Cell[] {
  const cells: Cell[] = [];

  for (let x = 1; x < size - 1; x += 1) {
    for (let z = 1; z < size - 1; z += 1) {
      cells.push({ x, z });
    }
  }

  return cells;
}

function createSeededRandom(seed: number) {
  let state = seed >>> 0;

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomBetween(rng: () => number, min: number, max: number) {
  return min + rng() * (max - min);
}

function shuffleCells(cells: Cell[], rng: () => number) {
  const shuffled = [...cells];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function sortedCellsFromSet(cellSet: Set<string>) {
  return [...cellSet]
    .map(cellFromKey)
    .sort((a, b) => a.z - b.z || a.x - b.x);
}

function cellFromKey(key: string): Cell {
  const [x, z] = key.split(",").map(Number);
  return { x, z };
}

function createsOvertightWallPocket(cell: Cell, wallSet: Set<string>) {
  for (let dx = -1; dx <= 0; dx += 1) {
    for (let dz = -1; dz <= 0; dz += 1) {
      const square = [
        { x: cell.x + dx, z: cell.z + dz },
        { x: cell.x + dx + 1, z: cell.z + dz },
        { x: cell.x + dx, z: cell.z + dz + 1 },
        { x: cell.x + dx + 1, z: cell.z + dz + 1 }
      ];

      if (square.every(squareCell => wallSet.has(cellKey(squareCell)))) {
        return true;
      }
    }
  }

  return false;
}

function isPassableAreaConnected(wallSet: Set<string>, obstacleSet: Set<string>) {
  const distances = computePathDistanceMap(playerStart, wallSet, obstacleSet);
  let passableCells = 0;

  for (const cell of createInteriorCells()) {
    const key = cellKey(cell);
    if (!wallSet.has(key) && !obstacleSet.has(key)) {
      passableCells += 1;
    }
  }

  return passableCells > 0 && distances.size === passableCells;
}

function computePathDistanceMap(start: Cell, wallSet: Set<string>, obstacleSet: Set<string>) {
  const distances = new Map<string, number>();
  const startKey = cellKey(start);

  if (wallSet.has(startKey) || obstacleSet.has(startKey)) {
    return distances;
  }

  const queue: Cell[] = [start];
  distances.set(startKey, 0);

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    const currentDistance = distances.get(cellKey(current)) ?? 0;

    for (const direction of cardinalDirections()) {
      const next = { x: current.x + direction.x, z: current.z + direction.z };
      if (next.x < 1 || next.x >= size - 1 || next.z < 1 || next.z >= size - 1) {
        continue;
      }

      const nextKey = cellKey(next);
      if (wallSet.has(nextKey) || obstacleSet.has(nextKey) || distances.has(nextKey)) {
        continue;
      }

      distances.set(nextKey, currentDistance + 1);
      queue.push(next);
    }
  }

  return distances;
}

function selectSpreadCells(candidates: Cell[], count: number, rng: () => number) {
  for (const minimumSeparation of [7, 6, 5, 4, 3, 2, 0]) {
    const selected: Cell[] = [];
    const candidateOrder = minimumSeparation >= 4 ? candidates : shuffleCells(candidates, rng);

    for (const candidate of candidateOrder) {
      if (selected.every(selectedCell => manhattanDistance(selectedCell, candidate) >= minimumSeparation)) {
        selected.push(candidate);
      }

      if (selected.length === count) {
        return selected;
      }
    }
  }

  return candidates.slice(0, count);
}

function randomCardinalDirection(rng: () => number) {
  const directions = cardinalDirections();
  return directions[Math.floor(rng() * directions.length)];
}

function cardinalDirections(): Cell[] {
  return [
    { x: 1, z: 0 },
    { x: -1, z: 0 },
    { x: 0, z: 1 },
    { x: 0, z: -1 }
  ];
}

function enemyTypeForIndex(index: number): EnemyType {
  if (index === 1 || index === 4) {
    return "chaser";
  }

  if (index === 2) {
    return "ghost";
  }

  return "wanderer";
}

function enemyMoveIntervalMs(type: EnemyType) {
  switch (type) {
    case "chaser":
      return 560;
    case "ghost":
      return 720;
    case "wanderer":
      return 650;
  }
}

function enemyVisualMoveDurationMs(type: EnemyType) {
  return enemyMoveIntervalMs(type) * enemyVisualMoveDurationRatio;
}

function chooseEnemyDirection(
  enemy: ActiveEnemy,
  playerCell: Cell,
  wallSet: Set<string>,
  destructibleSet: Set<string>,
  bombSet: Set<string>,
  occupiedEnemyCells: Set<string>
): Cell | null {
  const directions = [
    { x: 1, z: 0 },
    { x: -1, z: 0 },
    { x: 0, z: 1 },
    { x: 0, z: -1 }
  ];

  const availableDirections = directions.filter(direction =>
    isEnemyDestinationFree(
      { x: enemy.cell.x + direction.x, z: enemy.cell.z + direction.z },
      enemy.type,
      wallSet,
      destructibleSet,
      bombSet,
      occupiedEnemyCells
    )
  );
  if (availableDirections.length === 0) {
    return null;
  }

  if (enemy.type === "chaser") {
    return availableDirections.sort((a, b) => {
      const distanceA = manhattanDistance({ x: enemy.cell.x + a.x, z: enemy.cell.z + a.z }, playerCell);
      const distanceB = manhattanDistance({ x: enemy.cell.x + b.x, z: enemy.cell.z + b.z }, playerCell);
      return distanceA - distanceB;
    })[0];
  }

  const forwardDirection = availableDirections.find(direction => sameCell(direction, enemy.direction));
  if (forwardDirection && enemy.type === "ghost") {
    return forwardDirection;
  }

  const seed = Math.abs(enemy.cell.x * 17 + enemy.cell.z * 29 + enemy.id.length * 13);
  return availableDirections[seed % availableDirections.length];
}

function isEnemyDestinationFree(
  cell: Cell,
  type: EnemyType,
  wallSet: Set<string>,
  destructibleSet: Set<string>,
  bombSet: Set<string>,
  occupiedEnemyCells: Set<string>
) {
  if (cell.x < 1 || cell.x >= size - 1 || cell.z < 1 || cell.z >= size - 1) {
    return false;
  }

  const key = cellKey(cell);
  return (
    !wallSet.has(key) &&
    (type === "ghost" || !destructibleSet.has(key)) &&
    !bombSet.has(key) &&
    !occupiedEnemyCells.has(key)
  );
}

function computeBlastReach(origin: Cell, radius: number, wallSet: Set<string>, destructibleSet: Set<string>): BlastReach {
  const fireCells = [origin];
  const destroyedCrateCells: Cell[] = [];
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

      if (destructibleSet.has(key)) {
        destroyedCrateCells.push(cell);
        break;
      }

      fireCells.push(cell);
    }
  }

  return {
    fireCells,
    destroyedCrateCells
  };
}

function isWalkable(cell: Cell, wallSet: Set<string>, destructibleSet: Set<string>, bombSet: Set<string>) {
  if (cell.x < 1 || cell.x >= size - 1 || cell.z < 1 || cell.z >= size - 1) {
    return false;
  }

  const key = cellKey(cell);
  return !wallSet.has(key) && !destructibleSet.has(key) && !bombSet.has(key);
}

function isPlayerWalkable(
  cell: Cell,
  wallSet: Set<string>,
  destructibleSet: Set<string>,
  bombSet: Set<string>,
  passableBombCellKeys: Set<string>
) {
  if (cell.x < 1 || cell.x >= size - 1 || cell.z < 1 || cell.z >= size - 1) {
    return false;
  }

  const key = cellKey(cell);
  return (
    !wallSet.has(key) &&
    !destructibleSet.has(key) &&
    (!bombSet.has(key) || passableBombCellKeys.has(key))
  );
}

function keepExistingBombKeys(candidateKeys: Set<string>, existingBombKeys: Set<string>) {
  return new Set([...candidateKeys].filter(key => existingBombKeys.has(key)));
}

function isBombTravelCellFree(
  cell: Cell,
  wallSet: Set<string>,
  destructibleSet: Set<string>,
  bombSet: Set<string>,
  ignoredBombCell: Cell
) {
  if (cell.x < 1 || cell.x >= size - 1 || cell.z < 1 || cell.z >= size - 1) {
    return false;
  }

  const key = cellKey(cell);
  const ignoredKey = cellKey(ignoredBombCell);
  return !wallSet.has(key) && !destructibleSet.has(key) && (!bombSet.has(key) || key === ignoredKey);
}

function findThrownBombLandingCell(
  origin: Cell,
  direction: Cell,
  wallSet: Set<string>,
  destructibleSet: Set<string>,
  bombSet: Set<string>
) {
  for (let distance = 3; distance >= 1; distance -= 1) {
    const candidate = { x: origin.x + direction.x * distance, z: origin.z + direction.z * distance };
    if (isWalkable(candidate, wallSet, destructibleSet, bombSet)) {
      return candidate;
    }
  }

  return null;
}

function isCellInActiveBlast(cell: Cell, blasts: ActiveBlast[]) {
  return blasts.some(blast => blast.cells.some(blastCell => sameCell(blastCell, cell)));
}

function enemyOccupiesCell(cell: Cell, enemies: ActiveEnemy[]) {
  const now = performance.now();
  return enemies.some(enemy => sameCell(enemyCollisionCell(enemy, now), cell));
}

function manhattanDistance(a: Cell, b: Cell) {
  return Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
}

function isSpawnSafeCell(cell: Cell) {
  const frontSpawn = Math.abs(cell.x - center) <= 2 && cell.z >= size - 4;
  return frontSpawn;
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
    case "toy_world":
      return "pop_cross";
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

function playerTopDownPointerPosition(position: Vector3, direction: Cell) {
  return new Vector3(position.x + direction.x * 0.54, 0.13, position.z + direction.z * 0.54);
}

function directionYaw(direction: Cell) {
  return direction.x !== 0 ? Tools.ToRadians(90) : 0;
}

function nearestCellFromPosition(position: Vector3): Cell {
  return {
    x: Math.min(size - 1, Math.max(0, Math.round(position.x + center))),
    z: Math.min(size - 1, Math.max(0, Math.round(position.z + center)))
  };
}

function canAdvanceFromPosition(
  position: Vector3,
  direction: Cell,
  enterableCellInDirection: (cell: Cell, direction: Cell) => boolean
) {
  const currentCell = nearestCellFromPosition(position);
  if (isMovingTowardCellCenter(position, currentCell, direction)) {
    return true;
  }

  return enterableCellInDirection({ x: currentCell.x + direction.x, z: currentCell.z + direction.z }, direction);
}

type MovementAxis = "x" | "z";

function playerLaneAxis(position: Vector3): MovementAxis | null {
  const gridX = position.x + center;
  const gridZ = position.z + center;
  const epsilon = 0.0001;
  const xOffset = Math.abs(gridX - Math.round(gridX));
  const zOffset = Math.abs(gridZ - Math.round(gridZ));

  if (xOffset > epsilon) {
    return "x";
  }

  if (zOffset > epsilon) {
    return "z";
  }

  return null;
}

function directionAxis(direction: Cell): MovementAxis {
  return direction.x !== 0 ? "x" : "z";
}

function isPerpendicularDirection(a: Cell, b: Cell) {
  return directionAxis(a) !== directionAxis(b);
}

function directionTowardCellCenter(position: Vector3, cell: Cell, axis: MovementAxis): Cell | null {
  const gridX = position.x + center;
  const gridZ = position.z + center;
  const epsilon = 0.0001;

  if (axis === "x") {
    const deltaX = cell.x - gridX;
    if (Math.abs(deltaX) <= epsilon) {
      return null;
    }
    return { x: Math.sign(deltaX), z: 0 };
  }

  const deltaZ = cell.z - gridZ;
  if (Math.abs(deltaZ) <= epsilon) {
    return null;
  }
  return { x: 0, z: Math.sign(deltaZ) };
}

function nearestTurnableCell(
  position: Vector3,
  laneAxis: MovementAxis,
  turnDirection: Cell,
  wallSet: Set<string>,
  destructibleSet: Set<string>,
  bombSet: Set<string>,
  passableBombCellKeys: Set<string>
) {
  const candidates = adjacentLaneCellsFromPosition(position, laneAxis)
    .filter(cell => isPlayerWalkable(cell, wallSet, destructibleSet, bombSet, passableBombCellKeys))
    .filter(cell =>
      isPlayerWalkable(
        { x: cell.x + turnDirection.x, z: cell.z + turnDirection.z },
        wallSet,
        destructibleSet,
        bombSet,
        passableBombCellKeys
      )
    )
    .sort((a, b) => distanceToCellCenter(position, a, laneAxis) - distanceToCellCenter(position, b, laneAxis));

  return candidates[0] ?? null;
}

function adjacentLaneCellsFromPosition(position: Vector3, laneAxis: MovementAxis) {
  const gridX = position.x + center;
  const gridZ = position.z + center;

  if (laneAxis === "x") {
    const leftX = Math.floor(gridX);
    const rightX = Math.ceil(gridX);
    return uniqueCells([
      { x: leftX, z: Math.round(gridZ) },
      { x: rightX, z: Math.round(gridZ) }
    ]);
  }

  const upperZ = Math.floor(gridZ);
  const lowerZ = Math.ceil(gridZ);
  return uniqueCells([
    { x: Math.round(gridX), z: upperZ },
    { x: Math.round(gridX), z: lowerZ }
  ]);
}

function distanceToCellCenter(position: Vector3, cell: Cell, axis: MovementAxis) {
  if (axis === "x") {
    return Math.abs(cell.x - (position.x + center));
  }

  return Math.abs(cell.z - (position.z + center));
}

function uniqueCells(cells: Cell[]) {
  const seen = new Set<string>();
  return cells.filter(cell => {
    const key = cellKey(cell);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function distanceToCurrentCellCenter(position: Vector3, cell: Cell, direction: Cell) {
  if (direction.x !== 0) {
    return Math.abs(cell.x - (position.x + center));
  }

  return Math.abs(cell.z - (position.z + center));
}

function movePlayerContinuously(
  position: Vector3,
  direction: Cell,
  distance: number,
  enterableCellInDirection: (cell: Cell, direction: Cell) => boolean
) {
  let remainingDistance = distance;

  while (remainingDistance > 0.0001) {
    const currentCell = nearestCellFromPosition(position);
    const distanceToCenter = distanceToCellCenterAlongDirection(position, currentCell, direction);

    if (distanceToCenter > 0.0001) {
      const step = Math.min(remainingDistance, distanceToCenter);
      translatePosition(position, direction, step);
      remainingDistance -= step;
      continue;
    }

    const nextCell = { x: currentCell.x + direction.x, z: currentCell.z + direction.z };
    if (!enterableCellInDirection(nextCell, direction)) {
      return;
    }

    const step = Math.min(remainingDistance, 0.5);
    translatePosition(position, direction, step);
    remainingDistance -= step;
  }
}

function isMovingTowardCellCenter(position: Vector3, cell: Cell, direction: Cell) {
  return distanceToCellCenterAlongDirection(position, cell, direction) > 0.0001;
}

function distanceToCellCenterAlongDirection(position: Vector3, cell: Cell, direction: Cell) {
  const gridX = position.x + center;
  const gridZ = position.z + center;
  if (direction.x > 0) {
    return Math.max(0, cell.x - gridX);
  }
  if (direction.x < 0) {
    return Math.max(0, gridX - cell.x);
  }
  if (direction.z > 0) {
    return Math.max(0, cell.z - gridZ);
  }
  return Math.max(0, gridZ - cell.z);
}

function translatePosition(position: Vector3, direction: Cell, distance: number) {
  lockPositionToLaneCenter(position, direction);
  position.x += direction.x * distance;
  position.z += direction.z * distance;
}

function lockPositionToLaneCenter(position: Vector3, direction: Cell) {
  if (direction.x !== 0) {
    position.z = Math.round(position.z + center) - center;
    return;
  }

  position.x = Math.round(position.x + center) - center;
}
