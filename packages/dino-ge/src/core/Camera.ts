import Vector2 from '../math/Vector2.js';
import type GameObject from './GameObject.js';
import { getViewportBounds, getViewportGeometry } from './ViewportGeometry.js';

/** A rectangle in world coordinates. */
export interface CameraBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function followAxis(centre: number, viewportSize: number, start: number, size: number): number {
  const travel = size - viewportSize;
  if (travel <= 0) return start + travel / 2;
  return Math.max(start, Math.min(centre - viewportSize / 2, start + travel));
}

/**
 * Manages the viewport and transformation of the game world.
 */
export default class Camera {
  /** Current camera position in world space. */
  public position: Vector2 = new Vector2(0, 0);
  /** Zoom level of the camera. */
  public zoom: number = 1;

  /**
   * initialises a new instance of Camera.
   */
  constructor() {}

  /**
   * Centres the camera on a target object. With world bounds, follows the target's
   * rendered centre and keeps the viewport within the rectangle where it fits.
   * If the viewport is larger than the world on an axis, centres that axis.
   * @param target The object to follow.
   * @param viewportWidth Width of the viewport in pixels.
   * @param viewportHeight Height of the viewport in pixels.
   * @param bounds Optional world rectangle with finite coordinates and non-negative dimensions.
   */
  public follow(target: GameObject, viewportWidth: number, viewportHeight: number, bounds?: CameraBounds) {
    if (bounds) {
      const { x, y, width, height } = bounds;
      const viewport = this.getViewportBounds(viewportWidth, viewportHeight);
      if (this.zoom <= 0 || ![this.zoom, x, y, width, height, x + width, y + height,
        viewport.width, viewport.height].every(Number.isFinite) ||
        width < 0 || height < 0 || viewport.width < 0 || viewport.height < 0) {
        throw new RangeError('Bounded camera follow needs finite bounds and viewport dimensions, and positive zoom.');
      }
      const { left, right, top, bottom } = getViewportBounds(getViewportGeometry(target));
      this.position.set(
        followAxis(left + (right - left) / 2, viewport.width, x, width),
        followAxis(top + (bottom - top) / 2, viewport.height, y, height),
      );
      return;
    }

    const width = target.bounds?.width ?? 0;
    const height = target.bounds?.height ?? 0;
    this.position.x = (target.transform.position.x + width / 2) - (viewportWidth / 2) / this.zoom;
    this.position.y = (target.transform.position.y + height / 2) - (viewportHeight / 2) / this.zoom;
  }

  /**
   * Returns the current viewport bounds in world space.
   * @param width Width of the viewport in pixels.
   * @param height Height of the viewport in pixels.
   * @returns An object representing the x, y, width, and height of the visible area.
   */
  public getViewportBounds(width: number, height: number) {
    return {
      x: this.position.x,
      y: this.position.y,
      width: width / this.zoom,
      height: height / this.zoom
    };
  }

  /**
   * Resets the camera position to the origin (0, 0) and zoom to 1.
   */
  public reset() {
    this.position.x = 0;
    this.position.y = 0;
    this.zoom = 1;
  }
}
