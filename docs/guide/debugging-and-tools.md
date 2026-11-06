---
---
# 8. Debug and inspect a scene

[Core guide](index.html)

A debug view can show the data the engine is using. Start by pausing the scene, then inspect positions, bounds and the current camera.

[Run the demo](demos/debugging-and-tools/index.html) · [View the source](demos/debugging-and-tools/source.html)

Select **Pause**, then **Toggle bounds**. The highlighted rectangle shows the marker's bounds. **Snap to grid** rounds its position from (73, 91) to (64, 96).

```js
const position = marker.transform.position;
position.set(snapToGrid(position.x, 32), snapToGrid(position.y, 32));
```

The demo obtains the marker's world-space bounds with `getViewportBounds(getViewportGeometry(marker))`. Its camera is at the origin with zoom 1, so those bounds line up with the screen overlay. For a moving or zooming camera, convert world coordinates to screen coordinates before drawing the overlay. Alignment helpers can compare nearby edges and centres when building tools.

`Engine.debug` enables engine diagnostics. The [physics demo](demos/physics-and-collisions/index.html) also enables velocity vectors and collision lines. In the Playground, pause before inspecting an object or dragging it into place. Inspector changes let you try a position in the current run. Update the source to reproduce that position on restart.

For tooling integrations, `Engine.observeObjectCreation()` and `Engine.observeScreenUI()` provide observations of objects and UI. For example, a tool can subscribe with `const stop = Engine.observeScreenUI(snapshot => console.log(snapshot.controls));` and call `stop()` when its inspector closes. The optional editing callback can preview a position or style change without rewriting the game source. Ordinary game UI can be written directly in `drawUI()`.

If a scene is blank, check asset requests and the console first, then inspect the object's visibility, bounds and camera. The engine's `gameRuntimeError` event distinguishes startup and frame errors. If you register global listeners, open audio loops or start asset requests, release them in `onDispose()` when replacing a game.

[Engine](../api/classes/core_Engine.Engine.html) · [Viewport geometry](../api/modules/core_ViewportGeometry.html) · [ScreenUI](../api/classes/core_ScreenUI.ScreenUI.html) · [Playground source and setup](https://github.com/gledrich/dino-ge/tree/main/packages/playground)
