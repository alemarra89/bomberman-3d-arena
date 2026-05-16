# Gameplay Development Notes

This document records the work completed so far, the plan that guided it, the main design decisions, and the next likely steps.

## Product direction

The project is being developed first as a **single-player classic Bomberman-style game** rather than a versus arena. That order was chosen because it lets us validate the full core loop before adding multiplayer complexity:

1. move through a grid;
2. place bombs;
3. destroy crates;
4. collect power-ups;
5. avoid blast danger;
6. defeat enemies;
7. win or lose a level.

The AI-directed arena mutation layer remains separate from the actual gameplay simulation: it can change the arena presentation and trigger demo effects, but it should not unexpectedly kill the player or alter the rules of a run.

---

## Work completed before the gameplay expansion

### Input and movement

- Removed the conflict where arrow keys controlled both the player and the Babylon `ArcRotateCamera`.
- Fixed left/right movement inversion after camera-relative movement was introduced.
- Fixed inverted up/down directions in the 2D top-down view.
- Replaced teleport-like cell changes with interpolated visual movement.
- Added held-key movement for arrows and WASD.
- Added a true movement speed cap so repeated key taps cannot exceed the configured player speed.
- Refactored movement into a coherent model:
  - a settled logical cell;
  - at most one active move from one cell to the next;
  - visual position derived from the active move.
- Added a short turn buffer so the player can press a direction slightly before an intersection and still take the turn.
- Removed visible per-cell bobbing and chained consecutive steps directly so held-key movement feels more linear.

### Bomb placement and cell logic

- Fixed bomb placement while moving so bombs use the nearest visual cell instead of jumping too far ahead or lagging many cells behind.
- Preserved classic Bomberman behaviour where a bomb can be exited after placement but blocks re-entry once the player has left the cell.
- Stabilized movement input so placing a bomb no longer drops held-key state.

### 2D and 3D presentation

- Simplified the 2D view for readability:
  - flatter materials;
  - no decorative lights or particles;
  - stronger visual separation between floor, walls, crates and bombs.
- Prevented destructible crates from visually shifting after unrelated crates were destroyed by making their decorative variation cell-based instead of array-index-based.
- Tuned the 3D camera:
  - keyboard controls disabled for camera orbit;
  - player movement no longer resets user-chosen camera angle;
  - zoom speed and limits adjusted for a more controlled strategic view.
- Tested and rejected a player-follow camera target for the 3D mode because it changed the view from strategic to overly action-oriented.

### First gameplay systems

- Added bomb chain reactions.
- Added deterministic crate drops for:
  - bomb capacity;
  - blast radius.
- Added a HUD with timer, bombs available, total bomb capacity, blast radius and collected power-up count.
- Rebalanced the initial blast radius from `3` to `1` so radius upgrades matter.
- Fixed a deterministic-drop bug where the map generator and drop generator together accidentally produced no bomb-capacity power-ups at all.

---

## Plan followed for the Bomberman gameplay pass

The implementation plan was intentionally split into two milestones.

### Phase 1 — Complete the basic game loop

Goal: turn the prototype into an actual game instead of a sandbox.

Planned items:

1. player death from explosions;
2. basic enemies;
3. victory when all enemies are defeated;
4. loss state and restart flow.

### Phase 2 — Add classic Bomberman depth

Goal: move beyond the minimum loop and introduce the first meaningful tactical layer.

Planned items:

1. speed-up power-up;
2. bomb-kick power-up;
3. glove / throw-bomb power-up;
4. enemy variety instead of a single dummy enemy type;
5. HUD updates for the new systems.

---

## Phase 1 implemented

### Player danger

- Player dies if hit by an active gameplay blast.
- Player also loses on direct contact with an enemy.
- Demo explosions emitted by the arena director remain cosmetic and do not affect the run.

### Enemies

Three enemy archetypes now exist:

| Enemy | Behaviour |
| --- | --- |
| Wanderer | Moves through corridors using deterministic wandering choices |
| Chaser | Prefers moves that reduce Manhattan distance to the player |
| Ghost | Can move through destructible crates |

The initial level currently starts with six enemies placed far enough from the player spawn to avoid immediate unfair pressure.

### Win / lose flow

- Victory occurs when all enemies are eliminated.
- Loss occurs when the player is hit by a blast or touched by an enemy.
- A result overlay appears with a restart action.
- Restart remounts the gameplay scene state while keeping the current visual arena setup.

---

## Phase 2 implemented

### Extended power-up set

| Power-up | Effect |
| --- | --- |
| Bomb capacity | Increases the number of simultaneously active bombs |
| Blast radius | Extends future bomb blasts by `+1` |
| Speed up | Reduces player move duration down to a safe minimum |
| Bomb kick | Lets the player kick a bomb along a corridor |
| Throw bomb | Lets the player throw the bomb under them forward with `T` |

### Bomb kick

