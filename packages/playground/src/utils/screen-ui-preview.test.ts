import { describe, expect, it, jest } from '@jest/globals';
import { createScreenUIPreview, getScreenUIBounds } from './screen-ui-preview';

const control = (id?: string) => ({ kind: 'button' as const, id, text: 'Play', x: 0, y: 0, width: 30, height: 20 });
const frame = (...controls: ReturnType<typeof control>[]) => ({ width: 100, height: 100, controls });

describe('Screen UI preview selection', () => {
  it('enters without a selection and groups a gesture into one undoable edit', () => {
    const preview = createScreenUIPreview();
    const run = preview.start(jest.fn());
    run.publish(frame(control('play'), control('quit')));
    expect(preview.beginEditing()).toBe(true);
    preview.select(0);
    const finish = preview.beginGesture();
    preview.move(4, 0);
    preview.move(10, 0);
    const move = preview.getSnapshot().moves[0];
    expect(preview.canApplyMove(move)).toBe(false);
    finish?.();
    expect(preview.canApplyMove(move)).toBe(true);
    run.publish(frame(control('quit'), control('play')));
    preview.undo();
    expect(preview.getSnapshot().moves).toEqual([]);
    expect(preview.canApplyMove(move)).toBe(false);
    preview.redo();
    expect(preview.getSnapshot().moves[0]).toMatchObject({ index: 1, x: 10 });
    const cancel = preview.beginGesture();
    preview.resize(2, 0, 10, 0);
    cancel?.(true);
    expect(preview.getSnapshot().moves[0]).toMatchObject({ index: 1, x: 10 });
    preview.undo();
    expect(preview.getSnapshot().moves).toEqual([]);
  });

  it('keeps other controls undoable after applying a change', () => {
    const preview = createScreenUIPreview();
    const run = preview.start(jest.fn());
    run.publish(frame(control('play'), control('quit')));
    preview.beginEditing();
    preview.select(0);
    preview.move(10, 0);
    preview.select(1);
    preview.setProperties({ text: 'Exit' });
    preview.markApplied(preview.getSnapshot().moves[1]);
    preview.undo();
    expect(preview.getSnapshot().moves).toHaveLength(1);
    expect(preview.getSnapshot().moves[0]).toMatchObject({ index: 1, applied: 1 });
  });

  it('undoes and cancels edits to an anonymous control while its frame is unchanged', () => {
    const preview = createScreenUIPreview();
    preview.start(jest.fn()).publish(frame(control(), control()));
    preview.beginEditing();
    preview.select(1);
    const finish = preview.beginGesture();
    preview.move(10, 0);
    finish?.();
    expect(preview.getSnapshot().canUndo).toBe(true);
    const cancel = preview.beginGesture();
    preview.move(20, 0);
    cancel?.(true);
    expect(preview.getSnapshot().moves[0]).toMatchObject({ index: 1, x: 10 });
    preview.undo();
    expect(preview.getSnapshot().moves).toEqual([]);
  });

  it('restores code redo even after a new preview edit to the same control', () => {
    const preview = createScreenUIPreview();
    preview.start(jest.fn()).publish(frame(control('play'), control('quit')));
    preview.beginEditing();
    preview.select(0);
    preview.move(10, 0);
    const applied = preview.markApplied(preview.getSnapshot().moves[0]);
    applied?.remove();
    preview.move(20, 0);
    preview.select(1);
    preview.move(30, 0);
    applied?.restore();
    preview.undo();
    expect(preview.getSnapshot().moves).toMatchObject([{ index: 0, x: 10, applied: 1 }]);
    expect(preview.getSnapshot().canUndo).toBe(false);
  });

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

  it('sends absolute offsets, preserves independent pending moves and restores discarded positions', () => {
    const preview = createScreenUIPreview();
    const updateEditing = jest.fn();
    const run = preview.start(jest.fn(), updateEditing);
    run.publish(frame(control('play'), control('quit')));
    preview.select(0);
    preview.beginEditing();
    preview.move(12, -4);
    preview.move(18, -4);
    expect(updateEditing).toHaveBeenLastCalledWith({
      positions: [{ index: 0, control: control('play'), x: 18, y: -4 }],
    });
    expect(preview.finishEditing()).toBe(false);
    preview.select(1);
    preview.move(0, 5);
    preview.discardMove();
    expect(preview.getSnapshot().moves).toHaveLength(1);
    run.dispose();
    expect(updateEditing).toHaveBeenLastCalledWith(undefined);
  });

  it('reverts and restores an applied move after the control changes draw order', () => {
    const preview = createScreenUIPreview();
    const run = preview.start(jest.fn());
    run.publish(frame(control('play'), control('quit')));
    preview.select(0);
    preview.beginEditing();
    preview.move(10, 0);
    const applied = preview.markApplied(preview.getSnapshot().moves[0]);
    run.publish(frame(control('quit'), control('play')));
    expect(preview.getSnapshot().moves[0]?.index).toBe(1);
    applied?.remove();
    expect(preview.getSnapshot().moves).toHaveLength(0);
    applied?.restore();
    expect(preview.getSnapshot().moves[0]).toMatchObject({ index: 1, x: 10 });
  });

  it('keeps property edits when moving a control and drops values restored to their original state', () => {
    const preview = createScreenUIPreview();
    const run = preview.start(jest.fn());
    run.publish(frame(control('play')));
    preview.select(0);
    preview.beginEditing();
    preview.setProperties({ width: 15, text: 'Continue' });
    preview.move(4, 2);
    expect(preview.getSnapshot().moves[0]).toMatchObject({ x: 4, y: 2, properties: { width: 15, text: 'Continue' } });
    preview.setProperties({ width: 0, text: 'Play' });
    expect(preview.getSnapshot().moves[0]).toEqual({ index: 0, control: control('play'), x: 4, y: 2 });
    preview.move(0, 0);
    expect(preview.getSnapshot().moves).toHaveLength(0);
  });

  it('uses the latest move offset with previously measured label bounds', () => {
    const label = { kind: 'label' as const, x: 10, y: 8, width: 20, height: 12, text: 'Hi',
      painted: { x: 6, y: 8, width: 28, height: 12 } };
    const edit = { control: label, index: 0, x: 30, y: 6, properties: { text: 'Hello' } };
    expect(getScreenUIBounds(label, edit)).toEqual({ x: 36, y: 14, width: 28, height: 12 });
  });
});
