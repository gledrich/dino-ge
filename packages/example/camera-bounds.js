import { Engine, Input, Rectangle, Vector2 } from 'dino-ge';

const world = { x: -120, y: -40, width: 760, height: 280 };
const playerSize = 22;
const step = 3;
const fixedStepSeconds = 1 / 60;
const survey = document.getElementById('survey');
const bounded = document.getElementById('bounded');
const smooth = document.getElementById('smooth');
const jump = document.getElementById('jump');
const zoom = document.getElementById('zoom');
const readout = document.getElementById('camera-origin');
let surveyor;

function preventMapScroll(event) {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) event.preventDefault();
}

function rect(x, y, width, height, colour, zIndex = 0) {
  return new Rectangle({ position: new Vector2(x, y), width, height, colour, zIndex });
}

function jumpSurveyor() {
  const position = surveyor.transform.position;
  position.x = position.x < world.x + world.width / 2 ? world.x + world.width - 50 : world.x + 28;
}

function followSurveyor() {
  const camera = Engine.camera;
  const bounds = bounded.checked ? world : undefined;
  camera.zoom = Number(zoom.value);
  if (smooth.checked) {
    camera.followSmooth(surveyor, game.width, game.height, fixedStepSeconds, { response: 5, bounds });
  } else {
    camera.follow(surveyor, game.width, game.height, bounds);
  }
}

const game = new Engine({
  onLoad() {
    survey.addEventListener('keydown', preventMapScroll);
    Input.setActions({
      moveX: [{ key: 'a', scale: -1 }, { key: 'ArrowLeft', scale: -1 }, { key: 'd' }, { key: 'ArrowRight' }, { axis: 0 }],
      moveY: [{ key: 'w', scale: -1 }, { key: 'ArrowUp', scale: -1 }, { key: 's' }, { key: 'ArrowDown' }, { axis: 1 }],
    });

    rect(world.x, world.y, world.width, world.height, '#42675c');
    rect(world.x + 4, world.y + 4, world.width - 8, world.height - 8, '#203c3b', 1);
    rect(world.x + 12, 96, world.width - 24, 8, '#53756c', 2);
    for (const x of [-80, 80, 240, 400, 560]) {
      rect(x, -15, 3, 230, '#355650', 2);
      rect(x - 5, 94, 13, 12, '#9cb99e', 3);
    }
    surveyor = rect(world.x + 28, 88, playerSize, playerSize, '#ffd78a', 4);
    Engine.camera.follow(surveyor, game.width, game.height, world);
    jump.disabled = false;
    jump.addEventListener('click', jumpSurveyor);
  },
  onDispose() {
    survey.removeEventListener('keydown', preventMapScroll);
    jump.removeEventListener('click', jumpSurveyor);
    Input.setActions({});
  },
  fixedUpdate() {
    if (document.activeElement === survey) {
      const x = Input.getActionValue('moveX');
      const y = Input.getActionValue('moveY');
      const speed = step / Math.max(1, Math.hypot(x, y));
      const position = surveyor.transform.position;
      position.set(
        Math.max(world.x, Math.min(world.x + world.width - playerSize, position.x + x * speed)),
        Math.max(world.y, Math.min(world.y + world.height - playerSize, position.y + y * speed)),
      );
    }
    followSurveyor();
  },
  update() {
    const { x, y } = Engine.camera.position;
    const text = `Camera origin (${Math.round(x)}, ${Math.round(y)})`;
    if (readout.textContent !== text) readout.textContent = text;
  },
}, { title: 'Bounded camera follow | Dino GE', containerId: 'survey', backgroundColour: '#102024' });
