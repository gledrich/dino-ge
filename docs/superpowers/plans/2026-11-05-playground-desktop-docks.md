# Playground desktop docks implementation plan

> **For agentic workers:** Implement and verify one task at a time using the Superpowers test-driven development and verification skills.

**Goal** Build three resizable desktop docks that let users move their tools without interrupting their work.

**Architecture** Keep desktop dock state in one validated, browser-local model. Mount each tool once and move its stable portal host between slots. Keep the viewport mounted, and keep mobile drawer preferences separate.

**Tech stack** React, TypeScript, react-resizable-panels, Jest and Playwright.

**Spec** `docs/superpowers/specs/2026-11-05-playground-desktop-docks-design.md`

## Constraints

- The default desktop has Explorer left, Editor and Inspector right, Console below the canvas.
- The mobile drawer remains an overlay and preserves the full game dimensions.
- Existing object, sprite and file drop types remain separate from dock tabs.
- Use British English and small commits with capitalised subjects.

## Review focus

- Missing, duplicated and unknown tools in stored layouts restore a valid workspace.
- Moving the active or last tab leaves a valid selection and a reachable empty dock.
- The same canvas and Monaco model survive tool movement and viewport changes.
- An explicit source or review action finds its tool after it has moved.
- Resizing and minimising the mobile drawer leave desktop preferences intact.

## Task 1. Model and validate the desktop layout

Files `packages/playground/src/utils/workspace-docks.ts` and `workspace-docks.test.ts`.

- [ ] Add Jest cases for default positions, duplicate and missing tools, invalid sizes, active-tab replacement, reorder, empty destinations and unchanged moves.
- [ ] Run the focused tests before implementation.
- [ ] Implement `readDesktopLayout(value: unknown): DesktopLayout`, `moveDockTab(layout, tab, destination, index): DesktopLayout` and `selectDockTab(layout, tab): DesktopLayout`. Use left, right and bottom as the dock IDs.
- [ ] Run the focused tests and commit the model.

## Task 2. Render the workspace and route tool actions

Files `App.tsx`, `App.css`, `context/PlaygroundContext.tsx`, `hooks/useWorkspaceDocks.ts`, `components/WorkspaceDock.tsx`, `Editor.tsx`, `Inspector.tsx`, `Sidebar.tsx`, `SceneExplorer.tsx`, `Viewport.tsx` and `e2e/editor.spec.ts`.

- [ ] Add browser tests for default dock positions, isolated mobile settings, preserved canvas and draft, and explicit tool actions.
- [ ] Run the targeted tests against the existing layout.
- [ ] Render stable tool hosts and a reusable tab strip in fixed desktop locations and the mobile drawer. Store desktop layout changes under `dino-ge-playground-docks-v1`. Route tool actions through `openTool(tab)` and keep the game controls and mobile overlay in place.
- [ ] Adapt existing browser assertions to select the tool they use, while preserving the underlying game, editing and save assertions. Run the focused tests and commit the workspace integration.

## Task 3. Move and reorder tools

Files `App.tsx`, `App.css`, `components/WorkspaceDock.tsx` and `e2e/editor.spec.ts`.

- [ ] Add browser tests for dragging within a dock, moving to another dock and into an empty dock, moving by keyboard, saving and resetting the arrangement.
- [ ] Run the targeted tests before implementing the move controls.
- [ ] Add the `application/x-dino-workspace-tab` drag type, an insertion indicator and reachable collapsed or empty dock destinations. Give the active tab a keyboard-accessible move control and restore focus to the moved tab. Provide a reset action in the same control.
- [ ] Run the targeted tests and commit the move controls.

## Task 4. Verify the workspace and refresh the README

Files `packages/playground/README.md`, `assets/preview.png`, `assets/editor.png`, `assets/inspector.png` and the existing browser screenshot baselines under `e2e/`.

- [ ] Run the build, scoped lint, unit tests and complete Chromium, Firefox and WebKit suites. Review intentional visual baseline changes against the actual browser output.
- [ ] Check a real session with a running game, a pending draft, a dock move, a Library drop and a breakpoint round trip. Check mobile touch resizing and placement with emulation.
- [ ] Capture and inspect the new desktop overview, Editor and Inspector in the browser. Replace the README images and explain dock moves and layout reset.
- [ ] Review the full change and commit the screenshots and README separately.
