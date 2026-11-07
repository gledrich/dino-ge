---
---
# 3. Draw and animate sprites

[Core guide](index.html)

A sprite sheet packs several frames into one image. Load the sheet, tell the sprite how it is divided, then play the frames you want.

[Run the demo](demos/drawing-and-animation/index.html) · [View the source](demos/drawing-and-animation/source.html)

Watch the explorer walk behind the pillar. **Toggle animation** stops the frames while the explorer keeps moving, so you can see how animation and position work independently.

## Load a sheet and draw the world

Keep the `<head>` from the [first scene](first-scene.html). Download [explorer-walk.png](https://cdn.jsdelivr.net/gh/gledrich/dino-ge@v1.16.0/packages/example/amber-ruins/assets/explorer-walk.png) beside `index.html`. Add `"amber-assets/": "./"` as a second entry in the import map's `imports` object, separated from the `dino-ge` entry by a comma.

Replace the contents of `<body>` with:

```html
<div id="game" style="width: 360px; max-width: 100%; height: 220px"></div>
<button id="animate">Toggle animation</button>
<p id="status" role="status"></p>
```

Save this as `main.js`:

```js
{% include_relative demos/drawing-and-animation/main.js %}
```

Queue assets by tag and await them before constructing sprites that use those tags. Resolve asset URLs with the demo's import map or with a URL relative to your module. Both work under the project's GitHub Pages path. Handle failures so a missing image does not leave a silent blank screen.

The sheet has two rows and two columns. The animation starts at frame 0 and loops through frame 3 (`endCol` is exclusive). Scaling by the width of one frame gives a 44-pixel-wide sprite. The engine can start updating while assets load, so the fixed update and button both check that the explorer exists. The toggle changes `SpriteComponent.playing` while the fixed update continues changing the explorer's x position.

The pillar is a `Rectangle` with a higher `zIndex` than the explorer. The scene also uses a `Line` for the path, a `Circle` for a marker and `Text` for a sign. These objects all draw in world coordinates, so the camera affects them. A HUD uses screen coordinates instead.

Try lowering the pillar's `zIndex` below the explorer's and watch which object draws in front. The sprite sheet comes from Amber Ruins.

## Name a clip and script a sequence

Pass a record of named `animations` when constructing a `Sprite`. Each clip
lists zero-based sheet frames or atlas rectangles, with a duration in
milliseconds for each frame. Call `sprite.playAnimation('walk')` to select the
clip. Use `pauseAnimation()` to hold its current frame, or pass
`{ restart: true }` to play it from the beginning.

Each game object also has an `actions` queue. Enqueue moves, waits, fades and
callbacks in order. Movement uses the object's local coordinates and timed
actions take seconds. Named clips and queues advance on engine time, so pausing
the engine freezes both.

To try a one-off delivery in the example above, add `Actions` to the import and
remove the entire `fixedUpdate()` callback so it does not also move the sprite.
In the `new Sprite({...})` options, add:

```js
animations: {
  walk: { frames: [0, 1, 2, 3].map(frame => ({ frame, durationMs: 120 })) },
},
```

Delete the `status.textContent = 'Walking behind the pillar'` line near the
end of `onLoad()`. Then replace `explorer.play()` with this sequence:

```js
explorer.playAnimation('walk');
status.textContent = 'Walking to the marker';
explorer.actions.enqueue(
  Actions.moveTo(new Vector2(224, 121), 2),
  Actions.call(actor => actor.pauseAnimation()),
  Actions.wait(0.5),
  Actions.fadeTo(0, 0.6),
  Actions.call(() => { status.textContent = 'Delivery complete'; }),
);
```

Remove the `animate` button from `index.html` and its click listener from
the end of `main.js`. The queue now controls the named clip. Reload to see
the explorer walk, hold its pose, then fade.

In the local Gameplay Foundations example, select **Replay delivery** to see
the explorer play a named walk clip, move to the relay, wait and fade. A final
callback updates the delivery status. Build dino-ge with
`npm run build -w dino-ge`, start `npm run example`, then open
`http://localhost:3001/gameplay-foundations.html`.

[Loader](../api/classes/core_Loader.ResourceLoader.html) · [Sprite](../api/classes/objects_Sprite.Sprite.html) · [Text](../api/classes/objects_Text.Text.html) · [Rectangle](../api/classes/objects_Rectangle.Rectangle.html) · [Circle](../api/classes/objects_Circle.Circle.html) · [Line](../api/classes/objects_Line.Line.html)
