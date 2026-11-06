import { ColliderComponent, createTiledColliders, Physics, Rectangle } from '../index.js';
import Tilemap from './Tilemap.js';
import Vector2 from '../math/Vector2.js';
import Registry from '../core/Registry.js';
import VisibilityComponent from '../components/VisibilityComponent.js';

const atlas = { type: 'tileset', image: 'atlas.png', columns: 2, tilecount: 4, tilewidth: 16, tileheight: 16 };
const ground = { id: 1, name: 'Ground', type: 'tilelayer', width: 2, height: 1, data: [2, 11] };
const objects = { id: 2, name: 'Markers', type: 'objectgroup', offsetx: 4, objects: [
  { id: 1, name: 'Entry', type: 'Spawn', point: true, x: 8, y: 8 },
  { id: 2, name: 'Gate', class: 'Trigger', x: 16, y: 0, width: 16, height: 16 },
] };
const roof = { ...ground, id: 3, name: 'Roof', data: [0, 1], visible: false, offsety: 3, opacity: 0.6 };
const map = {
  orientation: 'orthogonal', infinite: false, width: 2, height: 1, tilewidth: 16, tileheight: 16,
  layers: [ground, objects, roof],
  tilesets: [{ ...atlas, firstgid: 1 }, { source: 'tiles/forest.tsj', firstgid: 10 }],
};
function atlasImage(width = 32, height = 32): HTMLImageElement {
  const image = document.createElement('img');
  Object.defineProperties(image, {
    naturalWidth: { value: width },
    naturalHeight: { value: height },
  });
  return image;
}

const firstImage = atlasImage();
const secondImage = atlasImage();
const resolveExternalTileset = jest.fn(() => ({
  ...atlas, image: '../forest.png', tiles: [{ id: 1, properties: [{ name: 'solid', type: 'bool', value: true }] }],
}));
const options = {
  position: new Vector2(10, 20), zIndex: 5, resolveExternalTileset,
  resolveImage: (reference: { firstGid: number }) => reference.firstGid === 1 ? firstImage : secondImage,
};

describe('Tilemap.importTiled', () => {
  it('imports mixed atlases in map layer order and preserves atlas-local metadata', () => {
    const result = Tilemap.importTiled(map, options);
    expect(result).toMatchObject({ width: 2, height: 1, tileSize: 16 });
    expect(result.layers.map(layer => layer.name)).toEqual(['Ground', 'Markers', 'Roof']);
    const [groundLayer, , roofLayer] = result.layers;
    if (groundLayer.type !== 'tilelayer' || roofLayer.type !== 'tilelayer') throw new Error('Expected tile layers');
    expect(resolveExternalTileset).toHaveBeenCalledWith('tiles/forest.tsj');
    expect(groundLayer.tilemaps.map(entry => entry.tilemap.data)).toEqual([[[1, -1]], [[-1, 1]]]);
    expect(groundLayer.tilemaps.map(entry => entry.tilemap.tileset)).toEqual([firstImage, secondImage]);
    expect(groundLayer.tilemaps[1].tileset.tileProperties.get(1)).toEqual([{ name: 'solid', type: 'bool', value: true }]);
    expect(roofLayer.tilemaps).toHaveLength(1);
    expect(roofLayer.opacity).toBe(0.6);
    const roofMap = roofLayer.tilemaps[0].tilemap;
    expect(roofMap.transform.position).toMatchObject({ x: 10, y: 23 });
    expect(roofMap.getComponent(VisibilityComponent)?.opacity).toBe(0.6);
    expect(roofMap.metadata.zIndex).toBeGreaterThan(groundLayer.tilemaps[0].tilemap.metadata.zIndex);
    expect(roofMap.getComponent(VisibilityComponent)?.visible).toBe(false);
  });

  it('imports typed points and rectangles with object-layer offsets in world coordinates', () => {
    const layer = Tilemap.importTiled(map, options).layers[1];
    if (layer.type !== 'objectgroup') throw new Error('Expected an object layer');
    expect(layer.objects).toEqual([
      expect.objectContaining({ shape: 'point', name: 'Entry', className: 'Spawn', position: new Vector2(22, 28) }),
      expect.objectContaining({ shape: 'rectangle', name: 'Gate', className: 'Trigger', position: new Vector2(30, 20), width: 16, height: 16 }),
    ]);
  });

  it('accepts numeric CSV layers with an empty compression field', () => {
    const result = Tilemap.importTiled({
      ...map, layers: [{ ...ground, encoding: 'csv', compression: '' }],
    }, options);
    const layer = result.layers[0];
    if (layer.type !== 'tilelayer') throw new Error('Expected a tile layer');
    expect(layer.tilemaps[1].tilemap.data).toEqual([[-1, 1]]);
  });

  it('requires a parsed descriptor for each external tileset', () => {
    expect(() => Tilemap.importTiled(map, { ...options, resolveExternalTileset: undefined }))
      .toThrow(/tiles\/forest\.tsj/);
  });

  it.each([
    { ...map, layers: [ground, { ...roof, data: [0, 7] }] },
    { ...map, layers: [ground, { ...roof, data: [0, 0x80000001] }] },
    { ...map, tilesets: [map.tilesets[0], { ...map.tilesets[1], firstgid: 3 }] },
    { ...map, layers: [ground, { ...objects, objects: [{ ...objects.objects[1], rotation: 20 }] }] },
  ])('validates the whole map before registering any tilemaps', invalid => {
    const register = jest.spyOn(Registry, 'registerObject');
    try {
      expect(() => Tilemap.importTiled(invalid, options)).toThrow(/^Tiled/);
      expect(register).not.toHaveBeenCalled();
    } finally {
      register.mockRestore();
    }
  });

  it.each([
    document.createElement('canvas') as unknown as HTMLImageElement,
    atlasImage(32, 16),
    atlasImage(0, 0),
  ])('rejects an invalid atlas image before registering any tilemaps', image => {
    const register = jest.spyOn(Registry, 'registerObject');
    try {
      expect(() => Tilemap.importTiled(map, {
        ...options,
        resolveImage: tileset => tileset.firstGid === 1 ? firstImage : image,
      })).toThrow(/atlas image/);
      expect(register).not.toHaveBeenCalled();
    } finally {
      register.mockRestore();
    }
  });

  it('resolves all images before registering any tilemaps', () => {
    const register = jest.spyOn(Registry, 'registerObject');
    try {
      expect(() => Tilemap.importTiled(map, {
        ...options,
        resolveImage: tileset => tileset.firstGid === 1 ? firstImage : 'missing',
      })).toThrow(/missing/);
      expect(register).not.toHaveBeenCalled();
    } finally {
      register.mockRestore();
    }
  });
});


