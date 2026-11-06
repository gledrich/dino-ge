import {
  Engine, Input, Loader, ParticleEmitter, Sprite, SpriteComponent, Tilemap, Vector2,
} from 'dino-ge';
import { maps, newChapter, propFrames, readChapter, saveChapter, tiles } from './outpost-world.js';

const cell = 48;
const mapBorder = 8;
const propColumns = Object.keys(propFrames).length;
const stepTime = 145;
const gold = '#f6c477';
const ivory = '#f5e9d5';
const soft = '#b8c9bc';
const panel = '#15292d';
const ink = '#101d23';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const movement = [
  ['ArrowRight', 'd', 1, 0], ['ArrowLeft', 'a', -1, 0],
  ['ArrowDown', 's', 0, 1], ['ArrowUp', 'w', 0, -1],
];

const conversations = {
  intro: ['Iona · Keeper of Lanternreach', [
    'The old signal fire went out before I was born.',
    'Bring reedwood and the amber lens. We can rebuild the crossing.',
  ]],
  flowers: ['Iona · Keeper of Lanternreach', [
    'Moonbells! My sister used to tuck them behind the lantern glass.',
    'I’ll plant these by the cabin. The next traveller can see them too.',
  ]],
  ending: ['Iona · Keeper of Lanternreach', [
    'I thought the river had swallowed the road for good.',
    'Leave the fire burning. Someone out there is looking for home.',
  ]],
  notes: ['A surveyor’s last entry', [
    'If the west passage floods, follow the lanterns around the spikes.',
    'The lens was made to hold the light of a whole valley.',
  ]],
  scout: ['Tern · Marsh surveyor', [
    'The archive floods from below. There’s a sluice just inside.',
    'Those are moonbells by the water. Iona used to grow them at home.',
  ]],
  lit: ['The Skywell shines again', [
    'Light spills across the marsh. A lantern answers from the outpost.',
    'You can follow the road home, or stay and watch a while.',
  ]],
};

function label(ui, text, x, y, options = {}) {
  ui.label({ text, x, y, font: '14px system-ui, sans-serif', colour: ivory, ...options });
}

function button(ui, id, text, x, y, width, onPress, primary = false) {
  ui.button({
    id, text, x, y, width, height: 36, onPress,
    background: primary ? gold : '#29464a',
    hoverBackground: primary ? '#ffe2a0' : '#3b5b5a',
    colour: primary ? ink : ivory,
  });
}

function sprite(tag, image, cols, frame, size, x, y) {
  const sheet = Loader.getImage(image);
  const rows = image === 'explorer' ? 2 : 1;
  const object = new Sprite({
    tag, img: sheet, cols, rows, endCol: cols * rows,
    scale: size / (sheet.width / cols),
    position: new Vector2(x, y),
  });
  object.play();
  object.getComponent(SpriteComponent).playing = false;
  object.currentFrame = frame;
  return object;
}

export class Outpost {
  constructor(embedded, audio) {
    this.embedded = embedded;
    this.touch = window.matchMedia('(pointer: coarse)').matches &&
      !document.querySelector('.touch-arrows');
    this.audio = audio;
    this.progress = readChapter();
    this.objects = [];
    this.phase = 'loading';
    this.health = 3;
    this.buttons = { interact: false, journal: false };
  }

  async load(asset, signal) {
    for (const [name, file] of [
      ['outpost-tiles', 'lanternreach-tiles.svg'],
      ['outpost-props', 'lanternreach-props.svg'],
      ['explorer', 'explorer-walk.png'],
      ['amber', 'amber.png'],
    ]) Loader.queueImage(name, asset(file));
    await Loader.loadAll();
    if (signal.aborted) return;
    this.player = sprite('explorer', 'explorer', 2, 0, 44, 0, 0);
    this.phase = 'title';
    this.enter('lanternreach', 7, 5);
  }

  enter(id, x, y) {
    this.area = id;
    this.map = maps[id];
    this.x = x;
    this.y = y;
    this.walk = null;
    this.nextMove = Engine.totalTime + stepTime;
    this.vulnerableAt = 0;
    this.nextMotes = 0;
    this.rebuild();
    this.animate(Engine.totalTime);
  }

