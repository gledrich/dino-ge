import { Circle, Engine, Loader, PhysicsComponent, Tilemap, Vector2, createTiledColliders } from 'dino-ge';

const mapUrl = new URL('./gameplay-foundations/relay-room.tmj', import.meta.url);
const housing = document.getElementById('housing');
const edge = document.getElementById('edge');
const status = document.querySelector('[role="status"]');
let probe;
let velocity;

function finish(message) {
  velocity.set(0, 0);
  status.textContent = message;
}

async function setup() {
  Loader.queueJson('relay-room', mapUrl.href);
  await Loader.loadAll();
  const map = Loader.getJson('relay-room');
  const external = map.tilesets.find(tileset => tileset.source);
  const descriptorUrl = new URL(external.source, mapUrl);
  Loader.queueJson('relay-tileset', descriptorUrl.href);
  await Loader.loadAll();
  const descriptor = Loader.getJson('relay-tileset');
  for (const tileset of map.tilesets) {
    const image = tileset.source
      ? new URL(descriptor.image, descriptorUrl)
      : new URL(tileset.image, mapUrl);
    Loader.queueImage(`atlas-${tileset.firstgid}`, image.href);
  }
  await Loader.loadAll();

  const room = Tilemap.importTiled(map, {
    position: new Vector2(0, 0),
    imageSmoothing: false,
    readTileCollision: true,
    resolveExternalTileset: source => source === external.source ? descriptor : undefined,
    resolveImage: ({ firstGid }) => `atlas-${firstGid}`,
  });
  const ground = room.layers.find(layer => layer.type === 'tilelayer' && layer.name === 'Ground');
  if (!ground) throw new Error('The relay room needs a Ground tile layer.');
  for (const body of createTiledColliders(ground)) body.registerSelf();

  const launch = (centreY) => {
    probe?.destroySelf();
    const radius = 4;
    probe = new Circle({
      position: new Vector2(42, centreY - radius),
      radius,
      colour: '#f6edab',
      zIndex: 2,
      physics: { velocity: new Vector2(155, 0), restitution: 0 },
    });
    velocity = probe.getComponent(PhysicsComponent).velocity;
    probe.on('collisionStart', () => finish('Probe hit the authored collider.'));
    status.textContent = 'Probe launched.';
  };

  housing.addEventListener('click', () => launch(48));
  edge.addEventListener('click', () => launch(35));
  housing.disabled = false;
  edge.disabled = false;
  status.textContent = 'Ready to launch.';
}

new Engine({
  onLoad: () => setup().catch(error => {
    status.textContent = 'Could not load the relay room.';
    console.error(error);
  }),
  fixedUpdate() {
    if (probe && velocity.x > 0 && probe.transform.position.x >= 270) {
      finish('Probe passed the relay.');
    }
  },
}, { title: 'Tiled tile collisions | Dino GE', containerId: 'room', backgroundColour: '#203438' });
