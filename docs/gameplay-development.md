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
- Reoriented the 2D camera so the level now reads in the expected Bomberman direction: spawn at the bottom, map north at the top.
- Replaced teleport-like cell changes with interpolated visual movement.
- Added held-key movement for arrows and WASD.
- Added a true movement speed cap so repeated key taps cannot exceed the configured player speed.
- Refactored movement into a coherent model:
  - a continuous visual position that can stop between cell centres;
  - a derived logical cell based on where the player is mostly located;
  - grid-governed walkability so the player still moves through classic Bomberman corridors.
- A perpendicular input while the player is between cells now targets the nearest adjacent cell from which that turn is actually possible, keeping turns readable without forcing an unnecessary stop at a blocked centre.
- Lane correction for a pending perpendicular move now stops exactly on the chosen cell centre before handing control to the requested direction, preventing horizontal overshoot / recenter oscillation.
- When multiple movement keys are held together, the first key still being held remains the primary intention; newer keys become fallbacks until the original direction is released or blocked.
- Keyboard auto-repeat no longer keeps refreshing turn intent while a key is already held, avoiding intermittent re-requests of the same move.
- Removed two avoidable sources of motion hitching: logical player-cell crossings no longer rerender the whole arena, and the enemy loop only updates rendered enemy state when an enemy actually changes cell.
- Relaxed the per-frame player time cap enough to preserve travel speed across small frame spikes while still avoiding huge catch-up jumps after a long pause.
- Removed the per-frame top-down material sweep: flat 2D material settings are now applied once to existing materials and only again when a new 2D material is created.
- Merged the static 2D floor, wall and crate primitives into a small number of combined meshes so the view preserves the same tile art while avoiding thousands of separate static drawables.
- Merged the static 3D floor, wall and crate primitives by visual group as well, reducing the number of static scene objects the renderer must manage.
- Added a short turn buffer so the player can press a direction slightly before an intersection and still take the turn.
- Removed visible per-cell bobbing and replaced centre-to-centre step completion with continuous linear travel so held-key movement feels less snapped.

### Bomb placement and cell logic

- Fixed bomb placement while moving so bombs use the nearest visual cell instead of jumping too far ahead or lagging many cells behind.
- A bomb placed under the player remains passable only for that player until they leave its cell, so all valid exits stay available without allowing re-entry afterward.
- Preserved classic Bomberman behaviour where a bomb can be exited after placement but blocks re-entry once the player has left the cell.
- Stabilized movement input so placing a bomb no longer drops held-key state.

### 2D and 3D presentation

- Reworked the 2D view into a **dedicated presentation layer** rather than a plain overhead view of the 3D meshes:
  - flatter tile art for floor, fixed walls and breakable blocks;
  - a readable Bomberman-inspired player sprite instead of an abstract top-down token;
  - enemy sprites with stronger faces / silhouettes;
  - square power-up badges with distinct iconography;
  - dedicated 2D bomb and blast visuals;
  - no decorative lights, particles, fog, bloom, vignette, central screen glow or specular material response, so gameplay symbols carry the scene.
- Prevented destructible crates from visually shifting after unrelated crates were destroyed by making their decorative variation cell-based instead of array-index-based.
- Tuned the 3D camera:
  - keyboard controls disabled for camera orbit;
  - player movement no longer resets user-chosen camera angle;
  - zoom speed and limits adjusted for a more controlled strategic view.
- Tested and rejected a player-follow camera target for the 3D mode because it changed the view from strategic to overly action-oriented.
- Consolidated the presentation model so the performant 3D renderer is the single base and stylistic variation now lives in the prompt-driven arena themes rather than in a second global style switch.
- Reworked 3D lighting so gameplay readability comes from broad ambient/fill light rather than a bright central hotspot; atmosphere now comes from restrained perimeter accents and emissive materials instead.

### First gameplay systems

- Added bomb chain reactions.
- Added deterministic crate drops for:
  - bomb capacity;
  - blast radius.
