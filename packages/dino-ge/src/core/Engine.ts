import Canvas from './Canvas.js';
import GameObject from './GameObject.js';
import Input from './Input.js';
import Scene from './Scene.js';
import ScreenUI from './ScreenUI.js';
import Camera from './Camera.js';
import System from './System.js';
import PhysicsSystem from '../systems/PhysicsSystem.js';
import RenderingSystem from '../systems/RenderingSystem.js';
import type { CollisionManifold } from '../physics/Physics.js';
import { type EngineState } from './EngineState.js';
import Registry from './Registry.js';
import PhysicsComponent from '../components/PhysicsComponent.js';
import { ObjectSet } from './ObjectSet.js';

/**
 * Options for initialising the Engine.
 */
export interface EngineOpts {
  /** The ID of the HTML element to inject the canvas into. */
  containerId?: string;
  /** Width of the game window (e.g., '800px' or '100%'). */
  width: string;
  /** Height of the game window (e.g., '600px' or '100%'). */
  height: string;
  /** Title of the game, set in the document head. */
  title: string;
  /** Background colour of the canvas. */
  backgroundColour: string;
}

/**
 * Lifecycle and update callbacks for the engine.
 */
export interface EngineCallbacks {
  /** Called once after the engine is initialised. */
  onLoad?: () => void;
  /** Called every frame for game logic and rendering. */
  update: () => void;
  /** Optional callback for physics or fixed-step logic. */
  fixedUpdate?: () => void;
  /** Draws game-owned interface elements after the world. */
  drawUI?: (ui: ScreenUI) => void;
  /** Releases game-owned resources when the engine is replaced or stopped. */
  onDispose?: () => void;
}

/**
 * Shared state for the engine to ensure singletons work across different module loads.
 */
const createInitialState = (): EngineState => ({
  objects: new ObjectSet(),
  paused: false,
  debug: false,
  selectedObject: null,
  camera: new Camera(),
  systems: [new PhysicsSystem()],
  events: new EventTarget(),
  totalPausedTime: 0,
  pauseStartTime: 0,
  currentScene: null,
  debugCollisions: [],
  showPhysicsVectors: false,
  showCollisionLines: false,
  zOrderDirty: true,
  sortedObjects: []
});

/**
 * The core singleton class that manages the game loop, rendering, and scene state.
 */
export default class Engine {
  /** Internal helper to access the global shared state. */
  private static get _state(): EngineState {
    const global = globalThis as unknown as { __DINO_ENGINE_STATE__: EngineState; };
    if (!global.__DINO_ENGINE_STATE__) {
      global.__DINO_ENGINE_STATE__ = createInitialState();
    }
    return global.__DINO_ENGINE_STATE__;
  }

  /**
   * Resets the engine state to its initial values.
   * Useful for testing to prevent state bleed between test cases.
   */
  public static resetState() {
    (globalThis as unknown as { __DINO_ENGINE_STATE__: EngineState; }).__DINO_ENGINE_STATE__ = createInitialState();
  }

  /**
   * Global set of game objects if no scene is active.
   */
  public static get objects(): ObjectSet { return this._state.objects; }

  /**
   * Global list of systems that process game objects.
   */
  private static get _systems(): System[] { return this._state.systems; }

  /**
   * The global rendering system.
   */
  public static get renderingSystem(): RenderingSystem | undefined { return this._state.renderingSystem; }
  public static set renderingSystem(val: RenderingSystem | undefined) { this._state.renderingSystem = val; }

  /**
   * Recent collisions for debug visualization.
   */
  public static get debugCollisions(): { manifold: CollisionManifold, timestamp: number; }[] {
    return this._state.debugCollisions;
  }
  public static set debugCollisions(val: { manifold: CollisionManifold, timestamp: number; }[]) {
    this._state.debugCollisions = val;
  }

  /**
   * Whether to show velocity/acceleration vectors in debug mode.
   */
  public static get showPhysicsVectors(): boolean { return this._state.showPhysicsVectors; }
  public static set showPhysicsVectors(val: boolean) { this._state.showPhysicsVectors = val; }

