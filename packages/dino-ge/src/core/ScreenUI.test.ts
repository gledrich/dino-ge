import ScreenUI from './ScreenUI.js';
import Engine from './Engine.js';
import { getEngineState } from './EngineState.js';
import Vector2 from '../math/Vector2.js';

describe('ScreenUI', () => {
  function setup() {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    jest.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 30, y: 20, left: 30, top: 20, right: 230, bottom: 120, width: 200, height: 100,
      toJSON: () => ({}),
    });
    const ctx = {
      canvas, save: jest.fn(), restore: jest.fn(), fillRect: jest.fn(), fillText: jest.fn(),
      drawImage: jest.fn(),
      measureText: jest.fn().mockReturnValue({
        width: 60, actualBoundingBoxLeft: 30, actualBoundingBoxRight: 30,
        actualBoundingBoxAscent: 6, actualBoundingBoxDescent: 4,
      }),
    };
    return { canvas, ctx, ui: new ScreenUI(ctx as unknown as CanvasRenderingContext2D) };
  }

  it('anchors layout to the current canvas dimensions and clamps progress', () => {
    const { ui, ctx, canvas } = setup();
    expect(ui.anchor('centre', 'bottom', 4, -10)).toEqual(new Vector2(204, 190));
    canvas.width = 600;
    expect(ui.anchor('right', 'top', -20, 15)).toEqual(new Vector2(580, 15));
    ui.progressBar({ x: 20, y: 30, width: 80, height: 10, value: 2 });
    expect(ctx.fillRect).toHaveBeenLastCalledWith(20, 30, 80, 10);
  });

  it('dispatches the topmost enabled action using scaled canvas coordinates', () => {
    const { ui, canvas } = setup();
    const under = jest.fn();
    const top = jest.fn();
    const disabled = jest.fn();
    const rect = { x: 40, y: 20, width: 80, height: 40 };
    ui.render(() => {
      ui.button({ ...rect, text: 'Under', onPress: under });
      ui.button({ ...rect, text: 'Top', onPress: top });
      ui.button({ ...rect, text: 'Disabled', onPress: disabled, enabled: false });
    });
    canvas.dispatchEvent(new MouseEvent('click', { clientX: 60, clientY: 40 }));
    expect(top).toHaveBeenCalledTimes(1);
    expect(under).not.toHaveBeenCalled();
    expect(disabled).not.toHaveBeenCalled();

    ui.render(() => {});
    canvas.dispatchEvent(new MouseEvent('click', { clientX: 60, clientY: 40 }));
    expect(top).toHaveBeenCalledTimes(1);
  });

  it('supports keyboard activation and releases canvas listeners when disposed', () => {
    const { ui, canvas } = setup();
    const action = jest.fn();
    ui.render(() => ui.button({ x: 0, y: 0, width: 80, height: 40, text: 'Start', onPress: action }));
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(action).toHaveBeenCalledTimes(1);
    ui.dispose();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('reports completed frames with one row per control and bounds for aligned text', () => {
    const { ui, ctx } = setup();
    const listener = jest.fn();
    const observers = new Set([{ listener }]);
    const rect = { x: 10, y: 20, width: 80, height: 30 };
    const draw = (frame: ScreenUI) => {
      frame.panel(rect, 'white');
      frame.label({ x: 100, y: 40, text: 'Health', align: 'center', maxWidth: 30 });
      frame.image(document.createElement('img'), rect);
      frame.button({ ...rect, id: 'mute', text: 'Mute', onPress: jest.fn(), enabled: false });
      frame.progressBar({ ...rect, value: 2 });
      expect(listener).not.toHaveBeenCalled();
    };

    ui.render(draw, observers);
    expect(ctx.measureText).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      width: 400, height: 200,
      controls: [
        { kind: 'panel', ...rect, colour: 'white' },
        { kind: 'label', x: 85, y: 34, width: 30, height: 10, text: 'Health', colour: '#fff', font: '16px sans-serif' },
        { kind: 'image', ...rect },
        { kind: 'button', ...rect, id: 'mute', text: 'Mute', enabled: false, colour: '#fff',
          background: '#25383e', font: 'bold 14px sans-serif' },
        { kind: 'progressBar', ...rect, value: 1, colour: '#f6b754', background: '#30434a' },
      ],
    });
  });

  it('deduplicates frames, captures source on request and clears on disposal', () => {
    const { ui } = setup();
    const listener = jest.fn();
    const getSourceIndex = jest.fn<number | undefined, []>();
    const observers = new Set([{ listener, getSourceIndex }]);
    const draw = (frame: ScreenUI) => frame.panel({ x: 10, y: 20, width: 20, height: 30 }, 'white');

    ui.render(draw, observers);
    ui.render(draw, observers);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).not.toHaveProperty('source');

    getSourceIndex.mockReturnValue(0);
    ui.render(draw, observers);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1][0].source).toEqual({ index: 0, stack: expect.any(String) });

    getSourceIndex.mockReturnValue(undefined);
    ui.render(draw, observers);
    expect(listener).toHaveBeenCalledTimes(2);
    ui.dispose();
    expect(listener).toHaveBeenLastCalledWith({ width: 400, height: 200, controls: [] });
  });

  it('does no text measurement when unobserved and drops unfinished frames', () => {
    const { ui, ctx } = setup();
    const listener = jest.fn();
    const label = { x: 10, y: 20, text: 'Loading' };
    ui.render(frame => frame.label(label));
    expect(ctx.measureText).not.toHaveBeenCalled();
    expect(() => ui.render(frame => {
      frame.label(label);
      throw new Error('draw failed');
    }, new Set([{ listener }]))).toThrow('draw failed');
    expect(listener).not.toHaveBeenCalled();
    ui.render(frame => frame.label(label));
    expect(ctx.measureText).toHaveBeenCalledTimes(1);
  });

  it('keeps drawing and notifying observers if an inspection callback fails', () => {
    const { ui } = setup();
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('inspector error');
    const stopBroken = Engine.observeScreenUI(() => { throw failure; }, () => { throw failure; });
    const listener = jest.fn();
    const stopListening = Engine.observeScreenUI(listener);
    try {
      ui.render(frame => frame.panel({ x: 0, y: 0, width: 10, height: 10 }, 'red'),
        getEngineState().screenUIObservers);
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ controls: [expect.objectContaining({ colour: 'red' })] }));
      expect(log).toHaveBeenCalledTimes(2);
      stopListening();
      ui.dispose();
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      stopBroken();
      stopListening();
      log.mockRestore();
    }
  });

  it('omits non-serialisable option values from scripts written in JavaScript', () => {
    const { ui } = setup();
    const listener = jest.fn();
    const colour: { self?: unknown } = {};
    colour.self = colour;
    const rect = { x: 0, y: 0, width: 10, height: 10 };
    ui.render(frame => frame.panel(rect, colour as unknown as string), new Set([{ listener }]));
    expect(listener).toHaveBeenCalledWith({ width: 400, height: 200, controls: [{ kind: 'panel', ...rect }] });
  });
});
