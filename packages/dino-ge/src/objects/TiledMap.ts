import { normaliseColliderFixture, type ColliderFixture } from '../components/ColliderComponent.js';
import type Tilemap from './Tilemap.js';
import type { TilemapProps } from './Tilemap.js';
import ResourceLoader from '../core/Loader.js';
import Vector2 from '../math/Vector2.js';

/** A Tiled custom property. File values and object references retain their authored values. */
export type TiledProperty = { name: string; propertyType?: string } & (
  | { type: 'string' | 'file' | 'color'; value: string }
  | { type: 'int' | 'float' | 'object'; value: number }
  | { type: 'bool'; value: boolean }
  | { type: 'class'; value: Readonly<Record<string, unknown>> }
);

/** Identifies the atlas image relative to its map or external descriptor. */
export interface TiledTilesetReference {
  firstGid: number;
  name: string;
  image: string;
  source?: string;
}

export interface TiledTileset extends TiledTilesetReference {
  columns: number;
  tileCount: number;
  properties: readonly TiledProperty[];
  /** Metadata indexed by zero-based atlas ID, as stored in Tilemap.data. */
  tileProperties: ReadonlyMap<number, readonly TiledProperty[]>;
  /** Authored shapes in tile-local pixels, available when readTileCollision is enabled. */
  tileCollision?: ReadonlyMap<number, readonly ColliderFixture[]>;
}

interface TiledLayerBase {
  id: number;
  name: string;
  visible: boolean;
  opacity: number;
  properties: readonly TiledProperty[];
  /** Map origin plus the authored layer offset, in world pixels. */
  position: Vector2;
}

export interface TiledTileLayer extends TiledLayerBase {
  type: 'tilelayer';
  tilemaps: readonly { tileset: TiledTileset; tilemap: Tilemap }[];
}

export interface TiledObjectLayer extends TiledLayerBase {
  type: 'objectgroup';
  objects: readonly TiledObject[];
}

/** Map metadata for a point or an axis-aligned rectangle, positioned in world pixels. */
export type TiledObject = {
  id: number;
  name: string;
  className: string;
  position: Vector2;
  visible: boolean;
  properties: readonly TiledProperty[];
} & (
  | { shape: 'point' }
  | { shape: 'rectangle'; width: number; height: number }
);

export type TiledLayer = TiledTileLayer | TiledObjectLayer;

export interface TiledMap {
  width: number;
  height: number;
  tileSize: number;
  layers: readonly TiledLayer[];
  tilesets: readonly TiledTileset[];
  properties: readonly TiledProperty[];
}

export interface TiledImportOptions {
  position: Vector2;
  /** Base draw order. Each successive layer uses the next z-index. */
  zIndex?: number;
  imageSmoothing?: boolean;
  /** Parse and validate collision shapes authored in each tileset's tile definitions. */
  readTileCollision?: boolean;
  /** Return a parsed external JSON tileset for the exact source string in the map. */
  resolveExternalTileset?: (source: string) => unknown;
  /** Return a loaded HTMLImageElement large enough for the atlas, or its ResourceLoader tag. */
  resolveImage: (tileset: TiledTilesetReference) => HTMLImageElement | string;
}

type TilemapPlan = {
  tileset: TiledTileset;
  props: Omit<TilemapProps, 'tileset'>;
};
type LayerPlan = TiledObjectLayer | (TiledLayerBase & {
  type: 'tilelayer';
  tilemaps: TilemapPlan[];
});

const maxGid = 0x0fffffff;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);

const isPositiveInteger = (value: unknown): value is number =>
  isInteger(value) && value > 0;

function invalid(detail: string): never {
  throw new Error(`Tiled import: ${detail}.`);
}

function readProperties(value: unknown, context: string): TiledProperty[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) invalid(`invalid properties in ${context}`);
  const names = new Set<string>();
  return value.map((property: unknown): TiledProperty => {
    if (!isRecord(property) || typeof property.name !== 'string' || !property.name ||
        names.has(property.name) ||
        (property.propertytype !== undefined && typeof property.propertytype !== 'string')) {
      invalid(`invalid property in ${context}`);
    }
    names.add(property.name);
    const { name, type = 'string', value, propertytype: propertyType } = property;
    const base = propertyType === undefined ? { name } : { name, propertyType };
    switch (type) {
      case 'string':
      case 'file':
      case 'color':
        if (typeof value === 'string') return { ...base, type, value };
        break;
      case 'bool':
        if (typeof value === 'boolean') return { ...base, type, value };
        break;
      case 'int':
      case 'object':
        if (isInteger(value) && (type !== 'object' || value >= 0)) return { ...base, type, value };
        break;
      case 'float':
        if (isFiniteNumber(value)) return { ...base, type, value };
        break;
      case 'class':
        if (isRecord(value)) return { ...base, type, value };
        break;
    }
    return invalid(`invalid property "${name}" in ${context}`);
  });
}