  /**
   * Whether to show collision normals/contact points in debug mode.
   */
  public static get showCollisionLines(): boolean { return this._state.showCollisionLines; }
  public static set showCollisionLines(val: boolean) { this._state.showCollisionLines = val; }

  /**
   * Whether the game loop is currently paused.
   */
  public static get paused(): boolean { return this._state.paused; }
  public static set paused(val: boolean) {
    if (this._state.paused !== val) {
      this._state.paused = val;
      
      if (val) {
        this._state.pauseStartTime = Date.now();
      } else if (this._state.pauseStartTime > 0) {
        this._state.totalPausedTime += Date.now() - this._state.pauseStartTime;
        this._state.pauseStartTime = 0;
      }

      this.emit('paused', val);
    }
  }

  /**
   * Returns the total active time of the game (excluding pause time).
   */
  public static get totalTime(): number {
    let currentPaused = 0;
    if (this.paused && this._state.pauseStartTime > 0) {
      currentPaused = Date.now() - this._state.pauseStartTime;
    }
    return Date.now() - this._state.totalPausedTime - currentPaused;
  }

  /**
   * Toggle for visual debug mode (hitboxes and stats).
   */
  public static get debug(): boolean { return this._state.debug; }
  public static set debug(val: boolean) {
    if (this._state.debug !== val) {
      this._state.debug = val;
      this.emit('debug', val);
    }
  }

  /**
   * Internal event bus for engine events.
   */
  private static get events(): EventTarget { return this._state.events; }

  /**
   * Listens for an event on the global engine bus.
   * @param type The event type (e.g., 'paused', 'PLAYER_DIED').
   * @param callback The function to run when the event occurs.
   */
  public static on(type: string, callback: (event: CustomEvent) => void) {
    this.events.addEventListener(type, callback as (e: Event) => void);
  }

  /**
   * Stops listening for an event on the global engine bus.
   * @param type The event type.
   * @param callback The function to remove.
   */
  public static off(type: string, callback: (event: CustomEvent) => void) {
    this.events.removeEventListener(type, callback as (e: Event) => void);
  }

