import { expect, test } from '@playwright/test';
import type { Monaco } from '@monaco-editor/react';

for (const failure of [
  { name: 'synchronous setup', callback: "onLoad() { throw new Error('Missing level data'); }", heading: 'Game setup failed', message: 'Missing level data' },
  { name: 'asynchronous setup', callback: "async onLoad() { await Promise.resolve(); throw new Error('Missing level data'); }", heading: 'Game setup failed', message: 'Missing level data' },
  {
    name: 'frame update',
    callback: `async onLoad() { throw new Error('Missing optional level data'); },
update() { throw Object.assign(new Error('Physics update failed'), { stack: [] }); }`,
    heading: 'Game stopped running',
    message: 'Physics update failed',
  },
]) {
  test(`reports ${failure.name} failures in the viewport and recovers after reset`, async ({ page }) => {
    let source = `import { Engine } from 'dino-ge';
new Engine({ ${failure.callback} }, { containerId: 'playground-canvas-container' });`;
    await page.route('**/files', route => route.fulfill({ json: ['script'] }));
    await page.route('**/api/scripts/script', route => {
      if (route.request().method() === 'PUT') {
        source = route.request().postDataJSON().data;
        return route.fulfill({ status: 204 });
      }
      return route.fulfill({ json: source });
    });
    await page.goto('/');

    const alert = page.getByRole('alert').filter({ hasText: failure.heading });
    await expect(alert).toContainText(failure.message);
    await page.getByRole('button', { name: 'Collapse editor' }).click();
    await page.getByRole('button', { name: 'Open Console', exact: true }).click();
    const consoleTab = page.getByRole('tab', { name: 'Console' });
    await expect(consoleTab).toHaveAttribute('aria-selected', 'true');
    await expect(consoleTab).toBeFocused();
    await expect(page.locator('.console-line.error').filter({ hasText: failure.message })).toHaveCount(1);

    await page.getByRole('tab', { name: 'Editor' }).click();
    await expect(page.locator('.monaco-editor')).toBeVisible();
    await page.evaluate(() => {
      const { monaco } = window as typeof window & { monaco: Monaco };
      monaco.editor.getEditors()[0].setValue(`import { Engine, Rectangle, Vector2 } from 'dino-ge';
new Engine({ onLoad() {
  new Rectangle({ tag: 'Repaired level', position: new Vector2(60, 60), width: 40, height: 30 });
} }, { containerId: 'playground-canvas-container' });`);
    });
    await page.getByRole('button', { name: 'Reset game' }).click();
    await expect(page.getByRole('button', { name: 'Repaired level', exact: true })).toBeVisible();
    await expect(alert).toHaveCount(0);
  });
}

test('reports entry evaluation and missing dependencies, then runs the repaired script', async ({ page }) => {
  let source = "throw new Error('Level definition is invalid');";
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: source }));
  await page.route('**/missing-game-module.mjs', route => route.fulfill({ status: 404 }));
  await page.route('**/fixture-game-module.mjs', route => route.fulfill({
    contentType: 'application/javascript', body: "export const label = 'Recovered module';",
  }));
  await page.goto('/');

  const alert = page.getByRole('alert').filter({ hasText: 'Game script failed to run' });
  await expect(alert).toContainText('Level definition is invalid');
  await page.getByRole('button', { name: 'Open Console', exact: true }).click();
  const errors = page.locator('.console-line.error');
  await expect(errors.filter({ hasText: 'Level definition is invalid' })).toHaveCount(1);

  source = "import './missing-game-module.mjs';";
  await page.getByRole('button', { name: 'Reset game' }).click();
  await expect(alert).toBeVisible();
  await expect(alert).not.toContainText('Level definition is invalid');
  await expect(errors.filter({ hasText: 'Could not run the game script' })).toHaveCount(2);

  source = "import '//[';";
  await page.getByRole('button', { name: 'Reset game' }).click();
  await expect(errors.filter({ hasText: 'Could not run the game script' })).toHaveCount(3);
  await expect(alert).toBeVisible();

  source = `#!/usr/bin/env node
import { label } from '/fixture-game-module.mjs';
export function then() { throw new Error('The entry exports a then function'); }
const globalThis = 'A local binding';
const __dinoModuleRuntime = globalThis;
const meta = import.meta;
const specifier = './fixture-game-module.mjs';
let evaluated = false;
const { label: dynamicLabel } = await await import(await (evaluated = true, Promise.resolve(specifier)));
const invalidSpecifier = await import(Symbol()).catch(error => error instanceof TypeError);
const malformedPath = await import('//[').catch(error => error instanceof TypeError);
let handled = false;
try { await Promise.reject({ message: 'level missing' }); }
catch ({ message }) { handled = message === 'level missing'; }
finally {await Promise.resolve();}
if (meta.url !== location.href || meta.resolve(specifier) !== new URL(specifier, location.href).href) {
  throw new Error('Entry module metadata changed');
}
const output = document.createElement('p');
output.dataset.playgroundGame = '';
output.textContent = evaluated && invalidSpecifier && malformedPath && handled && label === dynamicLabel
  ? label : 'Unexpected dynamic import';
document.getElementById('playground-canvas-container').append(output);`;
  await page.getByRole('button', { name: 'Reset game' }).click();
  await expect(page.getByText('Recovered module', { exact: true })).toBeVisible();
  await expect(alert).toHaveCount(0);
});

test('a replaced entry does not start after its delayed dependency arrives', async ({ page }) => {
  await page.route('**/files', route => route.fulfill({ json: ['script', 'next'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import './slow-game-module.mjs';
document.body.dataset.staleGameStarted = 'true';
throw new Error('Previous game failed');` }));
  let releaseNext!: () => void;
  const nextReady = new Promise<void>(resolve => { releaseNext = resolve; });
  await page.route('**/api/scripts/next', async route => {
    await nextReady;
    await route.fulfill({ json: `
import { Engine, Rectangle, Vector2 } from 'dino-ge';
new Engine({ onLoad() {
  new Rectangle({ tag: 'Current game', position: new Vector2(60, 60), width: 40, height: 30 });
} }, { containerId: 'playground-canvas-container' });` });
  });
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/slow-game-module.mjs', async route => {
    await delayed;
    await route.fulfill({ contentType: 'application/javascript',
      body: "document.body.dataset.oldDependencyLoaded = 'true';" });
  });
  const dependencyRequested = page.waitForRequest('**/slow-game-module.mjs');
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await dependencyRequested;
    const nextRequested = page.waitForRequest('**/api/scripts/next');
    await page.getByRole('combobox', { name: 'Current script' }).selectOption('next');
    await nextRequested;
    release();
    await expect(page.locator('body')).toHaveAttribute('data-old-dependency-loaded', 'true');
    expect(await page.locator('body').getAttribute('data-stale-game-started')).toBeNull();
    await expect(page.getByRole('alert').filter({ hasText: 'Previous game failed' })).toHaveCount(0);
  } finally {
    release();
    releaseNext();
  }
  await expect(page.getByRole('button', { name: 'Current game', exact: true })).toBeVisible();
  expect(await page.locator('body').getAttribute('data-stale-game-started')).toBeNull();
  await expect(page.getByRole('alert').filter({ hasText: 'Previous game failed' })).toHaveCount(0);
});

for (const settlement of ['resolves', 'rejects'] as const) {
  test(`a replaced entry cannot start a game after its top-level await ${settlement}`, async ({ page }) => {
    await page.route('**/files', route => route.fulfill({ json: ['script', 'next'] }));
    await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine, Rectangle, Vector2 } from 'dino-ge';
try {
  await new Promise((resolve, reject) => {
    window.addEventListener('resume-previous-game', () => ${settlement === 'resolves' ? 'resolve()' : 'reject({})'}, { once: true });
    document.body.dataset.previousGameWaiting = 'true';
  });
} catch ({ fallback = (document.body.dataset.previousGameFallback = 'true') }) {
  document.body.dataset.previousGameHandled = 'true';
} finally {
  document.body.dataset.previousGameFinished = 'true';
}
document.body.dataset.previousGameResumed = 'true';
new Engine({ onLoad() {
  new Rectangle({ tag: 'Previous game', position: new Vector2(60, 60), width: 40, height: 30 });
} }, { containerId: 'playground-canvas-container' });` }));
    await page.route('**/api/scripts/next', route => route.fulfill({ json: `
import { Engine, Rectangle, Vector2 } from 'dino-ge';
new Engine({ onLoad() {
  new Rectangle({ tag: 'Current game', position: new Vector2(60, 60), width: 40, height: 30 });
} }, { containerId: 'playground-canvas-container' });` }));

    await page.goto('/');
    const body = page.locator('body');
    await expect(body).toHaveAttribute('data-previous-game-waiting', 'true');
    await page.getByRole('combobox', { name: 'Current script' }).selectOption('next');
    const currentGame = page.getByRole('button', { name: 'Current game', exact: true });
    await expect(currentGame).toBeVisible();

    await page.evaluate(async () => {
      window.dispatchEvent(new Event('resume-previous-game'));
      await new Promise(requestAnimationFrame);
    });
    expect(await body.getAttribute('data-previous-game-fallback')).toBeNull();
    expect(await body.getAttribute('data-previous-game-handled')).toBeNull();
    expect(await body.getAttribute('data-previous-game-finished')).toBeNull();
    expect(await body.getAttribute('data-previous-game-resumed')).toBeNull();
    await expect(currentGame).toBeVisible();
    await expect(page.locator('#playground-canvas-container canvas')).toHaveCount(1);
    await expect(page.getByRole('alert').filter({ hasText: 'Game script failed to run' })).toHaveCount(0);
  });
}

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
  await page.getByRole('tab', { name: 'Console' }).click();
  await page.getByRole('button', { name: 'Insert rectangle code', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Editor' })).toHaveAttribute('aria-selected', 'true');
  await expect(editor).toContainText('new Rectangle');
  await expect(editor).toContainText('local draft');
  await expect.poll(() => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getEditors()[0].getValue();
  })).toContain("import { Rectangle, Vector2 } from 'dino-ge';");
  await expect(page.getByRole('button', { name: 'Edit scene', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('selects an object in Explorer and writes an Inspector change back to the script', async ({ page }) => {
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  let source = `
import { Engine, Rectangle, Vector2 } from 'dino-ge';
new Engine({
  onLoad() {
    new Rectangle({ tag: 'reserved-box', position: new Vector2(72, 24), width: 30, height: 30 });
    new Rectangle({ 'tag': 'beta-box', position: new Vector2(12, 24), width: 30, height: 30, colour: '#abc' });
  },
  update: () => {},
}, { containerId: 'playground-canvas-container' });
`;
  await page.route('**/api/scripts/script', route => {
    if (route.request().method() === 'PUT') {
      source = route.request().postDataJSON().data;
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ json: source });
  });
  await page.goto('/');
  const original = page.getByRole('button', { name: 'beta-box', exact: true });
  await expect(original).toBeVisible();
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await original.press('Enter');
  const x = page.getByRole('spinbutton', { name: 'X', exact: true });
  await x.fill('120');
  await page.getByRole('button', { name: 'Save X to code', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getModels().find(model => model.getLanguageId() === 'javascript')?.getValue();
  })).toContain('new Vector2(120, 24)');
  const tag = page.getByRole('textbox', { name: 'Tag', exact: true });
  const saveTag = page.getByRole('button', { name: 'Save Tag to code', exact: true });
  await tag.fill('reserved-box');
  await saveTag.click();
  await expect(tag).toHaveAccessibleDescription('Could not save this tag to a unique constructor in the open script.');
  await expect.poll(() => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getEditors()[0].getValue();
  })).toContain("tag: 'beta-box'");
  await tag.fill("beta's box");
  await saveTag.click();
  await expect.poll(() => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getModels().find(model => model.getLanguageId() === 'javascript')?.getValue();
  })).toContain(`tag: "beta's box"`);
  const renamed = page.getByRole('button', { name: "beta's box", exact: true });
  await expect(renamed).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'View source', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    const editor = monaco.editor.getEditors()[0];
    const position = editor.getPosition();
    const model = editor.getModel();
    if (!position || !model || !editor.hasTextFocus()) return '';
    return model.getValue().slice(model.getOffsetAt(position), model.getOffsetAt(position) + 100);
  })).toMatch(/^new Rectangle\(\{\s*tag: "beta's box"/);
  await page.getByRole('button', { name: 'Undo code edit', exact: true }).click();
  await expect(original).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Redo code edit', exact: true }).click();
  await expect(renamed).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'reserved-box', exact: true }).click();
  await x.fill('7200');
  await page.getByRole('button', { name: 'Save X to code', exact: true }).click();
  const undo = page.getByRole('button', { name: 'Undo code edit', exact: true });
  await undo.click();
  await expect(renamed).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getEditors()[0].getValue();
  })).toContain('new Vector2(72, 24)');
  await undo.click();
  await expect(original).toBeVisible();
  await page.getByRole('button', { name: 'Redo code edit', exact: true }).click();
  await renamed.click();
  await x.fill('135');
  await page.getByRole('button', { name: 'Save X to code', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getEditors()[0].getValue();
  })).toContain('new Vector2(135, 24)');

  await page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    const editor = monaco.editor.getEditors()[0];
    editor.setValue(editor.getValue().replace(`tag: "beta's box"`, "tag: 'other-box'")
      .replace("tag: 'reserved-box'", `tag: "beta's box"`));
  });
  await tag.fill('unsafe rename');
  await saveTag.click();
  await expect(tag).toHaveAccessibleDescription('Reset the game to refresh this object’s source after editing the script.');
  await expect.poll(() => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getEditors()[0].getValue();
  })).not.toContain('unsafe rename');
  await page.getByRole('button', { name: 'Reset game', exact: true }).click();
  await expect(page.getByRole('button', { name: 'other-box', exact: true })).toBeVisible();
  await renamed.click();
  await tag.fill('fresh rename');
  await saveTag.click();
  await expect.poll(() => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getEditors()[0].getValue();
  })).toContain('tag: "fresh rename"');
});

test('previews and saves shape fill colours from CSS text and the colour picker', async ({ page }) => {
  let source = `import { Engine, Rectangle, Circle, Vector2 } from 'dino-ge';
new Engine({ onLoad() {
  new Rectangle({ tag: 'Platform', position: new Vector2(330, 240), width: 64, height: 48, colour: 'red' });
  new Circle({ tag: 'Badge', position: new Vector2(520, 240), radius: 24 });
}, update() {} }, { containerId: 'playground-canvas-container' });`;
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => {
    if (route.request().method() === 'PUT') {
      source = route.request().postDataJSON().data;
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ json: source });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await page.getByRole('button', { name: 'Platform', exact: true }).click();
  const colour = page.getByRole('textbox', { name: 'Fill colour', exact: true });
  await expect(colour).toHaveValue('red', { timeout: 3000 });
  const canvas = page.locator('#canvas');
  const pixel = () => canvas.evaluate((element: HTMLCanvasElement) =>
    Array.from(element.getContext('2d')!.getImageData(350, 260, 1, 1).data));
  await colour.fill('rebeccapurple');
  await expect.poll(pixel).toEqual([102, 51, 153, 255]);
  const picker = page.getByLabel('Choose fill colour', { exact: true });
  await expect(picker).toHaveValue('#663399');
  await colour.fill('broken colour');
  await expect(colour).toHaveAttribute('aria-invalid', 'true');
  const save = page.getByRole('button', { name: 'Save Fill colour to code', exact: true });
  await expect(save).toBeDisabled();
  expect(await pixel()).toEqual([102, 51, 153, 255]);
  await picker.fill('#ffd166');
  await expect(colour).toHaveValue('#ffd166');
  await expect.poll(pixel).toEqual([255, 209, 102, 255]);
  await save.click();
  await page.getByRole('button', { name: 'Badge', exact: true }).click();
  await expect(colour).toHaveValue('black');
  await colour.fill('rgba(10, 20, 30, 0.5)');
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) =>
    element.getContext('2d')!.getImageData(544, 264, 1, 1).data[0])).toBeGreaterThan(120);
  await save.click();
  await page.getByRole('button', { name: 'Save script', exact: true }).click();
  await expect.poll(() => source).toContain('rgba(10, 20, 30, 0.5)');
  await page.reload();
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await page.getByRole('button', { name: 'Platform', exact: true }).click();
  await expect(colour).toHaveValue('#ffd166');
  await expect.poll(pixel).toEqual([255, 209, 102, 255]);
  await page.getByRole('button', { name: 'Badge', exact: true }).click();
  await expect(colour).toHaveValue('rgba(10, 20, 30, 0.5)');
});

