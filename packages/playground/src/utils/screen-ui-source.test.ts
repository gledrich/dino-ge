import { expect, test } from '@jest/globals';
import { findScreenUICall, resolveScreenUISource } from './screen-ui-source';

const hostedRun = new URL('https://preview.example/run/current/');
const engineFrame = '    at ScreenUI.button (https://preview.example/built/index.js:3:810)';

test('resolves a project-relative caller for V8 and WebKit stack formats', () => {
  expect(resolveScreenUISource(
    `Error\n${engineFrame}\n    at drawHud (${hostedRun}ui/menu%20layout.js:42:12)`,
    hostedRun,
  )).toEqual({ path: 'ui/menu layout.js', lineNumber: 42, column: 12 });
  expect(resolveScreenUISource(
    `button@https://preview.example/built/core/ScreenUI.js:75:24\ndrawHud@${hostedRun}main.js:12:3`,
    hostedRun,
  )).toEqual({ path: 'main.js', lineNumber: 12, column: 3 });
});

test('accepts the exact entry Blob when WebKit omits its source URL', () => {
  const base = new URL('http://localhost:3000/project-runs/4/my-project/');
  const blobEntry = { url: 'blob:http://localhost:3000/running-entry', path: 'main.js' };
  const stack = `button@http://localhost:3000/built/index.js:3:810\ndrawHud@${blobEntry.url}:5:10`;
  expect(resolveScreenUISource(stack, base, blobEntry)).toEqual({ path: 'main.js', lineNumber: 5, column: 10 });
  expect(resolveScreenUISource(stack, base, { ...blobEntry, url: 'blob:http://localhost:3000/old-entry' })).toBeUndefined();
});

test('rejects a foreign, stale or non-canonical immediate caller even if a trusted frame follows', () => {
  for (const url of [
    'https://example.org/run/current/main.js',
    'https://preview.example/run/old/main.js',
    `${hostedRun}ui%2Fmenu.js`,
    `${hostedRun}ui/%5Cmenu.js`,
    `${hostedRun}ui/.internal.js`,
    `${hostedRun}node_modules/menu.js`,
    `${hostedRun}main.js?different`,
    `${hostedRun}main.js#different`,
    `${hostedRun}main.json`,
  ]) {
    expect(resolveScreenUISource(
      `Error\n${engineFrame}\n    at draw (${url}:9:3)\n    at next (${hostedRun}main.js:1:1)`,
      hostedRun,
    )).toBeUndefined();
  }
  expect(resolveScreenUISource(
    `Error\n${engineFrame}\n    at eval (eval at draw (${hostedRun}main.js:2:5), <anonymous>:1:8)\n    at draw (${hostedRun}main.js:3:5)`,
    hostedRun,
  )).toBeUndefined();
});

test('finds the exact draw call even when same-kind calls share a line', () => {
  const source = 'ui.button(first); ui[\'button\'](second);';
  expect(findScreenUICall(source, 'button', { lineNumber: 1, column: 22 })).toEqual({
    lineNumber: 1, column: 19, start: 18, end: 38,
  });
  expect(findScreenUICall(source, 'label', { lineNumber: 1, column: 4 })).toBeUndefined();
  expect(findScreenUICall(source, 'button', { lineNumber: 1, column: 17 })).toBeUndefined();
  expect(findScreenUICall(source, 'button', { lineNumber: 1, column: 0 })).toBeUndefined();
  expect(findScreenUICall('ui.button(', 'button', { lineNumber: 1, column: 4 })).toBeUndefined();
});

test('maps a generated entry column to the matching call in the unchanged original', () => {
  const source = 'const draw = ui => { ui.label(first); ui.label(second); };';
  const prefix = 'import * as runtime from "/runtime.js"; ';
  const runtimeSource = prefix + source;
  const column = runtimeSource.lastIndexOf('ui.label') + 4;
  const start = source.lastIndexOf('ui.label');
  expect(findScreenUICall(source, 'label', { lineNumber: 1, column }, runtimeSource)).toEqual({
    lineNumber: 1, column: start + 1, start, end: start + 'ui.label(second)'.length,
  });
  expect(findScreenUICall(source, 'label', { lineNumber: 1, column }, runtimeSource + ' ui.label(extra)')).toBeUndefined();
});

test('maps a verified draw call into its auto-formatted editor text', () => {
  const runtime = "draw = () => ui [ 'label' ](options);";
  const formatted = 'draw = () => {\n  ui["label"](options);\n};';
  expect(findScreenUICall(formatted, 'label', { lineNumber: 1, column: 28 }, runtime)).toEqual({
    lineNumber: 2, column: 3, start: 17, end: 37,
  });
});
