import { parse, type AnyNode, type CallExpression, type Position, type Property } from 'acorn';
import type { ScreenUIPropertyChanges } from 'dino-ge';
import type { editor } from 'monaco-editor';
import type { Edit } from './ast-utils';
import type { ScreenUISource } from './screen-ui-preview';

export type ScreenUIControlKind = 'panel' | 'label' | 'image' | 'button' | 'progressBar';

export const applyScreenUIMoveEvent = 'playground-apply-screen-ui-move';
export type ApplyScreenUIMove = {
  location: ScreenUISource;
  offset: ScreenUIEdit;
  trigger: HTMLButtonElement;
  applied: () => void;
  reverted?: () => void;
};

type ScreenUIEdit = { x: number; y: number; properties?: ScreenUIPropertyChanges };
type SourceSpan = { start: number; end: number };
type ScreenUIMoveEdit = Edit & { property?: SourceSpan };

function movedProperties(edits: readonly ScreenUIMoveEdit[]) {
  let offset = 0;
  return [...edits].sort((left, right) => left.start - right.start).map(edit => {
    const property = edit.property ?? edit;
    const change = edit.newText.length - (edit.end - edit.start);
    const span = { start: property.start + offset, end: property.end + offset + change };
    offset += change;
    return span;
  });
}

function trackMovedProperties(spans: readonly SourceSpan[], changes: readonly editor.IModelContentChange[]) {
  const mapped: SourceSpan[] = [];
  for (const span of spans) {
    let offset = 0;
    for (const change of changes) {
      const start = change.rangeOffset;
      const end = start + change.rangeLength;
      if (end < span.start || (change.rangeLength > 0 && end === span.start)) {
        offset += change.text.length - change.rangeLength;
      } else if (start < span.end || (change.rangeLength === 0 && start === span.end)) {
        return;
      }
    }
    mapped.push({ start: span.start + offset, end: span.end + offset });
  }
  return mapped;
}

export function trackScreenUIMoveDraft(
  model: editor.ITextModel, request: Pick<ApplyScreenUIMove, 'applied' | 'reverted'>,
  beforeRevision: number, edits: readonly ScreenUIMoveEdit[],
) {
  let properties: SourceSpan[] | undefined = movedProperties(edits);
  const revisions = new Map<number, SourceSpan[] | undefined>([
    [beforeRevision, undefined], [model.getAlternativeVersionId(), properties],
  ]);
  const content = model.onDidChangeContent(event => {
    const revision = model.getAlternativeVersionId();
    const next = revisions.has(revision) ? revisions.get(revision)
      : properties && trackMovedProperties(properties, event.changes);
    const wasApplied = !!properties;
    properties = next;
    revisions.set(revision, properties);
    if (properties && !wasApplied) request.applied();
    if (!properties && wasApplied) request.reverted?.();
  });
  const close = () => {
    content.dispose();
    disposal.dispose();
    window.removeEventListener('playground-before-run', close);
  };
  const disposal = model.onWillDispose(close);
  window.addEventListener('playground-before-run', close);
  request.applied();
}

interface SourcePosition {
  lineNumber: number;
  column: number;
}

export interface ScreenUISourceLocation extends SourcePosition {
  path: string;
}

interface ScreenUICallLocation extends SourcePosition {
  start: number;
  end: number;
}

function isProjectModule(path: string): boolean {
  return /\.m?js$/.test(path) && path.split('/').every(part =>
    part && !part.startsWith('.') && part !== 'node_modules' &&
    !part.includes('\\') && !Array.from(part).some(character => character < ' '));
}

