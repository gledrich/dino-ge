import GameObject from '../core/GameObject.js';
import Vector2 from '../math/Vector2.js';
import VisibilityComponent from '../components/VisibilityComponent.js';

/** Settings for a world-space burst. Time is in seconds and sizes are radii. */
export interface ParticleBurst {
  count: number;
  velocity: (index: number) => Vector2;
  gravity?: Vector2;
  lifetime: number;
  startRadius: number;
  endRadius: number;
  colour: string;
}

export interface ParticleEmitterOptions {
  capacity?: number;
  tag?: string;
  zIndex?: number;
}

interface Particle {
  position: Vector2;
  velocity: Vector2;
  age: number;
  burst: ParticleBurst;
}

type Viewport = { x: number; y: number; width: number; height: number };

/** Renders short-lived visual particles without creating physics bodies. */
export default class ParticleEmitter extends GameObject {
  private particles: Particle[] = [];
  private readonly capacity: number;

  constructor({ capacity = 256, tag = 'particle-emitter', zIndex = 0 }: ParticleEmitterOptions = {}) {
    super(tag, zIndex);
    if (!Number.isSafeInteger(capacity) || capacity < 0) {
      throw new RangeError('Particle capacity must be a non-negative safe integer.');
    }
    this.capacity = capacity;
    this.addComponent(new VisibilityComponent());
    this.registerSelf();
  }

  public get activeCount(): number {
    return this.particles.length;
  }

  /** Emits up to the remaining capacity at a world-space position. */
  public burst(position: Vector2, options: ParticleBurst): void {
    const { count, lifetime, startRadius, endRadius } = options;
    if (!Number.isSafeInteger(count) || count < 0 ||
        !Number.isFinite(lifetime) || lifetime <= 0 ||
        !Number.isFinite(startRadius) || startRadius < 0 ||
        !Number.isFinite(endRadius) || endRadius < 0) {
      throw new RangeError('Invalid particle count, lifetime or radius.');
    }

    const burst = { ...options, gravity: options.gravity?.clone() };
    for (let index = 0; index < count && this.activeCount < this.capacity; index++) {
      const velocity = burst.velocity(index).clone();
      if (this.activeCount >= this.capacity) break;
      this.particles.push({
        position: position.clone(),
        velocity,
        age: 0,
        burst,
      });
    }
  }

  /** @internal Advances particle simulation by one engine step. */
  public advance(delta: number): void {
    let alive = 0;
    for (const particle of this.particles) {
      particle.age += delta;
      if (particle.age >= particle.burst.lifetime) continue;

      const { gravity } = particle.burst;
      if (gravity) {
        particle.position.x += gravity.x * delta * delta / 2;
        particle.position.y += gravity.y * delta * delta / 2;
      }
      particle.position.x += particle.velocity.x * delta;
      particle.position.y += particle.velocity.y * delta;
      if (gravity) {
        particle.velocity.x += gravity.x * delta;
        particle.velocity.y += gravity.y * delta;
      }
      this.particles[alive++] = particle;
    }
    this.particles.length = alive;
  }

  /** @internal Draws visible particles with the world transform already applied. */
  public drawParticles(ctx: CanvasRenderingContext2D, viewport: Viewport): void {
    if (!this.activeCount || this.getComponent(VisibilityComponent)?.visible === false) return;

    ctx.save();
    for (const { position: { x, y }, age, burst } of this.particles) {
      const radius = burst.startRadius + (burst.endRadius - burst.startRadius) * age / burst.lifetime;
      if (x + radius < viewport.x || y + radius < viewport.y ||
          x - radius > viewport.x + viewport.width || y - radius > viewport.y + viewport.height) continue;

      ctx.fillStyle = burst.colour;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
