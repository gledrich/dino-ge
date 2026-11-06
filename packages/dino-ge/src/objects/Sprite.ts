import Engine from '../core/Engine.js';
import GameObject from '../core/GameObject.js';
import Vector2 from '../math/Vector2.js';
import ResourceLoader from '../core/Loader.js';
import SpriteComponent from '../components/SpriteComponent.js';
import BoundsComponent from '../components/BoundsComponent.js';
import VisibilityComponent from '../components/VisibilityComponent.js';
import PhysicsComponent from '../components/PhysicsComponent.js';
import type { SpriteAnimationClip, SpriteAnimationOptions } from './SpriteAnimation.js';

/**
 * Configuration for creating a Sprite object.
 */
export interface SpriteProps {
  /** Unique tag for the object. */
  tag: string;
  /** Hidden identifier linking runtime object to its source code location. */
  __sourceId?: string;
  /** Image instance or tag from ResourceLoader. */
  img: HTMLImageElement | string;
  /** Number of rows in the spritesheet. */
  rows: number;
  /** Number of columns in the spritesheet. */
  cols: number;
  /** First zero-based frame in the legacy range. */
  startCol?: number;
  /** Exclusive end of the legacy frame range. */
  endCol?: number;
  /** Named clips using grid cells or rectangles from this sprite's image. */
  animations?: Readonly<Record<string, SpriteAnimationClip>>;
  /** Fixed local display size in pixels. Defaults to the size of one grid cell. */
  displaySize?: Readonly<{ width: number; height: number }>;
  /** Initial position in world space. */
  position?: Vector2;
  /** Initial rotation in radians. */
  rotation?: number;
  /** Rendering order. */
  zIndex?: number;
  /** Scale factor (number or Vector2). */
  scale?: number | Vector2;
  /** Whether the sprite is initially visible. */
  visible?: boolean;
  /** Initial physics configuration. */
  physics?: {
    velocity?: Vector2;
    acceleration?: Vector2;
    mass?: number;
    isStatic?: boolean;
    restitution?: number;
    friction?: number;
    isSensor?: boolean;
    collisionCategory?: number;
    collisionMask?: number;
  };
}

/**
 * A high-level object that represents an animated sprite.
 * Wraps SpriteComponent and TransformComponent for ease of use.
 */
export default class Sprite extends GameObject {
  private _spriteComponent: SpriteComponent;

  /** The image element used by the sprite. */
  get img(): HTMLImageElement { return this._spriteComponent.img; }
  set img(val: HTMLImageElement) {
    const component = this._spriteComponent;
    component.img = val;
    const update = () => {
      if (component.img !== val) return;
      component.frameWidth = val.width / component.cols;
      component.frameHeight = val.height / component.rows;
      this._updateBounds();
    };
    update();
    if (!val.complete) val.addEventListener('load', update, { once: true });
  }

  /** Number of rows in the spritesheet. */
  get rows(): number { return this._spriteComponent.rows; }
  set rows(val: number) { 
    this._spriteComponent.rows = val;
    this._updateBounds();
  }

  /** Number of columns in the spritesheet. */
  get cols(): number { return this._spriteComponent.cols; }
  set cols(val: number) { 
    this._spriteComponent.cols = val;
    this._updateBounds();
  }

  /** First frame in the legacy animation loop. */
  get startCol(): number { return this._spriteComponent.startCol; }
  set startCol(val: number) { this._spriteComponent.startCol = val; }

  /** Exclusive end of the legacy animation loop. */
  get endCol(): number { return this._spriteComponent.endCol; }
  set endCol(val: number) { this._spriteComponent.endCol = val; }

  /** The pixel width of one source grid cell. */
  get frameWidth(): number { return this._spriteComponent.frameWidth; }
  /** The pixel height of one source grid cell. */
  public get frameHeight(): number { return this._spriteComponent.frameHeight; }

  /** Whether the sprite is currently registered with the engine. */
  public registered: boolean = false;

  /** The legacy frame index. Assigning it clears the selected named clip. */
  public get currentFrame(): number { return this._spriteComponent.currentFrame; }
  public set currentFrame(val: number) { 
    this._spriteComponent.clearAnimation();
    this._spriteComponent.currentFrame = val; 
    this._updateBounds();
  }

  /** Whether the sprite is horizontally flipped. */
  public get flip(): boolean { return this._spriteComponent.flip; }
  public set flip(val: boolean) { this._spriteComponent.flip = val; }

  /** Duration of each legacy animation frame in milliseconds. */
  public get frameDuration(): number { return this._spriteComponent.frameDuration; }
  public set frameDuration(val: number) { this._spriteComponent.frameDuration = val; }

  /**
   * Gets or sets the scale of the sprite.
   * Returns the world-space scale of the transform.
   */
  public get scale(): Vector2 {
    return this.transform.scale;
  }

