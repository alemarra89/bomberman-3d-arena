import { ArenaViewport } from "./components/ArenaViewport";
import { PromptPanel } from "./components/PromptPanel";
import { useArenaDirector } from "./useArenaDirector";

export default function App() {
  const director = useArenaDirector();

  return (
    <main className="app-shell">
      <ArenaViewport arena={director.arena} isApplying={director.isApplying} />
      <PromptPanel director={director} />
    </main>
  );
}
