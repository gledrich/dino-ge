import { expect, test } from '@playwright/test';
import type { Monaco } from '@monaco-editor/react';

test('keeps unsaved edits across tabs and panel collapse, and retains hidden console messages', async ({ page }) => {
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: 'const initial = true;' }));
  await page.goto('/');
  const editor = page.locator('.monaco-editor');
  await expect(editor).toContainText('initial');
  await editor.locator('.view-lines').click();
  await page.keyboard.insertText('// local draft');
  await expect(editor).toContainText('local draft');
  await page.evaluate(() => console.warn('Warning recorded while Console was closed'));
  await page.getByRole('tab', { name: 'Editor' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Console' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Warning recorded while Console was closed')).toBeVisible();
  await page.getByRole('tab', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Collapse editor' }).click();
  await page.getByRole('button', { name: 'Expand editor' }).click();
  await expect(editor).toContainText('local draft');
  await page.getByRole('button', { name: 'Insert rectangle code', exact: true }).click();
  await expect(editor).toContainText('new Rectangle');
  await expect(page.getByRole('button', { name: 'Edit scene', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('selects an object in Explorer and writes an Inspector change back to the script', async ({ page }) => {
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine, Rectangle, Vector2 } from 'dino-ge';
new Engine({
  onLoad: () => new Rectangle({
    tag: 'beta-box', position: new Vector2(12, 24), width: 30, height: 30, colour: '#abc',
  }),
  update: () => {},
}, { containerId: 'playground-canvas-container' });
` }));
  await page.goto('/');
  await page.getByRole('button', { name: 'beta-box' }).press('Enter');
  const x = page.getByRole('spinbutton', { name: 'X', exact: true });
  await x.fill('120');
  await page.getByRole('button', { name: 'Save X to code', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getModels().find(model => model.getLanguageId() === 'javascript')?.getValue();
  })).toContain('new Vector2(120, 24)');
  await page.getByRole('textbox', { name: 'Tag', exact: true }).fill("beta's box");
  await page.getByRole('button', { name: 'Save Tag to code', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getModels().find(model => model.getLanguageId() === 'javascript')?.getValue();
  })).toContain(`tag: "beta's box"`);
});

test('Edit scene isolates gameplay and shows live changes to a nested object', async ({ page }) => {
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine, Rectangle, Vector2 } from 'dino-ge';
new Engine({
  onLoad: () => {
    const parent = new Rectangle({ tag: 'parent', position: new Vector2(160, 100), width: 10, height: 10 });
    const child = new Rectangle({ tag: 'drag target', position: new Vector2(10, 10), width: 20, height: 20 });
    parent.transform.rotation = Math.PI / 2;
    parent.transform.scale.set(2, 3);
    parent.transform.addChild(child.transform);
  },
  update: () => {},
  drawUI: ui => ui.button({
    text: 'Game action', x: 110, y: 110, width: 40, height: 30,
    onPress: () => { document.body.dataset.gameAction = 'pressed'; },
  }),
}, { containerId: 'playground-canvas-container' });
` }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'drag target' })).toBeVisible();
  const edit = page.getByRole('button', { name: 'Edit scene', exact: true });
  await edit.click();
  await expect(edit).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  const canvas = page.locator('#canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + 135, box.y + 125);
  await canvas.press('Enter');
  await expect(page.locator('body')).not.toHaveAttribute('data-game-action', 'pressed');
  await expect(page.getByRole('button', { name: 'drag target' })).toHaveAttribute('aria-pressed', 'false');
  await page.mouse.move(box.x + 125, box.y + 125);
  await page.mouse.down();
  await expect(page.getByRole('button', { name: 'drag target' })).toHaveAttribute('aria-pressed', 'true');
  const x = page.getByRole('spinbutton', { name: 'X', exact: true });
  await expect.poll(async () => Number(await x.inputValue())).toBeCloseTo(10);

  await page.mouse.move(box.x + 155, box.y + 165, { steps: 5 });
  await expect.poll(async () => Number(await x.inputValue())).toBeCloseTo(30);
  await page.mouse.up();
  await page.mouse.move(box.x + 185, box.y + 185);
  await expect.poll(async () => Number(await x.inputValue())).toBeCloseTo(30);

  await page.mouse.move(box.x + 102, box.y + 201);
  await expect(canvas).toHaveCSS('cursor', 'se-resize');
  await page.mouse.down();
  await page.mouse.move(box.x + 72, box.y + 221, { steps: 5 });
  await page.mouse.up();
  const width = page.getByRole('spinbutton', { name: 'Width', exact: true });
  const height = page.getByRole('spinbutton', { name: 'Height', exact: true });
  await expect.poll(async () => Number(await width.inputValue())).toBeCloseTo(30, 0);
  await expect.poll(async () => Number(await height.inputValue())).toBeCloseTo(30, 0);

  const readSource = () => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getModels().find(model => model.getLanguageId() === 'javascript')?.getValue();
  });
  const original = await readSource();
  await page.getByRole('button', { name: 'Apply placement to code' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Applied to code' })).toBeVisible();
  const updated = await readSource();
  expect(updated).toContain('position: new Vector2(30, 0)');
  expect(updated).toContain('width: 30');
  expect(updated).toContain('height: 30');
  await page.getByRole('button', { name: 'Undo code edit' }).click();
  await expect.poll(readSource).toBe(original);
  await expect(x).toHaveValue('10.00');
  await expect(width).toHaveValue('20.00');
  await expect(height).toHaveValue('20.00');

  await page.getByRole('button', { name: 'Redo code edit' }).click();
  await expect.poll(readSource).toBe(updated);
  await expect(x).toHaveValue('30.00');
  await expect.poll(async () => Number(await width.inputValue())).toBeCloseTo(30, 0);
  await expect.poll(async () => Number(await height.inputValue())).toBeCloseTo(30, 0);

  const y = page.getByRole('spinbutton', { name: 'Y', exact: true });
  await page.getByRole('region', { name: 'Scene viewport' }).press('Shift+ArrowRight');
  await expect(y).toHaveValue('-3.33');
  await page.getByRole('button', { name: 'drag target' }).press('ArrowDown');
  await expect(x).toHaveValue('30.50');
  await page.getByRole('button', { name: 'Apply placement to code' }).click();
  await expect.poll(readSource).toContain('new Vector2(30.5, -3.333333)');
  await page.getByRole('button', { name: 'Undo code edit' }).click();
  await expect.poll(readSource).toBe(updated);
  await expect(x).toHaveValue('30.00');
  await expect.poll(async () => Number(await y.inputValue())).toBeCloseTo(0);

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(edit).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Toggle debug mode' })).toHaveAttribute('aria-pressed', 'false');
  await page.mouse.click(box.x + 135, box.y + 125);
  await expect(page.locator('body')).toHaveAttribute('data-game-action', 'pressed');
});

