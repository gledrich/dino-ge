---
---
# 4. Read input and walk a tilemap

[Core guide](index.html)

A tilemap divides the world into rows and columns. Keep the player's cell as game state, then convert it to pixels to position the player object.

[Run the demo](demos/input-and-tilemaps/index.html) · [View the source](demos/input-and-tilemaps/source.html) · [View the Tiled map](demos/input-and-tilemaps/room.tmj)

Focus the map and use the arrow keys or a gamepad's left stick. The four buttons also work with touch and the keyboard. Try moving right first, then go down and around the wall to collect the relic.

## Load a room and move one cell at a time

Keep the `<head>` from the [first scene](first-scene.html). Download [room.tmj](demos/input-and-tilemaps/room.tmj) and [tiles.svg](demos/input-and-tilemaps/tiles.svg) beside `index.html`. The first file is a Tiled JSON map; the second is the image that contains both floor and wall tiles. Replace the contents of `<body>` with:

```html
<div id="game" tabindex="0" role="region" aria-label="Tilemap game"
     style="width: 360px; max-width: 100%; height: 220px"></div>
<button data-step="0,-1">Up</button>
<button data-step="-1,0">Left</button>
<button data-step="1,0">Right</button>
<button data-step="0,1">Down</button>
<p id="status" role="status"></p>
```

Save this as `main.js`:

```js
{% include_relative demos/input-and-tilemaps/main.js %}
```

The map starts at column 0, row 0. The explorer starts at (1, 1) in grid coordinates. `move(dx, dy)` adds a direction to that cell, then looks up the destination with `map.data[row][column]` (rows first). If the destination is outside the map or is a wall, it returns before changing the player's cell.

The demo reads held keys with `Input.isKeyDown()` and samples `Input.getGamepadAxes()` each time it is ready to move. A dead zone ignores small stick movements. A timer limits held input to one step every 150 milliseconds. The `tabindex` lets you focus the game region; the update checks that focus before consuming arrow keys. A button click calls `move()` once. For actions such as opening a journal, use a press or track the change from released to pressed instead of repeating while held. For custom pointer handling, check which coordinate space an input method returns before comparing it to a world position.

`Tilemap.fromTiled()` accepts a finite orthogonal map with square tiles, one unencoded tile layer and one embedded tileset. In the exported file, GIDs start at the tileset's `firstgid`. The engine converts them to zero-based indices and uses `-1` for empty cells. The demo's wall index is `1` after conversion. Its game code decides which cells block movement.

At 32 pixels per tile, the centre of column 1 is at x = 48. Offset by the player's radius when placing a circle, because its position is its top-left corner. When the player reaches the relic's cell, the demo removes the relic and clears the reference so the pickup cannot fire again.

## Import a layered room

Use `Tilemap.importTiled()` when your finite orthogonal JSON map has several
tile layers, more than one atlas or an object layer. Use square tiles and
export tile data as numeric arrays. The caller loads the atlas images and
external JSON descriptors. The importer keeps the authored layer
order and exposes point and axis-aligned rectangle objects with their custom
properties. Use those objects to place spawns, triggers or other game objects.

Try the layered importer with the same room. Replace the `map = Tilemap.fromTiled(...)`
line in `onLoad()` with the following, leaving the image load and circle
creation in place:

```js
const room = Tilemap.importTiled(await response.json(), {
  position: new Vector2(0, 0),
  resolveImage: () => 'tiles', // This room has one atlas, already loaded above.
});
const ground = room.layers.find(layer => layer.type === 'tilelayer' && layer.name === 'Ground');
map = ground.tilemaps[0].tilemap;
```

The importer returns a description of the room, including the drawable
tilemaps in each layer. Here, `map` still refers to the drawable ground
tilemap, so the existing movement and wall checks work after reloading.

The Gameplay Foundations example places its explorer at an authored point and
uses an authored relay rectangle as the destination for a scripted delivery.
Build dino-ge with `npm run build -w dino-ge`, start `npm run example`, then open
`http://localhost:3001/gameplay-foundations.html`.

## Build static bodies from tile collision shapes

Use the Tiled Tile Collision Editor to draw fixtures on a tileset tile. Set
`readTileCollision: true` when importing the map to read those shapes from
embedded and external tilesets. The tileset's `tileCollision` map stores them in
tile-local pixels under the same local IDs as `tilemap.data`.

The helper creates detached static bodies from the layer's current tile data
and world transforms. Each occupied cell with fixtures produces one body.
Choose the layers to include and add the bodies to the scene. After editing
tiles or moving the layer, remove the old bodies and build new ones to update
the collisions.

The importer accepts rectangles, circles drawn as equal-sided ellipses and
strictly convex polygons. Authored rotations are applied in tile space.
Unsupported shapes raise an import error with their tileset and tile ID
when collision parsing is enabled.

The guide's simple room has no authored collision shapes. To try one that
does, use [tiled-collision.js](https://github.com/gledrich/dino-ge/blob/v1.16.0/packages/example/tiled-collision.js)
from the repository. In its `setup()` function, after the import with
`readTileCollision: true`, the example finds the ground layer and registers
the generated bodies:

```js
const ground = room.layers.find(layer => layer.type === 'tilelayer' && layer.name === 'Ground');
if (!ground) throw new Error('The relay room needs a Ground tile layer.');
for (const body of createTiledColliders(ground)) body.registerSelf();
```

`registerSelf()` makes the bodies available to the physics system. If your
game uses a scene, you can use `this.add(body)` in that scene's `onLoad()`
instead. The example then launches a probe with a physics velocity, so the
physics system detects its contact with the tile shape.

To run it from a checkout, build dino-ge with `npm run build -w dino-ge`, start
`npm run example` and open [Tiled tile collisions](http://localhost:3001/tiled-collision.html).
Launch a probe through the relay housing and then along the same tile's top
edge. Only the path through the authored polygon hits a collider.

## Bind movement by name

Use `Input.setActions()` to map keys and gamepad controls to the same game
action. In the chapter's `main.js`, add these bindings just before `new Engine(...)`.
Left and up contribute negative values; right and down contribute positive
values. Axes 0 and 1 are the standard gamepad's left stick.

```js
Input.setActions({
  moveX: [{ key: 'ArrowLeft', scale: -1 }, { key: 'ArrowRight' }, { axis: 0 }],
  moveY: [{ key: 'ArrowUp', scale: -1 }, { key: 'ArrowDown' }, { axis: 1 }],
});
```

Replace the `update()` callback in the same file with:

```js
update() {
  if (!explorer || document.activeElement !== game || performance.now() < nextStep) return;
  const dx = Math.sign(Input.getActionValue('moveX'));
  const dy = Math.sign(Input.getActionValue('moveY'));
  if (!dx && !dy) return;
  move(dx, dx ? 0 : dy);
  nextStep = performance.now() + 150;
},
```

Reload, focus the map and move with the arrows or the left stick. The
movement rules still live in `move()`. The action value ranges from
−1 to 1, with zero for idle or fully opposing inputs. Gamepad axes ignore
values inside the dead zone, which defaults to 0.2. Use `Input.isActionDown()`
when you only need to know whether the current action value is non-zero.
Bindings are global to `Input` and persist until replaced. Calling
`setActions()` again replaces the bindings, so game logic can keep
using the same names when controls change.

[Input](../api/classes/core_Input.Input.html) · [Tilemap](../api/classes/objects_Tilemap.Tilemap.html)
