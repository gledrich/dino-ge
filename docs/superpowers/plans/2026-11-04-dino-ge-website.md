# Dino GE Website Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement and verify each milestone.

**Goal:** Give visitors one site to learn about Dino GE, read the docs and edit a working example.

**Architecture:** Assemble static pages and generated engine assets for the public site. Use an opt-in local integration with the current Playground while implementing browser storage and a separate preview origin.

**Tech Stack:** HTML, CSS, Node, TypeDoc, Vite, IndexedDB and Playwright.

**Spec:** [Website design](../specs/2026-11-04-dino-ge-website-design.md)

- [x] Implement the homepage and quickstart in `website/` and serve them with the current Playground and TypeDoc under the agreed routes. Verify navigation, quickstart rendering and a narrow viewport in a browser. Use an isolated temporary directory for the local Playground files.
- [x] Prove in Chromium that an isolated static preview can load nested modules, URL-based assets and the engine from a read-only project snapshot. Verify an independent second run, denied access to editor storage and a previous run's asset, and asset loading after a forced worker restart.
- [ ] Move public workspace storage into IndexedDB with import and export. Preserve the npm CLI adapter. Route inspector, viewport and console actions through the preview bridge and verify an edit, reload, import, inspection and export flow.
- [ ] Assemble the deployable site and separate preview outputs, including version-matched TypeDoc. Verify with static-only servers and clean browser profiles before handing over deployment.
Creator, accounts and checkout are outside this release.

Each git commit requires prior user approval.

## Preview findings

Run `node website/preview/check.mjs` from the repository root after building the engine and installing Playwright Chromium. It serves two loopback origins with static files. The broker transfers a project snapshot and is removed before the game runs. The preview service worker routes project files by requesting them from the requesting game frame, so a restarted worker does not need a persistent project store. The editor removes the previous frame before preparing another run.

The public editor uses this preview runtime with an explicit broker URL and browser storage. The transport checks passed in Chromium, Firefox and WebKit on separate loopback sites. The browser inspector edits the active preview while paused. These transform edits are temporary, and canvas editing stays in the local Playground. The main checkout owns the separate mobile Playground work. Verify the final HTTPS origins after deployment.
