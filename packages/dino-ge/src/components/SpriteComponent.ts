import RenderComponent from './RenderComponent.js';
import { SpriteAnimationPlayer, type SpriteAnimationClip, type SpriteAnimationOptions } from '../objects/SpriteAnimation.js';

/**
 * Component that holds data for rendering an animated sprite.
 */
export default class SpriteComponent extends RenderComponent {
  /** The source image for the sprite. */
  img: HTMLImageElement;
  /** Number of rows in the spritesheet. */
  rows: number;
  /** Number of columns in the spritesheet. */
  cols: number;
  /** The starting column for the current animation loop. */
  startCol: number;
  /** The ending column for the current animation loop. */
  endCol: number;
  /** The pixel width of a single animation frame. */
  frameWidth: number = 0;
  /** The pixel height of a single animation frame. */
  frameHeight: number = 0;
  /** The current frame index being displayed. */
  currentFrame: number = 0;
  /** Whether the sprite is horizontally flipped. */
  flip: boolean = false;
  /** Duration of each animation frame in milliseconds. */
  frameDuration: number = 100;
  /** Whether the sprite is currently playing its animation. */
  playing: boolean = false;
  
  #lastFrameUpdate: number = Date.now();
  private readonly animations?: SpriteAnimationPlayer;

  constructor(
    img: HTMLImageElement, rows: number, cols: number, startCol: number, endCol: number,
    animations?: Readonly<Record<string, SpriteAnimationClip>>,
    private readonly displaySize?: Readonly<{ width: number; height: number }>,
  ) {
    super();
    this.img = img;
    this.rows = rows;
    this.cols = cols;
    this.startCol = startCol;
    this.endCol = endCol;
    this.currentFrame = startCol;
    if (animations) this.animations = new SpriteAnimationPlayer(animations, rows, cols);

    const setDimensions = () => {
      this.frameWidth = this.img.width / this.cols;
      this.frameHeight = this.img.height / this.rows;
    };

    if (this.img.complete) {
      setDimensions();
    } else {
      this.img.addEventListener('load', setDimensions, { once: true });
    }
  }

  /** @internal */
  get displayWidth(): number { return this.displaySize?.width ?? this.frameWidth; }
  /** @internal */
  get displayHeight(): number { return this.displaySize?.height ?? this.frameHeight; }
  /** @internal */
  get currentAnimation(): string | undefined { return this.animations?.name; }
  /** @internal */
  get currentAnimationFrame(): number | undefined { return this.animations?.index; }
  /** @internal */
  get animationPlaying(): boolean { return this.animations?.playing ?? false; }

  /** @internal */
  playAnimation(name: string, options: SpriteAnimationOptions): void {
    if (!this.animations) throw new RangeError(`Unknown sprite animation: ${name}`);
    this.animations.play(name, options);
    this.playing = false;
  }

  /** @internal */
  pauseAnimation(): void { this.animations?.pause(); }
  /** @internal */
  stopAnimation(): void { this.animations?.stop(); }
  /** @internal */
  clearAnimation(): void { this.animations?.clear(); }

  /** Advances named clips from the engine update loop, in seconds. @internal */
  advanceAnimation(deltaSeconds: number): void {
    this.animations?.advance(deltaSeconds);
  }

  /**
   * Draws the current frame of the sprite.
   * @param ctx The canvas 2D rendering context.
   */
  draw(ctx: CanvasRenderingContext2D) {
    if (!this.frameWidth || !this.frameHeight || !this.gameObject) return;

    const namedFrame = this.animations?.frame;
    if (namedFrame === undefined) {
      const now = Date.now();
      if (this.playing && now - this.#lastFrameUpdate > this.frameDuration) {
        this.currentFrame += 1;
        this.#lastFrameUpdate = now;
      }

      if (this.currentFrame < this.startCol || this.currentFrame >= this.endCol) {
        this.currentFrame = this.startCol;
      }
    }

    const { img, cols, frameWidth, frameHeight, displayWidth, displayHeight } = this;
    const frame = namedFrame ?? this.currentFrame;
    const source = typeof frame === 'number'
      ? { x: (frame % cols) * frameWidth, y: Math.floor(frame / cols) * frameHeight, width: frameWidth, height: frameHeight }
      : frame;
    const { worldPosition, worldRotation, worldScale } = this.gameObject.transform;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.save();
    ctx.translate(worldPosition.x, worldPosition.y);
    if (worldRotation !== 0) ctx.rotate(worldRotation);
    ctx.scale(worldScale.x, worldScale.y);

    if (this.flip) {
      ctx.translate(displayWidth, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(img, source.x, source.y, source.width, source.height, 0, 0, displayWidth, displayHeight);
    ctx.restore();
  }
}
