import Vector2 from '../math/Vector2.js';
import GameObject from '../core/GameObject.js';
import Circle from '../objects/Circle.js';
import PhysicsComponent from '../components/PhysicsComponent.js';
import ColliderComponent from '../components/ColliderComponent.js';
import { getFixtureContact, transformDisplacement } from './ColliderGeometry.js';
import ShapeComponent from '../components/ShapeComponent.js';
import { getEngineState } from '../core/EngineState.js';

/**
 * Holds data about a collision between two objects.
 */
export interface CollisionManifold {
  /** First object in the collision. */
  obj1: GameObject;
  /** Second object in the collision. */
  obj2: GameObject;
  /** Normalized direction of the collision from obj1 to obj2. */
  normal: Vector2;
  /** Penetration depth in world space. */
  depth: number;
  /** Fixture indexes for explicit contacts. Legacy geometry occupies index zero. */
  fixtureIndex1?: number;
  fixtureIndex2?: number;
}

/** Detail for a collision event on either participant. */
export interface CollisionEventDetail {
  other: GameObject;
  /** The detected manifold, or the last detected manifold for a collisionEnd. */
  manifold: CollisionManifold;
}

/**
 * Utility class for collision detection between game objects.
 */
export default class Physics {
  /**
   * Checks if two game objects are colliding.
   * @param obj1 First object.
   * @param obj2 Second object.
   * @returns A manifold if colliding, else null.
   */
  static getCollisionManifold(obj1: GameObject, obj2: GameObject): CollisionManifold | null {
    if (obj1.hasComponent(ColliderComponent) || obj2.hasComponent(ColliderComponent)) {
      const contact = getFixtureContact(obj1, obj2);
      return contact ? { obj1, obj2, ...contact } : null;
    }
    const shape1 = obj1.getComponent(ShapeComponent);
    const shape2 = obj2.getComponent(ShapeComponent);
    const isCircle1 = shape1?.type === 'circle';
    const isCircle2 = shape2?.type === 'circle';

    if (isCircle1 && isCircle2) {
      return this.circleVsCircle(obj1 as Circle, obj2 as Circle);
    } else if (isCircle1 || isCircle2) {
      const circle = (isCircle1 ? obj1 : obj2) as Circle;
      const rect = (isCircle1 ? obj2 : obj1);
      const manifold = this.circleVsRect(circle, rect);

      if (manifold) {
        // Ensure manifold objects match the input order
        manifold.obj1 = obj1;
        manifold.obj2 = obj2;

        if (isCircle2) {
          // Flip normal if circle was actually obj2
          manifold.normal.multiply(-1);
        }
      }
      return manifold;
    } else {
      return this.aabbVsAabb(obj1, obj2);
    }
  }

  private static circleVsCircle(c1: Circle, c2: Circle): CollisionManifold | null {
    const r1 = c1.worldRadius;
    const r2 = c2.worldRadius;
    const combinedRadius = r1 + r2;

    const diff = c2.centre.clone().subtract(c1.centre);
    const distSq = diff.x * diff.x + diff.y * diff.y;

    if (distSq > combinedRadius * combinedRadius) return null;

    const dist = Math.sqrt(distSq);
    const normal = dist !== 0 ? diff.multiply(1 / dist) : new Vector2(0, 1);

    return {
      obj1: c1,
      obj2: c2,
      normal,
      depth: combinedRadius - dist
    };
  }