  /**
   * Emits a custom event on the global engine bus.
   * @param type The event type.
   * @param detail Optional data to pass with the event.
   */
  public static emit(type: string, detail?: unknown) {
    this.events.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /**
   * The currently selected object in debug mode.
   */
  public static get selectedObject(): GameObject | null { return this._state.selectedObject; }
  public static set selectedObject(val: GameObject | null) {
    if (this._state.selectedObject !== val) {
      this._state.selectedObject = val;
      this.emit('selectedObjectChanged', val);
    }
  }

  /**
   * Whether the global object list needs to be re-sorted by z-index.
   */
  public static get zOrderDirty(): boolean { return this._state.zOrderDirty; }
  public static set zOrderDirty(val: boolean) { this._state.zOrderDirty = val; }

  /**
   * The cached list of globally registered game objects, sorted by z-index.
   */
  public static get sortedObjects(): GameObject[] { return this._state.sortedObjects; }
  public static set sortedObjects(val: GameObject[]) { this._state.sortedObjects = val; }

  /**
   * The global camera instance.
   */
  public static get camera(): Camera { return this._state.camera; }

  /**
   * Gets the currently active scene.
   */
  public static get currentScene(): Scene | null {
    return this._state.currentScene;
  }

  /**
   * Sets the active scene, resetting the camera and calling the scene's onLoad.
   */
  public static set currentScene(scene: Scene | null) {
    this._state.currentScene = scene;
    this.zOrderDirty = true;
    if (scene) {
      this.camera.reset();
      scene.onLoad();
    }
  }

  private _canvas: Canvas;
  private readonly screenUI?: ScreenUI;
  private readonly timers = new Set<number>();
  private _ctx: CanvasRenderingContext2D;
  private _window: HTMLDivElement;
  private _title: HTMLTitleElement;
  private _isWindowInternal: boolean = false;
  private _destroyed: boolean = false;
  private _resizeHandler: () => void;

  /** Current background colour. */
  public backgroundColour: string;
  /** Registered engine callbacks. */
  public callbacks: EngineCallbacks;

  /** Pixel width of the canvas. */
  public width: number;
  /** Pixel height of the canvas. */
  public height: number;

  /**
   * Current mouse x position in world space.
   */
  public get mouseX(): number {
    return Input.mouseX;
  }

  /**
   * Current mouse y position in world space.
   */
  public get mouseY(): number {
    return Input.mouseY;
  }

  /** Current frames per second (rolling average). */
  public fps: number = 0;
  /** Current frame time in milliseconds. */
  public frameTime: number = 0;
  private _oldTimestamp: number = 0;
  private _secondsPassed: number = 0;
  private _accumulator: number = 0;
  private _fixedDelta: number = 1 / 60;
  private _fpsValues: number[] = [];

  /**
   * initialises a new instance of the Engine.
   * @param callbacks Lifecycle and update callbacks.
   * @param opts Configuration options for the engine.
   */
  constructor(callbacks: EngineCallbacks, opts: Partial<EngineOpts> = {}) {
    // Terminate existing engine if any
    const global = globalThis as unknown as { __DINO_ENGINE_INSTANCE__?: Engine; };
    Engine.terminateCurrent();
    global.__DINO_ENGINE_INSTANCE__ = this;

    const defaultedOpts = {
      width: '100%',
      height: '100%',
      title: 'Example',
      backgroundColour: 'white',
      ...opts,
    };

    this._title = document.createElement('title');
    this._title.innerHTML = defaultedOpts.title;
    const heads = document.getElementsByTagName('head');
    if (heads.length > 0) {
      heads[0].appendChild(this._title);
    } else {
      document.documentElement.appendChild(document.createElement('head')).appendChild(this._title);
    }

    this.backgroundColour = defaultedOpts.backgroundColour;

    this.callbacks = {
      onLoad: () => {
        const loading = callbacks.onLoad?.();
        void Promise.resolve(loading).catch(error => {
          if (!this._destroyed) console.error('Could not initialise the game', error);
        });
        this._onLoad();
      },
      update: callbacks.update,
      fixedUpdate: callbacks.fixedUpdate,
      drawUI: callbacks.drawUI,
      onDispose: callbacks.onDispose,
    };

    const container = defaultedOpts.containerId ? document.getElementById(defaultedOpts.containerId) : null;
    this._canvas = new Canvas(container || undefined);
    this._ctx = this._canvas.canvas.getContext('2d')!;
    if (callbacks.drawUI) {
      this._canvas.canvas.setAttribute('aria-label', defaultedOpts.title);
      this.screenUI = new ScreenUI(this._ctx);
    }
    this.width = this._canvas.canvas.width;
    this.height = this._canvas.canvas.height;

    if (Engine.renderingSystem) {
      Engine.renderingSystem.setContext(this._ctx);
    } else {
      Engine.renderingSystem = new RenderingSystem(this._ctx);
    }

    if (!container) {
      this._isWindowInternal = true;
      this._window = document.createElement('div');
      this._window.id = 'canvas-container';
      this._window.style.width = defaultedOpts.width;
      this._window.style.height = defaultedOpts.height;

      const bodies = document.getElementsByTagName('body');
      if (bodies.length > 0) {
        bodies[0].appendChild(this._window);
      }
      this._window.appendChild(this._canvas.canvas);
    } else {
      this._window = container as HTMLDivElement;
    }

    Input.init();

    this._canvas.onResize = () => {
      this.width = this._canvas.canvas.width;
      this.height = this._canvas.canvas.height;
      if (Engine.currentScene?.onResize) {
        Engine.currentScene.onResize(this.width, this.height);
      }
    };

    this._resizeHandler = () => {
      this._canvas.resize(container || undefined);
    };
    window.addEventListener('resize', this._resizeHandler);

    setTimeout(() => {
      if (!this._destroyed) this.callbacks.onLoad?.();
    }, 0);
  }

  /**
   * Stops the current engine, if one is running.
   */
  public static terminateCurrent(): void {
    const global = globalThis as unknown as { __DINO_ENGINE_INSTANCE__?: Engine | null };
    global.__DINO_ENGINE_INSTANCE__?.terminate();
  }

  /** Completely stops this engine and cleans up its resources. */
  public terminate() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.screenUI?.dispose();
    this.timers.forEach(timer => window.clearTimeout(timer));
    this.timers.clear();
    window.removeEventListener('resize', this._resizeHandler);
    this._canvas.destroy();
    if (this._isWindowInternal && this._window) {
      this._window.remove();
    }
    if (this._title) {
      this._title.remove();
    }
    const global = globalThis as unknown as { __DINO_ENGINE_INSTANCE__?: Engine | null; };
    if (global.__DINO_ENGINE_INSTANCE__ === this) {
      global.__DINO_ENGINE_INSTANCE__ = null;
    }
    this.callbacks.onDispose?.();
  }

