import type Scene from './Scene.js';

export interface SceneTransitionOptions {
  type: 'fade' | 'slide';
  /** Duration in seconds. Zero switches scenes immediately. */
  duration?: number;
  /** Fade colour. Defaults to black. */
  colour?: string;
}

interface Transition {
  scene: Scene | null;
  type: SceneTransitionOptions['type'];
  duration: number;
  colour: string;
  elapsed: number;
}

interface Pulse {
  strength: number;
  remaining: number;
  duration: number;
}

const channels = [
  { colour: '#ff0000', direction: 1 },
  { colour: '#00ff00', direction: 0 },
  { colour: '#0000ff', direction: -1 },
];

/** Owns visual effects for one engine instance. */
export default class SceneEffects {
  private transition?: Transition;
  private shake?: Pulse;
  private aberration?: Pulse;
  private clearAfterAberration = false;
  private buffers?: { source: CanvasRenderingContext2D; channel: CanvasRenderingContext2D };

  public startTransition(scene: Scene | null, { type, duration = 0.4, colour = 'black' }: SceneTransitionOptions) {
    this.transition = { scene, type, duration, colour, elapsed: 0 };
  }

  public startShake(strength: number, duration: number): void {
    this.shake = this.createPulse(strength, duration);
  }

  public startAberration(strength: number, duration: number): void {
    this.aberration = this.createPulse(strength, duration);
  }

  private createPulse(strength: number, duration: number): Pulse | undefined {
    return Number.isFinite(strength) && strength > 0 && Number.isFinite(duration) && duration > 0
      ? { strength, duration, remaining: duration }
      : undefined;
  }

  public cancel(): void {
    this.transition = undefined;
    this.shake = undefined;
    this.aberration = undefined;
    this.buffers = undefined;
  }

  public advance(delta: number, activate: (scene: Scene | null) => void): void {
    this.shake = this.advancePulse(this.shake, delta);
    this.aberration = this.advancePulse(this.aberration, delta);

    const transition = this.transition;
    if (!transition) return;
    const wasOutgoing = transition.elapsed < transition.duration / 2;
    transition.elapsed = Math.min(transition.elapsed + delta, transition.duration);
    if (wasOutgoing && transition.elapsed >= transition.duration / 2) {
      this.shake = undefined;
      this.aberration = undefined;
      activate(transition.scene);
    }
    if (this.transition === transition && transition.elapsed >= transition.duration) {
      this.transition = undefined;
    }
  }

  private advancePulse(pulse: Pulse | undefined, delta: number): Pulse | undefined {
    if (!pulse) return;
    pulse.remaining -= delta;
    return pulse.remaining > 0 ? pulse : undefined;
  }

  public prepareFrame(ctx: CanvasRenderingContext2D): void {
    if (this.aberration || this.clearAfterAberration) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
    this.clearAfterAberration = this.aberration !== undefined;
  }

  public drawWorld(ctx: CanvasRenderingContext2D, draw: () => void): void {
    const slide = this.transition?.type === 'slide' ? this.transition : undefined;
    if (!slide && !this.shake) {
      draw();
      return;
    }

    ctx.save();
    try {
      if (slide) {
        const { width, height } = ctx.canvas;
        const progress = slide.elapsed / slide.duration;
        ctx.translate(width * (progress < 0.5 ? -2 * progress : 2 * (1 - progress)), 0);
        ctx.beginPath();
        ctx.rect(0, 0, width, height);
        ctx.clip();
      }
      if (this.shake) {
        const { strength, remaining, duration } = this.shake;
        const amplitude = strength * remaining / duration;
        const phase = (duration - remaining) * 90;
        ctx.translate(Math.sin(phase) * amplitude, Math.sin(phase * 1.7) * amplitude);
      }
      draw();
    } finally {
      ctx.restore();
    }
  }

  public drawOverlays(ctx: CanvasRenderingContext2D): void {
    if (this.aberration) this.drawAberration(ctx, this.aberration);
    if (this.transition?.type !== 'fade') return;

    const { elapsed, duration, colour } = this.transition;
    ctx.save();
    ctx.globalAlpha = 1 - Math.abs(2 * elapsed / duration - 1);
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }

  private drawAberration(ctx: CanvasRenderingContext2D, pulse: Pulse): void {
    const { width, height } = ctx.canvas;
    const offset = Math.min(width, Math.round(pulse.strength * pulse.remaining / pulse.duration));
    if (offset < 1 || !height) return;

    // Blend channels on scratch canvases without reading pixels, so a world
    // containing cross-origin artwork can still use the effect.
    const source = this.buffers?.source ?? document.createElement('canvas').getContext('2d');
    const channel = this.buffers?.channel ?? document.createElement('canvas').getContext('2d');
    if (!source || !channel) return;
    this.buffers = { source, channel };
    for (const scratch of [source, channel]) {
      if (scratch.canvas.width !== width) scratch.canvas.width = width;
      if (scratch.canvas.height !== height) scratch.canvas.height = height;
    }

    source.clearRect(0, 0, width, height);
    source.drawImage(ctx.canvas, 0, 0);

    ctx.save();
    try {
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'lighter';
      for (const { colour, direction } of channels) {
        channel.globalCompositeOperation = 'source-over';
        channel.clearRect(0, 0, width, height);
        channel.drawImage(source.canvas, direction * offset, 0);
        channel.globalCompositeOperation = 'multiply';
        channel.fillStyle = colour;
        channel.fillRect(0, 0, width, height);
        channel.globalCompositeOperation = 'destination-in';
        channel.drawImage(source.canvas, direction * offset, 0);
        ctx.drawImage(channel.canvas, 0, 0);
      }
    } finally {
      ctx.restore();
    }
  }
}
