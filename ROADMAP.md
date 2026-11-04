# Dino GE Roadmap

This document outlines the planned features and milestones for the **Dino Game Engine (Dino GE)**.

## Phase 1: Short-Term (Foundation & Performance)

- **Input State Management:**
  *   [x] Implement keyboard state tracking (e.g., `Input.isKeyDown('w')`).
  - [x] Add standard gamepad polling and left-stick input with a dead zone.
- **Entity Component System (ECS):**
  *   [x] Implement foundation: `Component`, `PhysicsComponent`, `TransformComponent`, `TagComponent`, `VisibilityComponent`.
  *   [x] Refactor `GameObject` to act as an Entity (Pure ECS access).
  *   [x] Implement `System` architecture and `PhysicsSystem`.
  *   [x] Decouple Rendering logic into `RenderingSystem` and specialized RenderComponents.
  *   [x] Build out global and local Event Bus (PubSub) system.
  *   [x] Refactor Engine loop to use decoupled Systems.
  *   [x] Implement Scene Graph (parent-child hierarchy in `TransformComponent`).
  *   [x] Decouple `GameObject` delegation (direct component access).
  *   [x] Implement `BoundsComponent` and remove monolithic sizing from `GameObject`.
  *   [x] Implement generic prototype-based component indexing (removing special-casing).
- **Collision Resolution:**
  *   [x] Implement robust impulse-based collision response (preventing overlap).
  *   [x] Add restitution (bounciness) and friction support to `PhysicsComponent`.
- **Rendering Optimization:**
  *   [x] Implement Viewport Culling (only draw objects within the `Camera` bounds).
  *   [x] Add support for simple Z-sorting optimizations.

## Phase 2: Medium-Term (Core Game Systems)

- **Audio Manager:**
  - [x] Implement a `Sound` class using the Web Audio API.
  - [x] Support for background music loops and one-off sound effects.
  - [x] Master volume and channel-based volume control.
- **Tilemaps & Maps:**
  - [x] Create a `Tilemap` class to render grid-based levels.
  - [x] Import finite orthogonal Tiled JSON with one embedded tileset and one unencoded tile layer.
- **UI Framework:**
  - [x] Draw screen-space buttons with pointer and keyboard activation.
  - [x] Anchor canvas UI to viewport edges or the centre.
  - [x] Draw screen-space progress bars for health and loading states.

## Phase 3: Long-Term (Advanced Features)

- **Particle System:**
  - [ ] Create a `ParticleEmitter` class for fire, smoke, and explosions.
  - [ ] Support for velocity, gravity, and life-cycle scaling for particles.
- **Spatial Partitioning:**
  - [ ] Implement a Quadtree to handle hundreds of active objects efficiently during collision checks.
- **Scene Effects:**
  - [ ] Add built-in scene transitions (e.g., Fade, Slide).
  - [ ] Implement basic post-processing effects (e.g., Screen Shake, Chromatic Aberration).

---

_Last Updated: April 2026_
