import { expect, test } from '@playwright/test';
import type { Monaco } from '@monaco-editor/react';

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
    return monaco.editor.getModels().find(model => model.getLanguageId() === 'javascript')?.getValue();
  })).toBe('const secondScript = 3;\n');

  const saved = page.waitForRequest(
    request => request.method() === 'PUT' && request.url().includes('/api/scripts/'),
    { timeout: 5000 }
  );
  await page.keyboard.press(`${modifier}+s`);
  const request = await saved;
  expect(request.url()).toMatch(/\/api\/scripts\/second$/);
  expect(request.postDataJSON().data).toBe('const secondScript = 3;\n');
});

test('saves while declarations load and resolves Dino GE imports afterwards', async ({ page }) => {
  const script = "import { Vector2 } from 'dino-ge';\nnew Vector2(1, 2);";
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
    return !!monaco.languages.typescript.javascriptDefaults.getCompilerOptions().paths?.['dino-ge'];
  });

  await expect.poll(() => page.evaluate(async () => {
    const { monaco } = window as typeof window & { monaco: Monaco };
    const model = monaco.editor.getModels().find(candidate =>
      candidate.getValue().startsWith('import { Vector2 }')
    );
    if (!model) return null;

    const getWorker = await monaco.languages.typescript.getJavaScriptWorker();
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