  rebuild() {
    for (const object of this.objects) object.destroySelf();
    const ground = this.area === 'archive' ? tiles['#'] : tiles['~'];
    const edge = Array(mapBorder).fill(ground);
    const terrain = this.map.terrain.map(row => [
      ...edge,
      ...Array.from(row, tile => {
        if (tile === 'b' && !this.progress?.bridge) return tiles.broken;
        if (tile === '|') return this.progress?.sluice ? tiles.s : tiles['~'];
        return tiles[tile];
      }),
      ...edge,
    ]);
    const map = new Tilemap({
      tag: this.area, tileset: 'outpost-tiles', tileSize: 32, tilesetCols: 8,
      imageSmoothing: false,
      data: terrain,
      position: new Vector2(-mapBorder * cell, 0),
    });
    map.transform.scale.set(cell / 32, cell / 32);
    this.objects = [map];

    for (const [kind, x, y] of this.map.props) {
      if ((kind === 'wood' && this.progress?.wood) ||
          (kind === 'flowers' && this.area === 'reedbank' && this.progress?.flowers) ||
          (kind === 'post' && this.area === 'lanternreach' && this.progress?.bridge)) continue;
      this.addProp(kind === 'beacon' && this.progress?.beacon ? 'lit' : kind, x, y);
      if (kind === 'plinth' && !this.progress?.lens) {
        const lens = sprite('amber-lens', 'amber', 1, 0, 44, x * cell + 2, y * cell - 17);
        lens.metadata.zIndex = 102 + y * cell;
        this.objects.push(lens);
      }
    }
    if (this.area === 'lanternreach' && this.progress?.gift) {
      this.addProp('flowers', 3, 5);
      this.addProp('flowers', 5, 5);
    }
    this.particles = new ParticleEmitter({ zIndex: 900 });
    this.objects.push(this.particles);
  }

  addProp(kind, x, y) {
    const size = { cabin: 110, tree: 91, arch: 67, beacon: 70, lit: 70 }[kind] ?? 54;
    const object = sprite(
      `${kind}-${x}-${y}`, 'outpost-props', propColumns, propFrames[kind], size,
      (x + 0.5) * cell - size / 2, (y + 0.88) * cell - size,
    );
    // The feet, rather than the top of the sprite, determine what occludes the explorer.
    object.metadata.zIndex = 100 + y * cell;
    this.objects.push(object);
  }

  start() {
    this.audio.start();
    this.progress ??= newChapter();
    this.phase = 'playing';
    this.enter('lanternreach', 7, 5);
    this.nextMove = 0;
    if (this.progress.beacon) this.notify('The beacon is lit');
  }

  checkpoint(flag, message) {
    this.progress[flag] = true;
    this.saved = saveChapter(this.progress);
    this.notify(message);
    this.rebuild();
    this.audio.play(['bridge', 'beacon', 'sluice'].includes(flag) ? 'unlock' : 'pickup');
    this.burst(12, gold);
  }

  notify(message) {
    this.notice = message;
    this.noticeUntil = Engine.totalTime + 4800;
  }

  burst(count, colour) {
    if (reducedMotion.matches) return;
    this.particles.burst(new Vector2((this.x + 0.5) * cell, (this.y + 0.5) * cell), {
      count, colour, lifetime: 0.65, startRadius: 3, endRadius: 0,
      velocity: index => {
        const angle = index * 2.4;
        return new Vector2(Math.cos(angle) * 75, Math.sin(angle) * 75);
      },
    });
  }

  nearbyAction() {
    const actions = this.map.actions.filter(([, , , id]) => {
      return !['wood', 'lens', 'flowers', 'bridge', 'beacon', 'sluice'].includes(id) || !this.progress[id];
    });
    return actions.find(([x, y]) => x === this.x && y === this.y) ??
      actions.find(([x, y]) => Math.abs(x - this.x) + Math.abs(y - this.y) === 1);
  }

