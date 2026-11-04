# Amber Ruins

An exploration game for the Dino GE beta. Collect three amber relics, avoid
the obsidian spikes and unlock the gate on the far side of the vault.

Run `npm run build -w dino-ge` and then `npm run example` from the repository
root. Open `http://localhost:3001` and select **Start expedition**. Move with
WASD, the arrow keys or a standard gamepad's left stick. Music and effects
have separate controls and can be muted together.

The example uses `Tilemap.fromTiled` to import `assets/rooms.tmj`, `Sprite`
for the explorer and relics, `Input.getGamepadAxes` for movement and `Sound`
for music and effects. The example owns the game rules and restart state.
It draws the HUD, menus and volume controls through Dino GE's `ScreenUI`
and responds to the engine's pause event to suspend or resume its mixer.

ImageGen created the tile atlas, explorer and amber art. The original mono
PCM audio is reproducible with `python3 packages/example/amber-ruins/generate-audio.py`.
Run `npm run test:example` after building the engine to exercise the game in
Chromium, Firefox and WebKit.
