# Dino GE Core Guide Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline implementation, or superpowers:subagent-driven-development if the user chooses delegation. Steps use checkboxes for tracking.

**Goal:** Create a GitHub Pages guide that teaches the core principles of Dino GE through short examples and ends with a playable Amber Ruins walkthrough.

**Architecture:** Link a single guide index from the existing docs homepage. Use small, independent browser demos for each chapter and a capstone that traces the same concepts through the full game. The generated API reference supplies signatures and complete member lists.

**Tech Stack:** Markdown, HTML, JavaScript ES modules, the existing Dino GE workspace build, TypeDoc and Playwright.

**Spec:** This plan captures the requested scope and the proposed guide design below. The audience is readers who know basic JavaScript and are new to Dino GE. Amber Ruins is the thread through the guide. The Bouncy and Dino Survival examples fill gaps where the ruins do not demonstrate the engine feature directly.

## Global constraints

- Use British English. Retain the existing Dino Survival example and API reference links.
- Use the GitHub Pages docs source under `docs/`. Keep links, imports and asset paths valid under the `/dino-ge/` project prefix. Confirm the Pages publishing source before deciding how examples and built modules enter its output. This checkout's README links to that site, but its checked-in workflows do not establish its deployment source.
- Use the public API exported by `packages/dino-ge/src/index.ts`. Match the runtime, reference and guide to the same engine version. Explain game-specific rules as application code, including Amber Ruins' map passability and Lanternreach's browser saves.
- Follow the existing Node version in `.nvmrc`. Use small local assets and existing engine code. Record where borrowed assets and code came from.
- Every chapter includes an observable outcome, controls, a runnable source link, a focused excerpt from that source, a short explanation of the principle, and relevant API links. Keep the demos independent so a reader can start at any chapter.
- Summarise changes and obtain explicit approval before any commit. Use capitalised commit subjects without prefixes. Obtain separate permission before pushing.

## File map

- Modify `docs/index.md` to link to the guide and group the existing example under Examples.
- Create `docs/guide/index.md` for prerequisites, the chapter order and links.
- Create one Markdown chapter per row below in `docs/guide/`. Use `docs/guide/demos/<slug>/index.html` and `main.js` for the corresponding runnable example. Keep fixtures in that demo directory unless multiple demos need the same fixture, in which case use `docs/guide/demos/assets/`.
- Generate `guide/demos/engine/` in the Pages output from `packages/dino-ge/dist/`. Demo HTML maps the bare `dino-ge` import to `../engine/index.js`. Keep generated modules out of authored demo code.

## Chapter and example map

| Chapter file | Principles and public API | Runnable outcome and source |
| --- | --- | --- |
| `first-scene.md` | Install and import, browser canvas, `Engine` setup and callbacks, `Scene` lifecycle, frame timing, pause and teardown | Draw and move a rectangle, pause it, then restart without creating a second canvas or update loop. Use `website/docs/first-scene.js` as a starting point. |
| `objects-and-components.md` | `GameObject`, `Component`, `System`, built-in rendering and physics systems, tags, bounds, visibility, `Group`, transform hierarchy, `Vector2`, local and world coordinates, object and engine events | Build a sign with a child marker and a small custom component and system. Moving the parent moves the marker, and a toggle changes visibility through an event. Use the engine's component and system tests and Dino Survival's hierarchy examples. |
| `drawing-and-animation.md` | `Loader` queue and progress, `Sprite` sheets and animation, `Rectangle`, `Circle`, `Line`, world-space `Text`, render order and visibility | Animate the explorer and walk behind a foreground prop. Label the scene with a world-space sign and demonstrate primitives as markers. Use `makeSprite()` and `animate()` in Amber Ruins' `game.js`. |
| `input-and-tilemaps.md` | Keyboard and pointer input, gamepad axes, touch controls, held input versus one interaction, tile and world coordinates, `Tilemap.fromTiled()`, tile layers and passability | Walk around a one-room Tiled map. A wall blocks movement and a relic can be collected once. Use `loadLevel()`, `move()` and `collectRelic()` in `game.js`. Explain the chapter's grid rules before introducing physics. |
| `camera-and-scenes.md` | `Engine.camera`, camera position and follow, viewport bounds, resize, scene ownership, `Engine.currentScene` and `transitionTo()` | Cross a room boundary and watch the camera pan, then trigger a scene transition through an exit. Use `updateCamera()` in Amber Ruins and the scene effects example in `packages/example/index.js` for the transition API. |
| `physics-and-collisions.md` | `PhysicsComponent`, velocity and acceleration, static bodies and sensors, collision events, response and manifolds, physics debug vectors and contact display | Bounce a ball off a solid wall and pass through a sensor that reports contact. Use `packages/example/bouncy.js` and Dino Survival's collision handler. |
| `hud-audio-and-effects.md` | Screen versus world coordinates, `ScreenUI` anchors, panels, labels, images, buttons and progress bars, `Sound` unlock, playback, channels and volume, `ParticleEmitter`, shake and chromatic aberration | Collect a relic to update a fixed HUD and trigger a particle burst. Start audio from an explicit interaction, then mute it. A separate hazard demonstrates shake. Use the HUD, audio, pickup and damage functions in `game.js`. |
| `debugging-and-tools.md` | Debug and pause controls, object selection and inspection, viewport geometry and snapping, ScreenUI observation and editing as tooling APIs, runtime errors and cleanup | Pause a small scene, inspect an object, and visualise bounds and grid snapping. Explain which operations come from the Playground and link to the applicable API pages and existing Playground entry point. |
| `amber-ruins.md` | Putting the systems together, game state, pickups, hazards, progression and optional browser persistence | Trace boot → input → tile check → pickup → HUD/audio → exit in the original expedition. Link the full game and the focused demos. Use `outpost.js` and `outpost-world.js` for a separate note on the Lanternreach chapter's save flow. |

