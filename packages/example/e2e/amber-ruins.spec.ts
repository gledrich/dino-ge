import { expect, test, type Page } from '@playwright/test';
import { clickCanvasText, expectCanvasText, observeCanvasUI } from './canvas-ui';

type ExplorerFrame = { x: number; y: number; pose: string };

async function step(page: Page, key: string, count = 1) {
  for (let index = 0; index < count; index++) {
    await page.keyboard.down(key);
    await page.clock.runFor(32);
    await page.keyboard.up(key);
    await page.clock.runFor(160);
  }
}

test.beforeEach(async ({ page }) => {
  await page.clock.install();
  await observeCanvasUI(page);
  await page.addInitScript(() => {
    const observed = window as typeof window & {
      startedSounds: boolean[];
      drawnSprites: Set<string>;
      explorerFrame?: ExplorerFrame;
    };
    observed.startedSounds = [];
    observed.drawnSprites = new Set();
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      start.apply(this, args);
      observed.startedSounds.push(this.loop);
    };
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (image, ...args) {
      Reflect.apply(draw, this, [image, ...args]);
      if (!(image instanceof HTMLImageElement)) return;
      const asset = image.src.split('/').at(-1) ?? '';
      observed.drawnSprites.add(asset);
      if (asset.startsWith('explorer')) {
        const transform = this.getTransform();
        observed.explorerFrame = { x: transform.e, y: transform.f, pose: `${args[0]}:${args[1]}` };
      }
    };
  });
  await page.goto('/');
  await expectCanvasText(page, 'AMBER RUINS');
  await clickCanvasText(page, 'Start expedition');
  await expectCanvasText(page, 'The Gatehouse');
});

test('collects three relics, crosses rooms and unlocks the exit', async ({ page, browserName }) => {
  await expect.poll(() => page.evaluate(() =>
    Array.from((window as typeof window & { drawnSprites: Set<string> }).drawnSprites)
  )).toEqual(expect.arrayContaining(['explorer-walk.png', 'amber.png']));
  const startedSounds = () => page.evaluate(() =>
    (window as typeof window & { startedSounds: boolean[] }).startedSounds
  );
  if (browserName === 'chromium') await expect.poll(startedSounds).toContain(true);
  await step(page, 'ArrowRight', 2);
  await expectCanvasText(page, 'Health 2 / 3');
  await step(page, 'ArrowUp');
  await step(page, 'ArrowRight');
  await expectCanvasText(page, 'Relics 1 / 3');
  await step(page, 'ArrowDown');
  await step(page, 'ArrowRight', 7);
  await expectCanvasText(page, 'The Spike Gallery');
  await expectCanvasText(page, 'Relics 2 / 3');
  await step(page, 'ArrowRight', 6);
  await expectCanvasText(page, 'The Amber Vault');
  await step(page, 'ArrowUp');
  await step(page, 'ArrowRight', 2);
  await expectCanvasText(page, 'Relics 3 / 3');
  await step(page, 'ArrowDown');
  await step(page, 'ArrowRight', 3);
  await expectCanvasText(page, 'Expedition complete');
  if (browserName === 'chromium') expect((await startedSounds()).filter(loop => !loop)).toHaveLength(5);
  await clickCanvasText(page, 'Try again');
  await expectCanvasText(page, 'Health 3 / 3');
  await expectCanvasText(page, 'Relics 0 / 3');
});

test('the explorer changes pose while moving and settles in the next tile', async ({ page }) => {
  const frame = () => page.evaluate(() =>
    (window as typeof window & { explorerFrame: ExplorerFrame }).explorerFrame
  );
  await expect.poll(async () => (await frame())?.pose).toBeTruthy();
  const idle = await frame();
  await page.keyboard.down('ArrowRight');
  await page.clock.runFor(80);
  await page.keyboard.up('ArrowRight');
  const walking = await frame();
  await page.clock.runFor(160);
  const settled = await frame();

  expect(walking.x).toBeGreaterThan(idle.x);
  expect(walking.x).toBeLessThan(settled.x);
  expect(walking.pose).not.toBe(idle.pose);
  expect(settled.pose).toBe(idle.pose);
});

test('walls block movement and a standard gamepad can reach the locked gate', async ({ page }) => {
  await step(page, 'ArrowUp');
  await step(page, 'ArrowRight', 8);
  await expectCanvasText(page, 'The Gatehouse');
  await expectCanvasText(page, 'Relics 1 / 3');
  await step(page, 'ArrowDown');

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [null, { connected: true, mapping: 'standard', axes: [1, 0] }],
    });
  });
  await page.clock.runFor(2600);
  await expectCanvasText(page, 'The Amber Vault');
  await expectCanvasText(page, 'Relics 2 / 3');
  await expectCanvasText(page, 'The vault gate needs all three amber relics.');
});

test('can lose on a hazard and restart with sound muted', async ({ page }) => {
  await clickCanvasText(page, 'Mute sound');
  await expectCanvasText(page, 'Unmute sound');
  await step(page, 'ArrowRight', 2);
  await page.clock.runFor(2600);
  await expectCanvasText(page, 'Expedition lost');
  await clickCanvasText(page, 'Try again');
  await expectCanvasText(page, 'Health 3 / 3');
  await expectCanvasText(page, 'Unmute sound');
});
