import ColliderComponent from '../components/ColliderComponent.js';
import ShapeComponent from '../components/ShapeComponent.js';
import type GameObject from '../core/GameObject.js';
import Vector2 from '../math/Vector2.js';
import type Circle from '../objects/Circle.js';
import type { CollisionBounds } from './Quadtree.js';

/** @internal */
export type WorldFixture = { index: number; bounds: CollisionBounds } & (
  | { kind: 'circle'; centre: Vector2; radius: number }
  | { kind: 'polygon'; vertices: readonly Vector2[] }
);

function rectangleVertices(x: number, y: number, width: number, height: number): Vector2[] {
  return [new Vector2(x, y), new Vector2(x + width, y), new Vector2(x + width, y + height), new Vector2(x, y + height)];
}

function polygon(index: number, vertices: readonly Vector2[]): WorldFixture | undefined {
  const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  for (const { x, y } of vertices) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    bounds.left = Math.min(bounds.left, x);
    bounds.right = Math.max(bounds.right, x);
    bounds.top = Math.min(bounds.top, y);
    bounds.bottom = Math.max(bounds.bottom, y);
  }
  const [a, b, c] = vertices;
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (!Number.isFinite(cross) || cross === 0) return;
  return { index, kind: 'polygon', vertices, bounds };
}

function circle(index: number, centre: Vector2, radius: number): WorldFixture | undefined {
  const { x, y } = centre;
  const bounds = { left: x - radius, right: x + radius, top: y - radius, bottom: y + radius };
  if (radius <= 0 || ![bounds.left, bounds.right, bounds.top, bounds.bottom].every(Number.isFinite)) return;
  return { index, kind: 'circle', centre, radius, bounds };
}

/** @internal Projects explicit fixtures, or adapts legacy circle and AABB geometry. */
export function getWorldFixtures(object: GameObject): WorldFixture[] {
  const collider = object.getComponent(ColliderComponent);
  if (!collider) {
    if (!object.bounds) return [];
    if (object.getComponent(ShapeComponent)?.type === 'circle') {
      const legacy = object as Circle;
      const fixture = circle(0, legacy.centre, legacy.worldRadius);
      return fixture ? [fixture] : [];
    }
    const { worldPosition, worldScale } = object.transform;
    const fixture = polygon(0, rectangleVertices(
      worldPosition.x, worldPosition.y, object.bounds.width * worldScale.x, object.bounds.height * worldScale.y,
    ));
    return fixture ? [fixture] : [];
  }

  const { worldPosition, worldRotation, worldScale } = object.transform;
  if (!worldScale.x || !worldScale.y) return [];
  const cos = Math.cos(worldRotation);
  const sin = Math.sin(worldRotation);
  const point = ({ x, y }: Readonly<{ x: number; y: number }>) => {
    const sx = x * worldScale.x;
    const sy = y * worldScale.y;
    return new Vector2(worldPosition.x + sx * cos - sy * sin, worldPosition.y + sx * sin + sy * cos);
  };

  const fixtures: WorldFixture[] = [];
  collider.fixtures.forEach((fixture, index) => {
    let world: WorldFixture | undefined;
    if (fixture.kind === 'circle') {
      world = circle(index, point({ x: fixture.x ?? 0, y: fixture.y ?? 0 }),
        fixture.radius * Math.max(Math.abs(worldScale.x), Math.abs(worldScale.y)));
    } else {
      const vertices = fixture.kind === 'rectangle'
        ? rectangleVertices(fixture.x ?? 0, fixture.y ?? 0, fixture.width, fixture.height)
        : fixture.vertices;
      world = polygon(index, vertices.map(point));
    }
    if (world) fixtures.push(world);
  });
  return fixtures;
}

/** @internal Returns the union AABB for an explicit collider. */
export function getColliderBounds(object: GameObject): CollisionBounds | undefined {
  let bounds: CollisionBounds | undefined;
  for (const fixture of getWorldFixtures(object)) {
    const { left, right, top, bottom } = fixture.bounds;
    if (bounds) {
      bounds.left = Math.min(bounds.left, left);
      bounds.right = Math.max(bounds.right, right);
      bounds.top = Math.min(bounds.top, top);
      bounds.bottom = Math.max(bounds.bottom, bottom);
    } else {
      bounds = { left, right, top, bottom };
    }
  }
  return bounds;
}