/** Resolve only the immediate game caller of an engine draw operation. */
export function resolveScreenUISource(stack: string, base: URL, blobEntry?: { url: string; path: string }): ScreenUISourceLocation | undefined {
  const engineBase = new URL('/built/', base);
  let foundEngineFrame = false;
  for (const frame of stack.split('\n')) {
    const match = frame.trimEnd().match(/((?:blob:)?https?:\/\/[^\s]+):(\d+):(\d+)\)?$/);
    if (!match) {
      if (foundEngineFrame) return;
      continue;
    }
    const [, address, line, col] = match;
    if (address.startsWith(engineBase.href)) {
      foundEngineFrame = true;
      continue;
    }
    if (!foundEngineFrame) return;
    const lineNumber = Number(line);
    const column = Number(col);
    if (!Number.isSafeInteger(lineNumber) || !Number.isSafeInteger(column) || lineNumber < 1 || column < 1) return;
    if (blobEntry?.url === address && address.startsWith(`blob:${base.origin}/`) && isProjectModule(blobEntry.path)) {
      return { path: blobEntry.path, lineNumber, column };
    }
    if (!address.startsWith(base.href) || !base.pathname.endsWith('/')) return;
    try {
      const url = new URL(address);
      const segments = url.pathname.slice(base.pathname.length).split('/').map(decodeURIComponent);
      if (segments.some(segment => segment.includes('/'))) return;
      const path = segments.join('/');
      const canonical = new URL(segments.map(encodeURIComponent).join('/'), base);
      if (url.origin === base.origin && address === canonical.href && isProjectModule(path)) {
        return { path, lineNumber, column };
      }
    } catch {
      return;
    }
    return;
  }
}

function inspectSource(source: string, kind: ScreenUIControlKind, includeContext = false) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  const calls: CallExpression[] = [];
  const parents = new Map<AnyNode, AnyNode>();
  const references = new Map<string, AnyNode[]>();
  const visit = (node: AnyNode, parent?: AnyNode) => {
    if (includeContext && parent) parents.set(node, parent);
    if (includeContext && node.type === 'Identifier' &&
        !(parent?.type === 'Property' && !parent.computed && parent.key === node)) {
      const uses = references.get(node.name) ?? [];
      uses.push(node);
      references.set(node.name, uses);
    }
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
      const { computed, property } = node.callee;
      if ((!computed && property.type === 'Identifier' && property.name === kind) ||
        (computed && property.type === 'Literal' && property.value === kind)) calls.push(node);
    }
    for (const value of Object.values(node)) {
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child && typeof child === 'object' && 'type' in child) visit(child as AnyNode, node);
      }
    }
  };
  visit(ast);
  return { ast, calls: calls.sort((a, b) => a.start - b.start), parents, references };
}

function nodeShape(node: AnyNode) {
  return JSON.stringify(node, (key, value: unknown) => {
    if (['start', 'end', 'loc', 'raw'].includes(key)) return undefined;
    return typeof value === 'bigint' ? String(value) : value;
  });
}

function findMatchingCalls(calls: readonly CallExpression[], runtime: readonly CallExpression[], location: SourcePosition) {
  const { lineNumber, column } = location;
  if (!Number.isSafeInteger(lineNumber) || !Number.isSafeInteger(column) || lineNumber < 1 || column < 1) return;
  const compare = (position: Position) => lineNumber - position.line || column - 1 - position.column;
  const matches = runtime.filter(call => call.callee.loc &&
    compare(call.callee.loc.start) >= 0 && compare(call.callee.loc.end) <= 0);
  if (matches.length !== 1 || calls.length !== runtime.length) return;
  const [runningCall] = matches;
  const call = calls[runtime.indexOf(runningCall)];
  if (call !== runningCall && nodeShape(call.callee) !== nodeShape(runningCall.callee)) return;
  return { call, runningCall };
}

/**
 * Verify a location against a source revision. Runtime transforms and trusted
 * formatting can shift positions while preserving the draw calls and their order.
 */
export function findScreenUICall(
  source: string, kind: ScreenUIControlKind, location: SourcePosition, runtimeSource = source,
): ScreenUICallLocation | undefined {
  try {
    const { calls } = inspectSource(source, kind);
    const runtime = source === runtimeSource ? calls : inspectSource(runtimeSource, kind).calls;
    const match = findMatchingCalls(calls, runtime, location);
    const call = match?.call;
    const position = call?.loc?.start;
    if (call && position) return { lineNumber: position.line, column: position.column + 1, start: call.start, end: call.end };
  } catch {
    return;
  }
}

