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

export interface CameraSmoothFollowOptions {
  /** Positive exponential response rate per second. Defaults to 8. */
  response?: number;
  /** Optional rectangle in world coordinates. */
  bounds?: CameraBounds;
}

function fitAxis(origin: number, viewportSize: number, start: number, size: number): number {
  const travel = size - viewportSize;
  if (travel <= 0) return start + travel / 2;
  return Math.max(start, Math.min(origin, start + travel));
}

function worldFollowOrigin(target: GameObject, width: number, height: number) {
  const { left, right, top, bottom } = getViewportBounds(getViewportGeometry(target));
  return {
    x: left + (right - left) / 2 - width / 2,
    y: top + (bottom - top) / 2 - height / 2,
  };
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
      const viewport = this.followViewport(viewportWidth, viewportHeight, bounds);
      const origin = worldFollowOrigin(target, viewport.width, viewport.height);
      this.position.set(
        fitAxis(origin.x, viewport.width, bounds.x, bounds.width),
        fitAxis(origin.y, viewport.height, bounds.y, bounds.height),
      );
      return;
    }

    const width = target.bounds?.width ?? 0;
    const height = target.bounds?.height ?? 0;
    this.position.x = (target.transform.position.x + width / 2) - (viewportWidth / 2) / this.zoom;
    this.position.y = (target.transform.position.y + height / 2) - (viewportHeight / 2) / this.zoom;
  }

  /**
   * Eases towards the target's rendered world centre using elapsed game time.
   * With bounds, constrains the current origin and the destination before easing.
   * An oversized axis centres immediately, including when elapsed time is zero.
   */
  public followSmooth(target: GameObject, viewportWidth: number, viewportHeight: number,
    deltaSeconds: number, { response = 8, bounds }: CameraSmoothFollowOptions = {}): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0 || !Number.isFinite(response) || response <= 0) {
      throw new RangeError('Smooth camera follow needs non-negative elapsed seconds and a positive finite response.');
    }
    const viewport = this.followViewport(viewportWidth, viewportHeight, bounds);
    const desired = worldFollowOrigin(target, viewport.width, viewport.height);
    let { x, y } = this.position;
    if (![x, y, desired.x, desired.y].every(Number.isFinite)) {
      throw new RangeError('Smooth camera follow needs finite camera and target positions.');
    }

    if (bounds) {
      x = fitAxis(x, viewport.width, bounds.x, bounds.width);
      y = fitAxis(y, viewport.height, bounds.y, bounds.height);
      desired.x = fitAxis(desired.x, viewport.width, bounds.x, bounds.width);
      desired.y = fitAxis(desired.y, viewport.height, bounds.y, bounds.height);
    }

    const blend = -Math.expm1(-response * deltaSeconds);
    let nextX = x * (1 - blend) + desired.x * blend;
    let nextY = y * (1 - blend) + desired.y * blend;
    if (bounds) {
      // Floating-point rounding can otherwise move a fixed axis by one ulp.
      nextX = fitAxis(nextX, viewport.width, bounds.x, bounds.width);
      nextY = fitAxis(nextY, viewport.height, bounds.y, bounds.height);
    }
    if (![nextX, nextY].every(Number.isFinite)) {
      throw new RangeError('Smooth camera follow could not compute a finite camera position.');
    }
    this.position.set(nextX, nextY);
  }

  private followViewport(width: number, height: number, bounds?: CameraBounds) {
    const viewport = this.getViewportBounds(width, height);
    if (this.zoom <= 0 || ![this.zoom, viewport.width, viewport.height].every(Number.isFinite) ||
      viewport.width < 0 || viewport.height < 0) {
      throw new RangeError('Camera follow needs finite viewport dimensions and positive zoom.');
    }
    if (bounds && (![bounds.x, bounds.y, bounds.width, bounds.height,
      bounds.x + bounds.width, bounds.y + bounds.height].every(Number.isFinite) ||
      bounds.width < 0 || bounds.height < 0)) {
      throw new RangeError('Camera follow needs finite bounds with non-negative dimensions.');
    }
    return viewport;
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
