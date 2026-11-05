import { expect, test, type Page } from '@playwright/test';
import type { Monaco } from '@monaco-editor/react';

const gameScript = `import { Engine } from 'dino-ge';
const base = 18;
let showMeter = true;
new Engine({
  drawUI(ui) {
    ui.button({
      id: 'meter-toggle', x: base, y: 24, width: 100, height: 36,
      text: showMeter ? 'Hide meter' : 'Show meter',
      onPress() { showMeter = !showMeter; },
    });
    if (showMeter) ui.progressBar({ x: 18, y: 72, width: 100, height: 12, value: 0.75 });
  },
}, { containerId: 'playground-canvas-container' });`;

async function openGame(page: Page, script = gameScript, viewport = { width: 1280, height: 900 }) {
  await page.setViewportSize(viewport);
  let saved = script;
  await page.route('**/files', route => route.fulfill({ json: ['screen-ui'] }));
  await page.route('**/api/scripts/screen-ui', route => {
    if (route.request().method() === 'PUT') {
      saved = route.request().postDataJSON().data;
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ json: saved });
  });
  await page.goto('/');
  await expect(page.locator('#canvas')).toBeVisible();
}

function canvasPoint(page: Page, x: number, y: number) {
  return page.locator('#canvas').evaluate((element: HTMLCanvasElement, point) => {
    const bounds = element.getBoundingClientRect();
    return {
      x: bounds.x + point.x * bounds.width / element.width,
      y: bounds.y + point.y * bounds.height / element.height,
    };
  }, { x, y });
}

function canvasPixel(page: Page, x: number, y: number) {
  return page.locator('#canvas').evaluate((element: HTMLCanvasElement, point) =>
    Array.from(element.getContext('2d')!.getImageData(point.x, point.y, 1, 1).data), { x, y });
}

async function pressGameButton(page: Page) {
  const point = await canvasPoint(page, 68, 42);
  await page.mouse.click(point.x, point.y);
}

