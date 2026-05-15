import { useState } from "react";
import { ArenaViewport } from "./components/ArenaViewport";
import { PromptPanel } from "./components/PromptPanel";
import type { ViewMode } from "./types";
import { useArenaDirector } from "./useArenaDirector";

export default function App() {
  const director = useArenaDirector();
  const [viewMode, setViewMode] = useState<ViewMode>("three_d");

  return (
    <main className="app-shell">
      <ArenaViewport arena={director.arena} isApplying={director.isApplying} viewMode={viewMode} />
      <PromptPanel director={director} viewMode={viewMode} setViewMode={setViewMode} />
    </main>
  );
}
