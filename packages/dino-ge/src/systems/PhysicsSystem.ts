import System from '../core/System.js';
import GameObject from '../core/GameObject.js';
import EventBusComponent from '../components/EventBusComponent.js';
import PhysicsComponent from '../components/PhysicsComponent.js';
import BoundsComponent from '../components/BoundsComponent.js';
import Physics from '../physics/Physics.js';
import ShapeComponent from '../components/ShapeComponent.js';
import type Circle from '../objects/Circle.js';
import Quadtree, { type CollisionEntry } from '../physics/Quadtree.js';
import { getEngineState } from '../core/EngineState.js';

/**
 * A system that processes entities with PhysicsComponents.
 * Handles movement, velocity, acceleration, and automatic collision resolution.
 */
export default class PhysicsSystem extends System {
  /**
   * Updates the position of entities and resolves collisions.
   * @param entities All game objects.
   * @param fixedDelta The fixed time step.
   */
  public override fixedUpdate(entities: Set<GameObject>, fixedDelta: number): void {
    const state = getEngineState();
    const collidables: GameObject[] = [];
    const processingList = state?.sortedObjects?.length > 0 ? state.sortedObjects : Array.from(entities);

    processingList.forEach((object) => {
      // Skip if object is no longer in the set (might have been destroyed in this fixedUpdate loop)
      if (!entities.has(object)) return;

      const physics = object.getComponent(PhysicsComponent);
      if (physics) {
        // 1. Integration Phase (Movement)
        if (!physics.isStatic) {
          // Apply acceleration to velocity
          physics.velocity.x += physics.acceleration.x * fixedDelta;
          physics.velocity.y += physics.acceleration.y * fixedDelta;

          // Apply velocity to local position
          object.transform.position.x += physics.velocity.x * fixedDelta;
          object.transform.position.y += physics.velocity.y * fixedDelta;
        }

        // Collect collidables for the next phase
        if (object.getComponent(BoundsComponent)) {
          collidables.push(object);
        }
      }
    });

    let index = this.buildIndex(collidables, entities);
    for (let first = 0; first < collidables.length - 1; first++) {
      const object = collidables[first];
      let after = first;
      while (entities.has(object)) {
        const candidates: number[] = [];
        const bounds = index.bounds.get(first);
        if (bounds) {
          index.tree?.query(bounds, after, candidates);
          for (const candidate of index.unbounded) {
            if (candidate > after) candidates.push(candidate);
          }
          candidates.sort((a, b) => a - b);
        } else {
          for (let candidate = after + 1; candidate < collidables.length; candidate++) {
            candidates.push(candidate);
          }
        }

        let changed = false;
        for (const second of candidates) {
          const other = collidables[second];
          if (!entities.has(other)) continue;
          const canRunHandlers = [object, other].some(body =>
            body.emit !== GameObject.prototype.emit || body.hasComponent(EventBusComponent));
          if (!Physics.checkCollision(object, other)) continue;

          const a = object.getComponent(PhysicsComponent);
          const b = other.getComponent(PhysicsComponent);
          if (!canRunHandlers && (a?.isSensor || b?.isSensor || (a?.isStatic && b?.isStatic))) continue;

          // User handlers can move unrelated objects. Without handlers, only
          // the participants and their transform descendants can have moved.
          if (canRunHandlers || object.transform.children.size || other.transform.children.size) {
            index = this.buildIndex(collidables, entities);
          } else {
            const firstMoved = this.refreshEntry(index, object, first);
            this.refreshEntry(index, other, second);
            if (!firstMoved) continue;
          }
          after = second;
          changed = true;
          break;
        }
        if (!changed) break;
      }
    }
  }

  private buildIndex(collidables: GameObject[], entities: Set<GameObject>) {
    const bounds = new Map<number, CollisionEntry>();
    const unbounded = new Set<number>();
    const extent = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };

    collidables.forEach((object, index) => {
      if (!entities.has(object)) return;
      const entry = this.collisionBounds(object, index);
      if (!entry) {
        unbounded.add(index);
        return;
      }

      bounds.set(index, entry);
      extent.left = Math.min(extent.left, entry.left);
      extent.right = Math.max(extent.right, entry.right);
      extent.top = Math.min(extent.top, entry.top);
      extent.bottom = Math.max(extent.bottom, entry.bottom);
    });

    const tree = bounds.size ? new Quadtree(extent, [...bounds.values()]) : undefined;
    return { bounds, tree, unbounded };
  }

  private refreshEntry(index: ReturnType<PhysicsSystem['buildIndex']>, object: GameObject, id: number): boolean {
    const old = index.bounds.get(id);
    const entry = this.collisionBounds(object, id);
    if (old && entry && old.left === entry.left && old.right === entry.right &&
        old.top === entry.top && old.bottom === entry.bottom) return false;
    if (old) index.tree?.remove(old);
    if (entry && index.tree?.insert(entry)) {
      index.bounds.set(id, entry);
      index.unbounded.delete(id);
    } else {
      index.bounds.delete(id);
      index.unbounded.add(id);
    }
    return true;
  }

  private collisionBounds(object: GameObject, index: number): CollisionEntry | undefined {
    if (object.getComponent(ShapeComponent)?.type === 'circle') {
      const circle = object as Circle;
      const centre = circle.centre;
      if (!centre) return undefined;
      const { x, y } = centre;
      const radius = Math.abs(circle.worldRadius);
      const entry = { index, left: x - radius, right: x + radius, top: y - radius, bottom: y + radius };
      return [entry.left, entry.right, entry.top, entry.bottom].every(Number.isFinite) ? entry : undefined;
    }

    const { worldPosition: { x, y }, worldScale } = object.transform;
    const right = x + (object.bounds?.width ?? 0) * worldScale.x;
    const bottom = y + (object.bounds?.height ?? 0) * worldScale.y;
    if (![x, y, right, bottom].every(Number.isFinite)) return undefined;
    return { index, left: Math.min(x, right), right: Math.max(x, right),
      top: Math.min(y, bottom), bottom: Math.max(y, bottom) };
  }
}