test('inspects a live Screen UI button and opens its exact draw call', async ({ page }) => {
  await openGame(page);
  const explorer = page.getByRole('region', { name: 'Screen UI', exact: true });
  const inspector = page.getByRole('region', { name: 'Screen UI properties', exact: true });
  const outline = page.locator('.screen-ui-outline');
  await explorer.getByRole('button', { name: /Hide meter/ }).click();
  await expect(inspector).toContainText('Hide meter');
  await expect(outline).toBeVisible();
  await expect(outline).toHaveCSS('pointer-events', 'none');

  await pressGameButton(page);
  await expect(explorer.getByRole('button', { name: /Show meter/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(inspector).toContainText('Show meter');

  await inspector.getByRole('button', { name: 'View source', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    const editor = monaco.editor.getEditors().find(item => item.hasTextFocus());
    const position = editor?.getPosition();
    const model = editor?.getModel();
    if (!position || !model) return '';
    const offset = model.getOffsetAt(position);
    return model.getValue().slice(offset, offset + 10);
  })).toBe('ui.button(');
});

test('clears an anonymous Screen UI selection when the game stops drawing it', async ({ page }) => {
  await openGame(page);
  const explorer = page.getByRole('region', { name: 'Screen UI', exact: true });
  const progress = explorer.getByRole('button', { name: /Progress bar/i });
  const outline = page.locator('.screen-ui-outline');
  await progress.click();
  await expect(progress).toHaveAttribute('aria-pressed', 'true');
  await expect(outline).toBeVisible();
  await pressGameButton(page);
  await expect(progress).toHaveCount(0);
  await expect(outline).toHaveCount(0);
  await expect(explorer.getByRole('button', { name: /Show meter/ })).toHaveAttribute('aria-pressed', 'false');

  await pressGameButton(page);
  await expect(progress).toHaveAttribute('aria-pressed', 'false');
  await expect(outline).toHaveCount(0);
});

test('opens an imported Screen UI draw call in the project module editor', async ({ page }) => {
  const id = 'screen-ui-project/game';
  const module = `export function drawUI(ui) {
  ui.label({ x: 24, y: 36, text: 'Project HUD' });
}`;
  const script = `import { Engine } from 'dino-ge';
import { drawUI } from './hud.js';
new Engine({ drawUI }, { containerId: 'playground-canvas-container' });`;
  await page.route('**/files', route => route.fulfill({ json: [id] }));
  const endpoint = `**/api/scripts/${encodeURIComponent(id)}`;
  await page.route(endpoint, route => route.fulfill({ json: script }));
  await page.route(`${endpoint}/modules`, route => route.fulfill({ json: ['hud.js'] }));
  await page.route(`${endpoint}/modules?path=hud.js`, route =>
    route.fulfill({ json: module, headers: { 'X-Dino-Module-Revision': 'test' } }));
  await page.route('**/project-runs/*/screen-ui-project/hud.js', route =>
    route.fulfill({ body: module, contentType: 'text/javascript' }));
  await page.goto('/');
  await page.getByRole('region', { name: 'Screen UI', exact: true }).getByRole('button', { name: 'Project HUD' }).click();
  await page.getByRole('region', { name: 'Screen UI properties' }).getByRole('button', { name: 'View source' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    const editor = monaco.editor.getEditors().find(item => item.hasTextFocus());
    const position = editor?.getPosition();
    return position && editor?.getModel()?.getLineContent(position.lineNumber).trim();
  })).toBe("ui.label({ x: 24, y: 36, text: 'Project HUD' });");
});

function screenUIProperties(page: Page) {
  return page.getByRole('region', { name: 'Screen UI properties', exact: true });
}

async function selectScreenControl(page: Page, name: string) {
  await page.getByRole('region', { name: 'Screen UI', exact: true })
    .getByRole('button', { name, exact: true }).click();
}

async function expectScreenPosition(page: Page, x: number, y: number) {
  const inspector = screenUIProperties(page);
  await expect(inspector.getByText('X', { exact: true }).locator('..')).toHaveText(`X${x.toFixed(1)}`);
  await expect(inspector.getByText('Y', { exact: true }).locator('..')).toHaveText(`Y${y.toFixed(1)}`);
}

test('drags Screen UI in canvas pixels and discards the preview without activating the game button', async ({ page }) => {
  await openGame(page);
  await selectScreenControl(page, 'Hide meter');
  const inspector = screenUIProperties(page);
  await inspector.getByRole('button', { name: 'Edit Screen UI', exact: true }).click();
  const move = page.getByRole('button', { name: 'Move Hide meter', exact: true });
  await expect(move).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await move.press('p');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();

  const originalPixel = await canvasPixel(page, 151, 51);
  const start = await canvasPoint(page, 68, 42);
  const end = await canvasPoint(page, 110, 60);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.mouse.up();
  await expectScreenPosition(page, 60, 42);
  await expect(move).toBeVisible();
  const moved = await move.boundingBox();
  const expected = await canvasPoint(page, 60, 42);
  expect(moved?.x).toBeCloseTo(expected.x, 0);
  expect(moved?.y).toBeCloseTo(expected.y, 0);
  await expect.poll(() => canvasPixel(page, 151, 51)).not.toEqual(originalPixel);
  await expect(inspector.getByRole('heading', { name: 'Hide meter' })).toBeVisible();

  await inspector.getByRole('button', { name: 'Discard move', exact: true }).click();
  await expectScreenPosition(page, 18, 24);
  await expect.poll(() => canvasPixel(page, 151, 51)).toEqual(originalPixel);
  await inspector.getByRole('button', { name: 'Finish editing Screen UI', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await pressGameButton(page);
  await expect(inspector.getByRole('heading', { name: 'Show meter' })).toBeVisible();
});

function entryEditorValue(page: Page) {
  return page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getEditors()[0]?.getValue();
  });
}

test('applies keyboard nudges to a computed Screen UI position as one undoable source edit', async ({ page }) => {
  await openGame(page);
  await selectScreenControl(page, 'Hide meter');
  const inspector = screenUIProperties(page);
  await inspector.getByRole('button', { name: 'Edit Screen UI', exact: true }).click();
  const move = page.getByRole('button', { name: 'Move Hide meter', exact: true });
  const start = await move.boundingBox();
  expect(start).toBeTruthy();
  await move.press('Shift+ArrowRight');
  await move.press('ArrowDown');
  await expectScreenPosition(page, 28, 25);

  const before = await entryEditorValue(page);
  await inspector.getByRole('button', { name: 'Apply move', exact: true }).click();
  await expect.poll(() => entryEditorValue(page)).toMatch(/x:\s*\(?base\)?\s*\+\s*10\b/);
  await expect.poll(() => entryEditorValue(page)).toMatch(/y:\s*(?:\(?24\)?\s*\+\s*1|25)\b/);
  await page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    monaco.editor.getEditors()[0].trigger('screen-ui-test', 'undo', null);
  });
  await expect.poll(() => entryEditorValue(page)).toBe(before);
  await expect.poll(async () => (await move.boundingBox())?.x).toBe(start?.x);
  await page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    monaco.editor.getEditors()[0].trigger('screen-ui-test', 'redo', null);
  });
  await expect.poll(async () => Math.round((await move.boundingBox())?.x ?? 0))
    .toBe(Math.round((start?.x ?? 0) + 10));

  const saving = page.waitForResponse(response => response.request().method() === 'PUT' &&
    response.url().endsWith('/api/scripts/screen-ui'));
  await page.getByRole('button', { name: 'Save script', exact: true }).click();
  expect((await saving).ok()).toBe(true);
  await page.reload();
  await selectScreenControl(page, 'Hide meter');
  await expectScreenPosition(page, 28, 25);
});

