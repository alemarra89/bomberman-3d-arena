import type React from "react";
import type { ArenaState, ViewMode, WorldSkin } from "../types";
import type { ArenaDirector } from "../useArenaDirector";

interface PromptPanelProps {
  director: ArenaDirector;
  enableDirector: boolean;
  viewMode: ViewMode;
  setViewMode: React.Dispatch<React.SetStateAction<ViewMode>>;
  worldSkin: WorldSkin;
  setWorldSkin: React.Dispatch<React.SetStateAction<WorldSkin>>;
}

const viewModes: Array<{ value: ViewMode; label: string }> = [
  { value: "top_down", label: "2D" },
  { value: "three_d", label: "3D" },
  { value: "fps", label: "FPS" }
];

const worldSkins: Array<{ value: WorldSkin; label: string }> = [
  { value: "arena", label: "Arena" },
  { value: "office", label: "Ufficio" }
];

export function PromptPanel({ director, enableDirector, viewMode, setViewMode, worldSkin, setWorldSkin }: PromptPanelProps) {
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
        <span className="eyebrow">{enableDirector ? "Codex CLI Director" : "Static build"}</span>
        <h1>{enableDirector ? "AI Bomber Arena" : "Bomber Arena"}</h1>
        <p>{arena.mood}</p>
      </div>

      {enableDirector ? (
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
      ) : null}

      {enableDirector ? (
        <div className="action-row">
          <button type="button" onClick={replay} disabled={!plan || isGenerating || isApplying}>
            Replay ultimo piano
          </button>
          <span>{source ? `source: ${source}` : "source: ready"}</span>
        </div>
      ) : null}

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
        <span>WASD / frecce o controller muovi | A bomba | Esc/P pausa | stick destro camera | LT/RT zoom</span>
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

      <div className="world-skin-switch" role="tablist" aria-label="Mondo">
        {worldSkins.map(skin => (
          <button
            key={skin.value}
            type="button"
            data-testid={`world-skin-${skin.value}`}
            role="tab"
            aria-selected={worldSkin === skin.value}
            className={worldSkin === skin.value ? "active" : ""}
            onClick={() => setWorldSkin(skin.value)}
          >
            {skin.label}
          </button>
        ))}
      </div>

      {enableDirector ? (
        <div className="quick-prompts" aria-label="Prompt rapidi">
          {examples.map(example => (
            <button key={example} type="button" onClick={() => runExample(example)}>
              {example}
            </button>
          ))}
        </div>
      ) : null}

      {enableDirector && error ? <div className="error-box">{error}</div> : null}

      <section className="powerup-legend" aria-label="Legenda power-up">
        <div className="panel-header">
          <span>Power-up</span>
          <span>effetti</span>
        </div>
        <div className="powerup-grid">
          <div>
            <strong>BB</strong>
            <span>+1 bomba massima piazzabile.</span>
          </div>
          <div>
            <strong>R+</strong>
            <span>+1 raggio esplosione.</span>
          </div>
          <div>
            <strong>SP</strong>
            <span>Movimento più rapido.</span>
          </div>
          <div>
            <strong>FK</strong>
            <span>Spingi le bombe camminandoci contro.</span>
          </div>
        </div>
      </section>

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

      {enableDirector ? (
        <details className="json-panel">
          <summary className="panel-header">
            <span>ArenaMutationPlan</span>
            <span>{plan ? `${plan.timeline.length} eventi / ${source ?? "codex"}` : "in attesa"}</span>
          </summary>
          <pre>{plan ? JSON.stringify(plan, null, 2) : "Il JSON strutturato generato da codex exec comparira qui."}</pre>
        </details>
      ) : null}
    </aside>
  );
}

interface StaticPromptPanelProps {
  arena: ArenaState;
  viewMode: ViewMode;
  setViewMode: React.Dispatch<React.SetStateAction<ViewMode>>;
  worldSkin: WorldSkin;
  setWorldSkin: React.Dispatch<React.SetStateAction<WorldSkin>>;
}

export function StaticPromptPanel({ arena, viewMode, setViewMode, worldSkin, setWorldSkin }: StaticPromptPanelProps) {
  return (
    <aside className="prompt-panel">
      <div className="brand-block">
        <span className="eyebrow">Static build</span>
        <h1>Bomber Arena</h1>
        <p>{arena.mood}</p>
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
        <span>WASD / frecce o controller muovi | A bomba | Esc/P pausa | stick destro camera | LT/RT zoom</span>
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

      <div className="world-skin-switch" role="tablist" aria-label="Mondo">
        {worldSkins.map(skin => (
          <button
            key={skin.value}
            type="button"
            data-testid={`world-skin-${skin.value}`}
            role="tab"
            aria-selected={worldSkin === skin.value}
            className={worldSkin === skin.value ? "active" : ""}
            onClick={() => setWorldSkin(skin.value)}
          >
            {skin.label}
          </button>
        ))}
      </div>

      <section className="powerup-legend" aria-label="Legenda power-up">
        <div className="panel-header">
          <span>Power-up</span>
          <span>effetti</span>
        </div>
        <div className="powerup-grid">
          <div>
            <strong>BB</strong>
            <span>+1 bomba massima piazzabile.</span>
          </div>
          <div>
            <strong>R+</strong>
            <span>+1 raggio esplosione.</span>
          </div>
          <div>
            <strong>SP</strong>
            <span>Movimento piu rapido.</span>
          </div>
          <div>
            <strong>FK</strong>
            <span>Spingi le bombe camminandoci contro.</span>
          </div>
        </div>
      </section>

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
    </aside>
  );
}
