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
    // Keep the panel screenshots independent of whichever game lives in the test workspace.
    await page.route('**/files', route => route.fulfill({ json: ['script'] }));
    await page.route('**/api/scripts/script', route => route.fulfill({ json: `
import { Engine, Text, Vector2 } from 'dino-ge';
new Engine({
  onLoad: () => {
    console.log('Game Ready!');
    new Text({ text: 'Dino GE Playground', position: new Vector2(100, 100), colour: 'white' });
  },
  update: () => {}
}, { containerId: 'playground-canvas-container', backgroundColour: '#264653' });
` }));
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
    await expect(page.getByRole('tab', { name: 'Editor' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.monaco-editor')).toContainText('Dino GE Playground');

    // Take a screenshot of the initial state for visual testing
    await expect(page).toHaveScreenshot('initial-load.png', {
        maxDiffPixelRatio: 0.1,
        animations: 'disabled',
    });
  });

  test('can collapse and restore the dock while Inspector is selected', async ({ page }) => {
    const inspectorPanel = page.getByRole('region', { name: 'Right dock' });
    await inspectorPanel.getByRole('tab', { name: 'Inspector' }).click();
    await expect(inspectorPanel).toBeVisible();

    // Collapsing - click the header
    await page.getByRole('button', { name: 'Collapse right dock' }).click();
    
    // The panel is hidden while the Inspector keeps tracking scene edits.
    await expect(inspectorPanel).not.toBeVisible();

    // Expanding - click the expand button (new in App.tsx)
    const expandButton = page.getByRole('button', { name: 'Expand right dock' });
    await expect(expandButton).toBeVisible();
    await expandButton.click();
    
    await expect(inspectorPanel).toBeVisible();
  });

  test('keeps scene shortcuts available on demand in a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await page.getByRole('button', { name: 'Edit scene', exact: true }).click();

    const viewport = page.getByRole('region', { name: 'Scene viewport' });
    const reference = page.getByText(/F frames (?:the )?selection/);
    await expect(viewport).toHaveAccessibleDescription(/Zoom 100%/);
    await expect(reference).toBeHidden();
    await page.getByText('Shortcuts', { exact: true }).press('Enter');
    await expect(reference).toBeVisible();
    await page.getByText('Shortcuts', { exact: true }).press('Enter');
    await expect(reference).toBeHidden();
  });

  test('should toggle Explorer panel', async ({ page }) => {
    const explorer = page.getByRole('region', { name: 'Left dock' });
    await expect(explorer).toBeVisible();

    // Collapsing - click the header
    await page.getByRole('button', { name: 'Collapse left dock' }).click();
    await expect(explorer).toBeHidden();

    // Expanding - click the expand button
    const expandButton = page.getByRole('button', { name: 'Expand left dock' });
    await expect(expandButton).toBeVisible();
    await expandButton.click();
    
    await expect(explorer).toBeVisible();
  });

  test('should toggle Editor panel', async ({ page }) => {
    const editorHeader = page.locator('.panel-header').filter({ hasText: 'Editor' });
    await expect(editorHeader).toBeVisible();

    const collapseButton = page.getByRole('button', { name: 'Collapse right dock' });
    await collapseButton.click();
    await expect(editorHeader).not.toBeVisible();

    // Expanding - click the expand button
    const expandButton = page.getByRole('button', { name: 'Expand right dock' });
    await expect(expandButton).toBeVisible();
    await expandButton.click();
    
    await expect(editorHeader).toBeVisible();
  });

  test('shows Console output with Inspector open and restores the Editor tab', async ({ page }) => {
    const consoleTab = page.getByRole('tab', { name: 'Console' });
    const editorTab = page.getByRole('tab', { name: 'Editor' });

    await page.getByRole('tab', { name: 'Inspector' }).click();
    await consoleTab.click();
    const consoleContent = page.getByRole('tabpanel', { name: 'Console' });
    await expect(consoleContent).toContainText('Game Ready!');

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
