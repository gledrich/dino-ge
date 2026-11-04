import ScreenUI from './ScreenUI.js';
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
    const ctx = { canvas, save: jest.fn(), restore: jest.fn(), fillRect: jest.fn(), fillText: jest.fn() };
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
});
