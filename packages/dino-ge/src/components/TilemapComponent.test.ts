import TilemapComponent from './TilemapComponent.js';
import GameObject from '../core/GameObject.js';

class MockGameObject extends GameObject { }

describe('TilemapComponent', () => {
  const mockTileset = { width: 32, height: 32 } as HTMLImageElement;
  const mockData = [
    [0, 1],
    [-1, 0]
  ];

  it('initialises with provided values', () => {
    const component = new TilemapComponent(mockTileset, mockData, 16, 1);

    expect(component.tileset).toBe(mockTileset);
    expect(component.data).toBe(mockData);
    expect(component.tileSize).toBe(16);
    expect(component.tilesetCols).toBe(1);
  });

  it('draws to the context if gameObject is present', () => {
    const component = new TilemapComponent(mockTileset, mockData, 16, 1);
    const obj = new MockGameObject('test', 0);
    component.gameObject = obj;

    const mockCtx = {
      save: jest.fn(),
      restore: jest.fn(),
      translate: jest.fn(),
      rotate: jest.fn(),
      scale: jest.fn(),
      drawImage: jest.fn()
    } as unknown as CanvasRenderingContext2D;

    component.draw(mockCtx);

    expect(mockCtx.save).toHaveBeenCalled();
    // 3 non-empty tiles in mockData
    expect(mockCtx.drawImage).toHaveBeenCalledTimes(3);
    expect(mockCtx.restore).toHaveBeenCalled();
  });

  it('early returns from draw if no gameObject is attached', () => {
    const component = new TilemapComponent(mockTileset, mockData, 16, 1);
    const mockCtx = {
      save: jest.fn(),
    } as unknown as CanvasRenderingContext2D;

    component.draw(mockCtx);

    expect(mockCtx.save).not.toHaveBeenCalled();
  });

  it('can draw pixel art without changing smoothing for other objects', () => {
    const component = Object.assign(new TilemapComponent(mockTileset, mockData, 16, 1), { imageSmoothing: false });
    component.gameObject = new MockGameObject('test', 0);
    const ctx = {
      imageSmoothingEnabled: true,
      save: jest.fn(),
      restore: jest.fn(() => { ctx.imageSmoothingEnabled = true; }),
      translate: jest.fn(),
      scale: jest.fn(),
      drawImage: jest.fn(() => { expect(ctx.imageSmoothingEnabled).toBe(false); }),
    };

    component.draw(ctx as unknown as CanvasRenderingContext2D);

    expect(ctx.drawImage).toHaveBeenCalledTimes(3);
    expect(ctx.imageSmoothingEnabled).toBe(true);
  });

  it('applies rotation during draw', () => {
    const component = new TilemapComponent(mockTileset, mockData, 16, 1);
    const obj = new MockGameObject('test', 0);
    obj.transform.rotation = Math.PI;
    component.gameObject = obj;

    const mockCtx = {
      save: jest.fn(),
      restore: jest.fn(),
      translate: jest.fn(),
      rotate: jest.fn(),
      scale: jest.fn(),
      drawImage: jest.fn()
    } as unknown as CanvasRenderingContext2D;

    component.draw(mockCtx);

    expect(mockCtx.rotate).toHaveBeenCalledWith(Math.PI);
  });

  it('automatically creates/updates BoundsComponent on GameObject', () => {
    const component = new TilemapComponent(mockTileset, mockData, 16, 1);
    const obj = new MockGameObject('test', 0);
    
    // Initially no bounds
    expect(obj.bounds).toBeUndefined();
    
    obj.addComponent(component);
    
    // Bounds should be created (2x2 tiles, size 16 = 32x32)
    expect(obj.bounds).toBeDefined();
    expect(obj.bounds!.width).toBe(32);
    expect(obj.bounds!.height).toBe(32);
    
    // Manually trigger update logic to test branch where bounds already exist
    (component as unknown as { _updateGameObjectBounds: () => void })._updateGameObjectBounds();
    expect(obj.bounds!.width).toBe(32);
  });

  it('does nothing in _updateGameObjectBounds if unattached', () => {
    const component = new TilemapComponent(mockTileset, mockData, 16, 1);
    expect(() => {
      (component as unknown as { _updateGameObjectBounds: () => void })._updateGameObjectBounds();
    }).not.toThrow();
  });
});
