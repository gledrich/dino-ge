import Line, { LineProperties } from './Line.js';
import Vector2 from '../math/Vector2.js';
import VisibilityComponent from '../components/VisibilityComponent.js';
import PhysicsComponent from '../components/PhysicsComponent.js';
import LineComponent from '../components/LineComponent.js';
import BoundsComponent from '../components/BoundsComponent.js';
import Engine from '../core/Engine.js';
import Registry from '../core/Registry.js';
import { containsViewportPoint, getViewportGeometry } from '../core/ViewportGeometry.js';

describe('Line', () => {
  const mockProps: LineProperties = {
    p1: new Vector2(10, 10),
    p2: new Vector2(50, 50),
    width: 5,
    tag: 'separator',
    zIndex: 2
  };

  beforeEach(() => {
    Engine.resetState();
    jest.clearAllMocks();
  });

  it('initialises with provided properties', () => {
    const spy = jest.spyOn(Registry, 'registerObject');
    const line = new Line(mockProps);
    
    expect(line.metadata.tag).toBe('separator');
    expect(line.metadata.zIndex).toBe(2);
    expect(line.strokeWidth).toBe(5);
    expect(line.x1).toBe(10);
    expect(line.y1).toBe(10);
    expect(line.x2).toBe(50);
    expect(line.y2).toBe(50);
    
    expect(line.startPosition.x).toBe(10);
    expect(line.startPosition.y).toBe(10);
    
    // Bounds: abs(50-10) = 40
    expect(line.bounds?.width).toBe(40);
    expect(line.bounds?.height).toBe(40);
    
    expect(line.hasComponent(BoundsComponent)).toBe(true);
    expect(line.hasComponent(LineComponent)).toBe(true);
    expect(spy).toHaveBeenCalledWith(line);
  });

  it('initialises with default properties', () => {
    const minProps: LineProperties = {
      p1: new Vector2(0, 0),
      p2: new Vector2(100, 0)
    };
    
    const line = new Line(minProps);
    
    expect(line.metadata.tag).toBe('line');
    expect(line.metadata.zIndex).toBe(0);
    expect(line.strokeWidth).toBe(1);
    expect(line.bounds?.width).toBe(100);
    expect(line.bounds?.height).toBe(0);
    });

  it('initialises with full physics and visibility options', () => {
    const obj = new Line({ 
      p1: new Vector2(), 
      p2: new Vector2(), 
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

  it('picks the rendered stroke after moving and rotating its explicit origin', () => {
    const line = new Line({
      position: new Vector2(120, 50),
      p1: new Vector2(10, 0),
      p2: new Vector2(-20, 0),
      width: 4,
    });
    line.transform.rotation = Math.PI / 2;
    line.transform.scale.set(10, 1);
    const geometry = getViewportGeometry(line);
    expect(containsViewportPoint(line, geometry, 123, 30, 5)).toBe(true);
    expect(containsViewportPoint(line, geometry, 130, 30, 5)).toBe(false);
  });

  it('updates the rendered endpoints, stroke and bounds through the line properties', () => {
    const line = new Line({
      position: new Vector2(120, 50),
      p1: new Vector2(0, 0),
      p2: new Vector2(96, 0),
      width: 4,
    });
    line.x1 = 10;
    line.y1 = -5;
    line.x2 = 140;
    line.y2 = 25;
    line.strokeWidth = 12;
    const segment = line.getComponent(LineComponent)!;
    expect(segment.p1).toEqual(new Vector2(10, -5));
    expect(segment.p2).toEqual(new Vector2(140, 25));
    expect(segment.strokeWidth).toBe(12);
    expect(line.bounds).toMatchObject({ width: 130, height: 30 });
    expect(line.transform.position).toMatchObject({ x: 120, y: 50 });
  });

  it('initialises with isSensor set to true', () => {
    const obj = new Line({ 
      p1: new Vector2(), 
      p2: new Vector2(), 
      physics: { 
        isSensor: true 
      } 
    });
    const pc = obj.getComponent(PhysicsComponent);
    expect(pc?.isSensor).toBe(true);
  });

  it('initialises with partial physics options', () => {
    const obj = new Line({ 
      p1: new Vector2(), 
      p2: new Vector2(), 
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
    const obj = new Line({ 
      p1: new Vector2(), 
      p2: new Vector2(), 
      physics: {} 
    });
    const pc = obj.getComponent(PhysicsComponent);
    expect(pc).toBeDefined();
  });
});
