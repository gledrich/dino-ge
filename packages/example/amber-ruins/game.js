import {
  Engine,
  Input,
  Loader,
  ParticleEmitter,
  Sound,
  Sprite,
  SpriteComponent,
  Tilemap,
  Vector2,
  VisibilityComponent,
} from 'dino-ge';

const asset = name => new URL(`./assets/${name}`, import.meta.url).href;
const cellSize = 48;

const roomWidth = 8;
const maxHealth = 3;
const explorerSize = 44;
const relicSize = 62;

const floorTile = 0;
const wallTile = 1;
const spikeTile = 2;
const gateTile = 3;

const hudHeight = 54;
const stepDuration = 145;
const walkDuration = 125;
const damageGrace = 850;

const rooms = ['The Gatehouse', 'The Spike Gallery', 'The Amber Vault'];
const relicCells = [
  [5, 3],
  [12, 4],
  [20, 3],
];
const startCell = [2, 4];
const [exitColumn, exitRow] = [23, 4];

const controlsHint = 'Move with WASD, arrow keys or the left stick.';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const embedded = !!document.getElementById('playground-canvas-container');

let tilemap;
let player;
let particles;
let amberImage;
let relics = [];

let phase = 'loading';
let hint = controlsHint;
let active = false;
let health = maxHealth;
let collected = 0;
let column = startCell[0];
let row = startCell[1];
let nextMove = 0;
let vulnerableAt = 0;
let walk;
let previousFrame;

let muted = false;
const volume = { music: 0.4, effects: 0.7 };
let relicPulse = 0;
let healthPulse = 0;
let audioLoading;
let stopMusic;

const lifetime = new AbortController();
const sounds = {};

function positionInCell(sprite, column, row, size) {
  const inset = (cellSize - size) / 2;
  sprite.transform.position.set(
    column * cellSize + inset,
    row * cellSize + inset,
  );
}

function makeSprite(tag, image, x, y, size, framesAcross = 1) {
  const sprite = new Sprite({
    tag,
    img: image,
    rows: framesAcross,
    cols: framesAcross,
    endCol: framesAcross ** 2,
    scale: (size * framesAcross) / image.width,
    zIndex: 2,
  });
  positionInCell(sprite, x, y, size);
  sprite.play();
  sprite.getComponent(SpriteComponent).playing = false;
  return sprite;
}

async function loadAudio() {
  if (!(await Sound.unlock())) {
    hint = 'Sound is unavailable. You can still explore.';
    return;
  }
  const names = ['pickup', 'damage', 'unlock', 'ruins-loop'];
  const results = await Promise.allSettled(
    names.map(name => Sound.load(asset(`${name}.wav`))),
  );
  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') sounds[names[index]] = result.value;
    else console.warn(`Could not load ${names[index]} audio`, result.reason);
  }
  if (!lifetime.signal.aborted)
    stopMusic = sounds['ruins-loop']?.play({ loop: true, channel: 'music' });
}

function start() {
  audioLoading ??= loadAudio();
  [column, row] = startCell;
  health = maxHealth;
  collected = 0;
  nextMove = 0;
  vulnerableAt = 0;
  walk = undefined;
  previousFrame = undefined;
  tilemap.data[exitRow][exitColumn] = gateTile;
  for (const relic of relics)
    relic.getComponent(VisibilityComponent).visible = true;
  positionInCell(player, column, row, explorerSize);
  player.flip = false;
  player.getComponent(VisibilityComponent).visible = true;
  player.currentFrame = 0;
  healthPulse = 0;
  relicPulse = 0;
  active = true;
  phase = 'playing';
  hint = controlsHint;
}

function finish(won) {
  active = false;
  phase = won ? 'won' : 'lost';
}

function move(now) {
  const target = document.activeElement;
  if (
    now < nextMove ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target?.isContentEditable
  )
    return;

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
  if (tile === undefined || tile === wallTile) return;
  if (tile === gateTile && collected < relicCells.length) {
    hint = 'The vault gate needs all three amber relics.';
    return;
  }

  walk = { column, row, start: now };
  column = nextColumn;
  row = nextRow;
  if (horizontal) player.flip = x < 0;

  collectRelic(now);
  if (column === exitColumn && row === exitRow) finish(true);
}