  interact() {
    if (this.overlay) {
      this.overlay = null;
      return;
    }
    const id = this.nearbyAction()?.[3];
    switch (id) {
      case 'keeper':
        if (this.progress.flowers && !this.progress.gift) {
          this.checkpoint('gift', 'Moonbells planted at the cabin');
          this.overlay = 'flowers';
        } else this.overlay = this.progress.beacon ? 'ending' : 'intro';
        break;
      case 'wood':
        this.checkpoint('wood', 'Reedwood recovered');
        break;
      case 'lens':
        this.checkpoint('lens', 'Amber lens recovered');
        break;
      case 'sluice':
        this.checkpoint('sluice', 'The archive sluice is open');
        break;
      case 'bridge':
        if (this.progress.wood && this.progress.lens) {
          this.checkpoint('bridge', 'The bridge is restored');
        } else this.notify('The crossing needs reedwood and the amber lens.');
        break;
      case 'beacon':
        this.checkpoint('beacon', 'The beacon is lit');
        this.overlay = 'lit';
        break;
      case 'scout':
        this.overlay = 'scout';
        break;
      case 'flowers':
        this.checkpoint('flowers', 'Moonbells gathered');
        break;
      case 'notes':
        if (!this.progress.notes) this.checkpoint('notes', 'Field notes recorded');
        this.overlay = 'notes';
        break;
      case 'rest':
        this.health = 3;
        this.notify('You rest by the cabin. Health restored.');
        break;
    }
  }

  move(dx, dy, now) {
    if (now < this.nextMove || this.overlay) return;
    this.nextMove = now + stepTime;
    const x = this.x + dx;
    const y = this.y + dy;
    const tile = this.map.terrain[y]?.[x];
    if (tile === 'b' && !this.progress.bridge) {
      this.notify('The bridge is out. Look for materials across the marsh.');
      return;
    }
    if (tile === '|' && !this.progress.sluice) {
      this.notify('The passage is flooded. Find the sluice lever.');
      return;
    }
    if (!tile || tile === '~' || tile === '#') return;

    const exit = this.map.exits.find(([ex, ey]) => ex === x && ey === y);
    if (exit) {
      this.enter(...exit.slice(2));
      return;
    }
    this.walk = { x: this.x, y: this.y, time: now };
    this.x = x;
    this.y = y;
    if (dx) this.player.flip = dx < 0;
    if (tile === '^' && now >= this.vulnerableAt) {
      this.vulnerableAt = now + 550;
      this.health--;
      this.audio.play('damage');
      this.burst(7, '#eb8b74');
      if (this.health === 0) {
        this.health = 3;
        this.enter('lanternreach', 7, 5);
        this.notify('Iona carried you home. Your finds are safe.');
      } else this.notify('Obsidian spikes! Take the route around them.');
    }
  }

  animate(now) {
    const t = this.walk && !reducedMotion.matches ? Math.min(1, (now - this.walk.time) / 120) : 1;
    const ease = t * t * (3 - 2 * t);
    const x = t === 1 ? this.x : this.walk.x + (this.x - this.walk.x) * ease;
    const y = t === 1 ? this.y : this.walk.y + (this.y - this.walk.y) * ease;
    this.player.transform.position.set(x * cell + 2, y * cell + 2);
    this.player.metadata.zIndex = 110 + Math.round(y * cell);
    this.player.currentFrame = t === 1 ? 0 : Math.floor(t * 4);
  }

  camera(width, height) {
    const camera = Engine.camera;
    const header = 72;
    const footer = this.footerOffset + 14;
    const board = Math.max(80, height - header - footer);
    const mapWidth = this.map.terrain[0].length * cell;
    const mapHeight = this.map.terrain.length * cell;
    camera.zoom = Math.min(Math.max(0.88, (width - 12) / mapWidth), board / mapHeight, 1.65);
    const viewWidth = width / camera.zoom;
    const playerX = this.player.transform.position.x + cell / 2;
    const left = viewWidth > mapWidth ? (mapWidth - viewWidth) / 2 :
      Math.max(0, Math.min(mapWidth - viewWidth, playerX - viewWidth / 2));
    camera.position.set(left, mapHeight / 2 - (header + board / 2) / camera.zoom);
  }