  public set scale(val: number | Vector2) {
    if (typeof val === 'number') {
      this.transform.scale.set(val, val);
    } else {
      this.transform.scale.copy(val);
    }
  }

  /**
   * initialises a new instance of a Sprite.
   * @param props Configuration properties for the sprite.
   */
  constructor(props: SpriteProps) {
    if (!props.tag) {
      throw new Error('You must provide a tag for a Sprite');
    }
    super(props.tag, props.zIndex ?? 1, props.__sourceId);

    let img: HTMLImageElement;
    if (typeof props.img === 'string') {
      img = ResourceLoader.getImage(props.img);
    } else {
      img = props.img;
    }

    const displaySize = props.displaySize && { ...props.displaySize };
    if (displaySize && (![displaySize.width, displaySize.height].every(Number.isFinite)
      || displaySize.width <= 0 || displaySize.height <= 0)) {
      throw new RangeError('Sprite display size must have positive finite dimensions');
    }

    this._spriteComponent = new SpriteComponent(
      img,
      props.rows,
      props.cols,
      props.startCol ?? 0,
      props.endCol ?? props.cols - 1,
      props.animations,
      displaySize
    );
    this.addComponent(this._spriteComponent);

    const initialScale = props.scale !== undefined ? props.scale : 1;
    if (typeof initialScale === 'number') {
      this.transform.scale = new Vector2(initialScale, initialScale);
    } else {
      this.transform.scale = initialScale;
    }

    this.bounds = new BoundsComponent(0, 0);

    if (img.complete) {
      this._updateBounds();
    } else {
      img.addEventListener('load', () => this._updateBounds(), { once: true });
    }

    if (props.position) {
      this.transform.position.copy(props.position);
    }
    this.transform.rotation = props.rotation ?? 0;

    this.addComponent(new VisibilityComponent(props.visible ?? true));

    if (props.physics) {
      const pc = new PhysicsComponent();
      if (props.physics.velocity) pc.velocity.copy(props.physics.velocity);
      if (props.physics.acceleration) pc.acceleration.copy(props.physics.acceleration);
      if (props.physics.mass !== undefined) pc.mass = props.physics.mass;
      if (props.physics.isStatic !== undefined) pc.isStatic = props.physics.isStatic;
      if (props.physics.restitution !== undefined) pc.restitution = props.physics.restitution;
      if (props.physics.friction !== undefined) pc.friction = props.physics.friction;
      if (props.physics.isSensor !== undefined) pc.isSensor = props.physics.isSensor;
      if (props.physics.collisionCategory !== undefined) pc.collisionCategory = props.physics.collisionCategory;
      if (props.physics.collisionMask !== undefined) pc.collisionMask = props.physics.collisionMask;
      this.addComponent(pc);
    }
  }

  /**
   * Updates the bounds of the sprite based on its current frame size.
   * Note: Bounds represent the BASE local size (unscaled).
   * @private
   */
  private _updateBounds() {
    if (this.bounds) {
      this.bounds.width = this._spriteComponent.displayWidth;
      this.bounds.height = this._spriteComponent.displayHeight;
    }
  }

  /** The selected named clip, including clips paused or holding their final pose. */
  public get currentAnimation(): string | undefined { return this._spriteComponent.currentAnimation; }

  /** The zero-based offset of the displayed frame within the selected clip. */
  public get currentAnimationFrame(): number | undefined { return this._spriteComponent.currentAnimationFrame; }

  /** Whether a named clip is advancing. */
  public get animationPlaying(): boolean { return this._spriteComponent.animationPlaying; }

  /**
   * Starts a named clip on game time and registers the sprite if needed.
   * Repeating the same request keeps its progress, resumes a paused clip, or holds a completed pose.
   * Changing clips or modes, or setting restart, starts from the first frame.
   */
  public playAnimation(name: string, options: SpriteAnimationOptions = {}): void {
    this._spriteComponent.playAnimation(name, options);
    const activeObjects = Engine.currentScene?.objects ?? Engine.objects;
    if (activeObjects ? !activeObjects.has(this) : !this.registered) Engine.registerObject(this);
    this.registered = true;
  }

  /** Pauses the named clip while keeping the sprite registered and visible. */
  public pauseAnimation(): void { this._spriteComponent.pauseAnimation(); }

  /** Stops the named clip and holds its pose. The next play starts from the first frame. */
  public stopAnimation(): void { this._spriteComponent.stopAnimation(); }

  /** Registers the sprite and starts its legacy grid range. */
  play() {
    this._spriteComponent.clearAnimation();
    this._spriteComponent.playing = true;
    this._register();
  }

  private _register(): void {
    if (!this.registered) {
      Engine.registerObject(this);
      this.registered = true;
    }
  }

  /** Stops sprite playback and removes it from the engine. */
  stop() {
    this._spriteComponent.stopAnimation();
    this._spriteComponent.playing = false;
    Engine.destroyObject(this);
    this.registered = false;
  }
}
