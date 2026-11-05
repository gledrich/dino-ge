import RenderComponent from './RenderComponent.js';
import BoundsComponent from './BoundsComponent.js';

/**
 * Component that holds data for rendering a tilemap.
 */
export default class TilemapComponent extends RenderComponent {
  /** The source image for the tileset. */
  tileset: HTMLImageElement;
  /** 2D array of tile indices. */
  data: number[][];
  /** Tile size in pixels. */
  tileSize: number;
  /** Number of columns in the tileset image. */
  tilesetCols: number;
  /** Override canvas image smoothing for this tilemap only. */
  imageSmoothing?: boolean;

  constructor(tileset: HTMLImageElement, data: number[][], tileSize: number, tilesetCols: number) {
    super();
    this.tileset = tileset;
    this.data = data;
    this.tileSize = tileSize;
    this.tilesetCols = tilesetCols;
  }

  /**
   * Ensures the parent GameObject has a BoundsComponent synced with this tilemap.
   * Note: Bounds represent the BASE local size (unscaled).
   */
  private _updateGameObjectBounds() {
    if (!this.gameObject) return;

    const width = this.data[0].length * this.tileSize;
    const height = this.data.length * this.tileSize;

    if (!this.gameObject.bounds) {
      this.gameObject.bounds = new BoundsComponent(width, height);
      this.gameObject.addComponent(this.gameObject.bounds);
    } else {
      this.gameObject.bounds.width = width;
      this.gameObject.bounds.height = height;
    }
  }

  /**
   * Lifecycle hook called when the component is added to a GameObject.
   */
  onAttach() {
    this._updateGameObjectBounds();
  }

  /**
   * Draws the tilemap to the canvas.
   * @param ctx The canvas 2D rendering context.
   */
  draw(ctx: CanvasRenderingContext2D) {
    if (!this.gameObject) return;

    const { worldPosition, worldRotation, worldScale } = this.gameObject.transform;

    ctx.save();
    if (this.imageSmoothing !== undefined) ctx.imageSmoothingEnabled = this.imageSmoothing;
    ctx.translate(worldPosition.x, worldPosition.y);
    if (worldRotation !== 0) ctx.rotate(worldRotation);
    ctx.scale(worldScale.x, worldScale.y);

    for (let y = 0; y < this.data.length; y++) {
      for (let x = 0; x < this.data[y].length; x++) {
        const tileIndex = this.data[y][x];
        if (tileIndex === -1) continue; // Empty tile

        const sourceX = (tileIndex % this.tilesetCols) * this.tileSize;
        const sourceY = Math.floor(tileIndex / this.tilesetCols) * this.tileSize;

        ctx.drawImage(
          this.tileset,
          sourceX,
          sourceY,
          this.tileSize,
          this.tileSize,
          x * this.tileSize, // Drawn relative to translated context
          y * this.tileSize,
          this.tileSize,
          this.tileSize
        );
      }
    }
    
    ctx.restore();
  }
}