function propertyName(property: Pick<Property, 'key' | 'computed'>) {
  if (!property.computed && property.key.type === 'Identifier') return property.key.name;
  if (property.key.type === 'Literal' && typeof property.key.value === 'string') return property.key.value;
}

type ScreenFunction = Extract<AnyNode, { type: 'FunctionDeclaration' | 'FunctionExpression' | 'ArrowFunctionExpression' }>;

/** Walk only single-execution contexts. Loops, inner callbacks and IIFEs stop the walk. */
function getScreenFunction(node: AnyNode, parents: ReadonlyMap<AnyNode, AnyNode>): ScreenFunction | undefined {
  for (let child = node, parent = parents.get(child); parent; child = parent, parent = parents.get(child)) {
    switch (parent.type) {
      case 'BlockStatement':
      case 'ExpressionStatement':
      case 'ReturnStatement':
        break;
      case 'IfStatement':
        if (child !== parent.test) break;
        return;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        if (child === parent.body && !parent.async && !parent.generator && parent.params[0]?.type === 'Identifier') {
          return parent;
        }
        return;
      default:
        return;
    }
  }
}

function isUniqueScreenDraw(call: CallExpression, scan: ReturnType<typeof inspectSource>) {
  const { ast, parents, references } = scan;
  const importedEngines = new Set<string>();
  const importedNamespaces = new Set<string>();
  for (const statement of ast.body) {
    if (statement.type !== 'ImportDeclaration' || statement.source.value !== 'dino-ge') continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type === 'ImportNamespaceSpecifier') importedNamespaces.add(specifier.local.name);
      if (specifier.type === 'ImportSpecifier' && specifier.imported.type === 'Identifier' &&
          specifier.imported.name === 'Engine') importedEngines.add(specifier.local.name);
    }
  }

  const isTopLevel = (node: AnyNode) => {
    const parent = parents.get(node);
    if (parent?.type === 'Program') return true;
    return parent?.type === 'ExportNamedDeclaration' && parent.declaration === node && parents.get(parent)?.type === 'Program';
  };
  const isEngineCallback = (callback: AnyNode) => {
    const property = parents.get(callback);
    if (property?.type !== 'Property' || property.value !== callback || property.kind !== 'init' ||
        propertyName(property) !== 'drawUI') return false;
    const options = parents.get(property);
    if (options?.type !== 'ObjectExpression' || options.properties.some(field =>
      field.type !== 'Property' || (field.computed && propertyName(field) === undefined)) ||
      options.properties.filter(field => field.type === 'Property' && propertyName(field) === 'drawUI').length !== 1) return false;
    const constructor = parents.get(options);
    if (constructor?.type !== 'NewExpression' || constructor.arguments[0] !== options) return false;
    const callee = constructor.callee;
    if (!(callee.type === 'Identifier' && importedEngines.has(callee.name)) &&
        !(callee.type === 'MemberExpression' && !callee.computed && callee.object.type === 'Identifier' &&
          importedNamespaces.has(callee.object.name) && callee.property.type === 'Identifier' &&
          callee.property.name === 'Engine')) return false;
    const container = parents.get(constructor);
    if (container?.type === 'ExpressionStatement') return isTopLevel(container);
    const declaration = container?.type === 'VariableDeclarator' ? parents.get(container) : undefined;
    return declaration?.type === 'VariableDeclaration' && isTopLevel(declaration);
  };

  const originalFunction = getScreenFunction(call, parents);
  if (!originalFunction || call.callee.type !== 'MemberExpression' || call.callee.object.type !== 'Identifier' ||
      originalFunction.params[0]?.type !== 'Identifier' || call.callee.object.name !== originalFunction.params[0].name) return false;

  const visited = new Set<ScreenFunction>();
  let current: ScreenFunction = originalFunction;
  while (!visited.has(current)) {
    visited.add(current);
    if (current.type === 'FunctionExpression' && current.id &&
        references.get(current.id.name)?.some(use => use !== current.id)) return false;
    if (isEngineCallback(current)) return true;
    if (current.type !== 'FunctionDeclaration' || !current.id || parents.get(current)?.type !== 'Program') return false;
    const uses = references.get(current.id.name)?.filter(use => use !== current.id);
    if (uses?.length !== 1) return false;
    const [use] = uses;
    if (isEngineCallback(use)) return true;
    const helperCall = parents.get(use);
    if (helperCall?.type !== 'CallExpression' || helperCall.callee !== use || helperCall.optional) return false;
    const caller = getScreenFunction(helperCall, parents);
    const argument = helperCall.arguments[0];
    if (!caller || caller.params[0]?.type !== 'Identifier' || argument?.type !== 'Identifier' ||
        caller.params[0].name !== argument.name) return false;
    current = caller;
  }
  return false;
}

