---
---
# 1. Build a first scene

[Core guide](index.html)

Dino GE runs a 2D game in a browser. The **engine** creates a canvas (the HTML element it draws into) and runs the game loop. The loop reads input, updates the game and draws the result. A **scene** holds the objects for one part of the game, such as a level or a menu. Start with one scene and a circle to represent the explorer.

[Run the demo](demos/first-scene/index.html) · [View the source](demos/first-scene/source.html)

The explorer moves across the canvas. Select **Pause** to freeze it, then **Resume** to continue. **Restart** replaces the engine and starts the explorer at the left again.

## Create the page

Create a folder and save this as `index.html`. The import map tells the browser where to find the module named `dino-ge`. Load it before the module script that imports the engine.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>My first Dino GE game</title>
  <script type="importmap">
    {
      "imports": {
        "dino-ge": "https://cdn.jsdelivr.net/npm/dino-ge@1.16.0/dist/index.js"
      }
    }
  </script>
  <script type="module" src="./main.js"></script>
</head>
<body>
  <div id="game" style="width: 360px; max-width: 100%; height: 220px"></div>
  <button id="pause">Pause</button>
  <button id="restart">Restart</button>
  <p id="status" role="status"></p>
</body>
</html>
```

## Create and activate the scene

Save the following as `main.js` beside `index.html`. The `start()` function creates a fresh `Clearing`, starts the engine, then activates that same scene in the engine's `onLoad()` callback. Activation calls `Clearing.onLoad()`, which creates and adds the circle. The fixed update can now move it through `clearing.explorer`.

```js
{% include_relative demos/first-scene/main.js %}
```

The `containerId: 'game'` option matches the HTML element's `id="game"`. The engine inserts the canvas and sizes it to that container, so give the container a height. `Vector2(24, 80)` stores an x and y position in pixels. With the default camera, x increases to the right and y increases downwards from the top left.

From the folder containing both files, run `npx serve .` (requires Node.js and npm), then open the local URL it prints. The canvas should show a circle moving right and wrapping back to the left. Pause, resume and restart it to check each button. Use the local server rather than double-clicking the HTML file: browser modules load over HTTP.

If you already have a project with a bundler, run `npm install dino-ge@1.16.0` instead of using the import map. Keep the container and buttons, and load `main.js` through your project's usual entry point.

## Choose when work runs

- Engine `onLoad()` sets up the game once. Scene `onLoad()` populates a scene when it becomes active.
- Engine and scene `update()` run on unpaused frames. Use them for tasks such as reading input and choosing what happens next. For movement at a steady speed, use elapsed time or a fixed update.
- Engine `fixedUpdate()` runs at the simulation rate, currently 60 steps per second. The demo moves two pixels per step, or about 120 pixels per second.
- `drawUI(ui)` draws the interface after the world. Use it to display state rather than to advance the simulation.
- `Engine.paused` freezes gameplay updates. If you pause from a fixed update, the current step finishes and any remaining gameplay updates for that frame are skipped. Call `game.terminate()` when replacing a running game and release your own resources in `onDispose()`.

Try doubling the movement per step. The explorer travels twice as fast even though you haven't changed the draw rate.

[Engine](../api/classes/core_Engine.Engine.html) · [Scene](../api/classes/core_Scene.Scene.html) · [Canvas](../api/classes/core_Canvas.Canvas.html)
