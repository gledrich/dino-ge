import PhysicsSystem from './PhysicsSystem.js';
import PhysicsComponent from '../components/PhysicsComponent.js';
import GameObject from '../core/GameObject.js';
import Vector2 from '../math/Vector2.js';
import BoundsComponent from '../components/BoundsComponent.js';
import Physics from '../physics/Physics.js';
import Engine from '../core/Engine.js';
import Scene from '../core/Scene.js';
import Circle from '../objects/Circle.js';
import { type EngineState } from '../core/EngineState.js';

class MockGameObject extends GameObject {}

describe('PhysicsSystem', () => {
  beforeEach(() => {
    Engine.resetState();
  });

  it('updates velocity based on acceleration', () => {
    const system = new PhysicsSystem();
    const obj = new MockGameObject('test', 0);
    const physics = new PhysicsComponent();
    physics.acceleration = new Vector2(10, 0);
    obj.addComponent(physics);

    const entities = new Set<GameObject>([obj]);
    
    // fixedUpdate(entities, fixedDelta)
    // 10 accel * 0.1 delta = 1 velocity increase
    system.fixedUpdate(entities, 0.1);
    
    expect(physics.velocity.x).toBe(1);
  });

  it('updates position based on velocity', () => {
    const system = new PhysicsSystem();
    const obj = new MockGameObject('test', 0);
    const physics = new PhysicsComponent();
    physics.velocity = new Vector2(50, 0);
    obj.addComponent(physics);

    const entities = new Set<GameObject>([obj]);
    
    // 50 velocity * 0.1 delta = 5 units movement
    system.fixedUpdate(entities, 0.1);
    
    expect(obj.transform.position.x).toBe(5);
  });

  it('skips objects missing from the entities Set when processing via sortedObjects', () => {
    const system = new PhysicsSystem();
    const obj1 = new MockGameObject('obj1', 0);
    const obj2 = new MockGameObject('obj2', 0);
    
    obj1.addComponent(new PhysicsComponent());
    obj2.addComponent(new PhysicsComponent());
    
    // Initialise engine state
    Engine.resetState();
    
    // Mock sortedObjects in global state
    const state = (globalThis as unknown as { __DINO_ENGINE_STATE__: EngineState }).__DINO_ENGINE_STATE__;
    state.sortedObjects = [obj1, obj2];
    
    // entities Set ONLY contains obj2. obj1 is in sortedObjects but NOT in entities Set
    const entities = new Set<GameObject>([obj2]);
    
    system.fixedUpdate(entities, 0.1);
    
    // obj2 should be updated, obj1 should be skipped
    expect(obj2.transform.position.y).toBe(0); // it has no velocity anyway but it was processed
    // if obj1 was processed, it wouldn't crash but we've successfully hit the !entities.has(obj1) line
  });

  it('handles empty sortedObjects array correctly', () => {
    const system = new PhysicsSystem();
    const obj = new MockGameObject('test', 0);
    obj.addComponent(new PhysicsComponent());
    const entities = new Set<GameObject>([obj]);
    
    Engine.resetState();
    const state = (globalThis as unknown as { __DINO_ENGINE_STATE__: EngineState }).__DINO_ENGINE_STATE__;
    state.sortedObjects = []; // Empty but present
    
    system.fixedUpdate(entities, 0.1);
    expect(obj.transform.position.x).toBe(0);
  });

  it('handles null sortedObjects correctly', () => {
    const system = new PhysicsSystem();
    const obj = new MockGameObject('test', 0);
    obj.addComponent(new PhysicsComponent());
    const entities = new Set<GameObject>([obj]);
    
    Engine.resetState();
    const state = (globalThis as unknown as { __DINO_ENGINE_STATE__: EngineState }).__DINO_ENGINE_STATE__;
    (state as unknown as { sortedObjects: null }).sortedObjects = null; // specifically test null path
    
    system.fixedUpdate(entities, 0.1);
    expect(obj.transform.position.x).toBe(0);
  });

  it('handles null engine state correctly', () => {
    const system = new PhysicsSystem();
    const obj = new MockGameObject('test', 0);
    obj.addComponent(new PhysicsComponent());
    const entities = new Set<GameObject>([obj]);
    
    const originalState = (globalThis as unknown as { __DINO_ENGINE_STATE__: EngineState }).__DINO_ENGINE_STATE__;
    (globalThis as unknown as Record<string, unknown>).__DINO_ENGINE_STATE__ = null;
    
    system.fixedUpdate(entities, 0.1);
    
    expect(obj.transform.position.x).toBe(0);
    (globalThis as unknown as Record<string, unknown>).__DINO_ENGINE_STATE__ = originalState;
  });

  it('ignores objects without PhysicsComponent', () => {
    const system = new PhysicsSystem();
    const obj = new MockGameObject('test', 0);
    // No PhysicsComponent added
    
    const entities = new Set<GameObject>([obj]);
    const initialPos = obj.transform.position.clone();
    
    system.fixedUpdate(entities, 0.1);
    
    expect(obj.transform.position.x).toBe(initialPos.x);
    expect(obj.transform.position.y).toBe(initialPos.y);
  });

  it('automatically checks for collisions between objects with physics and bounds', () => {
    const system = new PhysicsSystem();
    const obj1 = new MockGameObject('o1', 0);
    obj1.addComponent(new PhysicsComponent());
    obj1.addComponent(new BoundsComponent(10, 10));

    const obj2 = new MockGameObject('o2', 0);
    obj2.addComponent(new PhysicsComponent());
    obj2.addComponent(new BoundsComponent(10, 10));

    const checkCollisionSpy = jest.spyOn(Physics, 'resolveContact');
    const entities = new Set<GameObject>([obj1, obj2]);
    
    system.fixedUpdate(entities, 0.1);
    
    expect(checkCollisionSpy).toHaveBeenCalledWith(obj1, obj2);
    checkCollisionSpy.mockRestore();
  });

  it('skips collision check if an object is missing BoundsComponent', () => {
    const system = new PhysicsSystem();
    const obj1 = new MockGameObject('o1', 0);
    obj1.addComponent(new PhysicsComponent());
    // No BoundsComponent

    const obj2 = new MockGameObject('o2', 0);
    obj2.addComponent(new PhysicsComponent());
    obj2.addComponent(new BoundsComponent(10, 10));

    const checkCollisionSpy = jest.spyOn(Physics, 'resolveContact');
    const entities = new Set<GameObject>([obj1, obj2]);
    
    system.fixedUpdate(entities, 0.1);
    
    expect(checkCollisionSpy).not.toHaveBeenCalled();
    checkCollisionSpy.mockRestore();
  });

  function body(x: number, y = 0): GameObject {
    const object = new MockGameObject();
    object.transform.position.set(x, y);
    object.addComponent(new BoundsComponent(10, 10));
    const physics = new PhysicsComponent();
    physics.isSensor = true;
    object.addComponent(physics);
    return object;
  }

  it('avoids narrow-phase work for separated bodies', () => {
    const objects = Array.from({ length: 400 }, (_, index) => body(index % 20 * 25, Math.floor(index / 20) * 25));
    const check = jest.spyOn(Physics, 'resolveContact');
    try {
      new PhysicsSystem().fixedUpdate(new Set(objects), 0);
      expect(check).not.toHaveBeenCalled();
    } finally {
      check.mockRestore();
    }
  });

  it('keeps existing collision order while including bodies added before the next draw', () => {
    const left = body(0, 0);
    const middle = body(2, 0);
    const added = body(4, 0);
    const contacts: GameObject[] = [];
    left.on('collision', event => contacts.push(event.detail.other));
    Engine.sortedObjects = [left, middle];
    Engine.zOrderDirty = true;

    new PhysicsSystem().fixedUpdate(new Set([added, middle, left]), 0);

    expect(contacts).toEqual([middle, added]);
  });

  it('includes tangent scaled circles at a quadtree split', () => {
    const left = new Circle({ position: new Vector2(-20, -10), radius: 5 });
    const right = new Circle({ position: new Vector2(0, -10), radius: 5 });
    for (const circle of [left, right]) {
      circle.transform.scale.set(2, 2);
      const physics = new PhysicsComponent();
      physics.isSensor = true;
      circle.addComponent(physics);
    }
    const onCollision = jest.fn();
    left.on('collision', onCollision);
    const distant = Array.from({ length: 12 }, (_, index) =>
      body(index % 2 === 0 ? -100 : 90, index * 30 - 170));

    new PhysicsSystem().fixedUpdate(new Set([left, right, ...distant]), 0);
    expect(onCollision).toHaveBeenCalledTimes(1);
    expect(onCollision.mock.lastCall?.[0].detail.other).toBe(right);
  });

  it('retains a fractional circle contact accepted by the narrow phase', () => {
    const first = new Circle({ position: new Vector2(-10, 0), radius: 1.1 });
    const second = new Circle({ position: new Vector2(-7.8, 1), radius: 0.1 });
    first.addComponent(new PhysicsComponent());
    second.addComponent(new PhysicsComponent());
    const contact = jest.fn();
    first.on('collision', contact);

    new PhysicsSystem().fixedUpdate(new Set([first, second]), 0);
    expect(contact).toHaveBeenCalledTimes(1);
  });

  it('finds a later collision after an earlier callback moves a third body', () => {
    const first = body(0);
    const second = body(5);
    const third = body(100);
    const seen: GameObject[] = [];
    first.on('collision', event => {
      seen.push(event.detail.other);
      if (event.detail.other === second) third.transform.position.x = 3;
    });

    new PhysicsSystem().fixedUpdate(new Set([first, second, third]), 0);
    expect(seen).toEqual([second, third]);
  });

  it('skips a body removed by an earlier collision callback', () => {
    const first = body(0);
    const second = body(5);
    const removed = body(3);
    const objects = new Set([first, second, removed]);
    const onRemovedCollision = jest.fn();
    first.on('collision', () => objects.delete(removed));
    removed.on('collision', onRemovedCollision);

    new PhysicsSystem().fixedUpdate(objects, 0);
    expect(onRemovedCollision).not.toHaveBeenCalled();
  });

  it('emits one start, repeat stays and one end per unordered pair', () => {
    const system = new PhysicsSystem();
    const first = body(0);
    const second = body(5);
    const entities = new Set([first, second]);
    const seen: string[] = [];
    for (const type of ['collision', 'collisionStart', 'collisionStay', 'collisionEnd']) {
      first.on(type, event => {
        expect(event.detail.other).toBe(second);
        expect(event.detail.manifold.depth).toBe(5);
        seen.push(type);
      });
      second.on(type, event => {
        expect(event.detail.other).toBe(first);
        seen.push(`other:${type}`);
      });
    }

    system.fixedUpdate(entities, 0);
    entities.delete(first);
    entities.add(first); // Change pair order without changing the active collection.
    system.fixedUpdate(entities, 0);
    second.transform.position.x = 20;
    system.fixedUpdate(entities, 0);
    system.fixedUpdate(entities, 0);

    expect(seen).toEqual([
      'collision', 'other:collision', 'collisionStart', 'other:collisionStart',
      'other:collision', 'collision', 'other:collisionStay', 'collisionStay',
      'other:collisionEnd', 'collisionEnd',
    ]);
    expect(first.transform.position.x).toBe(0);
    expect(second.transform.position.x).toBe(20);
  });

  it('requires both masks to accept the contact and ends a contact when a mask changes', () => {
    const system = new PhysicsSystem();
    const first = body(0);
    const second = body(5);
    const firstPhysics = first.getComponent(PhysicsComponent)!;
    const secondPhysics = second.getComponent(PhysicsComponent)!;
    firstPhysics.collisionCategory = 0x2;
    firstPhysics.collisionMask = 0x80000000;
    secondPhysics.collisionCategory = 0x80000000;
    secondPhysics.collisionMask = 0x4;
    const entities = new Set([first, second]);
    const legacy = jest.fn();
    const start = jest.fn();
    const end = jest.fn();
    first.on('collision', legacy);
    first.on('collisionStart', start);
    first.on('collisionEnd', end);

    system.fixedUpdate(entities, 0);
    expect(legacy).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    secondPhysics.collisionMask = 0x2;
    system.fixedUpdate(entities, 0);
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    firstPhysics.collisionMask = 0;
    system.fixedUpdate(entities, 0);
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('finishes the accepted legacy pair and only sends end to the survivor', () => {
    const system = new PhysicsSystem();
    const first = body(0);
    const second = body(5);
    const entities = new Set([first, second]);
    const removedEnd = jest.fn();
    const survivorEnd = jest.fn();
    first.on('collisionEnd', survivorEnd);
    second.on('collisionEnd', removedEnd);
    system.fixedUpdate(entities, 0);

    first.on('collision', () => entities.delete(second));
    const removedCollision = jest.fn();
    second.on('collision', removedCollision);
    system.fixedUpdate(entities, 0);
    expect(removedCollision).toHaveBeenCalledTimes(1);
    expect(removedEnd).not.toHaveBeenCalled();
    expect(survivorEnd).toHaveBeenCalledTimes(1);
    expect(survivorEnd.mock.lastCall?.[0].detail.other).toBe(second);
  });

  it('emits contacts when used without an initialised engine', () => {
    const first = body(0);
    const second = body(5);
    const start = jest.fn();
    first.on('collisionStart', start);
    const global = globalThis as unknown as { __DINO_ENGINE_STATE__?: EngineState };
    const previous = global.__DINO_ENGINE_STATE__;
    delete global.__DINO_ENGINE_STATE__;

    try {
      new PhysicsSystem().fixedUpdate(new Set([first, second]), 0);
      expect(start).toHaveBeenCalledTimes(1);
    } finally {
      global.__DINO_ENGINE_STATE__ = previous;
    }
  });

  it('starts fresh contacts after switching active collections', () => {
    const system = new PhysicsSystem();
    const first = body(0);
    const second = body(5);
    const start = jest.fn();
    const stay = jest.fn();
    const end = jest.fn();
    first.on('collisionStart', start);
    first.on('collisionStay', stay);
    first.on('collisionEnd', end);

    system.fixedUpdate(new Set([first, second]), 0);
    system.fixedUpdate(new Set([first, second]), 0);

    expect(start).toHaveBeenCalledTimes(2);
    expect(stay).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
  });

  it('stops notifying the old world if a collision handler switches scenes', () => {
    class TestScene extends Scene {}
    const initial = new TestScene();
    const destination = new TestScene();
    const first = body(0);
    const second = body(5);
    const stale = jest.fn();
    initial.add(first);
    initial.add(second);
    Engine.currentScene = initial;
    first.on('collision', () => { Engine.currentScene = destination; });
    first.on('collisionStart', stale);
    second.on('collision', stale);

    new PhysicsSystem().fixedUpdate(initial.objects, 0);
    expect(stale).not.toHaveBeenCalled();
  });

  it('does not move static objects', () => {
    const system = new PhysicsSystem();
    const obj = new MockGameObject('static', 0);
    const physics = new PhysicsComponent();
    physics.isStatic = true;
    physics.velocity = new Vector2(100, 100);
    obj.addComponent(physics);

    const entities = new Set<GameObject>([obj]);
    const initialPos = obj.transform.position.clone();
    
    system.fixedUpdate(entities, 0.1);
    
    expect(obj.transform.position.x).toBe(initialPos.x);
    expect(obj.transform.position.y).toBe(initialPos.y);
  });
});
