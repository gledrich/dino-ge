---
---
# 7. Add a HUD, audio and effects

[Core guide](index.html)

Keep score and inventory in game state. Draw the interface from that state, then trigger short-lived feedback at the point where the state changes.

[Run the demo](demos/hud-audio-and-effects/index.html) · [View the source](demos/hud-audio-and-effects/source.html)

The relic moves on screen as the camera pans. The counter stays in the top-left corner. Select **Collect relic** to update it and see the particle burst. For sound, select **Enable audio** first. **Trigger hazard** shows the screen effects unless reduced motion is enabled. Try the button inside the canvas or its HTML counterpart below it.

```js
drawUI(ui) {
  const anchor = ui.anchor('left', 'top', 12, 12);
  ui.panel({ x: anchor.x, y: anchor.y, width: 150, height: 54 }, '#111d20');
  ui.label({ x: 22, y: 32, text: `Relics: ${Number(collected)}/1`, colour: '#edf5f3' });
  ui.progressBar({ x: 22, y: 44, width: 128, height: 8, value: Number(collected) });
}
```

`ScreenUI` draws after the world in screen coordinates. Anchors keep elements attached to a viewport edge as it resizes. Use panels, labels, images and progress bars for information. Use `ui.button({ x, y, width, height, text, onPress })` for a canvas control, as the demo does for the hazard. The HTML button calls the same function and provides a native control for keyboard and assistive technology users. Amber Ruins uses canvas buttons for its journal.

Call `Sound.unlock()` from a user interaction before playback. `Sound.load(url)` loads a reusable sound and `sound.play({ channel: 'effects' })` starts a copy. For looping music, pass `{ loop: true, channel: 'music' }` and keep the returned stop function. Use `Sound.setVolume()` for master, music or effects volume. The pickup changes game state even if the browser denies audio or the player mutes it.

The particle burst uses a world position, a lifetime in seconds and one initial velocity per particle. The emitter manages individual particle lifetimes. `shakeScreen()` and `chromaticAberration()` provide short feedback on damage. Keep important information available when motion effects are disabled. The pickup sound comes from Amber Ruins.

## Preload images, JSON and sound together

Queue each asset by name, then pass a progress callback to `Loader.loadAll()`.
Read the decoded assets after the batch finishes.

```js
Loader.queueImage('floor', '/floor.svg');
Loader.queueJson('room', '/room.tmj');
Loader.queueSound('pickup', '/pickup.wav');
await Loader.loadAll(percent => { progress.value = percent; });

const floor = Loader.getImage('floor');
const room = Loader.getJson('room');
const pickup = Loader.getSound('pickup');
```

Use `Sound.unlock()` from a click or key press before playing a decoded sound.
To try this flow, build dino-ge with `npm run build -w dino-ge`, start
`npm run example` and open `http://localhost:3001/asset-loading.html`.

## Write a world shader

Install a GLSL ES 3.00 fragment shader on the engine to change the composed
world. The Canvas renderer supplies the world image. The shader runs before
the built-in colour separation and fade overlays, and the screen HUD is drawn
after the effect.

```js
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
if (!result.ok) console.warn(result.message);
```

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