type Contact = { normal: Vector2; depth: number };

function project(fixture: WorldFixture, axis: Vector2): { min: number; max: number } {
  if (fixture.kind === 'circle') {
    const centre = Vector2.dot(fixture.centre, axis);
    return { min: centre - fixture.radius, max: centre + fixture.radius };
  }
  let min = Infinity;
  let max = -Infinity;
  for (const vertex of fixture.vertices) {
    const distance = Vector2.dot(vertex, axis);
    min = Math.min(min, distance);
    max = Math.max(max, distance);
  }
  return { min, max };
}

function unit(x: number, y: number): Vector2 | undefined {
  const length = Math.hypot(x, y);
  return length && Number.isFinite(length) ? new Vector2(x / length, y / length) : undefined;
}

function polygonAxes(axes: Vector2[], vertices: readonly Vector2[], centre?: Vector2): void {
  let closest = vertices[0];
  let closestDistance = Infinity;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const axis = unit(a.y - b.y, b.x - a.x);
    if (axis) axes.push(axis);
    if (centre) {
      const distance = Math.hypot(a.x - centre.x, a.y - centre.y);
      if (distance < closestDistance) {
        closest = a;
        closestDistance = distance;
      }
    }
  }
  if (centre) {
    const axis = unit(closest.x - centre.x, closest.y - centre.y);
    if (axis) axes.push(axis);
  }
}

function intersect(first: WorldFixture, second: WorldFixture): Contact | undefined {
  if (first.kind === 'circle' && second.kind === 'circle') {
    const x = second.centre.x - first.centre.x;
    const y = second.centre.y - first.centre.y;
    const depth = first.radius + second.radius - Math.hypot(x, y);
    if (Number.isFinite(depth) && depth >= 0) return { normal: unit(x, y) ?? new Vector2(0, 1), depth };
    return;
  }

  const a = first.bounds;
  const b = second.bounds;
  if (a.left > b.right || b.left > a.right || a.top > b.bottom || b.top > a.bottom) return;

  const axes: Vector2[] = [];
  if (first.kind === 'polygon') polygonAxes(axes, first.vertices, second.kind === 'circle' ? second.centre : undefined);
  if (second.kind === 'polygon') polygonAxes(axes, second.vertices, first.kind === 'circle' ? first.centre : undefined);
  let contact: Contact | undefined;
  for (const axis of axes) {
    const firstProjection = project(first, axis);
    const secondProjection = project(second, axis);
    // Distance to separate in each direction, including contained intervals.
    const forward = firstProjection.max - secondProjection.min;
    const backward = secondProjection.max - firstProjection.min;
    if (forward < 0 || backward < 0) return;
    const depth = Math.min(forward, backward);
    if (Number.isFinite(depth) && (!contact || depth < contact.depth)) {
      contact = { depth, normal: forward <= backward ? axis : axis.multiply(-1) };
    }
  }
  return contact;
}

/** @internal Returns the deepest explicit fixture contact. Input order breaks ties. */
export function getFixtureContact(first: GameObject, second: GameObject) {
  let best: (Contact & { fixtureIndex1: number; fixtureIndex2: number }) | undefined;
  const firstFixtures = getWorldFixtures(first);
  const secondFixtures = getWorldFixtures(second);
  for (const a of firstFixtures) {
    for (const b of secondFixtures) {
      const contact = intersect(a, b);
      if (contact && (!best || contact.depth > best.depth)) {
        best = { ...contact, fixtureIndex1: a.index, fixtureIndex2: b.index };
      }
    }
  }
  return best;
}

/** @internal Converts a displacement between parent-local axes and world axes. */
export function transformDisplacement(object: GameObject, vector: Vector2, toWorld: boolean): Vector2 {
  const parent = object.transform.parent;
  if (!parent) return vector;
  const { worldScale: { x: sx, y: sy }, worldRotation } = parent;
  const cos = Math.cos(worldRotation);
  const sin = Math.sin(worldRotation);
  const { x, y } = vector;
  return toWorld
    ? new Vector2(x * sx * cos - y * sy * sin, x * sx * sin + y * sy * cos)
    : new Vector2(sx ? (x * cos + y * sin) / sx : 0, sy ? (-x * sin + y * cos) / sy : 0);
}
