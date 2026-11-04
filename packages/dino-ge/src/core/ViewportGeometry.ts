import type GameObject from './GameObject.js';

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