  private _onLoad() {
    this._draw();

    window.requestAnimationFrame(this._update.bind(this));
  }

  private _update(timestamp: number) {
    if (this._destroyed) return;

    if (this._oldTimestamp === 0) this._oldTimestamp = timestamp;

    this._secondsPassed = (timestamp - this._oldTimestamp) / 1000;
    this._oldTimestamp = timestamp;

    // Avoid division by zero on first frame
    if (this._secondsPassed > 0) {
      // Smooth FPS calculation
      const currentFps = 1 / this._secondsPassed;
      this._fpsValues.push(currentFps);
      if (this._fpsValues.length > 30) this._fpsValues.shift();
      this.fps = Math.round(this._fpsValues.reduce((a, b) => a + b, 0) / this._fpsValues.length);
      this.frameTime = parseFloat((this._secondsPassed * 1000).toFixed(2));
    }

    if (!Engine.paused) {
      // Fixed update loop
      this._accumulator += this._secondsPassed;
      while (this._accumulator >= this._fixedDelta) {
        this._fixedUpdate();
        this._accumulator -= this._fixedDelta;
      }

      if (Engine.currentScene) {
        Engine.currentScene.update();
      }

      this.callbacks.update();
      this._draw();
    } else {
      // Still allow drawing in paused mode if debug is on or for initial frame
      this._draw();
    }

    window.requestAnimationFrame(this._update.bind(this));
  }

  private _fixedUpdate() {
    const objects = Engine.currentScene ? Engine.currentScene.objects : Engine.objects;

    Engine._systems.forEach((system) => {
      if (system.fixedUpdate) {
        system.fixedUpdate(objects, this._fixedDelta);
      }
    });

    if (this.callbacks.fixedUpdate) {
      this.callbacks.fixedUpdate();
    }
  }

  private _setBackground() {
    if (this._ctx) {
      this._ctx.fillStyle = this.backgroundColour;
      this._ctx.fillRect(0, 0, this._canvas.canvas.width, this._canvas.canvas.height);
    }
  }

  private _draw() {
    this._setBackground();

    const objects = Engine.currentScene ? Engine.currentScene.objects : Engine.objects;

    if (Engine.renderingSystem) {
      Engine.renderingSystem.update(objects, 0, Engine.debug);
    }

    if (Engine.debug) {
      this._drawDebug(objects);
    }
    if (this.screenUI && this.callbacks.drawUI) this.screenUI.render(this.callbacks.drawUI);
  }

  /**
   * Cleans up expired debug collisions.
   * @param now Current timestamp.
   */
  public static cleanDebugCollisions(now: number = Date.now()) {
    const TTL = 500; // 500ms
    while (this.debugCollisions.length > 0 && now - this.debugCollisions[0].timestamp > TTL) {
      this.debugCollisions.shift();
    }
  }

