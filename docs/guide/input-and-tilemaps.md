---
---
# 4. Read input and walk a tilemap

[Core guide](index.html)

A tilemap divides the world into rows and columns. Keep the player's cell as game state, then convert it to pixels to position the player object.

[Run the demo](demos/input-and-tilemaps/index.html) · [View the source](demos/input-and-tilemaps/source.html) · [View the Tiled map](demos/input-and-tilemaps/room.tmj)

Focus the map and use the arrow keys or a gamepad's left stick. The four buttons also work with touch and the keyboard. Try moving right first, then go down and around the wall to collect the relic.

```js
const x = column + dx;
const y = row + dy;
const tile = map.data[y]?.[x];
if (tile === undefined || tile === wall) {
  status.textContent = 'Blocked by a wall';
  return;
}
column = x;
row = y;
```

The demo reads held keys with `Input.isKeyDown()` and samples `Input.getGamepadAxes()` once each update. A dead zone ignores small stick movements. A timer limits held input to one step every 150 milliseconds. A button click calls `move()` once. For actions such as opening a journal, use a press or track the change from released to pressed instead of repeating while held. Screen buttons can handle pointer or touch interaction. For custom pointer handling, check which coordinate space an input method returns before comparing it to a world position.

`Tilemap.fromTiled()` accepts a finite orthogonal map with square tiles, one unencoded tile layer and one embedded tileset. In the exported file, GIDs start at the tileset's `firstgid`. The engine converts them to zero-based indices and uses `-1` for empty cells. The demo's wall index is `1` after conversion. Its game code decides which cells block movement.

At 32 pixels per tile, the centre of column 1 is at x = 48. Offset by the player's radius when placing a circle, because its position is its top-left corner. When the player reaches the relic's cell, the demo removes the relic and clears the reference so the pickup cannot fire again.

## Import a layered room

Use `Tilemap.importTiled()` when your finite orthogonal JSON map has several
tile layers, more than one atlas or an object layer. Use square tiles and
export tile data as numeric arrays. The caller loads the atlas images and
external JSON descriptors. The importer keeps the authored layer
order and exposes point and axis-aligned rectangle objects with their custom
properties. Use those objects to place spawns, triggers or other game objects.

The Gameplay Foundations example places its explorer at an authored point and
uses an authored relay rectangle as the destination for a scripted delivery.
Build dino-ge with `npm run build -w dino-ge`, start `npm run example`, then open
`http://localhost:3001/gameplay-foundations.html`.

[Input](../api/classes/core_Input.Input.html) · [Tilemap](../api/classes/objects_Tilemap.Tilemap.html)
