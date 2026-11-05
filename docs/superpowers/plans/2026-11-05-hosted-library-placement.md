# Hosted Library placement implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal** Place Library shapes and project sprites in the running hosted game, with matching draft edits and shared undo and redo.

**Architecture** The editor owns the Library interaction, source validation and draft history. An isolated runner owns camera projection and run-scoped object handles. Prepare, create and finalise messages coordinate an undoable source edit with the live object.

**Tech stack** TypeScript, React, Monaco, Canvas 2D, the Dino GE engine, browser messaging and Playwright.

**Spec** `docs/superpowers/specs/2026-11-05-hosted-library-placement-design.md`

## Constraints

- Preserve the preview origin, existing browser workspace, desktop and mobile docks, and code-only insertion paths.
- Run placement requests only against the current preview. Send allow-listed data and bounded image blobs across the frame boundary.
- Validate a source-backed Engine entry or a verified named scene declared in the entry before changing the draft. Preserve source mappings when instrumenting the entry.
- Request commit approval after presenting the verified change.

## Tasks

- [x] Add hosted browser regressions for a shape and project sprite, source application, live object identity, undo and redo, and an unchanged game run. Confirm the first test fails against the snippet-only build.
- [x] Add isolated placement handling in `website/preview/placement.js` and connect it to `runner.js`. Validate prepare, create, finalise, cancel and visibility commands. Publish canvas bounds independently of Screen UI and include the selected object in capped snapshots.
- [x] Expose a run-scoped placement connection in `browser-preview.ts`. Route replies through existing origin and source checks and reject outstanding requests on disposal. Carry the executed instrumented entry alongside its original source for navigation.
- [x] Reuse Library and Assets gestures in the hosted viewport. Clip the drop surface to the visible canvas, add a guide, and reuse the source snippet defaults for placement.
- [x] Use the existing AST insertion and Monaco transactions for the matching draft edit. Roll back preview creation if the run or draft changes. Keep placed objects and draft history in sync.
- [x] Verify desktop and mobile placement, stale-draft rollback, named scenes and source edits. Run the unit and Playground browser suites, run the hosted checks against an isolated local build, and capture the finished workflow.
