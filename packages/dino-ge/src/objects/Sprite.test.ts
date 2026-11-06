import Sprite, { type SpriteProps } from './Sprite.js';
import Vector2 from '../math/Vector2.js';
import VisibilityComponent from '../components/VisibilityComponent.js';
import PhysicsComponent from '../components/PhysicsComponent.js';
import Engine from '../core/Engine.js';
import SpriteComponent from '../components/SpriteComponent.js';
import BoundsComponent from '../components/BoundsComponent.js';

jest.mock('../core/Loader.js', () => {
  const mockImg = { 
    width: 100, 
    height: 100, 
    complete: true,
    addEventListener: jest.fn()
  } as unknown as HTMLImageElement;
  return {
    __esModule: true,
    default: {
      getImage: jest.fn(() => mockImg)
    }
  };
});

jest.mock('../core/Engine.js', () => ({
  __esModule: true,
  default: {
    registerObject: jest.fn(),
    destroyObject: jest.fn()
  }
}));

describe('Sprite', () => {
  const mockProps = {
    tag: 'player',
    img: 'dino',
    rows: 1,
    cols: 10,
    position: new Vector2(0, 0),
    startCol: 0,
    endCol: 5
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('initialises correctly', () => {
    const sprite = new Sprite(mockProps);
    expect(sprite.metadata.tag).toBe('player');
    expect(sprite.rows).toBe(1);
    expect(sprite.cols).toBe(10);
    expect(sprite.hasComponent(SpriteComponent)).toBe(true);
  });

  it('synchronises properties with SpriteComponent', () => {
    const sprite = new Sprite(mockProps);
    sprite.flip = true;
    expect(sprite.flip).toBe(true);
    expect(sprite.getComponent(SpriteComponent)!.flip).toBe(true);
    
    sprite.currentFrame = 3;
    expect(sprite.currentFrame).toBe(3);
    expect(sprite.getComponent(SpriteComponent)!.currentFrame).toBe(3);
  });

  it('handles missing bounds during frame update for coverage', () => {
    const sprite = new Sprite(mockProps);
    sprite.removeComponent(BoundsComponent);

    // Setting currentFrame calls _updateBounds
    sprite.currentFrame = 1;
    expect(sprite.bounds).toBeUndefined();
  });

  it('handles missing optional props in constructor for coverage', () => {
    const minProps = {
      tag: 'min',
      img: 'dino',
      rows: 1,
      cols: 10
    };
    const sprite = new Sprite(minProps);
    expect(sprite.startCol).toBe(0);
    expect(sprite.endCol).toBe(9);
    expect(sprite.transform.position.x).toBe(0);
  });

  it('registers with engine on play', () => {
    const sprite = new Sprite(mockProps);
    sprite.play();
    expect(Engine.registerObject).toHaveBeenCalledWith(sprite);
    expect(sprite.registered).toBe(true);
  });

  it('destroys from engine on stop', () => {
    const sprite = new Sprite(mockProps);
    sprite.play();
    sprite.stop();
    expect(Engine.destroyObject).toHaveBeenCalledWith(sprite);
  });

  it('throws error if tag is missing', () => {
    expect(() => {
      new Sprite({ ...mockProps, tag: '' });
    }).toThrow('You must provide a tag for a Sprite');
  });

  it('initialises with default zIndex if not provided', () => {
    const sprite = new Sprite(mockProps);
    expect(sprite.metadata.zIndex).toBe(1);
  });

  it('initialises with custom zIndex if provided', () => {
    const sprite = new Sprite({ ...mockProps, zIndex: 10 });
    expect(sprite.metadata.zIndex).toBe(10);
  });

  it('accepts HTMLImageElement directly', () => {
    const img = { 
      width: 100, 
      height: 100, 
      complete: true, 
      addEventListener: jest.fn() 
    } as unknown as HTMLImageElement;
    const sprite = new Sprite({ ...mockProps, img });
    expect(sprite.img).toBe(img);
  });

  it('provides access to all SpriteComponent properties via getters and setters', () => {
    const sprite = new Sprite(mockProps);
    const newImg = { width: 50, height: 50, complete: true } as HTMLImageElement;
    
    sprite.img = newImg;
    expect(sprite.img).toBe(newImg);
    expect(sprite.bounds).toMatchObject({ width: 5, height: 50 });
    
    sprite.rows = 2;
    expect(sprite.rows).toBe(2);
    
    sprite.cols = 5;
    expect(sprite.cols).toBe(5);
    
    sprite.startCol = 1;
    expect(sprite.startCol).toBe(1);
    
    sprite.endCol = 4;
    expect(sprite.endCol).toBe(4);
    
    sprite.frameDuration = 200;
    expect(sprite.frameDuration).toBe(200);
    
    expect(sprite.frameWidth).toBeDefined();
    expect(sprite.frameHeight).toBeDefined();
    
    expect(sprite.flip).toBe(false);
    sprite.flip = true;
    expect(sprite.flip).toBe(true);
  });

  it('does not re-register if already registered on play', () => {
    const sprite = new Sprite(mockProps);
    sprite.play();
    expect(Engine.registerObject).toHaveBeenCalledTimes(1);
    
    sprite.play();
    expect(Engine.registerObject).toHaveBeenCalledTimes(1);
  });

  it('handles scale and bounds correctly', () => {
    const sprite = new Sprite({ ...mockProps, scale: 2 });
    expect(sprite.transform.scale.x).toBe(2);
    expect(sprite.transform.scale.y).toBe(2);
    // Bounds width is now BASE local width (10). 
    expect(sprite.bounds!.width).toBe(10);
    expect(sprite.bounds!.height).toBe(100);
  });

  it('defaults scale to 1 and calculates bounds', () => {
    const sprite = new Sprite(mockProps);
    expect(sprite.transform.scale.x).toBe(1);
    expect(sprite.bounds!.width).toBe(10);
    expect(sprite.bounds!.height).toBe(100);
  });

  it('updates transform scale when scale is changed via setter', () => {
    const sprite = new Sprite(mockProps);
    sprite.scale = 5;
    expect(sprite.transform.scale.x).toBe(5);
    // Bounds remain base size
    expect(sprite.bounds!.width).toBe(10);
    expect(sprite.bounds!.height).toBe(100);
  });

  it('handles Vector2 scale in setter', () => {
    const sprite = new Sprite(mockProps);
    sprite.scale = new Vector2(2, 3);
    expect(sprite.scale.x).toBe(2);
    expect(sprite.scale.y).toBe(3);
    expect(sprite.transform.scale.x).toBe(2);
    expect(sprite.transform.scale.y).toBe(3);
    expect(sprite.bounds!.width).toBe(10);
    expect(sprite.bounds!.height).toBe(100);
  });

  it('handles scale as Vector2 in constructor', () => {
    const sprite = new Sprite({ ...mockProps, scale: new Vector2(4, 5) });
    expect(sprite.transform.scale.x).toBe(4);
    expect(sprite.transform.scale.y).toBe(5);
    expect(sprite.bounds!.width).toBe(10);
    expect(sprite.bounds!.height).toBe(100);
  });

  it('updates bounds when image finishes loading', () => {
    const imgMock = { 
      width: 0, 
      height: 0, 
      complete: false, 
      addEventListener: jest.fn() 
    };
    const img = imgMock as unknown as HTMLImageElement;
    
    const sprite = new Sprite({ ...mockProps, img });
    
    // Simulate image load
    // The first listener is from SpriteComponent constructor
    // The second listener is from Sprite constructor
    expect(img.addEventListener).toHaveBeenCalledTimes(2);
    
    imgMock.width = 200;
    imgMock.height = 100;
    
    const componentLoadHandler = (img.addEventListener as jest.Mock).mock.calls[0][1];
    const spriteLoadHandler = (img.addEventListener as jest.Mock).mock.calls[1][1];
    
    componentLoadHandler();
    spriteLoadHandler();
    
    // frameWidth = 200 / 10 = 20
    // frameHeight = 100 / 1 = 100
    expect(sprite.bounds!.width).toBe(20);
    expect(sprite.bounds!.height).toBe(100);
  });

  it('does nothing in _updateBounds if bounds is missing', () => {
    const sprite = new Sprite(mockProps);
    delete (sprite as unknown as { bounds?: unknown }).bounds;
    expect(() => {
      (sprite as unknown as { _updateBounds: () => void })._updateBounds();
    }).not.toThrow();
  });

  it('manually calling _updateBounds with existing bounds', () => {
    const sprite = new Sprite(mockProps);
    (sprite as unknown as { _updateBounds: () => void })._updateBounds();
    expect(sprite.bounds!.width).toBe(10);
    });

  it('initialises with full physics and visibility options', () => {
    const obj = new Sprite({ 
      tag: "test", 
      img: "dino", 
      rows: 1, 
      cols: 10, 
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
    const obj = new Sprite({ 
      tag: "test", 
      img: "dino", 
      rows: 1, 
      cols: 10, 
      physics: { 
        isSensor: true 
      } 
    });
    const pc = obj.getComponent(PhysicsComponent);
    expect(pc?.isSensor).toBe(true);
  });

  it('initialises with partial physics options', () => {
    const obj = new Sprite({ 
      tag: "test", 
      img: "dino", 
      rows: 1, 
      cols: 10, 
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
    const obj = new Sprite({ 
      tag: "test", 
      img: "dino", 
      rows: 1, 
      cols: 10, 
      physics: {} 
    });
    const pc = obj.getComponent(PhysicsComponent);
    expect(pc).toBeDefined();
  });
});

describe('named sprite animations', () => {
  const rect = { x: 43, y: 2, width: 13, height: 17 };
  const animations = {
    walk: { frames: [
      { frame: 7, durationMs: 80 },
      { frame: rect, durationMs: 160 },
      { frame: 2, durationMs: 100 },
    ] },
    idle: { frames: [{ frame: 4, durationMs: 100 }] },
  };

  function createSprite(
    clips: SpriteProps['animations'] = animations, displaySize?: SpriteProps['displaySize'],
  ) {
    const img = { width: 100, height: 80, complete: true } as HTMLImageElement;
    const props = { tag: 'animated', img, rows: 2, cols: 5, animations: clips, displaySize };
    const sprite = new Sprite(props);
    const component = sprite.getComponent(SpriteComponent)!;
    const drawImage = jest.fn();
    const ctx = {
      save: jest.fn(), restore: jest.fn(), translate: jest.fn(),
      scale: jest.fn(), drawImage,
    } as unknown as CanvasRenderingContext2D;
    const crop = () => {
      component.draw(ctx);
      return drawImage.mock.lastCall?.slice(1);
    };
    return { sprite, component, crop };
  }

  it('renders arbitrary grid and atlas frames with stable display dimensions', () => {
    const { sprite, component, crop } = createSprite();
    sprite.playAnimation('walk');
    expect(crop()).toEqual([40, 40, 20, 40, 0, 0, 20, 40]);
    component.advanceAnimation(0.08);
    expect(crop()).toEqual([43, 2, 13, 17, 0, 0, 20, 40]);
    expect(sprite.bounds).toMatchObject({ width: 20, height: 40 });
    component.advanceAnimation(0.27);
    expect(crop()).toEqual([40, 40, 20, 40, 0, 0, 20, 40]);
  });

  it('holds the final frame for its full duration and completes once', () => {
    const { sprite, component, crop } = createSprite();
    const onComplete = jest.fn();
    sprite.playAnimation('walk', { mode: 'once', onComplete });
    component.advanceAnimation(0.3);
    expect(crop()).toEqual([40, 0, 20, 40, 0, 0, 20, 40]);
    expect(onComplete).not.toHaveBeenCalled();
    component.advanceAnimation(0.04);
    component.advanceAnimation(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(crop()).toEqual([40, 0, 20, 40, 0, 0, 20, 40]);
    expect(sprite.registered).toBe(true);
  });

  it('reverses without duplicating ping-pong endpoints', () => {
    const { sprite, component } = createSprite();
    sprite.playAnimation('walk', { mode: 'pingPong' });
    expect(sprite.currentAnimationFrame).toBe(0);
    for (const [delta, frame] of [[0.08, 1], [0.16, 2], [0.1, 1], [0.16, 0]]) {
      component.advanceAnimation(delta);
      expect(sprite.currentAnimationFrame).toBe(frame);
    }
  });

  it('resumes an idempotent request and allows explicit restart and switching', () => {
    const { sprite, component } = createSprite();
    const play = (name: string, options?: { restart: boolean }) =>
      sprite.playAnimation(name, options);
    play('walk');
    component.advanceAnimation(0.05);
    sprite.pauseAnimation();
    component.advanceAnimation(1);
    play('walk');
    component.advanceAnimation(0.03);
    expect(sprite.currentAnimationFrame).toBe(1);
    play('walk', { restart: true });
    expect(sprite.currentAnimationFrame).toBe(0);
    play('idle');
    expect(sprite.currentAnimation).toBe('idle');
    expect(() => play('absent')).toThrow();
    expect(sprite.currentAnimation).toBe('idle');
  });

  it('does not replay a completed one-shot clip until explicitly restarted', () => {
    const { sprite, component } = createSprite();
    const onComplete = jest.fn();
    sprite.playAnimation('walk', { mode: 'once', onComplete });
    component.advanceAnimation(0.34);
    sprite.playAnimation('walk', { mode: 'once', onComplete });
    component.advanceAnimation(0.34);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(sprite.currentAnimationFrame).toBe(2);
    sprite.playAnimation('walk', { restart: true, onComplete });
    expect(sprite.currentAnimationFrame).toBe(0);
    component.advanceAnimation(0.34);
    expect(onComplete).toHaveBeenCalledTimes(2);
  });

  it('crosses a 200ms frame boundary after twelve sixtieth-second steps', () => {
    const { sprite, component } = createSprite({
      walk: { frames: [{ frame: 0, durationMs: 200 }, { frame: 1, durationMs: 200 }] },
    });
    sprite.playAnimation('walk');
    for (let step = 0; step < 12; step++) component.advanceAnimation(1 / 60);
    expect(sprite.currentAnimationFrame).toBe(1);
  });

  it('keeps the selected mode when explicitly restarting the same clip', () => {
    const { sprite, component } = createSprite();
    sprite.playAnimation('walk', { mode: 'once' });
    sprite.playAnimation('walk', { restart: true });
    component.advanceAnimation(0.5);
    expect(sprite.currentAnimationFrame).toBe(2);
    expect(sprite.animationPlaying).toBe(false);
  });

  it('holds a stopped pose until playing again or choosing a manual frame', () => {
    const { sprite, component, crop } = createSprite();
    sprite.playAnimation('walk');
    component.advanceAnimation(0.08);
    sprite.stopAnimation();
    component.advanceAnimation(1);
    expect(sprite.currentAnimationFrame).toBe(1);
    expect(sprite.animationPlaying).toBe(false);
    sprite.playAnimation('walk');
    expect(sprite.currentAnimationFrame).toBe(0);
    sprite.currentFrame = 3;
    expect(sprite.currentAnimation).toBeUndefined();
    expect(crop()).toEqual([60, 0, 20, 40, 0, 0, 20, 40]);
  });

  it('can register again after legacy stop removes it', () => {
    jest.clearAllMocks();
    const { sprite } = createSprite();
    sprite.playAnimation('walk');
    sprite.stop();
    sprite.playAnimation('walk');
    expect(Engine.registerObject).toHaveBeenCalledTimes(2);
  });

  it('registers a named sprite again after its active scene removes it', () => {
    jest.clearAllMocks();
    const activeObjects = new Set<Sprite>();
    const engine = Engine as unknown as { objects?: Set<Sprite> };
    engine.objects = activeObjects;
    const { sprite } = createSprite();
    try {
      sprite.playAnimation('walk');
      activeObjects.add(sprite);
      sprite.playAnimation('walk');
      expect(Engine.registerObject).toHaveBeenCalledTimes(1);
      activeObjects.delete(sprite);
      sprite.playAnimation('walk');
      expect(Engine.registerObject).toHaveBeenCalledTimes(2);
    } finally {
      delete engine.objects;
    }
  });

  it('takes a copy of atlas source frames and uses explicit display bounds', () => {
    const source = { x: 1, y: 2, width: 5, height: 7 };
    const { sprite, crop } = createSprite({
      idle: { frames: [{ frame: source, durationMs: 100 }] },
    }, { width: 12, height: 15 });
    source.x = 40;
    sprite.playAnimation('idle');
    expect(crop()).toEqual([1, 2, 5, 7, 0, 0, 12, 15]);
    expect(sprite.bounds).toMatchObject({ width: 12, height: 15 });
  });

  it.each([
    { frames: [] },
    { frames: [{ frame: 10, durationMs: 100 }] },
    { frames: [{ frame: 1, durationMs: 0 }] },
    { frames: [{ frame: { x: 0, y: -1, width: 10, height: 10 }, durationMs: 10 }] },
  ])('rejects invalid clip data', (clip) => {
    expect(() => createSprite({ invalid: clip })).toThrow();
  });
});