function collectRelic(now) {
  const relicIndex = relicCells.findIndex(
    ([relicX, relicY]) => relicX === column && relicY === row,
  );
  const visibility = relics[relicIndex]?.getComponent(VisibilityComponent);
  if (visibility?.visible) {
    visibility.visible = false;
    collected++;
    sounds.pickup?.play();
    emitBurst('#ffcf64');
    relicPulse = now + 260;
    if (collected === relicCells.length) {
      tilemap.data[exitRow][exitColumn] = floorTile;
      hint = 'The gate is open. Head to the far side of the Amber Vault.';
      sounds.unlock?.play();
    } else {
      hint = 'Amber relic recovered. Keep exploring.';
    }
  }
}

function animate(now) {
  const elapsed = walk ? now - walk.start : walkDuration;
  if (elapsed >= walkDuration || reducedMotion.matches) walk = undefined;
  const progress = walk ? elapsed / walkDuration : 1;
  const eased = progress * progress * (3 - 2 * progress);
  const x = walk ? walk.column + (column - walk.column) * eased : column;
  const y = walk ? walk.row + (row - walk.row) * eased : row;
  const lift = walk ? (Math.sin(progress * Math.PI) * 2) / cellSize : 0;
  positionInCell(player, x, y - lift, explorerSize);
  player.currentFrame = walk ? Math.min(3, Math.floor(progress * 4)) : 0;
  player.getComponent(VisibilityComponent).visible =
    !active ||
    now >= vulnerableAt ||
    reducedMotion.matches ||
    Math.floor(now / 90) % 2 === 0;

  for (const [index, relic] of relics.entries()) {
    const [relicX, relicY] = relicCells[index];
    const bob = reducedMotion.matches
      ? 0
      : (Math.sin(now / 285 + index) * 3) / cellSize;
    positionInCell(relic, relicX, relicY - bob, relicSize);
  }
}

function currentRoomIndex() {
  return Math.min(rooms.length - 1, Math.floor(column / roomWidth));
}

function updateCamera(now) {
  const camera = Engine.camera;
  const roomIndex = currentRoomIndex();
  const boardHeight = Math.max(80, game.height - (embedded ? 160 : 110));
  camera.zoom = Math.min(
    game.width / (9 * cellSize),
    boardHeight / (9 * cellSize),
    1.55,
  );

  const viewWidth = game.width / camera.zoom;
  const mapWidth = tilemap.data[0].length * cellSize;
  const roomLeft = (4.5 + roomIndex * roomWidth) * cellSize - viewWidth / 2;
  const targetX = Math.max(0, Math.min(mapWidth - viewWidth, roomLeft));

  const blend =
    previousFrame === undefined || reducedMotion.matches
      ? 1
      : 1 - Math.exp(-(now - previousFrame) / 95);
  camera.position.set(
    camera.position.x + (targetX - camera.position.x) * blend,
    4.5 * cellSize - (hudHeight + boardHeight / 2) / camera.zoom,
  );
  previousFrame = now;
}

function emitBurst(colour) {
  if (reducedMotion.matches) return;

  particles.burst(new Vector2((column + 0.5) * cellSize, (row + 0.5) * cellSize), {
    count: 8,
    velocity: index => {
      const angle = index * Math.PI / 4;
      return new Vector2(Math.cos(angle) * 95, Math.sin(angle) * 95);
    },
    gravity: new Vector2(0, 160),
    lifetime: 0.4,
    startRadius: 4,
    endRadius: 0,
    colour,
  });
}

function checkSpikeDamage(now) {
  if (
    active &&
    tilemap.data[row][column] === spikeTile &&
    now >= vulnerableAt
  ) {
    vulnerableAt = now + damageGrace;
    health--;
    sounds.damage?.play();
    emitBurst('#ff9474');
    if (!reducedMotion.matches) {
      game.shakeScreen(6, 0.22);
      game.chromaticAberration(3, 0.18);
    }
    healthPulse = now + 260;
    hint = 'Watch out for the obsidian spikes!';
    if (health === 0) finish(false);
  }
}
function update() {
  if (!player) return;
  const now = Engine.totalTime;
  if (active) move(now);
  animate(now);
  updateCamera(now);
  checkSpikeDamage(now);
}