const rectangularControls: readonly ScreenUIControlKind[] = ['panel', 'image', 'button', 'progressBar'];
const propertyControls: Record<keyof ScreenUIPropertyChanges, readonly ScreenUIControlKind[]> = {
  width: rectangularControls,
  height: rectangularControls,
  text: ['label', 'button'],
  colour: ['panel', 'label', 'button', 'progressBar'],
  background: ['button', 'progressBar'],
  font: ['label', 'button'],
  enabled: ['button'],
};

/** Rewrite a verified draw call while retaining responsive geometry and game state. */
export function getScreenUIMoveEdits(
  source: string, kind: ScreenUIControlKind, position: SourcePosition, offset: ScreenUIEdit, runtimeSource = source,
): ScreenUIMoveEdit[] | undefined {
  return prepareScreenUIEdits(source, kind, position, runtimeSource)?.(offset);
}

function panelSourceId(call: CallExpression): string | undefined {
  const id = call.arguments[2];
  if (call.arguments.length === 3 && id?.type === 'Literal' && typeof id.value === 'string' && id.value) {
    return id.value;
  }
}

export function prepareScreenUIEdits(
  source: string, kind: ScreenUIControlKind, position: SourcePosition, runtimeSource = source,
): ((offset: ScreenUIEdit) => ScreenUIMoveEdit[] | undefined) | undefined {
  try {
    const scan = inspectSource(source, kind, true);
    const runtime = source === runtimeSource ? scan.calls : inspectSource(runtimeSource, kind).calls;
    const match = findMatchingCalls(scan.calls, runtime, position);
    if (!match) return;
    const id = kind === 'panel' ? panelSourceId(match.runningCall) : undefined;
    if (id) {
      if (panelSourceId(match.call) !== id ||
          scan.calls.filter(call => panelSourceId(call) === id).length !== 1 ||
          runtime.filter(call => panelSourceId(call) === id).length !== 1) return;
    } else if ((kind === 'panel' && match.call.arguments.length > 2) || !isUniqueScreenDraw(match.call, scan)) {
      return;
    }
    return offset => offsetDrawArguments(source, kind, offset, match);
  } catch {
    return;
  }
}

