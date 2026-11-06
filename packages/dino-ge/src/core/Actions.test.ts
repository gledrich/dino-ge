import Actions, { type Action } from './Actions.js';
import GameObject from './GameObject.js';
import Vector2 from '../math/Vector2.js';
import VisibilityComponent from '../components/VisibilityComponent.js';

class Actor extends GameObject {}

describe('Actions', () => {
  it('carries elapsed time through a wait into the next tween', () => {
    const actor = new Actor();
    actor.actions.enqueue(Actions.moveTo(new Vector2(12, -6), 1), Actions.wait(0.5), Actions.fadeTo(0, 1));

    actor.actions.advance(0.5);
    expect(actor.transform.position).toMatchObject({ x: 6, y: -3 });

    actor.actions.advance(1.5);
    expect(actor.transform.position).toMatchObject({ x: 12, y: -6 });
    expect(actor.getComponent(VisibilityComponent)?.opacity).toBe(0.5);
  });

  it('holds the current pose when cleared during a tween', () => {
    const actor = new Actor();
    actor.actions.enqueue(Actions.moveTo(new Vector2(12, 0), 1));
    actor.actions.advance(0.5);
    actor.actions.clear();
    actor.actions.advance(1);
    expect(actor.transform.position.x).toBe(6);
  });

  it('starts each tween from the value at the beginning of its step', () => {
    const actor = new Actor();
    const visibility = new VisibilityComponent(false);
    actor.addComponent(visibility);
    actor.actions.enqueue(Actions.call(object => {
      object.transform.position.set(4, 0);
      visibility.opacity = 0.5;
    }), Actions.moveTo(new Vector2(12, 0), 1), Actions.fadeTo(0, 1));

    actor.actions.advance(0.5);
    expect(actor.transform.position.x).toBe(8);
    actor.actions.advance(1);
    expect(visibility.opacity).toBe(0.25);
    expect(visibility.visible).toBe(false);
  });

  it('defers work enqueued by a callback and stops cleared work', () => {
    const actor = new Actor();
    const calls: string[] = [];
    actor.actions.enqueue(
      Actions.call(object => {
        calls.push('first');
        object.actions.clear();
        object.actions.enqueue(Actions.call(() => calls.push('replacement')));
        object.actions.advance(1);
      }),
      Actions.call(() => calls.push('cleared')),
    );

    actor.actions.advance(1);
    expect(calls).toEqual(['first']);
    actor.actions.advance(1);
    expect(calls).toEqual(['first', 'replacement']);
  });

  it('rechecks whether the engine can advance after running a callback', () => {
    const actor = new Actor();
    let active = true;
    actor.actions.enqueue(Actions.call(() => { active = false; }), Actions.moveTo(new Vector2(12, 0), 0));
    actor.actions.advance(1, () => active);
    expect(actor.transform.position.x).toBe(0);
    actor.actions.advance(1);
    expect(actor.transform.position.x).toBe(12);
  });

  it.each([-1, Infinity, NaN])('rejects a batch with an invalid duration of %s atomically', duration => {
    const actor = new Actor();
    actor.actions.enqueue(Actions.moveTo(new Vector2(5, 0), 0));
    expect(() => actor.actions.enqueue(Actions.moveTo(new Vector2(12, 0), 0), { kind: 'wait', duration }))
      .toThrow(RangeError);
    actor.actions.advance(1);
    expect(actor.transform.position.x).toBe(5);
  });

  it('validates the payload of each public action kind', () => {
    const actor = new Actor();
    const invalid: Action[] = [
      { kind: 'move', x: Infinity, y: 0, duration: 0 },
      { kind: 'fade', opacity: 1.5, duration: 0 },
      { kind: 'call', callback: 3 } as unknown as Action,
      { kind: 'unknown' } as unknown as Action,
    ];
    for (const action of invalid) expect(() => actor.actions.enqueue(action)).toThrow();
  });

  it('keeps the enqueued values when the original descriptor changes', () => {
    const actor = new Actor();
    const action = { kind: 'move' as const, x: 12, y: 0, duration: 1 };
    actor.actions.enqueue(action);
    actor.actions.advance(0.5);
    action.x = 30;
    action.duration = 10;
    actor.actions.advance(0.5);
    expect(actor.transform.position.x).toBe(12);
  });
});