async function loadLevel() {
  const response = await fetch(asset('rooms.tmj'), { signal: lifetime.signal });
  if (!response.ok)
    throw new Error(`Could not load rooms (HTTP ${response.status})`);
  const map = await response.json();
  if (lifetime.signal.aborted) return;

  for (const [name, file] of [
    ['tiles', 'ruins-atlas.png'],
    ['explorer', 'explorer-walk.png'],
    ['amber', 'amber.png'],
  ]) {
    Loader.queueImage(name, asset(file));
  }
  await Loader.loadAll();
  if (lifetime.signal.aborted) return;

  tilemap = Tilemap.fromTiled(map, {
    tileset: 'tiles',
    tag: 'ruin-rooms',
    position: new Vector2(0, 0),
  });
  const scale = cellSize / tilemap.tileSize;
  tilemap.transform.scale.set(scale, scale);
  amberImage = Loader.getImage('amber');
  relics = relicCells.map(([x, y], index) =>
    makeSprite(`relic-${index + 1}`, amberImage, x, y, relicSize),
  );
  particles = new ParticleEmitter({ zIndex: 10 });
  player = makeSprite(
    'explorer',
    Loader.getImage('explorer'),
    column,
    row,
    explorerSize,
    2,
  );
  phase = 'ready';
}

function toggleMute() {
  muted = !muted;
  Sound.setVolume('master', muted ? 0 : 1);
}

function changeVolume(channel, delta) {
  volume[channel] = Math.max(
    0,
    Math.min(1, Math.round((volume[channel] + delta) * 10) / 10),
  );
  Sound.setVolume(channel, volume[channel]);
}

const gold = '#f6b754';
const pale = '#f4ead6';
const smallFont = 'bold 13px system-ui, sans-serif';

function drawHud(ui, centre, pad) {
  const { width } = ui;
  const now = Engine.totalTime;
  const roomName = rooms[currentRoomIndex()];
  ui.panel({ x: 0, y: 0, width, height: hudHeight }, '#17282a');
  ui.label({
    x: pad,
    y: 17,
    text: 'AMBER RUINS',
    font: smallFont,
    colour: gold,
    maxWidth: width / 3 - pad,
  });
  ui.label({
    x: pad,
    y: 37,
    text: roomName,
    font: smallFont,
    colour: pale,
    maxWidth: width / 3 - pad,
  });
  ui.label({
    x: centre,
    y: 18,
    text: `Health ${health} / ${maxHealth}`,
    align: 'center',
    font: smallFont,
    colour: now < healthPulse && !reducedMotion.matches ? '#ff9474' : pale,
  });
  ui.progressBar({
    x: centre - 32,
    y: 30,
    width: 64,
    height: 6,
    value: health / maxHealth,
    colour: '#e47b60',
  });
  ui.label({
    x: width - pad,
    y: 19,
    text: `Relics ${collected} / ${relicCells.length}`,
    align: 'right',
    font: smallFont,
    colour: now < relicPulse && !reducedMotion.matches ? '#fff1c3' : gold,
  });
}

function drawExpeditionCard(ui, centre) {
  const { width, height } = ui;
  const cardWidth = Math.min(370, width - 16);
  const cardHeight = Math.min(208, Math.max(125, height - 100));
  const cardY = Math.max(
    hudHeight,
    (height - cardHeight - (embedded ? 30 : 0)) / 2,
  );

  const title = {
    loading: 'Opening the ruins…',
    ready: 'Into the ruins',
    won: 'Expedition complete',
    lost: 'Expedition lost',
    error: 'The ruins could not load',
  }[phase];
  const description = {
    ready: 'Collect three relics and open the vault gate.',
    won: 'You brought all three relics back.',
    lost: 'Avoid the spikes and try another route.',
    error: 'Reset or reload the game to try again.',
  }[phase];
  ui.panel(
    { x: 0, y: hudHeight, width, height: Math.max(0, height - hudHeight) },
    '#0b171aa0',
  );
  ui.panel(
    {
      x: centre - cardWidth / 2,
      y: cardY,
      width: cardWidth,
      height: cardHeight,
    },
    '#203234',
  );
  if (cardHeight >= 180 && amberImage) {
    ui.image(amberImage, {
      x: centre - 31,
      y: cardY + 5,
      width: 62,
      height: 62,
    });
  }
  ui.label({
    x: centre,
    y: cardY + (cardHeight >= 180 ? 79 : 26),
    text: title,
    font: 'bold 28px Georgia, serif',
    align: 'center',
    colour: pale,
    maxWidth: cardWidth - 18,
  });
  if (description)
    ui.label({
      x: centre,
      y: cardY + (cardHeight >= 180 ? 108 : 54),
      text: description,
      align: 'center',
      colour: '#b8c6be',
      maxWidth: cardWidth - 16,
    });
  if (['ready', 'won', 'lost'].includes(phase)) {
    ui.button({
      id: 'expedition',
      x: centre - 79,
      y: cardY + cardHeight - 55,
      width: 158,
      height: 38,
      text: phase === 'ready' ? 'Start expedition' : 'Try again',
      onPress: start,
      background: gold,
      hoverBackground: '#ffda94',
      colour: '#20180e',
    });
  }
}

