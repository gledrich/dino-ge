---
---
# 7. Add a HUD, audio and effects

[Core guide](index.html)

A HUD (heads-up display) shows game information such as score or health. It stays in place on the screen while the camera moves through the world. Store the score or inventory in game state, draw the HUD from that state, and trigger sound or effects when it changes.

[Run the demo](demos/hud-audio-and-effects/index.html) · [View the source](demos/hud-audio-and-effects/source.html)

The relic moves on screen as the camera pans. The counter stays in the top-left corner. Select **Collect relic** to update it and see the particle burst. For sound, select **Enable audio** first. **Trigger hazard** shows the screen effects unless reduced motion is enabled. Try the button inside the canvas or its HTML counterpart below it.

## Collect a relic and update the HUD

Keep the `<head>` from the [first scene](first-scene.html). Download [pickup.wav](https://cdn.jsdelivr.net/gh/gledrich/dino-ge@v1.16.0/packages/example/amber-ruins/assets/pickup.wav) beside `index.html`. Add `"amber-assets/": "./"` as a second entry in the import map's `imports` object, separated from the `dino-ge` entry by a comma.

Replace the contents of `<body>` with:

```html
<div id="game" style="width: 360px; max-width: 100%; height: 220px"></div>
<button id="collect" disabled>Collect relic</button>
<button id="audio">Enable audio</button>
<button id="hazard">Trigger hazard</button>
<p id="status" role="status"></p>
```

Save this as `main.js`:

```js
{% include_relative demos/hud-audio-and-effects/main.js %}
```

`collectRelic()` changes `collected` to `true` and removes the world object. On the next draw, `drawUI(ui)` reads that same value: `Number(collected)` is 0 before the pickup and 1 afterwards. The panel, label and progress bar use offsets from the same anchor, so they stay together when you change it.

`ScreenUI` draws after the world in screen coordinates. Anchors keep elements attached to a viewport edge as it resizes. Use panels, labels, images and progress bars for information. The canvas hazard button and the native HTML button both call `triggerHazard()`. The native control also supports keyboard and assistive technology users.

Call `Sound.unlock()` from a user interaction before playback. `Sound.load(url)` loads a reusable sound and `sound.play({ channel: 'effects' })` starts a copy. For looping music, pass `{ loop: true, channel: 'music' }` and keep the returned stop function. Use `Sound.setVolume()` for master, music or effects volume. The pickup changes game state even if the browser denies audio or the player mutes it.

The particle burst uses a world position, a lifetime in seconds and one initial velocity per particle. The emitter manages individual particle lifetimes. `shakeScreen()` and `chromaticAberration()` provide short feedback on damage. Keep important information available when motion effects are disabled. The pickup sound comes from Amber Ruins.

## Preload images, JSON and sound together

Try the loader on its own. In a separate folder with the same `<head>`, save
[tiles.svg](demos/input-and-tilemaps/tiles.svg),
[room.tmj](demos/input-and-tilemaps/room.tmj) and `pickup.wav` alongside the
page. Use this body and replace `main.js` with the script below:

```html
<progress id="progress" max="100" value="0" aria-label="Asset loading"></progress>
<p id="status" role="status"></p>
<img id="preview" alt="Floor and wall tiles" hidden>
<button id="play" disabled>Play pickup sound</button>
```

```js
import { Loader, Sound } from 'dino-ge';

const progress = document.querySelector('#progress');
const status = document.querySelector('#status');
const preview = document.querySelector('#preview');
const play = document.querySelector('#play');
const asset = name => new URL(name, import.meta.url).href;

try {
  Loader.queueImage('tiles', asset('./tiles.svg'));
  Loader.queueJson('room', asset('./room.tmj'));
  Loader.queueSound('pickup', asset('./pickup.wav'));
  await Loader.loadAll(percent => { progress.value = percent; });

  preview.src = Loader.getImage('tiles').src;
  preview.hidden = false;
  const room = Loader.getJson('room');
  status.textContent = `Loaded a ${room.width} × ${room.height} room`;
  const pickup = Loader.getSound('pickup');
  play.addEventListener('click', async () => {
    if (await Sound.unlock()) pickup.play({ channel: 'effects' });
    else status.textContent = 'Audio unavailable';
  });
  play.disabled = false;
} catch (error) {
  status.textContent = `Could not load the assets: ${error.message}`;
}
```

Each name you queue is the same name you use to retrieve the decoded asset.
The progress bar fills, the tile image appears, and the status shows the
room's dimensions. The sound loads with the other files, but playback waits
for a click to unlock audio. To see a larger version of this flow, build dino-ge with `npm run build -w dino-ge`, start
`npm run example` and open `http://localhost:3001/asset-loading.html`.

## Write a world shader

Install a GLSL ES 3.00 fragment shader on the engine to change the composed
world. The Canvas renderer supplies the world image. The shader runs before
the built-in colour separation and fade overlays, and the screen HUD is drawn
after the effect.

Return to the relic example. Add this control beside the hazard button:

```html
<label><input id="shader" type="checkbox"> Swap red and blue</label>
```

Add the following after the `const game = new Engine(...)` block, where
`game` is the running engine and `status` is the existing status paragraph:

```js
const shader = document.querySelector('#shader');
shader.addEventListener('change', () => {
  if (!shader.checked) {
    game.setPostProcessShader(null);
    return;
  }
  const result = game.setPostProcessShader({
    fragmentSource: `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform float amount;
out vec4 colour;

void main() {
  vec4 source = texture(u_scene, v_uv);
  colour = vec4(mix(source.rgb, source.bgr, amount), source.a);
}`,
    uniforms: { amount: 0.7 },
  });
  if (!result.ok) {
    status.textContent = result.message;
    shader.checked = false;
  }
});
```

On a browser with WebGL2, the checkbox changes the colours of the world
while the HUD keeps its original colours. Clear it to restore the world.

Use `v_uv` as normalised texture coordinates with the origin at the bottom left.
Declare `uniform vec2 u_resolution` for the backing canvas size in pixels and
`uniform float u_time` for unpaused game time in seconds. You can update custom
float and vector uniforms with `game.setPostProcessUniforms({ amount: 0.4 })`.
Pass `null` to `setPostProcessShader()` to turn the effect off. If a replacement
fails to compile or link, the previous shader stays installed.

When WebGL2 is unavailable or the context is lost, the engine draws the world
through Canvas 2D. Use same-origin artwork or load remote artwork with CORS
enabled so WebGL can sample it. The engine also falls back for cross-origin
artwork without CORS and retries with a fresh world canvas as game time
advances. Read `game.postProcessStatus` to show the current rendering status.

Build the engine with `npm run build -w dino-ge`, run `npm run example` and open
[World shaders](http://localhost:3001/shader-effects.html). Toggle the shader
or move the strength slider while the white HUD panel stays in place.

[ScreenUI](../api/classes/core_ScreenUI.ScreenUI.html) · [Sound](../api/classes/core_Sound.Sound.html) · [ParticleEmitter](../api/classes/objects_ParticleEmitter.ParticleEmitter.html) · [Engine effects](../api/classes/core_Engine.Engine.html)
