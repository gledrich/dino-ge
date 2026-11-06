import { expect, test, type Page } from '@playwright/test';

type Monaco = typeof import('monaco-editor');

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

test('switches from the paintbrush to Screen UI and undoes preview edits', async ({ page }) => {
  await openGame(page);
  const toolbar = page.locator('.toolbar');
  const brush = toolbar.getByRole('button', { name: 'Edit scene', exact: true });
  const screen = toolbar.getByRole('button', { name: 'Edit Screen UI', exact: true });
  await brush.focus();
  await brush.press('ArrowUp');
  await expect(screen).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(brush).toBeFocused();
  await expect(screen).toBeHidden();
  await brush.click();
  await expect(brush).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.getByText('Zoom 125%', { exact: true })).toBeVisible();
  await brush.hover();
  const brushBounds = await brush.boundingBox();
  const screenBounds = await screen.boundingBox();
  const toolbarBounds = await toolbar.boundingBox();
  expect(screenBounds!.width).toBeGreaterThanOrEqual(40);
  expect(screenBounds!.height).toBeGreaterThanOrEqual(40);
  expect(toolbarBounds!.y - (screenBounds!.y + screenBounds!.height)).toBeGreaterThanOrEqual(10);
  expect(Math.abs(screenBounds!.x + screenBounds!.width / 2 - (brushBounds!.x + brushBounds!.width / 2))).toBeLessThan(1);
  await page.mouse.move(screenBounds!.x + screenBounds!.width / 2, screenBounds!.y + screenBounds!.height / 2, { steps: 8 });
  await expect(screen).toBeVisible();
  await screen.click();
  await expect(brush).toHaveAttribute('aria-pressed', 'false');
  await expect(toolbar.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  const tools = page.getByRole('group', { name: 'Screen UI editing', exact: true });
  await expect(tools.getByText('Select a control on the canvas.')).toBeVisible();
  const handle = page.getByRole('button', { name: 'Move Hide meter', exact: true });
  const original = (await handle.boundingBox())!.x;
  await handle.press('Shift+ArrowRight');
  await expect.poll(async () => (await handle.boundingBox())!.x).toBe(original + 10);
  await tools.getByRole('button', { name: 'Done' }).click();
  await expect(tools).toBeVisible();
  await tools.getByRole('button', { name: 'Undo Screen UI edit' }).click();
  await expect.poll(async () => (await handle.boundingBox())!.x).toBe(original);
  await tools.getByRole('button', { name: 'Redo Screen UI edit' }).click();
  await expect.poll(async () => (await handle.boundingBox())!.x).toBe(original + 10);
  await handle.press('ControlOrMeta+z');
  await tools.getByRole('button', { name: 'Done' }).click();
  await expect(tools).toBeHidden();
  await brush.click();
  await expect(page.getByText('Zoom 100%', { exact: true })).toBeVisible();

  await page.locator('#canvas').evaluate(canvas => canvas.setAttribute('data-playground-game', ''));
  await brush.hover();
  const viewport = await page.locator('.viewport-panel').boundingBox();
  expect((await screen.boundingBox())!.y).toBeGreaterThanOrEqual(viewport!.y);
});

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
  for (const [name, value] of [['X', x], ['Y', y]] as const) {
    const input = inspector.getByRole('spinbutton', { name, exact: true });
    if (await input.count()) {
      await expect.poll(async () => Number(await input.inputValue())).toBe(value);
    } else {
      await expect(inspector.getByText(name, { exact: true }).locator('..')).toHaveText(`${name}${value.toFixed(1)}`);
    }
  }
}

test('snaps Screen UI moves and resize edges to the grid and keeps each edit undoable', async ({ page }) => {
  await openGame(page);
  await selectScreenControl(page, 'Hide meter');
  await screenUIProperties(page).getByRole('button', { name: 'Edit Screen UI', exact: true }).click();
  const tools = page.getByRole('group', { name: 'Screen UI editing', exact: true });
  await tools.getByRole('button', { name: 'Snap to grid', exact: true }).click();
  await tools.getByRole('combobox', { name: 'Grid cell size' }).selectOption('16');
  const start = await canvasPoint(page, 68, 42);
  const end = await canvasPoint(page, 88, 54);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.mouse.up();
  await expectScreenPosition(page, 32, 32);
  await tools.getByRole('combobox', { name: 'Grid cell size' }).selectOption('32');
  const resize = page.getByRole('button', { name: 'Resize Hide meter from bottom right', exact: true });
  await resize.press('ArrowRight');
  const width = screenUIProperties(page).getByRole('spinbutton', { name: 'Width', exact: true });
  await expect(width).toHaveValue('128');
  await expect(screenUIProperties(page).getByRole('spinbutton', { name: 'Height', exact: true })).toHaveValue('36');
  await tools.getByRole('button', { name: 'Undo Screen UI edit' }).click();
  await expect(width).toHaveValue('100');
  await tools.getByRole('button', { name: 'Undo Screen UI edit' }).click();
  await expectScreenPosition(page, 18, 24);
  await tools.getByRole('button', { name: 'Redo Screen UI edit' }).click();
  await expectScreenPosition(page, 32, 32);
});

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