## Review focus

- Test routes with a real `/dino-ge/` prefix so leading slashes cannot silently break assets or API links.
- Start demos from a fresh browser context so the guide works without cached assets or saves.
- Test audio from a user gesture and verify the pickup still works with audio muted.
- Check a narrow viewport and touch controls, and verify keyboard movement without trapping page navigation.
- Compare source, browser demo and reference versions so no chapter teaches unavailable APIs.

## Implementation tasks

### 1. Verify the Pages source and establish the first playable chapter

- [ ] Confirm the Pages repository, publishing branch or workflow and source directory. Record the staging command and output directory in the repo's docs instructions. Build the engine with `rtk npm run build -w dino-ge` and stage its entire `dist/` module tree at `guide/demos/engine/` in the Pages output.
- [ ] Add the guide entry to `docs/index.md`, the guide index, and the first scene chapter and demo from the chapter map. Initially link only the chapters available in the staged output.
- [ ] Serve the staged output at `/dino-ge/` and open the guide from the docs homepage. Verify the first demo loads in a fresh browser, movement stops during pause, restart leaves one canvas, and the existing links still resolve.

### 2. Teach objects, rendering and movement

- [ ] Add the objects, drawing and input chapters with their independently runnable demos. Link each as it lands. Copy only the assets used by those examples.
- [ ] Verify parent movement, a visible animation and correct foreground layering, a wall that blocks the explorer, and a pickup that changes state once. Run the map demo with keyboard input and touch controls on a narrow viewport. Document the equivalent gamepad input and verify it with a connected controller or a test stub.

### 3. Teach camera, physics, feedback and debugging

- [ ] Add the remaining focused chapters and demos. Keep the physics sensor example separate from the grid demo and explain how each decides whether an object can move.
- [ ] Verify the camera changes rooms and the scene switches after the transition. Check that the solid wall bounces the ball and the sensor reports contact without blocking it. Verify the HUD stays fixed as the camera moves, pickup works while muted, and the debug example shows the expected bounds and grid snap.

### 4. Connect the complete game and audit coverage

- [ ] Write the Amber Ruins capstone. Link to the full game with the correct entry point for the original expedition. If that URL is unavailable, stage the existing game and assets in the verified Pages output. Link Lanternreach separately and identify which code owns its saves.
- [ ] Walk the public exports in `packages/dino-ge/src/index.ts` and assign each core concept a chapter and runnable example. Link individual configuration types and editor integration APIs to TypeDoc from the related chapter. Confirm the installed package version in the first chapter matches the staged build and reference.
- [ ] Run `rtk npm run lint` and `rtk npm run build -w dino-ge`. Generate TypeDoc to a temporary directory with `rtk npm run docs -w dino-ge -- --out /tmp/dino-ge-guide-api` and use that output for the local Pages check. Run `rtk npm run test:example` for the complete-game regressions. On the staged site, check every guide, source, asset and reference link under `/dino-ge/`, and run each demo in Chromium and WebKit. Report manual checks separately from automated results.
- [ ] Present the changed files and verification results for review. Keep any proposed commits split by working chapter group and wait for explicit approval before committing.

## Implementation decisions

- GitHub's generated `pages-build-deployment` workflow builds the Jekyll docs on `main`. The checked-in `publish.yml` publishes npm packages. Keep that separation. The hosted demos pin the npm engine and matching Amber Ruins release sources. The local `docs:pages` build substitutes workspace-built modules and local assets, and generates the matching API reference.
- The engine has no public custom-system registration API. The components demo invokes the example system from the engine's update callback.
- The capstone plays both existing versions of Amber Ruins using the same game modules as the repository examples. It uses the original expedition for the main walkthrough and Lanternreach for the persistence example.