describe('authored Tiled tile collisions', () => {
  const mapWithCollision = {
    ...map,
    layers: [{ ...ground, offsetx: 4, offsety: -2 }],
    tilesets: [
      { ...atlas, firstgid: 1, tiles: [{ id: 1, objectgroup: { objects: [
        { id: 1, x: 2, y: 3, width: 8, height: 4 },
      ] } }] },
      map.tilesets[1],
    ],
  };
  const collisionOptions = {
    ...options,
    readTileCollision: true,
    resolveExternalTileset: () => ({
      ...atlas,
      tiles: [{ id: 1, objectgroup: { offsetx: 1, offsety: -1, objects: [
        { id: 1, x: 3, y: 4, width: 6, height: 6, ellipse: true },
        { id: 2, x: 1, y: 2, polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 4 }] },
        { id: 3, x: 8, y: 8, width: 4, height: 2, rotation: 90 },
      ] } }],
    }),
  };

  it('normalises each tileset’s shapes in tile-local coordinates', () => {
    const [embedded, external] = Tilemap.importTiled(mapWithCollision, collisionOptions).tilesets;
    expect(embedded.tileCollision?.get(1)).toEqual([{ kind: 'rectangle', x: 2, y: 3, width: 8, height: 4 }]);
    expect(external.tileCollision?.get(1)).toEqual([
      { kind: 'circle', x: 7, y: 6, radius: 3 },
      { kind: 'polygon', vertices: [{ x: 2, y: 1 }, { x: 6, y: 1 }, { x: 2, y: 5 }] },
      { kind: 'polygon', vertices: [{ x: 9, y: 7 }, { x: 9, y: 11 }, { x: 7, y: 11 }, { x: 7, y: 7 }] },
    ]);
  });

  it('leaves unsupported collision data untouched unless opted in', () => {
    const invalid = { ...mapWithCollision, tilesets: [
      { ...atlas, firstgid: 1, tiles: [{ id: 1, objectgroup: { objects: [
        { id: 7, ellipse: true, x: 0, y: 0, width: 5, height: 3 },
      ] } }] },
      map.tilesets[1],
    ] };
    expect(Tilemap.importTiled(invalid, options).tilesets[0].tileCollision).toBeUndefined();

    const register = jest.spyOn(Registry, 'registerObject');
    try {
      expect(() => Tilemap.importTiled(invalid, collisionOptions)).toThrow(/^Tiled.*tileset 1.*tile 1.*object 7/i);
      expect(register).not.toHaveBeenCalled();
    } finally {
      register.mockRestore();
    }
  });

  it('constructs detached static bodies using current cells and tilemap world transforms', () => {
    const [layer] = Tilemap.importTiled(mapWithCollision, collisionOptions).layers;
    if (layer.type !== 'tilelayer') throw new Error('Expected a tile layer');
    const external = layer.tilemaps[1].tilemap;
    external.transform.scale.set(2, 3);
    external.transform.rotation = Math.PI / 2;

    const register = jest.spyOn(Registry, 'registerObject');
    try {
      const [first, second] = createTiledColliders(layer);
      expect(register).not.toHaveBeenCalled();
      expect(first.transform.position).toMatchObject({ x: 14, y: 18 });
      expect(second.transform.position.x).toBeCloseTo(14);
      expect(second.transform.position.y).toBeCloseTo(50);
      expect(second.transform.rotation).toBe(Math.PI / 2);
      expect(second.transform.scale).toMatchObject({ x: 2, y: 3 });
      expect(second.getComponent(ColliderComponent)?.fixtures).toHaveLength(3);

      external.data[0][1] = -1;
      expect(createTiledColliders(layer)).toHaveLength(1);
    } finally {
      register.mockRestore();
    }

    const [collider] = createTiledColliders(layer);
    const actor = new Rectangle({
      position: new Vector2(14, 22), width: 3, height: 2, physics: {},
    });
    expect(Physics.checkCollision(actor, collider)).toBe(true);
    expect(actor.transform.position.x).toBeLessThan(14);
    expect(collider.transform.position).toMatchObject({ x: 14, y: 18 });
  });
});
