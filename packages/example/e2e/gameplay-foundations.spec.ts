import { expect, test } from '@playwright/test';

type LayerDraw = { sourceX: number; opacity: number };
type ActorDraw = { x: number; pose: string; opacity: number; status: string };

test('renders layered Tiled atlases and plays the delivery sequence', async ({ page }) => {
  await page.clock.install();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.addInitScript(() => {
    const observed = window as typeof window & { relayLayers: LayerDraw[]; actorDraws: ActorDraw[] };
    observed.relayLayers = [];
    observed.actorDraws = [];
    const drawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (image, ...args) {
      Reflect.apply(drawImage, this, [image, ...args]);
      if (this.canvas.id !== 'canvas' || !(image instanceof HTMLImageElement) || args.length !== 8) return;

      const asset = new URL(image.src).pathname.split('/').pop();
      const [sourceX, sourceY, , , x, y] = args;
      if (asset === 'relay.svg' && x === 224 && y === 32 && observed.relayLayers.length < 2) {
        observed.relayLayers.push({ sourceX, opacity: this.globalAlpha });
      }
      if (asset === 'explorer-walk.png') {
        const status = document.querySelector('[role=status]')?.textContent?.trim() ?? '';
        observed.actorDraws.push({
          x: this.getTransform().e,
          pose: `${sourceX}:${sourceY}`,
          opacity: this.globalAlpha,
          status,
        });
      }
    };
  });

  const observe = () => page.evaluate(() => {
    const observed = window as typeof window & { relayLayers: LayerDraw[]; actorDraws: ActorDraw[] };
    return { layers: observed.relayLayers, actor: observed.actorDraws };
  });

  await page.goto('/gameplay-foundations.html');
  await expect(page.getByRole('heading', { name: 'Gameplay foundations' })).toBeVisible();
  const status = page.getByRole('status');
  const replay = page.getByRole('button', { name: 'Replay delivery' });
  await expect(status).toHaveText('Ready to deliver.');
  await expect.poll(async () => (await observe()).layers).toHaveLength(2);
  const [floor, beacon] = (await observe()).layers;
  expect(floor).toEqual({ sourceX: 0, opacity: 1 });
  expect(beacon.sourceX).toBe(32);
  expect(beacon.opacity).toBeCloseTo(0.7, 6);

  await expect.poll(async () => (await observe()).actor.at(-1)?.x).toBe(32);
  await replay.click();
  await page.clock.runFor(950);
  const beforeReplay = (await observe()).actor.at(-1)!;
  expect(beforeReplay.x).toBeGreaterThan(120);

  await replay.click();
  await page.clock.runFor(160);
  const afterReplay = (await observe()).actor.at(-1)!;
  expect(afterReplay.x).toBeLessThan(beforeReplay.x);
  expect(afterReplay.opacity).toBe(1);
  await page.clock.runFor(3500);
  await expect(status).toHaveText('Delivery complete.');

  const { actor } = await observe();
  const walking = actor.filter(draw => draw.status === 'Walking to the relay…' && draw.x > 32 && draw.x < 224);
  expect(new Set(walking.map(draw => draw.pose)).size).toBeGreaterThan(1);
  const waiting = actor.filter(draw => draw.status === 'Waiting at the relay…');
  expect(waiting.length).toBeGreaterThan(1);
  for (const draw of waiting) {
    expect(draw.x).toBeCloseTo(224);
    expect(draw.opacity).toBe(1);
  }
  const fading = actor.filter(draw => draw.status === 'Fading out…');
  expect(fading.some(draw => draw.opacity > 0 && draw.opacity < 1)).toBe(true);
  expect(actor.at(-1)?.opacity).toBe(0);
  expect(errors).toEqual([]);
});