test('keeps the hierarchy and Inspector in sync when the game changes scene objects', async ({ page }) => {
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine, Rectangle, Scene, Vector2 } from 'dino-ge';
class Workshop extends Scene {}
new Engine({
  onLoad() {
    const scene = new Workshop();
    Engine.currentScene = scene;
    const box = tag => new Rectangle({ tag, position: new Vector2(150, 150), width: 20, height: 20 });
    const parent = box('parent');
    const child = box('child');
    parent.transform.addChild(child.transform);
    window.addEventListener('remove-child', () => scene.objects.delete(child));
    window.addEventListener('rename-parent', () => { parent.metadata.tag = 'renamed parent'; });
    window.addEventListener('change-level', () => {
      Engine.currentScene = new Workshop();
      box('next level');
    });
  },
}, { containerId: 'playground-canvas-container' });
` }));
  await page.goto('/');
  const child = page.getByRole('button', { name: 'child', exact: true });
  await child.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Tag', exact: true })).toHaveValue('child');
  const gameEvent = (type: string) => page.evaluate(name => window.dispatchEvent(new Event(name)), type);
  await gameEvent('remove-child');
  await expect(child).toHaveCount(0);
  await expect(page.getByText('Click an object to inspect.')).toBeVisible();

  await gameEvent('rename-parent');
  await page.getByRole('button', { name: 'renamed parent', exact: true }).press('Enter');
  await expect(page.getByRole('textbox', { name: 'Tag', exact: true })).toHaveValue('renamed parent');
  await gameEvent('change-level');
  await expect(page.getByRole('button', { name: 'renamed parent', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'next level', exact: true })).toBeVisible();
  await expect(page.getByText('Click an object to inspect.')).toBeVisible();
});

test('places a palette object at the drop point and restores it from the saved script', async ({ page }) => {
  let source = `import { Engine } from 'dino-ge';
new Engine({ onLoad() {}, update() {} }, { containerId: 'playground-canvas-container' });`;
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => {
    if (route.request().method() === 'PUT') {
      source = route.request().postDataJSON().data;
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ json: source });
  });
  await page.goto('/');
  const canvas = page.locator('#canvas');
  await expect(canvas).toBeVisible();
  const editor = page.locator('.monaco-editor');
  await expect(editor).toContainText('new Engine');
  await expect(page.getByRole('button', { name: 'Object Library', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Add rectangle' }).dragTo(canvas, {
    targetPosition: { x: 180, y: 150 },
  });
  const rectangle = page.getByRole('button', { name: 'New rectangle', exact: true });
  await expect(page.getByRole('button', { name: 'Edit scene', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(rectangle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('180.00');
  await expect(page.getByRole('spinbutton', { name: 'Y', exact: true })).toHaveValue('150.00');
  await page.getByRole('button', { name: 'Add circle' }).press('Enter');
  const circle = page.getByRole('button', { name: 'New circle', exact: true });
  await expect(circle).toHaveAttribute('aria-pressed', 'true');

  const readCode = () => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getEditors()[0].getValue();
  });
  const undo = page.getByRole('button', { name: 'Undo code edit' });
  const redo = page.getByRole('button', { name: 'Redo code edit' });
  await undo.click();
  await expect.poll(readCode).not.toContain('New circle');
  await expect(circle).toHaveCount(0);
  await expect(rectangle).toBeVisible();
  await undo.click();
  await expect(rectangle).toHaveCount(0);
  await redo.click();
  await expect(rectangle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('180.00');
  await redo.click();
  await expect(circle).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Delete object' }).click();
  await expect(circle).toHaveCount(0);
  await expect.poll(readCode).not.toContain('New circle');
  await undo.click();
  await expect(circle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(readCode).toContain('New circle');
  await redo.click();
  await expect(circle).toHaveCount(0);

  await rectangle.press('Enter');
  await page.getByRole('spinbutton', { name: 'Width', exact: true }).fill('96');
  await page.getByRole('button', { name: 'Save Width to code', exact: true }).click();
  await expect.poll(readCode).toContain('width: 96');
  await page.getByRole('button', { name: 'Duplicate object' }).click();
  const copy = page.getByRole('button', { name: 'New rectangle copy', exact: true });
  await expect(copy).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('204.00');
  await expect(page.getByRole('spinbutton', { name: 'Width', exact: true })).toHaveValue('96.00');
  await undo.click();
  await expect(copy).toHaveCount(0);
  await expect.poll(readCode).not.toContain('New rectangle copy');
  await redo.click();
  await expect(copy).toHaveAttribute('aria-pressed', 'true');

  await editor.locator('.view-lines').click();
  const modifier = await page.evaluate(() => navigator.userAgent.includes('Macintosh') ? 'Meta' : 'Control');
  const saved = page.waitForResponse(response => response.request().method() === 'PUT' &&
    response.url().endsWith('/api/scripts/script'));
  await page.keyboard.press(`${modifier}+s`);
  await saved;
  expect(source).toContain('180, 150');
  await page.reload();
  await rectangle.press('Enter');
  await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('180.00');
  await expect(page.getByRole('spinbutton', { name: 'Y', exact: true })).toHaveValue('150.00');
  await expect(circle).toHaveCount(0);
  await expect(copy).toBeVisible();
});

test('saves a palette drop to the active named scene and restores it there', async ({ page }) => {
  let source = `import { Engine, Scene as Level, Rectangle, Vector2 } from 'dino-ge';
class Lobby extends Level {
  onLoad() {
    new Rectangle({ tag: 'lobby marker', position: new Vector2(20, 130), width: 32, height: 32 });
  }
}
class Workshop extends Level {}
new Engine({
  onLoad() { Engine.currentScene = new Lobby(); },
  drawUI(ui) {
    ui.button({ text: 'Workshop', x: 10, y: 10, width: 100, height: 32,
      onPress: () => { Engine.currentScene = new Workshop(); } });
  },
}, { containerId: 'playground-canvas-container' });`;
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => {
    if (route.request().method() === 'PUT') {
      source = route.request().postDataJSON().data;
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ json: source });
  });
  await page.goto('/');
  const canvas = page.locator('#canvas');
  const marker = page.getByRole('button', { name: 'lobby marker', exact: true });
  const circle = page.getByRole('button', { name: 'New circle', exact: true });
  await expect(marker).toBeVisible();
  await canvas.click({ position: { x: 45, y: 25 } });
  await expect(marker).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit scene' }).click();
  await page.getByRole('button', { name: 'Add circle' }).dragTo(canvas, {
    targetPosition: { x: 170, y: 155 },
  });
  await expect(circle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('status').filter({ hasText: 'Added New circle to Workshop' })).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('170.00');

  await page.locator('.monaco-editor .view-lines').click();
  const modifier = await page.evaluate(() => navigator.userAgent.includes('Macintosh') ? 'Meta' : 'Control');
  const saved = page.waitForResponse(response => response.request().method() === 'PUT' &&
    response.url().endsWith('/api/scripts/script'));
  await page.keyboard.press(`${modifier}+s`);
  await saved;
  expect(source).toMatch(/class Workshop extends Level\s*{\s*onLoad\(\)\s*{\s*new DinoPlaceCircle/);
  await page.reload();
  await expect(marker).toBeVisible();
  await expect(circle).toHaveCount(0);
  await canvas.click({ position: { x: 45, y: 25 } });
  await circle.press('Enter');
  await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('170.00');
  await expect(page.getByRole('spinbutton', { name: 'Y', exact: true })).toHaveValue('155.00');
});

test('drops a loaded project image as a sprite and reopens it using a relative asset path', async ({ page }) => {
  const id = 'sprite-demo/src/index';
  let source = `import { Engine, Loader } from 'dino-ge';
new Engine({
  async onLoad() {
    Loader.queueImage('gem', new URL('../assets/gem.svg', import.meta.url).href);
    await Loader.loadAll();
  },
}, { containerId: 'playground-canvas-container' });`;
  await page.route('**/files', route => route.fulfill({ json: ['script', id] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: '' }));
  await page.route(`**/api/scripts/${encodeURIComponent(id)}`, route => {
    if (route.request().method() === 'PUT') {
      source = route.request().postDataJSON().data;
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ json: source });
  });
  await page.route('**/project-runs/*/sprite-demo/assets/gem.svg', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="32"><rect width="48" height="32" fill="orange"/></svg>',
  }));

  await page.goto('/');
  await page.locator('.script-selector').selectOption(id);
  await page.getByRole('button', { name: 'Assets', exact: true }).click();
  const asset = page.getByRole('button', { name: 'Add gem as sprite' });
  await expect(asset).toBeDisabled();
  await page.getByRole('button', { name: 'Edit scene' }).click();
  await asset.dragTo(page.locator('#canvas'), { targetPosition: { x: 175, y: 145 } });
  const sprite = page.getByRole('button', { name: 'gem sprite', exact: true });
  await expect(sprite).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('175.00');
  await expect(page.getByRole('spinbutton', { name: 'Width', exact: true })).toHaveValue('48.00');

  await page.locator('.monaco-editor .view-lines').click();
  const modifier = await page.evaluate(() => navigator.userAgent.includes('Macintosh') ? 'Meta' : 'Control');
  const saved = page.waitForResponse(response => response.request().method() === 'PUT' &&
    response.url().endsWith(`/api/scripts/${encodeURIComponent(id)}`));
  await page.keyboard.press(`${modifier}+s`);
  await saved;
  expect(source).toMatch(/src: new URL\(["']\.\.\/assets\/gem\.svg["'], import\.meta\.url\)\.href/);
  await page.reload();
  await page.locator('.script-selector').selectOption(id);
  await sprite.press('Enter');
  await expect(page.getByRole('spinbutton', { name: 'Y', exact: true })).toHaveValue('145.00');
  await expect(page.getByRole('spinbutton', { name: 'Height', exact: true })).toHaveValue('32.00');
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await page.getByRole('button', { name: 'Duplicate object' }).click();
  await expect(page.getByRole('button', { name: 'gem sprite copy', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('spinbutton', { name: 'Y', exact: true })).toHaveValue('169.00');
  await expect(page.getByRole('spinbutton', { name: 'Height', exact: true })).toHaveValue('32.00');
});

test('keyboard format and save act on the selected script after switching files', async ({ page }) => {
  await page.route('**/files', route => route.fulfill({ json: ['script', 'second'] }));
  await page.route('**/api/scripts/*', route => {
    const request = route.request();
    const code = request.url().endsWith('/second') ? 'const secondScript = 2;' : 'const firstScript = 1;';
    return route.fulfill({ json: request.method() === 'PUT' ? { success: true } : code });
  });

  await page.goto('/');
  const editor = page.locator('.monaco-editor');
  await expect(editor).toContainText('firstScript');
  await page.locator('.script-selector').selectOption('second');
  await expect(editor).toContainText('secondScript');
  await editor.locator('.view-lines').click();

  const modifier = await page.evaluate(() =>
    navigator.userAgent.includes('Macintosh') ? 'Meta' : 'Control'
  );
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.insertText('const secondScript=3');
  await page.keyboard.press('Shift+Alt+f');
  await expect.poll(() => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getModels().find(model => model.getLanguageId() === 'javascript')
      ?.getValue().replace(/\r\n/g, '\n');
  })).toBe('const secondScript = 3;\n');

  const saved = page.waitForRequest(
    request => request.method() === 'PUT' && request.url().includes('/api/scripts/'),
    { timeout: 5000 }
  );
  await page.keyboard.press(`${modifier}+s`);
  const request = await saved;
  expect(request.url()).toMatch(/\/api\/scripts\/second$/);
  expect(request.postDataJSON().data.replace(/\r\n/g, '\n')).toBe('const secondScript = 3;\n');
});

test('saves while declarations load and resolves Dino GE imports afterwards', async ({ page }) => {
  const script = "import { Vector2 } from 'dino-ge';\nnew Vector2(1, 2);";
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('https://cdn.jsdelivr.net/**', route => route.abort());
  let releaseTypes!: () => void;
  const typesGate = new Promise<void>(resolve => { releaseTypes = resolve; });
  await page.route('**/api/types', async route => {
    await typesGate;
    await route.continue();
  });
  await page.route('**/api/scripts/script', async route => {
    const isSave = route.request().method() === 'PUT';
    await route.fulfill({ json: isSave ? { success: true } : script });
  });

  try {
    await page.goto('/');
    const editor = page.locator('.monaco-editor');
    await expect(editor).toContainText('Vector2');
    await editor.locator('.view-lines').click();

    const modifier = await page.evaluate(() =>
      navigator.userAgent.includes('Macintosh') ? 'Meta' : 'Control'
    );
    const saved = page.waitForRequest(
      request => request.method() === 'PUT' && request.url().endsWith('/api/scripts/script'),
      { timeout: 5000 }
    );
    await page.keyboard.press(`${modifier}+s`);
    expect((await saved).postDataJSON().data).toContain("from 'dino-ge'");
  } finally {
    releaseTypes();
  }

  await page.waitForFunction(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return !!monaco.typescript.javascriptDefaults.getCompilerOptions().paths?.['dino-ge'];
  });

  await expect.poll(() => page.evaluate(async () => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    const model = monaco.editor.getModels().find(candidate =>
      candidate.getValue().startsWith('import { Vector2 }')
    );
    if (!model) return null;

    const getWorker = await monaco.typescript.getJavaScriptWorker();
    const worker = await getWorker(model.uri);
    const fileName = model.uri.toString();
    const diagnostics = await worker.getSemanticDiagnostics(fileName);
    const definitions = await worker.getDefinitionAtPosition(fileName, 9);
    return {
      diagnostics: diagnostics.map(diagnostic => diagnostic.code),
      resolves: definitions?.some(definition => definition.fileName.endsWith('/math/Vector2.d.ts')),
    };
  })).toEqual({ diagnostics: [], resolves: true });
});
