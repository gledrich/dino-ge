import { Circle, Engine, Scene, Vector2 } from 'dino-ge';

class Clearing extends Scene {
  onLoad() {
    this.explorer = new Circle({ position: new Vector2(24, 80), radius: 12, colour: '#ffc46f' });
    this.add(this.explorer);
  }
}

const status = document.querySelector('#status');
const pause = document.querySelector('#pause');
let game;

function start() {
  game?.terminate();
  const clearing = new Clearing();
  game = new Engine({
    onLoad() {
      Engine.currentScene = clearing;
    },
    fixedUpdate() {
      const position = clearing.explorer.transform.position;
      position.x = position.x + 2 >= game.width - 20 ? 24 : position.x + 2;
    },
  }, { containerId: 'game', width: '100%', height: '100%', backgroundColour: '#183035' });
  Engine.paused = false;
  pause.textContent = 'Pause';
  status.textContent = 'Running';
}

pause.addEventListener('click', () => {
  Engine.paused = !Engine.paused;
  pause.textContent = Engine.paused ? 'Resume' : 'Pause';
  status.textContent = Engine.paused ? 'Paused' : 'Running';
});
document.querySelector('#restart').addEventListener('click', start);
start();
