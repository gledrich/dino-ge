import { Engine, Input, Loader, Sound, Sprite, SpriteComponent, Tilemap, Vector2, VisibilityComponent } from 'dino-ge';

const asset = name => new URL(`./assets/${name}`, import.meta.url).href;
const cellSize = 48;
const stepDuration = 145;
const walkDuration = 125;
const damageGrace = 850;
const rooms = ['The Gatehouse', 'The Spike Gallery', 'The Amber Vault'];
const relicCells = [[5, 3], [12, 4], [20, 3]];
const startCell = [2, 4];
const exitCell = [23, 4];
const controlsHint = 'Move with WASD, arrow keys or the left stick.';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const hud = Object.fromEntries(
  ['room', 'health', 'relics', 'hint', 'overlay', 'overlay-title', 'instructions', 'start', 'mute', 'music', 'effects']
    .map(id => [id, document.getElementById(id)])
);

let tilemap;
let player;
let relics = [];
let active = false;
let health = 3;
let collected = 0;
let column = startCell[0];
let row = startCell[1];
let nextMove = 0;
let vulnerableAt = 0;
let walk;
let previousFrame;
let muted = false;
let audioLoading;
const sounds = {};

function showStatus() {
  hud.room.textContent = rooms[Math.min(rooms.length - 1, Math.floor(column / 8))];
  hud.health.textContent = `Health ${health} / 3`;
  hud.relics.textContent = `Relics ${collected} / ${relicCells.length}`;
}

function position(sprite, x, y, size) {
  const inset = (cellSize - size) / 2;
  sprite.transform.position.set(x * cellSize + inset, y * cellSize + inset);
}

function makeSprite(tag, image, x, y, size, framesAcross = 1) {
  const sprite = new Sprite({
    tag,
    img: image,
    rows: framesAcross,
    cols: framesAcross,
    endCol: framesAcross ** 2,
    scale: size * framesAcross / image.width,
    zIndex: 2,
  });
  position(sprite, x, y, size);
  sprite.play();
  sprite.getComponent(SpriteComponent).playing = false;
  return sprite;
}

async function loadAudio() {
  if (!(await Sound.unlock())) {
    hud.hint.textContent = 'Sound is unavailable. You can still explore.';
    return;
  }
  const names = ['pickup', 'damage', 'unlock', 'ruins-loop'];
  const results = await Promise.allSettled(names.map(name => Sound.load(asset(`${name}.wav`))));
  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') sounds[names[index]] = result.value;
    else console.warn(`Could not load ${names[index]} audio`, result.reason);
  }
  sounds['ruins-loop']?.play({ loop: true, channel: 'music' });
}

function start() {
  audioLoading ??= loadAudio();
  [column, row] = startCell;
  health = 3;
  collected = 0;
  nextMove = 0;
  vulnerableAt = 0;
  walk = undefined;
  previousFrame = undefined;
  tilemap.data[exitCell[1]][exitCell[0]] = 3;
  for (const relic of relics) relic.getComponent(VisibilityComponent).visible = true;
  position(player, column, row, 44);
  player.flip = false;
  player.getComponent(VisibilityComponent).visible = true;
  player.currentFrame = 0;
  active = true;
  hud.hint.textContent = controlsHint;
  hud.overlay.hidden = true;
  hud.start.blur();
  showStatus();
}

function finish(won) {
  active = false;
  hud['overlay-title'].textContent = won ? 'Expedition complete' : 'Expedition lost';
  hud.instructions.textContent = won
    ? 'You opened the vault and brought back all three relics.'
    : 'The ruins claimed your last heart. Take another route past the traps.';
  hud.start.textContent = 'Try again';
  hud.overlay.hidden = false;
  hud.start.focus();
}

function move(now) {
  if (now < nextMove || document.activeElement instanceof HTMLInputElement) return;
  const pressed = (...keys) => Number(keys.some(key => Input.isKeyDown(key)));
  let x = pressed('d', 'ArrowRight') - pressed('a', 'ArrowLeft');
  let y = pressed('s', 'ArrowDown') - pressed('w', 'ArrowUp');

  if (!x && !y) {
    const axes = Input.getGamepadAxes();
    x = axes.x;
    y = axes.y;
  }
  if (!x && !y) return;

  const horizontal = Math.abs(x) >= Math.abs(y);
  const nextColumn = column + (horizontal ? Math.sign(x) : 0);
  const nextRow = row + (horizontal ? 0 : Math.sign(y));
  const tile = tilemap.data[nextRow]?.[nextColumn];
  nextMove = now + stepDuration;
  if (tile === undefined || tile === 1) return;
  if (tile === 3 && collected < relicCells.length) {
    hud.hint.textContent = 'The vault gate needs all three amber relics.';
    return;
  }

  walk = { column, row, start: now };
  column = nextColumn;
  row = nextRow;
  if (horizontal) player.flip = x < 0;

  const relicIndex = relicCells.findIndex(([relicX, relicY]) => relicX === column && relicY === row);
  const visibility = relics[relicIndex]?.getComponent(VisibilityComponent);
  if (visibility?.visible) {
    visibility.visible = false;
    collected++;
    sounds.pickup?.play();
    pulse(hud.relics, '#fff1c3');
    if (collected === relicCells.length) {
      tilemap.data[exitCell[1]][exitCell[0]] = 0;
      hud.hint.textContent = 'The gate is open. Head to the far side of the Amber Vault.';
      sounds.unlock?.play();
    } else {
      hud.hint.textContent = 'Amber relic recovered. Keep exploring.';
    }
  }

  showStatus();
  if (column === exitCell[0] && row === exitCell[1]) finish(true);
}

