import Engine from '../core/Engine.js';
import GameObject from '../core/GameObject.js';
import Vector2 from '../math/Vector2.js';
import ResourceLoader from '../core/Loader.js';
import SpriteComponent from '../components/SpriteComponent.js';
import BoundsComponent from '../components/BoundsComponent.js';
import VisibilityComponent from '../components/VisibilityComponent.js';
import PhysicsComponent from '../components/PhysicsComponent.js';

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
  /** Starting column index for the animation (0-based). */
  startCol?: number;
  /** Ending column index for the animation (0-based). */
  endCol?: number;
  /** Initial position in world space. */
  position?: Vector2;
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

  /** The starting column for the current animation loop. */
  get startCol(): number { return this._spriteComponent.startCol; }
  set startCol(val: number) { this._spriteComponent.startCol = val; }

  /** The ending column for the current animation loop. */
  get endCol(): number { return this._spriteComponent.endCol; }
  set endCol(val: number) { this._spriteComponent.endCol = val; }

  /** The pixel width of a single animation frame (calculated automatically). */
  get frameWidth(): number { return this._spriteComponent.frameWidth; }
  /** Pixel height of a single animation frame (calculated automatically). */
  public get frameHeight(): number { return this._spriteComponent.frameHeight; }

  /** Whether the sprite is currently registered with the engine. */
  public registered: boolean = false;

  /** The current frame index being displayed. */
  public get currentFrame(): number { return this._spriteComponent.currentFrame; }
  public set currentFrame(val: number) { 
    this._spriteComponent.currentFrame = val; 
    this._updateBounds();
  }

  /** Whether the sprite is horizontally flipped. */
  public get flip(): boolean { return this._spriteComponent.flip; }
  public set flip(val: boolean) { this._spriteComponent.flip = val; }

  /** Duration of each animation frame in milliseconds. */
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

    this._spriteComponent = new SpriteComponent(
      img,
      props.rows,
      props.cols,
      props.startCol ?? 0,
      props.endCol ?? props.cols - 1
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
      this.bounds.width = this.frameWidth;
      this.bounds.height = this.frameHeight;
    }
  }

  /**
   * Registers the sprite with the engine and starts its animation loop.
   */
  play() {
    this._spriteComponent.playing = true;
    if (!this.registered) {
      Engine.registerObject(this);
      this.registered = true;
    }
  }

  /**
   * Stops the sprite's animation and removes it from the engine.
   */
  stop() {
    this._spriteComponent.playing = false;
    Engine.destroyObject(this);
  }
}