  update(width, height) {
    if (!this.player) return;
    const now = Engine.totalTime;
    const gamepad = Input.getGamepad();
    const interact = Input.isKeyDown('e') || gamepad?.buttons?.[0]?.pressed;
    const journal = Input.isKeyDown('j') || gamepad?.buttons?.[3]?.pressed;
    if (this.phase === 'title' && interact && !this.buttons.interact) {
      this.start();
    } else if (this.phase === 'playing') {
      if (journal && !this.buttons.journal) this.overlay = this.overlay === 'journal' ? null : 'journal';
      if (interact && !this.buttons.interact) this.interact();
      if (Input.isKeyDown('Escape')) this.overlay = null;
      const direction = movement.find(([arrow, letter]) => Input.isKeyDown(arrow) || Input.isKeyDown(letter));
      if (direction) this.move(direction[2], direction[3], now);
      else {
        const { x, y } = Input.getGamepadAxes();
        if (x || y) {
          if (Math.abs(x) >= Math.abs(y)) this.move(Math.sign(x), 0, now);
          else this.move(0, Math.sign(y), now);
        }
      }
    }
    this.buttons = { interact, journal };
    this.animate(now);
    this.camera(width, height);
    if (this.nextMotes <= now && !reducedMotion.matches) {
      this.nextMotes = now + 420;
      const x = 70 + Math.random() * 480;
      const y = 65 + Math.random() * 305;
      this.particles.burst(new Vector2(x, y), {
        count: 2, colour: this.area === 'archive' ? '#7ca4a6' : '#e6c886',
        lifetime: 1.9, startRadius: 2.3, endRadius: 0, velocity: () => new Vector2(8, -15),
      });
    }
  }

  objective() {
    const { wood, sluice, lens, bridge, beacon } = this.progress;
    if (beacon) return 'Lanternreach shines again';
    if (bridge) return 'Climb to the Skywell and light the beacon';
    if (wood && lens) return 'Return to Lanternreach and repair the bridge';
    if (this.area === 'archive' && !lens && !sluice) return 'Open the sluice to reach the amber lens';
    if (this.area === 'archive' && !lens) return 'Reach the lens by going around the spikes';
    if (wood) return 'Find the amber lens in the Sunken Archive';
    return 'Follow the east path and gather reedwood';
  }

  get footerOffset() {
    return (this.embedded ? 146 : 98) + (this.touch ? 44 : 0);
  }

  draw(ui) {
    const { width, height } = ui;
    const centre = width / 2;
    if (this.phase !== 'playing') {
      this.drawTitle(ui, centre);
      return;
    }
    ui.panel({ x: 0, y: 0, width, height: 67 }, panel);
    ui.panel({ x: 0, y: 67, width, height: 1 }, '#61705d');
    label(ui, this.map.subtitle, 14, 16, { font: 'bold 10px system-ui', colour: gold, maxWidth: width - 110 });
    label(ui, this.map.name, 14, 42, { font: '25px Georgia, serif', maxWidth: width - 110 });
    label(ui, `Health ${this.health} / 3`, width - 14, 40, { align: 'right', colour: '#efaa90' });

    const bottom = height - this.footerOffset;
    ui.panel({ x: 0, y: bottom, width, height: height - bottom }, panel);
    ui.panel({ x: 0, y: bottom, width, height: 1 }, '#61705d');
    const notice = Engine.totalTime < this.noticeUntil ? this.notice : this.objective();
    label(ui, notice, centre, bottom + 17, { align: 'center', maxWidth: width - 20, colour: gold });

    const action = this.nearbyAction();
    const actionWidth = Math.min(220, width - 125);
    if (!this.overlay) {
      if (action) button(ui, 'act', `E · ${action[2]}`, 12, bottom + 32, actionWidth, () => this.interact(), true);
      button(ui, 'journal', 'J · Journal', width - 110, bottom + 32, 98, () => { this.overlay = 'journal'; });
      if (this.touch) {
        for (const [index, [symbol, dx, dy]] of [['←', -1, 0], ['↑', 0, -1], ['↓', 0, 1], ['→', 1, 0]].entries()) {
          button(ui, `move-${index}`, symbol, centre - 94 + index * 48, bottom + 76, 44,
            () => this.move(dx, dy, Engine.totalTime));
        }
      }
    }
    const controls = this.touch ? 'Tap the arrows to move' : 'WASD / arrows / left stick · Move';
    label(ui, this.saved === false ? 'Saving unavailable in this browser' : controls, centre, bottom + (this.touch ? 126 : 82), {
      align: 'center', maxWidth: width - 20, colour: soft, font: '12px system-ui',
    });
    if (this.overlay) this.drawOverlay(ui, centre);
  }

