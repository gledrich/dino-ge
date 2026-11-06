import Input from './Input.js';
import Vector2 from '../math/Vector2.js';
import Engine from './Engine.js';
import GameObject from './GameObject.js';
import TransformComponent from '../components/TransformComponent.js';

jest.mock('./Engine', () => ({
  __esModule: true,
  default: {
    camera: {
      zoom: 1,
      position: { x: 0, y: 0 },
      getViewportBounds: jest.fn()
    },
    paused: false,
    debug: false,
    emit: jest.fn(),
    on: jest.fn(),
    objects: new Set(),
    currentScene: null,
    selectedObject: null
  }
}));

const inputState = Input as unknown as {
  gesture: { kind: 'drag' | 'resize'; object: GameObject; offset: Vector2 } | null;
};

function beginResize(object: GameObject) {
  inputState.gesture = { kind: 'resize', object, offset: new Vector2(0, 0) };
}

describe('Input', () => {
  let capturedListeners: Record<string, ((event: unknown) => void)> = {};

  beforeEach(() => {
    Input.setActions({});
    // Reset private static state
    (Input as unknown as { keys: Set<string> }).keys.clear();
    (Input as unknown as { clickListeners: Set<unknown> }).clickListeners.clear();
    (Input as unknown as { isinitialised: boolean }).isinitialised = false;
    (Input as unknown as { mousePosition: Vector2 }).mousePosition = new Vector2(0, 0);
    inputState.gesture = null;
    jest.clearAllMocks();
    
    capturedListeners = {};
    jest.spyOn(document, 'addEventListener').mockImplementation((type, listener) => {
      capturedListeners[type] = listener as unknown as (event: unknown) => void;
    });

    // Reset Engine mock properties
    (Engine as unknown as { debug: boolean }).debug = false;
    (Engine as unknown as { paused: boolean }).paused = false;
    (Engine as unknown as { objects: Set<unknown> }).objects = new Set();
    (Engine as unknown as { currentScene: unknown }).currentScene = null;
    (Engine as unknown as { selectedObject: unknown }).selectedObject = null;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('tracks key states correctly', () => {
    Input.init();
    capturedListeners['keydown']({ key: 'w' } as unknown as KeyboardEvent);
    expect(Input.isKeyDown('w')).toBe(true);
    capturedListeners['keyup']({ key: 'w' } as unknown as KeyboardEvent);
    expect(Input.isKeyDown('w')).toBe(false);
  });

  describe('named actions', () => {
    it('combines held keyboard alternatives without stacking and cancels opposing keys', () => {
      Input.setActions({ move: [{ key: 'a', scale: -1 }, { key: 'ArrowLeft', scale: -1 }, { key: 'd' }] });
      Input.init();
      expect(Input.getActionValue('unknown')).toBe(0);
      expect(Input.isActionDown('move')).toBe(false);

      capturedListeners['keydown']({ key: 'A' });
      capturedListeners['keydown']({ key: 'ArrowLeft' });
      expect(Input.getActionValue('move')).toBe(-1);
      expect(Input.isActionDown('move')).toBe(true);
      expect(Input.isKeyDown('a')).toBe(true);
      capturedListeners['keydown']({ key: 'd' });
      expect(Input.getActionValue('move')).toBe(0);
      capturedListeners['keyup']({ key: 'd' });
      expect(Input.getActionValue('move')).toBe(-1);

      window.dispatchEvent(new Event('blur'));
      expect(Input.getActionValue('move')).toBe(0);
    });

    it('snapshots the bindings and replaces the previous map atomically', () => {
      Input.init();
      const binding = { key: 'w' };
      const bindings = [binding];
      Input.setActions({ jump: bindings });
      binding.key = 'x';
      bindings.length = 0;
      capturedListeners['keydown']({ key: 'w' });
      expect(Input.isActionDown('jump')).toBe(true);

      expect(() => Input.setActions({ move: [{ axis: 0, deadZone: NaN }] })).toThrow(RangeError);
      expect(Input.isActionDown('jump')).toBe(true);
      Input.setActions({});
      expect(Input.isActionDown('jump')).toBe(false);
      expect(Input.isKeyDown('w')).toBe(true);
    });
  });

  describe('gamepads', () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'getGamepads');

    afterEach(() => {
      if (original) Object.defineProperty(navigator, 'getGamepads', original);
      else Reflect.deleteProperty(navigator, 'getGamepads');
    });

    const mockGamepads = (getGamepads: unknown) => {
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: getGamepads });
    };

    it('polls named buttons and signed axes from the selected standard gamepad', () => {
      Input.setActions({
        move: [{ axis: 0, gamepad: 2 }, { axis: 1, gamepad: 2, scale: -1, deadZone: 0.4 }],
        interact: [{ button: 0 }],
      });
      const standard = { connected: true, mapping: 'standard', axes: [-0.75, 0.3], buttons: [{ pressed: true }] };
      const pad = jest.fn().mockReturnValue([null, { ...standard, mapping: '' }, standard]);
      mockGamepads(pad);

      expect(Input.getActionValue('move')).toBe(-0.75);
      expect(Input.isActionDown('interact')).toBe(true);
      standard.axes = [0.2, -0.5];
      expect(Input.getActionValue('move')).toBe(0.5);
      standard.connected = false;
      expect(Input.getActionValue('move')).toBe(0);
      expect(Input.isActionDown('interact')).toBe(false);
    });

    it('returns neutral input when the browser has no Gamepad API', () => {
      mockGamepads(undefined);
      expect(Input.getGamepad()).toBeNull();
      expect(Input.getGamepadAxes()).toEqual(new Vector2(0, 0));
    });

    it('polls sparse standard gamepads, applies a dead zone and detects disconnects', () => {
      const standard = { connected: true, mapping: 'standard', axes: [0.2, -0.75] };
      const other = { connected: true, mapping: '', axes: [1, 1] };
      const pads = jest.fn().mockReturnValue([null, other, standard]);
      mockGamepads(pads);

      expect(Input.getGamepad()).toBe(standard);
      expect(Input.getGamepad(1)).toBeNull();
      expect(Input.getGamepad(2)).toBe(standard);
      expect(Input.getGamepadAxes(2)).toEqual(new Vector2(0, -0.75));

      pads.mockReturnValue([null, other, { ...standard, connected: false }]);
      expect(Input.getGamepad()).toBeNull();
      expect(Input.getGamepadAxes()).toEqual(new Vector2(0, 0));
    });
  });

  it('manages global click listeners', () => {
    const callback = jest.fn();
    Input.addClickListener(callback);
    Input.init();
    const canvas = document.createElement('canvas');
    capturedListeners['mousedown']({ target: canvas, button: 0 } as unknown as MouseEvent);
    expect(callback).toHaveBeenCalled();
    Input.removeClickListener(callback);
    capturedListeners['mousedown']({ target: canvas, button: 0 } as unknown as MouseEvent);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('handles mouse movement and position getters', () => {
    Input.init();
    capturedListeners['mousemove']({ clientX: 100, clientY: 200 } as unknown as MouseEvent);
    expect(Input.mouseX).toBe(100);
    expect(Input.mouseY).toBe(200);

    // With canvas bounding rect
    const mockCanvas = {
      getBoundingClientRect: () => ({ left: 10, top: 10 })
    };
    jest.spyOn(document, 'getElementById').mockReturnValue(mockCanvas as unknown as HTMLElement);
    capturedListeners['mousemove']({ clientX: 100, clientY: 200 } as unknown as MouseEvent);
    expect(Input.mouseX).toBe(90);
    expect(Input.mouseY).toBe(190);

    // Canvas exists but getBoundingClientRect is NOT a function
    const mockCanvasNoRect = {};
    jest.spyOn(document, 'getElementById').mockReturnValue(mockCanvasNoRect as unknown as HTMLElement);
    capturedListeners['mousemove']({ clientX: 50, clientY: 50 } as unknown as MouseEvent);
    expect(Input.mouseX).toBe(50);

    // Canvas does not exist
    jest.spyOn(document, 'getElementById').mockReturnValue(null);
    capturedListeners['mousemove']({ clientX: 75, clientY: 75 } as unknown as MouseEvent);
    expect(Input.mouseX).toBe(75);
  });

  it('reads a press from the scaled game canvas and ignores unrelated canvases', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    jest.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 20, top: 30, width: 400, height: 300 } as DOMRect);
    jest.spyOn(document, 'getElementById').mockReturnValue(canvas);
    const click = jest.fn();
    Input.addClickListener(click);
    Input.init();

    capturedListeners.mousedown({ target: document.createElement('canvas'), button: 0, clientX: 70, clientY: 80 });
    expect(click).not.toHaveBeenCalled();
    capturedListeners.mousedown({ target: canvas, button: 0, clientX: 70, clientY: 80 });
    expect(click).toHaveBeenCalledWith(new Vector2(100, 100));
    capturedListeners.mousemove({ clientX: 90, clientY: 120 });
    expect([Input.mouseX, Input.mouseY]).toEqual([140, 180]);
  });

  it('prevents multiple initialisations', () => {
    Input.init();
    const firstCount = Object.keys(capturedListeners).length;
    Input.init();
    expect(Object.keys(capturedListeners).length).toBe(firstCount);
  });

  it('handles debug object selection on mousedown with sorting', () => {
    (Engine as unknown as { debug: boolean }).debug = true;
    const objBottom = {
      transform: { position: { x: 10, y: 10 }, worldPosition: { x: 10, y: 10 }, worldScale: new Vector2(1, 1) },
      bounds: { width: 50, height: 50 },
      metadata: { zIndex: 0, tag: 'bottom' }
    } as unknown as GameObject;
    const objMid = {
      transform: { position: { x: 10, y: 10 }, worldPosition: { x: 10, y: 10 }, worldScale: new Vector2(1, 1) },
      bounds: { width: 50, height: 50 },
      metadata: { zIndex: 5, tag: 'mid' }
    } as unknown as GameObject;
    const objTop = {
      transform: { position: { x: 10, y: 10 }, worldPosition: { x: 10, y: 10 }, worldScale: new Vector2(1, 1) },
      bounds: { width: 50, height: 50 },
      metadata: { zIndex: 10, tag: 'top' }
    } as unknown as GameObject;
    (Engine as unknown as { objects: Set<unknown> }).objects = new Set([objBottom, objMid, objTop]);
    
    Input.init();
    (Input as unknown as { mousePosition: Vector2 }).mousePosition = new Vector2(20, 20);
    capturedListeners['mousedown']({ target: document.createElement('canvas'), button: 0 } as unknown as MouseEvent);
    expect(Engine.selectedObject).toBe(objTop);

    // Reverse sorting test
    (objBottom.metadata as { zIndex: number }).zIndex = 20;
    capturedListeners['mousedown']({ target: document.createElement('canvas'), button: 0 } as unknown as MouseEvent);
    expect(Engine.selectedObject).toBe(objBottom);

    // Equality sorting test
    (objTop.metadata as { zIndex: number }).zIndex = 20;
    capturedListeners['mousedown']({ target: document.createElement('canvas'), button: 0 } as unknown as MouseEvent);
    expect(Engine.selectedObject).toBeDefined();
  });

  it('handles clicks on objects WITH currentScene', () => {
    (Engine as unknown as { debug: boolean }).debug = true;
    const obj = {
      transform: { worldPosition: new Vector2(0, 0), worldScale: new Vector2(1, 1) },
      bounds: { width: 10, height: 10 },
      metadata: { zIndex: 0, tag: 'in-scene' }
    } as unknown as GameObject;
    (Engine as unknown as { currentScene: unknown }).currentScene = { objects: new Set([obj]) };
    Input.init();
    (Input as unknown as { mousePosition: Vector2 }).mousePosition = new Vector2(5, 5);
    capturedListeners['mousedown']({ target: document.createElement('canvas'), button: 0 } as unknown as MouseEvent);
    expect(Engine.selectedObject).toBe(obj);
  });

  it('handles clicks on objects WITHOUT currentScene', () => {
    (Engine as unknown as { debug: boolean }).debug = true;
    (Engine as unknown as { currentScene: unknown }).currentScene = null;
    const obj = {
      transform: { worldPosition: new Vector2(0, 0), worldScale: new Vector2(1, 1) },
      bounds: { width: 10, height: 10 },
      metadata: { zIndex: 0, tag: 'no-scene' }
    } as unknown as GameObject;
    const objNoBounds = {
      transform: { worldPosition: new Vector2(0, 0), worldScale: new Vector2(1, 1) },
      metadata: { zIndex: 1, tag: 'no-bounds-in-loop' }
    } as unknown as GameObject;
    (Engine as unknown as { objects: Set<unknown> }).objects = new Set([obj, objNoBounds]);
    Input.init();
    (Input as unknown as { mousePosition: Vector2 }).mousePosition = new Vector2(5, 5);
    capturedListeners['mousedown']({ target: document.createElement('canvas'), button: 0 } as unknown as MouseEvent);
    expect(Engine.selectedObject).toBeDefined();

    // Mouseup with non-zero button
    capturedListeners['mouseup']({ button: 1 } as unknown as MouseEvent);
  });

  it('handles mousedown with an object having no bounds', () => {
    (Engine as unknown as { debug: boolean }).debug = true;
    const obj = {
      transform: { position: { x: 10, y: 10 }, worldPosition: { x: 10, y: 10 }, worldScale: new Vector2(1, 1) },
      metadata: { zIndex: 0, tag: 'no-bounds' }
    } as unknown as GameObject;
    (Engine as unknown as { objects: Set<unknown> }).objects = new Set([obj]);
    Input.init();
    (Input as unknown as { mousePosition: Vector2 }).mousePosition = new Vector2(15, 15);
    capturedListeners['mousedown']({ target: document.createElement('canvas'), button: 0 } as unknown as MouseEvent);
    expect(Engine.selectedObject).toBeNull();
  });

  it('handles resize handle detection and interaction', () => {
    (Engine as unknown as { debug: boolean }).debug = true;
    const obj = {
      transform: { 
        position: new Vector2(10, 10), 
        worldPosition: new Vector2(10, 10),
        worldScale: new Vector2(1, 1),
        scale: new Vector2(1, 1)
      },
      bounds: { width: 100, height: 100 },
      metadata: { zIndex: 0, tag: 'resize-me' },
      getComponent: jest.fn(() => null)
    } as unknown as GameObject;
    
    (Engine as unknown as { selectedObject: unknown }).selectedObject = obj;
    (Engine as unknown as { objects: Set<unknown> }).objects = new Set([obj]);
    
    const mockCanvas = { style: { cursor: '' } };
    jest.spyOn(document, 'getElementById').mockReturnValue(mockCanvas as unknown as HTMLElement);

    Input.init();
    
    // Hover handle (at 110, 110)
    (Input as unknown as { mousePosition: Vector2 }).mousePosition = new Vector2(110, 110);
    capturedListeners['mousemove']({ clientX: 110, clientY: 110 } as unknown as MouseEvent);
    expect(mockCanvas.style.cursor).toBe('se-resize');

    // Click handle
    capturedListeners['mousedown']({ target: document.createElement('canvas'), button: 0 } as unknown as MouseEvent);
    expect(inputState.gesture?.kind === 'resize').toBe(true);

    // Resize to 200x300 (mouse at 210, 310)
    (Input as unknown as { mousePosition: Vector2 }).mousePosition = new Vector2(210, 310);
    capturedListeners['mousemove']({ clientX: 210, clientY: 310 } as unknown as MouseEvent);
    expect(obj.bounds!.width).toBe(200);
    expect(obj.bounds!.height).toBe(300);

    // Mouseup to reset state before next click
    capturedListeners['mouseup']({ button: 0 } as unknown as MouseEvent);
    expect(inputState.gesture?.kind === 'resize').toBe(false);

    // Click NEAR handle but not ON it (e.g. at 110, 100)
    // Range is 106-114 for x, 106-114 for y.
    (Input as unknown as { mousePosition: Vector2 }).mousePosition = new Vector2(110, 100);
    capturedListeners['mousedown']({ target: document.createElement('canvas'), button: 0 } as unknown as MouseEvent);
    expect(inputState.gesture?.kind === 'resize').toBe(false);
    expect(inputState.gesture?.kind === 'drag').toBe(true);

    // Reset and test other boundaries
    capturedListeners['mouseup']({ button: 0 } as unknown as MouseEvent);
    (Input as unknown as { mousePosition: Vector2 }).mousePosition = new Vector2(100, 110); // x too small
    capturedListeners['mousedown']({ target: document.createElement('canvas'), button: 0 } as unknown as MouseEvent);
    expect(inputState.gesture?.kind === 'resize').toBe(false);

    capturedListeners['mouseup']({ button: 0 } as unknown as MouseEvent);
    (Input as unknown as { mousePosition: Vector2 }).mousePosition = new Vector2(120, 110); // x too large
    capturedListeners['mousedown']({ target: document.createElement('canvas'), button: 0 } as unknown as MouseEvent);
    expect(inputState.gesture?.kind === 'resize').toBe(false);

    capturedListeners['mouseup']({ button: 0 } as unknown as MouseEvent);
    (Input as unknown as { mousePosition: Vector2 }).mousePosition = new Vector2(110, 120); // y too large
    capturedListeners['mousedown']({ target: document.createElement('canvas'), button: 0 } as unknown as MouseEvent);
    expect(inputState.gesture?.kind === 'resize').toBe(false);

    // Mouseup resets
    capturedListeners['mouseup']({ button: 0 } as unknown as MouseEvent);
    expect(inputState.gesture?.kind === 'resize').toBe(false);

    // Cursor reset when moving away from handle
    (Input as unknown as { mousePosition: Vector2 }).mousePosition = new Vector2(50, 50);
    capturedListeners['mousemove']({ clientX: 50, clientY: 50 } as unknown as MouseEvent);
    expect(mockCanvas.style.cursor).toBe('default');
  });

  it('resizes SpriteComponent using scale', () => {
    (Engine as unknown as { debug: boolean }).debug = true;
    const mockSprite = { frameWidth: 10, frameHeight: 10 };
    const obj = {
      transform: { 
        position: new Vector2(0, 0), 
        worldPosition: new Vector2(0, 0),
        worldScale: new Vector2(1, 1),
        scale: new Vector2(1, 1)
      },
      bounds: { width: 10, height: 10 },
      metadata: { zIndex: 0, tag: 'sprite' },
      getComponent: jest.fn((cls) => cls.name === 'SpriteComponent' ? mockSprite : null)
    } as unknown as GameObject;
    
    (Engine as unknown as { selectedObject: unknown }).selectedObject = obj;
    beginResize(Engine.selectedObject!);
    Input.init();
    
    (Input as unknown as { mousePosition: Vector2 }).mousePosition = new Vector2(50, 50);
    capturedListeners['mousemove']({ clientX: 50, clientY: 50 } as unknown as MouseEvent);
    
    expect(obj.transform.scale.x).toBe(5);
    expect(obj.bounds!.width).toBe(10);

    // Test line 41 branch: scale missing during resizing
    const objNoScale = {
      transform: { worldPosition: new Vector2(0, 0) },
      bounds: { width: 10, height: 10 },
      getComponent: jest.fn(() => null)
    } as unknown as GameObject;
    (Engine as unknown as { selectedObject: unknown }).selectedObject = objNoScale;
    beginResize(Engine.selectedObject!);
    capturedListeners['mousemove']({ clientX: 20, clientY: 20 } as unknown as MouseEvent);
    expect(objNoScale.bounds!.width).toBe(20);
  });

  it('mousedown handles missing worldScale', () => {
    (Engine as unknown as { debug: boolean }).debug = true;
    const objNoWorldScale = {
      transform: { worldPosition: new Vector2(0, 0) },
      bounds: { width: 10, height: 10 },
      metadata: { zIndex: 10, tag: 'no-world-scale' }
    } as unknown as GameObject;
    
    (Engine as unknown as { objects: Set<unknown> }).objects = new Set([objNoWorldScale]);
    Input.init();
    
    // Test hover with missing worldScale (line 103 branch)
    (Engine as unknown as { selectedObject: unknown }).selectedObject = objNoWorldScale;
    (Input as unknown as { mousePosition: Vector2 }).mousePosition = new Vector2(10, 10);
    const mockCanvas = { style: { cursor: '' } };
    jest.spyOn(document, 'getElementById').mockReturnValue(mockCanvas as unknown as HTMLElement);
    capturedListeners['mousemove']({ clientX: 10, clientY: 10 } as unknown as MouseEvent);
    expect(mockCanvas.style.cursor).toBe('se-resize');

    // Test line 103 false branch: handle hit but canvas missing
    jest.spyOn(document, 'getElementById').mockReturnValue(null);
    expect(() => {
      capturedListeners['mousemove']({ clientX: 10, clientY: 10 } as unknown as MouseEvent);
    }).not.toThrow();

    // Test mousedown on handle with missing worldScale (line 126 branch)
    capturedListeners['mousedown']({ target: document.createElement('canvas'), button: 0 } as unknown as MouseEvent);
    expect(inputState.gesture?.kind === 'resize').toBe(true);

    // Test selection loop with missing worldScale (hit test branch)
    inputState.gesture = null;
    (Engine as unknown as { selectedObject: unknown }).selectedObject = null;
    (Input as unknown as { mousePosition: Vector2 }).mousePosition = new Vector2(5, 5);
    capturedListeners['mousedown']({ target: document.createElement('canvas'), button: 0 } as unknown as MouseEvent);
    expect(Engine.selectedObject).toBe(objNoWorldScale);
  });

  it('resizes ShapeComponent or TextComponent directly', () => {
    (Engine as unknown as { debug: boolean }).debug = true;
    const mockComp = { width: 10, height: 10 };
    const obj = {
      transform: { worldPosition: new Vector2(0, 0), scale: new Vector2(1, 1) },
      bounds: { width: 10, height: 10 },
      getComponent: jest.fn((cls) => {
        if (cls.name === 'ShapeComponent' || cls.name === 'TextComponent') return mockComp;
        return null;
      })
    } as unknown as GameObject;
    
    (Engine as unknown as { selectedObject: unknown }).selectedObject = obj;
    beginResize(Engine.selectedObject!);
    Input.init();
    
    // Shape
    (Input as unknown as { mousePosition: Vector2 }).mousePosition = new Vector2(100, 100);
    capturedListeners['mousemove']({ clientX: 100, clientY: 100 } as unknown as MouseEvent);
    expect(mockComp.width).toBe(100);

    // Text
    (obj.getComponent as jest.Mock).mockImplementation((cls) => {
      if (cls.name === 'TextComponent') return mockComp;
      return null;
    });
    (Input as unknown as { mousePosition: Vector2 }).mousePosition = new Vector2(80, 40);
    capturedListeners['mousemove']({ clientX: 80, clientY: 40 } as unknown as MouseEvent);
    expect(mockComp.width).toBe(80);
  });

  it('handles edge cases during resizing and selection', () => {
    (Engine as unknown as { debug: boolean }).debug = true;
    const obj = {
      transform: { worldPosition: new Vector2(0, 0), scale: new Vector2(1, 1) },
      metadata: { zIndex: 0, tag: 'edge' },
      getComponent: jest.fn(() => null)
    } as unknown as GameObject;
    
    (Engine as unknown as { selectedObject: unknown }).selectedObject = obj;
    Input.init();
    
    // No matching component fallback
    beginResize(Engine.selectedObject!);
    (Input as unknown as { mousePosition: Vector2 }).mousePosition = new Vector2(100, 100);
    expect(() => capturedListeners['mousemove']({ clientX: 100, clientY: 100 } as unknown as MouseEvent)).not.toThrow();

    // Hover handle with no canvas
    inputState.gesture = null;
    jest.spyOn(document, 'getElementById').mockReturnValue(null);
    expect(() => capturedListeners['mousemove']({ clientX: 100, clientY: 100 } as unknown as MouseEvent)).not.toThrow();

    // Hover handle with no canvas element
    (Input as unknown as { mousePosition: Vector2 }).mousePosition = new Vector2(110, 110);
    expect(() => {
      capturedListeners['mousemove']({ clientX: 110, clientY: 110 } as unknown as MouseEvent);
    }).not.toThrow();

    // Mousedown handle with no bounds
    (Input as unknown as { mousePosition: Vector2 }).mousePosition = new Vector2(0, 0);
    expect(() => {
      capturedListeners['mousedown']({ target: document.createElement('canvas'), button: 0 } as unknown as MouseEvent);
    }).not.toThrow();

    // Resize sprite with no bounds
    const mockSprite = { frameWidth: 10, frameHeight: 10 };
    const spriteObj = {
      transform: { 
        position: new Vector2(0, 0), 
        worldPosition: new Vector2(0, 0),
        scale: new Vector2(1, 1)
      },
      metadata: { zIndex: 0, tag: 'sprite-no-bounds' },
      getComponent: jest.fn((cls) => cls.name === 'SpriteComponent' ? mockSprite : null)
    } as unknown as GameObject;
    (Engine as unknown as { selectedObject: unknown }).selectedObject = spriteObj;
    beginResize(Engine.selectedObject!);
    expect(() => {
      capturedListeners['mousemove']({ clientX: 50, clientY: 50 } as unknown as MouseEvent);
    }).not.toThrow();

    // Mousedown selection logic boundary tests
    (Engine as unknown as { objects: Set<unknown> }).objects = new Set([obj]);
    (obj as unknown as { bounds: { width: number, height: number } }).bounds = { width: 50, height: 50 };
    (obj.transform as unknown as { worldPosition: Vector2 }).worldPosition = new Vector2(100, 100);
    
    const canvas = document.createElement('canvas');
    // Inside
    (Input as unknown as { mousePosition: Vector2 }).mousePosition = new Vector2(125, 125);
    capturedListeners['mousedown']({ target: canvas, button: 0 } as unknown as MouseEvent);
    expect(Engine.selectedObject).toBe(obj);

    // Reset
    (Engine as unknown as { selectedObject: unknown }).selectedObject = null;

    // x boundary tests
    (Input as unknown as { mousePosition: Vector2 }).mousePosition = new Vector2(90, 125);
    capturedListeners['mousedown']({ target: canvas, button: 0 } as unknown as MouseEvent);
    expect(Engine.selectedObject).toBeNull();

    (Input as unknown as { mousePosition: Vector2 }).mousePosition = new Vector2(160, 125);
    capturedListeners['mousedown']({ target: canvas, button: 0 } as unknown as MouseEvent);
    expect(Engine.selectedObject).toBeNull();

    // y boundary tests
    (Input as unknown as { mousePosition: Vector2 }).mousePosition = new Vector2(125, 90);
    capturedListeners['mousedown']({ target: canvas, button: 0 } as unknown as MouseEvent);
    expect(Engine.selectedObject).toBeNull();

    (Input as unknown as { mousePosition: Vector2 }).mousePosition = new Vector2(125, 160);
    capturedListeners['mousedown']({ target: canvas, button: 0 } as unknown as MouseEvent);
    expect(Engine.selectedObject).toBeNull();
  });

  it('handles object dragging in debug mode', () => {
    (Engine as unknown as { debug: boolean }).debug = true;
    const obj = {
      transform: { position: { x: 10, y: 10 }, worldPosition: { x: 10, y: 10 }, worldScale: new Vector2(1, 1) },
      bounds: { width: 50, height: 50 },
      metadata: { zIndex: 0, tag: 'drag' }
    } as unknown as GameObject;
    (Engine as unknown as { objects: Set<unknown> }).objects = new Set([obj]);
    
    Input.init();
    (Input as unknown as { mousePosition: Vector2 }).mousePosition = new Vector2(35, 35);
    capturedListeners['mousedown']({ target: document.createElement('canvas'), button: 0 } as unknown as MouseEvent);
    expect(Engine.selectedObject).toBe(obj);

    (Input as unknown as { mousePosition: Vector2 }).mousePosition = new Vector2(100, 100);
    capturedListeners['mousemove']({ clientX: 100, clientY: 100 } as unknown as MouseEvent);
    expect(obj.transform.position.x).toBe(75);
  });

  it('handles dragging with parent', () => {
    (Engine as unknown as { debug: boolean }).debug = true;
    const parentTransform = new TransformComponent();
    parentTransform.position.set(100, 100);
    const obj = {
      transform: { position: { x: 10, y: 10 }, worldPosition: { x: 110, y: 110 }, worldScale: new Vector2(1, 1), parent: parentTransform },
      bounds: { width: 50, height: 50 },
      metadata: { zIndex: 0 }
    } as unknown as GameObject;
    (Engine as unknown as { objects: Set<unknown> }).objects = new Set([obj]);
    
    Input.init();
    (Input as unknown as { mousePosition: Vector2 }).mousePosition = new Vector2(135, 135);
    capturedListeners['mousedown']({ target: document.createElement('canvas'), button: 0 } as unknown as MouseEvent);
    
    (Input as unknown as { mousePosition: Vector2 }).mousePosition = new Vector2(200, 200);
    capturedListeners['mousemove']({ clientX: 200, clientY: 200 } as unknown as MouseEvent);
    expect(obj.transform.position.x).toBe(75);
  });

  it('keeps the grab offset when dragging a child of a rotated and scaled parent', () => {
    Engine.debug = true;
    const parent = new TransformComponent();
    parent.position.set(100, 100);
    parent.rotation = Math.PI / 2;
    parent.scale.set(2, 3);
    const transform = new TransformComponent();
    transform.position.set(10, 10);
    parent.addChild(transform);
    const object = {
      transform, bounds: { width: 20, height: 20 }, metadata: { zIndex: 0 }
    } as GameObject;
    Engine.objects.add(object);

    Input.init();
    capturedListeners.mousemove({ clientX: 75, clientY: 125 });
    capturedListeners.mousedown({ target: document.createElement('canvas'), button: 0 });
    expect(Engine.selectedObject).toBeNull();
    capturedListeners.mouseup({ button: 0 });
    capturedListeners.mousemove({ clientX: 65, clientY: 125 });
    capturedListeners.mousedown({ target: document.createElement('canvas'), button: 0 });
    expect(Engine.selectedObject).toBe(object);
    capturedListeners.mousemove({ clientX: 95, clientY: 165 });

    expect(transform.worldPosition.x).toBeCloseTo(100);
    expect(transform.worldPosition.y).toBeCloseTo(160);
    expect(transform.position.x).toBeCloseTo(30);
    expect(transform.position.y).toBeCloseTo(0);
  });

  it('rolls back a viewport drag when selection, focus or the pressed button is lost', () => {
    Engine.debug = true;
    const createObject = (x: number) => {
      const transform = new TransformComponent();
      transform.position.set(x, 10);
      return { transform, bounds: { width: 30, height: 30 }, metadata: { zIndex: 0 } } as GameObject;
    };
    const first = createObject(10);
    const second = createObject(100);
    Engine.objects.add(first);
    Engine.objects.add(second);
    const canvas = document.createElement('canvas');
    Input.init();
    const grabFirst = () => {
      capturedListeners.mousemove({ clientX: 20, clientY: 20 });
      capturedListeners.mousedown({ target: canvas, button: 0 });
      expect(Engine.selectedObject).toBe(first);
    };

    grabFirst();
    capturedListeners.mousemove({ clientX: 50, clientY: 50 });
    expect(first.transform.position).toMatchObject({ x: 40, y: 40 });
    Engine.selectedObject = second;
    capturedListeners.mousemove({ clientX: 70, clientY: 70 });
    expect(first.transform.position).toMatchObject({ x: 10, y: 10 });
    expect(second.transform.position).toMatchObject({ x: 100, y: 10 });

    grabFirst();
    capturedListeners.mousemove({ clientX: 50, clientY: 50 });
    expect(first.transform.position).toMatchObject({ x: 40, y: 40 });
    window.dispatchEvent(new Event('blur'));
    capturedListeners.mousemove({ clientX: 70, clientY: 70 });
    capturedListeners.mouseup({ button: 0 });
    expect(first.transform.position).toMatchObject({ x: 10, y: 10 });

    grabFirst();
    capturedListeners.mousemove({ clientX: 50, clientY: 50, buttons: 1 });
    expect(first.transform.position).toMatchObject({ x: 40, y: 40 });
    capturedListeners.mousemove({ clientX: 70, clientY: 70, buttons: 0 });
    expect(first.transform.position).toMatchObject({ x: 10, y: 10 });
    expect(Input.isKeyDown('mouse0')).toBe(false);
    expect(Engine.emit).not.toHaveBeenCalledWith('objectManipulated', expect.anything());
  });

  it('does not trigger click listeners when paused', () => {
    (Engine as unknown as { paused: boolean }).paused = true;
    const callback = jest.fn();
    Input.addClickListener(callback);
    Input.init();
    capturedListeners['mousedown']({ target: document.createElement('canvas'), button: 0 } as unknown as MouseEvent);
    expect(callback).not.toHaveBeenCalled();
  });

  it('toggles pause with P key', () => {
    jest.spyOn(document, 'getElementById').mockReturnValue({ style: { cursor: '' } } as unknown as HTMLElement);
    Input.init();
    
    // Lowercase p
    capturedListeners['keydown']({ key: 'p', target: document.createElement('div') } as unknown as KeyboardEvent);
    expect(Engine.paused).toBe(true);
    capturedListeners['keydown']({ key: 'p', target: document.createElement('div') } as unknown as KeyboardEvent);
    expect(Engine.paused).toBe(false);

    // Uppercase P
    capturedListeners['keydown']({ key: 'P', target: document.createElement('div') } as unknown as KeyboardEvent);
    expect(Engine.paused).toBe(true);
    capturedListeners['keydown']({ key: 'P', target: document.createElement('div') } as unknown as KeyboardEvent);
    expect(Engine.paused).toBe(false);

    // Non-p key
    capturedListeners['keydown']({ key: 'w', target: document.createElement('div') } as unknown as KeyboardEvent);
    expect(Engine.paused).toBe(false);

    // P with no canvas
    jest.spyOn(document, 'getElementById').mockReturnValue(null);
    capturedListeners['keydown']({ key: 'p', target: document.createElement('div') } as unknown as KeyboardEvent);
    expect(Engine.paused).toBe(true);
  });

  it('does not toggle pause with P key when in input or textarea', () => {
    Input.init();
    Engine.paused = false;
    
    // Input
    const input = document.createElement('input');
    capturedListeners['keydown']({ key: 'p', target: input } as unknown as KeyboardEvent);
    expect(Engine.paused).toBe(false);

    // Textarea
    const textarea = document.createElement('textarea');
    capturedListeners['keydown']({ key: 'p', target: textarea } as unknown as KeyboardEvent);
    expect(Engine.paused).toBe(false);

    // Contenteditable
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    capturedListeners['keydown']({ key: 'p', target: div } as unknown as KeyboardEvent);
    expect(Engine.paused).toBe(false);
  });

  it('clears keys on window blur', () => {
    let blurListener: (event: unknown) => void = () => {};
    jest.spyOn(window, 'addEventListener').mockImplementation((type, listener) => {
      if (type === 'blur') blurListener = listener as unknown as (event: unknown) => void;
    });
    Input.init();
    capturedListeners['keydown']({ key: 'w' } as unknown as KeyboardEvent);
    blurListener({});
    expect(Input.isKeyDown('w')).toBe(false);
  });

  it('ignores mousedown outside canvas', () => {
    Input.init();
    const div = document.createElement('div');
    capturedListeners['mousedown']({ target: div, button: 0 } as unknown as MouseEvent);
    expect(Input.isKeyDown('mouse0')).toBe(false);
  });
});
