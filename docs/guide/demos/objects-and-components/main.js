import { Circle, Component, Engine, Group, Rectangle, System, Vector2, VisibilityComponent } from 'dino-ge';

class Marker extends Component {
  visible = true;
}

class MarkerSystem extends System {
  update(objects) {
    for (const object of objects) {
      const marker = object.getComponent(Marker);
      if (marker) object.getComponent(VisibilityComponent).visible = marker.visible;
    }
  }
}

const markers = new MarkerSystem();
const status = document.querySelector('#status');

new Engine({
  onLoad() {
    const sign = new Group('sign');
    sign.transform.position.set(32, 70);
    const board = new Rectangle({ position: new Vector2(0, 0), width: 84, height: 40, colour: '#578281' });
    const pin = new Circle({ position: new Vector2(35, -22), radius: 8, colour: '#ffc46f', zIndex: 1 });
    sign.transform.addChild(board.transform);
    sign.transform.addChild(pin.transform);
    const marker = new Marker();
    pin.addComponent(marker);

    sign.on('toggle-marker', () => {
      marker.visible = !marker.visible;
      status.textContent = marker.visible ? 'Marker visible' : 'Marker hidden';
    });
    document.querySelector('#toggle').addEventListener('click', () => sign.emit('toggle-marker'));
    document.querySelector('#move').addEventListener('click', () => {
      sign.transform.position.x = sign.transform.position.x === 32 ? 122 : 32;
      status.textContent = `Sign world x: ${sign.transform.position.x}`;
    });
  },
  update() {
    markers.update(Engine.objects);
  },
}, { containerId: 'game', width: '100%', height: '100%', backgroundColour: '#183035' });
