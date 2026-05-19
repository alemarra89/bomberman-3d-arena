import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyDirectorAction, applyPlanTheme, initialArenaState } from "./arenaState";
import type { ArenaMutationPlan, ArenaState, DirectorAction } from "./types";

interface DirectorResponse {
  plan: ArenaMutationPlan;
  source?: "codex" | "cache" | "fallback";
}

const examples = [
  "Trasforma l'arena in una base spaziale abbandonata con energia instabile",
  "Crea un'arena vulcanica con lava e bombe incandescenti",
  "Rendila cyberpunk anni 80 con esplosioni al neon",
  "Portami in un dungeon di ghiaccio con bombe congelanti",
  "Corrompi tutto con un rituale oscuro e particelle viola",
  "Trasforma l'arena in un mondo di giocattoli con casse pastello e bombe a molla"
];

export function useArenaDirector() {
  const [arena, setArena] = useState<ArenaState>(initialArenaState);
  const [prompt, setPrompt] = useState(examples[0]);
  const [plan, setPlan] = useState<ArenaMutationPlan | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<DirectorResponse["source"] | null>(null);
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    for (const timer of timers.current) {
      window.clearTimeout(timer);
    }

    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const applyPlan = useCallback(
    (nextPlan: ArenaMutationPlan) => {
      clearTimers();
      setIsApplying(true);
      setArena(current => applyPlanTheme(current, nextPlan.theme, nextPlan.mood, nextPlan.palette));

      const actions = [...nextPlan.timeline].sort((a, b) => a.atMs - b.atMs);

      for (const action of actions) {
        const timer = window.setTimeout(() => {
          setArena(current => applyDirectorAction(current, action));
        }, action.atMs);

        timers.current.push(timer);
      }

      const finalTimer = window.setTimeout(() => {
        setIsApplying(false);
      }, Math.max(...actions.map(action => action.atMs), 0) + 900);

      timers.current.push(finalTimer);
    },
    [clearTimers]
  );

  const generate = useCallback(async () => {
    const trimmed = prompt.trim();
    if (trimmed.length < 4) {
      setError("Scrivi una trasformazione più specifica.");
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch("/api/transform-world", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmed })
      });

      const data = (await response.json()) as DirectorResponse | { error?: string };

      if (!response.ok || !("plan" in data)) {
        throw new Error("error" in data && data.error ? data.error : "Codex non ha restituito un piano valido.");
      }

      setPlan(data.plan);
      setSource(data.source ?? "codex");
      applyPlan(data.plan);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "Errore durante la generazione.");
    } finally {
      setIsGenerating(false);
    }
  }, [applyPlan, prompt]);

  const replay = useCallback(() => {
    if (!plan) {
      return;
    }

    setError(null);
    applyPlan(plan);
  }, [applyPlan, plan]);

  const runExample = useCallback(
    (example: string) => {
      setPrompt(example);
    },
    []
  );

  return useMemo(
    () => ({
      arena,
      prompt,
      setPrompt,
      plan,
      isGenerating,
      isApplying,
      error,
      source,
      examples,
      generate,
      runExample,
      replay
    }),
    [arena, error, generate, isApplying, isGenerating, plan, prompt, replay, runExample, source]
  );
}

export type ArenaDirector = ReturnType<typeof useArenaDirector>;
