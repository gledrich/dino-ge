import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, devices, webkit } from '@playwright/test';

const site = new URL(process.env.DINO_SITE_URL ?? 'http://127.0.0.1:4173');
const playground = new URL('/playground/', site);
const standalone = new URL('/playground/amber-ruins.html', site);
const previewFrame = 'iframe[title="Isolated game preview"]';
const chromiumOptions = { executablePath: process.env.DINO_PREVIEW_CHROMIUM };
const webkitOptions = { executablePath: process.env.DINO_PREVIEW_WEBKIT };
const releaseBroker = process.env.VITE_DINO_PREVIEW_URL;

async function verifyTouchMovement(page, game, container, embedded) {
  const canvas = game.locator(container + ' canvas');
  await canvas.waitFor({ timeout: 15_000 });
  await game.evaluate(async () => {
    const { Engine } = await import('/built/index.js');
    window.readExplorerX = () => [...Engine.objects]
      .find(object => object.metadata.tag === 'explorer')?.transform.position.x;
  });
  await game.waitForFunction(() => Number.isFinite(window.readExplorerX()));
  const box = await canvas.boundingBox();
  assert.ok(box);
  const cardHeight = Math.min(208, Math.max(125, box.height - 100));
  const cardY = Math.max(54, (box.height - cardHeight - (embedded ? 30 : 0)) / 2);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + cardY + cardHeight - 36);
  const initialX = await game.evaluate(() => window.readExplorerX());
  await game.getByRole('button', { name: 'Move right' }).tap();
  await game.waitForFunction(x => window.readExplorerX() > x, initialX, { timeout: 5_000 });
}

const desktop = await chromium.launch(chromiumOptions);
try {
  const page = await desktop.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(site.href);
  await page.getByRole('heading', { name: 'Build 2D games for the web.' }).waitFor();
  await page.getByRole('link', { name: 'Read the docs' }).click();
  await page.locator('#first-scene canvas').waitFor();
  await page.getByRole('link', { name: 'Browse the API reference' }).click();
  assert.match(page.url(), /\/docs\/api\//);
  await page.goto(playground.href);
  await page.locator('.monaco-editor').first().waitFor();
  const game = page.frameLocator(previewFrame);
  await game.locator('#playground-canvas-container canvas').waitFor({ timeout: 15_000 });
  const code = page.locator('.monaco-editor').first();
  await code.locator('.view-lines').click();
  // Monaco uses different document-start shortcuts on macOS and Linux.
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  await page.keyboard.insertText('document.documentElement.dataset.releaseCheck = "saved";\n');
  await code.getByText(/dataset\.releaseCheck/).first().waitFor();
  await page.getByRole('button', { name: 'Save script' }).click();
  await game.locator('html[data-release-check="saved"]').waitFor({ timeout: 15_000 });
  await page.reload();
  await game.locator('html[data-release-check="saved"]').waitFor({ timeout: 15_000 });
  await game.locator('#playground-canvas-container canvas').waitFor();

  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export saved project' }).click();
  const download = await downloading;
  assert.match(download.suggestedFilename(), /\.dino-project\.json$/);
  const backup = await readFile(await download.path());

  const restored = await desktop.newPage();
  await restored.goto(playground.href);
  const restoredGame = restored.frameLocator(previewFrame);
  await restoredGame.locator('#playground-canvas-container canvas').waitFor({ timeout: 15_000 });
  assert.equal(await restoredGame.locator('html[data-release-check="saved"]').count(), 0);
  await restored.getByLabel('Choose project backup').setInputFiles({
    name: download.suggestedFilename(),
    mimeType: 'application/json',
    buffer: backup,
  });
  await restoredGame.locator('html[data-release-check="saved"]').waitFor({ timeout: 15_000 });
  await restoredGame.locator('#playground-canvas-container canvas').waitFor();

  const unavailable = await desktop.newPage();
  await unavailable.route('**/broker.html', route => route.abort());
  await unavailable.goto(playground.href);
  const error = unavailable.getByRole('alert').filter({ hasText: 'timed out while connecting to the isolated preview' });
  await error.waitFor({ timeout: 16_000 });
  await unavailable.locator('.game-runtime-error').getByRole('link', { name: 'Play Amber Ruins directly' }).click();
  const destination = new URL(unavailable.url());
  assert.equal(destination.origin, standalone.origin);
  assert.match(destination.pathname, /^\/playground\/amber-ruins(?:\.html)?\/?$/);
  await unavailable.locator('#amber-ruins-viewport canvas').waitFor();

  if (releaseBroker) {
    const broker = new URL(releaseBroker);
    const foreign = await desktop.newPage();
    // Fulfil a page on the preview origin, which is distinct from the
    // configured site. No additional HTTPS server is required for this check.
    const foreignUrl = new URL('/__foreign-site-check', broker);
    await foreign.route(foreignUrl.href, route => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Unrelated website</title>',
    }));
    await foreign.goto(foreignUrl.href);
    const response = await foreign.evaluate(({ href, origin }) => new Promise((resolve, reject) => {
      const iframe = document.createElement('iframe');
      const timeout = setTimeout(() => reject(new Error('No response from the release broker.')), 5_000);
      window.addEventListener('message', event => {
        if (event.source !== iframe.contentWindow || event.origin !== origin) return;
        clearTimeout(timeout);
        resolve(event.data?.type);
      });
      iframe.src = href;
      document.body.append(iframe);
    }), { href: broker.href, origin: broker.origin });
    assert.equal(response, 'preview-denied');
  }
} finally {
  await desktop.close();
}

const phone = await webkit.launch(webkitOptions);
try {
  const device = devices['iPhone 13'];
  const page = await phone.newPage({ ...device, defaultBrowserType: undefined });
  await page.goto(playground.href);
  const iframe = await page.locator(previewFrame).elementHandle({ timeout: 15_000 });
  const game = await iframe.contentFrame();
  assert.ok(game);
  await verifyTouchMovement(page, game, '#playground-canvas-container', true);

  const standalonePage = await phone.newPage({ ...device, defaultBrowserType: undefined });
  const offOrigin = [];
  standalonePage.on('request', request => {
    if (new URL(request.url()).origin !== standalone.origin) offOrigin.push(request.url());
  });
  await standalonePage.goto(standalone.href);
  await verifyTouchMovement(standalonePage, standalonePage, '#amber-ruins-viewport', false);
  assert.deepEqual(offOrigin, []);
} finally {
  await phone.close();
}

console.log('Verified site routes, saved edits, project backup and restore, phone-sized editing with touch, and the standalone game when the preview is unavailable.');