  private static aabbVsAabb(obj1: GameObject, obj2: GameObject): CollisionManifold | null {
    const scale1 = obj1.transform.worldScale;
    const scale2 = obj2.transform.worldScale;
    const w1 = (obj1.bounds?.width ?? 0) * scale1.x;
    const h1 = (obj1.bounds?.height ?? 0) * scale1.y;
    const w2 = (obj2.bounds?.width ?? 0) * scale2.x;
    const h2 = (obj2.bounds?.height ?? 0) * scale2.y;

    const pos1 = obj1.transform.worldPosition;
    const pos2 = obj2.transform.worldPosition;

    // centre to centre distance in world space
    const centre1 = new Vector2(pos1.x + w1 / 2, pos1.y + h1 / 2);
    const centre2 = new Vector2(pos2.x + w2 / 2, pos2.y + h2 / 2);
    const diff = centre2.clone().subtract(centre1);

    // Overlap on x and y axes
    const overlapX = (w1 / 2 + w2 / 2) - Math.abs(diff.x);
    if (overlapX <= 0) return null;

    const overlapY = (h1 / 2 + h2 / 2) - Math.abs(diff.y);
    if (overlapY <= 0) return null;

    // Resolve on the axis of least penetration
    if (overlapX < overlapY) {
      return {
        obj1,
        obj2,
        normal: new Vector2(diff.x > 0 ? 1 : -1, 0),
        depth: overlapX
      };
    } else {
      return {
        obj1,
        obj2,
        normal: new Vector2(0, diff.y > 0 ? 1 : -1),
        depth: overlapY
      };
    }
  }

  private static circleVsRect(circle: Circle, rect: GameObject): CollisionManifold | null {
    const cRadius = circle.worldRadius;
    const ccentre = circle.centre;

    const rScale = rect.transform.worldScale;
    const rectWidth = (rect.bounds?.width ?? 0) * rScale.x;
    const rectHeight = (rect.bounds?.height ?? 0) * rScale.y;
    const rectPos = rect.transform.worldPosition;

    const closestX = Math.max(rectPos.x, Math.min(ccentre.x, rectPos.x + rectWidth));
    const closestY = Math.max(rectPos.y, Math.min(ccentre.y, rectPos.y + rectHeight));

    const diff = new Vector2(closestX, closestY).subtract(ccentre);
    const distSq = diff.x * diff.x + diff.y * diff.y;

    if (distSq > cRadius * cRadius) return null;

    const dist = Math.sqrt(distSq);
    let normal: Vector2;
    let depth: number;

    if (dist === 0) {
      // Circle centre is inside the rectangle
      const dLeft = ccentre.x - rectPos.x;
      const dRight = rectPos.x + rectWidth - ccentre.x;
      const dTop = ccentre.y - rectPos.y;
      const dBottom = rectPos.y + rectHeight - ccentre.y;

      const minDist = Math.min(dLeft, dRight, dTop, dBottom);
      depth = cRadius + minDist;

      if (minDist === dLeft) normal = new Vector2(1, 0);
      else if (minDist === dRight) normal = new Vector2(-1, 0);
      else if (minDist === dTop) normal = new Vector2(0, 1);
      else normal = new Vector2(0, -1);
    } else {
      normal = diff.multiply(1 / dist);
      depth = cRadius - dist;
    }

    return {
      obj1: circle,
      obj2: rect,
      normal,
      depth
    };
  }

  /**
   * Detects and resolves a contact when both collision masks allow it.
   * Emits the legacy collision event on both bodies. Lifecycle events are
   * tracked by PhysicsSystem across fixed updates.
   * @param obj1 First object.
   * @param obj2 Second object.
   * @returns True if the objects were colliding.
   */
  static checkCollision(obj1: GameObject, obj2: GameObject): boolean {
    const manifold = this.resolveContact(obj1, obj2);
    if (!manifold) return false;

    obj1.emit('collision', { other: obj2, manifold });
    obj2.emit('collision', { other: obj1, manifold });
    return true;
  }

