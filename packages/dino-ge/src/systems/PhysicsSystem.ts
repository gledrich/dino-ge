import System from '../core/System.js';
import GameObject from '../core/GameObject.js';
import type Scene from '../core/Scene.js';
import EventBusComponent from '../components/EventBusComponent.js';
import PhysicsComponent from '../components/PhysicsComponent.js';
import ColliderComponent from '../components/ColliderComponent.js';
import { getColliderBounds } from '../physics/ColliderGeometry.js';
import BoundsComponent from '../components/BoundsComponent.js';
import Physics, { type CollisionManifold } from '../physics/Physics.js';
import ShapeComponent from '../components/ShapeComponent.js';
import type Circle from '../objects/Circle.js';
import Quadtree, { type CollisionEntry } from '../physics/Quadtree.js';
import { getEngineState } from '../core/EngineState.js';

type Contacts = Map<GameObject, Map<GameObject, CollisionManifold>>;

/**
 * A system that processes entities with PhysicsComponents.
 * Handles movement, velocity, acceleration, and automatic collision resolution.
 */
export default class PhysicsSystem extends System {
  private contacts: Contacts = new Map();
  private entities?: Set<GameObject>;
  private scene?: Scene | null;

  /** Clears contact history without emitting events in the outgoing scene. @internal */
  public resetContacts(): void {
    this.contacts = new Map();
    this.entities = undefined;
    this.scene = undefined;
  }

  /**
   * Updates the position of entities and resolves collisions.
   * @param entities All game objects.
   * @param fixedDelta The fixed time step.
   */
  public override fixedUpdate(entities: Set<GameObject>, fixedDelta: number): void {
    const state = getEngineState();
    const scene = state?.currentScene;
    const activeObjects = scene?.objects ?? state?.objects;
    if (this.entities !== entities || this.scene !== scene) {
      this.resetContacts();
      this.entities = entities;
      this.scene = scene;
    }

    const previous = this.contacts;
    const contacts: Contacts = new Map();
    const worldIsActive = () => this.contacts === previous && getEngineState() === state &&
      state?.currentScene === scene && (scene?.objects ?? state?.objects) === activeObjects;
    const emit = (type: string, object: GameObject, other: GameObject, manifold: CollisionManifold) => {
      if (worldIsActive() && entities.has(object)) object.emit(type, { other, manifold });
    };
    const isCollidable = (object: GameObject, physics: PhysicsComponent | undefined) =>
      object.hasComponent(ColliderComponent) || (physics && object.hasComponent(BoundsComponent));
    const collidables: GameObject[] = [];
    const cachedOrder = state?.sortedObjects;
    let processingList: Iterable<GameObject>;
    if (!cachedOrder?.length) {
      processingList = Array.from(entities);
    } else {
      // Keep the previous pair order while admitting bodies that have not been drawn yet.
      processingList = state.zOrderDirty ? new Set([...cachedOrder, ...entities]) : cachedOrder;
    }

    for (const object of processingList) {
      // Skip if object is no longer in the set (might have been destroyed in this fixedUpdate loop)
      if (!entities.has(object)) continue;

      const physics = object.getComponent(PhysicsComponent);
      if (physics && !physics.isStatic) {
        physics.velocity.x += physics.acceleration.x * fixedDelta;
        physics.velocity.y += physics.acceleration.y * fixedDelta;
        object.transform.position.x += physics.velocity.x * fixedDelta;
        object.transform.position.y += physics.velocity.y * fixedDelta;
      }
      if (isCollidable(object, physics)) collidables.push(object);
    }

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
          if (!worldIsActive()) return;
          if (!entities.has(other)) continue;
          const a = object.getComponent(PhysicsComponent);
          const b = other.getComponent(PhysicsComponent);
          if (!isCollidable(object, a) || !isCollidable(other, b)) continue;
          const canRunHandlers = [object, other].some(body =>
            body.emit !== GameObject.prototype.emit || body.hasComponent(EventBusComponent));
          const manifold = Physics.resolveContact(object, other);
          if (!manifold) continue;

          object.emit('collision', { other, manifold });
          // Legacy delivery is synchronous for both participants of an accepted pair.
          if (worldIsActive()) other.emit('collision', { other: object, manifold });
          if (!worldIsActive()) return;
          if (entities.has(object) && entities.has(other)) {
            let pairs = contacts.get(object);
            if (!pairs) contacts.set(object, pairs = new Map());
            pairs.set(other, manifold);
            const type = previous.get(object)?.has(other) || previous.get(other)?.has(object)
              ? 'collisionStay' : 'collisionStart';
            emit(type, object, other, manifold);
            emit(type, other, object, manifold);
          }
          if (!worldIsActive()) return;
          if (!canRunHandlers && (a?.isSensor || b?.isSensor || ((a?.isStatic ?? true) && (b?.isStatic ?? true)))) continue;

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

    for (const [object, pairs] of previous) {
      for (const [other, manifold] of pairs) {
        if (contacts.get(object)?.has(other) || contacts.get(other)?.has(object)) continue;
        emit('collisionEnd', object, other, manifold);
        emit('collisionEnd', other, object, manifold);
      }
    }
    if (worldIsActive()) this.contacts = contacts;
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
    if (object.hasComponent(ColliderComponent)) {
      const bounds = getColliderBounds(object);
      return bounds && { index, ...bounds };
    }
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
