import { useState } from "react";
import { initialArenaState } from "./arenaState";
import { ArenaViewport } from "./components/ArenaViewport";
import { StaticPromptPanel } from "./components/PromptPanel";
import type { ViewMode, WorldSkin } from "./types";

export default function StaticApp() {
  const [viewMode, setViewMode] = useState<ViewMode>("three_d");
  const [worldSkin, setWorldSkin] = useState<WorldSkin>("arena");

  return (
    <main className="app-shell">
      <ArenaViewport
        arena={initialArenaState}
        isApplying={false}
        viewMode={viewMode}
        worldSkin={worldSkin}
      />
      <StaticPromptPanel
        arena={initialArenaState}
        viewMode={viewMode}
        setViewMode={setViewMode}
        worldSkin={worldSkin}
        setWorldSkin={setWorldSkin}
      />
    </main>
  );
}
