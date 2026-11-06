import { Engine, Input, Rectangle, Vector2 } from 'dino-ge';

const world = { x: 0, y: 0, width: 1400, height: 400 };
let player;
let smooth = true;

const game = new Engine({
  onLoad() {
    Input.setActions({
      horizontal: [{ key: 'ArrowLeft', scale: -1 }, { key: 'ArrowRight' }, { axis: 0 }],
    });
    for (let x = 0; x < world.width; x += 80) {
      new Rectangle({
        tag: 'Marker ' + x,
        position: new Vector2(x, 120),
        width: 50,
        height: 90,
        colour: x % 160 ? '#497575' : '#659895',
      });
    }
    player = new Rectangle({
      tag: 'Surveyor',
      position: new Vector2(24, 148),
      width: 30,
      height: 30,
      colour: '#f6bb64',
      zIndex: 1,
    });
  },
  fixedUpdate() {
    const position = player.transform.position;
    position.x = Math.max(0, Math.min(world.width - 30, position.x + 5 * Input.getActionValue('horizontal')));
    const camera = Engine.camera;
    if (smooth) camera.followSmooth(player, game.width, game.height, 1 / 60, { bounds: world, response: 5 });
    else camera.follow(player, game.width, game.height, world);
  },
  drawUI(ui) {
    ui.label({ x: 12, y: 58, text: 'Move with the arrow keys or left stick.' });
    ui.button({
      id: 'smooth', x: 12, y: 12, width: 150, height: 34,
      text: smooth ? 'Smooth follow on' : 'Smooth follow off',
      onPress: () => { smooth = !smooth; },
    });
  },
  onDispose() { Input.setActions({}); },
}, { containerId: 'playground-canvas-container', backgroundColour: '#162b32' });
