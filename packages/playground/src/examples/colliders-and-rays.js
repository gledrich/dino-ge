import { Circle, ColliderComponent, Engine, Physics, PhysicsComponent, Rectangle, Vector2 } from 'dino-ge';

let probe;
let contact = 'Ready to launch';
let rayLabel = '';

function launch() {
  probe.transform.position.set(28, 126);
  probe.getComponent(PhysicsComponent).velocity.set(170, 0);
  contact = 'Probe launched';
}

new Engine({
  onLoad() {
    const gate = new Rectangle({
      tag: 'Compound gate',
      position: new Vector2(220, 105),
      width: 34,
      height: 70,
      colour: '#5f96c2',
      physics: { isStatic: true, collisionCategory: 2, collisionMask: 1 },
    });
    gate.addComponent(new ColliderComponent([
      { kind: 'rectangle', width: 22, height: 70 },
      { kind: 'polygon', vertices: [{ x: 22, y: 12 }, { x: 34, y: 35 }, { x: 22, y: 58 }] },
    ]));
    probe = new Circle({
      tag: 'Probe',
      position: new Vector2(28, 126),
      radius: 9,
      colour: '#f6bb64',
      physics: { restitution: 0, collisionCategory: 1, collisionMask: 2 },
    });
    probe.on('collisionStart', event => { contact = 'Contact started with ' + event.detail.other.metadata.tag; });
    probe.on('collisionEnd', event => { contact = 'Contact ended with ' + event.detail.other.metadata.tag; });
    const hit = Physics.raycast(new Vector2(30, 135), new Vector2(300, 135), { mask: 2 });
    rayLabel = hit ? 'Ray hit ' + hit.object.metadata.tag + ' at x=' + hit.point.x.toFixed(0) : 'Ray missed';
  },
  drawUI(ui) {
    ui.button({ id: 'launch', x: 12, y: 12, width: 135, height: 34, text: 'Launch probe', onPress: launch });
    ui.label({ x: 12, y: 60, text: rayLabel });
    ui.label({ x: 12, y: 82, text: contact });
  },
}, { containerId: 'playground-canvas-container', backgroundColour: '#162b32' });
