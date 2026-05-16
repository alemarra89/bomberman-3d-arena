import { Camera, Color3, Color4, GlowLayer, Tools, Vector3 } from "@babylonjs/core";
import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Scene as BabylonScene } from "@babylonjs/core/scene";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { ArenaState, ExplosionCue, ExplosionStyle, ViewMode } from "../types";

interface ArenaContentProps {
  arena: ArenaState;
  viewMode: ViewMode;
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
  radius: number;
}

interface ActiveBlast {
  id: number;
  cells: Cell[];
  style: ExplosionStyle;
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
  direction: Cell;
  nextMoveAt: number;
}

interface ActivePlayerMove {
  id: number;
  from: Cell;
  to: Cell;
}

const size = 23;
const center = (size - 1) / 2;
const playerStart: Cell = { x: center, z: size - 2 };
const bombFuseMs = 3000;
const initialBlastRadius = 1;
const directedExplosionRadius = 3;
const basePlayerMoveDurationMs = 400;
const minimumPlayerMoveDurationMs = 220;
const speedUpStepMs = 35;
const playerInputPollMs = 16;
const playerTurnBufferMs = 180;
const initialBombCapacity = 1;
const enemyTickMs = 80;

export function ArenaContent({ arena, viewMode, onHudChange }: ArenaContentProps) {
  const scene = useScene();
  const floor = floorLooks[arena.floor];
  const walls = wallLooks[arena.walls];
  const crates = crateLooks[arena.crates];
  const bomb = bombLooks[arena.bomb];
  const lighting = lightingColors[arena.lighting];
  const isTopDown = viewMode === "top_down";
  const floorMaterial = materialLookForView("floor", floor, isTopDown);
  const wallMaterial = materialLookForView("wall", walls, isTopDown);
  const crateMaterial = materialLookForView("crate", crates, isTopDown);
  const bombMaterial = materialLookForView("bomb", bomb, isTopDown);

  const wallCells = useMemo(() => createWallCells(), []);
  const wallSet = useMemo(() => toCellSet(wallCells), [wallCells]);
  const floorCells = useMemo(() => createFloorCells(), []);
  const initialDestructibles = useMemo(() => createDestructibleCells(wallSet), [wallSet]);
  const initialDestructibleSet = useMemo(() => toCellSet(initialDestructibles), [initialDestructibles]);
  const initialEnemies = useMemo(() => createInitialEnemies(wallSet, initialDestructibleSet), [initialDestructibleSet, wallSet]);

  const [playerCell, setPlayerCell] = useState<Cell>(playerStart);
  const [activePlayerMove, setActivePlayerMove] = useState<ActivePlayerMove | null>(null);
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
  const bombCellSetRef = useRef<Set<string>>(new Set());
  const bombTimerIdsRef = useRef<Map<number, number>>(new Map());
  const bombsRef = useRef<ActiveBomb[]>([]);
  const blastsRef = useRef<ActiveBlast[]>([]);
  const destructibleCellsRef = useRef(destructibleCells);
  const powerUpsRef = useRef<ActivePowerUp[]>([]);
  const enemiesRef = useRef<ActiveEnemy[]>(initialEnemies);
  const playerVisualPositionRef = useRef(cellPosition(playerStart.x, playerStart.z, 0.44));
  const playerCellRef = useRef(playerStart);
  const activePlayerMoveRef = useRef<ActivePlayerMove | null>(null);
  const playerMoveIdRef = useRef(0);
  const heldMoveCommandsRef = useRef<Map<string, MoveCommand>>(new Map());
  const bufferedMoveRef = useRef<{ command: MoveCommand; expiresAt: number } | null>(null);
  const gameStartedAtRef = useRef(performance.now());
  const gameEndedAtRef = useRef<number | null>(null);
  const gameStatusRef = useRef<GameStatus>("playing");
  const lastPlayerDirectionRef = useRef<Cell>({ x: 0, z: -1 });
  const playerMoveDurationMs = Math.max(minimumPlayerMoveDurationMs, basePlayerMoveDurationMs - speedLevel * speedUpStepMs);

  useSceneRuntime(scene, arena);

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
    bufferedMoveRef.current = null;
    activePlayerMoveRef.current = null;
    setActivePlayerMove(null);
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
        const activeBomb = pendingBombs.shift();
        if (!activeBomb || explodedIds.has(activeBomb.id)) {
          continue;
        }

        const stillActive = nextBombs.some(currentBomb => currentBomb.id === activeBomb.id);
        if (!stillActive) {
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
        const blastCells = computeBlastCells(activeBomb.cell, activeBomb.radius, wallSet, currentDestructibleSet);
        const blastCellKeys = new Set(blastCells.map(cellKey));
        const destroyedCrates = nextDestructibles.filter(cell => blastCellKeys.has(cellKey(cell)));
        const currentPlayerCell = nearestCellFromPosition(playerVisualPositionRef.current);

        nextDestructibles = nextDestructibles.filter(cell => !blastCellKeys.has(cellKey(cell)));
        nextPowerUps = [
          ...nextPowerUps.filter(powerUp => !blastCellKeys.has(cellKey(powerUp.cell))),
          ...destroyedCrates.flatMap(cell => {
            const drop = powerUpDropForCell(cell);
            return drop ? [{ id: `powerup-${cell.x}-${cell.z}`, cell, type: drop }] : [];
          })
        ];
        nextEnemies = nextEnemies.filter(enemy => !blastCellKeys.has(cellKey(enemy.cell)));
        playerWasHit ||= blastCellKeys.has(cellKey(currentPlayerCell));

        nextBlasts.push({
          id: activeBomb.id,
          cells: blastCells,
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
        }, 1500);
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

    const activeBomb: ActiveBomb = {
      id: Date.now(),
      cell: currentPlayerCell,
      explodeAt: performance.now() + bombFuseMs,
      radius: blastRadius
    };

    const nextBombs = [...bombsRef.current, activeBomb];
    bombsRef.current = nextBombs;
    setBombs(nextBombs);

    const timerId = window.setTimeout(() => {
      explodeBombCascade(activeBomb);
    }, bombFuseMs);

    bombTimerIdsRef.current.set(activeBomb.id, timerId);
  }, [blastRadius, bombCapacity, explodeBombCascade]);

  const relocateBomb = useCallback(
    (bombToMove: ActiveBomb, destination: Cell) => {
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

  const startPlayerMoveFromCell = useCallback(
    (from: Cell, direction: Cell) => {
      if (gameStatusRef.current !== "playing") {
        return false;
      }

      const to = { x: from.x + direction.x, z: from.z + direction.z };
      const destinationHasBomb = bombSetRef.current.has(cellKey(to));
      if (destinationHasBomb && (!canKickBombs || !tryKickBomb(to, direction))) {
        return false;
      }

      if (!isWalkable(to, wallSet, destructibleSetRef.current, bombSetRef.current)) {
        return false;
      }

      const move = {
        id: playerMoveIdRef.current + 1,
        from,
        to
      };
      playerMoveIdRef.current = move.id;
      activePlayerMoveRef.current = move;
      lastPlayerDirectionRef.current = direction;
      setActivePlayerMove(move);
      return true;
    },
    [canKickBombs, tryKickBomb, wallSet]
  );

  const collectPowerUpAtCell = useCallback((cell: Cell) => {
    const collectedPowerUp = powerUpsRef.current.find(powerUp => sameCell(powerUp.cell, cell));
    if (!collectedPowerUp) {
      return;
    }

    const nextPowerUps = powerUpsRef.current.filter(powerUp => powerUp.id !== collectedPowerUp.id);
    powerUpsRef.current = nextPowerUps;
    setPowerUps(nextPowerUps);
    setCollectedPowerUps(currentCount => currentCount + 1);

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

  const tryStartRequestedMoveFromCell = useCallback(
    (from: Cell) => {
      if (activePlayerMoveRef.current) {
        return false;
      }
      const now = performance.now();
      const bufferedMove =
        bufferedMoveRef.current && bufferedMoveRef.current.expiresAt >= now ? bufferedMoveRef.current : null;
      if (bufferedMoveRef.current && !bufferedMove) {
        bufferedMoveRef.current = null;
      }

      const heldCommand = Array.from(heldMoveCommandsRef.current.values()).at(-1);
      const candidateCommands = [bufferedMove?.command, heldCommand].filter(
        (command, index, commands): command is MoveCommand =>
          command !== undefined && commands.indexOf(command) === index
      );

      for (const command of candidateCommands) {
        const didMove = startPlayerMoveFromCell(from, resolveMoveDirection(scene, viewMode, command));
        if (didMove) {
          if (bufferedMove?.command === command) {
            bufferedMoveRef.current = null;
          }
          return true;
        }
      }

      return false;
    },
    [scene, startPlayerMoveFromCell, viewMode]
  );

  const completePlayerMove = useCallback(
    (move: ActivePlayerMove) => {
      if (activePlayerMoveRef.current?.id !== move.id) {
        return;
      }

      playerCellRef.current = move.to;
      activePlayerMoveRef.current = null;
      setPlayerCell(move.to);
      collectPowerUpAtCell(move.to);

      if (isCellInActiveBlast(move.to, blastsRef.current) || enemyOccupiesCell(move.to, enemiesRef.current)) {
        finishGame("lost");
        return;
      }

      if (!tryStartRequestedMoveFromCell(move.to)) {
        setActivePlayerMove(null);
      }
    },
    [collectPowerUpAtCell, finishGame, tryStartRequestedMoveFromCell]
  );

  useEffect(() => {
    const canvas = document.getElementById("reactylon-canvas") as HTMLCanvasElement | null;
    canvas?.setAttribute("tabindex", "0");
    let movementTimerId: number | null = null;

    const focusCanvas = () => {
      canvas?.focus();
    };

    canvas?.addEventListener("pointerdown", focusCanvas);

    const moveHeldDirection = () => {
      if (!tryStartRequestedMoveFromCell(playerCellRef.current)) {
        stopMovementTimerIfIdle();
      }
    };

    const stopMovementTimerIfIdle = () => {
      const bufferedMove = bufferedMoveRef.current;
      const hasValidBufferedMove = bufferedMove !== null && bufferedMove.expiresAt >= performance.now();
      if (heldMoveCommandsRef.current.size || hasValidBufferedMove || movementTimerId === null) {
        return;
      }

      window.clearInterval(movementTimerId);
      movementTimerId = null;
    };

    const clearHeldMovement = () => {
      heldMoveCommandsRef.current.clear();
      bufferedMoveRef.current = null;
      stopMovementTimerIfIdle();
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
        bufferedMoveRef.current = {
          command: moveCommand,
          expiresAt: performance.now() + playerTurnBufferMs
        };
        if (!heldMoveCommandsRef.current.has(key)) {
          heldMoveCommandsRef.current.set(key, moveCommand);
          moveHeldDirection();
        }

        if (movementTimerId === null) {
          movementTimerId = window.setInterval(moveHeldDirection, playerInputPollMs);
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
      stopMovementTimerIfIdle();
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
  }, [placeBomb, throwBomb, tryStartRequestedMoveFromCell]);

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
        const movedEnemy = {
          ...enemy,
          cell: nextCell,
          direction: nextDirection ?? enemy.direction,
          nextMoveAt: now + enemyMoveIntervalMs(enemy.type)
        };
        occupiedEnemyCells.add(cellKey(movedEnemy.cell));
        return movedEnemy;
      });

      enemiesRef.current = nextEnemies;
      setEnemies(nextEnemies);

      const playerCurrentCell = nearestCellFromPosition(playerVisualPositionRef.current);
      const enemyTouchedPlayer = nextEnemies.some(enemy => sameCell(enemy.cell, playerCurrentCell));
      if (
        enemyTouchedPlayer ||
        nextEnemies.some(enemy => isCellInActiveBlast(enemy.cell, blastsRef.current))
      ) {
        const survivingEnemies = nextEnemies.filter(enemy => !isCellInActiveBlast(enemy.cell, blastsRef.current));
        if (survivingEnemies.length !== nextEnemies.length) {
          enemiesRef.current = survivingEnemies;
          setEnemies(survivingEnemies);
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
      <ArenaCamera viewMode={viewMode} playerCell={playerCell} />
      <hemisphericLight
        name="ambient-light"
        direction={new Vector3(0, 1, 0)}
        diffuse={Color3.FromHexString(lighting.diffuse)}
        groundColor={Color3.FromHexString(lighting.ground)}
        intensity={isTopDown ? 1 : 0.82}
      />
      {!isTopDown ? (
        <>
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
        </>
      ) : null}

      {floorCells.map(cell => (
        <box
          key={`floor-${cell.x}-${cell.z}-${arena.floor}`}
          name={`floor-${cell.x}-${cell.z}`}
          position={cellPosition(cell.x, cell.z, -0.07)}
          options={{ width: 0.94, height: 0.14, depth: 0.94 }}
        >
          <standardMaterial
            name={`floor-material-${cell.x}-${cell.z}`}
            diffuseColor={Color3.FromHexString(floorMaterial.diffuse)}
            emissiveColor={Color3.FromHexString(floorMaterial.emissive)}
            specularColor={Color3.FromHexString(floorMaterial.specular)}
            alpha={floorMaterial.alpha ?? 1}
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
            diffuseColor={Color3.FromHexString(wallMaterial.diffuse)}
            emissiveColor={Color3.FromHexString(wallMaterial.emissive)}
            specularColor={Color3.FromHexString(wallMaterial.specular)}
            alpha={wallMaterial.alpha ?? 1}
          />
        </box>
      ))}

      {destructibleCells.map(cell => {
        const crateVariant = crateVisualVariant(cell);

        return (
          <box
            key={`crate-${cell.x}-${cell.z}-${arena.crates}`}
            name={`destructible-${cell.x}-${cell.z}`}
            position={cellPosition(cell.x, cell.z, 0.34 + (isTopDown ? 0 : crateVariant.heightOffset))}
            rotationY={isTopDown ? 0 : crateVariant.rotationY}
            options={{ width: 0.74, height: 0.72, depth: 0.74 }}
          >
            <standardMaterial
              name={`crate-material-${cell.x}-${cell.z}`}
              diffuseColor={Color3.FromHexString(crateMaterial.diffuse)}
              emissiveColor={Color3.FromHexString(crateMaterial.emissive)}
              specularColor={Color3.FromHexString(crateMaterial.specular)}
              alpha={crateMaterial.alpha ?? 1}
            />
          </box>
        );
      })}

      {bombs.map(activeBomb => (
        <sphere
          key={`bomb-${activeBomb.id}-${arena.bomb}`}
          name={`bomb-${activeBomb.id}`}
          position={cellPosition(activeBomb.cell.x, activeBomb.cell.z, 0.4)}
          options={{ diameter: 0.66, segments: 32 }}
        >
          <standardMaterial
            name={`bomb-material-${activeBomb.id}`}
            diffuseColor={Color3.FromHexString(bombMaterial.diffuse)}
            emissiveColor={Color3.FromHexString(bombMaterial.emissive)}
            specularColor={Color3.FromHexString(bombMaterial.specular)}
          />
        </sphere>
      ))}

      {powerUps.map(powerUp => (
        <PowerUpToken key={powerUp.id} powerUp={powerUp} isTopDown={isTopDown} />
      ))}

      {enemies.map(enemy => (
        <EnemyToken key={enemy.id} enemy={enemy} isTopDown={isTopDown} />
      ))}

      <Player
        cell={playerCell}
        activeMove={activePlayerMove}
        arena={arena}
        isTopDown={isTopDown}
        moveDurationMs={playerMoveDurationMs}
        visualPositionRef={playerVisualPositionRef}
        onMoveComplete={completePlayerMove}
      />
      {!isTopDown ? <ParticleMotes arena={arena} /> : null}
      {blasts.map(blast => (
        <BlastCells key={blast.id} blast={blast} />
      ))}
      {arena.explosion ? <DirectedExplosion cue={arena.explosion} wallSet={wallSet} destructibleSet={destructibleSet} /> : null}
    </>
  );
}

const ArenaCamera = memo(function ArenaCamera({
  viewMode,
  playerCell
}: {
  viewMode: ViewMode;
  playerCell: Cell;
}) {
  const scene = useScene();
  const playerTarget = cellPosition(playerCell.x, playerCell.z, 0.68);

  useEffect(() => {
    const camera = scene.getCameraByName("arena-camera") as ArcRotateCamera | null;
    if (!camera || viewMode !== "fps") {
      return;
    }

    camera.setTarget(playerTarget);
  }, [playerTarget, scene, viewMode]);

  return (
    <arcRotateCamera
      key={viewMode}
      name="arena-camera"
      alpha={viewMode === "top_down" ? Tools.ToRadians(-90) : Tools.ToRadians(45)}
      beta={viewMode === "top_down" ? 0.01 : Tools.ToRadians(56)}
      radius={viewMode === "fps" ? 3.4 : viewMode === "top_down" ? 31 : 29}
      target={viewMode === "fps" ? playerTarget : new Vector3(0, 0, 0)}
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
        camera.wheelDeltaPercentage = viewMode === "fps" ? 0.045 : 0.024;
        camera.lowerRadiusLimit = viewMode === "fps" ? 0.7 : 18;
        camera.upperRadiusLimit = viewMode === "fps" ? 6 : 33;
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
}, areArenaCameraPropsEqual);

function areArenaCameraPropsEqual(
  previous: { viewMode: ViewMode; playerCell: Cell },
  next: { viewMode: ViewMode; playerCell: Cell }
) {
  if (previous.viewMode !== next.viewMode) {
    return false;
  }

  if (next.viewMode !== "fps") {
    return true;
  }

  return sameCell(previous.playerCell, next.playerCell);
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
  cell,
  activeMove,
  arena,
  isTopDown,
  moveDurationMs,
  visualPositionRef,
  onMoveComplete
}: {
  cell: Cell;
  activeMove: ActivePlayerMove | null;
  arena: ArenaState;
  isTopDown: boolean;
  moveDurationMs: number;
  visualPositionRef: { current: Vector3 };
  onMoveComplete: (move: ActivePlayerMove) => void;
}) {
  const scene = useScene();
  const bodyPositionRef = useRef(cellPosition(cell.x, cell.z, 0.44));
  const headPositionRef = useRef(cellPosition(cell.x, cell.z, 0.86));

  useEffect(() => {
    const body = scene.getMeshByName("player-body");
    const head = scene.getMeshByName("player-head");
    if (!activeMove) {
      const settledBodyPosition = cellPosition(cell.x, cell.z, 0.44);
      const settledHeadPosition = cellPosition(cell.x, cell.z, 0.86);

      if (!body || !head) {
        bodyPositionRef.current.copyFrom(settledBodyPosition);
        headPositionRef.current.copyFrom(settledHeadPosition);
        visualPositionRef.current.copyFrom(settledBodyPosition);
      }

      return;
    }

    const startBodyPosition = cellPosition(activeMove.from.x, activeMove.from.z, 0.44);
    const startHeadPosition = cellPosition(activeMove.from.x, activeMove.from.z, 0.86);
    const targetBodyPosition = cellPosition(activeMove.to.x, activeMove.to.z, 0.44);
    const targetHeadPosition = cellPosition(activeMove.to.x, activeMove.to.z, 0.86);

    if (!body || !head) {
      bodyPositionRef.current.copyFrom(targetBodyPosition);
      headPositionRef.current.copyFrom(targetHeadPosition);
      visualPositionRef.current.copyFrom(targetBodyPosition);
      onMoveComplete(activeMove);
      return;
    }

    const start = performance.now();

    const observer = scene.onBeforeRenderObservable.add(() => {
      const progress = Math.min(1, (performance.now() - start) / moveDurationMs);
      const bodyPosition = Vector3.Lerp(startBodyPosition, targetBodyPosition, progress);
      const headPosition = Vector3.Lerp(startHeadPosition, targetHeadPosition, progress);

      body.position.copyFrom(bodyPosition);
      head.position.copyFrom(headPosition);
      bodyPositionRef.current.copyFrom(body.position);
      headPositionRef.current.copyFrom(head.position);
      visualPositionRef.current.copyFrom(body.position);

      if (progress >= 1) {
        scene.onBeforeRenderObservable.remove(observer);
        onMoveComplete(activeMove);
      }
    });

    return () => {
      scene.onBeforeRenderObservable.remove(observer);
    };
  }, [activeMove, cell.x, cell.z, moveDurationMs, onMoveComplete, scene, visualPositionRef]);

  return (
    <>
      <sphere
        name="player-body"
        position={bodyPositionRef.current}
        options={{ diameter: 0.58, segments: 32 }}
      >
        <standardMaterial
          name="player-body-material"
          diffuseColor={Color3.FromHexString("#F8FAFC")}
          emissiveColor={Color3.FromHexString(isTopDown ? "#000000" : arena.palette.accent)}
          specularColor={Color3.FromHexString(isTopDown ? "#000000" : "#FFFFFF")}
        />
      </sphere>
      <sphere
        name="player-head"
        position={headPositionRef.current}
        options={{ diameter: 0.34, segments: 24 }}
      >
        <standardMaterial
          name="player-head-material"
          diffuseColor={Color3.FromHexString("#111827")}
          emissiveColor={Color3.FromHexString(isTopDown ? "#000000" : arena.palette.secondary)}
          specularColor={Color3.FromHexString(isTopDown ? "#000000" : "#FFFFFF")}
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

function PowerUpToken({ powerUp, isTopDown }: { powerUp: ActivePowerUp; isTopDown: boolean; key?: string }) {
  const look = powerUpLook(powerUp.type);

  return (
    <cylinder
      name={`powerup-${powerUp.type}-${powerUp.cell.x}-${powerUp.cell.z}`}
      position={cellPosition(powerUp.cell.x, powerUp.cell.z, 0.18)}
      options={{
        height: isTopDown ? 0.18 : 0.22,
        diameter: look.diameter,
        tessellation: look.tessellation
      }}
    >
      <standardMaterial
        name={`powerup-material-${powerUp.type}-${powerUp.cell.x}-${powerUp.cell.z}`}
        diffuseColor={Color3.FromHexString(look.color)}
        emissiveColor={Color3.FromHexString(isTopDown ? "#000000" : look.color)}
        specularColor={Color3.FromHexString(isTopDown ? "#000000" : "#FFFFFF")}
      />
    </cylinder>
  );
}

function EnemyToken({ enemy, isTopDown }: { enemy: ActiveEnemy; isTopDown: boolean; key?: string }) {
  const colorByType: Record<EnemyType, string> = {
    wanderer: "#EF4444",
    chaser: "#EC4899",
    ghost: "#A78BFA"
  };
  const color = colorByType[enemy.type];

  return (
    <sphere
      name={`enemy-${enemy.id}`}
      position={cellPosition(enemy.cell.x, enemy.cell.z, 0.42)}
      options={{ diameter: enemy.type === "ghost" ? 0.54 : 0.62, segments: 20 }}
    >
      <standardMaterial
        name={`enemy-material-${enemy.id}`}
        diffuseColor={Color3.FromHexString(color)}
        emissiveColor={Color3.FromHexString(isTopDown ? "#000000" : color)}
        specularColor={Color3.FromHexString(isTopDown ? "#000000" : "#FFFFFF")}
        alpha={enemy.type === "ghost" ? 0.82 : 1}
      />
    </sphere>
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
        cells: computeBlastCells({ x: cue.cell[0], z: cue.cell[1] }, directedExplosionRadius, wallSet, destructibleSet),
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
  const updateBounds = () => {
    const engine = scene.getEngine();
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    const halfBoard = size / 2 + 1.2;
    const halfHeight = aspect >= 1 ? halfBoard : halfBoard / aspect;
    const halfWidth = aspect >= 1 ? halfBoard * aspect : halfBoard;
    camera.orthoLeft = -halfWidth;
    camera.orthoRight = halfWidth;
    camera.orthoTop = halfHeight;
    camera.orthoBottom = -halfHeight;
  };

  updateBounds();
  const observer = scene.getEngine().onResizeObservable.add(updateBounds);
  camera.onDisposeObservable.add(() => {
    scene.getEngine().onResizeObservable.remove(observer);
  });
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
      return { x: 0, z: 1 };
    case "backward":
      return { x: 0, z: -1 };
    case "left":
      return { x: -1, z: 0 };
    case "right":
      return { x: 1, z: 0 };
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

function materialLookForView(kind: ArenaElementKind, look: MaterialLook, isTopDown: boolean): MaterialLook {
  if (!isTopDown) {
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

function crateVisualVariant(cell: Cell) {
  const seed = Math.abs(cell.x * 31 + cell.z * 17);

  return {
    heightOffset: Math.sin(seed) * 0.02,
    rotationY: (seed % 4) * 0.08
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

function createInitialEnemies(wallSet: Set<string>, destructibleSet: Set<string>): ActiveEnemy[] {
  const candidateCells: Cell[] = [];

  for (let x = 1; x < size - 1; x += 1) {
    for (let z = 1; z < size - 1; z += 1) {
      const cell = { x, z };
      if (
        wallSet.has(cellKey(cell)) ||
        destructibleSet.has(cellKey(cell)) ||
        isSpawnSafeCell(cell) ||
        manhattanDistance(cell, playerStart) < 8
      ) {
        continue;
      }

      candidateCells.push(cell);
    }
  }

  return candidateCells
    .sort((a, b) => enemySpawnScore(b) - enemySpawnScore(a))
    .slice(0, 6)
    .map((cell, index) => ({
      id: `enemy-${index}`,
      type: enemyTypeForIndex(index),
      cell,
      direction: index % 2 === 0 ? { x: 1, z: 0 } : { x: 0, z: 1 },
      nextMoveAt: performance.now() + 450 + index * 120
    }));
}

function enemySpawnScore(cell: Cell) {
  return manhattanDistance(cell, playerStart) * 100 + ((cell.x * 19 + cell.z * 31) % 17);
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
      return 520;
    case "ghost":
      return 680;
    case "wanderer":
      return 620;
  }
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
  return enemies.some(enemy => sameCell(enemy.cell, cell));
}

function manhattanDistance(a: Cell, b: Cell) {
  return Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
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

function nearestCellFromPosition(position: Vector3): Cell {
  return {
    x: Math.min(size - 1, Math.max(0, Math.round(position.x + center))),
    z: Math.min(size - 1, Math.max(0, Math.round(position.z + center)))
  };
}
