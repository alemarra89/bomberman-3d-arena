import type React from "react";
import type { ViewMode } from "../types";
import type { ArenaDirector } from "../useArenaDirector";

interface PromptPanelProps {
  director: ArenaDirector;
  viewMode: ViewMode;
  setViewMode: React.Dispatch<React.SetStateAction<ViewMode>>;
}

const viewModes: Array<{ value: ViewMode; label: string }> = [
  { value: "top_down", label: "2D" },
  { value: "three_d", label: "3D" },
  { value: "fps", label: "FPS" }
];

export function PromptPanel({ director, viewMode, setViewMode }: PromptPanelProps) {
  const {
    arena,
    prompt,
    setPrompt,
    examples,
    generate,
    runExample,
    replay,
    plan,
    source,
    isGenerating,
    isApplying,
    error
  } = director;

  return (
    <aside className="prompt-panel">
      <div className="brand-block">
        <span className="eyebrow">Codex CLI Director</span>
        <h1>AI Bomber Arena</h1>
        <p>{arena.mood}</p>
      </div>

      <form
        className="prompt-form"
        onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          void generate();
        }}
      >
        <label htmlFor="world-prompt">Prompt nel gioco</label>
        <textarea
          id="world-prompt"
          value={prompt}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setPrompt(event.target.value)}
          spellCheck={false}
        />
        <button type="submit" disabled={isGenerating || isApplying}>
          {isGenerating ? "Codex sta dirigendo..." : isApplying ? "Mutazione in corso..." : "Trasforma arena"}
        </button>
      </form>

      <div className="action-row">
        <button type="button" onClick={replay} disabled={!plan || isGenerating || isApplying}>
          Replay ultimo piano
        </button>
        <span>{source ? `source: ${source}` : "source: ready"}</span>
      </div>

      <div className="gameplay-actions">
        <button
          type="button"
          data-testid="place-bomb-button"
          onClick={() => {
            window.dispatchEvent(new CustomEvent("arena:place-bomb"));
          }}
        >
          Piazza bomba
        </button>
        <span>WASD / frecce o controller muovi | A bomba | Y lancia | stick destro camera | LT/RT zoom</span>
      </div>

      <div className="view-mode-switch" role="tablist" aria-label="Modalita vista">
        {viewModes.map(mode => (
          <button
            key={mode.value}
            type="button"
            data-testid={`view-mode-${mode.value}`}
            role="tab"
            aria-selected={viewMode === mode.value}
            className={viewMode === mode.value ? "active" : ""}
            onClick={() => setViewMode(mode.value)}
          >
            {mode.label}
          </button>
        ))}
      </div>

      <div className="quick-prompts" aria-label="Prompt rapidi">
        {examples.map(example => (
          <button key={example} type="button" onClick={() => runExample(example)}>
            {example}
          </button>
        ))}
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      <section className="state-strip" aria-label="Stato arena">
        <div>
          <span>Tema</span>
          <strong>{arena.theme}</strong>
        </div>
        <div>
          <span>Luci</span>
          <strong>{arena.lighting}</strong>
        </div>
        <div>
          <span>Bomba</span>
          <strong>{arena.bomb}</strong>
        </div>
      </section>

      <section className="json-panel" aria-label="JSON generato">
        <div className="panel-header">
          <span>ArenaMutationPlan</span>
          <span>{plan ? `${plan.timeline.length} eventi / ${source ?? "codex"}` : "in attesa"}</span>
        </div>
        <pre>{plan ? JSON.stringify(plan, null, 2) : "Il JSON strutturato generato da codex exec comparira qui."}</pre>
      </section>
    </aside>
  );
}