- If the player has the kick ability and tries to move into a bomb, the bomb is relocated to the last free cell in that corridor.
- If a kicked bomb lands in an active blast, it explodes immediately.
- The current version resolves the kick instantly at the final destination; a later polish pass may animate the travel.

### Throw bomb

- If the player has the glove ability and is standing on a bomb, pressing `T` throws that bomb forward.
- The current implementation finds a valid landing cell up to three cells ahead, preferring the farthest free option.
- If the thrown bomb lands in an active blast, it explodes immediately.

### Current deterministic drop distribution

For the current generated map, the deterministic drop scheme yields:

| Drop | Count |
| --- | ---: |
| Bomb capacity | 9 |
| Blast radius | 9 |
| Speed up | 9 |
| Bomb kick | 4 |
| Throw bomb | 2 |

Deterministic drops are intentional at this stage because they make balancing and repeatable testing easier. Randomized drops can be introduced later once the loop is approved.

---

## Major design decisions and rejected alternatives

### 1. Single-player first

**Chosen:** build the classic solo loop before versus play.

**Why:** it validates all foundational systems — bombs, enemies, power-ups, level flow — before introducing multiplayer synchronization and balance.

**Alternative:** begin with player-versus-player arena rules. Rejected for now because it would leave the solo loop underdeveloped and complicate debugging.

### 2. Grid logic with smooth rendering

**Chosen:** keep discrete logical cells while interpolating visual movement.

**Why:** Bomberman depends on precise grid rules, but the player should not feel teleported between cells.

**Alternative:** fully continuous physical movement. Rejected because it would make bomb cells, blast occupancy and classic corridor interactions less clear.

### 3. Nearest visual cell for bomb placement during movement

**Chosen:** a bomb placed while moving goes to the nearest cell to the visual player position.

**Why:** using the destination cell felt too anticipatory; using the last settled cell felt too delayed during held movement.

**Alternative:** always origin cell or always destination cell. Both were tested and produced worse player intuition.

### 4. Deterministic drops during prototyping

**Chosen:** deterministic map-cell-based drops.

**Why:** repeatable runs make balance defects visible; this also exposed the earlier zero-bomb-capacity-drop bug.

**Alternative:** pure randomness. Deferred until the rules and pacing feel right.

### 5. Immediate chain reactions

**Chosen:** bombs hit by a blast explode immediately.

**Why:** it is clear, expected and easy to reason about.

**Alternative:** delayed chain reactions for spectacle. Deferred until after gameplay tuning.

### 6. Kick and throw shipped as simple first versions

**Chosen:** instant kick relocation and a bounded forward throw.

**Why:** they let us test the tactical value of the abilities before spending time on animation polish or held-object state.

**Alternatives:** animated sliding bombs, picked-up bombs, arcing throws, remote timing. All remain viable future refinements.

---

## Current controls

| Input | Action |
| --- | --- |
| `WASD` / arrow keys | Move |
| `Space` / `B` | Place bomb |
| `T` | Throw bomb after collecting the glove |
| Mouse drag / wheel | Orbit and zoom in 3D |

---

## Verification completed

The project has been checked with:

```bash
npm run typecheck
npm run build
```

Both pass at the current documented state.

---

## Suggested manual test pass

### Core game loop

1. Die to your own bomb.
2. Die by touching an enemy.
3. Kill all enemies and verify victory.
4. Restart after both victory and defeat.

### Enemy behaviour

1. Confirm wanderers, chasers and ghosts feel meaningfully different.
2. Check whether ghost enemies passing through crates feel fair.
3. Confirm blasts remove enemies correctly.

### Power-ups

1. Increase bomb capacity and place multiple bombs.
2. Increase blast radius and confirm later bombs extend by one cell per pickup.
3. Pick up speed boosts and evaluate whether the player eventually becomes too fast.
4. Pick up kick and run into a bomb.
5. Pick up glove, place a bomb under the player and press `T`.

### Feel / balance questions still open

- Are six enemies too many, too few or right for the first level?
- Is the ghost enemy interesting or frustrating?
- Are kick and glove too rare, too common, or about right?
- Should kicked bombs visibly slide instead of teleporting to their destination?
- Should the throw mechanic become a richer pick-up / carry / release system later?

---

## Likely next roadmap after playtesting

1. **Balance pass**
   - enemy counts and movement cadence;
   - drop rarity;
   - player speed ceiling;
   - first-level crate density.

2. **Feedback polish**
   - pre-explosion bomb telegraph;
   - enemy death feedback;
   - distinct power-up icons or markings;
   - audio.

3. **Level structure**
   - multiple level presets;
   - difficulty progression;
   - transition from deterministic test map to tuned or randomized level generation.

4. **Advanced mechanics refinement**
   - animated bomb kicking;
   - richer glove behaviour;
   - remote bombs or additional classic power-ups if they serve the game.
