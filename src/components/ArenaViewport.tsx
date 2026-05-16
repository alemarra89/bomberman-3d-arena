import { Color3, Color4 } from "@babylonjs/core";
import type { Scene as BabylonScene } from "@babylonjs/core/scene";
import { useState } from "react";
import { Engine } from "reactylon/web";
import { Scene } from "reactylon";
import type { ArenaState, ViewMode } from "../types";
import { ArenaContent, type ArenaHudState } from "./ArenaContent";

interface ArenaViewportProps {
  arena: ArenaState;
  isApplying: boolean;
  viewMode: ViewMode;
}

export function ArenaViewport({ arena, isApplying, viewMode }: ArenaViewportProps) {
  const [sessionId, setSessionId] = useState(0);
  const [hud, setHud] = useState<ArenaHudState>({
    elapsedSeconds: 0,
    availableBombs: 1,
    bombCapacity: 1,
    blastRadius: 1,
    collectedPowerUps: 0,
    enemiesRemaining: 6,
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
      enemiesRemaining: 6,
      speedLevel: 0,
      canKickBombs: false,
      canThrowBombs: false,
      status: "playing"
    });
    setSessionId(currentSessionId => currentSessionId + 1);
  };

  return (
    <section className="arena-stage">
      <Engine canvasId="reactylon-canvas" forceWebGL engineOptions={{ antialias: true, adaptToDeviceRatio: true }}>
        <Scene onSceneReady={scene => prepareScene(scene, arena)}>
          <ArenaContent key={sessionId} arena={arena} viewMode={viewMode} onHudChange={setHud} />
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
    <div className="arena-hud" aria-label="HUD partita">
      <div>
        <span>Tempo</span>
        <strong>{formatElapsedTime(hud.elapsedSeconds)}</strong>
      </div>
      <div>
        <span>Bombe</span>
        <strong>
          {hud.availableBombs}/{hud.bombCapacity}
        </strong>
      </div>
      <div>
        <span>Raggio</span>
        <strong>{hud.blastRadius}</strong>
      </div>
      <div>
        <span>Power-up</span>
        <strong>{hud.collectedPowerUps}</strong>
      </div>
      <div>
        <span>Nemici</span>
        <strong>{hud.enemiesRemaining}</strong>
      </div>
      <div>
        <span>Velocità</span>
        <strong>{hud.speedLevel}</strong>
      </div>
      <div>
        <span>Kick</span>
        <strong>{hud.canKickBombs ? "Sì" : "No"}</strong>
      </div>
      <div>
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
  scene.getEngine().setHardwareScalingLevel(Math.max(1, window.devicePixelRatio / 1.5));
  scene.animationTimeScale = 1;
}