test('uses canvas and code history from the keyboard without losing an unfinished drag', async ({ page }) => {
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine, Rectangle, Vector2 } from 'dino-ge';
new Engine({ onLoad() {
  new Rectangle({ tag: 'Platform', position: new Vector2(350, 220), width: 64, height: 48 });
}, update() {} }, { containerId: 'playground-canvas-container' });` }));
  await page.goto('/');
  const platform = page.getByRole('button', { name: 'Platform', exact: true });
  await expect(platform).toBeVisible();
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await platform.click();
  const scene = page.getByRole('region', { name: 'Scene viewport' });
  const x = page.getByRole('spinbutton', { name: 'X', exact: true });
  const readSource = () => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getEditors()[0].getValue();
  });
  await scene.press('Shift+ArrowRight');
  await page.getByRole('button', { name: 'Apply placement to code' }).click();
  await expect.poll(readSource).toContain('new Vector2(360, 220)');
  await scene.press('Control+z');
  await expect(x).toHaveValue('350.00');
  await expect.poll(readSource).toContain('new Vector2(350, 220)');
  await scene.press('Meta+Shift+Z');
  await expect(x).toHaveValue('360.00');

  const canvas = page.locator('#canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 380, box.y + 245);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 245, { steps: 4 });
  const readout = page.getByRole('group', { name: 'Current scene gesture' });
  await expect(readout).toContainText('Move');
  await expect.poll(async () => Number(await x.inputValue())).toBeGreaterThan(378);
  const draggingX = await x.inputValue();
  await scene.press('ArrowRight');
  await expect(x).toHaveValue(draggingX);
  await expect(platform).toHaveAccessibleDescription('');
  await scene.press('Control+z');
  await expect(readout).toContainText('Move');
  expect(await readSource()).toContain('new Vector2(360, 220)');
  await page.mouse.up();
  await expect(platform).toHaveAccessibleDescription('Pending canvas changes');
  await expect.poll(async () => Number(await x.inputValue())).toBeGreaterThan(378);
  const movedX = await x.inputValue();
  await scene.press('ArrowRight');
  await expect(x).toHaveValue((Number(movedX) + 1).toFixed(2));
  await expect(page.getByRole('button', { name: 'Undo canvas edit', exact: true })).toBeEnabled();
  await scene.press('Control+z');
  await expect(x).toHaveValue(movedX);
  await expect(platform).toHaveAccessibleDescription('Pending canvas changes');
  await scene.press('Control+z');
  await expect(x).toHaveValue('360.00');
  await expect(platform).toHaveAccessibleDescription('');
  await page.getByRole('button', { name: 'Redo canvas edit', exact: true }).click();
  await expect(x).toHaveValue(movedX);
  await expect(platform).toHaveAccessibleDescription('Pending canvas changes');
  expect(await readSource()).toContain('new Vector2(360, 220)');

  await page.getByRole('button', { name: 'Discard canvas changes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Redo canvas edit', exact: true })).toHaveCount(0);
  await scene.press('Meta+z');
  await expect(x).toHaveValue('350.00');
  await scene.press('Control+y');
  await expect(x).toHaveValue('360.00');
  await expect.poll(readSource).toContain('new Vector2(360, 220)');
});

test('keeps live resize history for another object when applying a move to code', async ({ page }) => {
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine, Rectangle, Vector2 } from 'dino-ge';
new Engine({ onLoad() {
  new Rectangle({ tag: 'Platform', position: new Vector2(350, 220), width: 64, height: 48 });
  new Rectangle({ tag: 'Wall', position: new Vector2(520, 220), width: 32, height: 96 });
}, update() {} }, { containerId: 'playground-canvas-container' });` }));
  await page.goto('/');
  const platform = page.getByRole('button', { name: 'Platform', exact: true });
  const wall = page.getByRole('button', { name: 'Wall', exact: true });
  await expect(platform).toBeVisible();
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await platform.click();
  const canvas = page.locator('#canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 414, box.y + 268);
  await page.mouse.down();
  await page.mouse.move(box.x + 430, box.y + 284, { steps: 4 });
  await page.mouse.up();
  const width = page.getByRole('spinbutton', { name: 'Width', exact: true });
  await expect.poll(async () => Number(await width.inputValue())).toBeGreaterThan(78);
  const resizedWidth = await width.inputValue();
  await wall.click();
  await wall.press('ArrowRight');
  const apply = page.getByRole('button', { name: 'Apply placement to code', exact: true });
  await apply.click();
  await expect(wall).toHaveAccessibleDescription('');
  await expect(platform).toHaveAccessibleDescription('Pending canvas changes');

  await platform.click();
  await page.getByRole('button', { name: 'Undo canvas edit', exact: true }).click();
  await expect(width).toHaveValue('64.00');
  await expect(platform).toHaveAccessibleDescription('');
  await page.getByRole('button', { name: 'Redo canvas edit', exact: true }).click();
  await expect(width).toHaveValue(resizedWidth);
  await expect(platform).toHaveAccessibleDescription('Pending canvas changes');
  await apply.click();
  await page.getByRole('button', { name: 'Undo code edit', exact: true }).click();
  await expect(width).toHaveValue('64.00');
  await wall.click();
  await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('521.00');
});

test('duplicates and deletes standalone hand-written objects with source and scene history', async ({ page }) => {
  let source = `import { Engine, Rectangle as Platform, Vector2 as Vec } from 'dino-ge';
new Engine({ onLoad() {
  new Platform({ tag: 'Handmade platform', position: new Vec(350, 220), width: 64, height: 48 });
  const bound = new Platform({ tag: 'Bound platform', position: new Vec(520, 220), width: 64, height: 48 });
  void bound;
  const width = 64;
  new Platform({ tag: 'Computed platform', position: new Vec(600, 300), width, height: 48 });
  for (let i = 0; i < 2; i++) {
    new Platform({ tag: 'Repeated platform', position: new Vec(600, 380), width: 64, height: 48 });
  }
}, update() {} }, { containerId: 'playground-canvas-container' });`;
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => {
    if (route.request().method() === 'PUT') {
      source = route.request().postDataJSON().data;
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ json: source });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  const duplicate = page.getByRole('button', { name: 'Duplicate object', exact: true });
  const remove = page.getByRole('button', { name: 'Delete object', exact: true });
  await page.getByRole('button', { name: 'Bound platform', exact: true }).click();
  await expect(duplicate).toHaveCount(0);
  await expect(remove).toHaveCount(0);
  await page.getByRole('button', { name: 'Computed platform', exact: true }).click();
  await expect(duplicate).toHaveCount(0);
  await expect(remove).toHaveCount(0);
  const repeated = page.getByRole('button', { name: 'Repeated platform', exact: true });
  await expect(repeated).toHaveCount(2);
  await repeated.first().click();
  await expect(duplicate).toHaveCount(0);
  await expect(remove).toHaveCount(0);
  const original = page.getByRole('button', { name: 'Handmade platform', exact: true });
  await original.click();
  await expect(duplicate).toBeVisible();
  await duplicate.click();
  const copy = page.getByRole('button', { name: 'Handmade platform copy', exact: true });
  await expect(copy).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('374.00');
  await original.click();
  await remove.click();
  await expect(original).toHaveCount(0);
  await expect(copy).toBeVisible();
  await page.getByRole('button', { name: 'Undo code edit', exact: true }).click();
  await expect(original).toBeVisible();
  await page.getByRole('button', { name: 'Redo code edit', exact: true }).click();
  await expect(original).toHaveCount(0);

  const saved = page.waitForResponse(response => response.request().method() === 'PUT' &&
    response.url().endsWith('/api/scripts/script'));
  await page.getByRole('button', { name: 'Save script', exact: true }).click();
  await saved;
  expect(source).toMatch(/new Platform\(\{\s*tag: ['"]Handmade platform copy['"],\s*position: new Vec\(374, 244\)/);
  await page.reload();
  await expect(copy).toBeVisible();
  await expect(original).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Bound platform', exact: true })).toBeVisible();
});

test('keeps live Inspector values and save controls readable in a narrow panel', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 800 });
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine, Rectangle, Vector2 } from 'dino-ge';
new Engine({ onLoad() {
  new Rectangle({ tag: 'Platform', position: new Vector2(350, 220), width: 64, height: 48 });
}, update() {} }, { containerId: 'playground-canvas-container' });` }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await page.getByRole('button', { name: 'Platform', exact: true }).click();

  const rotation = page.getByRole('spinbutton', { name: 'Rotation (°)', exact: true });
  await expect(rotation).toHaveValue('0.00');
  const layout = await rotation.evaluate((input: HTMLInputElement) => {
    const field = input.getBoundingClientRect();
    const label = input.labels![0].getBoundingClientRect();
    return { fieldWidth: field.width, labelAboveField: label.bottom <= field.top };
  });
  expect(layout.labelAboveField).toBe(true);
  expect(layout.fieldWidth).toBeGreaterThanOrEqual(72);

  await rotation.fill('-123.45');
  await expect.poll(() => page.evaluate(() => {
    const { Engine } = window as unknown as { Engine: { selectedObject: { transform: { rotation: number } } } };
    return Engine.selectedObject.transform.rotation * 180 / Math.PI;
  })).toBeCloseTo(-123.45);
  const save = page.getByRole('button', { name: 'Save Rotation (°) to code', exact: true });
  await expect(save).toHaveCSS('opacity', '1');
  const { width, height } = (await save.boundingBox())!;
  expect(Math.min(width, height)).toBeGreaterThanOrEqual(32);
  await save.press('Enter');
  await expect.poll(() => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    const code = monaco.editor.getEditors()[0].getValue();
    const angle = code.match(/new Rectangle\(\{\s*rotation:\s*(-[\d.]+),/)?.[1];
    return Number(angle) * 180 / Math.PI;
  })).toBeCloseTo(-123.45);
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
  // Keep this exact-coordinate test at 1:1 scale. The overlap test covers CSS scaling.
  await canvas.evaluate((element: HTMLCanvasElement) => {
    element.style.width = `${element.width}px`;
    element.style.height = `${element.height}px`;
  });
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
  const readout = page.getByRole('group', { name: 'Current scene gesture' });
  await expect(readout).toHaveText('Move · Local X 30 · Y 0');
  await page.keyboard.press('Escape');
  await expect(readout).toHaveCount(0);
  await expect(x).toHaveValue('10.00');
  await page.mouse.move(box.x + 185, box.y + 185);
  await page.mouse.up();
  await expect(x).toHaveValue('10.00');
  await expect(page.getByRole('button', { name: 'Apply placement to code' })).toHaveCount(0);

  await page.mouse.move(box.x + 125, box.y + 125);
  await page.mouse.down();
  await page.mouse.move(box.x + 155, box.y + 165, { steps: 5 });
  await page.mouse.up();
  await page.mouse.move(box.x + 185, box.y + 185);
  await expect.poll(async () => Number(await x.inputValue())).toBeCloseTo(30);

  await page.mouse.move(box.x + 102, box.y + 201);
  await expect(canvas).toHaveCSS('cursor', 'se-resize');
  const width = page.getByRole('spinbutton', { name: 'Width', exact: true });
  const height = page.getByRole('spinbutton', { name: 'Height', exact: true });
  await page.mouse.down();
  await page.mouse.move(box.x + 72, box.y + 221, { steps: 5 });
  await expect.poll(async () => Number(await width.inputValue())).toBeCloseTo(30, 0);
  await expect(readout).toHaveText('Resize · W 30 · H 30');
  await page.keyboard.press('Escape');
  await expect(readout).toHaveCount(0);
  await page.mouse.up();
  await expect(width).toHaveValue('20.00');
  await expect(height).toHaveValue('20.00');
  await expect(x).toHaveValue('30.00');

  await page.mouse.move(box.x + 102, box.y + 201);
  await page.mouse.down();
  await page.mouse.move(box.x + 72, box.y + 221, { steps: 5 });
  await expect(readout).toHaveText('Resize · W 30 · H 30');
  await page.mouse.up();
  await expect(readout).toHaveCount(0);
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

test('positions Library objects and sprites with the keyboard before placing them', async ({ page }) => {
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine, Loader } from 'dino-ge';
new Engine({ async onLoad() {
  Loader.queueImage('gem', '/gem.svg');
  await Loader.loadAll();
}, update() {} }, { containerId: 'playground-canvas-container' });` }));
  await page.route('**/gem.svg', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="32"><rect width="48" height="32" fill="orange"/></svg>',
  }));
  await page.goto('/');
  const canvas = page.locator('#canvas');
  await expect(canvas).toBeVisible();
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await page.getByRole('button', { name: 'Snap to grid' }).click();
  const viewport = page.getByRole('region', { name: 'Scene viewport' });
  const add = page.getByRole('button', { name: 'Add rectangle', exact: true });
  const object = page.getByRole('button', { name: 'New rectangle', exact: true });
  const preview = page.locator('.scene-drop-preview');
  const centre = await canvas.evaluate((element: HTMLCanvasElement) => ({
    x: Math.round(element.width / 32) * 16, y: Math.round(element.height / 32) * 16,
  }));
  await add.press('Shift+Enter');
  await expect(viewport).toBeFocused();
  await expect(preview.getByRole('status')).toHaveText(`Rectangle · X ${centre.x} · Y ${centre.y}`);
  await page.keyboard.press('ArrowRight');
  await expect(preview.getByRole('status')).toHaveText(`Rectangle · X ${centre.x + 16} · Y ${centre.y}`);
  await page.keyboard.press('Escape');
  await expect(add).toBeFocused();
  await expect(preview).toHaveCount(0);
  await expect(object).toHaveCount(0);

  await add.press('Shift+Enter');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(object).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue((centre.x - 16).toFixed(2));
  await expect(page.getByRole('spinbutton', { name: 'Y', exact: true })).toHaveValue((centre.y - 16).toFixed(2));
  await expect(preview).toHaveCount(0);

  await page.getByRole('button', { name: 'Assets', exact: true }).click();
  const asset = page.getByRole('button', { name: 'Add gem as sprite', exact: true });
  await expect(asset).toBeEnabled();
  await asset.press('Shift+Enter');
  await expect(preview.locator('img')).toHaveAttribute('src', /\/gem\.svg$/);
  await page.keyboard.press('ArrowDown');
  await expect(preview.getByRole('status')).toHaveText(`gem · X ${centre.x} · Y ${centre.y + 16}`);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'gem sprite', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('spinbutton', { name: 'Y', exact: true })).toHaveValue((centre.y + 16).toFixed(2));
  await expect(preview).toHaveCount(0);
});

test('places Library objects by touch and pen with a snapped preview', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native touch and pen input in this test use Chromium’s DevTools protocol.');
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine } from 'dino-ge';
new Engine({ onLoad() {}, update() {} }, { containerId: 'playground-canvas-container' });` }));
  await page.goto('/');
  const canvas = page.locator('#canvas');
  await expect(canvas).toBeVisible();
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await page.getByRole('button', { name: 'Snap to grid' }).click();
  const box = (await canvas.boundingBox())!;
  const size = await canvas.evaluate((element: HTMLCanvasElement) => ({ width: element.width, height: element.height }));
  const screen = (x: number, y: number) => ({
    x: box.x + x * box.width / size.width, y: box.y + y * box.height / size.height,
  });
  const buttonPoint = async (name: string) => {
    const rect = (await page.getByRole('button', { name, exact: true }).boundingBox())!;
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  };
  const session = await page.context().newCDPSession(page);
  const preview = page.locator('.scene-drop-preview');
  const rectangle = page.getByRole('button', { name: 'New rectangle', exact: true });
  const touchDrag = async () => {
    const start = await buttonPoint('Add rectangle');
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...start, x: start.x + 48 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [screen(310, 210)] });
    await expect(preview).toContainText('Rectangle · X 304 · Y 208');
  };
  await touchDrag();
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(preview).toHaveCount(0);
  await expect(rectangle).toHaveCount(0);

  await touchDrag();
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 10, y: 280 }] });
  await expect(preview).toHaveCount(0);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(rectangle).toHaveCount(0);

  await touchDrag();
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(preview).toHaveCount(0);
  await expect(rectangle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('304.00');
  await expect(rectangle).toHaveCount(1);

  const penStart = await buttonPoint('Add line');
  const penEnd = screen(410, 258);
  await session.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', ...penStart, pointerType: 'pen', button: 'left', buttons: 1, clickCount: 1,
  });
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', ...penEnd, pointerType: 'pen', buttons: 1,
  });
  await expect(preview).toContainText('Line · X 416 · Y 256');
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', ...penEnd, pointerType: 'pen', button: 'left', buttons: 0, clickCount: 1,
  });
  await expect(page.getByRole('button', { name: 'New line', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('416.00');
  await expect(preview).toHaveCount(0);

  const circle = await buttonPoint('Add circle');
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [circle] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByRole('button', { name: 'New circle', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const source = await page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getEditors()[0].getValue();
  });
  expect(source).toContain('new Rectangle');
  expect(source).toContain('new Line');

  const editor = page.locator('.monaco-editor');
  const editorBox = (await editor.boundingBox())!;
  const line = await buttonPoint('Add line');
  const editorPoint = { x: editorBox.x + editorBox.width / 2, y: editorBox.y + editorBox.height / 2 };
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [line] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [editorPoint] });
  await expect(page.getByText('Drop to insert code')).toBeVisible();
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByText('Drop to insert code')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Inserted New line 2' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New line 2', exact: true })).toHaveCount(0);
});

test('previews and places sprite images from Assets with touch and pen', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native touch and pen input in this test use Chromium’s DevTools protocol.');
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine, Loader } from 'dino-ge';
new Engine({ async onLoad() {
  Loader.queueImage('gem', '/gem.svg');
  await Loader.loadAll();
}, update() {} }, { containerId: 'playground-canvas-container' });` }));
  await page.route('**/gem.svg', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="32"><rect width="48" height="32" fill="orange"/></svg>',
  }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Assets', exact: true }).click();
  const asset = page.getByRole('button', { name: 'Add gem as sprite', exact: true });
  const edit = page.getByRole('button', { name: 'Edit scene', exact: true });
  await expect(asset).toBeDisabled();
  await edit.click();
  await expect(asset).toBeEnabled();
  await page.getByRole('button', { name: 'Snap to grid' }).click();
  const canvas = page.locator('#canvas');
  const box = (await canvas.boundingBox())!;
  const size = await canvas.evaluate((element: HTMLCanvasElement) => ({ width: element.width, height: element.height }));
  const screen = (x: number, y: number) => ({
    x: box.x + x * box.width / size.width, y: box.y + y * box.height / size.height,
  });
  const startPoint = async () => {
    const rect = (await asset.boundingBox())!;
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  };
  const session = await page.context().newCDPSession(page);
  const preview = page.locator('.scene-drop-preview');
  const sprite = page.getByRole('button', { name: 'gem sprite', exact: true });
  const start = await startPoint();
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...start, x: start.x + 48 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [screen(310, 210)] });
  await expect(preview).toContainText('gem · X 304 · Y 208');
  await expect(preview.locator('img')).toHaveAttribute('src', /\/gem\.svg$/);
  await expect.poll(async () => (await preview.locator('.scene-drop-outline').boundingBox())?.width ?? 0)
    .toBeCloseTo(48 * box.width / size.width, 0);
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [screen(size.width - 8, 210)] });
  await expect.poll(async () => Number((await preview.innerText()).match(/X (\d+)/)?.[1])).toBeGreaterThan(size.width + 24);
  await expect(preview.locator('img')).toHaveAttribute('src', /\/gem\.svg$/);
  await edit.press('Enter');
  await expect(preview).toHaveCount(0);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(sprite).toHaveCount(0);
  expect(await page.evaluate(() => {
    const { Engine } = window as unknown as { Engine: { camera: { position: { x: number } } } };
    return Engine.camera.position.x;
  })).toBe(0);
  await edit.click();
  await expect(asset).toBeEnabled();

  const end = screen(410, 258);
  await session.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', ...await startPoint(), pointerType: 'pen', button: 'left', buttons: 1, clickCount: 1,
  });
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...end, pointerType: 'pen', buttons: 1 });
  await expect(preview).toContainText('gem · X 416 · Y 256');
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', ...end, pointerType: 'pen', button: 'left', buttons: 0, clickCount: 1,
  });
  await expect(sprite).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('416.00');
  await expect(page.getByRole('spinbutton', { name: 'Width', exact: true })).toHaveValue('48.00');
  await expect(preview).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getEditors()[0].getValue();
  })).toContain('src: "/gem.svg"');

  const editorBox = (await page.locator('.monaco-editor').boundingBox())!;
  const editorPoint = { x: editorBox.x + editorBox.width / 2, y: editorBox.y + editorBox.height / 2 };
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [await startPoint()] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [editorPoint] });
  await expect(page.getByText('Drop to insert code')).toBeVisible();
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByText('Drop to insert code')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Inserted gem sprite 2' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'gem sprite 2', exact: true })).toHaveCount(0);
});