test('resizes and styles a Screen UI button in one undoable source edit', async ({ page }) => {
  await openGame(page, `import { Engine } from 'dino-ge';
const menuWidth = 100;
new Engine({
  drawUI(ui) {
    ui.button({
      id: 'start', x: 18, y: 24, width: menuWidth, height: 36,
      text: 'Start game', background: '#25383e', onPress() {},
    });
  },
}, { containerId: 'playground-canvas-container' });`);
  await selectScreenControl(page, 'Start game');
  const inspector = screenUIProperties(page);
  await inspector.getByRole('button', { name: 'Edit Screen UI', exact: true }).click();
  const resize = page.getByRole('button', { name: 'Resize Start game from bottom right', exact: true });
  await expect(resize).toBeVisible({ timeout: 3000 });
  const handle = (await resize.boundingBox())!;
  const start = await canvasPoint(page, 118, 60);
  const end = await canvasPoint(page, 154, 76);
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + end.x - start.x,
    handle.y + handle.height / 2 + end.y - start.y, { steps: 4 });
  await page.mouse.up();

  const width = inspector.getByRole('spinbutton', { name: 'Width', exact: true });
  const height = inspector.getByRole('spinbutton', { name: 'Height', exact: true });
  await expect.poll(async () => Number(await width.inputValue())).toBe(136);
  await expect.poll(async () => Number(await height.inputValue())).toBe(52);
  const x = inspector.getByRole('spinbutton', { name: 'X', exact: true });
  await x.fill('30');
  await x.press('Tab');
  await expect.poll(async () => Number(await x.inputValue())).toBe(30);
  await inspector.getByRole('textbox', { name: 'Text', exact: true }).fill('Continue');
  const background = inspector.getByRole('textbox', { name: 'Background', exact: true });
  await background.fill('#008040');
  await background.press('Tab');
  await expect(inspector.getByRole('heading', { name: 'Continue', exact: true })).toBeVisible();
  await expect.poll(() => canvasPixel(page, 145, 69)).toEqual([0, 128, 64, 255]);

  const before = await entryEditorValue(page);
  await inspector.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect.poll(() => entryEditorValue(page)).toMatch(/x:\s*(?:\(?18\)?\s*\+\s*12|30)\b/);
  await expect.poll(() => entryEditorValue(page)).toMatch(/width:\s*(?:Math\.max\(\s*1\s*,\s*)?\(?menuWidth\)?\s*\+\s*36\b/);
  await expect.poll(() => entryEditorValue(page)).toMatch(/height:\s*(?:\(?36\)?\s*\+\s*16|52)\b/);
  await expect.poll(() => entryEditorValue(page)).toMatch(/text:\s*['"]Continue['"]/);
  await expect.poll(() => entryEditorValue(page)).toMatch(/background:\s*['"]#008040['"]/i);
  await page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    monaco.editor.getEditors()[0].trigger('screen-ui-test', 'undo', null);
  });
  await expect.poll(() => entryEditorValue(page)).toBe(before);
  await expect.poll(() => canvasPixel(page, 145, 69)).not.toEqual([0, 128, 64, 255]);
  await page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    monaco.editor.getEditors()[0].trigger('screen-ui-test', 'redo', null);
  });
  await expect.poll(() => canvasPixel(page, 145, 69)).toEqual([0, 128, 64, 255]);

  const saving = page.waitForResponse(response => response.request().method() === 'PUT' &&
    response.url().endsWith('/api/scripts/screen-ui'));
  await page.getByRole('button', { name: 'Save script', exact: true }).click();
  expect((await saving).ok()).toBe(true);
  await page.reload();
  await selectScreenControl(page, 'Continue');
  await expect.poll(() => canvasPixel(page, 145, 69)).toEqual([0, 128, 64, 255]);
});

