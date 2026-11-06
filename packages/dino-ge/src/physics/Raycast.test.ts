import ColliderComponent from '../components/ColliderComponent.js';
import PhysicsComponent from '../components/PhysicsComponent.js';
import GameObject from '../core/GameObject.js';
import Engine from '../core/Engine.js';
import Scene from '../core/Scene.js';
import Vector2 from '../math/Vector2.js';
import Rectangle from '../objects/Rectangle.js';
import Physics from './Physics.js';

class Body extends GameObject {}

function compound(...xs: number[]) {
  const body = new Body();
  body.addComponent(new ColliderComponent(xs.map(x => ({ kind: 'circle', x, radius: 1 }))));
  return body;
}

describe('physics raycasts', () => {
  afterEach(() => Engine.resetState());

  it('returns the first hit and orders all hits by distance and fixture order', () => {
    const farther = compound(7);
    const nearer = compound(4, 4, 5);
    const objects = [farther, nearer];
    const origin = new Vector2(0, 0);
    const end = new Vector2(10, 0);
    const hits = Physics.raycastAll(origin, end, { objects });

    expect(hits.map(({ object, fixtureIndex, distance }) => [object, fixtureIndex, distance])).toEqual([
      [nearer, 0, 3], [nearer, 1, 3], [nearer, 2, 4], [farther, 0, 6],
    ]);
    expect(Physics.raycast(origin, end, { objects })).toEqual(hits[0]);
    expect(hits[0].point).toMatchObject({ x: 3, y: 0 });
    expect(hits[0].normal).toMatchObject({ x: -1, y: 0 });
    expect(hits[0].fraction).toBeCloseTo(0.3);
  });

  it('finds the outward exit normal from inside a mirrored and rotated polygon', () => {
    const body = new Body();
    body.transform.position.set(10, 0);
    body.transform.rotation = Math.PI / 2;
    body.transform.scale.set(-1, 1);
    body.addComponent(new ColliderComponent([{ kind: 'rectangle', width: 4, height: 2 }]));

    const hit = Physics.raycast(new Vector2(9, -2), new Vector2(6, -2), { objects: [body] });
    expect(hit?.distance).toBeCloseTo(1);
    expect(hit?.point.x).toBeCloseTo(8);
    expect(hit?.normal.x).toBeCloseTo(-1);
    expect(hit?.normal.y).toBeCloseTo(0);
    expect(Physics.raycast(new Vector2(9, -2), new Vector2(8.5, -2), { objects: [body] })).toBeNull();
  });

  it('includes tangencies and accepts hits exactly at the segment endpoint', () => {
    const body = compound(4);
    const hit = Physics.raycast(new Vector2(0, 1), new Vector2(4, 1), { objects: [body] });
    expect(hit?.fraction).toBe(1);
    expect(hit?.normal).toMatchObject({ x: 0, y: 1 });
  });

  it('accepts diagonal hits exactly at the polygon or circle segment endpoint', () => {
    const rectangle = new Body();
    rectangle.addComponent(new ColliderComponent([{ kind: 'rectangle', x: 2, y: 2, width: 2, height: 2 }]));
    const circle = compound(1);
    circle.transform.position.y = 5;
    const origin = new Vector2(0, 0);

    expect(Physics.raycast(origin, new Vector2(2, 3), { objects: [rectangle] })?.fraction).toBe(1);
    expect(Physics.raycast(origin, new Vector2(1, 4), { objects: [circle] })?.fraction).toBe(1);
  });

  it('filters by the same mutual category bits, sensors, and an ignored body', () => {
    const sensor = compound(2);
    const sensorPhysics = new PhysicsComponent();
    sensorPhysics.isSensor = true;
    sensorPhysics.collisionCategory = 4;
    sensor.addComponent(sensorPhysics);
    const solid = compound(4);
    const solidPhysics = new PhysicsComponent();
    solidPhysics.collisionCategory = 4;
    solidPhysics.collisionMask = 2;
    solid.addComponent(solidPhysics);
    const objects = [sensor, solid];
    const origin = new Vector2(0, 0);
    const end = new Vector2(10, 0);

    expect(Physics.raycast(origin, end, { objects, mask: 4, category: 2 })?.object).toBe(solid);
    expect(Physics.raycast(origin, end, { objects, mask: 4, category: 2, includeSensors: true })?.object).toBe(sensor);
    expect(Physics.raycast(origin, end, { objects, mask: 4, category: 1 })).toBeNull();
    expect(Physics.raycast(origin, end, { objects, mask: 1 })).toBeNull();
    expect(Physics.raycast(origin, end, { objects, ignore: solid })).toBeNull();
  });

  it('queries only the active collection and reads moves made after physics', () => {
    Engine.resetState();
    const first = new class extends Scene {}();
    const second = new class extends Scene {}();
    const legacy = new Rectangle({
      position: new Vector2(3, -1), width: 2, height: 2, colour: 'red', physics: { isStatic: true },
    });
    const other = compound(7);
    first.add(legacy);
    second.add(other);
    const origin = new Vector2(0, 0);
    const end = new Vector2(10, 0);

    Engine.currentScene = first;
    expect(Physics.raycast(origin, end)?.object).toBe(legacy);
    legacy.transform.position.x = 12;
    expect(Physics.raycast(origin, end)).toBeNull();
    Engine.currentScene = second;
    expect(Physics.raycast(origin, end)?.object).toBe(other);
  });

  it('returns no hits for zero-length or non-finite segments', () => {
    const objects = [compound(2)];
    expect(Physics.raycast(new Vector2(0, 0), new Vector2(0, 0), { objects })).toBeNull();
    expect(Physics.raycastAll(new Vector2(NaN, 0), new Vector2(10, 0), { objects })).toEqual([]);
  });
});
