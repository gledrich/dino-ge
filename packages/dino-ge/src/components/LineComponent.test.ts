import LineComponent from './LineComponent.js';
import Vector2 from '../math/Vector2.js';
import GameObject from '../core/GameObject.js';

class MockGameObject extends GameObject {}

describe('LineComponent', () => {
  it('initialises with provided values', () => {
    const p1 = new Vector2(0, 0);
    const p2 = new Vector2(100, 100);
    const component = new LineComponent(2, p1, p2);
    
    expect(component.strokeWidth).toBe(2);
    expect(component.p1).toBe(p1);
    expect(component.p2).toBe(p2);
  });

  it('draws to the context if gameObject is present', () => {
    const p1 = new Vector2(0, 0);
    const p2 = new Vector2(10, 10);
    const component = new LineComponent(1, p1, p2);
    const obj = new MockGameObject('test', 0);
    component.gameObject = obj;

    const mockCtx = {
      save: jest.fn(),
      restore: jest.fn(),
      translate: jest.fn(),
      rotate: jest.fn(),
      scale: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      closePath: jest.fn(),
      lineWidth: 0,
      strokeStyle: '#abc123',
    } as unknown as CanvasRenderingContext2D;

    component.draw(mockCtx);

    expect(mockCtx.save).toHaveBeenCalled();
    expect(mockCtx.beginPath).toHaveBeenCalled();
    expect(mockCtx.moveTo).toHaveBeenCalledWith(p1.x, p1.y);
    expect(mockCtx.lineTo).toHaveBeenCalledWith(p2.x, p2.y);
    expect(mockCtx.stroke).toHaveBeenCalled();
    expect(mockCtx.strokeStyle).toBe('#abc123');
    expect(mockCtx.restore).toHaveBeenCalled();

    component.colour = 'rebeccapurple';
    component.draw(mockCtx);
    expect(mockCtx.strokeStyle).toBe('rebeccapurple');
  });

  it('early returns from draw if no gameObject is attached', () => {
    const component = new LineComponent(1, new Vector2(), new Vector2());
    const mockCtx = {
      save: jest.fn(),
    } as unknown as CanvasRenderingContext2D;

    component.draw(mockCtx);

    expect(mockCtx.save).not.toHaveBeenCalled();
  });

  it('applies rotation during draw', () => {
    const component = new LineComponent(1, new Vector2(), new Vector2());
    const obj = new MockGameObject('test', 0);
    obj.transform.rotation = Math.PI / 4;
    component.gameObject = obj;

    const mockCtx = {
      save: jest.fn(),
      restore: jest.fn(),
      translate: jest.fn(),
      rotate: jest.fn(),
      scale: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      closePath: jest.fn(),
      lineWidth: 0
    } as unknown as CanvasRenderingContext2D;

    component.draw(mockCtx);

    expect(mockCtx.rotate).toHaveBeenCalledWith(Math.PI / 4);
  });
});
