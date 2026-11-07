---
---
# 6. Simulate bodies and collisions

[Core guide](index.html)

Use physics when objects should move under velocity or acceleration and respond to contact. The engine's physics system integrates bodies at a fixed interval and checks their geometry for collisions.

[Run the demo](demos/physics-and-collisions/index.html) · [View the source](demos/physics-and-collisions/source.html)

The ball passes through the amber sensor and bounces off the blue wall. **Launch again** repeats the example. **Toggle collision debug** shows collision and velocity information.

## Launch a ball through a sensor

Keep the `<head>` from the [first scene](first-scene.html). Replace the contents of `<body>` with:

```html
<div id="game" style="width: 360px; max-width: 100%; height: 220px"></div>
<button id="launch" disabled>Launch again</button>
<button id="debug">Toggle collision debug</button>
<p id="status" role="status"></p>
```

Save this as `main.js`:

```js
{% include_relative demos/physics-and-collisions/main.js %}
```

The ball, wall and sensor start as visible shapes. Attaching a `PhysicsComponent` lets the engine simulate them. `staticBody(sensor, true)` creates a stationary sensor, which reports overlap without pushing back. `staticBody(wall)` creates a solid stationary body. The ball is dynamic: `body.velocity.set(155, 0)` sends it right at 155 pixels per second. Acceleration is measured in pixels per second squared. Restitution controls bounce, friction resists sliding, and mass affects collision response.

The ball's `collision` handler reads `detail.other` to distinguish the sensor from the wall. Try changing `staticBody(sensor, true)` to `staticBody(sensor)`: now the ball bounces at the amber rectangle. The event is a contact notification and may fire over several steps. A collision manifold describes a contact's geometry, including the normal and depth used to resolve penetration.

Amber Ruins decides whether movement is legal by inspecting a map cell. This demo is based on the repo's Bouncy example and uses overlapping shapes, so the game can react to contacts anywhere in the world.

## Filter and track contacts

Give each body a category and a mask. A pair can collide when each mask includes at least one bit from the other body's category. The default category is `0x1` and the default mask accepts all 32 bits. A mask of zero excludes all contacts.

Keep `staticBody(sensor, true)` in `onLoad()` so the amber rectangle remains a sensor. Remove the `let bounced = false` declaration and the `bounced = false` line inside `launch`. Replace the entire `ball.on('collision', ...)` listener with the following:

```js
const BALL = 0x1;
const SENSOR = 0x2;
const WALL = 0x4;

sensor.getComponent(PhysicsComponent).collisionCategory = SENSOR;
wall.getComponent(PhysicsComponent).collisionCategory = WALL;
body.collisionCategory = BALL;
body.collisionMask = WALL; // Try WALL | SENSOR to allow both contacts.

ball.on('collisionStart', ({ detail }) => {
  if (detail.other === sensor) status.textContent = 'Entered the sensor';
  if (detail.other === wall) status.textContent = 'Hit the wall';
});
ball.on('collisionEnd', ({ detail }) => {
  if (detail.other === sensor) status.textContent = 'Left the sensor';
});
```

Reload. The ball still bounces off the wall, but the sensor reports nothing until you include its bit in the ball's mask. The wall and sensor keep their default masks, which already accept the ball's category.

Use `collisionStart` for the first detected step of an overlap, `collisionStay` for later steps, and `collisionEnd` when the pair separates or stops matching. All three provide `detail.other` and `detail.manifold`. On end, the manifold is the pair's last detected contact. Sensors emit these events without changing either body's motion. The legacy `collision` event still fires on every accepted overlap.

The physics system tracks contacts in the active scene. A direct `Physics.checkCollision(a, b)` applies filters and emits the legacy event without tracking a lifecycle. To try the new events, build dino-ge with `npm run build -w dino-ge`, start `npm run example`, and open [Collision filters](http://localhost:3001/collision-filters.html).

## Explicit colliders and raycasts

Attach a `ColliderComponent` to give an object collision geometry separate from
its artwork. Fixtures use local coordinates. Rectangles start at their
top-left corner, circles at their centre, and strictly convex polygons use
ordered boundary vertices. Several fixtures form one compound. An explicit
collider without a `PhysicsComponent` is static. Circles stay round using the
larger absolute world scale. A zero world scale on either axis disables the
fixtures.

Add `ColliderComponent` and `Physics` to the existing import. Paste the
following after `ball.addComponent(body)` in `onLoad()`. The ray runs
horizontally across the top of the canvas, above the original ball and wall.

```js
const relay = new Rectangle({
  tag: 'relay', position: new Vector2(100, 20),
  width: 60, height: 24, colour: '#578281',
});
relay.addComponent(new ColliderComponent([
  { kind: 'rectangle', x: 0, y: 12, width: 40, height: 8 },
  { kind: 'circle', x: 48, y: 16, radius: 6 },
]));

const hit = Physics.raycast(new Vector2(0, 36), new Vector2(200, 36), {
  ignore: ball,
});
if (hit) {
  console.log(`Hit ${hit.object.metadata.tag} at (${hit.point.x}, ${hit.point.y})`);
  console.log('Surface normal:', hit.normal);
}
```

Reload and open the browser console. The first hit is `relay` at (100, 36),
where the ray meets the left edge of the rectangular fixture. Change both ray
endpoints to y = 22 and reload. The ray now passes through the relay's artwork
without touching either fixture, so nothing is logged.

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
