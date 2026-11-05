import { expect, test, type Page } from '@playwright/test';
import type { Monaco } from '@monaco-editor/react';

async function openWorkspace(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('**/files', route => route.fulfill({ json: ['script'] }));
  await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine, Rectangle, Vector2 } from 'dino-ge';
new Engine({ onLoad() {
  new Rectangle({ tag: 'Platform', position: new Vector2(120, 80), width: 80, height: 32 });
} }, { containerId: 'playground-canvas-container' });` }));
  await page.goto('/');
  await expect(page.locator('#canvas')).toBeVisible();
}

const draft = (page: Page) => page.evaluate(() => {
  const { monaco } = window as typeof window & { monaco: Monaco };
  return monaco.editor.getEditors()[0]?.getValue();
});

test('places desktop tools in three docks and preserves the draft across layouts', async ({ page }) => {
  await openWorkspace(page);
  const left = page.getByRole('region', { name: 'Left dock' });
  const right = page.getByRole('region', { name: 'Right dock' });
  const bottom = page.getByRole('region', { name: 'Bottom dock' });
  await expect(left.getByRole('tab', { name: 'Explorer' })).toBeVisible();
  await expect(right.getByRole('tab', { name: 'Editor' })).toHaveAttribute('aria-selected', 'true');
  await expect(right.getByRole('tab', { name: 'Inspector' })).toBeVisible();
  await expect(bottom.getByRole('tab', { name: 'Console' })).toBeVisible();
  await page.getByRole('button', { name: 'Minimise all panels' }).click();
  await expect(page.getByRole('separator', { name: 'Resize left dock' })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('separator', { name: 'Resize right dock' })).toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('button', { name: 'Restore panels' }).click();
  await expect(right.getByRole('tab', { name: 'Editor' })).toBeVisible();
  const runningCanvas = await page.locator('#canvas').elementHandle();
  await expect.poll(() => draft(page)).toContain('new Engine');
  await page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    const editor = monaco.editor.getEditors()[0];
    editor.setValue(`${editor.getValue()}\n// keep this draft`);
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = page.getByRole('tablist', { name: 'Workspace tools' });
  await mobile.getByRole('tab', { name: 'Console' }).click();
  await page.getByRole('button', { name: 'Collapse bottom dock' }).click();
  await expect(mobile).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(right.getByRole('tab', { name: 'Editor' })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => draft(page)).toContain('// keep this draft');
  expect(await runningCanvas?.evaluate(canvas => canvas === document.getElementById('canvas'))).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(mobile).toBeHidden();
  await page.getByRole('button', { name: 'Expand bottom dock' }).click();
  await expect(mobile.getByRole('tab', { name: 'Console' })).toHaveAttribute('aria-selected', 'true');
});

test('reorders, moves and restores tabs including moves into an empty dock', async ({ page }) => {
  await openWorkspace(page);
  const left = page.getByRole('region', { name: 'Left dock' });
  const right = page.getByRole('region', { name: 'Right dock' });
  const bottom = page.getByRole('region', { name: 'Bottom dock' });
  const editorTab = right.getByRole('tab', { name: 'Editor' });
  await expect.poll(() => draft(page)).toContain('new Engine');
  const canvas = await page.locator('#canvas').elementHandle();
  const editorNode = await page.locator('.monaco-editor').elementHandle();
  await page.evaluate(() => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    const editor = monaco.editor.getEditors()[0];
    editor.setValue(editor.getValue() + '\n// draft after moving');
  });

  await right.getByRole('tab', { name: 'Inspector' }).dragTo(editorTab, { targetPosition: { x: 3, y: 12 } });
  await expect(right.getByRole('tab')).toHaveText(['Inspector', 'Editor']);
  await editorTab.dragTo(bottom.getByRole('tab', { name: 'Console' }));
  await expect(bottom.getByRole('tab', { name: 'Editor' })).toBeFocused();
  await expect.poll(() => draft(page)).toContain('// draft after moving');
  expect(await editorNode?.evaluate(node => node === document.querySelector('.monaco-editor'))).toBe(true);
  expect(await canvas?.evaluate(node => node === document.getElementById('canvas'))).toBe(true);

  const moveExplorer = left.getByRole('combobox', { name: 'Move Explorer' });
  await moveExplorer.focus();
  await expect(moveExplorer).toBeFocused();
  await moveExplorer.selectOption('right');
  await expect(right.getByRole('tab', { name: 'Explorer' })).toBeFocused();
  await expect(left).toBeHidden();
  await right.getByRole('tab', { name: 'Inspector' }).dragTo(page.getByTestId('dock-drop-left'));
  await expect(left.getByRole('tab', { name: 'Inspector' })).toBeFocused();

  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await right.getByRole('button', { name: 'Platform', exact: true }).click();
  await bottom.getByRole('tab', { name: 'Console' }).click();
  await left.getByRole('button', { name: 'View source', exact: true }).click();
  await expect(bottom.getByRole('tab', { name: 'Editor' })).toHaveAttribute('aria-selected', 'true');
  const beforeResize = (await right.boundingBox())!.width;
  await page.getByRole('separator', { name: 'Resize right dock' }).press('ArrowLeft');
  await expect.poll(async () => (await right.boundingBox())?.width ?? 0).toBeGreaterThan(beforeResize);
  const savedWidth = (await right.boundingBox())!.width;

  await page.reload();
  await expect(left.getByRole('tab', { name: 'Inspector' })).toHaveAttribute('aria-selected', 'true');
  await expect(right.getByRole('tab', { name: 'Explorer' })).toHaveAttribute('aria-selected', 'true');
  await expect(bottom.getByRole('tab', { name: 'Editor' })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(async () => (await right.boundingBox())?.width).toBeCloseTo(savedWidth, 0);
  await left.getByRole('combobox', { name: 'Move Inspector' }).selectOption('reset');
  await expect(left.getByRole('tab', { name: 'Explorer' })).toBeVisible();
  await expect(right.getByRole('tab', { name: 'Editor' })).toHaveAttribute('aria-selected', 'true');
  await expect(bottom.getByRole('tab', { name: 'Console' })).toBeVisible();
  const save = right.getByRole('button', { name: 'Save script', exact: true });
  await expect(save).toBeInViewport();
  await expect.poll(async () => {
    const [button, dock] = await Promise.all([save.boundingBox(), right.boundingBox()]);
    return !!button && !!dock && button.x + button.width <= dock.x + dock.width;
  }).toBe(true);
});