test('pinches and pans the scene camera with two touches in the Hand tool', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native multi-touch input in this test uses Chromium’s DevTools protocol.');
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine, Rectangle, Vector2 } from 'dino-ge';
new Engine({ onLoad() {
  Engine.camera.position.set(40, 32);
  new Rectangle({ tag: 'Platform', position: new Vector2(350, 250), width: 64, height: 48 });
}, update() {} }, { containerId: 'playground-canvas-container' });` }));
  await page.goto('/');
  const platform = page.getByRole('button', { name: 'Platform', exact: true });
  await expect(platform).toBeVisible();
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await platform.click();
  await page.getByRole('button', { name: 'Pan view', exact: true }).click();
  const viewport = page.getByRole('region', { name: 'Scene viewport' });
  const canvas = page.locator('#canvas');
  const box = (await canvas.boundingBox())!;
  const { width, height } = await canvas.evaluate((element: HTMLCanvasElement) => ({
    width: element.width, height: element.height,
  }));
  const screen = (x: number, y: number, id: number) => ({
    x: box.x + x * box.width / width, y: box.y + y * box.height / height, id,
  });
  const session = await page.context().newCDPSession(page);
  const readCamera = () => page.evaluate(() => {
    const { Engine } = window as unknown as { Engine: { camera: { position: { x: number; y: number }; zoom: number } } };
    return { x: Engine.camera.position.x, y: Engine.camera.position.y, zoom: Engine.camera.zoom };
  });
  const pinch = async () => {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [screen(300, 250, 1), screen(400, 250, 2)],
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [screen(250, 250, 1), screen(450, 250, 2)],
    });
    // The world point (390, 282) stays at the original midpoint (350, 250).
    await expect.poll(readCamera).toMatchObject({ x: expect.closeTo(215, 0), y: expect.closeTo(157, 0), zoom: expect.closeTo(2, 2) });
    await expect(viewport).toHaveAccessibleDescription(/Zoom 200%/);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [screen(282, 270, 1), screen(482, 270, 2)],
    });
    await expect.poll(readCamera).toMatchObject({ x: expect.closeTo(199, 0), y: expect.closeTo(147, 0), zoom: expect.closeTo(2, 2) });
  };

  await pinch();
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect.poll(readCamera).toEqual({ x: 40, y: 32, zoom: 1 });
  await expect(viewport).toHaveAccessibleDescription(/Zoom 100%/);

  await pinch();
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [screen(282, 270, 1)] });
  await expect(canvas).toHaveCSS('cursor', 'grabbing');
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [screen(502, 280, 2)] });
  await expect.poll(readCamera).toMatchObject({ x: expect.closeTo(189, 0), y: expect.closeTo(142, 0), zoom: expect.closeTo(2, 2) });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(canvas).toHaveCSS('cursor', 'grab');
  await expect.poll(readCamera).toMatchObject({ x: expect.closeTo(189, 0), y: expect.closeTo(142, 0), zoom: expect.closeTo(2, 2) });
  await expect(platform).toHaveAccessibleDescription('');
  await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('350.00');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(readCamera).toEqual({ x: 40, y: 32, zoom: 1 });
});

test('edits canvas objects with touch and pen and rolls back cancelled contact', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native touch and pen input in this test use Chromium’s DevTools protocol.');
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine, Rectangle, Vector2 } from 'dino-ge';
new Engine({ onLoad() {
  new Rectangle({ tag: 'Platform', position: new Vector2(350, 220), width: 64, height: 48 });
}, update() {} }, { containerId: 'playground-canvas-container' });` }));
  await page.goto('/');
  const platform = page.getByRole('button', { name: 'Platform', exact: true });
  await expect(platform).toBeVisible();
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  const canvas = page.locator('#canvas');
  const box = (await canvas.boundingBox())!;
  const { width, height } = await canvas.evaluate((element: HTMLCanvasElement) => ({
    width: element.width, height: element.height,
  }));
  const screen = (x: number, y: number) => ({
    x: box.x + x * box.width / width, y: box.y + y * box.height / height,
  });
  const session = await page.context().newCDPSession(page);
  const readout = page.getByRole('group', { name: 'Current scene gesture' });
  const x = page.getByRole('spinbutton', { name: 'X', exact: true });
  const cameraX = () => page.evaluate(() => {
    const { Engine } = window as unknown as { Engine: { camera: { position: { x: number } } } };
    return Engine.camera.position.x;
  });
  const panTool = page.getByRole('button', { name: 'Pan view', exact: true });
  await panTool.click();
  await expect(panTool).toHaveAttribute('aria-pressed', 'true');
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [screen(380, 244)] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [screen(428, 244)] });
  await expect.poll(cameraX).toBeCloseTo(-48, 0);
  await expect(readout).toHaveCount(0);
  await expect(platform).toHaveAttribute('aria-pressed', 'false');
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect.poll(cameraX).toBe(0);

  const pen = { pointerType: 'pen' as const };
  await session.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', ...screen(380, 244), ...pen, button: 'left', buttons: 1, clickCount: 1,
  });
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', ...screen(428, 244), ...pen, buttons: 1,
  });
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', ...screen(428, 244), ...pen, button: 'left', buttons: 0, clickCount: 1,
  });
  await expect.poll(cameraX).toBeCloseTo(-48, 0);
  await expect(platform).toHaveAccessibleDescription('');
  await panTool.click();
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await expect.poll(cameraX).toBe(0);

  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [screen(380, 244)] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [screen(428, 244)] });
  await expect(readout).toContainText('Move');
  await expect.poll(async () => Number(await x.inputValue())).toBeCloseTo(398, 0);
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(readout).toHaveCount(0);
  await expect(x).toHaveValue('350.00');
  await expect(platform).toHaveAccessibleDescription('');

  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [screen(380, 244)] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [screen(428, 244)] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(platform).toHaveAccessibleDescription('Pending canvas changes');
  await expect.poll(async () => Number(await x.inputValue())).toBeCloseTo(398, 0);

  const proportions = page.getByRole('button', { name: 'Keep proportions', exact: true });
  await expect(proportions).toHaveAttribute('aria-pressed', 'false');
  await proportions.click();
  await expect(proportions).toHaveAttribute('aria-pressed', 'true');
  const corner = { ...screen(462, 268), pointerType: 'pen' as const };
  await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...corner, button: 'left', buttons: 1, clickCount: 1 });
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...screen(487, 268), pointerType: 'pen', buttons: 1 });
  await expect(readout).toContainText('Resize proportionally');
  const widthField = page.getByRole('spinbutton', { name: 'Width', exact: true });
  const heightField = page.getByRole('spinbutton', { name: 'Height', exact: true });
  await expect.poll(async () => Number(await widthField.inputValue())).toBeCloseTo(80, 0);
  await expect.poll(async () => Number(await heightField.inputValue())).toBeCloseTo(60, 0);
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', ...screen(487, 268), pointerType: 'pen', button: 'left', buttons: 0, clickCount: 1,
  });
  await expect(readout).toHaveCount(0);

  const snapRotation = page.getByRole('button', { name: 'Snap rotation to 15°', exact: true });
  await expect(snapRotation).toHaveAttribute('aria-pressed', 'false');
  await snapRotation.press('Space');
  await expect(snapRotation).toHaveAttribute('aria-pressed', 'true');
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [screen(438, 200)] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [screen(440, 270)] });
  await expect(readout).toHaveText('Rotate · 75°');
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(readout).toHaveCount(0);
  await page.getByRole('button', { name: 'Apply placement to code' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Applied to code' })).toBeVisible();
});

test('rolls back interrupted canvas gestures while preserving earlier pending edits', async ({ page }) => {
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine, Rectangle, Vector2 } from 'dino-ge';
new Engine({ onLoad() {
  new Rectangle({ tag: 'Platform', position: new Vector2(350, 220), width: 64, height: 48 });
  new Rectangle({ tag: 'Wall', position: new Vector2(520, 220), width: 25, height: 100 });
}, update() {} }, { containerId: 'playground-canvas-container' });` }));
  await page.goto('/');
  const platform = page.getByRole('button', { name: 'Platform', exact: true });
  const wall = page.getByRole('button', { name: 'Wall', exact: true });
  await expect(platform).toBeVisible();
  const edit = page.getByRole('button', { name: 'Edit scene', exact: true });
  await edit.click();
  await platform.click();
  await platform.press('Shift+ArrowRight');
  const x = page.getByRole('spinbutton', { name: 'X', exact: true });
  await expect(x).toHaveValue('360.00');
  const canvas = page.locator('#canvas');
  await canvas.evaluate((element: HTMLCanvasElement) => {
    element.style.width = `${element.width}px`;
    element.style.height = `${element.height}px`;
  });
  const box = (await canvas.boundingBox())!;
  const readout = page.getByRole('group', { name: 'Current scene gesture' });
  const dragPlatform = async () => {
    await page.mouse.move(box.x + 382, box.y + 243);
    await page.mouse.down();
    await page.mouse.move(box.x + 430, box.y + 243, { steps: 5 });
    await expect(readout).toBeVisible();
    await expect.poll(async () => Number(await x.inputValue())).toBeCloseTo(408, 0);
  };
  await dragPlatform();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(readout).toHaveCount(0);
  await expect(x).toHaveValue('360.00');
  await page.mouse.up();

  await dragPlatform();
  await wall.press('Enter');
  await expect(readout).toHaveCount(0);
  await platform.press('Enter');
  await expect(x).toHaveValue('360.00');
  await page.mouse.up();

  await page.mouse.move(box.x + 424, box.y + 268);
  await expect(canvas).toHaveCSS('cursor', 'se-resize');
  await page.mouse.down();
  await page.mouse.move(box.x + 440, box.y + 284, { steps: 5 });
  const width = page.getByRole('spinbutton', { name: 'Width', exact: true });
  await expect.poll(async () => Number(await width.inputValue())).toBeCloseTo(80, 0);
  await page.getByRole('button', { name: 'Play', exact: true }).press('Enter');
  await edit.press('Enter');
  await expect(width).toHaveValue('64.00');
  await expect(readout).toHaveCount(0);
  await page.mouse.up();

  await expect(platform).toHaveAccessibleDescription('Pending canvas changes');
  await page.getByRole('button', { name: 'Apply placement to code' }).click();
  await expect.poll(() => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getEditors()[0].getValue();
  })).toContain('new Vector2(360, 220)');
});

test('discards a selected object’s canvas changes without losing another object’s edits', async ({ page }) => {
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine, Rectangle, Vector2 } from 'dino-ge';
new Engine({ onLoad() {
  new Rectangle({ tag: 'Platform', position: new Vector2(420, 220), width: 64, height: 48 });
  new Rectangle({ tag: 'Wall', position: new Vector2(550, 220), width: 25, height: 100 });
}, update() {} }, { containerId: 'playground-canvas-container' });` }));
  await page.goto('/');
  const platform = page.getByRole('button', { name: 'Platform', exact: true });
  const wall = page.getByRole('button', { name: 'Wall', exact: true });
  await expect(platform).toBeVisible();
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await platform.click();
  const readSource = () => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getEditors()[0].getValue();
  });
  const original = await readSource();
  const x = page.getByRole('spinbutton', { name: 'X', exact: true });
  const y = page.getByRole('spinbutton', { name: 'Y', exact: true });
  const width = page.getByRole('spinbutton', { name: 'Width', exact: true });
  const height = page.getByRole('spinbutton', { name: 'Height', exact: true });
  const discard = page.getByRole('button', { name: 'Discard canvas changes', exact: true });
  const apply = page.getByRole('button', { name: 'Apply placement to code' });

  await platform.press('Shift+ArrowRight');
  await platform.press('Shift+ArrowRight');
  await expect(x).toHaveValue('440.00');
  await expect(discard).toBeVisible();
  const canvas = page.locator('#canvas');
  await canvas.evaluate((element: HTMLCanvasElement) => {
    element.style.width = `${element.width}px`;
    element.style.height = `${element.height}px`;
  });
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 504, box.y + 268);
  await expect(canvas).toHaveCSS('cursor', 'se-resize');
  await page.mouse.down();
  await page.mouse.move(box.x + 520, box.y + 284, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Number(await width.inputValue())).toBeCloseTo(80, 0);

  await wall.click();
  await expect(discard).toHaveCount(0);
  await wall.press('Shift+ArrowDown');
  await expect(y).toHaveValue('230.00');
  await platform.click();
  await expect(x).toHaveValue('440.00');
  await expect(page.getByRole('button', { name: 'Save X to code', exact: true })).toHaveCount(0);
  const inspector = page.getByTestId('inspector-panel');
  await inspector.locator('.panel-header').click();
  await expect(inspector).toBeHidden();
  await page.getByRole('button', { name: 'Review canvas changes' }).click();
  await expect(inspector).toBeVisible();
  await discard.click();
  await expect(page.getByRole('status').filter({ hasText: 'Discarded canvas changes' })).toBeVisible();
  await expect(x).toHaveValue('420.00');
  await expect(width).toHaveValue('64.00');
  await expect(height).toHaveValue('48.00');
  await expect(apply).toHaveCount(0);
  await expect.poll(readSource).toBe(original);

  await wall.click();
  await expect(y).toHaveValue('230.00');
  await apply.click();
  await expect.poll(readSource).toContain('new Vector2(550, 230)');
  await page.getByRole('button', { name: 'Undo code edit' }).click();
  await expect(y).toHaveValue('220.00');
  await expect.poll(readSource).toBe(original);
});

