import { test, type Page } from '@playwright/test';
import { clickCanvasText, expectCanvasText, observeCanvasUI } from './canvas-ui';

async function walk(page: Page, key: string, count = 1) {
  for (let step = 0; step < count; step++) {
    await page.keyboard.down(key);
    await page.clock.runFor(32);
    await page.keyboard.up(key);
    await page.clock.runFor(150);
  }
}

async function interact(page: Page) {
  await walk(page, 'e');
}

test.beforeEach(async ({ page }) => {
  await page.clock.install();
  await observeCanvasUI(page);
  await page.goto('/');
});

test('Lanternreach draws all four explorer poses during a step', async ({ page }) => {
  await page.evaluate(() => {
    const poses = new Set<string>();
    Object.assign(window, { explorerPoses: poses });
    const drawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (image, ...args) {
      if (image instanceof HTMLImageElement && image.src.endsWith('/explorer-walk.png') && args.length === 8) {
        poses.add(`${args[0]}:${args[1]}`);
      }
      Reflect.apply(drawImage, this, [image, ...args]);
    };
  });
  await clickCanvasText(page, 'Begin chapter');
  await walk(page, 'ArrowRight');
  const poses = await page.evaluate(() => Array.from(
    (window as typeof window & { explorerPoses: Set<string> }).explorerPoses,
  ).sort());
  test.expect(poses).toEqual(['0:0', '0:627', '627:0', '627:627']);
});

test('restoring the bridge opens the Skywell and the lit beacon survives a reload', async ({ page }) => {
  await clickCanvasText(page, 'Begin chapter');
  await expectCanvasText(page, 'Lanternreach');
  await walk(page, 'ArrowRight', 2);
  await interact(page);
  await expectCanvasText(page, 'Iona · Keeper of Lanternreach');
  await interact(page);
  await walk(page, 'ArrowRight', 2);
  await expectCanvasText(page, 'The Reedbank');
  await walk(page, 'ArrowRight', 2);
  await interact(page);
  await expectCanvasText(page, 'Reedwood recovered');
  await walk(page, 'ArrowRight', 2);
  await expectCanvasText(page, 'The Sunken Archive');
  await walk(page, 'ArrowRight', 2);
  await interact(page);
  await expectCanvasText(page, 'The archive sluice is open');
  await walk(page, 'ArrowUp');
  await walk(page, 'ArrowRight', 3);
  await walk(page, 'ArrowDown');
  await walk(page, 'ArrowRight', 2);
  await interact(page);
  await expectCanvasText(page, 'Amber lens recovered');
  await walk(page, 'ArrowLeft', 2);
  await walk(page, 'ArrowUp');
  await walk(page, 'ArrowLeft', 3);
  await walk(page, 'ArrowDown');
  await walk(page, 'ArrowLeft', 3);
  await expectCanvasText(page, 'The Reedbank');
  await walk(page, 'ArrowLeft', 4);
  await expectCanvasText(page, 'Lanternreach');
  await walk(page, 'ArrowUp');
  await interact(page);
  await expectCanvasText(page, 'The bridge is restored');
  await walk(page, 'ArrowUp', 2);
  await expectCanvasText(page, 'The Skywell');
  await walk(page, 'ArrowUp', 2);
  await interact(page);
  await expectCanvasText(page, 'The Skywell shines again');
  await page.reload();
  await clickCanvasText(page, 'Continue chapter');
  await expectCanvasText(page, 'The beacon is lit');
});

test('an invalid save leaves the chapter playable', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('amber-ruins.chapter.v1', '{'));
  await page.reload();
  await clickCanvasText(page, 'Begin chapter');
  await expectCanvasText(page, 'Lanternreach');
});

test('moonbells planted at the outpost are recorded in the journal after a reload', async ({ page }) => {
  await clickCanvasText(page, 'Begin chapter');
  await walk(page, 'ArrowRight', 4);
  await expectCanvasText(page, 'The Reedbank');
  await walk(page, 'ArrowRight', 3);
  await walk(page, 'ArrowUp', 2);
  await walk(page, 'ArrowRight');
  await interact(page);
  await expectCanvasText(page, 'Moonbells gathered');
  await walk(page, 'ArrowLeft');
  await walk(page, 'ArrowDown', 2);
  await walk(page, 'ArrowLeft', 4);
  await interact(page);
  await expectCanvasText(page, 'Iona · Keeper of Lanternreach');
  await interact(page);
  await expectCanvasText(page, 'Moonbells planted at the cabin');
  await page.reload();
  await clickCanvasText(page, 'Continue chapter');
  await walk(page, 'j');
  await expectCanvasText(page, 'Beacon  ○     Moonbells  Planted');
});
