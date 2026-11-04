import GameObject from '../core/GameObject.js';
import Vector2 from '../math/Vector2.js';
import ResourceLoader from '../core/Loader.js';
import TilemapComponent from '../components/TilemapComponent.js';

/**
 * Properties for creating a new Tilemap.
 */
export interface TilemapProps {
  /** Unique tag for the object. */
  tag?: string;
  /** Hidden identifier linking runtime object to its source code location. */
  __sourceId?: string;
  /** Image element or tag from ResourceLoader. */
  tileset: HTMLImageElement | string;
  /** 2D array of tile indices. */
  data: number[][];
  /** Tile size in pixels. */
  tileSize: number;
  /** Number of columns in the tileset image. */
  tilesetCols: number;
  /** Initial world position. */
  position: Vector2;
  /** Rendering order. */
  zIndex?: number;
}

const defaultProps = {
  tag: 'tilemap',
  zIndex: 0
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/**
 * Represents a grid-based map rendered from a tileset.
 */
export default class Tilemap extends GameObject {
  /** Creates a tilemap from a finite orthogonal Tiled JSON export. */
  static fromTiled(
    map: unknown,
    options: Omit<TilemapProps, 'data' | 'tileSize' | 'tilesetCols'>
  ): Tilemap {
    if (!isRecord(map) || map.orientation !== 'orthogonal' || map.infinite !== false ||
        !isPositiveInteger(map.width) || !isPositiveInteger(map.height) ||
        !isPositiveInteger(map.tilewidth) || map.tilewidth !== map.tileheight) {
      throw new Error('Tiled maps must be finite and orthogonal with square tiles and positive dimensions.');
    }

    const { width, height, tilewidth: tileSize, layers, tilesets } = map;
    const layer: unknown = Array.isArray(layers) && layers.length === 1 ? layers[0] : null;
    if (!isRecord(layer) || layer.type !== 'tilelayer' ||
        layer.width !== width || layer.height !== height ||
        (layer.x ?? 0) !== 0 || (layer.y ?? 0) !== 0 ||
        (layer.offsetx ?? 0) !== 0 || (layer.offsety ?? 0) !== 0 ||
        layer.encoding != null || layer.compression != null ||
        !Array.isArray(layer.data) || layer.data.length !== width * height) {
      throw new Error('Tiled maps must contain one unencoded tile layer covering the entire map.');
    }

    const tileset: unknown = Array.isArray(tilesets) && tilesets.length === 1 ? tilesets[0] : null;
    if (!isRecord(tileset) || tileset.source != null ||
        !isPositiveInteger(tileset.firstgid) || !isPositiveInteger(tileset.columns) ||
        !isPositiveInteger(tileset.tilecount) ||
        tileset.tilewidth !== tileSize || tileset.tileheight !== tileSize ||
        (tileset.spacing ?? 0) !== 0 || (tileset.margin ?? 0) !== 0) {
      throw new Error('Tiled maps must use one embedded tileset with matching tiles and no spacing or margin.');
    }

    const { firstgid, columns, tilecount } = tileset;
    const data: number[][] = [];
    for (let y = 0; y < height; y++) {
      const row: number[] = [];
      for (let x = 0; x < width; x++) {
        const gid: unknown = layer.data[y * width + x];
        if (gid === 0) {
          row.push(-1);
        } else if (isPositiveInteger(gid) && gid <= 0x0fffffff &&
                   gid >= firstgid && gid - firstgid < tilecount) {
          row.push(gid - firstgid);
        } else {
          throw new Error(`Unsupported Tiled tile ID at column ${x}, row ${y}.`);
        }
      }
      data.push(row);
    }

    return new Tilemap({ ...options, data, tileSize, tilesetCols: columns });
  }

  /** The source image for the tileset. */
  public tileset: HTMLImageElement;
  /** 2D array of tile indices. */
  public data: number[][];
  /** Tile size in pixels. */
  public tileSize: number;
  /** Number of columns in the tileset image. */
  public tilesetCols: number;

  /**
   * initialises a new instance of a Tilemap.
   * @param props Configuration properties for the tilemap.
   */
  constructor(props: TilemapProps) {
    super(props.tag || defaultProps.tag, props.zIndex || defaultProps.zIndex, props.__sourceId);

    if (typeof props.tileset === 'string') {
      this.tileset = ResourceLoader.getImage(props.tileset);
    } else {
      this.tileset = props.tileset;
    }

    this.data = props.data;
    this.tileSize = props.tileSize;
    this.tilesetCols = props.tilesetCols;

    this.transform.position = props.position;

    // TilemapComponent will automatically create/update BoundsComponent via onAttach
    this.addComponent(new TilemapComponent(
      this.tileset,
      this.data,
      this.tileSize,
      this.tilesetCols
    ));

    this.registerSelf();
  }
}