function pulse(element, colour) {
  if (reducedMotion.matches) return;
  element.animate([{ color: colour, scale: 1.16 }, { scale: 1 }], {
    duration: 260,
    easing: 'ease-out',
  });
}

function animate(now) {
  const elapsed = walk ? now - walk.start : walkDuration;
  if (elapsed >= walkDuration || reducedMotion.matches) walk = undefined;
  const progress = walk ? elapsed / walkDuration : 1;
  const eased = progress * progress * (3 - 2 * progress);
  const x = walk ? walk.column + (column - walk.column) * eased : column;
  const y = walk ? walk.row + (row - walk.row) * eased : row;
  const lift = walk ? Math.sin(progress * Math.PI) * 2 / cellSize : 0;
  position(player, x, y - lift, 44);
  player.currentFrame = walk ? Math.min(3, Math.floor(progress * 4)) : 0;
  player.getComponent(VisibilityComponent).visible =
    !active || now >= vulnerableAt || reducedMotion.matches || Math.floor(now / 90) % 2 === 0;

  for (const [index, relic] of relics.entries()) {
    const [relicX, relicY] = relicCells[index];
    const bob = reducedMotion.matches ? 0 : Math.sin(now / 285 + index) * 3 / cellSize;
    position(relic, relicX, relicY - bob, 62);
  }
}

function update() {
  if (!player) return;
  const now = performance.now();
  if (active) move(now);
  animate(now);

  const camera = Engine.camera;
  const roomIndex = Math.min(rooms.length - 1, Math.floor(column / 8));
  camera.zoom = Math.min(game.width / (9 * cellSize), game.height / (9 * cellSize), 1.55);
  const viewWidth = game.width / camera.zoom;
  const mapWidth = tilemap.data[0].length * cellSize;
  const roomLeft = (4.5 + roomIndex * 8) * cellSize - viewWidth / 2;
  const targetX = Math.max(0, Math.min(mapWidth - viewWidth, roomLeft));
  const blend = previousFrame === undefined || reducedMotion.matches
    ? 1 : 1 - Math.exp(-(now - previousFrame) / 95);
  camera.position.set(camera.position.x + (targetX - camera.position.x) * blend,
    4.5 * cellSize - game.height / (2 * camera.zoom));
  previousFrame = now;

  if (active && tilemap.data[row][column] === 2 && now >= vulnerableAt) {
    vulnerableAt = now + damageGrace;
    health--;
    sounds.damage?.play();
    pulse(hud.health, '#ff9474');
    hud.hint.textContent = 'Watch out for the obsidian spikes!';
    showStatus();
    if (health === 0) finish(false);
  }
}

async function loadLevel() {
  const response = await fetch(asset('rooms.tmj'));
  if (!response.ok) throw new Error(`Could not load rooms (HTTP ${response.status})`);
  const map = await response.json();

  for (const [name, file] of [['tiles', 'ruins-atlas.png'], ['explorer', 'explorer-walk.png'], ['amber', 'amber.png']]) {
    Loader.queueImage(name, asset(file));
  }
  await Loader.loadAll();

  tilemap = Tilemap.fromTiled(map, {
    tileset: 'tiles',
    tag: 'ruin-rooms',
    position: new Vector2(0, 0),
  });
  const scale = cellSize / tilemap.tileSize;
  tilemap.transform.scale.set(scale, scale);
  const amber = Loader.getImage('amber');
  relics = relicCells.map(([x, y], index) => makeSprite(`relic-${index + 1}`, amber, x, y, 62));
  player = makeSprite('explorer', Loader.getImage('explorer'), column, row, 44, 2);
  hud.start.disabled = false;
}

hud.start.addEventListener('click', start);
hud.mute.addEventListener('click', () => {
  muted = !muted;
  Sound.setVolume('master', muted ? 0 : 1);
  hud.mute.setAttribute('aria-pressed', String(muted));
  hud.mute.textContent = muted ? 'Unmute sound' : 'Mute sound';
});
for (const channel of ['music', 'effects']) {
  const setVolume = () => Sound.setVolume(channel, Number(hud[channel].value));
  setVolume();
  hud[channel].addEventListener('input', setVolume);
}
window.addEventListener('keydown', event => {
  if (active && event.key.startsWith('Arrow') && !(event.target instanceof HTMLInputElement)) {
    event.preventDefault();
  }
});

const game = new Engine({
  onLoad: () => {
    loadLevel().catch(error => {
      hud.instructions.textContent = 'The ruins could not be loaded. Reload the page to try again.';
      console.error(error);
    });
  },
  update,
}, { title: 'Amber Ruins', containerId: 'viewport', backgroundColour: '#0b171a' });