for (const computedPosition of [false, true]) {
  test(`applies multiple canvas changes ${computedPosition ? 'only when every object is editable' : 'as one undo step'}`, async ({ page }) => {
    await page.route('**/files', route => route.fulfill({ json: ['script'] }));
    await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine, Rectangle, Vector2 } from 'dino-ge';
const wallX = 500;
new Engine({ onLoad() {
  new Rectangle({ tag: 'Platform', position: new Vector2(300, 220), width: 64, height: 48 });
  new Rectangle({ tag: 'Wall', position: new Vector2(${computedPosition ? 'wallX' : '500'}, 220), width: 25, height: 100 });
}, update() {} }, { containerId: 'playground-canvas-container' });` }));
    await page.goto('/');
    const platform = page.getByRole('button', { name: 'Platform', exact: true });
    const wall = page.getByRole('button', { name: 'Wall', exact: true });
    await expect(platform).toBeVisible();
    await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
    await platform.click();
    await platform.press('Shift+ArrowRight');
    await wall.click();
    await wall.press('Shift+ArrowDown');
    await expect(wall).toHaveAccessibleDescription('Pending canvas changes');

    const readSource = () => page.evaluate(() => {
      const { monaco } = window as typeof window & { monaco: Monaco };
      return monaco.editor.getEditors()[0].getValue();
    });
    await expect(page.locator('.monaco-editor')).toContainText('new Rectangle');
    const original = await readSource();
    await page.getByRole('button', { name: 'Apply all canvas changes', exact: true }).click();
    if (computedPosition) {
      await expect(page.getByRole('status').filter({ hasText: 'Wall' })).toContainText('Use literal transform options');
      await expect(platform).toHaveAccessibleDescription('Pending canvas changes');
      await expect(wall).toHaveAccessibleDescription('Pending canvas changes');
      await expect.poll(readSource).toBe(original);
      return;
    }

    await expect(page.getByRole('status').filter({ hasText: 'Applied canvas changes for 2 objects' })).toBeVisible();
    await expect(platform).toHaveAccessibleDescription('');
    await expect(wall).toHaveAccessibleDescription('');
    const applied = await readSource();
    expect(applied).toContain('new Vector2(310, 220)');
    expect(applied).toContain('new Vector2(500, 230)');
    const x = page.getByRole('spinbutton', { name: 'X', exact: true });
    const y = page.getByRole('spinbutton', { name: 'Y', exact: true });
    await page.getByRole('button', { name: 'Undo code edit' }).click();
    await expect.poll(readSource).toBe(original);
    await expect(y).toHaveValue('220.00');
    await platform.click();
    await expect(x).toHaveValue('300.00');
    await page.getByRole('button', { name: 'Redo code edit' }).click();
    await expect.poll(readSource).toBe(applied);
    await expect(x).toHaveValue('310.00');
    await wall.click();
    await expect(y).toHaveValue('230.00');
  });
}

test('uses a saved canvas position as the Inspector undo baseline for an unselected object', async ({ page }) => {
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine, Rectangle, Vector2 } from 'dino-ge';
new Engine({ onLoad() {
  new Rectangle({ tag: 'Platform', position: new Vector2(300, 220), width: 64, height: 48 });
  new Rectangle({ tag: 'Wall', position: new Vector2(500, 220), width: 25, height: 100 });
} }, { containerId: 'playground-canvas-container' });` }));
  await page.goto('/');
  const platform = page.getByRole('button', { name: 'Platform', exact: true });
  const wall = page.getByRole('button', { name: 'Wall', exact: true });
  const x = page.getByRole('spinbutton', { name: 'X', exact: true });
  const readSource = () => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getEditors()[0].getValue();
  });

  await expect(platform).toBeVisible();
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await platform.click();
  await expect(x).toHaveValue('300.00');
  await x.fill('305');
  await platform.press('Shift+ArrowRight');
  await expect(x).toHaveValue('315.00');
  await wall.click();
  await wall.press('Shift+ArrowDown');
  await page.getByRole('button', { name: 'Apply all canvas changes', exact: true }).click();
  await expect.poll(readSource).toContain('new Vector2(315, 220)');

  await platform.click();
  await expect(x).toHaveValue('315.00');
  await x.fill('330');
  await page.getByRole('button', { name: 'Save X to code', exact: true }).click();
  await expect.poll(readSource).toContain('new Vector2(330, 220)');
  await page.getByRole('button', { name: 'Undo code edit', exact: true }).click();
  await expect.poll(readSource).toContain('new Vector2(315, 220)');
  await expect(x).toHaveValue('315.00');
});

test('shows pending canvas changes on objects and their collapsed branches', async ({ page }) => {
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine, Rectangle, Vector2 } from 'dino-ge';
new Engine({ onLoad() {
  const platform = new Rectangle({ tag: 'Platform', position: new Vector2(300, 220), width: 64, height: 48 });
  const rail = new Rectangle({ tag: 'Rail', position: new Vector2(8, -20), width: 50, height: 10 });
  platform.transform.addChild(rail.transform);
  new Rectangle({ tag: 'Wall', position: new Vector2(500, 220), width: 25, height: 100 });
}, update() {} }, { containerId: 'playground-canvas-container' });` }));
  await page.goto('/');
  const platform = page.getByRole('button', { name: 'Platform', exact: true });
  const rail = page.getByRole('button', { name: 'Rail', exact: true });
  const wall = page.getByRole('button', { name: 'Wall', exact: true });
  await expect(rail).toBeVisible();
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await rail.click();
  await rail.press('Shift+ArrowRight');
  await expect(rail).toHaveAccessibleDescription('Pending canvas changes');
  await expect(rail.getByTitle('Pending canvas changes')).toBeVisible();
  await wall.click();
  await wall.press('Shift+ArrowDown');
  await expect(wall).toHaveAccessibleDescription('Pending canvas changes');
  await expect(rail).toHaveAccessibleDescription('Pending canvas changes');

  await page.getByRole('button', { name: 'Collapse children of Platform', exact: true }).press('Enter');
  await expect(rail).toHaveCount(0);
  await expect(platform).toHaveAccessibleDescription('Pending canvas changes in collapsed children');
  await expect(wall).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Apply placement to code' }).click();
  await expect(wall).toHaveAccessibleDescription('');
  await expect(platform).toHaveAccessibleDescription('Pending canvas changes in collapsed children');

  await page.getByRole('button', { name: 'Expand children of Platform', exact: true }).press('Space');
  await expect(platform).toHaveAccessibleDescription('');
  await rail.click();
  await page.getByRole('button', { name: 'Discard canvas changes', exact: true }).click();
  await expect(rail).toHaveAccessibleDescription('');

  await rail.press('Shift+ArrowRight');
  await expect(rail).toHaveAccessibleDescription('Pending canvas changes');
  await page.getByRole('button', { name: 'Reset game', exact: true }).click();
  await page.getByRole('button', { name: 'Reset and discard', exact: true }).click();
  await expect(rail).toHaveAccessibleDescription('');
  await expect(wall).toHaveAccessibleDescription('');
});

test('saves the script during scene editing without clearing pending canvas changes', async ({ page }) => {
  const original = `import { Engine, Rectangle, Vector2 } from 'dino-ge';
new Engine({ onLoad() {
  new Rectangle({ tag: 'Platform', position: new Vector2(300, 220), width: 64, height: 48 });
}, update() {} }, { containerId: 'playground-canvas-container' });`;
  let savedSource = original;
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => {
    if (route.request().method() === 'PUT') {
      savedSource = route.request().postDataJSON().data;
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ json: savedSource });
  });
  await page.goto('/');
  const platform = page.getByRole('button', { name: 'Platform', exact: true });
  const edit = page.getByRole('button', { name: 'Edit scene', exact: true });
  const save = page.getByRole('button', { name: 'Save script', exact: true });
  const x = page.getByRole('spinbutton', { name: 'X', exact: true });
  const saveScript = async () => {
    const saved = page.waitForResponse(response => response.request().method() === 'PUT' &&
      response.url().endsWith('/api/scripts/script'));
    await save.click();
    await saved;
    await expect(save).not.toHaveClass(/\bsaving\b/);
  };
  await expect(platform).toBeVisible();
  await expect(page.locator('.monaco-editor')).toContainText('new Rectangle');
  const editorSource = await page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getEditors()[0].getValue();
  });
  await edit.click();
  await platform.click();
  await platform.press('Shift+ArrowRight');
  await expect(x).toHaveValue('310.00');
  await saveScript();
  await expect(edit).toHaveAttribute('aria-pressed', 'true');
  await expect(platform).toHaveAccessibleDescription('Pending canvas changes');
  await expect(x).toHaveValue('310.00');
  expect(savedSource.replace(/\r\n/g, '\n')).toBe(editorSource.replace(/\r\n/g, '\n'));

  await page.getByRole('button', { name: 'Apply placement to code' }).click();
  await saveScript();
  expect(savedSource).toContain('new Vector2(310, 220)');
  await expect(edit).toHaveAttribute('aria-pressed', 'true');
  await expect(platform).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Reset game', exact: true }).click();
  await expect(edit).toHaveAttribute('aria-pressed', 'false');
  await platform.click();
  await expect(x).toHaveValue('310.00');
});

test('keeps pending edits until a reset or script switch is confirmed', async ({ page }) => {
  const makeScript = (tag: string) => `import { Engine, Rectangle, Vector2 } from 'dino-ge';
new Engine({ onLoad() {
  new Rectangle({ tag: '${tag}', position: new Vector2(300, 220), width: 64, height: 48 });
}, update() {} }, { containerId: 'playground-canvas-container' });`;
  let writes = 0;
  await page.route('**/files', route => route.fulfill({ json: ['script', 'level-two'] }));
  await page.route('**/api/scripts/script', route => {
    if (route.request().method() === 'PUT') {
      writes++;
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ json: makeScript('Platform') });
  });
  await page.route('**/api/scripts/level-two', route => route.fulfill({ json: makeScript('Exit') }));
  await page.goto('/');
  const platform = page.getByRole('button', { name: 'Platform', exact: true });
  const edit = page.getByRole('button', { name: 'Edit scene', exact: true });
  const reset = page.getByRole('button', { name: 'Reset game', exact: true });
  const selector = page.getByRole('combobox', { name: 'Current script' });
  const x = page.getByRole('spinbutton', { name: 'X', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Discard pending canvas changes?' });
  const keepEditing = dialog.getByRole('button', { name: 'Keep editing', exact: true });
  await expect(platform).toBeVisible();
  await edit.click();
  await platform.click();
  await platform.press('Shift+ArrowRight');
  await expect(x).toHaveValue('310.00');

  await reset.press('Control+Enter');
  await expect(dialog).toBeVisible();
  await expect(keepEditing).toBeFocused();
  await keepEditing.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(reset).toBeFocused();
  await expect(x).toHaveValue('310.00');
  expect(writes).toBe(0);

  await selector.selectOption('level-two');
  await expect(dialog).toBeVisible();
  await keepEditing.click();
  await expect(selector).toHaveValue('script');
  await expect(platform).toHaveAccessibleDescription('Pending canvas changes');
  await expect(x).toHaveValue('310.00');

  await reset.click();
  await dialog.getByRole('button', { name: 'Reset and discard' }).click();
  await expect(edit).toHaveAttribute('aria-pressed', 'false');
  await expect(platform).toHaveAccessibleDescription('');
  expect(writes).toBe(1);
  await edit.click();
  await platform.click();
  await platform.press('ArrowRight');
  await expect(x).toHaveValue('301.00');
  await selector.selectOption('level-two');
  await dialog.getByRole('button', { name: 'Switch and discard' }).click();
  await expect(selector).toHaveValue('level-two');
  await expect(page.getByRole('button', { name: 'Exit', exact: true })).toBeVisible();
  await expect(platform).toHaveCount(0);
});

test('rotates a scene object by its handle and saves the angle', async ({ page }) => {
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine, Rectangle, Vector2 } from 'dino-ge';
new Engine({ onLoad() {
  new Rectangle({ tag: 'Rotating platform', position: new Vector2(370, 235), width: 80, height: 40 });
}, update() {} }, { containerId: 'playground-canvas-container' });` }));
  await page.goto('/');
  const object = page.getByRole('button', { name: 'Rotating platform', exact: true });
  await expect(object).toBeVisible();
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await object.click();
  const canvas = page.locator('#canvas');
  await canvas.evaluate((element: HTMLCanvasElement) => {
    element.style.width = `${element.width}px`;
    element.style.height = `${element.height}px`;
  });
  const box = (await canvas.boundingBox())!;
  const angle = page.getByRole('spinbutton', { name: 'Rotation (°)', exact: true });
  const readout = page.getByRole('group', { name: 'Current scene gesture' });
  const startRotation = async () => {
    await page.mouse.move(box.x + 410, box.y + 215);
    await expect(canvas).toHaveCSS('cursor', 'grab');
    await page.mouse.down();
  };
  await startRotation();
  await page.mouse.move(box.x + 390, box.y + 275, { steps: 5 });
  // Pointer moves can render intermediate angles, and the browser can round CSS pixels.
  await expect.poll(async () => {
    const match = (await readout.innerText()).match(/^Rotate · (\d+(?:\.\d+)?)°$/);
    const rotation = Number(match?.[1]);
    return await angle.inputValue() === rotation.toFixed(2) ? Math.abs(rotation - 90) : Infinity;
  }, { message: 'The rotation readout and Inspector agree near 90°' }).toBeLessThan(3);
  await page.keyboard.press('Escape');
  await expect(readout).toHaveCount(0);
  await page.mouse.up();
  await expect(angle).toHaveValue('0.00');

  await startRotation();
  await page.keyboard.down('Shift');
  await page.mouse.move(box.x + 393, box.y + 273, { steps: 5 });
  await expect(readout).toHaveText('Rotate · 90°');
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(readout).toHaveCount(0);
  const inspector = page.getByTestId('inspector-panel');
  await inspector.locator('.panel-header').click();
  await expect(inspector).toBeHidden();
  await page.getByTestId('inspector-expand-button').click();
  await expect(angle).toHaveValue('90.00');
  await page.getByRole('button', { name: 'Apply placement to code' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Applied to code' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getEditors()[0].getValue();
  })).toContain('rotation: 1.570796');
  await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('370.00');
  await page.getByRole('button', { name: 'Undo code edit' }).click();
  await expect(angle).toHaveValue('0.00');
});

