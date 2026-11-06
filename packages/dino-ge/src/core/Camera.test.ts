import Camera from './Camera.js';
import Vector2 from '../math/Vector2.js';
import GameObject from './GameObject.js';

import BoundsComponent from '../components/BoundsComponent.js';

class MockGameObject extends GameObject {
  constructor(tag: string, zIndex: number) {
    super(tag, zIndex);
    this.bounds = new BoundsComponent(50, 50);
  }
}

describe('Camera', () => {
  it('initialises with default values', () => {
    const camera = new Camera();
    expect(camera.position.x).toBe(0);
    expect(camera.position.y).toBe(0);
    expect(camera.zoom).toBe(1);
  });

  it('follows a target correctly', () => {
    const camera = new Camera();
    const target = new MockGameObject('test', 0);
    target.transform.position = new Vector2(100, 100);
    
    // Viewport 800x600. Target centre is (125, 125).
    // Camera pos should be 125 - 400 = -275, 125 - 300 = -175
    camera.follow(target, 800, 600);
    
    expect(camera.position.x).toBe(-275);
    expect(camera.position.y).toBe(-175);
  });

  it('follows a target without bounds correctly', () => {
    const camera = new Camera();
    class NoBoundsObject extends GameObject {}
    const target = new NoBoundsObject('test', 0);
    target.transform.position = new Vector2(100, 100);
    
    // Viewport 800x600. Target centre is (100, 100) since bounds are 0.
    // Camera pos should be 100 - 400 = -300, 100 - 300 = -200
    camera.follow(target, 800, 600);
    
    expect(camera.position.x).toBe(-300);
    expect(camera.position.y).toBe(-200);
  });

  it('clamps the zoomed viewport to each edge of an offset world', () => {
    const camera = new Camera();
    camera.zoom = 2;
    const target = new MockGameObject('target', 0);
    const world = { x: -100, y: 20, width: 400, height: 300 };

    target.transform.position.set(-100, 20);
    camera.follow(target, 400, 200, world);
    expect(camera.position).toMatchObject({ x: -100, y: 20 });

    target.transform.position.set(250, 270);
    camera.follow(target, 400, 200, world);
    expect(camera.getViewportBounds(400, 200)).toEqual({ x: 100, y: 220, width: 200, height: 100 });

    target.transform.position.set(0, 100);
    camera.follow(target, 400, 200, world);
    expect(camera.position).toMatchObject({ x: -75, y: 75 });
  });

  it('centres an oversized axis independently and recalculates after resizing', () => {
    const camera = new Camera();
    const target = new MockGameObject('target', 0);
    const world = { x: -50, y: 50, width: 200, height: 250 };
    target.transform.position.set(300, 300);

    camera.follow(target, 300, 100, world);
    expect(camera.position).toMatchObject({ x: -100, y: 200 });

    camera.follow(target, 200, 300, world);
    expect(camera.position).toMatchObject({ x: -50, y: 25 });

    camera.follow(target, 200, 300);
    expect(camera.position).toMatchObject({ x: 225, y: 175 });
  });

  it('uses the rendered world centre for bounded follow and keeps legacy local follow', () => {
    const camera = new Camera();
    const parent = new MockGameObject('parent', 0);
    parent.transform.position.set(100, 100);
    parent.transform.scale.set(2, 2);
    const target = new MockGameObject('target', 0);
    target.transform.parent = parent.transform;
    target.transform.position.set(20, 0);
    target.transform.rotation = Math.PI / 2;

    camera.follow(target, 100, 100, { x: -100, y: -100, width: 400, height: 400 });
    expect(camera.position).toMatchObject({ x: 40, y: 100 });

    camera.follow(target, 100, 100);
    expect(camera.position).toMatchObject({ x: -5, y: -25 });
  });

  it('rejects invalid bounded viewports without changing the camera position', () => {
    const camera = new Camera();
    camera.position.set(4, 5);
    const target = new MockGameObject('target', 0);
    const world = { x: 0, y: 0, width: 100, height: 100 };

    expect(() => camera.follow(target, 80, 80, { ...world, width: -1 })).toThrow(RangeError);
    expect(() => camera.follow(target, NaN, 80, world)).toThrow(RangeError);
    camera.zoom = 0;
    expect(() => camera.follow(target, 80, 80, world)).toThrow(RangeError);
    expect(camera.position).toMatchObject({ x: 4, y: 5 });
  });

  it('calculates viewport bounds with zoom', () => {
    const camera = new Camera();
    camera.position = new Vector2(100, 100);
    camera.zoom = 2;
    
    const bounds = camera.getViewportBounds(800, 600);
    expect(bounds.x).toBe(100);
    expect(bounds.width).toBe(400); // 800 / 2
    expect(bounds.height).toBe(300); // 600 / 2
  });

  it('resets correctly', () => {
    const camera = new Camera();
    camera.position = new Vector2(500, 500);
    camera.zoom = 5;
    
    camera.reset();
    expect(camera.position.x).toBe(0);
    expect(camera.zoom).toBe(1);
  });
});