- Added a HUD with timer, bombs available, total bomb capacity, blast radius and collected power-up count.
- Rebalanced the initial blast radius from `3` to `1` so radius upgrades matter.
- Fixed a deterministic-drop bug where the map generator and drop generator together accidentally produced no bomb-capacity power-ups at all.

### Randomized level generation

- Replaced the fixed checkerboard-style arena layout with a generated layout at the start of each run.
- Perimeter walls remain fixed, but interior fixed blocks and destructible blocks are placed randomly.
- The current density tuning intentionally favours a slightly fuller board, with fewer large empty lanes than the first random-generation pass.
- The generator validates the map before accepting it:
  - the permanent walkable area cannot be split into isolated islands;
  - the initial open area, after destructible blocks are placed, must also stay connected;
  - the player spawn area remains clear;
  - enemy spawn cells must be reachable and at least a configured path distance away from the player.
- Enemy starts are also spread out so the first seconds of the level do not become unfair or visually clustered.

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

The initial level currently starts with five enemies placed far enough from the player spawn to avoid immediate unfair pressure.

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
| Blast radius | Extends active and future bomb blasts by `+1` at detonation time |
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

### First readability and feel pass

- Added a pulsing warning ring and bomb-body pulse before detonation so danger is legible before the blast appears.
- Refined the bomb telegraph so its cadence and intensity ramp up near detonation, with an extra danger flash in the final portion of the fuse to communicate urgency more clearly.
- Shortened the visible fire duration after explosions so danger resolves faster and the arena reads more cleanly.
- Changed blast-radius upgrades so bombs already placed but not yet exploded use the latest player radius when they detonate.
- Added short visual feedback pulses for power-up collection and enemy defeats.
- Added lightweight synthesized pickup and enemy-defeat sounds without introducing external audio assets yet.
- Gave each power-up a stronger silhouette using a distinct marker shape on top of its base token.
- Reduced first-level crate density slightly, lowered the initial enemy count from six to five, and slowed enemy cadence modestly to create a fairer learning curve.

### Prompt-driven visual themes

- Replaced the separate Arcade / Toy / Neon selector with a single performant 3D renderer plus prompt-driven themes, so the visual identity now changes through the same arena-mutation system that already powers space base, volcano, cyberpunk, ice and dark ritual scenes.
- Added **Toy World** as a first-class prompt theme with its own palette, foam floor, toy-block walls, gift-box crates, wind-up bombs, warm playroom lighting, confetti particles and pop-style explosions.
- This keeps camera mode and gameplay state independent from art direction: collision, AI, timings and power-ups remain identical while the prompt controls the scene identity.
- The 3D art pass still gives the arena more authored detail:
  - player boots, backpack, visor variants and style-specific accessories;
  - enemy eyes plus type-specific collars, fins and spectral rings;
  - floor inlays, wall caps and crate decorations;
  - stronger stage accents so each prompt-driven world reads differently at a glance.

### Planned scene design — office / company setting

A future scene-design pass should study a full **office/company environment** rather than only palette or material swaps. The goal is to make the arena feel like a workplace made of rooms while preserving Bomberman readability and the existing grid rules.

Initial concept:

- The arena becomes an office floor with recognizable rooms, corridors and departments.
- Fixed blocks can become desks or workstation islands, with monitors / PCs on top.
- Destructible blocks can become lighter office objects: cardboard boxes, filing stacks, movable cabinets, chairs or equipment crates.
- Floor tiles can suggest carpet, office vinyl, meeting-room zones or corridor paths.
- Walls / borders can become glass partitions, cubicle dividers, office walls or server-room barriers.
- Power-ups should remain symbolic and immediately readable, possibly represented as office-themed pickups while keeping the current icon language.

Important constraints:

- The scene must still read as a grid from 3D and FPS.
- Decorative room dressing must not hide bombs, blasts, enemies, power-ups or the player.
- Fixed/destructible block identity must remain obvious at a glance.
- Tables/desks can be visually detailed, but their collision footprint must stay exactly one cell.
- The 2D presentation should remain stable unless we intentionally add a separate 2D office skin later.