function readTileCollision(value: unknown, context: string): readonly ColliderFixture[] {
  if (!isRecord(value) || (value.type !== undefined && value.type !== 'objectgroup') ||
      !Array.isArray(value.objects)) invalid(`invalid collision object group in ${context}`);
  const { offsetx = 0, offsety = 0 } = value;
  if (!isFiniteNumber(offsetx) || !isFiniteNumber(offsety)) invalid(`invalid collision offset in ${context}`);

  return Object.freeze(Array.from(value.objects, (object: unknown, index): ColliderFixture => {
    if (!isRecord(object)) return invalid(`invalid collision object at index ${index} in ${context}`);
    const objectContext = `${context}, collision object ${isPositiveInteger(object.id) ? object.id : index + 1}`;
    const { x = 0, y = 0, rotation = 0, ellipse = false, polygon, width, height } = object;
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(rotation) || typeof ellipse !== 'boolean') {
      return invalid(`invalid geometry in ${objectContext}`);
    }
    if (object.point || object.capsule || object.polyline !== undefined || object.text !== undefined ||
        object.template !== undefined || object.gid !== undefined || (ellipse && polygon !== undefined)) {
      return invalid(`unsupported shape in ${objectContext}`);
    }

    const radians = (rotation % 360) * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const point = (px: number, py: number) => ({
      x: x + offsetx + px * cos - py * sin,
      y: y + offsety + px * sin + py * cos,
    });

    let fixture: ColliderFixture;
    if (polygon !== undefined) {
      if (!Array.isArray(polygon)) return invalid(`invalid polygon in ${objectContext}`);
      const vertices = Array.from(polygon, (vertex: unknown) => {
        if (!isRecord(vertex) || !isFiniteNumber(vertex.x) || !isFiniteNumber(vertex.y)) {
          return invalid(`invalid polygon vertex in ${objectContext}`);
        }
        return point(vertex.x, vertex.y);
      });
      fixture = { kind: 'polygon', vertices };
    } else {
      if (!isFiniteNumber(width) || !isFiniteNumber(height) || width <= 0 || height <= 0) {
        return invalid(`invalid dimensions in ${objectContext}`);
      }
      if (ellipse) {
        if (width !== height) return invalid(`non-circular ellipse in ${objectContext}`);
        fixture = { kind: 'circle', ...point(width / 2, height / 2), radius: width / 2 };
      } else if (radians === 0) {
        fixture = { kind: 'rectangle', ...point(0, 0), width, height };
      } else {
        fixture = { kind: 'polygon', vertices: [point(0, 0), point(width, 0), point(width, height), point(0, height)] };
      }
    }
    try {
      return normaliseColliderFixture(fixture);
    } catch (error) {
      return invalid(`invalid shape in ${objectContext}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }));
}

function readTileset(entry: unknown, tileSize: number, options: TiledImportOptions): TiledTileset {
  if (!isRecord(entry) || !isPositiveInteger(entry.firstgid) || entry.firstgid > maxGid) {
    invalid('invalid tileset firstgid');
  }
  const { firstgid: firstGid, source } = entry;
  if (source !== undefined && (typeof source !== 'string' || !source)) invalid('invalid tileset source');
  const descriptor = source === undefined ? entry : options.resolveExternalTileset?.(source);
  if (!isRecord(descriptor) || (descriptor.type !== undefined && descriptor.type !== 'tileset') ||
      typeof descriptor.image !== 'string' || !descriptor.image ||
      !isPositiveInteger(descriptor.columns) || !isPositiveInteger(descriptor.tilecount) ||
      descriptor.tilecount > maxGid - firstGid + 1 ||
      descriptor.tilewidth !== tileSize || descriptor.tileheight !== tileSize ||
      (descriptor.spacing ?? 0) !== 0 || (descriptor.margin ?? 0) !== 0) {
    invalid(`expected an atlas with matching tiles and no spacing or margin for tileset ${source ?? firstGid}`);
  }
  if (descriptor.tileoffset !== undefined &&
      (!isRecord(descriptor.tileoffset) || descriptor.tileoffset.x !== 0 || descriptor.tileoffset.y !== 0)) {
    invalid(`unsupported tile offset for tileset ${source ?? firstGid}`);
  }
  const { name = '', image, columns, tilecount: tileCount, tiles = [] } = descriptor;
  if (typeof name !== 'string' || !Array.isArray(tiles)) invalid(`invalid tileset ${source ?? firstGid}`);
  const context = `tileset ${source ?? firstGid}`;
  const tileProperties = new Map<number, readonly TiledProperty[]>();
  const tileCollision = options.readTileCollision ? new Map<number, readonly ColliderFixture[]>() : undefined;
  for (const tile of tiles) {
    if (!isRecord(tile) || !isInteger(tile.id) || tile.id < 0 ||
        tile.id >= tileCount || tileProperties.has(tile.id)) {
      invalid(`invalid local tile ID in ${context}`);
    }
    const tileContext = `${context}, tile ${tile.id}`;
    tileProperties.set(tile.id, readProperties(tile.properties, tileContext));
    if (tileCollision && tile.objectgroup !== undefined) {
      const fixtures = readTileCollision(tile.objectgroup, tileContext);
      if (fixtures.length) tileCollision.set(tile.id, fixtures);
    }
  }
  const reference = source === undefined ? { firstGid, name, image } : { firstGid, name, image, source };
  return { ...reference, columns, tileCount, tileProperties, ...(tileCollision && { tileCollision }), properties: readProperties(descriptor.properties, context) };
}

function readLayerBase(layer: Record<string, unknown>, position: Vector2): TiledLayerBase {
  const { id, name, visible = true, opacity = 1, offsetx = 0, offsety = 0 } = layer;
  if (!isPositiveInteger(id) || typeof name !== 'string' || typeof visible !== 'boolean' ||
      !isFiniteNumber(opacity) || opacity < 0 || opacity > 1 ||
      !isFiniteNumber(offsetx) || !isFiniteNumber(offsety) ||
      (layer.x ?? 0) !== 0 || (layer.y ?? 0) !== 0) {
    invalid(`invalid layer metadata for layer ${String(name)}`);
  }
  if ((layer.parallaxx ?? 1) !== 1 || (layer.parallaxy ?? 1) !== 1 ||
      layer.tintcolor !== undefined || (layer.mode ?? 'normal') !== 'normal') {
    invalid(`unsupported rendering settings in layer "${name}"`);
  }
  return {
    id, name, visible, opacity, position: new Vector2(position.x + offsetx, position.y + offsety),
    properties: readProperties(layer.properties, `layer "${name}"`),
  };
}

function readObjects(layer: TiledLayerBase, value: unknown, objectIds: Set<number>): TiledObject[] {
  if (!Array.isArray(value)) invalid(`expected objects in layer "${layer.name}"`);
  return value.map((object: unknown): TiledObject => {
    if (!isRecord(object)) invalid(`invalid object in layer "${layer.name}"`);
    const { id, name = '', type = '', class: legacyClass = '', visible = true, x, y,
      width = 0, height = 0, point = false, rotation = 0 } = object;
    if (!isPositiveInteger(id) || objectIds.has(id) || typeof name !== 'string' ||
        typeof type !== 'string' || typeof legacyClass !== 'string' || typeof visible !== 'boolean' ||
        !isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || width < 0 ||
        !isFiniteNumber(height) || height < 0 || typeof point !== 'boolean') {
      invalid(`invalid object in layer "${layer.name}"`);
    }
    if (rotation !== 0 || object.gid !== undefined || object.template !== undefined ||
        object.text !== undefined || object.ellipse || object.capsule || object.polyline || object.polygon) {
      invalid(`expected a point or axis-aligned rectangle for object ${id} in layer "${layer.name}"`);
    }
    objectIds.add(id);
    const base = {
      id, name, className: type || legacyClass, visible,
      position: new Vector2(layer.position.x + x, layer.position.y + y),
      properties: readProperties(object.properties, `object ${id} in layer "${layer.name}"`),
    };
    return point ? { ...base, shape: 'point' } : { ...base, shape: 'rectangle', width, height };
  });
}

function readTilemaps(
  layer: Record<string, unknown>,
  base: TiledLayerBase,
  { width, height, tileSize, tilesets }: Omit<TiledMap, 'layers'>,
  zIndex: number,
  imageSmoothing?: boolean,
): TilemapPlan[] {
  const { data } = layer;
  if (layer.width !== width || layer.height !== height ||
      (layer.encoding != null && layer.encoding !== 'csv') ||
      (layer.compression != null && layer.compression !== '') ||
      !Array.isArray(data) || data.length !== width * height) {
    invalid(`expected an uncompressed numeric full-map tile layer for "${base.name}"`);
  }

  const grids = new Map<TiledTileset, number[][]>();
  for (let index = 0; index < data.length; index++) {
    const gid: unknown = data[index];
    if (gid === 0) continue;
    const row = Math.floor(index / width);
    const column = index % width;
    const tileset = isPositiveInteger(gid) && gid <= maxGid
      ? tilesets.find(({ firstGid, tileCount }) => gid >= firstGid && gid - firstGid < tileCount)
      : undefined;
    if (tileset === undefined || typeof gid !== 'number') {
      invalid(`unsupported tile ID at column ${column}, row ${row} in layer "${base.name}"`);
    }
    let grid = grids.get(tileset);
    if (!grid) {
      grid = Array.from({ length: height }, () => Array<number>(width).fill(-1));
      grids.set(tileset, grid);
    }
    grid[row][column] = gid - tileset.firstGid;
  }
  const plans: TilemapPlan[] = [];
  for (const tileset of tilesets) {
    const grid = grids.get(tileset);
    if (!grid) continue;
    plans.push({
      tileset,
      props: {
        tag: grids.size === 1 ? base.name : `${base.name} (${tileset.name || tileset.firstGid})`,
        position: new Vector2(base.position.x, base.position.y),
        data: grid, tileSize, tilesetCols: tileset.columns, zIndex, imageSmoothing,
        opacity: base.opacity === 1 ? undefined : base.opacity, visible: base.visible,
      },
    });
  }
  return plans;
}

/** @internal */
export function importTiledMap(
  map: unknown,
  options: TiledImportOptions,
  createTilemap: (props: TilemapProps) => Tilemap,
): TiledMap {
  if (!isRecord(map) || map.orientation !== 'orthogonal' || map.infinite !== false ||
      !isPositiveInteger(map.width) || !isPositiveInteger(map.height) ||
      !Number.isSafeInteger(map.width * map.height) ||
      !isPositiveInteger(map.tilewidth) || map.tilewidth !== map.tileheight ||
      !Array.isArray(map.layers) || !Array.isArray(map.tilesets)) {
    invalid('expected a finite orthogonal map with square tiles and positive dimensions');
  }

  const { width, height, tilewidth: tileSize } = map;
  const tilesets = map.tilesets.map(entry => readTileset(entry, tileSize, options))
    .sort((a, b) => a.firstGid - b.firstGid);
  for (let i = 1; i < tilesets.length; i++) {
    if (tilesets[i - 1].firstGid + tilesets[i - 1].tileCount > tilesets[i].firstGid) {
      invalid('overlapping tileset GID ranges');
    }
  }
  const header = { width, height, tileSize, tilesets, properties: readProperties(map.properties, 'map') };
  const objectIds = new Set<number>();
  const layerIds = new Set<number>();
  const plans = map.layers.map((layer: unknown, index): LayerPlan => {
    if (!isRecord(layer)) invalid('invalid layer');
    const base = readLayerBase(layer, options.position);
    if (layerIds.has(base.id)) invalid(`duplicate layer ID ${base.id}`);
    layerIds.add(base.id);
    if (layer.type === 'objectgroup') {
      return { ...base, type: 'objectgroup', objects: readObjects(base, layer.objects, objectIds) };
    }
    if (layer.type === 'tilelayer') {
      const zIndex = (options.zIndex ?? 0) + index;
      return { ...base, type: 'tilelayer', tilemaps: readTilemaps(layer, base, header, zIndex, options.imageSmoothing) };
    }
    return invalid(`unsupported layer type in "${base.name}"`);
  });

  const images = new Map<TiledTileset, HTMLImageElement>();
  for (const layer of plans) {
    if (layer.type !== 'tilelayer') continue;
    for (const { tileset } of layer.tilemaps) {
      if (images.has(tileset)) continue;
      const resolved = options.resolveImage(tileset);
      const image = typeof resolved === 'string' ? ResourceLoader.getImage(resolved) : resolved;
      const columns = Math.min(tileset.columns, tileset.tileCount);
      const rows = Math.ceil(tileset.tileCount / tileset.columns);
      if (image?.tagName !== 'IMG' || !isPositiveInteger(image.naturalWidth) ||
          !isPositiveInteger(image.naturalHeight) ||
          image.naturalWidth < columns * tileSize || image.naturalHeight < rows * tileSize) {
        invalid(`expected a loaded atlas image with enough space for tileset ${tileset.source ?? tileset.name}`);
      }
      images.set(tileset, image);
    }
  }
  const layers = plans.map((layer): TiledLayer => {
    if (layer.type === 'objectgroup') return layer;
    return {
      ...layer,
      tilemaps: layer.tilemaps.map(({ tileset, props }) => ({
        tileset,
        tilemap: createTilemap({ ...props, tileset: images.get(tileset)! }),
      })),
    };
  });
  return { ...header, layers };
}
