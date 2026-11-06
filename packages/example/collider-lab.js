import {
  BoundsComponent, Circle, ColliderComponent, Engine, GameObject, Physics, PhysicsComponent,
  RenderComponent, Text, Vector2,
} from 'dino-ge';

const emitter = new Vector2(22, 102);
const target = new Vector2(258, 102);
const height = document.getElementById('ray-height');
const includeSensors = document.getElementById('ray-sensors');
const launch = document.getElementById('launch-probe');
const rayResult = document.getElementById('ray-result');
const probeResult = document.getElementById('probe-result');
const structures = [];
let probe;
let hits = [];

function placeCollider(tag, x, y, fixtures, sensor = false) {
  const object = new class extends GameObject {}(tag);
  object.transform.position.set(x, y);
  object.addComponent(new ColliderComponent(fixtures));
  if (sensor) {
    const physics = new PhysicsComponent();
    physics.isStatic = true;
    physics.isSensor = true;
    object.addComponent(physics);
  }
  object.registerSelf();
  structures.push(object);
  return object;
}

function traceFixtures(ctx, object) {
  const { x, y } = object.transform.position;
  ctx.save();
  ctx.translate(x, y);
  const sensor = object.getComponent(PhysicsComponent)?.isSensor;
  ctx.strokeStyle = sensor ? '#e7b669' : '#87dfb4';
  ctx.setLineDash(sensor ? [4, 3] : []);
  ctx.lineWidth = 2;
  for (const fixture of object.getComponent(ColliderComponent).fixtures) {
    ctx.beginPath();
    switch (fixture.kind) {
      case 'circle':
        ctx.arc(fixture.x, fixture.y, fixture.radius, 0, Math.PI * 2);
        break;
      case 'rectangle':
        ctx.rect(fixture.x, fixture.y, fixture.width, fixture.height);
        break;
      case 'polygon':
        ctx.moveTo(fixture.vertices[0].x, fixture.vertices[0].y);
        for (const vertex of fixture.vertices.slice(1)) ctx.lineTo(vertex.x, vertex.y);
        ctx.closePath();
        break;
    }
    ctx.stroke();
  }
  ctx.restore();
}

class Diagram extends RenderComponent {
  draw(ctx) {
    for (const object of structures) traceFixtures(ctx, object);
    ctx.save();
    ctx.strokeStyle = '#b0bad8';
    ctx.beginPath();
    ctx.moveTo(emitter.x, emitter.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();

    ctx.strokeStyle = '#ffcc80';
    ctx.fillStyle = '#ffcc80';
    for (const { point, normal } of hits) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.x + normal.x * 12, point.y + normal.y * 12);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function cast() {
  target.y = Number(height.value);
  hits = Physics.raycastAll(emitter, target, { includeSensors: includeSensors.checked, ignore: probe });
  const nearest = hits[0];
  rayResult.textContent = nearest
    ? `Ray hits ${nearest.object.metadata.tag} first. ${hits.length} fixture hits.`
    : 'Ray misses every fixture.';
}

new Engine({
  onLoad() {
    const canvas = document.querySelector('#collider-lab canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'A ray and probe crossing outlined collision fixtures');
    placeCollider('the sensor', 78, 102, [{ kind: 'circle', radius: 16 }], true);
    const wall = placeCollider('the relay', 135, 80, [
      { kind: 'polygon', vertices: [{ x: 0, y: 12 }, { x: 26, y: 0 }, { x: 53, y: 20 }, { x: 48, y: 44 }, { x: 8, y: 44 }] },
      { kind: 'rectangle', x: 52, y: 16, width: 26, height: 12 },
    ]);
    new Text({ text: 'Relay', position: new Vector2(145, 62), colour: '#e3e9e6' });

    const diagram = new class extends GameObject {}('Ray diagram', 3);
    diagram.addComponent(new BoundsComponent(280, 186));
    diagram.addComponent(new Diagram());
    diagram.registerSelf();

    height.addEventListener('input', cast);
    includeSensors.addEventListener('change', cast);
    launch.addEventListener('click', () => {
      probe?.destroySelf();
      const radius = 5;
      probe = new Circle({
        position: new Vector2(emitter.x - radius, emitter.y - radius),
        radius, colour: '#f4eead', zIndex: 2,
        physics: { velocity: new Vector2(140, 0), restitution: 0 },
      });
      probe.addComponent(new ColliderComponent([{ kind: 'circle', x: radius, y: radius, radius }]));
      probe.on('collisionStart', event => {
        probeResult.textContent = event.detail.other === wall ? 'Probe reached the relay.' : 'Probe crossed the sensor.';
      });
      probeResult.textContent = 'Probe launched.';
    });
    cast();
    launch.disabled = false;
  },
}, { title: 'Collider lab | Dino GE', containerId: 'collider-lab', backgroundColour: '#16272c' });
