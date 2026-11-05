import { expect, test } from '@playwright/test';

test('colour separation affects the world while the HUD stays white after resize', async ({ page }) => {
  await page.goto('/bouncy.html');
  await page.evaluate(async () => {
    const { Engine, Rectangle, Vector2 } = await import('/built/index.js');
    Engine.terminateCurrent();
    Engine.resetState();

    const container = document.createElement('div');
    container.id = 'effect-test';
    container.style.cssText = 'width: 80px; height: 40px';
    document.body.append(container);

    const game = new Engine({
      onLoad: () => {
        new Rectangle({ position: new Vector2(20, 5), width: 10, height: 10, colour: '#fff' });
        game.chromaticAberration(4, 60);
        Engine.paused = true;
      },
      drawUI: ui => ui.progressBar({ x: 10, y: 20, width: 10, height: 10, value: 1, colour: '#fff' }),
    }, { containerId: container.id, backgroundColour: 'transparent' });
  });

  const sample = () => page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#effect-test canvas')!;
    const ctx = canvas.getContext('2d')!;
    const pixel = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data];
    return {
      width: canvas.width,
      blue: pixel(17, 10),
      red: pixel(32, 10),
      hud: pixel(11, 25),
      clear: pixel(7, 25),
    };
  });
  const expected = { blue: [0, 0, 255, 255], red: [255, 0, 0, 255], hud: [255, 255, 255, 255], clear: [0, 0, 0, 0] };
  await expect.poll(sample).toEqual({ width: 80, ...expected });
  await page.locator('#effect-test').evaluate(element => { element.style.width = '100px'; });
  await expect.poll(sample).toEqual({ width: 100, ...expected });
});
