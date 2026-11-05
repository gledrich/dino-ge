import type GameObject from './GameObject.js';
import ShapeComponent from '../components/ShapeComponent.js';
import LineComponent from '../components/LineComponent.js';

/** Round a world coordinate to the nearest grid line. A zero step leaves it unchanged. */
export function snapToGrid(coordinate: number, step: number): number {
  if (step <= 0 || !Number.isFinite(step)) return coordinate;
  const snapped = Math.round(coordinate / step) * step;
  return Number.isFinite(snapped) ? snapped : coordinate;
}

/** Back to front, with the first registered object on top when layers tie. */
export function getViewportDrawOrder(objects: Iterable<GameObject>): GameObject[] {
  return Array.from(objects).reverse().sort((a, b) => a.metadata.zIndex - b.metadata.zIndex);
}

/** The rendered bounds, expressed in world units along the object's axes. */
export function getViewportGeometry(object: GameObject) {
  const { worldPosition: origin, worldScale, worldRotation } = object.transform;
  const scaleX = worldScale?.x ?? 1;
  const scaleY = worldScale?.y ?? 1;
  const width = (object.bounds?.width ?? 0) * scaleX;
  const height = (object.bounds?.height ?? 0) * scaleY;
  const rotation = worldRotation ?? 0;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const cornerX = origin.x + width * cos - height * sin;
  const cornerY = origin.y + width * sin + height * cos;
  const segment = object.getComponent?.(LineComponent);
  const dx = segment ? segment.p2.x - segment.p1.x : 0;
  const dy = segment ? segment.p2.y - segment.p1.y : 0;
  const worldLength = segment && Math.hypot(dx * scaleX, dy * scaleY);
  const line = segment && {
    x1: origin.x + segment.p1.x * scaleX * cos - segment.p1.y * scaleY * sin,
    y1: origin.y + segment.p1.x * scaleX * sin + segment.p1.y * scaleY * cos,
    x2: origin.x + segment.p2.x * scaleX * cos - segment.p2.y * scaleY * sin,
    y2: origin.y + segment.p2.x * scaleX * sin + segment.p2.y * scaleY * cos,
    // Scaling changes the stroke's area by the determinant, then its length by worldLength.
    radius: worldLength ? segment.strokeWidth * Math.abs(scaleX * scaleY) * Math.hypot(dx, dy) / (2 * worldLength) : 0,
    padding: segment.strokeWidth * Math.max(Math.abs(scaleX), Math.abs(scaleY)) / 2,
  };

  return { origin, scaleX, scaleY, width, height, rotation, cos, sin, cornerX, cornerY, line };
}

/** The world-space rectangle used to cull an object's rendered geometry. */
export function getViewportBounds({ origin, width, height, cos, sin, line }: ReturnType<typeof getViewportGeometry>) {
  if (line) {
    return {
      left: Math.min(line.x1, line.x2) - line.padding,
      right: Math.max(line.x1, line.x2) + line.padding,
      top: Math.min(line.y1, line.y2) - line.padding,
      bottom: Math.max(line.y1, line.y2) + line.padding,
    };
  }
  const acrossX = width * cos;
  const acrossY = width * sin;
  const downX = -height * sin;
  const downY = height * cos;
  return {
    left: origin.x + Math.min(0, acrossX) + Math.min(0, downX),
    right: origin.x + Math.max(0, acrossX) + Math.max(0, downX),
    top: origin.y + Math.min(0, acrossY) + Math.min(0, downY),
    bottom: origin.y + Math.max(0, acrossY) + Math.max(0, downY),
  };
}

export function projectOntoObjectAxes(geometry: ReturnType<typeof getViewportGeometry>, x: number, y: number) {
  const dx = x - geometry.origin.x;
  const dy = y - geometry.origin.y;
  return { x: dx * geometry.cos + dy * geometry.sin, y: -dx * geometry.sin + dy * geometry.cos };
}

export function getViewportLineEndpoints(line: NonNullable<ReturnType<typeof getViewportGeometry>['line']>) {
  return [
    { kind: 'p1', x: line.x1, y: line.y1 },
    { kind: 'p2', x: line.x2, y: line.y2 },
  ] as const;
}

/** The rotation handle follows the upper edge or the midpoint of a line. */
export function getViewportRotationHandle(geometry: ReturnType<typeof getViewportGeometry>, zoom: number) {
  const { origin, width, height, cos, sin, line } = geometry;
  const gap = 20 / zoom;
  const radius = 5 / zoom;
  if (line) {
    const dx = line.x2 - line.x1;
    const dy = line.y2 - line.y1;
    const length = Math.hypot(dx, dy);
    if (!length) return;
    const anchorX = (line.x1 + line.x2) / 2;
    const anchorY = (line.y1 + line.y2) / 2;
    return { anchorX, anchorY, x: anchorX + dy / length * gap, y: anchorY - dx / length * gap, radius };
  }
  if (!width || !height) return;
  const anchorX = origin.x + width * cos / 2;
  const anchorY = origin.y + width * sin / 2;
  const outward = Math.sign(height) * gap;
  return { anchorX, anchorY, x: anchorX + sin * outward, y: anchorY - cos * outward, radius };
}

export function containsViewportPoint(object: GameObject, geometry: ReturnType<typeof getViewportGeometry>,
  x: number, y: number, lineTolerance: number): boolean {
  const { line } = geometry;
  if (line) {
    const dx = line.x2 - line.x1;
    const dy = line.y2 - line.y1;
    const lengthSquared = dx * dx + dy * dy;
    if (!lengthSquared) return false;
    const t = Math.max(0, Math.min(1, ((x - line.x1) * dx + (y - line.y1) * dy) / lengthSquared));
    return Math.hypot(x - line.x1 - t * dx, y - line.y1 - t * dy) <= Math.max(line.radius, lineTolerance);
  }
  const point = projectOntoObjectAxes(geometry, x, y);
  if (object.getComponent?.(ShapeComponent)?.type === 'circle' && object.bounds) {
    const radius = object.bounds.width / 2;
    const dx = point.x / geometry.scaleX - radius;
    const dy = point.y / geometry.scaleY - radius;
    return Math.hypot(dx, dy) < radius;
  }
  return point.x > Math.min(0, geometry.width) && point.x < Math.max(0, geometry.width) &&
    point.y > Math.min(0, geometry.height) && point.y < Math.max(0, geometry.height);
}
