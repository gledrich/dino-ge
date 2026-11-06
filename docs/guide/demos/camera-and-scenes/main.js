import { Circle, Engine, Rectangle, Scene, Text, Vector2 } from 'dino-ge';

const status = document.querySelector('#status');
const cross = document.querySelector('#cross');
const exit = document.querySelector('#exit');
let cameraTarget = 0;

class Rooms extends Scene {
  onLoad() {
    for (const [x, colour] of [[0, '#376057'], [360, '#3c526d']]) {
      this.add(new Rectangle({ position: new Vector2(x, 0), width: 360, height: 220, colour }));
      this.add(new Text({
        position: new Vector2(x + 22, 32), text: x ? 'Amber Vault' : 'Gatehouse',
        colour: '#edf5f3', fontSize: '19', zIndex: 1,
      }));
    }
    this.explorer = new Circle({ position: new Vector2(80, 110), radius: 12, colour: '#ffc46f', zIndex: 2 });
    this.add(this.explorer);
    status.textContent = 'Gatehouse';
  }

  update() {
    const position = Engine.camera.position;
    position.x += (cameraTarget - position.x) * 0.12;
  }
}

class BeyondTheRuins extends Scene {
  onLoad() {
    Engine.camera.reset();
    this.add(new Text({ position: new Vector2(22, 70), text: 'Outside the ruins', colour: '#edf5f3', fontSize: '22' }));
    status.textContent = 'Outside the ruins';
  }
}

const rooms = new Rooms();
const game = new Engine({
  onLoad() {
    Engine.currentScene = rooms;
  },
}, { containerId: 'game', width: '100%', height: '100%', backgroundColour: '#183035' });

exit.disabled = true;
cross.addEventListener('click', () => {
  rooms.explorer.transform.position.x = 440;
  cameraTarget = 360;
  cross.disabled = true;
  exit.disabled = false;
  status.textContent = 'Amber Vault';
});
exit.addEventListener('click', () => {
  exit.disabled = true;
  game.transitionTo(new BeyondTheRuins(), { type: 'fade', duration: 0.5 });
});