  private _drawDebug(objects: Set<GameObject>) {
    // Draw Stats Overlay (Top Right)
    this._ctx.save();
    this._ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform for UI

    const overlayWidth = 180;
    const statsHeight = 95;
    const padding = 10;
    const x = this._canvas.canvas.width - overlayWidth - padding;
    let y = padding;

    // Background for Stats
    this._ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    this._ctx.fillRect(x, y, overlayWidth, statsHeight);

    this._ctx.fillStyle = 'white';
    this._ctx.textAlign = 'left';
    this._ctx.textBaseline = 'top';

    this._ctx.fillText(`FPS: ${this.fps}`, x + 10, y + 10);
    this._ctx.fillText(`Frame: ${this.frameTime}ms`, x + 10, y + 25);
    this._ctx.fillText(`Objects: ${objects.size}`, x + 10, y + 40);
    this._ctx.fillText(`Mouse X: ${Math.round(this.mouseX)}`, x + 10, y + 60);
    this._ctx.fillText(`Mouse Y: ${Math.round(this.mouseY)}`, x + 10, y + 75);

    // Inspector Panel (If object selected)
    if (Engine.selectedObject) {
      y += statsHeight + 10;
      const obj = Engine.selectedObject;
      const properties: [string, string | number][] = [
        ['Pos', `${Math.round(obj.transform.position.x)}, ${Math.round(obj.transform.position.y)}`],
        ['Size', `${Math.round(obj.bounds?.width ?? 0)}x${Math.round(obj.bounds?.height ?? 0)}`]
      ];

      const tagComp = obj.metadata;
      if (tagComp) {
        properties.unshift(['Tag', tagComp.tag]);
        properties.push(['Z-Index', tagComp.zIndex]);
      }

      const physComp = obj.getComponent(PhysicsComponent);
      if (physComp) {
        properties.push(['Vel', `${Math.round(physComp.velocity.x)}, ${Math.round(physComp.velocity.y)}`]);
        properties.push(['Acc', `${Math.round(physComp.acceleration.x)}, ${Math.round(physComp.acceleration.y)}`]);
      }

      const inspectorHeight = 20 + (properties.length * 15);
      this._ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      this._ctx.fillRect(x, y, overlayWidth, inspectorHeight);
      this._ctx.strokeStyle = '#00ff00';
      this._ctx.strokeRect(x, y, overlayWidth, inspectorHeight);

      this._ctx.fillStyle = '#00ff00';
      this._ctx.fillText('INSPECTOR', x + 10, y + 5);

      this._ctx.fillStyle = 'white';
      properties.forEach(([key, val], i) => {
        this._ctx.fillText(`${key}: ${val}`, x + 10, y + 20 + (i * 15));
      });
    }

    this._ctx.restore();
  }

  /**
   * Schedules a function to run after a delay.
   * @param callback The function to run.
   * @param delay The delay in milliseconds.
   * @returns A timer ID.
   */
  public setTimeout(callback: () => void, delay: number): number {
    const timer = window.setTimeout(() => {
      this.timers.delete(timer);
      if (!this._destroyed) callback();
    }, delay);
    if (this._destroyed) window.clearTimeout(timer);
    else this.timers.add(timer);
    return timer;
  }

  /**
   * Starts a countdown timer that runs a function every second and an ending function.
   * @param milliseconds The total duration of the countdown.
   * @param fn The function to run every second.
   * @param onEnded The function to run when the countdown is finished.
   */
  public countdown(milliseconds: number, fn: () => void, onEnded: () => void) {
    this.setTimeout(onEnded, milliseconds);

    for (let i = 1; i <= milliseconds; i += 1) {
      if (i % 1000 === 0) {
        this.setTimeout(fn, i);
      }
    }
  }

  /**
   * Sets the CSS cursor style for the game canvas.
   * @param value The CSS cursor value (e.g., 'pointer', 'crosshair').
   */
  public set cursor(value: string) {
    const canvas = document.getElementById('canvas');
    if (canvas) canvas.style.cursor = value;
  }

  /**
   * Registers a game object with the active scene or global engine loop.
   * @param object The object to register.
   */
  public static registerObject(object: GameObject) {
    Registry.registerObject(object);
  }

  /**
   * Removes a game object from the active scene or global engine loop.
   * @param object The object to destroy.
   */
  public static destroyObject(object: GameObject) {
    Registry.destroyObject(object);
  }

  /**
   * Destroy all objects in the active scene or global engine.
   */
  public static destroyAll() {
    this.zOrderDirty = true;
    if (Engine.currentScene) {
      Engine.currentScene.clear();
    } else {
      this.objects.clear();
    }
  }
}
