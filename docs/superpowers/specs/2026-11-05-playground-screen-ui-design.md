# Screen UI in the Playground

## Intent

Make game HUDs and menus visible and editable in the same workspace as scene objects. The first change adds live inspection and source navigation. Canvas dragging and property editing follow in separate commits.

## Approaches

- Add a Screen UI section to Explorer and use the existing Inspector and canvas. This keeps the game, its controls and their source in view without adding another dock or mobile tab. This is the proposed layout for the agreed sequence.
- Add a dedicated Screen UI editor. A separate workspace would make sense for tools such as reusable layouts or a large control library. It would add another place to look for the HUD and a separate editing surface to maintain.

## First commit — Inspect live Screen UI

- List the panels, labels, images, buttons and progress bars drawn by the current game under Screen UI in Explorer. Keep the list in draw order and include useful names such as button text and explicit IDs where available. List each button or progress bar once, including when the engine draws it using lower-level primitives.
- Selecting a control outlines its actual screen-space bounds on the canvas and reveals its live properties in Inspector. Measure label bounds using the rendered font, alignment and width limit. The outline follows viewport resizing without changing the game camera, and ordinary game input stays active during inspection.
- Provide View source for a control with a verified project location. A repeated draw site can still be a valid location to read. Resolve hosted locations against the project files from the current run's snapshot. Treat unsaved source changes and a new run as reasons to revalidate the location before opening it.
- Observe completed frames when the Playground requests inspection. Keep functions, images and other runtime handles inside the engine. Send only the serialisable values required to inspect and highlight a control across the hosted preview boundary. Coalesce unchanged snapshots and clear stale controls on restart or when they disappear.
- Track the drawn instance separately from its source call. Amber Ruins draws several audio buttons from the same call in a loop. Preserve selection for a unique explicit control ID within the current run. When an anonymous control cannot be matched reliably across frames, clear the selection instead of transferring it to another control.

## Second commit — Drag controls on the canvas

- Offer an Edit Screen UI action in Inspector in both Playground versions. It pauses gameplay and lets users select and move a control in screen pixels with mouse, touch or keyboard. Preview changes immediately and keep game buttons from firing during a drag. Use the current canvas dimensions and scale so placement agrees with the rendered result.
- Retain pending moves until Apply or Discard. Make a supported move one undoable source edit. For a computed coordinate, preserve its expression and add an offset when the call site can be verified as unique. One observed control in one frame is insufficient proof of uniqueness. Preview moves for shared or ambiguous call sites, with an explanation in Inspector when source application is unavailable.
- Compute preview geometry from the original draw arguments and the current pending edit on every frame. Keep the game's option objects intact.
- Send bounded edit commands to the isolated preview and validate them against its current run and control. Apply writes to the appropriate editor or project module draft in both Playground versions, using the existing save and undo flow.

## Third commit — Edit properties

- Expose control-specific fields in Inspector and resize handles for rectangular controls. Include position, size, text, colours and other fields that make sense for each control kind. Keep callbacks and computed game state such as health under the game's control.
- Reuse the drag commit's preview, apply, discard and undo behaviour. Apply only to a verified source field for the current run and draft. Never replace a responsive or game-state expression with a value sampled from the canvas.

## Verification

Check Amber Ruins and a small project with a repeated draw site, a moving control and a control that appears and disappears. Cover the Express-backed and hosted Playgrounds, desktop and touch layouts, source navigation across project modules, selection across frames, live previews, undo and reload after applying supported edits. Verify that ordinary gameplay, existing scene editing and the mobile drawer remain usable throughout.