test('keeps the canvas clear in Edit scene and restores the debug HUD for play', async ({ page }) => {
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine } from 'dino-ge';
new Engine({ update() {} }, { containerId: 'playground-canvas-container', backgroundColour: '#ffffff' });
` }));
  await page.goto('/');
  const canvas = page.locator('#canvas');
  const readHudPixel = () => canvas.evaluate((element: HTMLCanvasElement) =>
    element.getContext('2d')!.getImageData(element.width - 20, 12, 1, 1).data[0]);
  const debug = page.getByRole('button', { name: 'Toggle debug mode' });
  await expect.poll(readHudPixel).toBe(255);
  await debug.click();
  await expect.poll(readHudPixel).toBeLessThan(128);

  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await expect.poll(readHudPixel).toBe(255);
  await expect(debug).toHaveAttribute('aria-pressed', 'true');
  const box = (await canvas.boundingBox())!;
  await page.getByRole('button', { name: 'Add rectangle' }).dragTo(canvas, {
    // Stay under the HUD and outside the camera's edge-pan zone.
    targetPosition: { x: Math.round(box.width) - 110, y: 56 },
  });
  await expect(page.getByRole('button', { name: 'New rectangle', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('spinbutton', { name: 'Y', exact: true })).toHaveValue('56.00');
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) =>
    Array.from(element.getContext('2d')!.getImageData(element.width - 80, 72, 1, 1).data))).toEqual([84, 214, 173, 255]);

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await debug.click();
  await expect.poll(readHudPixel).toBeLessThan(128);
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

test('searches the scene hierarchy while retaining pending changes and branch expansion', async ({ page }) => {
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine, Group, Rectangle, Vector2 } from 'dino-ge';
new Engine({ onLoad() {
  const group = new Group('Platforms');
  const blue = new Rectangle({ tag: 'Blue platform', position: new Vector2(320, 220), width: 64, height: 32 });
  const red = new Rectangle({ tag: 'Red platform', position: new Vector2(440, 220), width: 64, height: 32 });
  group.transform.addChild(blue.transform);
  group.transform.addChild(red.transform);
  new Rectangle({ tag: 'Spawn marker', position: new Vector2(460, 300), width: 32, height: 32 });
}, update() {} }, { containerId: 'playground-canvas-container' });` }));
  await page.goto('/');
  const group = page.getByRole('button', { name: 'Platforms', exact: true });
  const blue = page.getByRole('button', { name: 'Blue platform', exact: true });
  const red = page.getByRole('button', { name: 'Red platform', exact: true });
  const search = page.getByRole('searchbox', { name: 'Search scene objects', exact: true });
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse children of Platforms', exact: true }).click();
  await expect(blue).toHaveCount(0);

  await search.fill('  BLUE  ');
  await expect(group).toBeVisible();
  await expect(blue).toBeVisible();
  await expect(red).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Spawn marker', exact: true })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: '1 match' })).toBeVisible();
  await search.press('Enter');
  await expect(blue).toHaveAttribute('aria-pressed', 'true');
  await blue.press('ArrowRight');
  await expect(blue).toHaveAccessibleDescription('Pending canvas changes');

  await search.fill('red');
  await expect(red).toBeVisible();
  await expect(blue).toHaveCount(0);
  await expect(group).toHaveAccessibleDescription('Pending canvas changes in filtered children');
  await expect(page.getByRole('textbox', { name: 'Tag', exact: true })).toHaveValue('Blue platform');
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(group).toHaveAccessibleDescription('Pending canvas changes in collapsed children');
  await expect(blue).toHaveCount(0);

  await search.fill('missing');
  await expect(page.getByRole('status').filter({ hasText: 'No matching objects' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear scene search', exact: true }).click();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
  await page.getByRole('button', { name: 'Expand children of Platforms', exact: true }).click();
  await expect(blue).toHaveAttribute('aria-pressed', 'true');
  await expect(blue).toHaveAccessibleDescription('Pending canvas changes');

  const reveal = page.getByRole('button', { name: 'Reveal in Explorer', exact: true });
  await search.fill('blue');
  await reveal.click({ timeout: 3000 });
  await expect(search).toHaveValue('blue');
  await expect(blue).toBeFocused();

  await search.press('Escape');
  await page.getByRole('button', { name: 'Collapse children of Platforms', exact: true }).click();
  await search.fill('red');
  await page.getByText('Explorer', { exact: true }).click();
  await expect(search).toBeHidden();
  await reveal.press('Enter');
  await expect(search).toHaveValue('');
  await expect(blue).toBeFocused();
  await expect(blue).toHaveAttribute('aria-pressed', 'true');
  await expect(blue).toHaveAccessibleDescription('Pending canvas changes');
  await expect(page.getByRole('button', { name: 'Collapse children of Platforms', exact: true })).toHaveAttribute('aria-expanded', 'true');
});

test('keeps Library labels readable in a narrow sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 800 });
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine } from 'dino-ge';
new Engine({ onLoad() {} }, { containerId: 'playground-canvas-container' });` }));
  await page.goto('/');
  for (const name of ['Library', 'Assets', 'Rectangle', 'Sprite animation']) {
    const label = page.locator('.sidebar').getByText(name, { exact: true });
    await expect(label).toBeVisible();
    expect(await label.evaluate(element => element.scrollWidth <= element.clientWidth), `${name} fits`).toBe(true);
  }
  const editor = page.locator('.monaco-editor');
  await expect(editor).toContainText('new Engine');
  const insert = page.getByRole('button', { name: 'Insert rectangle code' });
  await insert.click();
  await expect(editor).toContainText('new Rectangle');
});

test('runs Library shape snippets without pre-imported constructors and matches canvas drops', async ({ page }) => {
  let source = `
import { Engine } from 'dino-ge';
new Engine({ onLoad() { const Circle = 'Existing local name'; }, update() {} }, { containerId: 'playground-canvas-container' });`;
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => {
    if (route.request().method() === 'PUT') {
      source = route.request().postDataJSON().data;
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ json: source });
  });
  await page.goto('/');
  await expect(page.locator('.monaco-editor')).toContainText('new Engine');

  const shapes = [
    { kind: 'rectangle', fields: [['spinbutton', 'Width', '80.00'], ['spinbutton', 'Height', '48.00']] },
    { kind: 'circle', fields: [['spinbutton', 'Radius', '28.00']] },
    { kind: 'text', fields: [['textbox', 'Content', 'New text'], ['spinbutton', 'Width', '180.00']] },
    { kind: 'line', fields: [['spinbutton', 'End X', '96.00'], ['spinbutton', 'End Y', '0.00'], ['spinbutton', 'Stroke width', '4.00']] },
  ] as const;
  for (const { kind } of shapes) {
    await page.getByRole('button', { name: `Insert ${kind} code`, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Reset game', exact: true }).click();
  const explorer = page.getByRole('button', { name: 'New rectangle', exact: true });
  await expect(explorer).toBeVisible({ timeout: 3000 });
  expect(source).toContain('Circle as DinoCircle');
  expect(source).toContain('new DinoCircle(');
  expect(source.match(/from 'dino-ge'/g)).toHaveLength(1);
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();

  const canvas = page.locator('#canvas');
  for (const [index, { kind, fields }] of shapes.entries()) {
    await page.getByRole('button', { name: `New ${kind}`, exact: true }).click();
    for (const [role, name, value] of fields) {
      await expect(page.getByRole(role, { name, exact: true })).toHaveValue(value);
    }
    await page.getByRole('button', { name: `Add ${kind}`, exact: true }).dragTo(canvas, {
      targetPosition: { x: 250 + index * 100, y: 225 },
    });
    await expect(page.getByRole('button', { name: `New ${kind} 2`, exact: true })).toHaveAttribute('aria-pressed', 'true');
    for (const [role, name, value] of fields) {
      await expect(page.getByRole(role, { name, exact: true })).toHaveValue(value);
    }
  }
});

test('drops a game object into the editor using existing imports', async ({ page }) => {
  let source = String.raw`import { Engine, Rectangle, Vector2 } from 'dino-ge';
new Engine({ onLoad() {
  new Rectangle({ tag: 'New\u0020rectangle', position: new Vector2(220, 200), width: 80, height: 48 });
} }, { containerId: 'playground-canvas-container' });`;
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => {
    if (route.request().method() === 'PUT') {
      source = route.request().postDataJSON().data;
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ json: source });
  });
  await page.goto('/');
  const editor = page.locator('.monaco-editor');
  await expect(editor).toContainText('new Engine');
  await page.getByRole('button', { name: 'Add rectangle', exact: true }).dragTo(editor);
  await expect(editor).toContainText('New rectangle 2', { timeout: 3000 });
  await expect(page.getByRole('button', { name: 'New rectangle 2', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Reset game', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New rectangle', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New rectangle 2', exact: true })).toBeVisible();
  expect(source.match(/from 'dino-ge'/g)).toHaveLength(1);
  expect(source).not.toContain('DinoPlace');
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
  await expect(page.getByRole('button', { name: 'Library', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const box = (await canvas.boundingBox())!;
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.setData('application/x-dino-scene-object', 'Rectangle');
    data.setData('application/x-dino-scene-object-rectangle', '');
    return data;
  });
  await canvas.dispatchEvent('dragover', { dataTransfer: transfer, clientX: box.x + 180, clientY: box.y + 150 });
  const preview = page.locator('.scene-drop-preview');
  await expect(preview).toContainText('Rectangle · X 180 · Y 150');
  await expect(preview.locator('.scene-drop-outline')).toBeVisible();
  await canvas.dispatchEvent('dragleave', { dataTransfer: transfer });
  await expect(preview).toHaveCount(0);
  await page.getByRole('button', { name: 'Add rectangle' }).dragTo(canvas, {
    targetPosition: { x: 180, y: 150 },
  });
  const rectangle = page.getByRole('button', { name: 'New rectangle', exact: true });
  await expect(preview).toHaveCount(0);
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
  const width = page.getByRole('spinbutton', { name: 'Width', exact: true });
  const height = page.getByRole('spinbutton', { name: 'Height', exact: true });
  const readWidth = () => page.evaluate(() => (window as typeof window & {
    Engine: { selectedObject?: { bounds: { width: number } } };
  }).Engine.selectedObject?.bounds.width);
  await width.fill('96');
  await page.getByRole('button', { name: 'Save Width to code', exact: true }).click();
  await expect.poll(readCode).toContain('width: 96');
  await height.fill('60');
  await undo.click();
  await expect.poll(readCode).toContain('width: 80');
  await expect(width).toHaveValue('80.00');
  await expect.poll(readWidth).toBe(80);
  await expect(height).toHaveValue('60.00');
  await redo.click();
  await expect.poll(readCode).toContain('width: 96');
  await expect(width).toHaveValue('96.00');
  await expect.poll(readWidth).toBe(96);
  await expect(height).toHaveValue('60.00');
  await height.fill('48');
  const angle = page.getByRole('spinbutton', { name: 'Rotation (°)', exact: true });
  const readRotatedPixel = () => canvas.evaluate((element: HTMLCanvasElement) =>
    Array.from(element.getContext('2d')!.getImageData(145, 180, 1, 1).data));
  await expect.poll(readRotatedPixel).toEqual([255, 255, 255, 255]);
  await angle.fill('90');
  await expect.poll(readRotatedPixel).toEqual([84, 214, 173, 255]);
  await page.getByRole('button', { name: 'Save Rotation (°) to code', exact: true }).click();
  await expect.poll(readCode).toContain('rotation: 1.5707963267948966');
  await undo.click();
  await expect(angle).toHaveValue('0.00');
  await redo.click();
  await expect(angle).toHaveValue('90.00');
  await page.getByRole('button', { name: 'Duplicate object' }).click();
  const copy = page.getByRole('button', { name: 'New rectangle copy', exact: true });
  await expect(copy).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('204.00');
  await expect(page.getByRole('spinbutton', { name: 'Width', exact: true })).toHaveValue('96.00');
  await expect(angle).toHaveValue('90.00');
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
  await expect(angle).toHaveValue('90.00');
  await expect(circle).toHaveCount(0);
  await expect(copy).toBeVisible();
});

test('picks the visible shape at an overlapping point', async ({ page }) => {
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Circle, Engine, Rectangle, Vector2 } from 'dino-ge';
new Engine({ onLoad() {
  new Circle({ tag: 'top circle', position: new Vector2(160, 140), radius: 25 });
  new Rectangle({ tag: 'backing', position: new Vector2(160, 140), width: 50, height: 50 });
  new Rectangle({ tag: 'hidden cover', position: new Vector2(160, 140), width: 50, height: 50, visible: false, zIndex: 20 });
} }, { containerId: 'playground-canvas-container' });` }));
  await page.goto('/');
  const circle = page.getByRole('button', { name: 'top circle', exact: true });
  await expect(circle).toBeVisible();
  await page.getByRole('button', { name: 'Edit scene' }).click();
  const canvas = page.locator('#canvas');
  await canvas.click({ position: { x: 185, y: 165 } });
  await expect(circle).toHaveAttribute('aria-pressed', 'true');
  await canvas.click({ position: { x: 162, y: 142 } });
  await expect(page.getByRole('button', { name: 'backing', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'hidden cover', exact: true })).toBeVisible();

  await canvas.evaluate(element => {
    element.style.transformOrigin = 'top left';
    element.style.transform = 'scale(0.75)';
  });
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 185 * 0.75, box.y + 165 * 0.75);
  await page.mouse.down();
  await expect(circle).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(box.x + 205 * 0.75, box.y + 177 * 0.75);
  await page.mouse.up();
  await expect.poll(async () => Number(await page.getByRole('spinbutton', { name: 'X', exact: true }).inputValue())).toBeCloseTo(180, 0);
  await expect.poll(async () => Number(await page.getByRole('spinbutton', { name: 'Y', exact: true }).inputValue())).toBeCloseTo(152, 0);
});

test('cycles through visible overlapping objects and drags the object picked underneath', async ({ page }) => {
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Circle, Engine, Rectangle, Vector2 } from 'dino-ge';
new Engine({ onLoad() {
  new Rectangle({ tag: 'Floor', position: new Vector2(320, 224), width: 64, height: 64 });
  new Rectangle({ tag: 'Middle panel', position: new Vector2(320, 224), width: 64, height: 64, zIndex: 1 });
  new Circle({ tag: 'Front panel', position: new Vector2(320, 224), radius: 32, zIndex: 2 });
  new Rectangle({ tag: 'Hidden panel', position: new Vector2(320, 224), width: 64, height: 64, zIndex: 3, visible: false });
} }, { containerId: 'playground-canvas-container' });` }));
  await page.goto('/');
  const front = page.getByRole('button', { name: 'Front panel', exact: true });
  const floor = page.getByRole('button', { name: 'Floor', exact: true });
  await expect(front).toBeVisible();
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await page.getByRole('button', { name: 'Snap to grid', exact: true }).click();
  const canvas = page.locator('#canvas');
  const centre = { x: 352, y: 256 };
  await canvas.click({ position: centre });
  await expect(front).toHaveAttribute('aria-pressed', 'true');
  for (const name of ['Middle panel', 'Floor', 'Front panel', 'Middle panel', 'Floor']) {
    await canvas.click({ position: centre, modifiers: ['Alt'] });
    const selected = page.getByRole('button', { name, exact: true });
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    await expect(selected).toHaveAccessibleDescription('');
  }

  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + centre.x, box.y + centre.y);
  await page.mouse.down();
  await page.mouse.move(box.x + centre.x + 32, box.y + centre.y, { steps: 4 });
  await expect(page.getByRole('group', { name: 'Current scene gesture' })).toHaveText('Move · X 352 · Y 224');
  await page.mouse.up();
  await expect(floor).toHaveAccessibleDescription('Pending canvas changes');
  await expect(front).toHaveAccessibleDescription('');
  await page.getByRole('button', { name: 'Apply placement to code' }).click();
  await expect.poll(() => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getEditors()[0].getValue();
  })).toMatch(/tag: 'Floor',\s*position: new Vector2\(352, 224\)/);

  await canvas.click({ position: { x: 550, y: 260 } });
  await canvas.click({ position: { x: 360, y: 256 } });
  await expect(front).toHaveAttribute('aria-pressed', 'true');
});

test('keeps the selected object handles visible above foreground objects during scene editing', async ({ page }) => {
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine, Rectangle, Vector2 } from 'dino-ge';
new Engine({ onLoad() {
  new Rectangle({ tag: 'Back plate', position: new Vector2(350, 235), width: 40, height: 30, colour: '#43aa8b' });
  new Rectangle({ tag: 'Front plate', position: new Vector2(320, 205), width: 100, height: 90, colour: '#3c537d', zIndex: 1 });
}, update() {} }, { containerId: 'playground-canvas-container' });` }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  const canvas = page.locator('#canvas');
  const pixel = (x: number, y: number) => canvas.evaluate((element: HTMLCanvasElement, [x, y]) =>
    Array.from(element.getContext('2d')!.getImageData(x, y, 1, 1).data), [x, y]);
  const foreground = [60, 83, 125, 255];
  await expect.poll(() => pixel(390, 265)).toEqual(foreground);
  const position = { x: 370, y: 245 };
  await canvas.click({ position });
  await canvas.click({ position, modifiers: ['Alt'] });
  await expect(page.getByRole('button', { name: 'Back plate', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => pixel(390, 265)).toEqual([255, 209, 102, 255]);
  await expect.poll(() => pixel(370, 215)).toEqual([101, 217, 178, 255]);
  await expect.poll(() => pixel(370, 245)).toEqual(foreground);

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => pixel(390, 265)).toEqual(foreground);
});

test('navigates the editing camera, places in world coordinates and restores the gameplay view', async ({ page }) => {
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine } from 'dino-ge';
new Engine({ onLoad() {
  Engine.camera.position.set(40, 30);
  window.readCamera = () => ({ x: Engine.camera.position.x, y: Engine.camera.position.y, zoom: Engine.camera.zoom });
} }, { containerId: 'playground-canvas-container' });` }));
  await page.goto('/');
  const readCamera = () => page.evaluate(() => (window as Window & {
    readCamera?: () => { x: number; y: number; zoom: number };
  }).readCamera?.());
  await expect.poll(readCamera).toEqual({ x: 40, y: 30, zoom: 1 });
  await page.getByRole('button', { name: 'Edit scene' }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(readCamera).toMatchObject({ zoom: 1.25 });
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await expect.poll(readCamera).toEqual({ x: 40, y: 30, zoom: 1 });

  const canvas = page.locator('#canvas');
  const box = (await canvas.boundingBox())!;
  await page.getByRole('region', { name: 'Scene viewport' }).focus();
  await page.keyboard.down('Space');
  await page.mouse.move(box.x + 210, box.y + 180);
  await expect(canvas).toHaveCSS('cursor', 'grab');
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 210, { steps: 5 });
  await expect.poll(readCamera).toMatchObject({ x: expect.closeTo(-10, 0), y: expect.closeTo(0, 0), zoom: 1 });
  await page.keyboard.up('Space');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect.poll(readCamera).toEqual({ x: 40, y: 30, zoom: 1 });

  await page.mouse.move(box.x + 210, box.y + 180);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(box.x + 260, box.y + 210, { steps: 5 });
  await page.mouse.up({ button: 'middle' });
  await page.getByRole('button', { name: 'Add rectangle' }).dragTo(canvas, { targetPosition: { x: 180, y: 150 } });
  await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('170.00');
  await expect(page.getByRole('spinbutton', { name: 'Y', exact: true })).toHaveValue('150.00');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(readCamera).toEqual({ x: 40, y: 30, zoom: 1 });
});

test('pans at the edge while dragging and restores the camera and object on cancellation', async ({ page }) => {
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine, Rectangle, Vector2 } from 'dino-ge';
new Engine({ onLoad() {
  Engine.camera.position.set(40, 30);
  new Rectangle({ tag: 'Platform', position: new Vector2(350, 250), width: 64, height: 48 });
}, update() {} }, { containerId: 'playground-canvas-container' });` }));
  await page.goto('/');
  const platform = page.getByRole('button', { name: 'Platform', exact: true });
  await expect(platform).toBeVisible();
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const canvas = page.locator('#canvas');
  const box = (await canvas.boundingBox())!;
  const view = () => canvas.evaluate((element: HTMLCanvasElement) => {
    const { Engine } = window as unknown as {
      Engine: {
        camera: { position: { x: number; y: number }; zoom: number };
        objects: Iterable<{ transform: { position: { x: number } } }>;
      };
    };
    const { position, zoom } = Engine.camera;
    return { x: position.x, y: position.y, zoom, width: element.width, height: element.height,
      objectX: Array.from(Engine.objects)[0].transform.position.x };
  });
  const baseline = await view();
  const origin = { x: box.x + (370 - baseline.x) * baseline.zoom * box.width / baseline.width,
    y: box.y + (270 - baseline.y) * baseline.zoom * box.height / baseline.height };
  const edgeX = box.x + box.width - 8;
  const readout = page.getByRole('group', { name: 'Current scene gesture' });
  const x = page.getByRole('spinbutton', { name: 'X', exact: true });
  const dragToEdge = async () => {
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.move(edgeX, origin.y, { steps: 6 });
    await expect(readout).toContainText('Move');
    await expect.poll(async () => (await view()).x).toBeGreaterThan(baseline.x + 20);
  };

  await dragToEdge();
  const panned = await view();
  const worldX = panned.x + (edgeX - box.x) * panned.width / box.width / panned.zoom;
  expect(panned.objectX).toBeCloseTo(worldX - 20, 0);
  await page.mouse.move(box.x + box.width / 2, origin.y);
  const inside = await view();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await view()).toEqual(inside);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect.poll(view).toEqual(baseline);
  await expect(x).toHaveValue('350.00');
  await expect(platform).toHaveAccessibleDescription('');

  await page.getByRole('button', { name: 'Snap to grid', exact: true }).click();
  await dragToEdge();
  await page.mouse.up();
  await expect(platform).toHaveAccessibleDescription('Pending canvas changes');
  const placedX = (await view()).objectX;
  expect(placedX % 16).toBe(0);
  expect((await view()).x).toBeGreaterThan(baseline.x + 20);
  await page.getByRole('button', { name: 'Apply placement to code' }).click();
  await expect.poll(() => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getEditors()[0].getValue();
  })).toContain(`new Vector2(${placedX}, 256)`);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(view).toMatchObject({ x: 40, y: 30, zoom: 1 });
});

