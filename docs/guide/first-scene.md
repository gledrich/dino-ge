---
---
# 1. Build a first scene

[Core guide](index.html)

A game loop reads input, advances the game state and draws the result. Start with a scene that owns one object and a fixed update that moves it a little each step.

[Run the demo](demos/first-scene/index.html) · [View the source](demos/first-scene/main.js)

The explorer moves across the canvas. Select **Pause** to freeze it, then **Resume** to continue. **Restart** replaces the engine and starts the explorer at the left again.

## Set up a project

In a browser project with a bundler, install the guide's engine version:

```sh
npm install dino-ge@1.15.0-beta.5
```

Add a container such as `<div id="game" style="width: 100%; height: 220px"></div>` to your HTML and load your game script as a module. The bundler resolves the bare import `dino-ge`. The browser demos use an import map for the same import. Serve modules over HTTP when working locally.

```js
import { Circle, Engine, Scene, Vector2 } from 'dino-ge';

class Clearing extends Scene {
  onLoad() {
    this.explorer = new Circle({ position: new Vector2(24, 80), radius: 12, colour: '#ffc46f' });
    this.add(this.explorer);
  }
}
```

Create the scene, then set `Engine.currentScene` in the engine's `onLoad()` callback. The engine creates and sizes a canvas inside the container identified by `containerId`. Give percentage-sized canvases a parent with a defined height.

## Choose when work runs

- Engine `onLoad()` sets up the game once. Scene `onLoad()` populates a scene when it becomes active.
- Engine and scene `update()` run on unpaused frames. Use elapsed time for frame-based movement so that speed stays consistent across displays.
- Engine `fixedUpdate()` runs at the simulation rate, currently 60 steps per second. The demo moves two pixels per step, or about 120 pixels per second.
- `drawUI(ui)` draws the interface after the world. Use it to display state rather than to advance the simulation.
- `Engine.paused` freezes gameplay updates. Call `game.terminate()` when replacing a running game and release your own resources in `onDispose()`.

Try doubling the movement per step. The explorer travels twice as fast even though you haven't changed the draw rate.

[Engine](../api/classes/core_Engine.Engine.html) · [Scene](../api/classes/core_Scene.Scene.html) · [Canvas](../api/classes/core_Canvas.Canvas.html)
