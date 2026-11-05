import RenderComponent from './RenderComponent.js';
import Vector2 from '../math/Vector2.js';

/**
 * Component that holds data for rendering a line.
 */
export default class LineComponent extends RenderComponent {
  /** Stroke width of the line. */
  strokeWidth: number;
  /** Start point of the line. */
  p1: Vector2;
  /** End point of the line. */
  p2: Vector2;
  /** Stroke colour. An empty value uses the canvas stroke style. */
  colour?: string;

  constructor(strokeWidth: number, p1: Vector2, p2: Vector2, colour?: string) {
    super();
    this.strokeWidth = strokeWidth;
    this.p1 = p1;
    this.p2 = p2;
    this.colour = colour;
  }

  /**
   * Draws the line to the canvas.
   * @param ctx The canvas 2D rendering context.
   */
  draw(ctx: CanvasRenderingContext2D) {
    if (!this.gameObject) return;

    const { worldPosition, worldRotation, worldScale } = this.gameObject.transform;

    ctx.save();
    ctx.translate(worldPosition.x, worldPosition.y);
    if (worldRotation !== 0) ctx.rotate(worldRotation);
    ctx.scale(worldScale.x, worldScale.y);

    ctx.beginPath();
    ctx.lineWidth = this.strokeWidth;
    if (this.colour) ctx.strokeStyle = this.colour;
    ctx.moveTo(this.p1.x, this.p1.y);
    ctx.lineTo(this.p2.x, this.p2.y);
    ctx.stroke();
    ctx.closePath();
    
    ctx.restore();
  }
}
