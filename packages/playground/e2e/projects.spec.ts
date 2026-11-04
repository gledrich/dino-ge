import { clickCanvasText, expectCanvasText, observeCanvasUI } from '../../example/e2e/canvas-ui';
import { expect, test } from '@playwright/test';
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
