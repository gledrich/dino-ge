---
---
# 5. Move the camera and switch scenes

[Core guide](index.html)

A camera chooses which part of the world is visible. A scene owns a set of objects and their update logic. Moving the camera can reveal another room within the same scene. Replacing the scene can take you to a different level or menu.

[Run the demo](demos/camera-and-scenes/index.html) · [View the source](demos/camera-and-scenes/source.html)

Select **Cross room** to pan from the Gatehouse to the Amber Vault. Select **Enter exit** to fade into a new scene.

```js
update() {
  const position = Engine.camera.position;
  position.x += (cameraTarget - position.x) * 0.12;
}
```

When the explorer crosses the boundary, the game updates the target to the vault's world x coordinate. Each frame closes a fraction of the remaining distance. The camera never moves the world objects themselves. This short demo eases per frame. For timing that stays consistent across refresh rates, use an elapsed-time interpolation or the fixed update.

Use `Engine.camera.follow(player, game.width, game.height)` to centre on a moving character. Pass the current viewport dimensions, especially after resizing. For a finite world, pass its rectangle in world units as the fourth argument.

```js
const world = { x: -120, y: -40, width: 760, height: 280 };
Engine.camera.follow(player, game.width, game.height, world);
```

Bounded follow uses the target's rendered centre. It clamps the visible area to the rectangle at the current zoom. If the viewport is larger than the world on either axis, the camera centres that axis so the space on both sides is equal. `Engine.camera.getViewportBounds(width, height)` gives the resulting visible region in world coordinates.

Use `followSmooth()` to ease the camera using elapsed game time. Pass seconds
since the last follow step and an optional response rate. A higher rate
approaches the target faster, with a default of 8 per second. For a stationary
target, splitting the same elapsed time across more updates produces the same
position.

```js
fixedUpdate() {
  Engine.camera.followSmooth(player, game.width, game.height, 1 / 60, {
    response: 5,
    bounds: world,
  });
}
```

Smooth follow uses the target's rendered world centre with or without bounds.
If you pass bounds, the camera first projects its current position into the
valid range. This corrects the viewport immediately after a resize or zoom,
then easing continues from the corrected position. An axis larger than the
world remains centred.

To try the bounded follow demo from a repository checkout, run `npm run build -w dino-ge` and `npm run example`, then open [Bounded camera follow](http://localhost:3001/camera-bounds.html). Select **Jump surveyor** with **Smooth follow** on and off to compare the movement. Toggle the bounds at an edge, then zoom out to see how the larger viewport is centred.

```js
game.transitionTo(new BeyondTheRuins(), { type: 'fade', duration: 0.5 });
```

Populate objects in the scene's `onLoad()` and use `this.add()` to make ownership explicit. `Engine.currentScene = scene` activates a scene immediately. `transitionTo()` uses an effect and takes its duration in seconds. The destination scene resets the camera so its text starts on screen.

[Camera](../api/classes/core_Camera.Camera.html) · [Scene](../api/classes/core_Scene.Scene.html) · [Engine](../api/classes/core_Engine.Engine.html)
