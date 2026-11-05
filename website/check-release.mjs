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
  const arrow = game.getByRole('button', { name: 'Move right' });
  assert.equal(await arrow.evaluate(button => getComputedStyle(button).userSelect), 'none');
  await arrow.tap();
  await game.waitForFunction(x => window.readExplorerX() > x, initialX, { timeout: 5_000 });
}

async function verifyLibraryCodeDrop(page, source, expected) {
  const editor = page.locator('.monaco-editor').first();
  await page.waitForFunction(() => !!window.monaco?.editor.getEditors()[0]?.getValue().length);
  const before = await page.evaluate(() => window.monaco?.editor.getEditors()[0]?.getValue());
  assert.equal(typeof before, 'string');
  assert.ok(!before.includes(expected));
  const run = await page.locator(previewFrame).getAttribute('src');
  await source.and(page.locator('[draggable="true"]:enabled')).dragTo(editor);
  await page.waitForFunction(text => window.monaco?.editor.getEditors()[0]?.getValue().includes(text), expected, { timeout: 5_000 });
  assert.equal(await page.locator(previewFrame).getAttribute('src'), run);
  await page.evaluate(() => window.monaco.editor.getEditors()[0].trigger('release-check', 'undo', null));
  await page.waitForFunction(text => window.monaco?.editor.getEditors()[0]?.getValue() === text, before);
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
  await verifyLibraryCodeDrop(page, page.getByRole('button', { name: 'Insert rectangle code', exact: true }), 'New rectangle');
  await page.getByRole('button', { name: 'Assets', exact: true }).click();
  await verifyLibraryCodeDrop(page, page.getByRole('button', { name: 'Insert ruins-atlas sprite code', exact: true }), 'ruins-atlas sprite');
  const code = page.locator('.monaco-editor').first();
  await code.locator('.view-lines').click();
  // Monaco uses different document-start shortcuts on macOS and Linux.
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  const releaseEdit = 'document.documentElement.dataset.releaseCheck = "saved";';
  await page.keyboard.insertText(releaseEdit + '\n');
  await page.waitForFunction(edit => window.monaco?.editor.getEditors()[0]?.getValue().includes(edit), releaseEdit);
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
      iframe.addEventListener('load', () => {
        iframe.contentWindow.postMessage({ type: 'preview-connect' }, origin);
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
  const canvas = game.locator('#playground-canvas-container canvas');
  await canvas.waitFor();
  await page.getByRole('tab', { name: 'Explorer', exact: true }).click();
  await page.getByRole('region', { name: 'Screen UI', exact: true })
    .getByRole('button', { name: 'AMBER RUINS', exact: true }).click();
  const properties = page.getByRole('region', { name: 'Screen UI properties' });
  await properties.getByRole('button', { name: 'Edit Screen UI', exact: true }).click();
  const handle = page.getByRole('button', { name: 'Move AMBER RUINS', exact: true });
  const start = await handle.boundingBox();
  assert.ok(start);
  // The mobile game extends above the website's editor container.
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 20, start.y + start.height / 2, { steps: 4 });
  await page.mouse.up();
  assert.equal(Math.round((await handle.boundingBox()).x - start.x), 20);
  await properties.getByRole('button', { name: 'Discard move', exact: true }).click();
  assert.equal((await handle.boundingBox()).x, start.x);
  await properties.getByRole('textbox', { name: 'Text', exact: true }).fill('Amber Ruins HUD check');
  await page.waitForFunction(width => {
    const renamed = document.querySelector('[aria-label="Move Amber Ruins HUD check"]');
    return (renamed?.getBoundingClientRect().width ?? 0) > width;
  }, start.width);
  await properties.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await handle.waitFor();
  await properties.getByRole('button', { name: 'Finish editing Screen UI', exact: true }).click();
  const toolbar = page.locator('.viewport-panel .toolbar');
  const drawer = page.locator('.mobile-dock-resize');
  const openToolbarBounds = await toolbar.boundingBox();
  const gap = (await drawer.boundingBox()).y - (openToolbarBounds.y + openToolbarBounds.height);
  assert.ok(gap >= 0 && gap <= 24, 'The toolbar should sit just above the open drawer. Gap: ' + gap);
  const previewBounds = await iframe.boundingBox();
  const canvasBounds = await canvas.boundingBox();
  await page.getByRole('button', { name: 'Collapse bottom dock' }).click();
  await game.getByRole('button', { name: 'Move right' }).waitFor();
  const arrows = await game.locator('.touch-arrows').boundingBox();
  const collapsedDrawer = await page.getByRole('button', { name: 'Expand bottom dock' }).boundingBox();
  const arrowBottom = arrows.y + arrows.height;
  assert.ok(arrowBottom <= collapsedDrawer.y, 'The collapsed drawer covers the touch arrows by ' + (arrowBottom - collapsedDrawer.y) + 'px.');
  const toolbarBounds = await toolbar.boundingBox();
  assert.ok(toolbarBounds.y + toolbarBounds.height <= arrows.y, 'The toolbar must clear the touch arrows.');
  assert.deepEqual(await iframe.boundingBox(), previewBounds);
  assert.deepEqual(await canvas.boundingBox(), canvasBounds);
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
