import Circle from './Circle.js';
import Vector2 from '../math/Vector2.js';
import VisibilityComponent from '../components/VisibilityComponent.js';
import PhysicsComponent from '../components/PhysicsComponent.js';
import ShapeComponent from '../components/ShapeComponent.js';

describe('Circle', () => {
  it('initialises with default values', () => {
    const circle = new Circle({
      position: new Vector2(10, 10),
      radius: 25
    });
    
    expect(circle.transform.position.x).toBe(10);
    expect(circle.radius).toBe(25);
    expect(circle.bounds?.width).toBe(50);
    expect(circle.bounds?.height).toBe(50);
    expect(circle.colour).toBe('black');
    expect(circle.metadata.zIndex).toBe(0);
  });

  it('calculates centre point correctly', () => {
    const circle = new Circle({
      position: new Vector2(10, 10),
      radius: 20
    });
    
    // centre should be (10+20, 10+20) = (30, 30)
    expect(circle.centre.x).toBe(30);
    expect(circle.centre.y).toBe(30);
  });

  it('adds ShapeComponent on creation', () => {
    const circle = new Circle({
      position: new Vector2(0, 0),
      radius: 10
    });
    
    expect(circle.hasComponent(ShapeComponent)).toBe(true);
  });

  it('keeps the public radius and transformed centre in sync with edited bounds', () => {
    const circle = new Circle({ position: new Vector2(20, 30), radius: 10, rotation: Math.PI / 2 });
    circle.transform.scale.set(-2, 3);
    const shape = circle.getComponent(ShapeComponent)!;

    shape.width = 15;
    expect(circle.radius).toBe(15);
    expect(circle.worldRadius).toBe(30);
    expect(circle.centre.x).toBeCloseTo(-25);
    expect(circle.centre.y).toBeCloseTo(0);
    expect(circle.transform.worldPosition).toEqual(new Vector2(20, 30));

    circle.radius = 20;
    expect(shape.width).toBe(20);
    expect(circle.bounds).toMatchObject({ width: 40, height: 40 });
    expect(circle.worldRadius).toBe(40);
  });

  it('throws error if position is not a Vector2', () => {
    expect(() => {
      new Circle({
        position: { x: 0, y: 0 } as unknown as Vector2,
        radius: 10
      });
    }).toThrow('"position" must be a Vector2!');
  });

  it('throws error if radius is missing', () => {
    expect(() => {
      new Circle({
        position: new Vector2(),
        radius: 0
      });
    }).toThrow('You must provide a radius for Circle');
  });

  it('initialises with custom tag and zIndex', () => {
    const circle = new Circle({
      position: new Vector2(),
      radius: 10,
      tag: 'enemy',
      zIndex: 10
    });
    expect(circle.metadata.tag).toBe('enemy');
    expect(circle.metadata.zIndex).toBe(10);
    });

  it('initialises with full physics and visibility options', () => {
    const obj = new Circle({ 
      position: new Vector2(), 
      radius: 10, 
      visible: false, 
      physics: { 
        velocity: new Vector2(1,2), 
        acceleration: new Vector2(3,4), 
        mass: 5, 
        isStatic: true, 
        restitution: 0.5, 
        friction: 0.2 
      } 
    });
    expect(obj.getComponent(VisibilityComponent)?.visible).toBe(false);
    const pc = obj.getComponent(PhysicsComponent);
    expect(pc?.velocity.x).toBe(1);
    expect(pc?.acceleration.x).toBe(3);
    expect(pc?.mass).toBe(5);
    expect(pc?.isStatic).toBe(true);
    expect(pc?.restitution).toBe(0.5);
    expect(pc?.friction).toBe(0.2);
    expect(pc?.isSensor).toBe(false);
  });

  it('initialises with isSensor set to true', () => {
    const obj = new Circle({ 
      position: new Vector2(), 
      radius: 10, 
      physics: { 
        isSensor: true 
      } 
    });
    const pc = obj.getComponent(PhysicsComponent);
    expect(pc?.isSensor).toBe(true);
  });

  it('initialises with partial physics options', () => {
    const obj = new Circle({ 
      position: new Vector2(), 
      radius: 10, 
      physics: { 
        velocity: new Vector2(1,1),
        acceleration: new Vector2(2,2),
        isStatic: true,
        restitution: 0.8,
        friction: 0.1
      } 
    });
    const pc = obj.getComponent(PhysicsComponent);
    expect(pc?.velocity.x).toBe(1);
    expect(pc?.acceleration.x).toBe(2);
    expect(pc?.isStatic).toBe(true);
    expect(pc?.restitution).toBe(0.8);
    expect(pc?.friction).toBe(0.1);
  });

  it('initialises with empty physics object', () => {
    const obj = new Circle({ 
      position: new Vector2(), 
      radius: 10, 
      physics: {} 
    });
    const pc = obj.getComponent(PhysicsComponent);
    expect(pc).toBeDefined();
    expect(pc?.mass).toBe(1); // Default mass
  });
});
