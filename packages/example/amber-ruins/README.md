# Amber Ruins

The Lanternreach chapter is a short exploration adventure for Dino GE. Follow
the marsh road, recover materials from the Reedbank and Sunken Archive, and
restore the crossing to the Skywell. Bring moonbells to Iona if you want to
leave something growing at the outpost.

Run `npm run build -w dino-ge` and then `npm run example` from the repository
root. Open `http://localhost:3001` and select **Begin chapter**.

- Move with WASD, the arrow keys, a gamepad’s left stick or the touch arrows.
- Use **E** or gamepad **A** to interact. Open the journal with **J** or
  gamepad **Y**. Both actions also have on-screen buttons.
- The journal shows your current objective, finds and sound toggle. Progress
  saves automatically in your browser when you make a discovery or finish a
  restoration. Continuing starts you back in Lanternreach.

`outpost-world.js` defines the maps and save format. The chapter uses Dino GE
tilemaps, depth-ordered sprites, camera tracking, particles, ScreenUI, input
and audio. The chapter’s SVG terrain and prop sheets live alongside the
existing explorer, amber and audio assets.

The original relic hunt is available at `http://localhost:3001/?expedition`.
Its original mono PCM audio is reproducible with
`python3 packages/example/amber-ruins/generate-audio.py`.

Run `npm run test:example` after building the engine to exercise the chapter
in Chromium, Firefox and WebKit.