function offsetDrawArguments(
  source: string, kind: ScreenUIControlKind, offset: ScreenUIEdit,
  { call, runningCall }: { call: CallExpression; runningCall: CallExpression },
) {
  const argument = kind === 'image' ? 1 : 0;
  const options = call.arguments[argument];
  if (!options || options.type === 'SpreadElement' || (kind === 'image' &&
      (call.arguments[0]?.type === 'SpreadElement' || runningCall.arguments[0]?.type === 'SpreadElement'))) return;
  if (call !== runningCall && nodeShape(options) !== nodeShape(runningCall.arguments[argument])) return;

  const fields = Object.entries(offset.properties ?? {});
  if (fields.some(([field]) => !Object.prototype.hasOwnProperty.call(propertyControls, field) ||
      !propertyControls[field as keyof ScreenUIPropertyChanges].includes(kind))) return;

  const edits: ScreenUIMoveEdit[] = [];
  const colourField = fields.find(([field]) => field === 'colour');
  if (kind === 'panel' && colourField) {
    const [, colourChange] = colourField;
    const colour = call.arguments[1];
    if (typeof colourChange !== 'string' || colourChange.length > 500 ||
        colour?.type !== 'Literal' || typeof colour.value !== 'string' ||
        nodeShape(colour) !== nodeShape(runningCall.arguments[1])) return;
    if (colour.value !== colourChange) edits.push({ start: colour.start, end: colour.end, newText: JSON.stringify(colourChange) });
  }
  const geometry = { x: offset.x, y: offset.y, width: offset.properties?.width, height: offset.properties?.height };
  if (![offset.x, offset.y].every(Number.isFinite) ||
      [geometry.width, geometry.height].some(delta => delta !== undefined && !Number.isFinite(delta))) return;
  if (kind === 'panel' && !Object.values(geometry).some(Boolean)) return edits.length ? edits : undefined;
  if (options.type !== 'ObjectExpression' || options.properties.some(property =>
    property.type !== 'Property' || (property.computed && propertyName(property) === undefined))) return;
  const properties = options.properties.filter((property): property is Property => property.type === 'Property');
  for (const axis of ['x', 'y', 'width', 'height'] as const) {
    const delta = geometry[axis];
    if (!delta) continue;
    const matches = properties.filter(property => propertyName(property) === axis);
    if (matches.length !== 1 || matches[0].kind !== 'init' || matches[0].method) return;
    const property = matches[0];
    const { value } = property;
    const original = numericLiteral(value);
    let newValue: string;
    if (original === undefined) {
      newValue = `(${source.slice(value.start, value.end)}) ${delta > 0 ? '+' : '-'} ${Math.abs(delta)}`;
      if (axis === 'width' || axis === 'height') newValue = `Math.max(1, ${newValue})`;
    } else {
      const adjusted = original + delta;
      if (!Number.isFinite(adjusted) || ((axis === 'width' || axis === 'height') && (original < 0 || adjusted < 1))) return;
      newValue = String(adjusted);
    }
    const span = { start: property.start, end: property.end };
    edits.push(property.shorthand
      ? { ...span, newText: `${axis}: ${newValue}`, property: span }
      : { start: value.start, end: value.end, newText: newValue, property: span });
  }

  const defaults: string[] = [];
  for (const [field, value] of fields) {
    if (field === 'width' || field === 'height' || (kind === 'panel' && field === 'colour')) continue;
    if (field === 'enabled' ? typeof value !== 'boolean' : (typeof value !== 'string' || value.length > 500)) return;
    const newText = JSON.stringify(value);
    const matches = properties.filter(property => propertyName(property) === field);
    if (!matches.length) {
      if (field === 'text') return;
      defaults.push(`${field}: ${newText}`);
      continue;
    }
    const [property] = matches;
    const original = property.value;
    if (matches.length !== 1 || property.kind !== 'init' || property.method ||
        original.type !== 'Literal' || typeof original.value !== typeof value) return;
    if (original.value !== value) edits.push({
      start: original.start, end: original.end, newText,
      property: { start: property.start, end: property.end },
    });
  }
  if (defaults.length) {
    const last = properties[properties.length - 1];
    const insert = last?.end ?? options.start + 1;
    edits.push({ start: insert, end: insert, newText: `${last ? ', ' : ''}${defaults.join(', ')}` });
  }
  return edits.length ? edits : undefined;
}

function numericLiteral(value: Property['value']): number | undefined {
  if (value.type === 'Literal' && typeof value.value === 'number') return value.value;
  if (value.type === 'UnaryExpression' && (value.operator === '+' || value.operator === '-') &&
      value.argument.type === 'Literal' && typeof value.argument.value === 'number') {
    return value.operator === '-' ? -value.argument.value : value.argument.value;
  }
}
