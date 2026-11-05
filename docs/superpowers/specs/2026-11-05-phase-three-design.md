# Dino GE Phase 3 design

Finish the engine roadmap through three independently testable milestones. Each includes example changes, tests, lint, review and a version bump.

## Approaches

Integrate these features into the existing engine, as selected. Particles use scene ownership and the normal rendering path, physics uses an internal quadtree, and visual effects use the engine frame loop. Separate opt-in systems would give games more control over wiring but would make standard scenes and examples set up the same infrastructure independently.

## Particles

Export a world-space `ParticleEmitter` with explicit bursts, velocity, gravity, lifetime and interpolated size. Particles are visual only. Emitters participate in ordinary scene updates and rendering, respect pause and scene teardown, and cap live particles. Use sparks and dust in Amber Ruins and replace Survival's temporary explosion objects. Test movement and expiry at known times, render size, capacity, pause and teardown.

## Collision broad phase

Use a quadtree within the existing physics system and retain the existing narrow phase and collision events. Derive conservative bounds from world geometry, including scaled circles and objects crossing quadrant boundaries. Preserve pair ordering and check for objects removed during collision callbacks. Refresh candidate bounds after actual collisions so later pairs in the same tick can see changes made by resolution and callbacks, including movement of third parties. Test split boundaries, transformed objects, sparse scenes with hundreds of bodies, collision response and same-tick movement by callbacks. Exercise automatic collision partitioning in the physics examples.

## Scene effects

Provide fade and slide scene transitions through an explicit engine API while retaining immediate assignment to `Engine.currentScene`. Add screen shake and chromatic aberration as time-limited world rendering effects with stable camera coordinates and a usable HUD. Handle scene changes, pauses, resize and destruction. Use transitions in Survival and add impact effects to Survival and Amber Ruins, respecting reduced-motion preferences. Test transition timing, rendering order, cancellation and cleanup.

## Verification and versions

Run Jest, ESLint, workspace builds and relevant browser tests before requesting approval for each commit. Include the version bump with its milestone and keep the root, workspace manifests, internal dependencies and lockfile aligned. Continue the existing beta sequence from `1.14.0-beta.1`. Use capitalised commit messages without prefixes. Each commit needs explicit approval after its change summary.

Local Playground project copies under the ignored `packages/playground/scripts/` tree can affect ESLint's baseline. Keep local project contents intact and distinguish clean-source lint from any local failures.
