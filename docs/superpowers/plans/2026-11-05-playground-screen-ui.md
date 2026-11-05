# Screen UI in the Playground Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal** Build live Screen UI inspection, canvas dragging and property editing in three independently reviewable changes.

**Architecture** Observe completed ScreenUI draws in the engine. Present the same run-scoped snapshot in the local Playground and through the hosted preview bridge. Stage visual edits against a specific control and source revision.

**Tech stack** TypeScript, React, Canvas 2D, Acorn, Jest and Playwright.

**Spec** `docs/superpowers/specs/2026-11-05-playground-screen-ui-design.md`

## Global constraints

- Keep gameplay input active during inspection. Suppress game button activation during editing.
- Scope runtime identities to the current run and use only data across the hosted preview boundary.
- Preserve game-state and responsive expressions when applying an edit. Ambiguous and shared draw sites remain preview-only.
- Obtain approval for each commit after presenting the verified change.

## Review focus

- A disappearing control clears its selection, including when another control takes its place in draw order.
- Composite primitives appear as single rows. Text bounds respect alignment and width limits.
- A hosted preview accepts snapshots and edit commands only through the current run and existing origin checks.
- Collapsing the mobile drawer or moving a desktop dock preserves the running game and the selected control.
- Repeating a draw never accumulates a pending offset. Source changes are applied against a verified revision and remain undoable.

## Change 1 — Inspect live Screen UI

- [x] Extend `packages/dino-ge/src/core/ScreenUI.test.ts` to exercise completed snapshots, logical draw calls, optional source capture and updates across frames. Run the focused test before implementing the observer.
- [x] In `ScreenUI.ts` and `Engine.ts`, expose `Engine.observeScreenUI(listener, getSourceIndex?)` with serialisable control geometry and live properties. Collect only while observed. Clear on disposal.
- [x] In `packages/playground/src/utils/screen-ui-preview.ts`, share a run-scoped inspector model between the local engine and the hosted bridge in `browser-preview.ts` and `website/preview/runner.js`. Validate incoming snapshots and translate preview coordinates into viewport coordinates.
- [x] Add the Explorer section, Inspector readout and canvas outline in `packages/playground/src/components/ScreenUITools.tsx` and wire them into the current tool hosts. Route verified source through the existing editor and module navigation.
- [x] Run engine tests, local Playground browser coverage and the hosted checks. Present the verified inspection change for its own commit.

## Change 2 — Drag Screen UI controls

- [x] Add a browser case for a mouse or touch drag and keyboard nudges, a dynamic coordinate, a repeated draw site and Discard. Observe the failure before implementing.
- [x] Add Edit Screen UI, a paused editing overlay and a run-scoped pending position. Preview against original draw options each frame. Validate hosted commands in the isolated runner.
- [x] Apply a verified position edit to the current entry or module draft with one undo step. Preserve computed coordinates with offsets where the call can be verified as unique.
- [x] Verify mouse, touch, keyboard, apply, discard, undo and reload in both Playground versions. Present the drag change separately.

## Change 3 — Edit Screen UI properties

- [x] Add browser coverage for a rectangular resize and kind-specific Inspector edits, including a field driven by game state. Observe the failure before implementing.
- [x] Extend the pending-edit path for rectangular dimensions, label or button text, and relevant visual properties. Keep callbacks and computed game state under game control.
- [x] Verify property edits across both Playground versions and rerun the scene-edit, browser and unit suites. Present the property editing change separately.
