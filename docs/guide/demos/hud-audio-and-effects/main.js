import { Circle, Engine, ParticleEmitter, Rectangle, Sound, Vector2 } from 'dino-ge';

const status = document.querySelector('#status');
const audio = document.querySelector('#audio');
const collect = document.querySelector('#collect');
const centre = new Vector2(115, 115);
let relic;
let particles;
let pickup;
let muted = true;
let collected = false;

function collectRelic() {
  if (collected) return;
  collected = true;
  collect.disabled = true;
  relic.destroySelf();
  particles.burst(centre, {
    count: 14,
    velocity: index => {
      const angle = index * 2 * Math.PI / 14;
      return new Vector2(Math.cos(angle) * 92, Math.sin(angle) * 92);
    },
    lifetime: 0.65, startRadius: 4, endRadius: 0, colour: '#ffc46f',
  });
  if (!muted) pickup?.play({ channel: 'effects' });
  status.textContent = 'Relic collected';
}

const game = new Engine({
  onLoad() {
    new Rectangle({ position: new Vector2(0, 0), width: 540, height: 220, colour: '#203f40' });
    relic = new Circle({ position: new Vector2(105, 105), radius: 10, colour: '#ffc46f', zIndex: 1 });
    particles = new ParticleEmitter({ zIndex: 2 });
    collect.disabled = false;
    status.textContent = 'Relic ready';
  },
  update() {
    Engine.camera.position.x = 24 + Math.sin(performance.now() / 850) * 22;
  },
  drawUI(ui) {
    const anchor = ui.anchor('left', 'top', 12, 12);
    ui.panel({ x: anchor.x, y: anchor.y, width: 150, height: 54 }, '#111d20');
    ui.label({ x: anchor.x + 10, y: anchor.y + 20, text: `Relics: ${Number(collected)}/1`, colour: '#edf5f3' });
    ui.progressBar({ x: anchor.x + 10, y: anchor.y + 32, width: 128, height: 8, value: Number(collected) });
    ui.button({
      id: 'canvas-hazard', x: 12, y: 76, width: 150, height: 32,
      text: 'Trigger hazard', onPress: triggerHazard,
    });
  },
}, { containerId: 'game', width: '100%', height: '100%', backgroundColour: '#183035' });

collect.addEventListener('click', collectRelic);
function triggerHazard() {
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    game.shakeScreen(5, 0.2);
    game.chromaticAberration(2, 0.15);
  }
  status.textContent = 'Hazard triggered';
}

document.querySelector('#hazard').addEventListener('click', triggerHazard);
audio.addEventListener('click', async () => {
  if (!muted) {
    muted = true;
    audio.textContent = 'Enable audio';
    status.textContent = 'Audio muted';
    return;
  }
  audio.disabled = true;
  try {
    if (!await Sound.unlock()) throw new Error('Audio locked');
    pickup ??= await Sound.load(import.meta.resolve('amber-assets/pickup.wav'));
    muted = false;
    audio.textContent = 'Mute audio';
    status.textContent = 'Audio enabled';
  } catch {
    status.textContent = 'Audio unavailable. You can still collect the relic.';
  } finally {
    audio.disabled = false;
  }
});
