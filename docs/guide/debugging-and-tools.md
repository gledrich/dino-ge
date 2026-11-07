---
---
# 8. Debug and inspect a scene

[Core guide](index.html)

A debug view can show the data the engine is using. Start by pausing the scene, then inspect positions, bounds and the current camera.

[Run the demo](demos/debugging-and-tools/index.html) · [View the source](demos/debugging-and-tools/source.html)

Select **Pause**, then **Toggle bounds**. The highlighted rectangle shows the marker's bounds. **Snap to grid** rounds its position from (73, 91) to (64, 96).

## Draw and adjust the marker's bounds

Keep the `<head>` from the [first scene](first-scene.html). Replace the contents of `<body>` with:

```html
<div id="game" style="width: 360px; max-width: 100%; height: 220px"></div>
<button id="pause">Pause</button>
<button id="bounds">Toggle bounds</button>
<button id="snap">Snap to grid</button>
<p id="status" role="status"></p>
```

Save this as `main.js`:

```js
{% include_relative demos/debugging-and-tools/main.js %}
```

The demo gets the marker's world-space bounds with `getViewportBounds(getViewportGeometry(marker))`. The bounds give the outer left, right, top and bottom edges, from which `drawUI()` computes the size of the highlight. The camera is at the origin with zoom 1, so the bounds line up with the screen overlay. For a moving or zooming camera, convert world coordinates to screen coordinates before drawing the overlay.

Pausing stops game updates. The engine still draws the world and HUD, and the browser still dispatches button clicks. The snap handler sets the marker's position directly, so you can see the change while paused. Change both grid sizes in the `snapToGrid()` calls to 16 and reload. The marker now snaps to (80, 96).

`Engine.debug` enables engine diagnostics. The [physics demo](demos/physics-and-collisions/index.html) also enables velocity vectors and collision lines. In the Playground, pause before inspecting an object or dragging it into place. Inspector changes let you try a position in the current run. Update the source to reproduce that position on restart.

## Inspect a ScreenUI control

In the [HUD example](hud-audio-and-effects.html), add this at the end of
`main.js` to read the next completed frame that contains the hazard button.
Open the browser console and reload to see the control's screen position and
size. The function returned by `observeScreenUI()` unsubscribes after the first
match; a live inspector can keep it and call it when the inspector closes.

```js
const stopInspecting = Engine.observeScreenUI(snapshot => {
  const hazard = snapshot.controls.find(control => control.id === 'canvas-hazard');
  if (!hazard) return;
  console.log('Hazard control:', hazard);
  stopInspecting();
});
```

Tool authors can also use `Engine.observeObjectCreation()` to observe new
objects and pass an editing callback to `observeScreenUI()` to preview a
position or style. Ordinary game UI can be drawn directly in `drawUI()`.

## Report a runtime error and clean up

If a scene is blank, check the browser console and the Network tab for errors
and failed asset requests. If those look right, check that the object is
visible and within the camera's view. To surface engine errors on the page,
add the following just before `new Engine(...)` in the marker example:

```js
function reportError({ detail }) {
  status.textContent = `Error during ${detail.phase}: ${detail.error.message}`;
}
Engine.on('gameRuntimeError', reportError);
```

Add this callback next to `drawUI()` in the first argument to `new Engine()`:

```js
onDispose() {
  Engine.off('gameRuntimeError', reportError);
},
```

To test it, add `throw new Error('Test startup failure');` at the end of
`onLoad()` and reload. The status reports a `startup` error; an error during
an update or draw reports `frame`. Remove the test line to restore the demo.
To try cleanup, change `new Engine(...)` to `const game = new Engine(...)`
and add a button alongside the other controls.

```html
<button id="stop">Stop game</button>
```

Add this at the end of `main.js`.

```js
document.querySelector('#stop').addEventListener('click', () => {
  game.terminate();
  status.textContent = 'Engine stopped';
}, { once: true });
```

Reload and select **Stop game**. The canvas disappears and `onDispose()`
removes the error listener. The same callback can stop audio loops or cancel
requests.

[Engine](../api/classes/core_Engine.Engine.html) · [Viewport geometry](../api/modules/core_ViewportGeometry.html) · [ScreenUI](../api/classes/core_ScreenUI.ScreenUI.html) · [Playground source and setup](https://github.com/gledrich/dino-ge/tree/main/packages/playground)
