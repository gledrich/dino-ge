import RenderingSystem from './RenderingSystem.js';
import GameObject from '../core/GameObject.js';
import RenderComponent from '../components/RenderComponent.js';
import VisibilityComponent from '../components/VisibilityComponent.js';
import Vector2 from '../math/Vector2.js';
import Engine from '../core/Engine.js';
import type { CollisionManifold } from '../physics/Physics.js';

import BoundsComponent from '../components/BoundsComponent.js';
import PhysicsComponent from '../components/PhysicsComponent.js';

class MockGameObject extends GameObject {
  constructor(tag: string, zIndex: number, width: number = 10, height: number = 10) {
    super(tag, zIndex);
    this.bounds = new BoundsComponent(width, height);
  }
}

class MockRenderComponent extends RenderComponent {
  draw = jest.fn();
}

describe('RenderingSystem', () => {
  let mockCtx: CanvasRenderingContext2D;

  beforeEach(() => {
    Engine.resetState();
    Engine.camera.zoom = 1;
    Engine.camera.position = new Vector2(0, 0);
    
    mockCtx = {
      save: jest.fn(),
      restore: jest.fn(),
      scale: jest.fn(),
      translate: jest.fn(),
      rotate: jest.fn(),
      fillRect: jest.fn(),
      strokeRect: jest.fn(),
      fillText: jest.fn(),
      beginPath: jest.fn(),
      stroke: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      arc: jest.fn(),
      fill: jest.fn(),
      setLineDash: jest.fn(),
      canvas: { width: 800, height: 600 },
      strokeStyle: '',
      fillStyle: '',
      font: '',
      lineWidth: 0,
      globalAlpha: 1
    } as unknown as CanvasRenderingContext2D;
    jest.clearAllMocks();
  });

  it('sorts entities by zIndex and draws them', () => {
    const system = new RenderingSystem(mockCtx);
    
    const obj1 = new MockGameObject('top', 10);
    const render1 = new MockRenderComponent();
    obj1.addComponent(render1);
    
    const obj2 = new MockGameObject('bottom', 0);
    const render2 = new MockRenderComponent();
    obj2.addComponent(render2);

    const entities = new Set<GameObject>([obj1, obj2]);
    Engine.zOrderDirty = true;
    system.update(entities);

    expect(render2.draw).toHaveBeenCalled();
    expect(render1.draw).toHaveBeenCalled();
    
    // Check call order - render2 (zIndex 0) should be called before render1 (zIndex 10)
    const order1 = (render1.draw as jest.Mock).mock.invocationCallOrder[0];
    const order2 = (render2.draw as jest.Mock).mock.invocationCallOrder[0];
    expect(order2).toBeLessThan(order1);
  });

  it('respects VisibilityComponent', () => {
    const system = new RenderingSystem(mockCtx);
    const obj = new MockGameObject('test', 0);
    const render = new MockRenderComponent();
    const visibility = new VisibilityComponent();
    visibility.visible = false;
    
    obj.addComponent(render);
    obj.addComponent(visibility);

    Engine.zOrderDirty = true;
    system.update(new Set([obj]));
    expect(render.draw).not.toHaveBeenCalled();
  });

  it('multiplies opacity for one object without changing the next draw', () => {
    const system = new RenderingSystem(mockCtx);
    const first = new MockGameObject('faded', 0);
    const second = new MockGameObject('opaque', 1);
    const visibility = new VisibilityComponent();
    visibility.opacity = 0.5;
    first.addComponent(visibility);
    const drawnAlpha: number[] = [];
    for (const object of [first, second]) {
      const render = new MockRenderComponent();
      render.draw.mockImplementation(ctx => drawnAlpha.push(ctx.globalAlpha));
      object.addComponent(render);
    }

    mockCtx.globalAlpha = 0.8;
    system.update(new Set([first, second]));

    expect(drawnAlpha).toEqual([0.4, 0.8]);
  });

  it('performs frustum culling', () => {
    const system = new RenderingSystem(mockCtx);
    
    // Object way off screen
    const obj = new MockGameObject('offscreen', 0);
    obj.transform.position = new Vector2(1000, 1000);
    const render = new MockRenderComponent();
    obj.addComponent(render);

    Engine.zOrderDirty = true;
    system.update(new Set([obj]));
    expect(render.draw).not.toHaveBeenCalled();
  });

  it('draws a rotated selection that extends into view from an offscreen origin', () => {
    const system = new RenderingSystem(mockCtx);
    const object = new MockGameObject('rotated', 0, 30, 40);
    object.transform.position.set(810, 100);
    object.transform.rotation = Math.PI / 2;
    const render = new MockRenderComponent();
    object.addComponent(render);
    Engine.selectedObject = object;

    system.update(new Set([object]), 0, true);

    expect(render.draw).toHaveBeenCalled();
    expect(mockCtx.rotate).toHaveBeenCalledWith(Math.PI / 2);
    expect(mockCtx.strokeRect).toHaveBeenCalledWith(0, 0, 30, 40);
    expect(mockCtx.fillRect).toHaveBeenCalledWith(766, 126, 8, 8);
  });

  it('sets a new rendering context', () => {
    const system = new RenderingSystem(mockCtx);
    const newCtx = { 
      save: jest.fn(),
      restore: jest.fn(),
      scale: jest.fn(),
      translate: jest.fn(),
      canvas: { width: 100, height: 100 } 
    } as unknown as CanvasRenderingContext2D;
    system.setContext(newCtx);
    
    const entities = new Set<GameObject>();
    Engine.zOrderDirty = true;
    system.update(entities);
    expect(newCtx.save).toHaveBeenCalled();
  });

  it('draws debug overlays including selected object and missing tags', () => {
    const system = new RenderingSystem(mockCtx);
    
    const obj1 = new MockGameObject('test-tag', 0, 50, 50);
    const obj2 = new MockGameObject('', 1, 50, 50); // No tag
    obj2.transform.rotation = Math.PI / 4;
    
    Engine.selectedObject = obj1;
    Engine.debug = true;
    
    const debugCtx = {
      ...mockCtx,
      save: jest.fn(),
      restore: jest.fn(),
      strokeRect: jest.fn(),
      fillRect: jest.fn(),
      fillText: jest.fn(),
      strokeStyle: '',
      lineWidth: 0,
      font: '',
      fillStyle: ''
    } as unknown as CanvasRenderingContext2D;
    system.setContext(debugCtx);

    const entities = new Set([obj1, obj2]);
    Engine.zOrderDirty = true;
    system.update(entities, 0.016, true);

    expect(debugCtx.strokeRect).toHaveBeenCalledTimes(3);
    expect(debugCtx.rotate).toHaveBeenCalledWith(Math.PI / 4);
    // Selected object (obj1) check is done via style change
    expect(debugCtx.fillText).toHaveBeenCalledWith('test-tag', 0, -5);
    expect(debugCtx.fillText).toHaveBeenCalledWith('obj', 0, -5); // obj2 default tag
  });

  it('draws physics vectors (velocity and acceleration) in debug mode', () => {
    const system = new RenderingSystem(mockCtx);
    
    // Case 1: Velocity x only, Acceleration y only
    const obj1 = new MockGameObject('physics-obj-1', 0, 50, 50);
    const phys1 = new PhysicsComponent();
    phys1.velocity = new Vector2(100, 0);
    phys1.acceleration = new Vector2(0, 50);
    obj1.addComponent(phys1);

    // Case 2: Velocity y only, Acceleration x only
    const obj2 = new MockGameObject('physics-obj-2', 1, 50, 50);
    const phys2 = new PhysicsComponent();
    phys2.velocity = new Vector2(0, 100);
    phys2.acceleration = new Vector2(50, 0);
    obj2.addComponent(phys2);

    // Case 3: Zero vectors (should not draw)
    const obj3 = new MockGameObject('physics-obj-3', 2, 50, 50);
    const phys3 = new PhysicsComponent();
    obj3.addComponent(phys3);

    const debugCtx = {
      ...mockCtx,
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      save: jest.fn(),
      restore: jest.fn(),
      strokeRect: jest.fn(),
      fillRect: jest.fn(),
      fillText: jest.fn(),
      strokeStyle: '',
      lineWidth: 0,
      font: '',
      fillStyle: ''
    } as unknown as CanvasRenderingContext2D;
    system.setContext(debugCtx);

    const entities = new Set([obj1, obj2, obj3]);
    Engine.debug = true;
    Engine.showPhysicsVectors = true;
    Engine.zOrderDirty = true;
    system.update(entities, 0.016, true);

    // Each non-zero vector (4 total: phys1 vel/acc, phys2 vel/acc) should call beginPath/stroke
    expect(debugCtx.beginPath).toHaveBeenCalledTimes(4);
    expect(debugCtx.stroke).toHaveBeenCalledTimes(4);
    
    // Check if moveTo was called at object centre
    expect(debugCtx.moveTo).toHaveBeenCalledWith(25, 25);
  });

  it('draws collision debug indicators', () => {
    const system = new RenderingSystem(mockCtx);
    const obj1 = new MockGameObject('obj1', 0);
    const obj2 = new MockGameObject('obj2', 0);
    
    // Mock a collision manifold
    const manifold: CollisionManifold = {
      obj1,
      obj2,
      normal: new Vector2(1, 0),
      depth: 10
    };
    
    Engine.debugCollisions = [{
      manifold,
      timestamp: Date.now()
    }];

    const debugCtx = {
      ...mockCtx,
      save: jest.fn(),
      restore: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      fill: jest.fn(),
      arc: jest.fn(),
      strokeRect: jest.fn(),
      fillText: jest.fn(),
      strokeStyle: '',
      lineWidth: 0,
      globalAlpha: 1
    } as unknown as CanvasRenderingContext2D;
    system.setContext(debugCtx);

    Engine.debug = true;
    Engine.showCollisionLines = true;
    Engine.zOrderDirty = true;
    system.update(new Set(), 0.016, true);

    // Should draw dot and normal line
    expect(debugCtx.beginPath).toHaveBeenCalled();
    expect(debugCtx.arc).toHaveBeenCalled();
    expect(debugCtx.stroke).toHaveBeenCalled();
    expect(debugCtx.fill).toHaveBeenCalled();
    
    // Verify cleanup
    Engine.debugCollisions[0].timestamp = Date.now() - 1000; // Over TTL
    Engine.zOrderDirty = true;
    system.update(new Set(), 0.016, true);
    expect(Engine.debugCollisions.length).toBe(0);
  });

  it('draws dashed debug box for sensor objects', () => {
    const system = new RenderingSystem(mockCtx);
    const obj = new MockGameObject('sensor', 0);
    const phys = new PhysicsComponent();
    phys.isSensor = true;
    obj.addComponent(phys);

    const debugCtx = {
      ...mockCtx,
      save: jest.fn(),
      restore: jest.fn(),
      setLineDash: jest.fn(),
      strokeRect: jest.fn(),
      fillText: jest.fn(),
      strokeStyle: '',
      lineWidth: 0,
      font: '',
      fillStyle: ''
    } as unknown as CanvasRenderingContext2D;
    system.setContext(debugCtx);

    const entities = new Set([obj]);
    Engine.debug = true;
    Engine.zOrderDirty = true;
    system.update(entities, 0.016, true);

    expect(debugCtx.setLineDash).toHaveBeenCalledWith([5, 5]);
    expect(debugCtx.setLineDash).toHaveBeenCalledWith([]);
  });

  it('respects showPhysicsVectors flag', () => {
    const system = new RenderingSystem(mockCtx);
    const obj = new MockGameObject('physics-obj', 0, 50, 50);
    const phys = new PhysicsComponent();
    phys.velocity = new Vector2(100, 0);
    obj.addComponent(phys);

    const debugCtx = {
      ...mockCtx,
      beginPath: jest.fn(),
      stroke: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      save: jest.fn(),
      restore: jest.fn(),
      strokeRect: jest.fn(),
      fillRect: jest.fn(),
      fillText: jest.fn(),
    } as unknown as CanvasRenderingContext2D;
    system.setContext(debugCtx);

    // When true
    Engine.debug = true;
    Engine.showPhysicsVectors = true;
    Engine.zOrderDirty = true;
    system.update(new Set([obj]), 0.016, true);
    expect(debugCtx.beginPath).toHaveBeenCalled();

    // When false
    jest.clearAllMocks();
    Engine.showPhysicsVectors = false;
    Engine.zOrderDirty = true;
    system.update(new Set([obj]), 0.016, true);
    expect(debugCtx.beginPath).not.toHaveBeenCalled();
    
    Engine.showPhysicsVectors = true; // reset
  });

  it('respects showCollisionLines flag', () => {
    const system = new RenderingSystem(mockCtx);
    const manifold: CollisionManifold = { 
      obj1: new MockGameObject('o1', 0), 
      obj2: new MockGameObject('o2', 0), 
      normal: new Vector2(1, 0), 
      depth: 10 
    };
    
    Engine.debugCollisions = [{
      manifold,
      timestamp: Date.now()
    }];

    const debugCtx = {
      ...mockCtx,
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      fill: jest.fn(),
      arc: jest.fn(),
      save: jest.fn(),
      restore: jest.fn(),
      strokeRect: jest.fn(),
      fillText: jest.fn(),
    } as unknown as CanvasRenderingContext2D;
    system.setContext(debugCtx);

    // When true
    Engine.debug = true;
    Engine.showCollisionLines = true;
    Engine.zOrderDirty = true;
    system.update(new Set(), 0.016, true);
    expect(debugCtx.beginPath).toHaveBeenCalled();

    // When false
    jest.clearAllMocks();
    Engine.showCollisionLines = false;
    Engine.zOrderDirty = true;
    system.update(new Set(), 0.016, true);
    expect(debugCtx.beginPath).not.toHaveBeenCalled();

    Engine.showCollisionLines = true; // reset
  });

  it('handles objects without bounds during update', () => {
    const system = new RenderingSystem(mockCtx);
    class NoBoundsObject extends GameObject {}
    const obj = new NoBoundsObject('test', 0);
    // Place it inside viewport bounds so it passes frustum culling even with 0 width/height
    obj.transform.position = new Vector2(1, 1);
    
    const render = new MockRenderComponent();
    obj.addComponent(render);

    Engine.zOrderDirty = true;
    system.update(new Set([obj]));
    expect(render.draw).toHaveBeenCalled();
  });

  it('early returns from update if state is missing', () => {
    const system = new RenderingSystem(mockCtx);
    
    const g = globalThis as unknown as Record<string, unknown>;
    const originalState = g.__DINO_ENGINE_STATE__;
    delete g.__DINO_ENGINE_STATE__;
    
    // Should not throw
    system.update(new Set());
    
    g.__DINO_ENGINE_STATE__ = originalState;
  });
});
