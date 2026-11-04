# Amber Ruins Beta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Ship a coordinated beta of Dino GE and Playground with a playable, three-room exploration showcase.

**Architecture:** The engine exposes tilemap import, gamepad polling and Web Audio playback independently. Amber Ruins consumes those public APIs, holds game rules and room state in the example workspace, and uses the existing Express example server. Keep the current Dino Survival entry available as a secondary demo.

**Tech Stack:** TypeScript, Jest, Canvas 2D, Web Audio, browser Gamepad API, Tiled JSON, Express and Playwright.

**Spec:** `docs/superpowers/specs/2026-11-04-beta-exploration-design.md`

## Global constraints

- Release both packages at `1.12.0-beta.1` under npm's `beta` tag.
- Preserve existing keyboard and direct Tilemap construction APIs.
- Support play with keyboard or a standard-mapped gamepad and with audio muted or unavailable.
- Use British English. Obtain explicit approval before committing or pushing.

## Review focus

- Reject out-of-range, flipped and encoded Tiled tile IDs without creating a partial map.
- Poll the current gamepad state so disconnects do not leave stale movement.
- Start audio only after a user gesture and handle rejected audio operations.
- Restart clears health, relics and damage grace periods even after a loss.
- The beta Playground installs with its matching engine and without developer scripts.

## Task 1. Import Tiled maps

Files: `packages/dino-ge/src/objects/Tilemap.ts`, adjacent `Tilemap.test.ts`.

- [ ] Add tests for `Tilemap.fromTiled(data: unknown, options: Omit<TilemapProps, 'data' | 'tileSize' | 'tilesetCols'>): Tilemap`. A 2×2 orthogonal map with tile IDs `[0, 1, 2, 0]` and tileset first ID 1 yields `[[-1, 0], [1, -1]]`. Test malformed dimensions, tile counts, unsupported tilesets and flipped tile flags.
- [ ] Confirm the new tests fail. Implement validation for a finite orthogonal map with square tiles, a single embedded tileset and one full-size, unencoded tile layer. Validate before constructing the existing Tilemap.
- [ ] Run `npm test -- --runInBand Tilemap` and the engine build.

## Task 2. Poll standard gamepads

Files: `packages/dino-ge/src/core/Input.ts`, adjacent `Input.test.ts`.

- [ ] Test `Input.getGamepad(index?: number): Gamepad | null` and `Input.getGamepadAxes(index?: number): Vector2`. Cover sparse slots, missing browser API, disconnected and non-standard pads, axes within the 0.2 dead zone, and state after disconnect.
- [ ] Confirm the new tests fail. Implement on-demand polling. An omitted index selects the first connected standard pad. Sample the left stick and zero axes within the dead zone.
- [ ] Run `npm test -- --runInBand Input`.

## Task 3. Add Web Audio

Files: `packages/dino-ge/src/core/Sound.ts`, adjacent `Sound.test.ts`, `packages/dino-ge/src/index.ts`.

- [ ] Test `Sound.unlock(): Promise<boolean>`, `Sound.load(url: string): Promise<Sound>`, `Sound.setVolume(channel: 'master' | 'music' | 'effects', level: number): void` and instance `play(options?: { loop?: boolean; channel?: 'music' | 'effects' }): () => void`. Cover channel routing, repeated one-shots, stopping loops, decode failure and an unavailable or suspended context.
- [ ] Confirm the new tests fail. Implement lazy context creation, one source per playback, gain buses and a stop callback that is safe to call twice. Keep autoplay policy handling at the user's start gesture.
- [ ] Run `npm test -- --runInBand Sound` and the engine build.

## Task 4. Build and verify Amber Ruins

Files: `packages/example/amber-ruins/`, `packages/example/index.html`, `packages/example/e2e/amber-ruins.spec.ts`, and the example Playwright configuration.

- [ ] Generate original tiles, a dinosaur explorer, relic and hazards based on the approved visual reference. Create original audio for pickup, damage, unlock and a background loop. Store the assets beside the game and document how they were generated.
- [ ] Add Playwright coverage for the start screen, wall collision, room traversal, three relic pickups, damage, locked and unlocked exit, loss, restart, simulated gamepad movement and mute. Verify the checks fail before the game is built.
- [ ] Build the three connected rooms as a finite Tiled map. Use the exported engine APIs for rendering, input and sound. Add health and relic HUD, restart after win or loss, and music/effects volume controls. Make Amber Ruins the example landing page while retaining the existing demo at a secondary URL.
- [ ] Run the example in Chromium, Firefox and WebKit. Check the gameplay frame at desktop and narrow widths and listen to the music and all three cues in a real browser.

## Task 5. Verify and release both packages

Files: root and package READMEs, `ROADMAP.md`, release workflow and workspace manifests if changed by the implementation.

- [ ] Document the showcase command, controls and supported engine APIs. Mark only implemented roadmap items complete.
- [ ] Run `npm run lint`, `npm run build`, `npm test -- --runInBand`, the example Playwright suite and `npm run test:e2e:docker`.
- [ ] Pack both exact beta versions from clean source. Install both tarballs into an empty directory, compile an engine import and launch the installed Playground CLI. Confirm the archive excludes local scripts.
- [ ] Summarise the verified changes and obtain approval before committing. Obtain push approval before pushing the release commit and matching tag. Verify the publish workflow and both npm `beta` dist-tags after release.
