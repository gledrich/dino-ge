import { clickCanvasText, expectCanvasText, observeCanvasUI } from '../../example/e2e/canvas-ui';
import { expect, test } from '@playwright/test';
import type { Monaco } from '@monaco-editor/react';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

test('an empty workspace seeds once and never replaces user games', async () => {
  const { ProjectStore } = await import('../lib/projects.js');
  const workspace = await mkdtemp(join(tmpdir(), 'dino-ge-projects-'));
  try {
    const scripts = join(workspace, 'scripts');
    const template = join(workspace, 'template');
    await mkdir(scripts);
    await mkdir(template);
    await writeFile(join(template, 'game.js'), '// Amber Ruins');
    const store = new ProjectStore(scripts);
    await writeFile(join(scripts, 'existing.js'), '// existing');
    await store.seed(template);
    expect(await store.list()).toEqual(['existing']);

    await rm(join(scripts, 'existing.js'));
    await store.seed(template);
    expect(await store.list()).toEqual(['amber-ruins/game']);
    const path = await store.scriptPath('amber-ruins/game');
    await writeFile(path, '// my edits');
    await store.seed(template);
    expect(await readFile(path, 'utf8')).toBe('// my edits');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('a fresh Playground runs its editable Amber Ruins copy', async ({ page, browserName }) => {
  const workspace = await mkdtemp(join(tmpdir(), 'dino-ge-playground-'));
  const serverPath = fileURLToPath(new URL('../server.js', import.meta.url));
  const server = spawn(process.execPath, [serverPath], {
    cwd: workspace,
    env: { ...process.env, PORT: '0', ENVIRONMENT: 'prod' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  try {
    await observeCanvasUI(page);
    await page.addInitScript(() => {
      const observed = window as typeof window & { gameAudio?: BaseAudioContext; loopsStarted: number };
      observed.loopsStarted = 0;
      const connect = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (...args: unknown[]) {
        if (args[0] instanceof AudioDestinationNode) {
          observed.gameAudio = this.context;
        }
        return Reflect.apply(connect, this, args);
      };
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        start.apply(this, args);
        if (this.loop) observed.loopsStarted++;
      };
    });
    const url = await new Promise<string>((resolve, reject) => {
      server.once('error', reject);
      server.once('exit', code => reject(new Error(`Playground exited with code ${code}`)));
      server.stdout.on('data', chunk => {
        const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) resolve(match[0]);
      });
    });
    await page.goto(url);
    await expect(page.locator('.script-selector')).toHaveValue('amber-ruins/game');
    await expect(page.locator('#playground-canvas-container canvas')).toBeVisible();
    await expectCanvasText(page, 'Into the ruins');
    await clickCanvasText(page, 'Start expedition');
    await expectCanvasText(page, 'The Gatehouse');
    const audioState = () => page.evaluate(() =>
      (window as typeof window & { gameAudio?: BaseAudioContext }).gameAudio?.state
    );
    const loopsStarted = () => page.evaluate(() =>
      (window as typeof window & { loopsStarted: number }).loopsStarted
    );
    if (browserName === 'chromium') {
      await expect.poll(audioState).toBe('running');
      await expect.poll(loopsStarted).toBe(1);
    }
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as any).Engine.paused)).toBe(true);
    if (browserName === 'chromium') {
      await expect.poll(audioState).toBe('suspended');
      await page.getByRole('button', { name: 'Play', exact: true }).click();
      await expect.poll(audioState).toBe('running');
      expect(await loopsStarted()).toBe(1);
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
    }
    await page.getByRole('tab', { name: 'Console' }).click();
    await page.getByRole('button', { name: 'Reset game' }).click();
    await expectCanvasText(page, 'Start expedition');
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    expect(await readFile(join(workspace, 'scripts/amber-ruins/game.js'), 'utf8')).toContain('walkDuration');

    const survivalSource = await readFile(new URL('../../example/index.js', import.meta.url));
    const survivalSprite = await readFile(new URL('../../example/sprites/DinoSprites%20-%20doux.png', import.meta.url));
    const imported = await page.request.post(`${url}/api/projects`, { data: {
      name: 'dino-survival', entry: 'game.js', files: [
        { path: 'game.js', content: survivalSource.toString('base64') },
        { path: 'sprites/DinoSprites - doux.png', content: survivalSprite.toString('base64') },
      ],
    } });
    expect(imported.status()).toBe(201);
    await page.reload();
    await page.getByLabel('Current script').selectOption('dino-survival/game');
    await expectCanvasText(page, 'DINO SURVIVAL');
    await page.evaluate(() => (window as any).Engine.emit('START_GAME'));
    await expect(page.getByRole('button', { name: 'player', exact: true })).toBeVisible();
    await page.getByLabel('Current script').selectOption('amber-ruins/game');
    await expectCanvasText(page, 'Start expedition');
    await expect(page.locator('#playground-canvas-container canvas')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'player', exact: true })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as any).Engine.currentScene === null)).toBe(true);
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      const exited = once(server, 'exit');
      server.kill();
      await exited;
    }
    await rm(workspace, { recursive: true, force: true });
  }
});

