# E2E testing

The project uses Playwright Test for end-to-end coverage and visual artifacts.

## Run

```bash
npm run test:e2e
```

The command starts the client with Playwright's `webServer`, runs Chromium tests and saves artifacts under:

```text
test-results/
```

## Current coverage

The first regression flow verifies:

1. the arena boots and the HUD is populated;
2. camera mode switching remains functional;
3. bomb placement updates the HUD;
4. bombs explode and return capacity afterward.

## Screenshots

Each smoke run saves named screenshots for the important checkpoints:

- initial arena;
- top-down mode;
- bomb warning state;
- post-explosion state.

- `test-results/e2e/screenshots/01-initial-arena.png`
- `test-results/e2e/screenshots/02-top-down.png`
- `test-results/e2e/screenshots/03-bomb-warning.png`
- `test-results/e2e/screenshots/04-after-explosion.png`

Playwright also keeps failure screenshots, video and traces in `test-results/playwright/`, and the HTML report can be opened with:

```bash
npm run test:e2e:report
```