function drawAudioControls(ui, centre, pad, audioTop) {
  const { width } = ui;
  const barWidth = Math.min(width - pad * 2, 388);
  const barX = centre - barWidth / 2;
  ui.panel({ x: barX, y: audioTop, width: barWidth, height: 33 }, '#17282a');

  const muteWidth = Math.min(105, barWidth * 0.27);
  ui.button({
    id: 'mute',
    x: barX,
    y: audioTop,
    width: muteWidth,
    height: 33,
    text: muted ? 'Unmute sound' : 'Mute sound',
    onPress: toggleMute,
  });

  const groupWidth = (barWidth - muteWidth) / 2;
  const stepWidth = Math.min(26, groupWidth / 4);
  for (const [index, channel] of ['music', 'effects'].entries()) {
    const left = barX + muteWidth + index * groupWidth;
    ui.button({
      id: `${channel}-down`,
      x: left,
      y: audioTop,
      width: stepWidth,
      height: 33,
      text: '−',
      onPress: () => changeVolume(channel, -0.1),
    });

    ui.label({
      x: left + groupWidth / 2,
      y: audioTop + 16,
      align: 'center',
      text: `${channel === 'music' ? 'Music' : 'Effects'} ${Math.round(volume[channel] * 100)}%`,
      font: '12px system-ui, sans-serif',
      maxWidth: groupWidth - 2 * stepWidth - 2,
    });

    ui.button({
      id: `${channel}-up`,
      x: left + groupWidth - stepWidth,
      y: audioTop,
      width: stepWidth,
      height: 33,
      text: '+',
      onPress: () => changeVolume(channel, 0.1),
    });
  }
}

function drawUI(ui) {
  const { width, height } = ui;
  const centre = ui.anchor('centre', 'top').x;
  const pad = width < 400 ? 9 : 15;
  const audioTop = height - (embedded ? 86 : 43);

  drawHud(ui, centre, pad);
  if (phase !== 'playing') drawExpeditionCard(ui, centre);
  drawAudioControls(ui, centre, pad, audioTop);

  if (phase === 'playing') {
    ui.label({
      x: centre,
      y: audioTop - 13,
      align: 'center',
      text: hint,
      colour: pale,
      font: '13px system-ui, sans-serif',
      maxWidth: width - pad * 2,
    });
  }
}

Sound.setVolume('master', 1);
for (const channel of ['music', 'effects'])
  Sound.setVolume(channel, volume[channel]);
const onPaused = event => {
  void Sound.setPaused(event.detail);
};
Engine.on('paused', onPaused);
void Sound.setPaused(Engine.paused);

const game = new Engine(
  {
    onLoad: () => {
      loadLevel().catch(error => {
        if (lifetime.signal.aborted) return;
        phase = 'error';
        console.error(error);
      });
    },
    onDispose: () => {
      lifetime.abort();
      stopMusic?.();
      Engine.off('paused', onPaused);
    },
    update,
    drawUI,
  },
  {
    title: 'Amber Ruins',
    containerId: embedded
      ? 'playground-canvas-container'
      : 'amber-ruins-viewport',
    backgroundColour: '#0b171a',
  },
);
