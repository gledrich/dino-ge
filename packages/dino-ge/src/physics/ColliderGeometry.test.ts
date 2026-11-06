import BoundsComponent from '../components/BoundsComponent.js';
import ColliderComponent from '../components/ColliderComponent.js';
import PhysicsComponent from '../components/PhysicsComponent.js';
import TransformComponent from '../components/TransformComponent.js';
import GameObject from '../core/GameObject.js';
import Vector2 from '../math/Vector2.js';
import PhysicsSystem from '../systems/PhysicsSystem.js';
import Physics from './Physics.js';

class Body extends GameObject {}

function rectangle(width = 10, height = 10, x = 0, y = 0) {
  return { kind: 'rectangle' as const, x, y, width, height };
}

function circle(radius: number, x = 0, y = 0) {
  return { kind: 'circle' as const, radius, x, y };
}

describe('explicit colliders', () => {
  it('copies and freezes fixture coordinates supplied by the caller', () => {
    const vertex = new Vector2(0, 0);
    const source = [{ kind: 'polygon' as const, vertices: [vertex, new Vector2(5, 0), new Vector2(0, 5)] }];
    const collider = new ColliderComponent(source);
    vertex.x = 15;
    source.length = 0;

    expect(collider.fixtures).toHaveLength(1);
    const fixture = collider.fixtures[0];
    if (fixture.kind !== 'polygon') throw new Error('Expected polygon');
    expect(fixture.vertices[0].x).toBe(0);
    expect(Object.isFrozen(fixture.vertices[0])).toBe(true);
  });

  it.each([
    [],
    [rectangle(0)],
    [circle(Infinity)],
    [{ kind: 'polygon' as const, vertices: [{ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }, { x: 4, y: 0 }] }],
    [{ kind: 'polygon' as const, vertices: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 1 }, { x: 4, y: 4 }, { x: 0, y: 4 }] }],
  ].map(fixtures => ({ fixtures })))('rejects malformed or non-convex fixtures', ({ fixtures }) => {
    expect(() => new ColliderComponent(fixtures)).toThrow();
  });

  it('uses offset fixtures instead of rendering bounds and collides with an invisible static collider', () => {
    const actor = new Body();
    actor.addComponent(new PhysicsComponent());
    actor.bounds = new BoundsComponent(2, 2);
    actor.addComponent(new ColliderComponent([rectangle(6, 6, 50)]));
    const wall = new Body();
    wall.addComponent(new ColliderComponent([rectangle(6, 6, 54)]));
    const hit = jest.fn();
    wall.on('collisionStart', hit);

    new PhysicsSystem().fixedUpdate(new Set([actor, wall]), 0);

    expect(actor.transform.position.x).toBeCloseTo(-1.592);
    expect(wall.transform.position.x).toBe(0);
    expect(hit).toHaveBeenCalledTimes(1);
  });

  it('detects fractional tangent circles even when their AABB edges round apart', () => {
    const first = new Body();
    first.addComponent(new ColliderComponent([circle(1.1, -8.9)]));
    const second = new Body();
    second.addComponent(new ColliderComponent([circle(0.1, -7.7)]));
    const contacts = jest.fn();
    first.on('collisionStart', contacts);

    new PhysicsSystem().fixedUpdate(new Set([first, second]), 0);
    expect(contacts).toHaveBeenCalledTimes(1);
    expect(contacts.mock.lastCall?.[0].detail.manifold.depth).toBe(0);
  });

  it('distinguishes rotated polygon contact from its enclosing AABB', () => {
    const wall = new Body();
    wall.addComponent(new ColliderComponent([rectangle(10, 2)]));
    wall.transform.rotation = Math.PI / 4;
    const actor = new Body();
    actor.addComponent(new ColliderComponent([circle(0.5)]));
    actor.transform.position.set(6, 0);
    expect(Physics.getCollisionManifold(actor, wall)).toBeNull();
    actor.transform.position.set(2.5, 3);
    expect(Physics.getCollisionManifold(actor, wall)?.depth).toBeGreaterThan(0);
  });

  it('finds an escape distance when a polygon is contained by a rectangle', () => {
    const box = new Body();
    box.addComponent(new ColliderComponent([rectangle(10, 10)]));
    const actor = new Body();
    actor.addComponent(new ColliderComponent([{ kind: 'polygon', vertices: [
      { x: 2, y: 3 }, { x: 4, y: 3 }, { x: 4, y: 5 }, { x: 2, y: 5 },
    ] }]));
    const manifold = Physics.getCollisionManifold(actor, box);
    expect(manifold?.depth).toBeCloseTo(4);
    expect(manifold?.normal).toMatchObject({ x: 1, y: 0 });
  });

  it('chooses the deepest compound contact and emits one event per object pair', () => {
    const actor = new Body();
    const sensor = new PhysicsComponent();
    sensor.isSensor = true;
    actor.addComponent(sensor);
    actor.addComponent(new ColliderComponent([rectangle(6, 6, 52), rectangle(6, 6, 54)]));
    const wall = new Body();
    wall.addComponent(new ColliderComponent([rectangle(6, 6, 54)]));
    const hit = jest.fn();
    actor.on('collisionStart', hit);

    new PhysicsSystem().fixedUpdate(new Set([actor, wall]), 0);

    expect(hit).toHaveBeenCalledTimes(1);
    expect(hit.mock.lastCall?.[0].detail.manifold).toMatchObject({ depth: 6, fixtureIndex1: 1, fixtureIndex2: 0 });
  });

  it('adapts a legacy rectangle as an unrotated AABB in a mixed pair', () => {
    const legacy = new Body();
    legacy.bounds = new BoundsComponent(12, 2);
    legacy.transform.rotation = Math.PI / 2;
    const actor = new Body();
    actor.addComponent(new ColliderComponent([circle(1)]));
    actor.transform.position.set(10, 2);
    const manifold = Physics.getCollisionManifold(legacy, actor);
    expect(manifold?.depth).toBeCloseTo(1);
    expect(manifold?.normal).toMatchObject({ x: 0, y: 1 });
  });

  it('refreshes the quadtree when an earlier event moves an offset fixture', () => {
    const make = (x: number) => {
      const body = new Body();
      body.transform.position.x = x;
      body.addComponent(new ColliderComponent([rectangle(6, 6, 50)]));
      return body;
    };
    const first = make(0);
    const second = make(2);
    const later = make(100);
    const distant = Array.from({ length: 12 }, (_, index) => make(500 + index * 20));
    const seen: GameObject[] = [];
    first.on('collisionStart', event => {
      seen.push(event.detail.other);
      if (event.detail.other === second) later.transform.position.x = 3;
    });

    new PhysicsSystem().fixedUpdate(new Set([first, second, later, ...distant]), 0);

    expect(seen).toEqual([second, later]);
  });

  it('converts correction and bounce through a rotated, mirrored parent', () => {
    const parent = new TransformComponent();
    parent.rotation = Math.PI / 2;
    parent.scale.set(-2, 3);
    const actor = new Body();
    parent.addChild(actor.transform);
    const body = new PhysicsComponent();
    body.velocity.set(-4, 0);
    body.restitution = 1;
    actor.addComponent(body);
    actor.addComponent(new ColliderComponent([circle(1)]));
    const wall = new Body();
    wall.addComponent(new ColliderComponent([circle(1, 0, 3)]));
    expect(Physics.checkCollision(actor, wall)).toBe(true);

    expect(actor.transform.worldPosition.y).toBeCloseTo(-0.792);
    expect(actor.transform.position.x).toBeCloseTo(0.396);
    expect(actor.transform.position.y).toBeCloseTo(0);
    expect(body.velocity.x).toBeCloseTo(4);
    expect(body.velocity.y).toBeCloseTo(0);
  });
});
