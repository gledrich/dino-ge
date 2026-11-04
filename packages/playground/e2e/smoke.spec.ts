import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('script routes refuse symbolic links to files outside the scripts directory', async ({ request }) => {
  const outside = await mkdtemp(join(tmpdir(), 'dino-ge-script-test-'));
  const target = join(outside, 'outside.js');
  const name = `symlink-${randomUUID()}.js`;
  const link = fileURLToPath(new URL(`../scripts/${name}`, import.meta.url));

  try {
    await writeFile(target, '// original');
    await symlink(target, link);
    expect.soft((await request.get(`/api/scripts/${name}`)).status()).toBe(404);
    expect.soft((await request.get(`/scripts/${name}`)).status()).toBe(404);
    const write = await request.put(`/api/scripts/${name}`, { data: { data: '// changed' } });
    expect.soft(write.status()).toBe(404);
    expect(await readFile(target, 'utf8')).toBe('// original');
  } finally {
    await rm(link, { force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('rejects script IDs that escape the scripts directory', async ({ request }) => {
  const read = await request.get('/api/scripts/..%2Fserver.js');
  expect(read.status()).toBe(400);

  const write = await request.put('/api/scripts/..%2Fmissing-test-directory%2Fscript.js', {
    data: { data: '' },
  });
  expect(write.status()).toBe(400);
});

test.describe('Playground Smoke Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Go to the playground root and wait for the engine to initialize
    await page.goto('/');
    // Wait for the loader to disappear
    await expect(page.locator('text=initialising Engine')).not.toBeVisible({ timeout: 15000 });
  });

  test('should load the playground and show main components', async ({ page }) => {
    // Check for core panels by their headings
    await expect(page.locator('.panel-header').filter({ hasText: 'Explorer' })).toBeVisible();
    await expect(page.locator('.panel-header').filter({ hasText: 'Inspector' })).toBeVisible();
    
    // Check if Viewport Canvas is visible (use ID to avoid Monaco canvases)
    await expect(page.locator('#canvas')).toBeVisible();

    // Check Editor tab is active
    await expect(page.locator('.panel-header span').filter({ hasText: 'Editor' })).toBeVisible();

    // Take a screenshot of the initial state for visual testing
    await expect(page).toHaveScreenshot('initial-load.png', {
        maxDiffPixelRatio: 0.1,
        animations: 'disabled',
    });
  });

  test('should toggle Inspector panel', async ({ page }) => {
    const inspectorPanel = page.getByTestId('inspector-panel');
    const inspectorHeader = inspectorPanel.locator('.panel-header');
    await expect(inspectorPanel).toBeVisible();

    // Collapsing - click the header
    await inspectorHeader.click();
    
    // It should be removed from DOM (due to conditional rendering in App.tsx)
    await expect(inspectorPanel).not.toBeVisible();

    // Expanding - click the expand button (new in App.tsx)
    const expandButton = page.getByTestId('inspector-expand-button');
    await expect(expandButton).toBeVisible();
    await expandButton.click();
    
    await expect(inspectorPanel).toBeVisible();
  });

  test('should toggle Explorer panel', async ({ page }) => {
    const explorerHeader = page.locator('.panel-header').filter({ hasText: 'Explorer' });
    await expect(explorerHeader).toBeVisible();

    // Collapsing - click the header
    await explorerHeader.click();
    await expect(explorerHeader).not.toBeVisible();

    // Expanding - click the expand button
    const expandButton = page.getByTestId('explorer-expand-button');
    await expect(expandButton).toBeVisible();
    await expandButton.click();
    
    await expect(explorerHeader).toBeVisible();
  });

  test('should toggle Editor panel', async ({ page }) => {
    const editorHeader = page.locator('.panel-header').filter({ hasText: 'Editor' });
    await expect(editorHeader).toBeVisible();

    const collapseButton = page.getByRole('button', { name: 'Collapse editor' });
    await collapseButton.click();
    await expect(editorHeader).not.toBeVisible();

    // Expanding - click the expand button
    const expandButton = page.getByTestId('editor-expand-button');
    await expect(expandButton).toBeVisible();
    await expandButton.click();
    
    await expect(editorHeader).toBeVisible();
  });

  test('should switch between Editor and Console tabs', async ({ page }) => {
    const consoleTab = page.locator('.panel-header span').filter({ hasText: 'Console' });
    const editorTab = page.locator('.panel-header span').filter({ hasText: 'Editor' });

    // Switch to Console
    await consoleTab.click();
    // Find the panel-content specifically within the center group bottom panel
    const consoleContent = page.locator('.panel-container').filter({ hasText: 'Console' }).locator('.panel-content');
    await expect(consoleContent).toContainText(/Console/i);

    // Take a screenshot of the console state
    await expect(page).toHaveScreenshot('console-tab.png', {
        maxDiffPixelRatio: 0.1,
        animations: 'disabled',
    });

    // Switch back to Editor
    await editorTab.click();
    await expect(page.locator('.monaco-editor')).toBeVisible();
  });
});
