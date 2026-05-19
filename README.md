# Bomberman 3D Arena

Prototype arcade in React + Babylon.js inspired by the core Bomberman loop, with switchable 2D, 3D and FPS views plus an AI-driven arena mutation layer.

## Current gameplay

The game currently supports:

- grid-based player movement with smooth visual interpolation, stable held-key priority and turn buffering;
- bomb placement, timed explosions, destructible crates and bomb chain reactions;
- power-ups for bomb capacity, blast radius, speed, bomb kick and bomb throw;
- enemy encounters, player death, win/loss states and restart flow;
- a gameplay HUD with timer, bombs, blast radius, enemies remaining and unlocked abilities;
- pre-explosion bomb warning pulses plus pickup / enemy-defeat feedback;
- prompt-driven arena themes — including space base, volcano, cyberpunk, ice, dark ritual and Toy — that change presentation without changing gameplay rules;
- a dedicated high-readability 2D presentation with its own sprite/tile language, plus free-orbit 3D and FPS cameras.

## Controls

| Input | Action |
| --- | --- |
| `WASD` / arrow keys | Move |
| `Space` / `B` | Place bomb |
| `T` | Throw the bomb under the player after unlocking the glove power-up |
| Mouse drag / wheel | Rotate and zoom the 3D camera |

## Run locally

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm run typecheck
npm run build
npm run test:e2e
```

## Development notes

The detailed implementation history, product decisions and roadmap are documented in [docs/gameplay-development.md](docs/gameplay-development.md).
