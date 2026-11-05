import { describe, expect, it, jest } from '@jest/globals';
import { createScreenUIPreview } from './screen-ui-preview';

const control = (id?: string) => ({ kind: 'button' as const, id, text: 'Play', x: 0, y: 0, width: 30, height: 20 });
const frame = (...controls: ReturnType<typeof control>[]) => ({ width: 100, height: 100, controls });

describe('Screen UI preview selection', () => {
  it('follows an explicit ID through a redraw and clears it when the control disappears', () => {
    const preview = createScreenUIPreview();
    const requestSource = jest.fn();
    const run = preview.start(requestSource);
    run.publish(frame(control('play'), control('quit')));
    preview.select(0);
    expect(requestSource).toHaveBeenLastCalledWith(0);
    run.publish(frame(control('quit'), { ...control('play'), text: 'Continue' }));
    expect(preview.getSnapshot().selected).toBe(1);
    expect(requestSource).toHaveBeenLastCalledWith(1);
    run.publish(frame(control('quit')));
    expect(preview.getSnapshot().selected).toBeUndefined();
  });

  it('clears an anonymous selection when equivalent controls make the new frame ambiguous', () => {
    const preview = createScreenUIPreview();
    const run = preview.start(jest.fn());
    run.publish(frame(control()));
    preview.select(0);
    run.publish(frame(control(), control()));
    expect(preview.getSnapshot().selected).toBeUndefined();
  });

  it('clears an anonymous selection when a different control takes the same draw slot', () => {
    const preview = createScreenUIPreview();
    const run = preview.start(jest.fn());
    run.publish(frame(control()));
    preview.select(0);
    run.publish(frame({ ...control(), x: 30 }));
    expect(preview.getSnapshot().selected).toBeUndefined();
  });

  it('ignores frames from a previous run', () => {
    const preview = createScreenUIPreview();
    const first = preview.start(jest.fn());
    const second = preview.start(jest.fn());
    second.publish(frame(control('current')));
    first.publish(frame(control('old')));
    first.dispose();
    expect(preview.getSnapshot().frame?.controls[0]?.id).toBe('current');
  });
});
