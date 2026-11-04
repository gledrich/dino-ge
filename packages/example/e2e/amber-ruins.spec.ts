import { expect, test, type Page } from '@playwright/test';

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
  await page.addInitScript(() => {
    const observed = window as typeof window & { startedSounds: boolean[]; drawnSprites: Set<string> };
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
      if (image instanceof HTMLImageElement) observed.drawnSprites.add(image.src.split('/').at(-1) ?? '');
    };
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Amber Ruins' })).toBeVisible();
  await page.getByRole('button', { name: 'Start expedition' }).click();
  await expect(page.getByRole('status')).toContainText('The Gatehouse');
});

test('collects three relics, crosses rooms and unlocks the exit', async ({ page }) => {
  const status = page.getByRole('status');
  await expect.poll(() => page.evaluate(() =>
    Array.from((window as typeof window & { drawnSprites: Set<string> }).drawnSprites)
  )).toEqual(expect.arrayContaining(['explorer.png', 'amber.png']));
  const startedSounds = () => page.evaluate(() =>
    (window as typeof window & { startedSounds: boolean[] }).startedSounds
  );
  await expect.poll(startedSounds).toContain(true);
  await step(page, 'ArrowRight', 2);
  await expect(status).toContainText('Health 2 / 3');
  await step(page, 'ArrowUp');
  await step(page, 'ArrowRight');
  await expect(status).toContainText('Relics 1 / 3');
  await step(page, 'ArrowDown');
  await step(page, 'ArrowRight', 7);
  await expect(status).toContainText('The Spike Gallery');
  await expect(status).toContainText('Relics 2 / 3');
  await step(page, 'ArrowRight', 6);
  await expect(status).toContainText('The Amber Vault');
  await step(page, 'ArrowUp');
  await step(page, 'ArrowRight', 2);
  await expect(status).toContainText('Relics 3 / 3');
  await step(page, 'ArrowDown');
  await step(page, 'ArrowRight', 3);
  await expect(page.getByRole('heading', { name: 'Expedition complete' })).toBeVisible();
  expect((await startedSounds()).filter(loop => !loop)).toHaveLength(5);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(status).toContainText('Health 3 / 3');
  await expect(status).toContainText('Relics 0 / 3');
});

test('walls block movement and a standard gamepad can reach the locked gate', async ({ page }) => {
  const status = page.getByRole('status');
  await step(page, 'ArrowUp');
  await step(page, 'ArrowRight', 8);
  await expect(status).toContainText('The Gatehouse');
  await expect(status).toContainText('Relics 1 / 3');
  await step(page, 'ArrowDown');

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [null, { connected: true, mapping: 'standard', axes: [1, 0] }],
    });
  });
  await page.clock.runFor(2600);
  await expect(status).toContainText('The Amber Vault');
  await expect(status).toContainText('Relics 2 / 3');
  await expect(page.getByText('The vault gate needs all three amber relics.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Expedition complete' })).toBeHidden();
});

test('can lose on a hazard and restart with sound muted', async ({ page }) => {
  const mute = page.getByRole('button', { name: 'Mute sound' });
  await mute.click();
  await expect(page.getByRole('button', { name: 'Unmute sound' })).toHaveAttribute('aria-pressed', 'true');
  await step(page, 'ArrowRight', 2);
  await page.clock.runFor(2600);
  await expect(page.getByRole('heading', { name: 'Expedition lost' })).toBeVisible();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('status')).toContainText('Health 3 / 3');
  await expect(page.getByRole('button', { name: 'Unmute sound' })).toHaveAttribute('aria-pressed', 'true');
});