  /** Detects and resolves an allowed contact. The caller owns event dispatch. @internal */
  static resolveContact(obj1: GameObject, obj2: GameObject): CollisionManifold | null {
    const phys1 = obj1.getComponent(PhysicsComponent);
    const phys2 = obj2.getComponent(PhysicsComponent);
    if (!((phys1?.collisionMask ?? 0xffffffff) & (phys2?.collisionCategory ?? 0x1)) ||
        !((phys2?.collisionMask ?? 0xffffffff) & (phys1?.collisionCategory ?? 0x1))) {
      return null;
    }
    const manifold = this.getCollisionManifold(obj1, obj2);
    if (!manifold) return null;

    const state = getEngineState();
    if (state?.debug) {
      state.debugCollisions.push({ manifold, timestamp: Date.now() });
      if (state.debugCollisions.length > 50) {
        state.debugCollisions.shift();
      }
    }

    const obj1Static = phys1?.isStatic ?? true;
    const obj2Static = phys2?.isStatic ?? true;
    const isSensor = (phys1?.isSensor ?? false) || (phys2?.isSensor ?? false);

    if ((!obj1Static || !obj2Static) && !isSensor) {
      this.resolveCollision(manifold, phys1, phys2);
    }

    return manifold;
  }

  private static resolveCollision(manifold: CollisionManifold, phys1?: PhysicsComponent, phys2?: PhysicsComponent) {
    const { obj1, obj2, normal, depth } = manifold;
    const isStatic1 = phys1?.isStatic ?? true; // Assume static if no physics component
    const isStatic2 = phys2?.isStatic ?? true;

    // 1. Positional Correction (to prevent sinking/jitter)
    const percent = 0.8; // How much of the penetration to resolve
    const slop = 0.01; // Allowable penetration
    const correctionMagnitude = (Math.max(depth - slop, 0) / ((isStatic1 ? 0 : 1) + (isStatic2 ? 0 : 1))) * percent;
    const correction = normal.clone().multiply(correctionMagnitude);

    const explicit = manifold.fixtureIndex1 !== undefined;
    const toLocal = (object: GameObject, displacement: Vector2) =>
      explicit ? transformDisplacement(object, displacement, false) : displacement;
    const toWorld = (object: GameObject, velocity: Vector2) =>
      explicit ? transformDisplacement(object, velocity, true) : velocity;

    if (!isStatic1) obj1.transform.position.subtract(toLocal(obj1, correction));
    if (!isStatic2) obj2.transform.position.add(toLocal(obj2, correction));

    // 2. Impulse-based Velocity Response
    if (phys1 && phys2) {
      // Relative velocity along normal
      const rv = toWorld(obj2, phys2.velocity).clone().subtract(toWorld(obj1, phys1.velocity));
      const velAlongNormal = Vector2.dot(rv, normal);

      // Do not resolve if velocities are separating
      if (velAlongNormal > 0) return;

      // Calculate restitution (bounciness) - use the minimum of both objects
      const e = Math.min(phys1.restitution, phys2.restitution);

      // Calculate impulse scalar
      const invMass1 = isStatic1 ? 0 : (1 / phys1.mass);
      const invMass2 = isStatic2 ? 0 : (1 / phys2.mass);

      let j = -(1 + e) * velAlongNormal;
      j /= invMass1 + invMass2;

      // Apply impulse
      const impulse = normal.clone().multiply(j);
      if (!isStatic1) phys1.velocity.subtract(toLocal(obj1, impulse.clone().multiply(invMass1)));
      if (!isStatic2) phys2.velocity.add(toLocal(obj2, impulse.clone().multiply(invMass2)));
    } else {
      // Exactly one object has physics, treat the other as static infinity mass
      // Note: we know one of them has physics because of the caller's guard (!static1 || !static2)
      const activePhys = (phys1 || phys2)!;
      const activeObject = phys1 ? obj1 : obj2;
      // Direction FROM active TO static
      const n = phys1 ? normal : normal.clone().multiply(-1);

      // Relative velocity (static - active)
      const rv = toWorld(activeObject, activePhys.velocity).clone().multiply(-1);
      const velAlongNormal = Vector2.dot(rv, n);

      // Do not resolve if velocities are separating
      if (velAlongNormal > 0) return;

      const e = activePhys.restitution;
      let j = -(1 + e) * velAlongNormal;
      j /= (1 / activePhys.mass);

      const impulse = n.clone().multiply(j);
      activePhys.velocity.subtract(toLocal(activeObject, impulse.clone().multiply(1 / activePhys.mass)));
    }
  }
}
