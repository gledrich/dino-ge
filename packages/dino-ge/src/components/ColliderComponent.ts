import Component from '../core/Component.js';

/** A rectangle, circle or strictly convex polygon in object-local coordinates. */
export type ColliderFixture =
  | Readonly<{ kind: 'rectangle'; x?: number; y?: number; width: number; height: number }>
  | Readonly<{ kind: 'circle'; x?: number; y?: number; radius: number }>
  | Readonly<{ kind: 'polygon'; vertices: readonly Readonly<{ x: number; y: number }>[] }>;

/** @internal Copies and validates one collider fixture. */
export function normaliseColliderFixture(fixture: ColliderFixture): ColliderFixture {
  switch (fixture.kind) {
    case 'rectangle': {
      const { x = 0, y = 0, width, height } = fixture;
      if (![x, y, width, height, x + width, y + height].every(Number.isFinite) ||
          width <= 0 || height <= 0 || x + width === x || y + height === y) {
        throw new RangeError('A collider rectangle needs finite coordinates and positive dimensions.');
      }
      return Object.freeze({ kind: 'rectangle', x, y, width, height });
    }
    case 'circle': {
      const { x = 0, y = 0, radius } = fixture;
      if (![x, y, radius].every(Number.isFinite) || radius <= 0) {
        throw new RangeError('A collider circle needs a finite centre and positive radius.');
      }
      return Object.freeze({ kind: 'circle', x, y, radius });
    }
    case 'polygon': {
      const vertices = Array.from(fixture.vertices, ({ x, y }) => Object.freeze({ x, y }));
      if (vertices.length < 3 || vertices.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y))) {
        throw new RangeError('A collider polygon needs at least three finite vertices.');
      }

      // All other vertices must lie strictly on the same side of every edge.
      let winding = 0;
      for (let i = 0; i < vertices.length; i++) {
        const next = (i + 1) % vertices.length;
        const a = vertices[i];
        const b = vertices[next];
        for (let j = 0; j < vertices.length; j++) {
          if (j === i || j === next) continue;
          const c = vertices[j];
          const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
          const sign = Math.sign(cross);
          if (!Number.isFinite(cross) || !sign || (winding && sign !== winding)) {
            throw new RangeError('Collider polygon vertices must follow the boundary of a strictly convex polygon.');
          }
          winding = sign;
        }
      }
      if (winding < 0) vertices.reverse();
      return Object.freeze({ kind: 'polygon', vertices: Object.freeze(vertices) });
    }
    default:
      throw new TypeError('Unknown collider fixture kind.');
  }
}

/**
 * Supplies collision geometry independently of an object's appearance.
 * Rectangles are anchored at their top-left and circles at their centre.
 * Several fixtures form one compound body. An object without a PhysicsComponent
 * is static. Circles stay round and use the larger absolute world scale.
 * A zero world scale on either axis disables all fixtures on the object.
 */
export default class ColliderComponent extends Component {
  /** Immutable local fixtures in their supplied order. */
  readonly fixtures: readonly ColliderFixture[];

  constructor(fixtures: readonly ColliderFixture[]) {
    super();
    if (!Array.isArray(fixtures) || !fixtures.length) {
      throw new RangeError('A collider needs at least one fixture.');
    }
    this.fixtures = Object.freeze(Array.from(fixtures, normaliseColliderFixture));
  }
}
