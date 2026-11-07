---
---
# 5. Move the camera and switch scenes

[Core guide](index.html)

A camera chooses which part of the world is visible. A scene owns a set of objects and their update logic. Moving the camera can reveal another room within the same scene. Replacing the scene can take you to a different level or menu.

[Run the demo](demos/camera-and-scenes/index.html) · [View the source](demos/camera-and-scenes/source.html)

Select **Cross room** to pan from the Gatehouse to the Amber Vault. Select **Enter exit** to fade into a new scene.

## Pan between rooms and open an exit

Keep the `<head>` from the [first scene](first-scene.html). Replace the contents of `<body>` with:

```html
<div id="game" style="width: 360px; max-width: 100%; height: 220px"></div>
<button id="cross" disabled>Cross room</button>
<button id="exit" disabled>Enter exit</button>
<p id="status" role="status"></p>
```

Save this as `main.js`:

```js
{% include_relative demos/camera-and-scenes/main.js %}
```

The two room backgrounds live side by side in `Rooms`. **Cross room** moves the explorer to x = 440 and sets `cameraTarget` to 360, the left edge of the vault. Each update closes a fraction of the gap between the camera and that target. The explorer and rooms keep their world positions as the view pans. This short demo eases per frame, so the speed depends on the refresh rate.

**Enter exit** calls `game.transitionTo(new BeyondTheRuins(), { type: 'fade', duration: 0.5 })`. Halfway through the half-second fade, the engine activates the destination scene. It resets the camera and calls the destination's `onLoad()`, which adds the new text. The room objects belong to `Rooms`, so they are no longer drawn. Use `Engine.currentScene = new BeyondTheRuins()` in the click handler if you want an immediate switch.

## Follow the explorer instead of a fixed target

In the example above, replace `Rooms.update()` with the method below. Remove `let cameraTarget = 0` and `cameraTarget = 360`; the camera now follows `this.explorer` directly. Read `game.width` and `game.height` each time so the camera uses the current viewport size after a resize.

```js
update() {
  const world = { x: 0, y: 0, width: 720, height: 220 };
  Engine.camera.follow(this.explorer, game.width, game.height, world);
}
```

Reload and select **Cross room**. The camera jumps to the explorer's rendered centre, as far as the bounds allow. The fourth argument is the world rectangle, in pixels. If the viewport is larger than the world along one axis, the camera centres that axis. Call `Engine.camera.getViewportBounds(game.width, game.height)` to read the visible rectangle in world coordinates.

To ease into the new position, remove the `Rooms.update()` method and add the following `fixedUpdate()` next to `onLoad()` in the callbacks passed to `new Engine()`. The guard limits following to the rooms scene, so the camera stays at the origin after you use the exit.

```js
fixedUpdate() {
  if (Engine.currentScene !== rooms) return;
  Engine.camera.followSmooth(rooms.explorer, game.width, game.height, 1 / 60, {
    response: 5,
    bounds: { x: 0, y: 0, width: 720, height: 220 },
  });
},
```

`1 / 60` is the elapsed simulation time in seconds for one fixed step. A higher `response` approaches the target faster. With bounds, the camera first moves any out-of-range position back inside the valid range, for example after a resize or zoom, then eases towards the explorer.

To try the bounded follow demo from a repository checkout, run `npm run build -w dino-ge` and `npm run example`, then open [Bounded camera follow](http://localhost:3001/camera-bounds.html). Select **Jump surveyor** with **Smooth follow** on and off to compare the movement. Toggle the bounds at an edge, then zoom out to see how the larger viewport is centred.

[Camera](../api/classes/core_Camera.Camera.html) · [Scene](../api/classes/core_Scene.Scene.html) · [Engine](../api/classes/core_Engine.Engine.html)
