import { rm } from 'node:fs/promises';
import { clickCanvasText, expectCanvasText, observeCanvasUI } from '../../example/e2e/canvas-ui';
import { expect, test } from '@playwright/test';

test('opens an editable engine example without overwriting saved scripts', async ({ page }) => {
  const scripts = new Map([['script', '// Existing script']]);
  const created: string[] = [];
  await page.route('**/files', route => route.fulfill({ json: [...scripts.keys()] }));
  await page.route('**/api/scripts/*', route => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1)!);
    if (route.request().method() === 'PUT') {
      const { data } = route.request().postDataJSON();
      scripts.set(name, data);
      created.push(name);
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ json: scripts.get(name) ?? '' });
  });
  await page.goto('/');
  const example = page.getByRole('combobox', { name: 'Engine example' });
  await example.selectOption('animation-and-actions');
  await page.getByRole('button', { name: 'Open example' }).click();
  await expect(page.getByRole('combobox', { name: 'Current script' })).toHaveValue('animation-and-actions');
  await expect(page.getByRole('button', { name: 'Pulse', exact: true })).toBeVisible();
  expect(scripts.get('animation-and-actions')).toContain('Actions.moveTo');
  await page.getByRole('button', { name: 'Open example' }).click();
  expect(created).toEqual(['animation-and-actions']);
  expect(scripts.get('script')).toBe('// Existing script');

  await example.selectOption('camera-and-input');
  await page.getByRole('button', { name: 'Open example' }).click();
  await expect(page.getByRole('button', { name: 'Surveyor', exact: true })).toBeVisible();
  expect(scripts.get('camera-and-input')).toContain('followSmooth');

  await example.selectOption('colliders-and-rays');
  await page.getByRole('button', { name: 'Open example' }).click();
  await expect(page.getByRole('button', { name: 'Compound gate', exact: true })).toBeVisible();
  expect(scripts.get('colliders-and-rays')).toContain('Physics.raycast');
  await example.selectOption('world-shaders');
  await page.getByRole('button', { name: 'Open example' }).click();
  await expect(page.getByRole('button', { name: 'Shader swatch', exact: true })).toBeVisible();
  expect(scripts.get('world-shaders')).toContain('setPostProcessShader');
});

test('opens the Tiled project with its map, atlases and audio', async ({ page, browserName }) => {
  const name = 'tiled-example-e2e-' + browserName;
  const directory = new URL('../scripts/' + name, import.meta.url);
  await rm(directory, { recursive: true, force: true });
  await page.route('**/api/projects', async route => {
    const project = route.request().postDataJSON() as { name: string; files: { path: string; content: string }[] };
    expect(project.name).toBe('tiled-and-assets');
    expect(project.files.map(({ path }) => path)).toEqual([
      'game.js', 'relay-room.tmj', 'floor.svg', 'relay.svg', 'tiles/relay.tsj', 'pickup.wav',
    ]);
    await route.continue({ postData: JSON.stringify({ ...project, name }) });
  });
  try {
    await observeCanvasUI(page);
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Engine example' }).selectOption('tiled-and-assets');
    await page.getByRole('button', { name: 'Open example' }).click();
    await expect(page.getByRole('combobox', { name: 'Current script' })).toHaveValue(name + '/game');
    await expectCanvasText(page, 'Two tile layers and a launch marker loaded');
    await clickCanvasText(page, 'Launch probe');
    await expectCanvasText(page, 'Hit the authored tile collider');
    await page.getByRole('button', { name: 'Project files', exact: true }).click();
    const files = page.getByRole('dialog', { name: 'Project files' });
    await files.getByLabel('Project file').selectOption('relay-room.tmj');
    const model = files.locator('.monaco-editor');
    await expect(model).toContainText('orthogonal');
    await model.evaluate(element => {
      const { monaco } = window as typeof window & { monaco: typeof import('monaco-editor') };
      const editor = monaco.editor.getEditors().find(item => item.getDomNode() === element)!;
      const data = JSON.parse(editor.getValue());
      data.layers[2].objects[0].x = 64;
      editor.setValue(JSON.stringify(data, null, 2));
    });
    const saved = page.waitForResponse(response => response.request().method() === 'PUT' &&
      new URL(response.url()).pathname.endsWith('/modules'));
    await files.getByRole('button', { name: 'Save file', exact: true }).click();
    expect((await saved).ok()).toBe(true);
    await expect(files.getByText('Saved. Reset the game to load the updated file.')).toBeVisible();

  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
