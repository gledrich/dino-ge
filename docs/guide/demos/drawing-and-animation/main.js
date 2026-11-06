import { Circle, Engine, Line, Loader, Rectangle, Sprite, Text, Vector2 } from 'dino-ge';

const status = document.querySelector('#status');
let explorer;
let animating = true;

new Engine({
  async onLoad() {
    try {
      Loader.queueImage('explorer', import.meta.resolve('amber-assets/explorer-walk.png'));
      await Loader.loadAll(percent => { status.textContent = `Loading ${Math.round(percent)}%`; });

      explorer = new Sprite({
        tag: 'explorer', img: 'explorer', rows: 1, cols: 2,
        startCol: 0, endCol: 1, scale: 0.75, position: new Vector2(24, 85), zIndex: 1,
      });
      explorer.play();
      new Rectangle({ position: new Vector2(145, 64), width: 32, height: 97, colour: '#4c766e', zIndex: 2 });
      new Line({ p1: new Vector2(16, 165), p2: new Vector2(265, 165), colour: '#a1bdb4' });
      new Circle({ position: new Vector2(244, 140), radius: 6, colour: '#ffc46f' });
      new Text({ position: new Vector2(18, 26), text: 'The Gatehouse', fontSize: '18', colour: '#edf5f3' });
      status.textContent = 'Walking behind the pillar';
    } catch (error) {
      status.textContent = error.message;
      throw error;
    }
  },
  fixedUpdate() {
    if (!explorer) return;
    const position = explorer.transform.position;
    position.x = position.x >= 244 ? 24 : position.x + 1;
  },
}, { containerId: 'game', width: '100%', height: '100%', backgroundColour: '#183035' });

document.querySelector('#animate').addEventListener('click', () => {
  if (!explorer) return;
  animating = !animating;
  if (animating) explorer.play();
  else explorer.stop();
  status.textContent = animating ? 'Sprite animation playing' : 'Sprite animation stopped';
});
