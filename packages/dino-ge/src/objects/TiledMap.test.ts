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
