---
---
# 6. Simulate bodies and collisions

[Core guide](index.html)

Use physics when objects should move under velocity or acceleration and respond to contact. The engine's physics system integrates bodies at a fixed interval and checks their geometry for collisions.

[Run the demo](demos/physics-and-collisions/index.html) · [View the source](demos/physics-and-collisions/source.html)

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

## Filter and track contacts

Give each body a category and a mask. A pair can collide when each mask includes at least one bit from the other body's category. The default category is `0x1` and the default mask accepts all 32 bits. A mask of zero excludes all contacts.

```js
const ROVER = 0x1;
const PAD = 0x2;
const GATE = 0x4;

roverPhysics.collisionCategory = ROVER;
roverPhysics.collisionMask = PAD | GATE;
padPhysics.collisionCategory = PAD;
padPhysics.collisionMask = ROVER;
padPhysics.isSensor = true;
```

Use `collisionStart` for the first detected step of an overlap, `collisionStay` for later steps, and `collisionEnd` when the pair separates or stops matching. All three provide `detail.other` and `detail.manifold`. On end, the manifold is the pair's last detected contact. Sensors emit these events without changing either body's motion. The legacy `collision` event still fires on every accepted overlap.

```js
rover.on('collisionStart', ({ detail }) => {
  if (detail.other === pad) lightUp();
});
```

The physics system tracks contacts in the active scene. A direct `Physics.checkCollision(a, b)` applies filters and emits the legacy event without tracking a lifecycle. To try the new events, build dino-ge with `npm run build -w dino-ge`, start `npm run example`, and open [Collision filters](http://localhost:3001/collision-filters.html).

## Explicit colliders and raycasts

Attach a `ColliderComponent` to give an object collision geometry separate from
its artwork. Fixtures use local coordinates. Rectangles start at their
top-left corner, circles at their centre, and strictly convex polygons use
ordered boundary vertices. Several fixtures form one compound. An explicit
collider without a `PhysicsComponent` is static. Circles stay round using the
larger absolute world scale. A zero world scale on either axis disables the
fixtures.

```js
import { ColliderComponent, Physics, Vector2 } from 'dino-ge';

relay.addComponent(new ColliderComponent([
  { kind: 'rectangle', x: 0, y: 12, width: 40, height: 8 },
  { kind: 'circle', x: 48, y: 16, radius: 6 },
]));

const hit = Physics.raycast(new Vector2(0, 40), new Vector2(200, 40), {
  ignore: player,
});
if (hit) console.log(hit.object.metadata.tag, hit.point, hit.normal);
```

Compounds produce one collision event per object pair. The manifold describes
the deepest fixture contact detected in that step. Raycasts read the active
scene or global objects at the time of the call. `Physics.raycastAll` returns
the first boundary hit per fixture in distance order. A ray that starts inside
a fixture reports its exit if the segment reaches it. Use `includeSensors:
true` to include sensor hits. The `mask` and `category` options apply the same
mutual bit filtering as collision detection.

To run the collider lab, build the engine with `npm run build -w dino-ge`
and start the example server with `npm run example` from the repository root.
Open `http://localhost:3001/collider-lab.html` to aim a ray through a compound
and launch a probe past a sensor.

[PhysicsComponent](../api/classes/components_PhysicsComponent.PhysicsComponent.html) · [PhysicsSystem](../api/classes/systems_PhysicsSystem.PhysicsSystem.html) · [CollisionManifold](../api/interfaces/physics_Physics.CollisionManifold.html)