test('pans the camera for a Library drop and keeps the snapped preview in sync', async ({ page }) => {
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine } from 'dino-ge';
new Engine({ onLoad() { Engine.camera.position.set(40, 32); }, update() {} },
  { containerId: 'playground-canvas-container' });` }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await page.getByRole('button', { name: 'Snap to grid', exact: true }).click();
  const canvas = page.locator('#canvas');
  const add = page.getByRole('button', { name: 'Add rectangle', exact: true });
  const preview = page.locator('.scene-drop-preview');
  const placed = page.getByRole('button', { name: 'New rectangle', exact: true });
  const box = (await canvas.boundingBox())!;
  const cameraX = () => page.evaluate(() => {
    const { Engine } = window as unknown as { Engine: { camera: { position: { x: number } } } };
    return Engine.camera.position.x;
  });
  const dragToEdge = async () => {
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await add.dispatchEvent('dragstart', { dataTransfer });
    await canvas.dispatchEvent('dragover', { dataTransfer, clientX: box.x + box.width - 8, clientY: box.y + 224 });
    await expect(preview).toContainText('Rectangle');
    await expect.poll(cameraX).toBeGreaterThan(72);
    await expect.poll(async () => Number((await preview.innerText()).match(/X (\d+)/)?.[1]))
      .toBeGreaterThan(40 + box.width);
    return dataTransfer;
  };
  const cancelled = await dragToEdge();
  await add.dispatchEvent('dragend', { dataTransfer: cancelled });
  await expect(preview).toHaveCount(0);
  await expect(placed).toHaveCount(0);
  await expect.poll(cameraX).toBe(40);

  const dataTransfer = await dragToEdge();
  const inside = { dataTransfer, clientX: box.x + box.width / 2, clientY: box.y + 224 };
  await canvas.dispatchEvent('dragover', inside);
  const guide = preview.locator('.scene-drop-guide');
  await expect.poll(async () => {
    const bounds = await guide.boundingBox();
    return bounds ? Math.abs(bounds.x + bounds.width / 2 - inside.clientX) : Infinity;
  }).toBeLessThan(10);
  const previewX = Number((await preview.innerText()).match(/X (\d+)/)?.[1]);
  expect(previewX % 16).toBe(0);
  const pannedX = await cameraX();
  await canvas.dispatchEvent('drop', inside);
  await expect(preview).toHaveCount(0);
  await expect(placed).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue(`${previewX}.00`);
  await expect(page.getByRole('spinbutton', { name: 'Y', exact: true })).toHaveValue('256.00');
  expect(await cameraX()).toBe(pannedX);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(cameraX).toBe(40);
});

test('zooms at the pointer and preserves world coordinates for placement', async ({ page }) => {
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine } from 'dino-ge';
new Engine({ onLoad() {
  Engine.camera.position.set(40, 32);
  document.getElementById('canvas').addEventListener('wheel', () => {
    document.body.dataset.gameWheel = 'received';
  });
}, update() {} }, { containerId: 'playground-canvas-container' });` }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await page.getByRole('button', { name: 'Snap to grid', exact: true }).click();
  const canvas = page.locator('#canvas');
  await canvas.evaluate(element => {
    element.style.transformOrigin = 'top left';
    element.style.transform = 'scale(0.75)';
  });
  const box = (await canvas.boundingBox())!;
  const target = { x: 280 * 0.75, y: 192 * 0.75 };
  const viewAtPointer = () => canvas.evaluate((element: HTMLCanvasElement, target) => {
    const { Engine } = window as unknown as {
      Engine: { camera: { position: { x: number; y: number }; zoom: number } };
    };
    const { position, zoom } = Engine.camera;
    const bounds = element.getBoundingClientRect();
    return { x: position.x + target.x * element.width / bounds.width / zoom,
      y: position.y + target.y * element.height / bounds.height / zoom, zoom };
  }, target);
  await page.mouse.move(box.x + target.x, box.y + target.y);
  await page.mouse.wheel(0, -320);
  await expect.poll(async () => (await viewAtPointer()).zoom).toBeGreaterThan(1);
  const zoomed = await viewAtPointer();
  expect(zoomed.x).toBeCloseTo(320, 0);
  expect(zoomed.y).toBeCloseTo(224, 0);
  await expect(page.locator('body')).not.toHaveAttribute('data-game-wheel', 'received');
  await expect(page.getByRole('region', { name: 'Scene viewport' }))
    .toHaveAccessibleDescription(new RegExp(`Zoom ${Math.round(zoomed.zoom * 100)}%`));

  await page.getByRole('button', { name: 'Add rectangle', exact: true }).dragTo(canvas, { targetPosition: target });
  await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('320.00');
  await expect(page.getByRole('spinbutton', { name: 'Y', exact: true })).toHaveValue('224.00');
  await page.mouse.move(box.x + target.x + 12, box.y + target.y + 12);
  await page.mouse.down();
  await canvas.dispatchEvent('wheel', { deltaY: -200, clientX: box.x + target.x + 12,
    clientY: box.y + target.y + 12, bubbles: true, cancelable: true });
  await page.mouse.up();
  expect((await viewAtPointer()).zoom).toBe(zoomed.zoom);

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(viewAtPointer).toMatchObject({ x: expect.closeTo(320, 0), y: expect.closeTo(224, 0), zoom: 1 });
  await page.mouse.move(box.x + target.x, box.y + target.y);
  await page.mouse.wheel(0, -200);
  await expect(page.locator('body')).toHaveAttribute('data-game-wheel', 'received');
  expect((await viewAtPointer()).zoom).toBe(1);
});

test('frames offscreen objects and groups without moving them or changing the gameplay camera', async ({ page }) => {
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine, Group, Line, Rectangle, Vector2 } from 'dino-ge';
new Engine({ onLoad() {
  Engine.camera.position.set(40, 30);
  const group = new Group('Remote platforms');
  group.transform.position.set(1200, 700);
  group.transform.rotation = Math.PI / 2;
  group.transform.scale.set(2, 1);
  const first = new Rectangle({ tag: 'Tall platform', position: new Vector2(20, 0), width: 120, height: 40 });
  const second = new Line({ tag: 'Rail', p1: new Vector2(20, -120), p2: new Vector2(80, -120), width: 8 });
  group.transform.addChild(first.transform);
  group.transform.addChild(second.transform);
}, update() {} }, { containerId: 'playground-canvas-container' });` }));
  await page.goto('/');
  const group = page.getByRole('button', { name: 'Remote platforms', exact: true });
  await expect(group).toBeVisible();
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  const frame = page.getByRole('button', { name: 'Frame selection', exact: true });
  await expect(frame).toBeDisabled();
  const canvas = page.locator('#canvas');
  const readView = () => canvas.evaluate((element: HTMLCanvasElement) => {
    const { Engine } = window as unknown as {
      Engine: { camera: { position: { x: number; y: number }; zoom: number } };
    };
    const { position, zoom } = Engine.camera;
    return { x: position.x, y: position.y, zoom, width: element.width, height: element.height };
  });
  const assertFramed = async (left: number, top: number, right: number, bottom: number) => {
    const { x, y, zoom, width, height } = await readView();
    expect((left - x) * zoom).toBeGreaterThanOrEqual(24);
    expect((right - x) * zoom).toBeLessThanOrEqual(width - 24);
    expect((top - y) * zoom).toBeGreaterThanOrEqual(24);
    expect((bottom - y) * zoom).toBeLessThanOrEqual(height - 24);
  };

  await group.click();
  await frame.click();
  await assertFramed(1160, 732, 1328, 980);
  await expect(group).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  expect(await readView()).toMatchObject({ x: 40, y: 30, zoom: 1 });
  await page.getByRole('region', { name: 'Scene viewport' }).press('f');
  await assertFramed(1160, 732, 1328, 980);
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();

  const platform = page.getByRole('button', { name: 'Tall platform', exact: true });
  await platform.press('f');
  await expect(platform).toHaveAttribute('aria-pressed', 'true');
  await expect(platform).toBeFocused();
  await assertFramed(1160, 740, 1200, 980);
  await expect(platform).toHaveAccessibleDescription('');
  await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('20.00');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  expect(await readView()).toMatchObject({ x: 40, y: 30, zoom: 1 });
});

test('uses the selected world grid for Library drops and pointer and keyboard moves', async ({ page }) => {
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine } from 'dino-ge';
new Engine({ onLoad() { Engine.camera.position.set(3, 5); }, update() {} },
  { containerId: 'playground-canvas-container', backgroundColour: '#ffffff' });` }));
  await page.goto('/');
  const canvas = page.locator('#canvas');
  await expect(canvas).toBeVisible();
  await expect(page.locator('.monaco-editor')).toContainText('new Engine');
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const snap = page.getByRole('button', { name: 'Snap to grid', exact: true });
  await expect(snap).toHaveAttribute('aria-pressed', 'false');
  const cellSize = page.getByRole('combobox', { name: 'Grid cell size' });
  await expect(cellSize).toHaveValue('16');
  await cellSize.selectOption('32');
  await snap.click();
  await expect(snap).toHaveAttribute('aria-pressed', 'true');

  const box = (await canvas.boundingBox())!;
  const view = await canvas.evaluate((element: HTMLCanvasElement) => {
    const { Engine } = window as unknown as {
      Engine: { camera: { position: { x: number; y: number }; zoom: number } };
    };
    const { position, zoom } = Engine.camera;
    return { x: position.x, y: position.y, zoom, width: element.width, height: element.height };
  });
  const project = (x: number, y: number) => ({
    x: (x - view.x) * view.zoom * box.width / view.width,
    y: (y - view.y) * view.zoom * box.height / view.height,
  });
  const readGridPixel = () => canvas.evaluate((element: HTMLCanvasElement, column) =>
    element.getContext('2d')!.getImageData(column, 12, 1, 1).data[0], Math.floor((192 - view.x) * view.zoom));
  await expect.poll(readGridPixel).toBeLessThan(245);
  const target = project(317, 211);
  const add = page.getByRole('button', { name: 'Add rectangle', exact: true });
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await add.dispatchEvent('dragstart', { dataTransfer: transfer });
  await canvas.dispatchEvent('dragover', { dataTransfer: transfer, clientX: box.x + target.x, clientY: box.y + target.y });
  await expect(page.locator('.scene-drop-preview')).toContainText('Rectangle · X 320 · Y 224');
  await add.dragTo(canvas, { targetPosition: target });
  const x = page.getByRole('spinbutton', { name: 'X', exact: true });
  const y = page.getByRole('spinbutton', { name: 'Y', exact: true });
  await expect(x).toHaveValue('320.00');
  await expect(y).toHaveValue('224.00');
  const from = project(330, 234);
  const to = project(359, 255);
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 5 });
  await expect(page.getByRole('group', { name: 'Current scene gesture' })).toHaveText('Move · X 352 · Y 256');
  await page.mouse.up();
  await expect(x).toHaveValue('352.00');
  await expect(y).toHaveValue('256.00');
  const viewport = page.getByRole('region', { name: 'Scene viewport' });
  const object = page.getByRole('button', { name: 'New rectangle', exact: true });
  await viewport.press('ArrowUp');
  await expect(y).toHaveValue('224.00');
  await object.press('ArrowRight');
  await expect(x).toHaveValue('384.00');
  await cellSize.selectOption('8');
  await viewport.press('Shift+ArrowLeft');
  await expect(x).toHaveValue('304.00');
  await cellSize.selectOption('64');
  await object.press('ArrowDown');
  await expect(y).toHaveValue('256.00');
  await expect(x).toHaveValue('304.00');
  await viewport.press('ArrowRight');
  await expect(x).toHaveValue('320.00');
  await page.getByRole('button', { name: 'Apply placement to code' }).click();
  await expect.poll(() => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getEditors()[0].getValue();
  })).toMatch(/position: new \w+\(320, 256\)/);
  await snap.click();
  await expect.poll(readGridPixel).toBe(255);
  await viewport.press('ArrowLeft');
  await expect(x).toHaveValue('319.00');
});

test('snaps a dragged object to visible edges and centres and draws alignment guides', async ({ page }) => {
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine, Rectangle, Vector2 } from 'dino-ge';
new Engine({ onLoad() {
  new Rectangle({ tag: 'Platform', position: new Vector2(330, 265), width: 50, height: 32 });
  new Rectangle({ tag: 'Anchor', position: new Vector2(520, 235), width: 80, height: 48 });
  new Rectangle({ tag: 'Hidden', position: new Vector2(518, 234), width: 80, height: 48, visible: false });
}, update() {} }, { containerId: 'playground-canvas-container' });` }));
  await page.goto('/');
  const platform = page.getByRole('button', { name: 'Platform', exact: true });
  await expect(platform).toBeVisible();
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  const align = page.getByRole('button', { name: 'Align to objects', exact: true });
  const grid = page.getByRole('button', { name: 'Snap to grid', exact: true });
  await grid.click();
  await align.click();
  await expect(align).toHaveAttribute('aria-pressed', 'true');
  await expect(grid).toHaveAttribute('aria-pressed', 'false');

  const canvas = page.locator('#canvas');
  const box = (await canvas.boundingBox())!;
  const pixel = (x: number, y: number) => canvas.evaluate((element: HTMLCanvasElement, [x, y]) =>
    Array.from(element.getContext('2d')!.getImageData(x, y, 1, 1).data), [x, y]);
  const x = page.getByRole('spinbutton', { name: 'X', exact: true });
  const y = page.getByRole('spinbutton', { name: 'Y', exact: true });
  const drag = async () => {
    await page.mouse.move(box.x + 345, box.y + 280);
    await page.mouse.down();
    await page.mouse.move(box.x + 481, box.y + 256, { steps: 6 });
    await expect(x).toHaveValue('470.00');
    await expect(y).toHaveValue('243.00');
  };
  await drag();
  await expect.poll(() => pixel(520, 202)).toEqual([22, 117, 94, 255]);
  await expect.poll(() => pixel(98, 259)).toEqual([22, 117, 94, 255]);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(x).toHaveValue('330.00');
  await expect(platform).toHaveAccessibleDescription('');
  await expect.poll(() => pixel(520, 202)).toEqual([255, 255, 255, 255]);

  await drag();
  await page.mouse.up();
  await expect.poll(() => pixel(520, 202)).toEqual([255, 255, 255, 255]);
  await page.getByRole('button', { name: 'Apply placement to code', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getEditors()[0].getValue();
  })).toContain('new Vector2(470, 243)');
});

for (const item of [
  { name: 'Add rectangle', preview: 'Rectangle', placed: 'New rectangle', from: [436, 231], to: [440, 235] },
  { name: 'Add gem as sprite', preview: 'gem', placed: 'gem sprite', from: [469, 241], to: [472, 243] },
]) {
  test(`aligns ${item.placed} during a drop and writes the previewed position to code`, async ({ page }) => {
    await page.route('**/files', route => route.fulfill({ json: ['script'] }));
    await page.route('**/gem.svg', route => route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="32"><rect width="48" height="32" fill="orange"/></svg>',
    }));
    await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine, Loader, Rectangle, Vector2 } from 'dino-ge';
new Engine({ async onLoad() {
  Loader.queueImage('gem', '/gem.svg');
  await Loader.loadAll();
  new Rectangle({ tag: 'Anchor', position: new Vector2(520, 235), width: 80, height: 48 });
  new Rectangle({ tag: 'Hidden', position: new Vector2(518, 234), width: 80, height: 48, visible: false });
  new Rectangle({ tag: 'Offscreen', position: new Vector2(516, 4000), width: 80, height: 48 });
  Engine.camera.position.set(32, 24);
  Engine.camera.zoom = 1.25;
}, update() {} }, { containerId: 'playground-canvas-container' });` }));
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Anchor', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
    await page.getByRole('button', { name: 'Align to objects', exact: true }).click();
    if (item.preview === 'gem') await page.getByRole('button', { name: 'Assets', exact: true }).click();

    const canvas = page.locator('#canvas');
    const box = (await canvas.boundingBox())!;
    const size = await canvas.evaluate((element: HTMLCanvasElement) => ({ width: element.width, height: element.height }));
    const x = (world: number) => (world - 32) * 1.25 * box.width / size.width;
    const y = (world: number) => (world - 24) * 1.25 * box.height / size.height;
    const target = { x: x(item.from[0]), y: y(item.from[1]) };
    const source = page.getByRole('button', { name: item.name, exact: true });
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    await source.dispatchEvent('dragstart', { dataTransfer: transfer });
    await canvas.dispatchEvent('dragover', { dataTransfer: transfer, clientX: box.x + target.x, clientY: box.y + target.y });
    const preview = page.locator('.scene-drop-preview');
    await expect(preview).toContainText(`${item.preview} · X ${item.to[0]} · Y ${item.to[1]}`, { timeout: 3000 });
    const vertical = await preview.locator('.scene-drop-alignment-x').boundingBox();
    const horizontal = await preview.locator('.scene-drop-alignment-y').boundingBox();
    expect(vertical?.x).toBeCloseTo(box.x + x(520), 0);
    expect(horizontal?.y).toBeCloseTo(box.y + y(item.preview === 'gem' ? 259 : 235), 0);
    await canvas.dispatchEvent('dragleave', { dataTransfer: transfer });
    await expect(preview).toHaveCount(0);
    await expect(page.getByRole('button', { name: item.placed, exact: true })).toHaveCount(0);

    await source.dragTo(canvas, { targetPosition: target });
    await expect(page.getByRole('button', { name: item.placed, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue(`${item.to[0]}.00`);
    await expect(page.getByRole('spinbutton', { name: 'Y', exact: true })).toHaveValue(`${item.to[1]}.00`);
    await expect(preview).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => {
      const { monaco } = window as typeof window & { monaco: Monaco };
      return monaco.editor.getEditors()[0].getValue();
    })).toContain(`new Vector2(${item.to[0]}, ${item.to[1]})`);
  });
}

