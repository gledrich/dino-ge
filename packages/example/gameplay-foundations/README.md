# Gameplay Foundations

From the repository root, build the engine and start the example server.

```sh
npm run build -w dino-ge
npm run example
```

Open [Gameplay Foundations](http://localhost:3001/gameplay-foundations.html).
Select **Replay delivery** to watch the explorer walk to the relay, wait and fade out.

- **Layered Tiled import.** `Tilemap.importTiled()` loads the room using an
  embedded and an external tileset. The object layer defines the spawn point,
  relay rectangle and completion message.
- **Named sprite clips.** The explorer plays its walk clip while moving and
  pauses it at the relay.
- **Object actions.** A queue moves the explorer, waits, fades and reports
  completion. Replay clears the queue and restores the starting pose.

[Example source](../gameplay-foundations.js) · [Tiled room](./relay-room.tmj) · [External tileset](./tiles/relay.tsj)