test('allows preview movement for a shared Screen UI draw call without offering to apply it', async ({ page }) => {
  await openGame(page, `import { Engine } from 'dino-ge';
new Engine({
  drawUI(ui) {
    for (const [index, name] of ['Volume down', 'Volume up'].entries()) {
      ui.button({ id: name, text: name, x: 18 + index * 120, y: 24, width: 100, height: 36, onPress() {} });
    }
  },
}, { containerId: 'playground-canvas-container' });`);
  await selectScreenControl(page, 'Volume down');
  const inspector = screenUIProperties(page);
  await inspector.getByRole('button', { name: 'Edit Screen UI', exact: true }).click();
  await page.getByRole('button', { name: 'Move Volume down', exact: true }).press('ArrowDown');
  await expectScreenPosition(page, 18, 25);
  await expect(inspector).toContainText(/preview.only|only.*preview/i);
  const apply = inspector.getByRole('button', { name: 'Apply move', exact: true });
  if (await apply.count()) await expect(apply).toBeDisabled();
  await inspector.getByRole('button', { name: 'Discard move', exact: true }).click();
  await expectScreenPosition(page, 18, 24);
});

test.describe('Screen UI touch editing', () => {
  test.use({ hasTouch: true });
  test.skip(({ browserName }) => browserName !== 'chromium', 'Touch dragging uses Chromium input emulation.');

  test('drags a Screen UI control on a touch layout', async ({ page }) => {
    await openGame(page, gameScript, { width: 390, height: 844 });
    await page.getByRole('tab', { name: 'Explorer', exact: true }).click();
    await selectScreenControl(page, 'Hide meter');
    const inspector = screenUIProperties(page);
    await inspector.getByRole('button', { name: 'Edit Screen UI', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Move Hide meter', exact: true })).toBeVisible();

    const start = await canvasPoint(page, 68, 42);
    const end = await canvasPoint(page, 84, 62);
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expectScreenPosition(page, 34, 44);
    await expect(inspector.getByRole('heading', { name: 'Hide meter' })).toBeVisible();
  });
});
