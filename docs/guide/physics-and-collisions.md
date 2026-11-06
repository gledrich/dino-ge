---
---
# 6. Simulate bodies and collisions

[Core guide](index.html)

Use physics when objects should move under velocity or acceleration and respond to contact. The engine's physics system integrates bodies at a fixed interval and checks their geometry for collisions.

[Run the demo](demos/physics-and-collisions/index.html) · [View the source](demos/physics-and-collisions/main.js)

The ball passes through the amber sensor and bounces off the blue wall. **Launch again** repeats the example. **Toggle collision debug** shows collision and velocity information.

```js
function staticBody(object, isSensor = false) {
  const physics = new PhysicsComponent();
  physics.isStatic = true;
  physics.isSensor = isSensor;
  physics.restitution = 1;
  object.addComponent(physics);
}
```

A static body stays in place. A sensor reports overlap without applying physical response. A dynamic body uses velocity in pixels per second and acceleration in pixels per second squared. Restitution controls bounce. Friction resists sliding, and mass affects collision response.

Listen with `ball.on('collision', ({ detail }) => { ... })`. Use `detail.other` to identify the other object and write game rules such as scoring or damage. Treat the event as a contact notification. An overlap can persist over several steps, so guard one-shot reactions with game state. A collision manifold describes a contact's geometry, including the normal and depth used to resolve penetration.

Amber Ruins decides whether movement is legal by inspecting a map cell. This demo is based on the repo's Bouncy example and uses overlapping shapes, so the game can react to contacts anywhere in the world.

[PhysicsComponent](../api/classes/components_PhysicsComponent.PhysicsComponent.html) · [PhysicsSystem](../api/classes/systems_PhysicsSystem.PhysicsSystem.html) · [CollisionManifold](../api/interfaces/physics_Physics.CollisionManifold.html)