This needs a dedicated design phase before implementation:

1. define the office object vocabulary: fixed desk, destructible box/cabinet, wall/partition, floor zone, pickup style;
2. decide how rooms are generated without breaking classic Bomberman corridor flow;
3. prototype one office theme in 3D first;
4. test readability in both 3D and FPS;
5. only then decide whether to extend the same scene identity to 2D.

### Current drop distribution

Power-up drops still use a deterministic cell-based rule, but the number of actual drops now varies because destructible blocks are generated randomly at the start of each run.

The current rule keeps repeatability at the cell level while allowing the level layout itself to change. A later balancing pass should measure generated-map averages for:

| Drop | Intended role |
| --- | --- |
| Bomb capacity | More simultaneous bombs |
| Blast radius | Stronger board control |
| Speed up | Faster movement |
| Bomb kick | Tactical bomb repositioning |
| Throw bomb | Rare advanced bomb control |

If random generation creates too much variation in available power-ups, the next step should be a quota-based drop allocator after destructible placement.

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
| `Esc` / `P` | Pause / resume |
| `R` while paused | Restart the run |
| Mouse drag / wheel | Orbit and zoom in 3D |
| Xbox left stick / D-pad | Grid movement, translated to the dominant cardinal direction |
| Xbox right stick | Camera control in 3D and FPS |
| Xbox `LT` / `RT` | Zoom out / zoom in in 3D and FPS |
| Xbox `A` | Place bomb |
| Xbox `Y` | Throw bomb after collecting the glove |
| Xbox `Menu` | Pause / resume |
| Xbox `A` while paused | Resume |
| Xbox `Y` while paused | Restart the run |

### Controller support

Initial Xbox controller support is implemented through the browser Gamepad API. The intent is to improve 3D and FPS playability without changing the Bomberman grid rules.

Current mapping:

| Controller input | Action |
| --- | --- |
| Left stick / D-pad | Grid movement, translated to the dominant cardinal direction |
| Right stick | Camera control in 3D and FPS |
| LT / RT | Zoom out / zoom in in 3D and FPS |
| Xbox `A` / PlayStation `X` | Place bomb |
| Xbox `Y` / PlayStation `Triangle` | Throw bomb after collecting the glove |
| Xbox Menu / PlayStation Options | Pause / resume |

Still to evaluate on hardware:

- stick dead zone;
- camera sensitivity;
- Y-axis preference;
- whether FPS camera motion remains playable during combat;
- whether the visible controller-connected HUD indicator needs more detail than the compact `Xbox` / `Gamepad` label.

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

- Are five enemies too many, too few or right for the first level after the first tuning pass?
- Is the ghost enemy interesting or frustrating?
- Are kick and glove too rare, too common, or about right?
- Should kicked bombs visibly slide instead of teleporting to their destination?
- Should the throw mechanic become a richer pick-up / carry / release system later?

---

## Likely next roadmap after playtesting

1. **Balance pass**
   - validate the first tuning pass for enemy counts, movement cadence and first-level crate density;
   - reassess drop rarity;
   - player speed ceiling.

2. **Feedback polish**
   - refine the new pre-explosion telegraph;
   - iterate on enemy-death and pickup feedback;
   - replace placeholder marker geometry with final icons or models;
   - expand audio beyond the first synthesized cues.

3. **Level structure**
   - multiple level presets;
   - difficulty progression;
   - transition from deterministic test map to tuned or randomized level generation.

4. **New scene families**
   - design an office/company arena made of rooms and workplace objects;
   - evaluate desks with PCs as fixed blocks;
   - define destructible office props that remain readable as breakable blocks;
   - keep gameplay collision identical while changing only presentation.

5. **Advanced mechanics refinement**
   - animated bomb kicking;
   - richer glove behaviour;
   - remote bombs or additional classic power-ups if they serve the game.

6. **Controller support for 3D / FPS**
   - implement Gamepad API input after a real controller is available for testing;
   - keep movement grid-based while using the right stick for camera control;
   - tune dead zones and camera sensitivity on hardware.
