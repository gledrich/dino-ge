# Amber Ruins

The Lanternreach chapter is a short exploration adventure for Dino GE. Follow
the marsh road, recover materials from the Reedbank and Sunken Archive, and
restore the crossing to the Skywell. Bring moonbells to Iona if you want to
leave something growing at the outpost.

Run `npm run build -w dino-ge` and then `npm run example` from the repository
root. Open [Amber Ruins](http://localhost:3001/) and select **Begin chapter**
or **Continue chapter** if you have a save.

- Move with WASD, the arrow keys, a gamepad’s left stick or the touch arrows.
- Use **E** or gamepad **A** to interact. Open the journal with **J** or
  gamepad **Y**. Both actions also have on-screen buttons.
- The journal shows your current objective, finds and sound toggle. Progress
  saves automatically in your browser when you make a discovery or finish a
  restoration. Continuing starts you back in Lanternreach.

Both modes use named sprite clips for the explorer. Lanternreach binds its
interact and journal actions to keyboard and gamepad buttons through `Input`.
The expedition loads its Tiled map and images in one `Loader` batch.

[Chapter logic](outpost.js) · [Maps and save format](outpost-world.js) · [Assets](assets/)

Play the [original relic hunt](http://localhost:3001/?expedition) on the same
server. To regenerate its audio, run
`python3 packages/example/amber-ruins/generate-audio.py` from the repository root.

Run `npm run test:example` from the repository root after building the engine
and installing the Playwright browsers with `npx playwright install`.
