import ColliderComponent from '../components/ColliderComponent.js';
import PhysicsComponent from '../components/PhysicsComponent.js';
import { getEngineState } from '../core/EngineState.js';
import type GameObject from '../core/GameObject.js';
import Vector2 from '../math/Vector2.js';
import { getWorldFixtures, type WorldFixture } from './ColliderGeometry.js';

export interface RaycastOptions {
  /** Defaults to the active scene or the global object collection. */
  objects?: Iterable<GameObject>;
  /** An object to exclude, such as the ray emitter. */
  ignore?: GameObject;
  /** Include sensor bodies. Defaults to false. */
  includeSensors?: boolean;
  /** Body categories the ray can hit. Defaults to all categories. */
  mask?: number;
  /** Ray category bits accepted by body masks. Defaults to all categories. */
  category?: number;
}

export interface RaycastHit {
  object: GameObject;
  /** Index in the compound, or zero for a legacy circle or AABB. */
  fixtureIndex: number;
  point: Vector2;
  /** Outward unit normal in world coordinates. */
  normal: Vector2;
  distance: number;
  /** Distance along the segment divided by its length. */
  fraction: number;
}

type Segment = { from: Vector2; direction: Vector2; length: number };
type BoundaryHit = { distance: number; normal: Vector2 };

function segmentDistance(distance: number, length: number): number | undefined {
  // Normalising the ray can round a hit at the endpoint just past its length.
  if (!(distance >= 0) || (distance - length) / length > 4 * Number.EPSILON) return;
  return Math.min(distance, length);
}

function circleHit(fixture: Extract<WorldFixture, { kind: 'circle' }>, { from, direction, length }: Segment) {
  const { centre, radius } = fixture;
  const x = centre.x - from.x;
  const y = centre.y - from.y;
  const along = x * direction.x + y * direction.y;
  const perpendicular = (x * direction.y - y * direction.x) / radius;
  if (Math.abs(perpendicular) > 1) return;

  const chord = radius * Math.sqrt(1 - perpendicular * perpendicular);
  const entrance = along - chord;
  const distance = segmentDistance(entrance >= 0 ? entrance : along + chord, length);
  if (distance === undefined) return;
  const nx = direction.x * distance - x;
  const ny = direction.y * distance - y;
  const magnitude = Math.hypot(nx, ny);
  if (!magnitude) return;
  return { distance, normal: new Vector2(nx / magnitude, ny / magnitude) };
}

function polygonHit(fixture: Extract<WorldFixture, { kind: 'polygon' }>, { from, direction, length }: Segment) {
  const { vertices } = fixture;
  const [a, b, c] = vertices;
  const winding = Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  let enter: BoundaryHit | undefined;
  let exit: BoundaryHit | undefined;
  let originNormal: Vector2 | undefined;
  let originInside = true;

  for (let i = 0; i < vertices.length; i++) {
    const start = vertices[i];
    const end = vertices[(i + 1) % vertices.length];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const edgeLength = Math.hypot(dx, dy);
    if (!edgeLength) continue;
    const normal = new Vector2(winding * dy / edgeLength, -winding * dx / edgeLength);
    const signed = normal.x * (from.x - start.x) + normal.y * (from.y - start.y);
    const slope = Vector2.dot(normal, direction);
    if (signed > 0) originInside = false;
    if (signed === 0) originNormal ??= normal;

    if (slope === 0) {
      if (signed > 0) return;
      continue;
    }
    const distance = -signed / slope;
    if (slope < 0 && (!enter || distance > enter.distance)) enter = { distance, normal };
    if (slope > 0 && (!exit || distance < exit.distance)) exit = { distance, normal };
    if (enter && exit && enter.distance > exit.distance) return;
  }

  if (originInside && originNormal) return { distance: 0, normal: originNormal };
  const hit = originInside ? exit : enter;
  if (hit) {
    const distance = segmentDistance(hit.distance, length);
    if (distance !== undefined) return { distance, normal: hit.normal };
  }
}

/** @internal Intersects a finite segment with the current world fixtures. */
export function* rayHits(from: Vector2, to: Vector2, options: RaycastOptions): IterableIterator<RaycastHit> {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!length || !Number.isFinite(length)) return;

  const state = getEngineState();
  const objects = options.objects ?? state?.currentScene?.objects ?? state?.objects;
  if (!objects) return;
  const direction = new Vector2(dx / length, dy / length);
  const segment = { from, direction, length };
  const left = Math.min(from.x, to.x);
  const right = Math.max(from.x, to.x);
  const top = Math.min(from.y, to.y);
  const bottom = Math.max(from.y, to.y);
  const { ignore, mask = 0xffffffff, category = 0xffffffff, includeSensors = false } = options;
  for (const object of objects) {
    if (object === ignore) continue;
    const physics = object.getComponent(PhysicsComponent);
    if ((!physics && !object.hasComponent(ColliderComponent)) || (physics?.isSensor && !includeSensors) ||
        !(mask & (physics?.collisionCategory ?? 0x1)) || !(category & (physics?.collisionMask ?? 0xffffffff))) continue;

    for (const fixture of getWorldFixtures(object)) {
      const bounds = fixture.bounds;
      if (bounds.right < left || bounds.left > right || bounds.bottom < top || bounds.top > bottom) continue;
      const hit = fixture.kind === 'circle' ? circleHit(fixture, segment) : polygonHit(fixture, segment);
      if (hit) {
        const { distance, normal } = hit;
        yield {
          object, fixtureIndex: fixture.index, distance, normal,
          point: distance === length ? new Vector2(to.x, to.y)
            : new Vector2(from.x + direction.x * distance, from.y + direction.y * distance),
          fraction: distance / length,
        };
      }
    }
  }
}