  drawTitle(ui, centre) {
    const { width, height } = ui;
    const cardWidth = Math.min(460, width - 24);
    const cardHeight = Math.min(300, height - 20);
    const top = Math.max(10, (height - cardHeight) / 2 - (this.embedded ? 25 : 0));
    const x = centre - cardWidth / 2;
    ui.panel({ x: 0, y: 0, width, height }, '#08161888');
    ui.panel({ x, y: top, width: cardWidth, height: cardHeight }, panel);
    ui.panel({ x, y: top, width: cardWidth, height: 2 }, gold);
    if (cardHeight >= 250 && this.player) {
      ui.image(Loader.getImage('amber'), { x: centre - 32, y: top + 11, width: 64, height: 64 });
    }
    const titleY = top + (cardHeight >= 250 ? 97 : 55);
    label(ui, 'AMBER RUINS', centre, titleY, {
      align: 'center', font: 'bold 38px Georgia, serif', colour: gold, maxWidth: cardWidth - 24,
    });
    label(ui, 'THE LANTERNREACH CHAPTER', centre, titleY + 33, {
      align: 'center', font: 'bold 12px system-ui', colour: soft, maxWidth: cardWidth - 20,
    });
    if (cardHeight >= 250) label(ui, 'An old road. A dark beacon. Someone waiting for the light.', centre, top + 173, {
      align: 'center', maxWidth: cardWidth - 20,
    });
    if (this.phase === 'title') {
      button(ui, 'begin', this.progress ? 'Continue chapter' : 'Begin chapter', centre - 95, top + cardHeight - 68, 190,
        () => this.start(), true);
    } else label(ui, this.phase === 'error' ? 'The chapter could not load. Reload to try again.' : 'Opening the road…',
      centre, top + cardHeight - 36, { align: 'center', maxWidth: cardWidth - 20 });
  }

  drawOverlay(ui, centre) {
    const { width, height } = ui;
    const journal = this.overlay === 'journal';
    const cardWidth = Math.min(520, width - 24);
    const cardHeight = Math.min(journal ? 248 : 190, height - 8);
    const top = Math.max(4, (height - cardHeight) / 2 - (this.embedded ? 20 : 0));
    const x = centre - cardWidth / 2;
    ui.panel({ x: 0, y: 0, width, height }, '#081618b8');
    ui.panel({ x, y: top, width: cardWidth, height: cardHeight }, panel);
    ui.panel({ x, y: top, width: cardWidth, height: 2 }, gold);
    const { wood, lens, bridge, beacon, flowers, gift, notes } = this.progress;
    const [title, lines] = journal ? ['Field journal', [
      this.objective(),
      `Reedwood  ${wood ? '✓' : '○'}     Amber lens  ${lens ? '✓' : '○'}     Bridge  ${bridge ? '✓' : '○'}`,
      `Beacon  ${beacon ? '✓' : '○'}     Moonbells  ${gift ? 'Planted' : flowers ? 'Gathered' : '○'}`,
      notes ? 'Archive survey recorded' : 'Find the surveyor’s notes in the archive.',
    ]] : conversations[this.overlay];
    label(ui, title, x + 18, top + 28, { font: '22px Georgia, serif', colour: gold, maxWidth: cardWidth - 36 });
    const bodyTop = cardHeight < 190 ? 51 : 68;
    const lineHeight = Math.min(24, (cardHeight - bodyTop - 50) / lines.length);
    for (const [index, line] of lines.entries()) {
      if (lineHeight >= 11) label(ui, line, x + 18, top + bodyTop + index * lineHeight, {
        maxWidth: cardWidth - 36, colour: soft,
        font: `${Math.min(14, lineHeight - 1)}px system-ui`,
      });
    }
    if (journal) button(ui, 'mute-chapter', this.audio.muted() ? 'Unmute sound' : 'Mute sound', x + 18,
      top + cardHeight - 51, 128, this.audio.toggle);
    button(ui, 'close-overlay', 'Close', x + cardWidth - 106, top + cardHeight - 51, 88, () => { this.overlay = null; });
  }
}