test('snaps rotated resize corners and circle diameters with live feedback', async ({ page }) => {
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine, Rectangle, Circle, Vector2 } from 'dino-ge';
new Engine({ onLoad() {
  Engine.camera.position.set(13, 17);
  new Rectangle({ tag: 'Ramp', position: new Vector2(320, 192), width: 64, height: 32, rotation: Math.PI / 4 });
  new Circle({ tag: 'Orb', position: new Vector2(480, 208), radius: 24 });
}, update() {} }, { containerId: 'playground-canvas-container' });` }));
  await page.goto('/');
  const canvas = page.locator('#canvas');
  await expect(canvas).toBeVisible();
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Snap to grid', exact: true }).click();
  const box = (await canvas.boundingBox())!;
  const view = await canvas.evaluate((element: HTMLCanvasElement) => {
    const { Engine } = window as unknown as {
      Engine: { camera: { position: { x: number; y: number }; zoom: number } };
    };
    const { position, zoom } = Engine.camera;
    return { x: position.x, y: position.y, zoom, width: element.width, height: element.height };
  });
  const move = (x: number, y: number, steps = 1) => page.mouse.move(
    box.x + (x - view.x) * view.zoom * box.width / view.width,
    box.y + (y - view.y) * view.zoom * box.height / view.height,
    { steps },
  );
  const readout = page.getByRole('group', { name: 'Current scene gesture' });
  const width = page.getByRole('spinbutton', { name: 'Width', exact: true });
  const apply = page.getByRole('button', { name: 'Apply placement to code' });
  const source = () => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getEditors()[0].getValue();
  });
  await page.getByRole('button', { name: 'Ramp', exact: true }).click();
  const dragRampCorner = async () => {
    await move(342.63, 259.88);
    await expect(canvas).toHaveCSS('cursor', 'se-resize');
    await page.mouse.down();
    await move(365, 277, 5);
    // The adjusted corner snaps to (368, 272), then projects onto the ramp's axes.
    await expect(readout).toHaveText('Resize · W 90.51 · H 22.63');
  };
  await dragRampCorner();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(width).toHaveValue('64.00');
  await expect(apply).toHaveCount(0);
  await dragRampCorner();
  await page.mouse.up();
  await apply.click();
  await expect.poll(source).toContain('width: 90.509668');
  await expect.poll(source).toContain('height: 22.627417');

  await page.getByRole('button', { name: 'Orb', exact: true }).click();
  await move(528, 256);
  await expect(canvas).toHaveCSS('cursor', 'se-resize');
  await page.mouse.down();
  await move(538, 260, 5);
  await expect(readout).toHaveText('Resize · W 64 · H 64');
  await page.mouse.up();
  await apply.click();
  await expect.poll(source).toContain('radius: 32');
  await page.getByRole('button', { name: 'Undo code edit' }).click();
  await expect.poll(source).toContain('radius: 24');
});

test('resizes a rotated sprite proportionally and switches modes without pointer movement', async ({ page }) => {
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine, Loader, Sprite, Vector2 } from 'dino-ge';
new Engine({ async onLoad() {
  Loader.queueImage('banner', '/banner.svg');
  await Loader.loadAll();
  new Sprite({ tag: 'Banner', img: 'banner', rows: 1, cols: 1,
    position: new Vector2(448, 192), scale: new Vector2(1.2, 0.8), rotation: Math.PI / 2 }).play();
}, update() {} }, { containerId: 'playground-canvas-container' });` }));
  await page.route('**/banner.svg', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="orange"/></svg>',
  }));
  await page.goto('/');
  const banner = page.getByRole('button', { name: 'Banner', exact: true });
  await expect(banner).toBeVisible();
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await page.getByRole('button', { name: 'Snap to grid' }).click();
  await banner.click();
  const canvas = page.locator('#canvas');
  const box = (await canvas.boundingBox())!;
  const size = await canvas.evaluate((element: HTMLCanvasElement) => ({ width: element.width, height: element.height }));
  const move = (x: number, y: number) => page.mouse.move(
    box.x + x * box.width / size.width, box.y + y * box.height / size.height,
  );
  const readout = page.getByRole('group', { name: 'Current scene gesture' });
  const scaleX = page.getByRole('spinbutton', { name: 'Scale X', exact: true });
  const scaleY = page.getByRole('spinbutton', { name: 'Scale Y', exact: true });
  const drag = async () => {
    await move(416, 288);
    await expect(canvas).toHaveCSS('cursor', 'se-resize');
    await page.mouse.down();
    await move(402, 345);
    await expect(readout).toHaveText('Resize · Scale X 2 · Y 1.2');
  };
  await drag();
  await page.keyboard.down('Shift');
  await expect(readout).toHaveText('Resize proportionally · Scale X 1.9 · Y 1.26');
  await page.keyboard.up('Shift');
  await expect(readout).toHaveText('Resize · Scale X 2 · Y 1.2');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(scaleX).toHaveValue('1.20');
  await expect(scaleY).toHaveValue('0.80');

  await drag();
  await page.keyboard.down('Shift');
  await expect(readout).toHaveText('Resize proportionally · Scale X 1.9 · Y 1.26');
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.getByRole('button', { name: 'Apply placement to code' }).click();
  await expect.poll(() => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getEditors()[0].getValue();
  })).toContain('scale: new Vector2(1.897367, 1.264911)');
  await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('448.00');
  await expect(page.getByRole('spinbutton', { name: 'Y', exact: true })).toHaveValue('192.00');
  await page.getByRole('button', { name: 'Undo code edit' }).click();
  await expect(scaleX).toHaveValue('1.20');
  await expect(scaleY).toHaveValue('0.80');
});

test('keeps the original Inspector value for undo after switching selection', async ({ page }) => {
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine, Rectangle, Vector2 } from 'dino-ge';
new Engine({ onLoad() {
  new Rectangle({ tag: 'Gate', position: new Vector2(120, 120), width: 80, height: 48 });
  new Rectangle({ tag: 'Key', position: new Vector2(220, 120), width: 32, height: 24 });
} }, { containerId: 'playground-canvas-container' });` }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  const gate = page.getByRole('button', { name: 'Gate', exact: true });
  const width = page.getByRole('spinbutton', { name: 'Width', exact: true });
  await gate.press('Enter');
  await expect(width).toHaveValue('80.00');
  await width.fill('96');
  await page.getByRole('button', { name: 'Key', exact: true }).press('Enter');
  await expect(width).toHaveValue('32.00');
  await gate.press('Enter');
  await expect(width).toHaveValue('96.00');
  const saveWidth = page.getByRole('button', { name: 'Save Width to code', exact: true });
  await expect(saveWidth).toHaveCSS('pointer-events', 'all');
  await saveWidth.click();
  await page.getByRole('button', { name: 'Undo code edit', exact: true }).click();
  await expect(width).toHaveValue('80.00');
});

test('edits circle radius in the Inspector and undoes it in code and the live scene', async ({ page }) => {
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine, Circle, Vector2 } from 'dino-ge';
new Engine({ onLoad() {
  new Circle({ tag: 'Orb', position: new Vector2(350, 220), radius: 24 });
}, update() {} }, { containerId: 'playground-canvas-container' });` }));
  await page.goto('/');
  const orb = page.getByRole('button', { name: 'Orb', exact: true });
  await expect(orb).toBeVisible();
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await orb.click();
  const radius = page.getByRole('spinbutton', { name: 'Radius', exact: true });
  const readGeometry = () => page.evaluate(() => {
    const { Engine } = window as unknown as { Engine: {
      selectedObject: { radius: number; bounds: { width: number; height: number } };
    } };
    const { radius, bounds: { width, height } } = Engine.selectedObject;
    return { radius, width, height };
  });
  const readSource = () => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getEditors()[0].getValue();
  });
  await expect(radius).toHaveValue('24.00');
  await radius.fill('36');
  await expect.poll(readGeometry).toEqual({ radius: 36, width: 72, height: 72 });
  await page.getByRole('button', { name: 'Save Radius to code' }).click();
  await expect.poll(readSource).toContain('radius: 36');
  await page.getByRole('button', { name: 'Undo code edit' }).click();
  await expect(radius).toHaveValue('24.00');
  await expect.poll(readGeometry).toEqual({ radius: 24, width: 48, height: 48 });
  await expect.poll(readSource).toContain('radius: 24');
  await page.getByRole('button', { name: 'Redo code edit' }).click();
  await expect(radius).toHaveValue('36.00');
  await expect.poll(readSource).toContain('radius: 36');
});

test('places a line, moves it by its stroke and restores the saved geometry', async ({ page }) => {
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
  await expect(page.locator('.monaco-editor')).toContainText('new Engine');
  const box = (await canvas.boundingBox())!;
  const add = page.getByRole('button', { name: 'Add line', exact: true });
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await add.dispatchEvent('dragstart', { dataTransfer: transfer });
  await canvas.dispatchEvent('dragover', { dataTransfer: transfer, clientX: box.x + 220, clientY: box.y + 175 });
  await expect(page.locator('.scene-drop-preview')).toContainText('Line · X 220 · Y 175');
  await expect(page.locator('.scene-drop-line')).toBeVisible();
  await add.dragTo(canvas, { targetPosition: { x: 220, y: 175 } });

  const line = page.getByRole('button', { name: 'New line', exact: true });
  const x = page.getByRole('spinbutton', { name: 'X', exact: true });
  const y = page.getByRole('spinbutton', { name: 'Y', exact: true });
  await expect(line).toHaveAttribute('aria-pressed', 'true');
  await expect(x).toHaveValue('220.00');
  await expect(y).toHaveValue('175.00');
  await expect(page.locator('.scene-drop-preview')).toHaveCount(0);
  await page.mouse.click(box.x + 250, box.y + 200);
  await expect(line).toHaveAttribute('aria-pressed', 'false');
  await page.mouse.move(box.x + 250, box.y + 175);
  await page.mouse.down();
  await page.mouse.move(box.x + 270, box.y + 205, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Number(await x.inputValue())).toBeCloseTo(240, 0);
  await expect.poll(async () => Number(await y.inputValue())).toBeCloseTo(205, 0);
  const [movedX, movedY] = await Promise.all([x.inputValue(), y.inputValue()]);
  await page.getByRole('button', { name: 'Apply placement to code' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Applied to code' })).toBeVisible();

  const endX = page.getByRole('spinbutton', { name: 'End X', exact: true });
  const stroke = page.getByRole('spinbutton', { name: 'Stroke width', exact: true });
  const readExtendedStrokePixel = (offset = 4) => canvas.evaluate((element: HTMLCanvasElement, [originX, originY, offset]) =>
    element.getContext('2d')!.getImageData(Number(originX) + 125, Number(originY) + Number(offset), 1, 1).data[0],
  [movedX, movedY, offset]);
  await expect.poll(readExtendedStrokePixel).toBe(255);
  await endX.fill('145');
  await stroke.fill('12');
  await expect.poll(readExtendedStrokePixel).toBe(0);
  await page.getByRole('button', { name: 'Save End X to code' }).click();
  await page.getByRole('button', { name: 'Save Stroke width to code' }).click();
  const colour = page.getByRole('textbox', { name: 'Stroke colour', exact: true });
  await expect(colour).toHaveValue('', { timeout: 3000 });
  await page.getByLabel('Choose stroke colour', { exact: true }).fill('#9e3a88');
  await expect(colour).toHaveValue('#9e3a88');
  await expect.poll(readExtendedStrokePixel).toBe(158);
  await expect.poll(() => readExtendedStrokePixel(0)).toBe(158);
  await page.getByRole('button', { name: 'Save Stroke colour to code' }).click();

  const saved = page.waitForResponse(response => response.request().method() === 'PUT' &&
    response.url().endsWith('/api/scripts/script'));
  await page.getByRole('button', { name: 'Save script', exact: true }).click();
  await saved;
  await page.reload();
  await line.click();
  await expect(x).toHaveValue(movedX);
  await expect(y).toHaveValue(movedY);
  await expect(endX).toHaveValue('145.00');
  await expect(stroke).toHaveValue('12.00');
  await expect(colour).toHaveValue('#9e3a88');
  await expect.poll(readExtendedStrokePixel).toBe(158);
  await colour.clear();
  await expect.poll(readExtendedStrokePixel).toBe(0);
  await page.getByRole('button', { name: 'Save Stroke colour to code' }).click();
  await expect.poll(() => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getEditors()[0].getValue();
  })).toMatch(/colour:\s*(?:""|'')/);
});

test('drags a rotated line’s endpoints independently and saves them with undo', async ({ page }) => {
  let script = `
import { Engine, Line, Vector2 as Vec } from 'dino-ge';
new Engine({ onLoad() {
  new Line({ tag: 'Ramp', p1: new Vec(240, -80), p2: new Vec(336, -80), rotation: Math.PI / 2, width: 4 });
}, update() {} }, { containerId: 'playground-canvas-container' });`;
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => {
    if (route.request().method() === 'PUT') {
      script = route.request().postDataJSON().data;
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ json: script });
  });
  await page.goto('/');
  const ramp = page.getByRole('button', { name: 'Ramp', exact: true });
  await expect(ramp).toBeVisible();
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await ramp.click();
  await page.getByRole('button', { name: 'Snap to grid' }).click();
  const canvas = page.locator('#canvas');
  await canvas.evaluate((element: HTMLCanvasElement) => {
    element.style.width = `${element.width}px`;
    element.style.height = `${element.height}px`;
  });
  const box = (await canvas.boundingBox())!;
  const startX = page.getByRole('spinbutton', { name: 'Start X', exact: true });
  const endX = page.getByRole('spinbutton', { name: 'End X', exact: true });
  const readout = page.getByRole('group', { name: 'Current scene gesture' });
  const originX = page.getByRole('spinbutton', { name: 'X', exact: true });
  const source = () => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getEditors()[0].getValue();
  });
  const original = await source();

  await ramp.press('ArrowRight');
  await expect(originX).toHaveValue('256.00');
  await expect(startX).toHaveValue('240.00');
  await page.getByRole('button', { name: 'Apply placement to code' }).click();
  await expect.poll(source).toContain('p1: new Vec(240, -80), position: new Vec(256, -80)');
  await page.getByRole('button', { name: 'Undo code edit' }).click();
  await expect(originX).toHaveValue('240.00');
  await expect.poll(source).toBe(original);

  await page.mouse.move(box.x + 320, box.y + 208);
  await page.mouse.down();
  await page.mouse.move(box.x + 338, box.y + 208, { steps: 4 });
  await page.mouse.up();
  await expect(originX).toHaveValue('256.00');
  await expect(startX).toHaveValue('240.00');
  await page.mouse.move(box.x + 336, box.y + 160);
  await page.mouse.down();
  await page.mouse.move(box.x + 350, box.y + 178, { steps: 4 });
  await page.mouse.up();
  await expect(startX).toHaveValue('256.00');
  await page.getByRole('button', { name: 'Discard canvas changes' }).click();
  await expect(originX).toHaveValue('240.00');
  await expect(startX).toHaveValue('240.00');
  await expect(endX).toHaveValue('336.00');
  await expect.poll(source).toBe(original);

  await page.mouse.move(box.x + 320, box.y + 256);
  await page.mouse.down();
  await page.mouse.move(box.x + 290, box.y + 286, { steps: 5 });
  await expect(readout).toHaveText('Line end · Local X 368 · Y -48');
  await expect(endX).toHaveValue('368.00');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(endX).toHaveValue('336.00');
  await expect(readout).toHaveCount(0);

  await page.mouse.move(box.x + 320, box.y + 256);
  await page.mouse.down();
  await page.mouse.move(box.x + 290, box.y + 286, { steps: 5 });
  await page.mouse.up();
  await page.mouse.move(box.x + 320, box.y + 160);
  await page.mouse.down();
  await page.mouse.move(box.x + 350, box.y + 178, { steps: 5 });
  await expect(readout).toHaveText('Line start · Local X 256 · Y -112');
  await page.mouse.up();
  await expect(startX).toHaveValue('256.00');
  await expect(endX).toHaveValue('368.00');
  await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('240.00');
  await page.getByRole('button', { name: 'Apply placement to code' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Applied to code' })).toBeVisible();

  await expect.poll(source).toContain('p1: new Vec(256, -112), position: new Vec(240, -80)');
  await expect.poll(source).toContain('p2: new Vec(368, -48)');
  await page.getByRole('button', { name: 'Undo code edit' }).click();
  await expect(startX).toHaveValue('240.00');
  await expect(endX).toHaveValue('336.00');
  await expect.poll(source).not.toContain('position: new Vec');
  await page.getByRole('button', { name: 'Redo code edit' }).click();
  await expect(startX).toHaveValue('256.00');
  await expect(endX).toHaveValue('368.00');

  const saved = page.waitForResponse(response => response.request().method() === 'PUT' &&
    response.url().endsWith('/api/scripts/script'));
  await page.getByRole('button', { name: 'Save script', exact: true }).click();
  await saved;
  await page.reload();
  await page.getByRole('button', { name: 'Ramp', exact: true }).click();
  await expect(startX).toHaveValue('256.00');
  await expect(endX).toHaveValue('368.00');
  await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('240.00');
});

