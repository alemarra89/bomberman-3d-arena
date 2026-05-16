# Bomberman 3D Arena

Prototype arcade in React + Babylon.js inspired by the core Bomberman loop, with switchable 2D, 3D and FPS views plus an AI-driven arena mutation layer.

## Current gameplay

The game currently supports:

- grid-based player movement with smooth visual interpolation, held-key movement and turn buffering;
- bomb placement, timed explosions, destructible crates and bomb chain reactions;
- power-ups for bomb capacity, blast radius, speed, bomb kick and bomb throw;
- enemy encounters, player death, win/loss states and restart flow;
- a gameplay HUD with timer, bombs, blast radius, enemies remaining and unlocked abilities;
- a simplified high-readability 2D presentation and a free-orbit 3D camera.

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
```

## Development notes

The detailed implementation history, product decisions and roadmap are documented in [docs/gameplay-development.md](docs/gameplay-development.md).