test('folder picker imports and runs a game with relative modules and assets', async ({ page, request }) => {
  const folder = await mkdtemp(join(tmpdir(), 'import-game-'));
  const name = basename(folder).toLowerCase();
  const stored = fileURLToPath(new URL(`../scripts/${name}`, import.meta.url));
  const id = `${name}/src/index`;
  const script = `const modulePath = './logic.js';
const { heading } = await import(modulePath);
const response = await fetch(new URL('../assets/level.json', import.meta.url));
const level = await response.json();
const label = document.createElement('p');
label.dataset.playgroundGame = '';
label.textContent = heading + ': ' + level.name;
document.getElementById('playground-canvas-container').append(label);`;
  try {
    await mkdir(join(folder, 'src'));
    await mkdir(join(folder, 'assets'));
    await writeFile(join(folder, 'src/index.js'), script);
    await writeFile(join(folder, 'src/logic.js'), `
import { run } from './counter.js';
export const heading = 'Imported game ' + run;`);
    await writeFile(join(folder, 'src/counter.js'), `
window.gameRuns = (window.gameRuns || 0) + 1;
export const run = window.gameRuns;`);
    await writeFile(join(folder, 'assets/level.json'), '{"name":"Nested level"}');
    await page.goto('/');
    await page.getByLabel('Choose game folder').setInputFiles(folder);
    await page.getByLabel('Entry file').selectOption('src/index.js');
    await page.getByRole('button', { name: 'Import and run' }).click();
    await expect(page.getByText('Imported game 1: Nested level')).toBeVisible();
    await expect(page.locator('.script-selector')).toHaveValue(id);
    await page.getByRole('tab', { name: 'Console' }).click();
    await page.getByRole('button', { name: 'Reset game' }).click();
    await expect(page.getByText('Imported game 2: Nested level')).toBeVisible();

    await page.getByRole('tab', { name: 'Editor' }).click();
    await page.getByRole('button', { name: 'Project files', exact: true }).click({ timeout: 3000 });
    const modules = page.getByRole('dialog', { name: 'Project files', exact: true });
    await modules.getByLabel('JavaScript module').selectOption('src/logic.js');
    const moduleEditor = modules.locator('.monaco-editor');
    await expect(moduleEditor).toContainText('Imported game');
    const updatedModule = "import { run } from './counter.js';\nexport const heading = 'Module edit ' + run;";
    await moduleEditor.evaluate((element, text) => {
      const { monaco } = window as typeof window & { monaco: Monaco };
      const editor = monaco.editor.getEditors().find(item => item.getDomNode() === element)!;
      editor.setValue(text);
    }, updatedModule);
    await expect(modules.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
    const moduleSave = page.waitForResponse(response => response.request().method() === 'PUT' &&
      new URL(response.url()).pathname.endsWith('/modules'));
    await modules.getByRole('button', { name: 'Save module', exact: true }).click();
    const savedModule = await moduleSave;
    expect(savedModule.ok()).toBe(true);
    expect(savedModule.request().postDataJSON().data.replace(/\r\n/g, '\n')).toBe(updatedModule);
    await expect(modules.getByRole('status')).toContainText('Saved');
    await modules.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Project files', exact: true })).toBeFocused();
    await expect(page.locator('.script-selector')).toHaveValue(id);
    await expect(page.getByText('Imported game 2: Nested level')).toBeVisible();
    await page.getByRole('button', { name: 'Reset game' }).click();
    await expect(page.getByText('Module edit 3: Nested level')).toBeVisible();
    const traversal = await request.get(`/api/scripts/${encodeURIComponent(id)}/modules`, {
      params: { path: '../outside.js' },
    });
    expect(traversal.status()).toBe(400);

    const update = await request.put(`/api/scripts/${encodeURIComponent(id)}`, {
      data: { data: script.replace('heading +', '"Edited game" +') },
    });
    expect(update.ok()).toBe(true);
    await page.reload();
    await page.locator('.script-selector').selectOption(id);
    await expect(page.getByText('Edited game: Nested level')).toBeVisible();
  } finally {
    await rm(folder, { recursive: true, force: true });
    await rm(stored, { recursive: true, force: true });
  }
});

test('opens the imported module that created the selected object', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 800 });
  const id = 'source-links/src/index';
  const modulePath = 'src/objects/factory.mjs';
  let module = `import { Rectangle, Text, Vector2 } from 'dino-ge';

export function makePlatform() {
  return new Rectangle({ tag: 'Imported platform', position: new Vector2(60, 60), width: 64, height: 20 });
}

export function makeLabel() {
  return new Text({ tag: 'Deferred label', text: 'Deferred', position: new Vector2(80, 80), register: false });
}

import { makeExternal } from '/shared-object.mjs';
export const call = callback => callback();
export const spawnExternal = () => makeExternal();`;
  const entry = `import { Engine, Rectangle, Vector2 } from 'dino-ge';
import { call, makePlatform, makeLabel, spawnExternal } from './objects/factory.mjs';
new Engine({ onLoad() {
  makePlatform();
  makeLabel().registerSelf();
  new Rectangle({ tag: 'Entry platform', position: new Vector2(160, 60), width: 64, height: 20 });
  const options = { tag: 'Entry callback', position: new Vector2(160, 90), width: 64, height: 20 };
  call(() => new Rectangle(options));
  spawnExternal();
} }, { containerId: 'playground-canvas-container' });`;
  await page.route('**/files', route => route.fulfill({ json: ['script', id] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: '' }));
  await page.route(`**/api/scripts/${encodeURIComponent(id)}`, route => route.fulfill({ json: entry }));
  await page.route(`**/api/scripts/${encodeURIComponent(id)}/modules`, route => route.fulfill({ json: ['src/other.js', modulePath] }));
  await page.route(`**/api/scripts/${encodeURIComponent(id)}/modules?*`, route => {
    if (route.request().method() === 'PUT') {
      module = route.request().postDataJSON().data;
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ json: module });
  });
  await page.route(`**/project-runs/*/source-links/${modulePath}`, route => route.fulfill({ contentType: 'text/javascript', body: module }));
  await page.route('**/shared-object.mjs', route => route.fulfill({ contentType: 'text/javascript', body: `
import { Rectangle, Vector2 } from 'dino-ge';
export const makeExternal = () => new Rectangle({ tag: 'External platform', position: new Vector2(160, 120), width: 64, height: 20 });` }));
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Current script' }).selectOption(id);
  await expect(page.locator('#canvas')).toBeVisible({ timeout: 3000 });
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await page.getByRole('tab', { name: 'Console', exact: true }).click();
  await page.getByRole('button', { name: 'Entry platform', exact: true }).click({ timeout: 3000 });
  const source = page.getByRole('button', { name: 'View source', exact: true });
  await expect(source).toHaveCount(0);
  await page.getByRole('button', { name: 'Entry callback', exact: true }).click();
  await expect(source).toHaveCount(0);
  await page.getByRole('button', { name: 'External platform', exact: true }).click();
  await expect(source).toHaveCount(0);
  await page.getByRole('button', { name: 'Imported platform', exact: true }).click();
  await source.click({ timeout: 3000 });
  const dialog = page.getByRole('dialog', { name: 'Project files', exact: true });
  await expect(dialog.getByLabel('JavaScript module')).toHaveValue(modulePath);
  await expect(dialog.locator('.monaco-editor')).toContainText('Imported platform');
  await expect.poll(() => dialog.locator('.monaco-editor').evaluate(element => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    const editor = monaco.editor.getEditors().find(item => item.getDomNode() === element);
    const position = editor?.getPosition();
    if (!editor || !position) return;
    const visible = editor.getScrolledVisiblePosition(position);
    return { line: position.lineNumber, visible: !!visible && visible.top >= 0 && visible.top < editor.getLayoutInfo().height };
  })).toEqual({ line: 4, visible: true });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(source).toBeFocused();
  await page.getByRole('button', { name: 'Deferred label', exact: true }).click();
  await source.click({ timeout: 3000 });
  await expect(dialog.getByLabel('JavaScript module')).toHaveValue(modulePath);
  await dialog.locator('.monaco-editor').evaluate(element => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    const editor = monaco.editor.getEditors().find(item => item.getDomNode() === element)!;
    editor.setValue('// Edited after this run\n' + editor.getValue());
  });
  await dialog.getByRole('button', { name: 'Save module', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Saved');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await source.click();
  await expect(dialog.getByLabel('JavaScript module')).toHaveValue(modulePath);
  await expect(dialog.getByRole('status')).toHaveText('Reset the game to refresh the source location.');
});

