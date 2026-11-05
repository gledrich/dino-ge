import type GameObject from './GameObject.js';
import ShapeComponent from '../components/ShapeComponent.js';

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

  return { origin, scaleX, scaleY, width, height, rotation, cos, sin, cornerX, cornerY };
}

export function projectOntoObjectAxes(geometry: ReturnType<typeof getViewportGeometry>, x: number, y: number) {
  const dx = x - geometry.origin.x;
  const dy = y - geometry.origin.y;
  return { x: dx * geometry.cos + dy * geometry.sin, y: -dx * geometry.sin + dy * geometry.cos };
}

export function containsViewportPoint(object: GameObject, geometry: ReturnType<typeof getViewportGeometry>, x: number, y: number): boolean {
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
