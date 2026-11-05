import { expect, test, type Page } from '@playwright/test';
import type { Monaco } from '@monaco-editor/react';

const gameScript = `import { Engine } from 'dino-ge';
let showMeter = true;
new Engine({
  drawUI(ui) {
    ui.button({
      id: 'meter-toggle', x: 18, y: 24, width: 100, height: 36,
      text: showMeter ? 'Hide meter' : 'Show meter',
      onPress() { showMeter = !showMeter; },
    });
    if (showMeter) ui.progressBar({ x: 18, y: 72, width: 100, height: 12, value: 0.75 });
  },
}, { containerId: 'playground-canvas-container' });`;

async function openGame(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('**/files', route => route.fulfill({ json: ['screen-ui'] }));
  await page.route('**/api/scripts/screen-ui', route => route.fulfill({ json: gameScript }));
  await page.goto('/');
  await expect(page.locator('#canvas')).toBeVisible();
}

async function pressGameButton(page: Page) {
  const canvas = page.locator('#canvas');
  const point = await canvas.evaluate((element: HTMLCanvasElement) => {
    const bounds = element.getBoundingClientRect();
    return {
      x: bounds.x + (18 + 50) * bounds.width / element.width,
      y: bounds.y + (24 + 18) * bounds.height / element.height,
    };
  });
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
