import { parse, type AnyNode, type CallExpression, type Position } from 'acorn';

export type ScreenUIControlKind = 'panel' | 'label' | 'image' | 'button' | 'progressBar';

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

function getDrawCalls(source: string, kind: ScreenUIControlKind): CallExpression[] {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  const calls: CallExpression[] = [];
  const visit = (node: AnyNode) => {
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
      const { computed, property } = node.callee;
      if ((!computed && property.type === 'Identifier' && property.name === kind) ||
        (computed && property.type === 'Literal' && property.value === kind)) calls.push(node);
    }
    for (const value of Object.values(node)) {
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child && typeof child === 'object' && 'type' in child) visit(child as AnyNode);
      }
    }
  };
  visit(ast);
  return calls.sort((a, b) => a.start - b.start);
}

function calleeShape(call: CallExpression) {
  return JSON.stringify(call.callee, (key, value: unknown) => {
    if (['start', 'end', 'loc', 'raw'].includes(key)) return undefined;
    return typeof value === 'bigint' ? String(value) : value;
  });
}

/**
 * Verify a location against a source revision. Runtime transforms and trusted
 * formatting can shift positions while preserving the draw calls and their order.
 */
export function findScreenUICall(
  source: string, kind: ScreenUIControlKind, location: SourcePosition, runtimeSource = source,
): ScreenUICallLocation | undefined {
  const { lineNumber, column } = location;
  if (!Number.isSafeInteger(lineNumber) || !Number.isSafeInteger(column) || lineNumber < 1 || column < 1) return;
  const compare = (position: Position) => lineNumber - position.line || column - 1 - position.column;
  try {
    const runtimeCalls = getDrawCalls(runtimeSource, kind);
    const matches = runtimeCalls.filter(call => call.callee.loc &&
      compare(call.callee.loc.start) >= 0 && compare(call.callee.loc.end) <= 0);
    if (matches.length !== 1) return;
    let call = matches[0];
    if (source !== runtimeSource) {
      const originalCalls = getDrawCalls(source, kind);
      if (originalCalls.length !== runtimeCalls.length) return;
      const original = originalCalls[runtimeCalls.indexOf(call)];
      if (calleeShape(original) !== calleeShape(call)) return;
      call = original;
    }
    const position = call.loc?.start;
    if (position) return { lineNumber: position.line, column: position.column + 1, start: call.start, end: call.end };
  } catch {
    return;
  }
}
