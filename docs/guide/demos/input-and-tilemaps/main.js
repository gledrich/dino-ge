import { Circle, Engine, Input, Loader, Tilemap, Vector2 } from 'dino-ge';

const game = document.querySelector('#game');
const status = document.querySelector('#status');
const tileSize = 32;
const wall = 1;
let map;
let explorer;
let relic;
let column = 1;
let row = 1;
let nextStep = 0;

function inCell(x, y, radius) {
  return new Vector2((x + 0.5) * tileSize - radius, (y + 0.5) * tileSize - radius);
}

function move(dx, dy) {
  if (!explorer) return;
  const x = column + dx;
  const y = row + dy;
  const tile = map.data[y]?.[x];
  if (tile === undefined || tile === wall) {
    status.textContent = 'Blocked by a wall';
    return;
  }
  column = x;
  row = y;
  explorer.transform.position.copy(inCell(x, y, explorer.radius));
  status.textContent = `Column ${x}, row ${y}`;
  if (relic && x === 4 && y === 1) {
    relic.destroySelf();
    relic = undefined;
    status.textContent = 'Relic collected';
  }
}

new Engine({
  async onLoad() {
    try {
      const response = await fetch(new URL('./room.tmj', import.meta.url));
      if (!response.ok) throw new Error(`Map request failed: ${response.status}`);
      Loader.queueImage('tiles', new URL('./tiles.svg', import.meta.url).href);
      await Loader.loadAll();
      map = Tilemap.fromTiled(await response.json(), { tag: 'room', tileset: 'tiles', position: new Vector2(0, 0) });
      relic = new Circle({ position: inCell(4, 1, 7), radius: 7, colour: '#ffc46f', zIndex: 1 });
      explorer = new Circle({ position: inCell(column, row, 10), radius: 10, colour: '#9ce4cf', zIndex: 2 });
      status.textContent = 'Find a route around the wall';
    } catch (error) {
      status.textContent = error.message;
      throw error;
    }
  },
  update() {
    if (!explorer || document.activeElement !== game || performance.now() < nextStep) return;
    const stick = Input.getGamepadAxes();
    const x = Number(Input.isKeyDown('ArrowRight')) - Number(Input.isKeyDown('ArrowLeft'));
    const y = Number(Input.isKeyDown('ArrowDown')) - Number(Input.isKeyDown('ArrowUp'));
    const dx = x || (Math.abs(stick.x) > 0.5 ? Math.sign(stick.x) : 0);
    const dy = y || (Math.abs(stick.y) > 0.5 ? Math.sign(stick.y) : 0);
    if (!dx && !dy) return;
    move(dx, dx ? 0 : dy);
    nextStep = performance.now() + 150;
  },
}, { containerId: 'game', width: '100%', height: '100%', backgroundColour: '#183035' });

game.addEventListener('keydown', event => {
  if (event.key.startsWith('Arrow')) event.preventDefault();
});
for (const button of document.querySelectorAll('[data-step]')) {
  const [dx, dy] = button.dataset.step.split(',').map(Number);
  button.addEventListener('click', () => move(dx, dy));
}
