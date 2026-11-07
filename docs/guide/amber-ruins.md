---
---
# 9. Read and play Amber Ruins

[Core guide](index.html)

The original Amber Ruins expedition brings the previous chapters together. You move through three rooms, collect relics, avoid spikes and reach the gate.

[Play the original expedition](demos/amber-ruins/index.html?expedition) · [View the demo source](demos/amber-ruins/source.html) · [Read the full game source on GitHub](https://github.com/gledrich/dino-ge/blob/v1.16.0/packages/example/amber-ruins/game.js) · [Play the Lanternreach chapter](demos/amber-ruins/index.html)

Start the expedition. Move with WASD, the arrow keys, a gamepad's left stick or the touch arrows. Pick up a relic and watch the counter. Move into another room and watch the world slide beneath the HUD.

| What you see | Where to look in the game |
| --- | --- |
| The rooms and the explorer appear | `loadLevel()` queues the Tiled export and images with `Loader` before constructing the map, relics and explorer. |
| An arrow key moves you one cell | `update()` calls `move(now)`, which reads input, checks the target tile and updates the player's cell. `animate(now)` eases the sprite between the cells while the named walk clip advances through its four poses. |
| A relic disappears and the counter changes | `collectRelic(now)` checks the current cell, marks the relic invisible, increments the count and triggers sound and particles. `drawHud()` reads the count when it draws. |
| The next room slides into view | `updateCamera(now)` computes a target from the current room and interpolates the camera towards it. |
| A spike costs health | `checkSpikeDamage(now)` checks the current tile and honours a short recovery window. Shake and colour effects give immediate feedback. |
| The gate ends the run | `move(now)` checks the exit and relic count. `finish(won)` changes the phase and the ScreenUI draws the corresponding end card. |

## Follow a single input

Open `packages/example/amber-ruins/game.js` in a repository checkout. In
`move(now)`, find the assignments to `column` and `row`. They run only after
the destination passes the wall and gate checks. Then `move(now)` calls
`collectRelic(now)` to check the new cell. Here is the full pickup function from
that file, where `relicCells` holds the map coordinates, `relics` holds the
matching sprite objects and `collected` is the running count:

```js
function collectRelic(now) {
  const relicIndex = relicCells.findIndex(
    ([relicX, relicY]) => relicX === column && relicY === row,
  );
  const visibility = relics[relicIndex]?.getComponent(VisibilityComponent);
  if (visibility?.visible) {
    visibility.visible = false;
    collected++;
    sounds.pickup?.play();
    emitBurst('#ffcf64');
    relicPulse = now + 260;
    if (collected === relicCells.length) {
      tilemap.data[exitRow][exitColumn] = floorTile;
      hint = 'The gate is open. Head to the far side of the Amber Vault.';
      sounds.unlock?.play();
    } else {
      hint = 'Amber relic recovered. Keep exploring.';
    }
  }
}
```

`findIndex()` returns `-1` when the cell has no relic, so there is no sprite to
look up. If you revisit a relic's cell, its sprite exists but is no longer
visible. In both cases the count stays the same. On the final pickup, the game
also replaces the gate tile with a floor tile so it can be crossed.

To follow the state change in your own run, add this line immediately after
`collected++` in `collectRelic()`:

```js
console.log('Relic picked up', { column, row, collected, total: relicCells.length });
```

From the repository root, run `npm run build -w dino-ge` and `npm run example`.
Open [Amber Ruins locally](http://localhost:3001/?expedition),
start the expedition, and open the browser console. Tap Right twice, Up once
and Right once to reach the first relic. Tap Left and Right to revisit its
cell. The console logs one pickup and the HUD shows the same count.
Find the `Relics` label in `drawHud()` to see where the interface
reads that value.

## See how the larger chapter saves progress

Lanternreach adds a journal, interactions, checkpoints and multiple maps. In [outpost.js](https://github.com/gledrich/dino-ge/blob/v1.16.0/packages/example/amber-ruins/outpost.js), look at `interact()` and `checkpoint()`. In [outpost-world.js](https://github.com/gledrich/dino-ge/blob/v1.16.0/packages/example/amber-ruins/outpost-world.js), follow `readChapter()`, `newChapter()` and `saveChapter()`. The game decides what gets saved and writes its own data to browser storage.

To build your own variant, start with the [tilemap demo](input-and-tilemaps.html). Add a second room, then decide whether moving into it should pan the camera or activate a new scene.

[Engine API reference](../api/index.html) · [Amber Ruins repository source](https://github.com/gledrich/dino-ge/tree/main/packages/example/amber-ruins)
