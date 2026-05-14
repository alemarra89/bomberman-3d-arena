import { Color3, Color4 } from "@babylonjs/core";
import type { Scene as BabylonScene } from "@babylonjs/core/scene";
import { Engine } from "reactylon/web";
import { Scene } from "reactylon";
import type { ArenaState } from "../types";
import { ArenaContent } from "./ArenaContent";

interface ArenaViewportProps {
  arena: ArenaState;
  isApplying: boolean;
}

export function ArenaViewport({ arena, isApplying }: ArenaViewportProps) {
  return (
    <section className="arena-stage">
      <Engine canvasId="reactylon-canvas" forceWebGL engineOptions={{ antialias: true, adaptToDeviceRatio: true }}>
        <Scene onSceneReady={scene => prepareScene(scene, arena)}>
          <ArenaContent arena={arena} />
        </Scene>
      </Engine>
      <div className={`mutation-banner ${isApplying ? "active" : ""}`}>
        <span>{arena.overlay}</span>
      </div>
    </section>
  );
}

function prepareScene(scene: BabylonScene, arena: ArenaState) {
  scene.clearColor = Color4.FromHexString(`${arena.palette.primary}FF`);
  scene.ambientColor = Color3.FromHexString(arena.palette.secondary);
  scene.getEngine().setHardwareScalingLevel(Math.max(1, window.devicePixelRatio / 1.5));
  scene.animationTimeScale = 1;
}
