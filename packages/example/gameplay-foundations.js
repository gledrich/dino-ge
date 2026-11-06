import { Actions, Engine, Loader, Sprite, Tilemap, Vector2, VisibilityComponent } from 'dino-ge';

const mapUrl = new URL('./gameplay-foundations/relay-room.tmj', import.meta.url);
const explorerUrl = new URL('./amber-ruins/assets/explorer-walk.png', import.meta.url);
const replay = document.getElementById('replay-delivery');
const status = document.querySelector('[role="status"]');
const courierSize = 32;

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url.pathname} (HTTP ${response.status})`);
  return response.json();
}

async function loadRoom() {
  const map = await loadJson(mapUrl);
  const descriptors = new Map();
  for (const tileset of map.tilesets) {
    const descriptorUrl = tileset.source ? new URL(tileset.source, mapUrl) : mapUrl;
    const descriptor = tileset.source ? await loadJson(descriptorUrl) : tileset;
    if (tileset.source) descriptors.set(tileset.source, descriptor);
    Loader.queueImage(`atlas-${tileset.firstgid}`, new URL(descriptor.image, descriptorUrl).href);
  }
  Loader.queueImage('courier', explorerUrl.href);
  await Loader.loadAll();

  return Tilemap.importTiled(map, {
    position: new Vector2(0, 0),
    imageSmoothing: false,
    resolveExternalTileset: source => descriptors.get(source),
    resolveImage: ({ firstGid }) => `atlas-${firstGid}`,
  });
}

function topLeft(x, y) {
  return new Vector2(x - courierSize / 2, y - courierSize / 2);
}

async function setup() {
  const room = await loadRoom();
  const markers = room.layers
    .filter(layer => layer.type === 'objectgroup')
    .flatMap(layer => layer.objects);
  const spawn = markers.find(object => object.shape === 'point' && object.className === 'Spawn');
  const trigger = markers.find(object => object.shape === 'rectangle' && object.className === 'Trigger');
  const message = trigger?.properties.find(property => property.name === 'message' && property.type === 'string');
  if (!spawn || !trigger || !message) throw new Error('The room needs a spawn and a relay trigger with a message.');

  const start = topLeft(spawn.position.x, spawn.position.y);
  const destination = topLeft(
    trigger.position.x + trigger.width / 2,
    trigger.position.y + trigger.height / 2,
  );
  const courier = new Sprite({
    tag: 'Courier',
    img: 'courier',
    rows: 2,
    cols: 2,
    displaySize: { width: courierSize, height: courierSize },
    position: new Vector2(start.x, start.y),
    zIndex: 2,
    animations: {
      walk: { frames: [90, 130, 90, 130].map((durationMs, frame) => ({ frame, durationMs })) },
    },
  });

  courier.playAnimation('walk');
  courier.pauseAnimation();

  replay.addEventListener('click', () => {
    courier.actions.clear();
    courier.transform.position.set(start.x, start.y);
    courier.getComponent(VisibilityComponent).opacity = 1;
    courier.playAnimation('walk', { restart: true });
    status.textContent = 'Walking to the relay…';

    courier.actions.enqueue(
      Actions.moveTo(destination, 1.4),
      Actions.call(actor => {
        actor.pauseAnimation();
        status.textContent = 'Waiting at the relay…';
      }),
      Actions.wait(0.45),
      Actions.call(() => { status.textContent = 'Fading out…'; }),
      Actions.fadeTo(0, 0.6),
      Actions.call(() => { status.textContent = message.value; }),
    );
  });
  replay.disabled = false;
  status.textContent = 'Ready to deliver.';
}

new Engine({
  onLoad: () => {
    const canvas = document.querySelector('#delivery-room canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Courier route through a tile room to the relay');
    return setup().catch(error => {
      status.textContent = 'The delivery room could not load.';
      console.error(error);
    });
  },
}, { title: 'Gameplay foundations | Dino GE', containerId: 'delivery-room', backgroundColour: '#16272c' });