test('keeps a computed Screen UI width positive when the viewport narrows', async ({ page }) => {
  await openGame(page, `import { Engine } from 'dino-ge';
new Engine({
  drawUI(ui) {
    ui.button({
      id: 'responsive', x: 18, y: 24, width: ui.width / 2, height: 36,
      text: 'Responsive button', onPress() {},
    });
  },
}, { containerId: 'playground-canvas-container' });`);
  await selectScreenControl(page, 'Responsive button');
  const inspector = screenUIProperties(page);
  await inspector.getByRole('button', { name: 'Edit Screen UI', exact: true }).click();
  const width = inspector.getByRole('spinbutton', { name: 'Width', exact: true });
  await width.fill('20');
  await width.press('Tab');
  await expect.poll(async () => Number(await width.inputValue())).toBe(20);

  await page.setViewportSize({ width: 900, height: 900 });
  await expect.poll(async () => Number(await width.inputValue())).toBe(1);
  await inspector.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect.poll(() => entryEditorValue(page)).toMatch(
    /width:\s*Math\.max\(\s*1\s*,\s*\(?ui\.width\s*\/\s*2\)?\s*-\s*\d/,
  );

  const saving = page.waitForResponse(response => response.request().method() === 'PUT' &&
    response.url().endsWith('/api/scripts/screen-ui'));
  await page.getByRole('button', { name: 'Save script', exact: true }).click();
  expect((await saving).ok()).toBe(true);
  await page.reload();
  await selectScreenControl(page, 'Responsive button');
  const readOnlyWidth = inspector.getByText('Width', { exact: true }).locator('..');
  await expect(readOnlyWidth).toHaveText('Width1.0');
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(readOnlyWidth).toHaveText('Width20.0');
});

test('previews computed text without replacing it and keeps progress values read-only', async ({ page }) => {
  await openGame(page);
  await selectScreenControl(page, 'Hide meter');
  const inspector = screenUIProperties(page);
  await inspector.getByRole('button', { name: 'Edit Screen UI', exact: true }).click();
  const colour = inspector.getByRole('textbox', { name: 'Colour', exact: true });
  const originalColour = await colour.inputValue();
  await colour.fill('inherit');
  await expect(colour).toHaveAttribute('aria-invalid', 'true');
  await colour.press('Tab');
  await expect(colour).toHaveValue(originalColour);
  const text = inspector.getByRole('textbox', { name: 'Text', exact: true });
  await expect(text).toHaveValue('Hide meter', { timeout: 3000 });
  await text.fill('Preview meter');
  await text.press('Tab');
  await expect(inspector.getByRole('heading', { name: 'Preview meter', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Move Preview meter', exact: true })).toBeVisible();
  const apply = inspector.getByRole('button', { name: 'Apply changes', exact: true });
  if (await apply.count()) await expect(apply).toBeDisabled();
  await expect(inspector).toContainText(/preview.only|only.*preview/i);
  await expect.poll(() => entryEditorValue(page)).toContain("showMeter ? 'Hide meter' : 'Show meter'");
  await inspector.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(text).toHaveValue('Hide meter');
  await selectScreenControl(page, 'Progress bar');
  await expect(inspector.getByText('75%', { exact: true })).toBeVisible();
  await expect(inspector.getByRole('spinbutton', { name: 'Value', exact: true })).toHaveCount(0);
});

test.describe('Screen UI touch editing', () => {
  test.use({ hasTouch: true });
  test.skip(({ browserName }) => browserName !== 'chromium', 'Touch dragging uses Chromium input emulation.');

  test('opens Screen UI through the paintbrush disclosure by touch', async ({ page }) => {
    await openGame(page, gameScript, { width: 390, height: 844 });
    const toolbar = page.locator('.toolbar');
    await toolbar.getByRole('button', { name: 'More editing tools', exact: true }).tap();
    const screen = toolbar.getByRole('button', { name: 'Edit Screen UI', exact: true });
    const bounds = await screen.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    await screen.tap();
    await expect(page.getByRole('group', { name: 'Screen UI editing', exact: true })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'Edit scene', exact: true })).toHaveAttribute('aria-pressed', 'false');
  });

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

  test('resizes a Screen UI control on a touch layout', async ({ page }) => {
    await openGame(page, gameScript, { width: 390, height: 844 });
    await page.getByRole('tab', { name: 'Explorer', exact: true }).click();
    await selectScreenControl(page, 'Hide meter');
    const inspector = screenUIProperties(page);
    await inspector.getByRole('button', { name: 'Edit Screen UI', exact: true }).click();
    const resize = page.getByRole('button', { name: 'Resize Hide meter from bottom right', exact: true });
    await expect(resize).toBeVisible({ timeout: 3000 });
    const bounds = (await resize.boundingBox())!;
    const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    const originalCorner = await canvasPoint(page, 118, 60);
    const nextCorner = await canvasPoint(page, 134, 68);
    const end = { x: start.x + nextCorner.x - originalCorner.x, y: start.y + nextCorner.y - originalCorner.y };
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const width = inspector.getByRole('spinbutton', { name: 'Width', exact: true });
    const height = inspector.getByRole('spinbutton', { name: 'Height', exact: true });
    await expect.poll(async () => Number(await width.inputValue())).toBe(116);
    await expect.poll(async () => Number(await height.inputValue())).toBe(44);
  });
});
