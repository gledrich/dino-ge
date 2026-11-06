import { Circle, Engine, Loader, PhysicsComponent, Sound, Tilemap, Vector2, createTiledColliders } from 'dino-ge';

const asset = path => new URL(path, import.meta.url).href;
let probe;
let origin;
let status = 'Loading map and images…';
let chime;

async function launch() {
  probe.transform.position.set(origin.x - 5, origin.y - 21);
  probe.getComponent(PhysicsComponent).velocity.set(135, 0);
  status = 'Probe launched';
  if (chime && await Sound.unlock()) chime.play();
}

new Engine({
  async onLoad() {
    Loader.queueJson('map', asset('./relay-room.tmj'));
    Loader.queueJson('relay', asset('./tiles/relay.tsj'));
    Loader.queueImage('floor.svg', asset('./floor.svg'));
    Loader.queueImage('../relay.svg', asset('./relay.svg'));
    await Loader.loadAll(progress => { status = 'Loading assets… ' + Math.round(progress) + '%'; });
    const level = Tilemap.importTiled(Loader.getJson('map'), {
      position: new Vector2(12, 100),
      resolveImage: tileset => Loader.getImage(tileset.image),
      resolveExternalTileset: () => Loader.getJson('relay'),
      readTileCollision: true,
    });
    for (const layer of level.layers) {
      if (layer.type === 'tilelayer') {
        for (const body of createTiledColliders(layer)) body.registerSelf();
      } else {
        origin = layer.objects.find(object => object.name === 'Courier start').position;
      }
    }
    probe = new Circle({
      tag: 'Map probe',
      position: new Vector2(origin.x - 5, origin.y - 21),
      radius: 5,
      colour: '#f8eee0',
      zIndex: 3,
      physics: { restitution: 0 },
    });
    probe.on('collisionStart', () => { status = 'Hit the authored tile collider'; });
    status = 'Two tile layers and a launch marker loaded';
    // Sound is optional, so an audio failure does not block the map.
    Loader.queueSound('chime', asset('./pickup.wav'));
    await Loader.loadAll().then(() => { chime = Loader.getSound('chime'); }, () => {});
  },
  drawUI(ui) {
    if (probe) ui.button({ id: 'launch', x: 12, y: 12, width: 135, height: 34, text: 'Launch probe', onPress: launch });
    ui.label({ x: 12, y: 63, text: status });
  },
}, { containerId: 'playground-canvas-container', backgroundColour: '#162b32' });