test('reviews and saves canvas moves in the module that created the objects', async ({ page }) => {
  const id = 'module-placement/index';
  const original = `import { Rectangle, Vector2 } from 'dino-ge';
export const makePlatform = () => new Rectangle({ tag: 'Platform', position: new Vector2(90, 60), width: 64, height: 20 }); export const makeWall = () => new Rectangle({ tag: 'Wall', position: new Vector2(160, 60), width: 20, height: 64 });
export const makeQuoted = () => new Rectangle({ tag: 'Quoted', position: new Vector2(260, 60), width: 20, height: 64, 'rotation': 0 });
export const makeShadowed = (Vector2) => new Rectangle({ tag: 'Shadowed', position: new Vector2(360, 60), width: 20, height: 64 });`;
  let module = original;
  let rejectSave = true;
  await page.route('**/files', route => route.fulfill({ json: ['script', id] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: '' }));
  await page.route(`**/api/scripts/${encodeURIComponent(id)}`, route => route.fulfill({ json: `
import { Engine, Vector2 } from 'dino-ge';
import { makePlatform, makeWall, makeQuoted, makeShadowed } from './platform.js';
new Engine({ onLoad() { makePlatform(); makeWall(); makeQuoted(); makeShadowed(Vector2); } }, { containerId: 'playground-canvas-container' });` }));
  await page.route(`**/api/scripts/${encodeURIComponent(id)}/modules`, route => route.fulfill({ json: ['platform.js'] }));
  await page.route(`**/api/scripts/${encodeURIComponent(id)}/modules?*`, route => {
    if (route.request().method() === 'PUT') {
      if (rejectSave) {
        rejectSave = false;
        return route.fulfill({ status: 500, json: { error: 'Could not save the module.' } });
      }
      module = route.request().postDataJSON().data;
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ json: module });
  });
  await page.route('**/project-runs/*/module-placement/platform.js', route => route.fulfill({ contentType: 'text/javascript', body: module }));
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Current script' }).selectOption(id);
  const platform = page.getByRole('button', { name: 'Platform', exact: true });
  await expect(platform).toBeVisible();
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  const apply = page.getByRole('button', { name: 'Review placement in module', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Project files', exact: true });
  for (const [tag, reason] of [['Quoted', 'literal tag and options'], ['Shadowed', 'literal transform options']]) {
    const unsafe = page.getByRole('button', { name: tag, exact: true });
    await unsafe.click();
    await unsafe.press('Shift+ArrowRight');
    await apply.click();
    await expect(dialog.getByRole('alert')).toContainText(reason);
    await expect(dialog.getByRole('button', { name: 'Save module', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Discard canvas changes', exact: true }).click();
  }
  await platform.click();
  await platform.press('Shift+ArrowRight');
  const x = page.getByRole('spinbutton', { name: 'X', exact: true });
  await expect(x).toHaveValue('100.00');
  await apply.click({ timeout: 3000 });
  await expect(dialog.locator('.monaco-editor')).toContainText('new Vector2(100, 60)');
  expect(module).toBe(original);
  await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(platform).toHaveAccessibleDescription('Pending canvas changes');
  const wall = page.getByRole('button', { name: 'Wall', exact: true });
  await wall.click();
  await wall.press('Shift+ArrowDown');
  await page.getByRole('button', { name: 'Review 2 placements in module', exact: true }).click();
  const save = dialog.getByRole('button', { name: 'Save module', exact: true });
  await save.click();
  await expect(dialog.getByRole('alert')).toHaveText('Could not save the module.');
  expect(module).toBe(original);
  await save.click();
  await expect(dialog.getByRole('status')).toHaveText('Saved. You can keep editing the scene.');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(platform).not.toHaveAccessibleDescription('Pending canvas changes');
  await expect(wall).not.toHaveAccessibleDescription('Pending canvas changes');
  expect(module.replace(/\r\n/g, '\n')).toBe(original.replace('Vector2(90, 60)', 'Vector2(100, 60)')
    .replace('Vector2(160, 60)', 'Vector2(160, 70)'));

  const liveCanvas = await page.locator('#canvas').elementHandle();
  await page.getByRole('button', { name: 'View source', exact: true }).click();
  await expect.poll(() => dialog.locator('.monaco-editor').evaluate(element => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    const editor = monaco.editor.getEditors().find(item => item.getDomNode() === element);
    const position = editor?.getPosition();
    const line = position && editor?.getModel()?.getLineContent(position.lineNumber);
    return position && line ? line.slice(position.column - 1) : '';
  })).toMatch(/^(?:new )?(?:Rectangle)?\(\{ tag: 'Wall'/);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await wall.press('Shift+ArrowDown');
  await apply.click();
  await expect(dialog.locator('.monaco-editor')).toContainText('new Vector2(160, 80)');
  await save.click();
  await expect(dialog.getByRole('status')).toContainText('Saved');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  expect(await liveCanvas?.evaluate(element => element === document.querySelector('#canvas'))).toBe(true);
  await expect(wall).not.toHaveAccessibleDescription('Pending canvas changes');

  module = '// External edit\n' + module;
  await wall.press('Shift+ArrowDown');
  await apply.click();
  await expect(dialog.getByRole('alert')).toContainText('Reset the game to refresh the source locations');
  await expect(save).toBeDisabled();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(wall).toHaveAccessibleDescription('Pending canvas changes');
  await page.getByRole('button', { name: 'Discard canvas changes', exact: true }).click();

  await page.getByRole('button', { name: 'Reset game', exact: true }).click();
  await expect(platform).toBeVisible();
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await platform.click();
  await expect(x).toHaveValue('100.00');
  await wall.click();
  await expect(page.getByRole('spinbutton', { name: 'Y', exact: true })).toHaveValue('80.00');
});

test('keeps an imported image available after deleting its sprite and reloading', async ({ page }) => {
  const workspace = await mkdtemp(join(tmpdir(), 'dino-ge-sprite-import-'));
  const scripts = join(workspace, 'scripts');
  const entry = join(scripts, 'demo/src/index.js');
  await mkdir(join(scripts, 'demo/src'), { recursive: true });
  await writeFile(join(scripts, 'demo/.dino-ge-project.json'), JSON.stringify({ entry: 'src/index.js' }));
  await writeFile(entry, `import { Engine } from 'dino-ge';
new Engine({ onLoad() {}, update() {} }, { containerId: 'playground-canvas-container' });`);
  const server = spawn(process.execPath, [fileURLToPath(new URL('../server.js', import.meta.url))], {
    cwd: workspace, env: { ...process.env, PORT: '0', ENVIRONMENT: 'prod' }, stdio: ['ignore', 'pipe', 'inherit'],
  });

  try {
    const url = await new Promise<string>((resolve, reject) => {
      server.once('error', reject);
      server.once('exit', code => reject(new Error(`Playground exited with code ${code}`)));
      server.stdout.on('data', chunk => {
        const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) resolve(match[0]);
      });
    });
    const rejected = await page.request.post(`${url}/api/scripts/demo%2Fsrc%2Findex/assets?name=invalid.png`, {
      headers: { 'Content-Type': 'image/png' }, data: Buffer.from('not a PNG'),
    });
    expect(rejected.status()).toBe(415);
    await page.route('**/api/scripts/script', route => route.fulfill({ json: '' }));
    await page.goto(url);
    await page.getByRole('combobox', { name: 'Current script' }).selectOption('demo/src/index');
    await expect(page.locator('.monaco-editor')).toContainText('new Engine');
    const canvas = page.locator('#canvas');
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;
    const imageTransfer = (name: string) => page.evaluateHandle(async name => {
      const image = document.createElement('canvas');
      image.width = 64;
      image.height = 48;
      const context = image.getContext('2d')!;
      context.fillStyle = '#f94144';
      context.fillRect(0, 0, 64, 48);
      const blob = await new Promise<Blob>(resolve => image.toBlob(value => resolve(value!), 'image/png'));
      const data = new DataTransfer();
      data.items.add(new File([blob], name, { type: 'image/png' }));
      return data;
    }, name);
    const transfer = await imageTransfer('gem.png');
    const point = { clientX: box.x + 240, clientY: box.y + 170 };
    await canvas.dispatchEvent('dragover', { dataTransfer: transfer, ...point });
    await expect(page.locator('.scene-drop-position')).toHaveText('Import image · X 240 · Y 170');
    await canvas.dispatchEvent('drop', { dataTransfer: transfer, ...point });
    const sprite = page.getByRole('button', { name: 'gem sprite', exact: true });
    await expect(sprite).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('240.00');
    const saved = page.waitForResponse(response => response.request().method() === 'PUT' &&
      response.url().endsWith('/api/scripts/demo%2Fsrc%2Findex'));
    await page.getByRole('button', { name: 'Save script', exact: true }).click();
    expect((await saved).ok()).toBe(true);
    expect(await readFile(entry, 'utf8')).toMatch(/new URL\("\.\/_dino-assets\/gem-[a-f0-9]+\.png", import\.meta\.url\)/);

    await page.reload();
    await page.getByRole('combobox', { name: 'Current script' }).selectOption('demo/src/index');
    await expect(sprite).toBeVisible();
    await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) =>
      Array.from(element.getContext('2d')!.getImageData(247, 177, 1, 1).data))).toEqual([249, 65, 68, 255]);
    await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
    await sprite.click();
    await page.getByRole('button', { name: 'Delete object', exact: true }).click();
    await expect(sprite).toHaveCount(0);
    const savedDeletion = page.waitForResponse(response => response.request().method() === 'PUT' &&
      response.url().endsWith('/api/scripts/demo%2Fsrc%2Findex'));
    await page.getByRole('button', { name: 'Save script', exact: true }).click();
    expect((await savedDeletion).ok()).toBe(true);
    await page.reload();
    await page.getByRole('combobox', { name: 'Current script' }).selectOption('demo/src/index');
    await expect(canvas).toBeVisible();
    await expect(sprite).toHaveCount(0);
    await page.getByRole('button', { name: 'Choose sprite image', exact: true }).click();
    await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
    await page.getByRole('button', { name: 'Add gem as sprite', exact: true }).dragTo(canvas, {
      targetPosition: { x: 280, y: 185 },
    });
    await expect(sprite).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('spinbutton', { name: 'Width', exact: true })).toHaveValue('64.00');
    await expect(page.getByRole('spinbutton', { name: 'X', exact: true })).toHaveValue('280.00');

    const editor = page.locator('.monaco-editor');
    const textTransfer = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.items.add(new File(['text'], 'notes.txt', { type: 'text/plain' }));
      return data;
    });
    await editor.dispatchEvent('drop', { dataTransfer: textTransfer });
    await expect(page.getByRole('alert').filter({ hasText: 'Choose a PNG, JPEG, GIF or WebP image.' })).toBeVisible();
    const editorTransfer = await imageTransfer('coin.png');
    await editor.dispatchEvent('dragover', { dataTransfer: editorTransfer });
    await expect(page.getByText('Drop to import image')).toBeVisible({ timeout: 3000 });
    await editor.dispatchEvent('drop', { dataTransfer: editorTransfer });
    const coin = page.getByRole('button', { name: 'coin sprite', exact: true });
    await expect(page.getByRole('status').filter({ hasText: 'Inserted coin sprite' })).toBeVisible();
    await expect(coin).toHaveCount(0);
    await page.getByRole('button', { name: 'Reset game', exact: true }).click();
    await expect(coin).toBeVisible();
    expect(await readFile(entry, 'utf8')).toMatch(/new URL\("\.\/_dino-assets\/coin-[a-f0-9]+\.png", import\.meta\.url\)/);
  } finally {
    if (server.exitCode === null) {
      server.kill();
      await once(server, 'exit');
    }
    await rm(workspace, { recursive: true, force: true });
  }
});

