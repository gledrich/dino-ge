import { expect, jest, test } from '@jest/globals';
import type { editor } from 'monaco-editor';
import { findScreenUICall, getScreenUIMoveEdits, resolveScreenUISource, trackScreenUIMoveDraft } from './screen-ui-source';

function applyEdits(source: string, edits: NonNullable<ReturnType<typeof getScreenUIMoveEdits>>) {
  return [...edits].sort((left, right) => right.start - left.start).reduce(
    (text, { start, end, newText }) => text.slice(0, start) + newText + text.slice(end), source,
  );
}

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

test('adds a position offset without replacing a responsive calculation or a shorthand coordinate', () => {
  const source = [
    "import { Engine as GameEngine } from 'dino-ge';",
    'new GameEngine({ drawUI(ui) {',
    '  const y = ui.height - 24;',
    "  ui.label({ x: ui.width / 2, y, text: 'Title' });",
    '} });',
  ].join('\n');
  const edits = getScreenUIMoveEdits(source, 'label', { lineNumber: 4, column: 3 }, { x: 12, y: -4 });
  expect(edits).toBeDefined();
  expect(applyEdits(source, edits!)).toContain("ui.label({ x: (ui.width / 2) + 12, y: (y) - 4, text: 'Title' });");
});

test('supports a named draw callback and a helper called once in that callback', () => {
  const source = [
    "import { Engine } from 'dino-ge';",
    'function drawTitle(ui) {',
    "  ui.label({ x: ui.width / 2, y: 20, text: 'Title' });",
    '}',
    'function drawUI(ui) { drawTitle(ui); }',
    'export const game = new Engine({ drawUI });',
  ].join('\n');
  const edits = getScreenUIMoveEdits(source, 'label', { lineNumber: 3, column: 3 }, { x: 0, y: 6 });
  expect(edits).toBeDefined();
  expect(applyEdits(source, edits!)).toContain("ui.label({ x: ui.width / 2, y: 26, text: 'Title' });");
});

test('applies size and literal style together without replacing the responsive calculation', () => {
  const source = [
    "import { Engine } from 'dino-ge';",
    'new Engine({ drawUI(ui) {',
    "  ui.button({ x: 12, y: 30, width: ui.width / 2, height: 25, text: 'Play', onPress() {}, });",
    '} });',
  ].join('\n');
  const offset = { x: 4, y: 0, properties: { width: 15, height: 5, text: 'New "game"', font: '18px serif', enabled: false } };
  const edits = getScreenUIMoveEdits(source, 'button', { lineNumber: 3, column: 3 }, offset);
  expect(edits).toBeDefined();
  expect(applyEdits(source, edits!)).toContain(
    'ui.button({ x: 16, y: 30, width: Math.max(1, (ui.width / 2) + 15), height: 30, text: "New \\"game\\"", onPress() {}, font: "18px serif", enabled: false, });',
  );
});

test('edits only a verified literal panel colour argument', () => {
  const source = [
    "import { Engine } from 'dino-ge';",
    "new Engine({ drawUI(ui) { ui.panel({ x: 10, y: 20, width: 50, height: 25 }, 'red'); } });",
  ].join('\n');
  const position = { lineNumber: 2, column: 27 };
  const offset = { x: 0, y: 0, properties: { colour: '#229944' } };
  const edits = getScreenUIMoveEdits(source, 'panel', position, offset);
  expect(edits).toBeDefined();
  expect(applyEdits(source, edits!)).toContain('}, "#229944");');
  const draft = source.replace("'red'", "'blue'");
  expect(getScreenUIMoveEdits(draft, 'panel', position, offset, source)).toBeUndefined();
  expect(getScreenUIMoveEdits(source.replace("'red'", 'theme.panel'), 'panel', position, offset)).toBeUndefined();
  const computedRect = source.replace('{ x: 10, y: 20, width: 50, height: 25 }', 'layout.panel');
  const colourOnly = getScreenUIMoveEdits(computedRect, 'panel', position, offset);
  expect(colourOnly).toBeDefined();
  expect(applyEdits(computedRect, colourOnly!)).toContain('ui.panel(layout.panel, "#229944");');
  expect(getScreenUIMoveEdits(computedRect, 'panel', position, { ...offset, x: 4 })).toBeUndefined();
});

test('rejects the entire edit when one field is computed, unsupported or invalid', () => {
  const source = [
    "import { Engine } from 'dino-ge';",
    'new Engine({ drawUI(ui) {',
    '  ui.button({ x: 12, y: 30, width: 40, height: 25, text: state.title, enabled: state.ready, onPress() {} });',
    '} });',
  ].join('\n');
  const position = { lineNumber: 3, column: 3 };
  for (const properties of [{ text: 'New game' }, { enabled: false }, { width: -40 }, { value: 0.5 }]) {
    const offset = { x: 10, y: 0, properties };
    expect(getScreenUIMoveEdits(source, 'button', position, offset)).toBeUndefined();
  }
});

test('rejects an image size edit when a spread can shift the rectangle argument', () => {
  const source = [
    "import { Engine } from 'dino-ge';",
    'new Engine({ drawUI(ui) {',
    '  ui.image(...images, { x: 12, y: 30, width: 40, height: 25 });',
    '} });',
  ].join('\n');
  expect(getScreenUIMoveEdits(source, 'image', { lineNumber: 3, column: 3 }, {
    x: 0, y: 0, properties: { width: 10 },
  })).toBeUndefined();
});

