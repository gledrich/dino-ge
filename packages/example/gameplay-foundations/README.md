# Gameplay Foundations

From the repository root, build the engine and start the example server.

```sh
npm run build -w dino-ge
npm run example
```

Open [Gameplay Foundations](http://localhost:3001/gameplay-foundations.html).
Select **Replay delivery** to send the explorer to the relay. The explorer
walks, waits at the relay and fades before the status reports completion.

- **Layered Tiled import.** The room includes multiple tile layers, an
  embedded tileset, an external JSON tileset and an object layer.
  `Tilemap.importTiled()` takes the loaded map, images and external descriptor.
  The game reads the explorer spawn point and relay rectangle from the object
  layer, so their positions can be edited in Tiled. The relay rectangle's
  `message` property supplies the final status text.
- **Named sprite clips.** The explorer uses its walk sheet as a named clip.
  Each clip frame has a zero-based sheet index and its own duration in
  milliseconds. The game starts the clip by name and pauses it at the relay.
- **Object actions.** A queue moves the explorer, waits, fades and runs a
  completion callback. Action durations are in seconds. Replay clears pending
  actions and restores the explorer's starting pose.

[Example source](../gameplay-foundations.js) · [Tiled room](./relay-room.tmj) · [External tileset](./tiles/relay.tsj)