test('previews a text drop and restores the content edited in the Inspector', async ({ page }) => {
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
  await expect(page.locator('.monaco-editor')).toContainText('new Engine');
  const box = (await canvas.boundingBox())!;
  const add = page.getByRole('button', { name: 'Add text', exact: true });
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await add.dispatchEvent('dragstart', { dataTransfer: transfer });
  await canvas.dispatchEvent('dragover', { dataTransfer: transfer, clientX: box.x + 210, clientY: box.y + 170 });
  const preview = page.locator('.scene-drop-preview');
  await expect(preview.getByText('New text', { exact: true })).toBeVisible();
  await expect(preview).toContainText('Text · X 210 · Y 170');
  await add.dragTo(canvas, { targetPosition: { x: 210, y: 170 } });
  await expect(preview).toHaveCount(0);
  const object = page.getByRole('button', { name: 'New text', exact: true });
  await expect(object).toHaveAttribute('aria-pressed', 'true');
  const content = page.getByRole('textbox', { name: 'Content', exact: true });
  await expect(content).toHaveValue('New text');
  const readTextPixels = () => canvas.evaluate((element: HTMLCanvasElement) =>
    Array.from(element.getContext('2d')!.getImageData(230, 178, 120, 30).data));
  const original = await readTextPixels();
  await content.fill('Ready to play');
  await expect.poll(readTextPixels).not.toEqual(original);
  await page.getByRole('button', { name: 'Save Content to code', exact: true }).click();
  const background = page.getByRole('textbox', { name: 'Background', exact: true });
  await background.fill('#fff2bc');
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) =>
    Array.from(element.getContext('2d')!.getImageData(216, 177, 1, 1).data))).toEqual([255, 242, 188, 255]);
  await page.getByRole('button', { name: 'Save Background to code', exact: true }).click();

  const saved = page.waitForResponse(response => response.request().method() === 'PUT' &&
    response.url().endsWith('/api/scripts/script'));
  await page.getByRole('button', { name: 'Save script', exact: true }).click();
  await saved;
  await page.reload();
  await object.click();
  await expect(content).toHaveValue('Ready to play');
  await expect(background).toHaveValue('#fff2bc');
  await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('210.00');
  await background.clear();
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) =>
    Array.from(element.getContext('2d')!.getImageData(216, 177, 1, 1).data))).toEqual([255, 255, 255, 255]);
});

test('explains a rejected palette drop without pausing the game or changing the script', async ({ page }) => {
  const source = `import { Engine } from 'dino-ge';
function setup() {}
const callbacks = { onLoad: setup };
let frames = 0;
new Engine({
  ...callbacks,
  update() { document.body.dataset.previewFrames = String(++frames); },
}, { containerId: 'playground-canvas-container' });`;
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: source }));
  await page.goto('/');
  await expect(page.locator('.monaco-editor')).toContainText('...callbacks');
  const canvas = page.locator('#canvas');
  await expect(canvas).toBeVisible();
  const readSource = () => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getEditors()[0].getValue();
  });
  const original = await readSource();
  await page.getByRole('button', { name: 'Add rectangle' }).dragTo(canvas, {
    targetPosition: { x: 180, y: 150 },
  });

  const error = page.getByRole('alert').filter({ hasText: 'inline configuration' });
  await expect(error).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit scene', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'New rectangle', exact: true })).toHaveCount(0);
  expect(await readSource()).toBe(original);
  const frames = () => page.evaluate(() => Number(document.body.dataset.previewFrames));
  await expect.poll(frames).toBeGreaterThan(await frames());
  await page.getByRole('button', { name: 'Dismiss placement error' }).click();
  await expect(error).toHaveCount(0);
});

test('leaves a callback object shared outside the Engine untouched when a drop is rejected', async ({ page }) => {
  const source = `import { Engine } from 'dino-ge';
const callbacks = { update() {} };
const otherConfiguration = { ...callbacks };
void otherConfiguration;
new Engine(callbacks, { containerId: 'playground-canvas-container' });`;
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: source }));
  await page.goto('/');
  await expect(page.locator('.monaco-editor')).toContainText('otherConfiguration');
  const readSource = () => page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    return monaco.editor.getEditors()[0].getValue();
  });
  const original = await readSource();
  await page.getByRole('button', { name: 'Add rectangle', exact: true }).dragTo(page.locator('#canvas'), {
    targetPosition: { x: 180, y: 150 },
  });
  await expect(page.getByRole('alert').filter({ hasText: 'used only by that Engine' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit scene', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(await readSource()).toBe(original);
});

for (const separate of [false, true]) {
  test(`saves successive palette drops with a named setup callback in ${separate ? 'a local' : 'an inline'} configuration`, async ({ page }) => {
    const options = "{ containerId: 'playground-canvas-container' }";
    const startGame = separate ? `const callbacks = {};
function startGame() {
  const callbacks = { onLoad, update() {} };
  new Engine(callbacks, ${options});
}
startGame();` : `new Engine({ onLoad, update() {} }, ${options});`;
    let source = `import { Engine, Rectangle, Vector2 } from 'dino-ge';
function onLoad() {
  if (this.update) new Rectangle({ tag: 'setup marker', position: new Vector2(30, 30), width: 30, height: 30 });
}
${startGame}
onLoad = () => { throw new Error('The callback was already captured'); };`;
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
    const marker = page.getByRole('button', { name: 'setup marker', exact: true });
    await expect(marker).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
      const { monaco } = window as typeof window & { monaco?: Monaco };
      return monaco?.editor.getEditors()[0]?.getValue();
    })).toContain('onLoad,');
    for (const [kind, x] of [['rectangle', 175], ['circle', 275]] as const) {
      await page.getByRole('button', { name: `Add ${kind}` }).dragTo(canvas, { targetPosition: { x, y: 150 } });
      await expect(page.getByRole('button', { name: `New ${kind}`, exact: true })).toHaveAttribute('aria-pressed', 'true');
    }
    await expect(marker).toHaveCount(1);

    const saved = page.waitForResponse(response => response.request().method() === 'PUT' &&
      response.url().endsWith('/api/scripts/script'));
    await page.getByRole('button', { name: 'Save script', exact: true }).click();
    await saved;
    expect(source.match(/function DinoPlaceLoad/g)).toHaveLength(1);
    if (separate) expect(source).toContain('const callbacks = {};');
    await page.reload();
    await expect(marker).toHaveCount(1);
    for (const [kind, x] of [['rectangle', 175], ['circle', 275]] as const) {
      await page.getByRole('button', { name: `New ${kind}`, exact: true }).click();
      await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue(`${x}.00`);
    }
  });
}

for (const isAsync of [false, true]) {
  test(`saves successive Library drops with a concise ${isAsync ? 'async' : 'sync'} setup arrow`, async ({ page }) => {
    let source = `import { Engine, Rectangle, Vector2 } from 'dino-ge';
new Engine({
  onLoad: ${isAsync ? 'async ' : ''}() => (${isAsync ? 'await Promise.resolve(), ' : ''}new Rectangle({
    tag: 'Original platform', position: new Vector2(300, 220), width: 64, height: 32
  })),
  update() {},
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
    const original = page.getByRole('button', { name: 'Original platform', exact: true });
    await expect(original).toBeVisible();
    await expect(page.locator('.monaco-editor')).toContainText(`onLoad: ${isAsync ? 'async ' : ''}() =>`);
    await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
    await page.getByRole('button', { name: 'Snap to grid', exact: true }).click();
    const canvas = page.locator('#canvas');
    const placements = [['circle', 320], ['line', 416]] as const;
    for (const [kind, x] of placements) {
      await page.getByRole('button', { name: `Add ${kind}`, exact: true }).dragTo(canvas, {
        targetPosition: { x, y: 176 },
      });
      await expect(page.getByRole('button', { name: `New ${kind}`, exact: true })).toHaveAttribute('aria-pressed', 'true');
    }

    const saved = page.waitForResponse(response => response.request().method() === 'PUT' &&
      response.url().endsWith('/api/scripts/script'));
    await page.getByRole('button', { name: 'Save script', exact: true }).click();
    await saved;
    expect(source.match(/function DinoPlaceLoad/g)).toHaveLength(1);
    await page.reload();
    await expect(original).toHaveCount(1);
    for (const [kind, x] of placements) {
      await page.getByRole('button', { name: `New ${kind}`, exact: true }).click();
      await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue(`${x}.00`);
      await expect(page.getByRole('spinbutton', { name: 'Y', exact: true })).toHaveValue('176.00');
    }
    expect(await page.evaluate(() => {
      const { Engine } = window as unknown as { Engine: { objects: Set<{ metadata: { tag: string } }> } };
      return Array.from(Engine.objects, object => object.metadata.tag);
    })).toEqual(['Original platform', 'New circle', 'New line']);
  });
}

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

  const saved = page.waitForResponse(response => response.request().method() === 'PUT' &&
    response.url().endsWith('/api/scripts/script'));
  await page.getByRole('button', { name: 'Save script', exact: true }).click();
  await saved;
  expect(source).toMatch(/class Workshop extends Level\s*{\s*onLoad\(\)\s*{\s*new Circle/);
  await page.reload();
  await expect(marker).toBeVisible();
  await expect(circle).toHaveCount(0);
  await canvas.click({ position: { x: 45, y: 25 } });
  await circle.press('Enter');
  await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('170.00');
  await expect(page.getByRole('spinbutton', { name: 'Y', exact: true })).toHaveValue('155.00');
});

test('edits and places objects in a scene that uses a Dino GE namespace import', async ({ page }) => {
  let source = `import * as GE from 'dino-ge';
class Workshop extends GE.Scene {
  onLoad() {
    new GE.Rectangle({ tag: 'Platform', position: new GE.Vector2(320, 235), width: 64, height: 40 });
  }
}
function checkForeignNamespace(GE) {
  return new GE.Rectangle({ tag: 'foreign' }).__sourceId;
}
if (checkForeignNamespace({ Rectangle: class { constructor(options) { Object.assign(this, options); } } })) {
  throw new Error('Instrumented a shadowed namespace');
}
new GE.Engine({ onLoad() { GE.Engine.currentScene = new Workshop(); }, update() {} },
  { containerId: 'playground-canvas-container' });`;
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => {
    if (route.request().method() === 'PUT') {
      source = route.request().postDataJSON().data;
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ json: source });
  });
  await page.goto('/');
  const platform = page.getByRole('button', { name: 'Platform', exact: true });
  await expect(platform).toBeVisible();
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await platform.click();
  await page.getByRole('region', { name: 'Scene viewport' }).press('Shift+ArrowRight');
  await page.getByRole('button', { name: 'Apply placement to code', exact: true }).click({ timeout: 3000 });

  await page.getByRole('button', { name: 'Duplicate object', exact: true }).click();
  const copy = page.getByRole('button', { name: 'Platform copy', exact: true });
  await expect(copy).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('354.00');
  await page.getByRole('button', { name: 'Add circle', exact: true }).dragTo(page.locator('#canvas'), {
    targetPosition: { x: 545, y: 220 },
  });
  const circle = page.getByRole('button', { name: 'New circle', exact: true });
  await expect(circle).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Save script', exact: true }).click();
  await expect.poll(() => source).toContain('new GE.Vector2(330, 235)');
  expect(source).toContain('new GE.Vector2(354, 259)');
  expect(source).toContain('new GE.Circle(');
  expect(source.match(/from 'dino-ge'/g)).toHaveLength(1);
  await page.reload();
  await expect(platform).toBeVisible();
  await expect(copy).toBeVisible();
  await expect(circle).toBeVisible();
});

test('drops a loaded project image as a sprite and reopens it using a relative asset path', async ({ page }) => {
  const id = 'sprite-demo/src/index';
  let source = `import { Engine, Loader } from 'dino-ge';
new Engine({
  async onLoad() {
    Loader.queueImage('gem', new URL('../assets/gem.svg', import.meta.url).href);
    Loader.queueImage('leaf', new URL('../assets/leaf.svg', import.meta.url).href);
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
  await page.route('**/project-runs/*/sprite-demo/assets/leaf.svg', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="40"><rect width="64" height="40" fill="green"/></svg>',
  }));

  await page.goto('/');
  await page.locator('.script-selector').selectOption(id);
  await page.getByRole('button', { name: 'Assets', exact: true }).click();
  const asset = page.getByRole('button', { name: 'Add gem as sprite' });
  await expect(asset).toBeDisabled();
  await page.getByRole('button', { name: 'Edit scene' }).click();
  const canvas = page.locator('#canvas');
  const box = (await canvas.boundingBox())!;
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await asset.dispatchEvent('dragstart', { dataTransfer: transfer });
  await canvas.dispatchEvent('dragover', { dataTransfer: transfer, clientX: box.x + 175, clientY: box.y + 145 });
  const preview = page.locator('.scene-drop-preview');
  await expect(preview).toContainText('gem · X 175 · Y 145');
  await expect(preview.locator('img')).toHaveAttribute('src', /\/assets\/gem\.svg$/);
  const footprint = preview.locator('.scene-drop-outline');
  await expect.poll(async () => (await footprint.boundingBox())?.width ?? 0).toBeCloseTo(48, 0);
  await canvas.dispatchEvent('dragleave', { dataTransfer: transfer });
  await expect(preview).toHaveCount(0);
  await asset.dragTo(canvas, { targetPosition: { x: 175, y: 145 } });
  const sprite = page.getByRole('button', { name: 'gem sprite', exact: true });
  await expect(sprite).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('175.00');
  await expect(page.getByRole('spinbutton', { name: 'Width', exact: true })).toHaveValue('48.00');
  const width = page.getByRole('spinbutton', { name: 'Width', exact: true });
  const selectedId = () => page.evaluate(() => (window as any).Engine.selectedObject?.id);
  const idBeforeSwap = await selectedId();
  await page.getByRole('button', { name: 'Replace selected sprite with leaf', exact: true }).click();
  await expect(width).toHaveValue('64.00');
  await expect.poll(selectedId).toBe(idBeforeSwap);
  await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('175.00');
  await page.getByRole('button', { name: 'Undo code edit', exact: true }).click();
  await expect(width).toHaveValue('48.00');
  await page.getByRole('button', { name: 'Redo code edit', exact: true }).click();
  await expect(width).toHaveValue('64.00');

  const saved = page.waitForResponse(response => response.request().method() === 'PUT' &&
    response.url().endsWith(`/api/scripts/${encodeURIComponent(id)}`));
  await page.getByRole('button', { name: 'Save script', exact: true }).click();
  await saved;
  expect(source).toMatch(/src: new URL\(["']\.\.\/assets\/leaf\.svg["'], import\.meta\.url\)\.href/);
  expect(source).toContain('new Sprite(');
  expect(source.match(/from 'dino-ge'/g)).toHaveLength(1);
  await page.reload();
  await page.locator('.script-selector').selectOption(id);
  await sprite.press('Enter');
  await expect(page.getByRole('spinbutton', { name: 'Y', exact: true })).toHaveValue('145.00');
  await expect(page.getByRole('spinbutton', { name: 'Height', exact: true })).toHaveValue('40.00');
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await page.getByRole('button', { name: 'Duplicate object' }).click();
  await expect(page.getByRole('button', { name: 'gem sprite copy', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('spinbutton', { name: 'Y', exact: true })).toHaveValue('169.00');
  await expect(page.getByRole('spinbutton', { name: 'Height', exact: true })).toHaveValue('40.00');
});

test('inserts a sprite from its project asset with the same scale as a canvas drop', async ({ page }) => {
  const id = 'sprite-code/scenes/main';
  let source = `import { Engine, Loader } from 'dino-ge';
new Engine({ async onLoad() {
  Loader.queueImage('gem', new URL('../assets/gem.svg', import.meta.url).href);
  await Loader.loadAll();
}, update() {} }, { containerId: 'playground-canvas-container' });`;
  await page.route('**/files', route => route.fulfill({ json: ['script', id] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: '' }));
  await page.route(`**/api/scripts/${encodeURIComponent(id)}`, route => {
    if (route.request().method() === 'PUT') {
      source = route.request().postDataJSON().data;
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ json: source });
  });
  await page.route('**/project-runs/*/sprite-code/assets/gem.svg', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="128"><rect width="256" height="128" fill="orange"/></svg>',
  }));
  await page.goto('/');
  await page.locator('.script-selector').selectOption(id);
  await page.getByRole('button', { name: 'Choose sprite image', exact: true }).press('Enter');
  await expect(page.getByRole('button', { name: 'Assets', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('tab', { name: 'Console' }).click();
  const asset = page.getByRole('button', { name: 'Add gem as sprite', exact: true });
  const insert = page.getByRole('button', { name: 'Insert gem sprite code', exact: true });
  await expect(asset).toBeDisabled();
  await expect(insert).toBeEnabled({ timeout: 3000 });
  await insert.click();
  await expect(page.getByRole('tab', { name: 'Editor' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('status').filter({ hasText: 'Inserted gem sprite' })).toBeVisible();
  const sprite = page.getByRole('button', { name: 'gem sprite', exact: true });
  await expect(sprite).toHaveCount(0);

  await page.getByRole('button', { name: 'Reset game', exact: true }).click();
  await expect(sprite).toBeVisible();
  expect(source).toMatch(/src: new URL\(["']\.\.\/assets\/gem\.svg["'], import\.meta\.url\)\.href/);
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await sprite.click();
  const x = page.getByRole('spinbutton', { name: 'X', exact: true });
  const scale = page.getByRole('spinbutton', { name: 'Scale X', exact: true });
  const width = page.getByRole('spinbutton', { name: 'Width', exact: true });
  await expect(x).toHaveValue('100.00');
  await expect(scale).toHaveValue('0.50');
  await expect(width).toHaveValue('256.00');

  await asset.dragTo(page.locator('#canvas'), { targetPosition: { x: 360, y: 225 } });
  await expect(page.getByRole('button', { name: 'gem sprite 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(x).toHaveValue('360.00');
  await expect(scale).toHaveValue('0.50');
  await expect(width).toHaveValue('256.00');

  const editor = page.locator('.monaco-editor');
  await asset.dragTo(editor);
  await expect(page.getByRole('status').filter({ hasText: 'Inserted gem sprite 3' })).toBeVisible({ timeout: 3000 });
  await expect(page.getByRole('button', { name: 'gem sprite 3', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset game', exact: true }).click();
  const thirdSprite = page.getByRole('button', { name: 'gem sprite 3', exact: true });
  await expect(thirdSprite).toBeVisible();
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await thirdSprite.click();
  await expect(x).toHaveValue('100.00');
  await expect(scale).toHaveValue('0.50');
  await expect(width).toHaveValue('256.00');
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