test('folder import preserves relative files and rejects unsafe or duplicate projects', async () => {
  const { ProjectStore } = await import('../lib/projects.js');
  const workspace = await mkdtemp(join(tmpdir(), 'dino-ge-projects-'));
  try {
    const store = new ProjectStore(workspace);
    const files = [
      { path: 'src/index.js', content: Buffer.from('import "./logic.js";').toString('base64') },
      { path: 'src/logic.js', content: Buffer.from('export const ready = true;').toString('base64') },
      { path: 'assets/level.json', content: Buffer.from('{"level":1}').toString('base64') },
    ];
    const input = { name: 'new-game', entry: 'src/index.js', files };
    await expect(store.import({ ...input, name: '../outside' })).rejects.toThrow();
    await expect(store.import({
      ...input, files: [...files, { path: '../outside.js', content: '' }],
    })).rejects.toThrow();
    expect(await store.list()).toEqual([]);

    await expect(store.import(input)).resolves.toBe('new-game/src/index');
    await expect(store.import(input)).rejects.toThrow(/already exists/);
    expect(await store.list()).toEqual(['new-game/src/index']);
    expect(await readFile(await store.scriptPath('new-game/src/index'), 'utf8')).toBe('import "./logic.js";');
    expect(await readFile(join(workspace, 'new-game/assets/level.json'), 'utf8')).toBe('{"level":1}');
    await expect(store.scriptPath('../outside')).rejects.toThrow();
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
