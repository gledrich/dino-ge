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

[ScreenUI](../api/classes/core_ScreenUI.ScreenUI.html) · [Sound](../api/classes/core_Sound.Sound.html) · [ParticleEmitter](../api/classes/objects_ParticleEmitter.ParticleEmitter.html) · [Engine effects](../api/classes/core_Engine.Engine.html)
