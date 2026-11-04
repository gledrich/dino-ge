import { expect, type Page } from '@playwright/test';

export async function observeCanvasUI(page: Page) {
  await page.addInitScript(() => {
    const observed = window as typeof window & { canvasLabels: Record<string, { x: number; y: number }> };
    observed.canvasLabels = {};
    const rectangle = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function (x, y, width, height) {
      rectangle.call(this, x, y, width, height);
      if (this.canvas.id === 'canvas' && x === 0 && y === 0 &&
          width === this.canvas.width && height === this.canvas.height) observed.canvasLabels = {};
    };
    const label = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (...args) {
      label.apply(this, args);
      if (this.canvas.id === 'canvas') observed.canvasLabels[args[0]] = { x: args[1], y: args[2] };
    };
  });
}

async function canvasLabels(page: Page) {
  return page.evaluate(() =>
    (window as typeof window & { canvasLabels: Record<string, { x: number; y: number }> }).canvasLabels
  );
}

export async function expectCanvasText(page: Page, text: string) {
  await expect.poll(async () => Object.keys(await canvasLabels(page))).toContain(text);
}

export async function clickCanvasText(page: Page, text: string) {
  await expectCanvasText(page, text);
  const canvas = page.locator('#canvas');
  const point = (await canvasLabels(page))[text];
  const rect = await canvas.boundingBox();
  const size = await canvas.evaluate(node => ({
    width: (node as HTMLCanvasElement).width,
    height: (node as HTMLCanvasElement).height,
  }));
  if (!rect) throw new Error('The game canvas is not visible.');
  await page.mouse.click(rect.x + point.x * rect.width / size.width, rect.y + point.y * rect.height / size.height);
}
