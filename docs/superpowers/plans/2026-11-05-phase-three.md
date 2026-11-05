# Dino GE Phase 3 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans and test-driven development. Complete each milestone independently.

**Goal:** Complete Phase 3 and exercise each feature through the normal engine and example entry points.

**Architecture:** Follow the engine's scene ownership, fixed-step update, physics and Canvas 2D rendering paths. Keep the new public APIs additive.

**Tech Stack:** TypeScript, Canvas 2D, Jest and Playwright.

**Spec:** docs/superpowers/specs/2026-11-05-phase-three-design.md

## Global Constraints

Preserve immediate scene assignment and existing collision order. Run lint, tests, builds and relevant browser tests. Review each milestone, bump the coordinated beta version and obtain approval before each commit.

## Milestone 1 — Particles

- [ ] Test the public `ParticleEmitter` API in Jest. Pin world position, gravity, capacity, size interpolation and expiry, with engine integration cases for pause, camera visibility and removal.
- [ ] Export a scene-owned `ParticleEmitter` from the engine barrel. Add a fixed-step update and a draw path in the render order that clips particles individually in world space.
- [ ] Use bursts on Amber Ruins pickups and damage. Replace temporary physical particles in Survival with the emitter.
- [ ] Document the API, check both particle roadmap boxes, bump to beta.2 and run verification. Review and request approval for the particle commit.

## Milestone 2 — Collision partitioning

- [ ] Test quadtree splitting and boundary contact. Compare candidate checks on hundreds of separated objects and cover resolution, third-party movement in callbacks and removal during callbacks.
- [ ] Add an internal quadtree to `PhysicsSystem`. Collect conservative world bounds, run candidates in existing order, and refresh bounds after actual collisions.
- [ ] Exercise the default broad phase with the physics examples. Document the collision semantics, check the roadmap box and bump to beta.3. Run verification, review and request approval for the collision commit.

## Milestone 3 — Scene effects

- [ ] Test fade and slide timing, effect ordering relative to UI, pause, resize and effect cleanup.
- [ ] Add fade and slide transitions to the engine and render screen shake and chromatic aberration before the HUD. Preserve direct scene assignment.
- [ ] Use transitions in Survival and impact effects in Survival and Amber Ruins. Respect reduced-motion preferences.
- [ ] Document the API, check both scene effects roadmap boxes and bump to beta.4. Run verification, review and request approval for the scene effects commit.
