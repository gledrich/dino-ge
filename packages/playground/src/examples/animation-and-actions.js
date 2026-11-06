import { Actions, Engine, Loader, Sprite, Vector2 } from 'dino-ge';

let sprite;
const sheet = '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="24">'
  + '<circle cx="12" cy="12" r="6" fill="#f6bb64"/>'
  + '<circle cx="36" cy="12" r="9" fill="#f6bb64"/>'
  + '<circle cx="60" cy="12" r="11" fill="#f6bb64"/></svg>';

function replay() {
  sprite.actions.clear();
  sprite.transform.position.set(24, 90);
  sprite.playAnimation('pulse', { restart: true });
  sprite.actions.enqueue(
    Actions.fadeTo(1, 0),
    Actions.moveTo(new Vector2(Math.max(24, Math.min(game.width - 56, 300)), 90), 0.9),
    Actions.wait(0.2),
    Actions.fadeTo(0.25, 0.5),
    Actions.call(object => object.pauseAnimation()),
  );
}

const game = new Engine({
  async onLoad() {
    Loader.queueImage('pulse', 'data:image/svg+xml,' + encodeURIComponent(sheet));
    await Loader.loadAll();
    sprite = new Sprite({
      tag: 'Pulse',
      img: 'pulse',
      rows: 1,
      cols: 3,
      scale: 2,
      animations: {
        pulse: { mode: 'pingPong', frames: [
          { frame: 0, durationMs: 140 },
          { frame: 1, durationMs: 100 },
          { frame: 2, durationMs: 160 },
        ] },
      },
    });
    replay();
  },
  drawUI(ui) {
    if (sprite) ui.button({ id: 'replay', x: 12, y: 12, width: 150, height: 34, text: 'Replay actions', onPress: replay });
  },
}, { containerId: 'playground-canvas-container', backgroundColour: '#162b32' });