test.each([
  'for (let i = 0; i < 2; i++) drawTitle(ui);',
  'drawTitle(ui); drawTitle(ui);',
  '[0, 1].forEach(() => drawTitle(ui));',
])('rejects draw sites that can be shared by several control instances: %s', body => {
  const source = [
    "import { Engine } from 'dino-ge';",
    "function drawTitle(ui) { ui.label({ x: 10, y: 20, text: 'Title' }); }",
    `function drawUI(ui) { ${body} }`,
    'new Engine({ drawUI });',
  ].join('\n');
  expect(getScreenUIMoveEdits(source, 'label', { lineNumber: 2, column: 26 }, { x: 3, y: 5 })).toBeUndefined();
});

test('rejects spread positions and a draw callback that is also called by user code', () => {
  const source = [
    "import { Engine } from 'dino-ge';",
    "function drawUI(ui) { ui.label({ x: 10, y: 20, text: 'Title' }); }",
    'new Engine({ drawUI });',
    'drawUI(otherUi);',
  ].join('\n');
  const offset = { x: 3, y: 5 };
  expect(getScreenUIMoveEdits(source, 'label', { lineNumber: 2, column: 23 }, offset)).toBeUndefined();
  const spread = source.replace('drawUI(otherUi);', '').replace("text: 'Title'", '...options');
  expect(getScreenUIMoveEdits(spread, 'label', { lineNumber: 2, column: 23 }, offset)).toBeUndefined();
});

test('rejects a draft whose draw options no longer match the running call', () => {
  const runtime = [
    "import { Engine } from 'dino-ge';",
    "new Engine({ drawUI(ui) { ui.label({ x: 10, y: 20, text: 'Title' }); } });",
  ].join('\n');
  const position = { lineNumber: 2, column: 27 };
  expect(getScreenUIMoveEdits(runtime, 'label', position, { x: 4, y: 0 })).toBeDefined();
  const draft = runtime.replace('x: 10', 'x: 14');
  expect(getScreenUIMoveEdits(draft, 'label', position, { x: 4, y: 0 }, runtime)).toBeUndefined();
});

test('rejects a recursive draw callback', () => {
  const source = [
    "import { Engine } from 'dino-ge';",
    'new Engine({ drawUI: function draw(ui, depth = 0) {',
    "  ui.label({ x: 10, y: 20, text: 'Title' });",
    '  if (depth < 2) draw(ui, depth + 1);',
    '} });',
  ].join('\n');
  expect(getScreenUIMoveEdits(source, 'label', { lineNumber: 3, column: 3 }, { x: 4, y: 0 })).toBeUndefined();
});

test('keeps a move preview across unrelated edits and restores it through undo and redo', () => {
  type Change = Pick<editor.IModelContentChange, 'rangeOffset' | 'rangeLength' | 'text'>;
  let revision = 2;
  let change: ((event: { changes: Change[] }) => void) | undefined;
  const model = {
    getAlternativeVersionId: () => revision,
    onDidChangeContent(listener: typeof change) {
      change = listener;
      return { dispose: () => { change = undefined; } };
    },
    onWillDispose: () => ({ dispose() {} }),
  } as unknown as editor.ITextModel;
  const applied = jest.fn();
  const reverted = jest.fn();
  trackScreenUIMoveDraft(model, { applied, reverted }, 1, [{ start: 20, end: 22, newText: '100' }]);
  const edit = (version: number, rangeOffset: number, rangeLength: number, text: string) => {
    revision = version;
    change?.({ changes: [{ rangeOffset, rangeLength, text }] });
  };
  expect(applied).toHaveBeenCalledTimes(1);
  edit(3, 0, 0, '// title\n');
  expect(reverted).not.toHaveBeenCalled();
  edit(4, 29, 3, '200');
  expect(reverted).toHaveBeenCalledTimes(1);
  edit(3, 29, 3, '100');
  expect(applied).toHaveBeenCalledTimes(2);
  edit(2, 0, 9, '');
  expect(reverted).toHaveBeenCalledTimes(1);
  edit(1, 20, 3, '20');
  expect(reverted).toHaveBeenCalledTimes(2);
  edit(2, 20, 2, '100');
  expect(applied).toHaveBeenCalledTimes(3);
  window.dispatchEvent(new Event('playground-before-run'));
  expect(change).toBeUndefined();
});

test('resizes a uniquely identified panel in a class method at its shared layout call', () => {
  const source = [
    'class Outpost {',
    '  draw(ui) {',
    "    const card = ui.panel({ x: 10, y: 20, width: Math.min(460, ui.width), height: 300 }, panel, 'outpost-title');",
    '    ui.panel({ ...card, height: 2 }, gold);',
    '  }',
    '}',
  ].join('\n');
  const position = { lineNumber: 3, column: 18 };
  const offset = { x: 0, y: 0, properties: { width: 30, height: 20 } };
  const edits = getScreenUIMoveEdits(source, 'panel', position, offset);
  expect(edits && applyEdits(source, edits)).toBe(source
    .replace('Math.min(460, ui.width)', 'Math.max(1, (Math.min(460, ui.width)) + 30)')
    .replace('height: 300', 'height: 320'));
  const duplicate = source.replace('    ui.panel({ ...card, height: 2 }, gold);',
    "    ui.panel({ ...card, height: 2 }, gold, 'outpost-title');");
  expect(getScreenUIMoveEdits(duplicate, 'panel', position, offset)).toBeUndefined();
  expect(getScreenUIMoveEdits(source.replace('outpost-title', 'other'), 'panel', position, offset, source))
    .toBeUndefined();
});
