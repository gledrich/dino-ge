import type GameObject from './GameObject.js';
import type Vector2 from '../math/Vector2.js';
import VisibilityComponent from '../components/VisibilityComponent.js';

/** An action description that can be reused in multiple queues. */
export type Action = Readonly<{ duration: number } & (
  | { kind: 'move'; x: number; y: number }
  | { kind: 'wait' }
  | { kind: 'fade'; opacity: number }
)> | Readonly<{ kind: 'call'; callback: (object: GameObject) => void }>;

type TimedAction = Exclude<Action, { kind: 'call' }>;

function durationInSeconds(duration: number): number {
  if (!Number.isFinite(duration) || duration < 0) {
    throw new RangeError('Action duration must be a finite, non-negative number of seconds.');
  }
  return duration;
}

/** Factories for actions that run in an object's queue. */
export default class Actions {
  /** Linearly moves to a local position over the given number of seconds. */
  static moveTo({ x, y }: Pick<Vector2, 'x' | 'y'>, duration: number): Action {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new RangeError('Action position must have finite coordinates.');
    }
    return { kind: 'move', x, y, duration: durationInSeconds(duration) };
  }

  /** Waits for the given number of seconds before starting the next action. */
  static wait(duration: number): Action {
    return { kind: 'wait', duration: durationInSeconds(duration) };
  }

  /** Linearly fades to an opacity between zero and one without toggling visibility. */
  static fadeTo(opacity: number, duration: number): Action {
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
      throw new RangeError('Action opacity must be between zero and one.');
    }
    return { kind: 'fade', opacity, duration: durationInSeconds(duration) };
  }

  /** Runs the callback once when this action reaches the front of the queue. */
  static call(callback: (object: GameObject) => void): Action {
    if (typeof callback !== 'function') throw new TypeError('Action callback must be a function.');
    return { kind: 'call', callback };
  }
}

function snapshot(action: Action): Action {
  switch (action.kind) {
    case 'move':
      return Actions.moveTo(action, action.duration);
    case 'wait':
      return Actions.wait(action.duration);
    case 'fade':
      return Actions.fadeTo(action.opacity, action.duration);
    case 'call':
      return Actions.call(action.callback);
    default:
      throw new TypeError('Unknown action kind.');
  }
}

/** Runs an object's actions in order and carries unused time to the next action. */
export class ActionQueue {
  private pending: Action[] = [];
  private current?: { elapsed: number; apply?: (progress: number) => void };
  private advancing = false;

  constructor(private readonly object: GameObject) {}

  /** Validates and copies the whole batch before appending it. New work added during advancement starts on a later frame. */
  enqueue(...actions: Action[]): void {
    const batch = actions.map(snapshot);
    for (const action of batch) this.pending.push(action);
  }

  /** Discards the running action and all pending actions, keeping the current pose. */
  clear(): void {
    this.pending = [];
    this.current = undefined;
  }

  /** @internal Advances by the game time elapsed this frame, in seconds. */
  advance(delta: number, canContinue?: () => boolean): void {
    if (this.advancing || !this.pending.length || !Number.isFinite(delta) || delta < 0) return;

    const pending = this.pending;
    const count = pending.length;
    let index = 0;
    this.advancing = true;
    try {
      while (pending === this.pending && index < count && (canContinue?.() ?? true)) {
        const action = pending[index];
        if (action.kind === 'call') {
          index++;
          action.callback(this.object);
          continue;
        }

        if (delta === 0 && action.duration > 0) break;
        const current = this.current ??= { elapsed: 0, apply: this.startTween(action) };
        const remaining = action.duration - current.elapsed;
        // Round-off across many frames can leave elapsed time just below the boundary.
        const finished = delta >= remaining || remaining - delta <= action.duration * 1e-12;
        if (!finished) {
          current.elapsed += delta;
          current.apply?.(current.elapsed / action.duration);
          break;
        }

        index++;
        this.current = undefined;
        delta = Math.max(0, delta - remaining);
        current.apply?.(1);
      }
    } finally {
      pending.splice(0, index);
      this.advancing = false;
    }
  }

  private startTween(action: TimedAction): ((progress: number) => void) | undefined {
    switch (action.kind) {
      case 'move': {
        const { x, y } = this.object.transform.position;
        return progress => {
          this.object.transform.position.set(
            x * (1 - progress) + action.x * progress,
            y * (1 - progress) + action.y * progress,
          );
        };
      }
      case 'fade': {
        let visibility = this.object.getComponent(VisibilityComponent);
        if (!visibility) {
          visibility = new VisibilityComponent();
          this.object.addComponent(visibility);
        }
        const component = visibility;
        const start = component.opacity;
        return progress => { component.opacity = start * (1 - progress) + action.opacity * progress; };
      }
      case 'wait':
        return undefined;
    }
  }
}
