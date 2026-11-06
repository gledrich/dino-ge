import { Loader, Sound } from 'dino-ge';

const progress = document.querySelector('progress');
const status = document.querySelector('[role="status"]');
const button = document.querySelector('button');

async function load() {
  Loader.queueImage('floor', new URL('./gameplay-foundations/floor.svg', import.meta.url).href);
  Loader.queueJson('room', new URL('./gameplay-foundations/relay-room.tmj', import.meta.url).href);
  Loader.queueSound('pickup', new URL('./amber-ruins/assets/pickup.wav', import.meta.url).href);
  await Loader.loadAll(percent => { progress.value = percent; });

  const atlas = Loader.getImage('floor');
  const room = Loader.getJson('room');
  const pickup = Loader.getSound('pickup');
  const ready = `Loaded 3 assets. The room is ${room.width} × ${room.height} tiles.`;
  atlas.alt = 'Two floor tiles from the atlas';
  document.getElementById('atlas').append(atlas);
  status.textContent = ready;
  button.disabled = false;
  button.addEventListener('click', async () => {
    if (await Sound.unlock()) {
      pickup.play();
      status.textContent = ready + ' Pickup sound played.';
    } else {
      status.textContent = ready + ' Audio playback is unavailable.';
    }
  });
}

load().catch(error => {
  status.textContent = 'Could not load the assets.';
  console.error(error);
});
