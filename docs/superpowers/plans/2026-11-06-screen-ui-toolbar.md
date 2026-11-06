# Screen UI Toolbar Implementation Plan

**Goal** Open Screen UI editing from the paintbrush group and give the mode canvas history controls.

**Spec** `docs/superpowers/specs/2026-11-06-screen-ui-toolbar-design.md`

- [x] Test the preview session before adding unselected entry, grouped gestures and undo and redo to `screen-ui-preview.ts`.
- [x] Connect the toolbar in `Toolbar.tsx` and `Viewport.tsx`. Share the Inspector's entry and exit behaviour and retain its draft protections.
- [x] Reuse the movable controls panel for Screen UI history. Wire gesture boundaries in the move and resize handles.
- [x] Verify the local hover, keyboard and touch paths and the hosted action against live browsers.
- [x] Review and commit after approval.
