---
---
# 9. Read and play Amber Ruins

[Core guide](index.html)

The original Amber Ruins expedition brings the previous chapters together. You move through three rooms, collect relics, avoid spikes and reach the gate.

[Play the original expedition](demos/amber-ruins/index.html?expedition) · [View the demo source](demos/amber-ruins/source.html) · [Read the full game source on GitHub](https://github.com/gledrich/dino-ge/blob/v1.16.0-beta.1/packages/example/amber-ruins/game.js) · [Play the Lanternreach chapter](demos/amber-ruins/index.html)

Start the expedition. Move with WASD, the arrow keys, a gamepad's left stick or the touch arrows. Pick up a relic and watch the counter. Move into another room and watch the world slide beneath the HUD.

| What you see | Where to look in the game |
| --- | --- |
| The rooms and the explorer appear | `loadLevel()` fetches the Tiled export and loads the images before constructing the map, relics and explorer. |
| An arrow key moves you one cell | `update()` calls `move(now)`, which reads input, checks the target tile and updates the player's cell. `animate(now)` makes the sprite travel between the cells. |
| A relic disappears and the counter changes | `collectRelic(now)` checks the current cell, marks the relic invisible, increments the count and triggers sound and particles. `drawHud()` reads the count when it draws. |
| The next room slides into view | `updateCamera(now)` computes a target from the current room and interpolates the camera towards it. |
| A spike costs health | `checkSpikeDamage(now)` checks the current tile and honours a short recovery window. Shake and colour effects give immediate feedback. |
| The gate ends the run | `move(now)` checks the exit and relic count. `finish(won)` changes the phase and the ScreenUI draws the corresponding end card. |

## Follow a single input

Once movement updates the current cell, `collectRelic(now)` looks for a relic at those coordinates. The first few lines of its pickup branch show how one state change drives the feedback:

```js
const relicIndex = relicCells.findIndex(
  ([relicX, relicY]) => relicX === column && relicY === row,
);
const visibility = relics[relicIndex]?.getComponent(VisibilityComponent);
if (visibility?.visible) {
  visibility.visible = false;
  collected++;
  sounds.pickup?.play();
  emitBurst('#ffcf64');
  // The full game also updates the HUD pulse and checks the exit.
}
```

Put a breakpoint inside `collectRelic(now)` and move onto a relic. Inspect the current row and column, then step through the count change. Continue execution and compare the HUD to that count. The HUD draws the result of the game rule. You can change the pickup rule in one place without rewriting the interface.

## See how the larger chapter saves progress

Lanternreach adds a journal, interactions, checkpoints and multiple maps. In [outpost.js](https://github.com/gledrich/dino-ge/blob/v1.16.0-beta.1/packages/example/amber-ruins/outpost.js), look at `interact()` and `checkpoint()`. In [outpost-world.js](https://github.com/gledrich/dino-ge/blob/v1.16.0-beta.1/packages/example/amber-ruins/outpost-world.js), follow `readChapter()`, `newChapter()` and `saveChapter()`. The game decides what gets saved and writes its own data to browser storage.

To build your own variant, start with the [tilemap demo](input-and-tilemaps.html). Add a second room, then decide whether moving into it should pan the camera or activate a new scene.

[Engine API reference](../api/index.html) · [Amber Ruins repository source](https://github.com/gledrich/dino-ge/tree/main/packages/example/amber-ruins)
