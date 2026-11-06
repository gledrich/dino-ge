/** An unrotated rectangle in the source image, in pixels. */
export interface SpriteFrameRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A grid cell or atlas crop and its display time. */
export interface SpriteAnimationFrame {
  /** A zero-based row-major cell index or a rectangle in the same source image. */
  readonly frame: number | SpriteFrameRect;
  readonly durationMs: number;
}

/** A clip can loop, finish on its last frame, or bounce between its endpoints. */
export type SpriteAnimationMode = 'loop' | 'once' | 'pingPong';

export interface SpriteAnimationClip {
  readonly frames: readonly SpriteAnimationFrame[];
  /** Defaults to looping. */
  readonly mode?: SpriteAnimationMode;
}

export interface SpriteAnimationOptions {
  readonly mode?: SpriteAnimationMode;
  /** Start from the first frame even when this clip is already selected. */
  readonly restart?: boolean;
  /** Called after a one-shot clip has displayed its final frame for its full duration. */
  readonly onComplete?: () => void;
}

function validateMode(mode: SpriteAnimationMode): void {
  if (mode !== 'loop' && mode !== 'once' && mode !== 'pingPong') {
    throw new RangeError(`Invalid sprite animation mode: ${mode}`);
  }
}

interface FrameTiming {
  index: number;
  end: number;
}

interface Playback {
  name: string;
  frames: readonly SpriteAnimationFrame[];
  timeline: FrameTiming[];
  duration: number;
  mode: SpriteAnimationMode;
  onComplete?: () => void;
  index: number;
  elapsed: number;
  state: 'playing' | 'paused' | 'stopped' | 'completed';
}

/** @internal */
export class SpriteAnimationPlayer {
  private readonly clips = new Map<string, SpriteAnimationClip>();
  private playback?: Playback;

  constructor(clips: Readonly<Record<string, SpriteAnimationClip>>, rows: number, cols: number) {
    for (const name of Object.keys(clips)) {
      const clip = clips[name];
      if (!name.trim() || !Array.isArray(clip?.frames) || clip.frames.length === 0) {
        throw new RangeError(`Sprite animation "${name}" needs a name and at least one frame`);
      }
      const mode = clip.mode ?? 'loop';
      validateMode(mode);
      const frames = Array.from(clip.frames, ({ frame, durationMs }: SpriteAnimationFrame) => {
        if (!Number.isFinite(durationMs) || durationMs <= 0) {
          throw new RangeError(`Sprite animation "${name}" has an invalid frame duration`);
        }
        const valid = typeof frame === 'number'
          ? Number.isInteger(frame) && frame >= 0 && frame < rows * cols
          : frame && [frame.x, frame.y, frame.width, frame.height].every(Number.isFinite)
            && frame.x >= 0 && frame.y >= 0 && frame.width > 0 && frame.height > 0;
        if (!valid) throw new RangeError(`Sprite animation "${name}" has an invalid source frame`);
        const source = typeof frame === 'number'
          ? frame
          : { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
        return { frame: source, durationMs };
      });
      this.clips.set(name, { frames, mode });
    }
  }

  get name(): string | undefined { return this.playback?.name; }
  get index(): number | undefined { return this.playback?.index; }
  get playing(): boolean { return this.playback?.state === 'playing'; }
  get frame(): SpriteAnimationFrame['frame'] | undefined {
    const playback = this.playback;
    return playback?.frames[playback.index].frame;
  }

  play(name: string, options: SpriteAnimationOptions): void {
    const clip = this.clips.get(name);
    if (!clip) throw new RangeError(`Unknown sprite animation: ${name}`);
    const playback = this.playback;
    const sameClip = playback?.name === name;
    const mode = options.mode ?? (sameClip ? playback.mode : clip.mode ?? 'loop');
    validateMode(mode);

    if (sameClip && playback.mode === mode && !options.restart && playback.state !== 'stopped') {
      if (playback.state !== 'completed') {
        playback.state = 'playing';
        if (options.onComplete !== undefined) playback.onComplete = options.onComplete;
      }
      return;
    }

    let duration = 0;
    const timeline = clip.frames.map(({ durationMs }, index) => {
      duration += durationMs;
      return { index, end: duration };
    });
    if (mode === 'pingPong') {
      for (let index = clip.frames.length - 2; index > 0; index--) {
        duration += clip.frames[index].durationMs;
        timeline.push({ index, end: duration });
      }
    }
    if (!Number.isFinite(duration)) throw new RangeError(`Sprite animation "${name}" is too long`);

    this.playback = {
      name, frames: clip.frames, timeline, duration, mode, onComplete: options.onComplete,
      elapsed: 0, index: 0, state: 'playing',
    };
  }

  pause(): void {
    if (this.playback?.state === 'playing') this.playback.state = 'paused';
  }

  stop(): void {
    if (!this.playback) return;
    this.playback.state = 'stopped';
    this.playback.onComplete = undefined;
  }

  clear(): void {
    this.playback = undefined;
  }

  advance(deltaSeconds: number): void {
    const playback = this.playback;
    const deltaMs = deltaSeconds * 1000;
    if (playback?.state !== 'playing' || !Number.isFinite(deltaMs) || deltaMs <= 0) return;

    const elapsed = playback.elapsed + deltaMs % playback.duration;
    if (playback.mode === 'once' && reachedBoundary(playback.elapsed + deltaMs, playback.duration)) {
      playback.index = playback.frames.length - 1;
      playback.state = 'completed';
      const onComplete = playback.onComplete;
      playback.onComplete = undefined;
      onComplete?.();
      return;
    }

    playback.elapsed = reachedBoundary(elapsed, playback.duration)
      ? Math.max(0, elapsed - playback.duration)
      : elapsed;
    playback.index = playback.timeline.find(({ end }) => !reachedBoundary(playback.elapsed, end))?.index ?? 0;
  }
}

// Repeated fractional game steps can sum to just below a frame boundary.
function reachedBoundary(elapsed: number, boundary: number): boolean {
  return elapsed >= boundary - boundary * (4 * Number.EPSILON);
}
