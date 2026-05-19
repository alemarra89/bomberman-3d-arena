import { Color3, Color4 } from "@babylonjs/core";
import type { Scene as BabylonScene } from "@babylonjs/core/scene";
import { useState } from "react";
import { Engine } from "reactylon/web";
import { Scene } from "reactylon";
import type { ArenaState, ViewMode, VisualStyle } from "../types";
import { ArenaContent, type ArenaHudState } from "./ArenaContent";

interface ArenaViewportProps {
  arena: ArenaState;
  isApplying: boolean;
  viewMode: ViewMode;
}

const baseVisualStyle: VisualStyle = "arcade_premium";

export function ArenaViewport({ arena, isApplying, viewMode }: ArenaViewportProps) {
  const [sessionId, setSessionId] = useState(0);
  const [hud, setHud] = useState<ArenaHudState>({
    elapsedSeconds: 0,
    availableBombs: 1,
    bombCapacity: 1,
    blastRadius: 1,
    collectedPowerUps: 0,
    enemiesRemaining: 5,
    speedLevel: 0,
    canKickBombs: false,
    canThrowBombs: false,
    status: "playing"
  });

  const restartGame = () => {
    setHud({
      elapsedSeconds: 0,
      availableBombs: 1,
      bombCapacity: 1,
      blastRadius: 1,
      collectedPowerUps: 0,
      enemiesRemaining: 5,
      speedLevel: 0,
      canKickBombs: false,
      canThrowBombs: false,
      status: "playing"
    });
    setSessionId(currentSessionId => currentSessionId + 1);
  };

  return (
    <section className={`arena-stage ${viewMode === "top_down" ? "top-down" : ""}`}>
      <Engine canvasId="reactylon-canvas" forceWebGL engineOptions={{ antialias: true, adaptToDeviceRatio: true }}>
        <Scene onSceneReady={scene => prepareScene(scene, arena)}>
          <ArenaContent key={sessionId} arena={arena} viewMode={viewMode} visualStyle={baseVisualStyle} onHudChange={setHud} />
        </Scene>
      </Engine>
      <ArenaHud hud={hud} />
      {hud.status !== "playing" ? <GameResultOverlay status={hud.status} onRestart={restartGame} /> : null}
      <div className={`mutation-banner ${isApplying ? "active" : ""}`}>
        <span>{arena.overlay}</span>
      </div>
    </section>
  );
}

function ArenaHud({ hud }: { hud: ArenaHudState }) {
  return (
    <div className="arena-hud" aria-label="HUD partita" data-testid="arena-hud">
      <div data-testid="hud-time">
        <span>Tempo</span>
        <strong>{formatElapsedTime(hud.elapsedSeconds)}</strong>
      </div>
      <div data-testid="hud-bombs">
        <span>Bombe</span>
        <strong>
          {hud.availableBombs}/{hud.bombCapacity}
        </strong>
      </div>
      <div data-testid="hud-radius">
        <span>Raggio</span>
        <strong>{hud.blastRadius}</strong>
      </div>
      <div data-testid="hud-powerups">
        <span>Power-up</span>
        <strong>{hud.collectedPowerUps}</strong>
      </div>
      <div data-testid="hud-enemies">
        <span>Nemici</span>
        <strong>{hud.enemiesRemaining}</strong>
      </div>
      <div data-testid="hud-speed">
        <span>Velocità</span>
        <strong>{hud.speedLevel}</strong>
      </div>
      <div data-testid="hud-kick">
        <span>Kick</span>
        <strong>{hud.canKickBombs ? "Sì" : "No"}</strong>
      </div>
      <div data-testid="hud-throw">
        <span>Lancio</span>
        <strong>{hud.canThrowBombs ? "Sì" : "No"}</strong>
      </div>
    </div>
  );
}

function GameResultOverlay({ status, onRestart }: { status: "won" | "lost"; onRestart: () => void }) {
  return (
    <div className={`game-result ${status}`}>
      <div>
        <span>{status === "won" ? "Arena liberata" : "Sei stato colpito"}</span>
        <strong>{status === "won" ? "Vittoria" : "Game over"}</strong>
        <button type="button" onClick={onRestart}>
          Ricomincia
        </button>
      </div>
    </div>
  );
}

function formatElapsedTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function prepareScene(scene: BabylonScene, arena: ArenaState) {
  scene.clearColor = Color4.FromHexString(`${arena.palette.primary}FF`);
  scene.ambientColor = Color3.FromHexString(arena.palette.secondary);
  const targetPixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
  scene.getEngine().setHardwareScalingLevel(1 / targetPixelRatio);
  scene.animationTimeScale = 1;
}
