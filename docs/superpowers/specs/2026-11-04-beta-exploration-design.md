# Dino GE beta exploration showcase

## Scope

Release Dino GE and Dino GE Playground together as `1.12.0-beta.1` under npm's `beta` dist-tag. The engine and Playground each need a clean install check and passing CI. The repository example is a new playable exploration game with generated art and sound. The existing Dino Survival demo can remain available as a secondary example.

We considered extending Dino Survival with more waves or building an exploration game. The exploration game was selected. It lets the player discover rooms, collect items and navigate hazards, and gives the tilemap, input and audio APIs distinct jobs.

## Game

Build a compact top-down adventure in a connected ruin with three rooms, a starting point and a locked exit. The player explores with WASD, arrow keys or a standard gamepad. The player must collect one relic in each room and reach the exit. Wall collision constrains movement. Hazards take health with a brief grace period between hits. The game has a start screen, a persistent health and relic display, a win screen, a game-over screen and a restart path. Restart resets health, relics, position and room state.

Use ImageGen for a cohesive set of original 2D game art covering the player, environment, relics and hazards. Use generated sound effects for collecting relics, taking damage and unlocking the exit, plus a looping background track. Start audio from a user gesture and provide mute and volume controls. Keep the game playable with audio muted or unavailable.

## Engine and Playground

- Extend the existing Tilemap API with an importer for finite orthogonal Tiled JSON using a single embedded tileset and tile layer. Use a Tiled export in the showcase. Validate unsupported map variants and malformed data with clear errors.
- Add gamepad polling to Input for connected standard-mapped controllers, including a dead zone and graceful disconnect. Use it for movement in the showcase alongside keyboard input.
- Add a Web Audio Sound API for one-shot playback and looping, with master volume and separate music and effects levels. Exercise both playback modes in the showcase.
- Ship the Playground improvements with the engine beta. Keep script storage within its intended directory, preserve the current editor workflow and verify Dino GE declarations, save and format shortcuts, including after switching scripts.
- Start an empty Playground workspace with an editable copy of Amber Ruins. Never seed a workspace that already has a script or imported game. Use the same game source and assets for both entry points.
- Add an Import game folder control to Playground. Let the user pick a JavaScript entry point and preserve relative files and subdirectories. Reject paths outside the workspace, duplicate project names and oversized uploads. Support browser-native Dino GE modules and assets.
- Animate the explorer with a four-frame walk cycle and smooth movement. Settle into an idle pose on release and respect reduced-motion preferences.
- Amber Ruins owns gameplay and presentation state. Render its HUD, menus and audio controls through public Dino GE canvas APIs. Add reusable screen anchoring, buttons and progress bars to the engine where needed. The standalone HTML hosts the canvas, and the Playground shell remains separate from the game's UI.

## Acceptance

- A clean checkout starts the example from its documented npm command. A browser test covers starting, crossing between rooms, taking damage, collecting the required relics, reaching the exit and restarting. Cover the losing path as well.
- Verify keyboard input and a representative gamepad flow. Verify the art and audio in a real browser, including muted play and user-gesture audio start.
- Cover Tiled import, gamepad polling and audio lifecycle with engine tests. Update the roadmap and package documentation to reflect the implemented behaviour and supported inputs.
- Lint, workspace build, engine tests and the Playground cross-browser suite pass. Pack and install both exact beta versions in a fresh directory, then verify engine imports and Playground launch. The tag-triggered release checks both package versions and publishes under `beta`. Commit and push follow the repository owner's approval process.
- Verify an empty installed Playground starts Amber Ruins and that existing scripts remain available. Import a folder with a nested module and asset, run it, edit its entry and reload it. Test unsafe paths and duplicate names.
- Verify the canvas controls and screen anchoring at narrow and desktop sizes. The game should drive all screen content and actions using engine APIs.
- Use the current patched Node LTS for development, CI and the browser-test container. Update the npm toolchain and production dependencies to compatible stable versions, and verify the installed packages and the locally served editor.
