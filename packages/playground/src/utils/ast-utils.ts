import * as acorn from 'acorn';
import { Vector2 } from 'dino-ge';
import { getSceneShapeOptionLines, sceneObjectKinds, sceneSourceKey, type CanvasTransformChange, type SceneObjectPlacement, type ScenePoint } from './scene-objects';

export interface PropertyLocation {
  nodeStart: number;
  nodeEnd: number;
  valueStart: number;
  valueEnd: number;
  numeric: boolean;
  // For special types like Vector2
  args?: Array<{ start: number, end: number, numeric: boolean }>;
  vectorConstructor?: string;
  // For nested objects
  properties?: Record<string, PropertyLocation>;
}

export interface ObjectSourceMapping {
  sourceId: string;
  type: string;
  literalTag?: string;
  start: number;
  end: number;
  // Boundaries of the ObjectExpression { ... }
  contentStart: number;
  contentEnd: number;
  vectorConstructor?: string;
  hasDynamicProperties: boolean;
  properties: Record<string, PropertyLocation>;
  standalone?: { start: number; end: number; options?: Record<string, unknown>; canDuplicate: boolean };
}

type SourceMappings = Record<string, ObjectSourceMapping>;
let sourceMappingRegistry: SourceMappings = {};

/**
 * Resets the source mapping registry.
 */
export const resetSourceMapping = () => {
  sourceMappingRegistry = {};
};

/**
 * Gets the source mapping registry.
 */
export const getSourceMapping = () => sourceMappingRegistry;

export function getUniqueObjectSourceMapping(sourceId: string, mappings = sourceMappingRegistry) {
  const group = sourceId.slice(0, sourceId.lastIndexOf('-') + 1);
  if (Object.keys(mappings).some(id => id !== sourceId && id.startsWith(group) && /^\d+$/.test(id.slice(group.length)))) return;
  return mappings[sourceId];
}

const isTagProperty = (prop: any) => prop.type === 'Property' && !prop.computed &&
  (prop.key.name === 'tag' || prop.key.value === 'tag');

/**
 * Recursively maps properties of an ObjectExpression.
 */
const mapProperties = (objExpr: any, imports: DinoImports, code: string, strict = false): Record<string, PropertyLocation> => {
  const mapping: Record<string, PropertyLocation> = {};
  if (!objExpr || objExpr.type !== 'ObjectExpression') return mapping;

  objExpr.properties.forEach((prop: any) => {
    if (prop.key?.type === 'Identifier' || isTagProperty(prop)) {
      const isNumeric = (node: any): boolean =>
        (node.type === 'Literal' && typeof node.value === 'number') ||
        (node.type === 'UnaryExpression' && ['-', '+'].includes(node.operator) &&
          node.argument.type === 'Literal' && typeof node.argument.value === 'number');
      const propLoc: PropertyLocation = {
        nodeStart: prop.start,
        nodeEnd: prop.end,
        valueStart: prop.value.start,
        valueEnd: prop.value.end,
        numeric: isNumeric(prop.value),
      };

      // Handle Vector2 instantiations
      if (prop.value.type === 'NewExpression' && (resolveDinoImport(prop.value.callee, imports)?.name === 'Vector2' ||
          (!strict && (prop.value.callee.name === 'Vector2' || prop.value.callee.property?.name === 'Vector2')))) {
        propLoc.vectorConstructor = code.slice(prop.value.callee.start, prop.value.callee.end);
        propLoc.args = prop.value.arguments.map((arg: any) => ({
          start: arg.start,
          end: arg.end,
          numeric: isNumeric(arg),
        }));
      }

      // Handle nested objects
      if (prop.value.type === 'ObjectExpression') {
        propLoc.properties = mapProperties(prop.value, imports, code, strict);
      }

      mapping[prop.key.name ?? prop.key.value] = propLoc;
    }
  });

  return mapping;
};

interface ScopedBinding {
  identifier: acorn.Identifier;
  scope: acorn.Node;
}

type ScopedBindings = Map<string, ScopedBinding[]>;

interface DinoImports {
  named: Map<string, string>;
  namespaces: ScopedBindings;
  namedShadows: ScopedBindings;
}

function collectBindingScopes(ast: acorn.Program, bindings: ScopedBindings) {
  const bind = (pattern: acorn.Pattern | null | undefined, scope: acorn.Node) => {
    if (pattern?.type === 'Identifier') bindings.get(pattern.name)?.push({ identifier: pattern, scope });
    else if (pattern?.type === 'RestElement') bind(pattern.argument, scope);
    else if (pattern?.type === 'AssignmentPattern') bind(pattern.left, scope);
    else if (pattern?.type === 'ArrayPattern') pattern.elements.forEach(element => bind(element, scope));
    else if (pattern?.type === 'ObjectPattern') pattern.properties.forEach(property =>
      bind(property.type === 'RestElement' ? property.argument : property.value, scope));
  };
  const visit = (node: acorn.AnyNode, block: acorn.Node, variableScope: acorn.Node) => {
    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') bind(node.id, block);
    switch (node.type) {
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        block = node;
        variableScope = node.body;
        if (node.type !== 'ArrowFunctionExpression') bind(node.id, block);
        node.params.forEach(param => bind(param, block));
        break;
      case 'ClassDeclaration':
      case 'ClassExpression':
        block = node;
        bind(node.id, block);
        break;
      case 'StaticBlock':
        variableScope = node;
        block = node;
        break;
      case 'CatchClause':
        block = node;
        bind(node.param, block);
        break;
      case 'BlockStatement':
      case 'SwitchStatement':
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement':
        block = node;
        break;
      case 'VariableDeclaration':
        node.declarations.forEach(declaration => bind(declaration.id, node.kind === 'var' ? variableScope : block));
        break;
    }
    for (const value of Object.values(node)) {
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child && typeof child === 'object' && 'type' in child) visit(child as acorn.AnyNode, block, variableScope);
      }
    }
  };
  visit(ast, ast, ast);
}

function dinoImports(ast: acorn.Program, checkNamedShadows = false): DinoImports {
  const named = new Map<string, string>();
  const namespaces: ScopedBindings = new Map();
  const namedShadows: ScopedBindings = new Map();
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration' || node.source.value !== 'dino-ge') continue;
    for (const specifier of node.specifiers) {
      if (specifier.type === 'ImportSpecifier' && specifier.imported.type === 'Identifier') {
        named.set(specifier.local.name, specifier.imported.name);
        if (checkNamedShadows) namedShadows.set(specifier.local.name, []);
      } else if (specifier.type === 'ImportNamespaceSpecifier') {
        namespaces.set(specifier.local.name, []);
      }
    }
  }
  if (namespaces.size || namedShadows.size) collectBindingScopes(ast, new Map([...namespaces, ...namedShadows]));
  return { named, namespaces, namedShadows };
}

function resolveDinoImport(reference: acorn.Expression | acorn.Super | null | undefined, imports: DinoImports) {
  if (reference?.type === 'Identifier') {
    if (imports.namedShadows.get(reference.name)?.some(({ scope }) => reference.start >= scope.start && reference.end <= scope.end)) return;
    const name = imports.named.get(reference.name);
    return name ? { name } : undefined;
  }
  if (reference?.type !== 'MemberExpression' || reference.object.type !== 'Identifier') return;
  const namespace = reference.object.name;
  const shadows = imports.namespaces.get(namespace);
  if (!shadows || shadows.some(({ scope }) => reference.start >= scope.start && reference.end <= scope.end)) return;
  const { property, computed } = reference;
  if (!computed && property.type === 'Identifier') return { name: property.name, namespace };
  if (computed && property.type === 'Literal' && typeof property.value === 'string') return { name: property.value, namespace };
}

function sceneDeclarations(ast: acorn.Program, imports: DinoImports) {
  return ast.body.flatMap(node => {
    const declaration = node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration'
      ? node.declaration : node;
    return declaration?.type === 'ClassDeclaration' && declaration.id &&
      resolveDinoImport(declaration.superClass, imports)?.name === 'Scene'
      ? [declaration] : [];
  });
}

function readSceneObjectOptions(node: acorn.ObjectExpression, imports: DinoImports, reuseSpriteImage: boolean) {
  const readOptions = (node: any, root = false): Record<string, unknown> => {
    if (node.type !== 'ObjectExpression') throw new Error('Expected constructor options');
    const options = new Map<string, unknown>();
    for (const prop of node.properties) {
      if (prop.type !== 'Property' || prop.kind !== 'init' || prop.computed || prop.key.type !== 'Identifier' ||
          options.has(prop.key.name) || prop.key.name === '__proto__') throw new Error('Unsupported option');
      const key = prop.key.name;
      if (root && reuseSpriteImage && key === 'img') {
        options.set(key, undefined); // The copy uses the original sprite's loaded image.
      } else {
        options.set(key, readValue(prop.value));
      }
    }
    return Object.fromEntries(options);
  };
  const readValue = (node: any): unknown => {
    if (node.type === 'Literal' && ['number', 'boolean', 'string'].includes(typeof node.value)) return node.value;
    if (node.type === 'UnaryExpression' && ['-', '+'].includes(node.operator) &&
        node.argument.type === 'Literal' && typeof node.argument.value === 'number') {
      return node.operator === '-' ? -node.argument.value : node.argument.value;
    }
    if (node.type === 'ObjectExpression') return readOptions(node);
    if (node.type === 'NewExpression' && resolveDinoImport(node.callee, imports)?.name === 'Vector2') {
      const [x, y] = node.arguments.map(readValue);
      if (node.arguments.length === 2 && typeof x === 'number' && typeof y === 'number') return new Vector2(x, y);
    }
    throw new Error('Unsupported option value');
  };

  try {
    return readOptions(node, true);
  } catch {
    return undefined;
  }
}

function getStandaloneConstructor(statement: acorn.ExpressionStatement, imports: DinoImports) {
  const { expression } = statement;
  const callee = expression.type === 'CallExpression' ? expression.callee : undefined;
  const isPlay = callee?.type === 'MemberExpression' && !callee.computed &&
    callee.property.type === 'Identifier' && callee.property.name === 'play' &&
    expression.type === 'CallExpression' && !expression.arguments.length;
  const constructor = isPlay ? callee.object : expression;
  if (constructor.type !== 'NewExpression' || constructor.arguments.length !== 1) return;
  const type = resolveDinoImport(constructor.callee, imports)?.name;
  const options = constructor.arguments[0];
  if (options.type !== 'ObjectExpression' ||
      !(isPlay ? type === 'Sprite' : sceneObjectKinds.some(kind => kind === type))) return;
  return constructor;
}

export interface InstrumentationResult {
  code: string;
  error?: string;
}

/** Preserves the entry's file location when the Playground loads it from a Blob. */
export function rebaseModule(code: string, moduleUrl: URL, runtimeUrl: string, run: number): string {
  const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  const replacements: Edit[] = [];
  const identifiers = new Set<string>();
  const dynamicImports: { start: number; end: number }[] = [];
  const pathSpecifier = /^(?:\.{1,2}\/|\/)/;
  const base = JSON.stringify(moduleUrl.href);
  const visit = (node: any) => {
    if (node.type === 'Identifier') identifiers.add(node.name);
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type)) {
      const source = node.source;
      if (node.type === 'ImportExpression' && source &&
          (typeof source.value !== 'string' || pathSpecifier.test(source.value))) {
        dynamicImports.push(source);
      } else if (typeof source?.value === 'string' && pathSpecifier.test(source.value)) {
        replacements.push({
          start: source.start, end: source.end,
          newText: JSON.stringify(new URL(source.value, moduleUrl).href),
        });
      }
    }
    for (const child of Object.values(node)) {
      for (const item of Array.isArray(child) ? child : [child]) {
        if (item && typeof item === 'object' && 'type' in item) visit(item);
      }
    }
  };
  visit(ast);
  let runtime = '__dinoModuleRuntime';
  while (identifiers.has(runtime)) runtime += '_';
  for (const { start, end } of dynamicImports) {
    // Wrap only the expression so nested imports can still be rewritten.
    replacements.push({ start, end: start, newText: `${runtime}.dynamicSpecifier((` },
      { start: end, end, newText: `), ${base})` });
  }
  for (const edit of replacements.sort((a, b) => b.start - a.start || b.end - a.end)) {
    code = code.slice(0, edit.start) + edit.newText + code.slice(edit.end);
  }
  const prepare = `import * as ${runtime} from ${JSON.stringify(runtimeUrl)}; ${runtime}.prepare(import.meta, ${base}, ${run}); `;
  // Keep the source line numbers and leave a hashbang at the beginning of the module.
  const hashbang = code.match(/^#![^\r\n\u2028\u2029]*(?:\r\n?|[\n\u2028\u2029]|$)/)?.[0];
  if (!hashbang) return prepare + code;
  return hashbang + (/[\r\n\u2028\u2029]$/.test(hashbang) ? '' : '\n') + prepare + code.slice(hashbang.length);
}

/**
 * Instruments the provided code by injecting __sourceId into Dino GE object instantiations.
 * Also builds the source mapping registry.
 */
export const instrumentCode = (code: string, trackEditorSource = true, scriptId?: string,
  mappings?: SourceMappings, strict = !!mappings): InstrumentationResult => {
  if (trackEditorSource && !mappings) {
    resetSourceMapping();
    mappings = sourceMappingRegistry;
  }
  const occurrenceCounts: Record<string, number> = {};
  
  // Parse code to AST
  let ast: any;
  try {
    ast = acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
    });
  } catch (err: any) {
    console.warn('AST Parse failed during instrumentation:', err);
    return { code, error: err.message || 'Syntax Error' };
  }

  const imports = dinoImports(ast, strict);
  const injections: Edit[] = [];
  if (scriptId) {
    for (const scene of sceneDeclarations(ast, imports)) {
      const start = scene.body.start + 1;
      const metadata = { scriptId, className: scene.id!.name };
      injections.push({ start, end: start, newText: `static ${sceneSourceKey} = ${JSON.stringify(metadata)};` });
    }
  }

  const knownClasses = ['Sprite', 'Rectangle', 'Circle', 'Line', 'Text', 'Tilemap'];
  const getGameObject = (node: any) => {
    if (node.arguments[0]?.type !== 'ObjectExpression') return;
    const imported = resolveDinoImport(node.callee, imports);
    if (strict && (!imported || !knownClasses.includes(imported.name))) return;
    if (imported?.namespace && knownClasses.includes(imported.name)) {
      return { constructorName: `${imported.namespace}.${imported.name}`, type: imported.name, namespace: imported.namespace };
    }
    if (node.callee.type !== 'Identifier') return;
    const constructorName = node.callee.name;
    const type = imported?.name ?? constructorName;
    // Keep tracking tagged constructor calls written with a bare identifier.
    const hasTag = node.arguments[0].properties.some(isTagProperty);
    if (knownClasses.includes(type) || hasTag) return { constructorName, type };
  };

  const standaloneStatements = new Map<number, acorn.ExpressionStatement>();
  const walk = (node: any, parent?: any) => {
    if (!node) return;
    if (trackEditorSource && node.type === 'ExpressionStatement' && ['Program', 'BlockStatement'].includes(parent?.type)) {
      const constructor = getStandaloneConstructor(node, imports);
      if (constructor) standaloneStatements.set(constructor.start, node);
    }

    if (node.type === 'NewExpression') {
      const args = node.arguments;
      
      const object = getGameObject(node);
      if (object) {
        const props = args[0].properties;
        
        // Deterministic ID based on type, tag, and occurrence
        const tagProp = props.findLast(isTagProperty);
        const tagValue = (tagProp && tagProp.value.type === 'Literal') ? String(tagProp.value.value) : 'no-tag';
        const { constructorName, type, namespace } = object;
        const idKey = `${constructorName}-${tagValue}`;
        const index = occurrenceCounts[idKey] || 0;
        occurrenceCounts[idKey] = index + 1;
        const sourceId = `${idKey}-${index}`;
        
        // Record property locations (using original offsets)
        if (mappings) {
          const properties = mapProperties(args[0], imports, code, strict);
          const statement = standaloneStatements.get(node.start);
          const generated = !namespace && constructorName.startsWith('DinoPlace');
          const options = statement && readSceneObjectOptions(args[0], imports, generated && type === 'Sprite');
          const safeOptions = options && (generated || type !== 'Sprite' || typeof options.img === 'string');
          const canDuplicate = !!safeOptions && typeof options.tag === 'string' && properties.position?.args?.length === 2 &&
            properties.position.args.every(arg => arg.numeric);
          mappings[sourceId] = {
            sourceId, type, start: node.start, end: node.end,
            literalTag: typeof tagProp?.value?.value === 'string' ? tagProp.value.value : undefined,
            contentStart: args[0].start + 1, // After {
            contentEnd: args[0].end - 1,    // Before }
            vectorConstructor: namespace && `${namespace}.Vector2`,
            hasDynamicProperties: props.some((prop: any) => prop.type !== 'Property' || prop.computed ||
              (strict ? prop.kind !== 'init' || prop.key.type !== 'Identifier' : prop.key.type === 'Literal' && prop.key.value === 'position')),
            properties,
            standalone: statement && (generated || safeOptions) ? {
              start: statement.start, end: statement.end, options, canDuplicate,
            } : undefined,
          };
        }

        // Inject __sourceId into the object literal in the instrumented version
        const injection = `__sourceId: ${JSON.stringify(sourceId)}, `;
        const start = args[0].start + 1;
        injections.push({ start, end: start, newText: injection });
      }
    }

    // Recurse into children
    for (const key in node) {
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach(item => walk(item, node));
      } else if (child && typeof child === 'object' && child.type) {
        walk(child, node);
      }
    }
  };

  walk(ast);
  let instrumentedCode = code;
  for (const { start, newText } of injections.sort((a, b) => b.start - a.start)) {
    instrumentedCode = instrumentedCode.slice(0, start) + newText + instrumentedCode.slice(start);
  }
  return { code: instrumentedCode };
};

export interface Edit {
  start: number;
  end: number;
  newText: string;
}

export function getSourceOffset(source: string, lineNumber: number, column: number): number | undefined {
  let line = 1;
  let start = 0;
  for (const newline of source.matchAll(/\r\n|[\r\n\u2028\u2029]/g)) {
    if (line === lineNumber) return column > 0 && start + column - 1 <= newline.index ? start + column - 1 : undefined;
    start = newline.index + newline[0].length;
    line++;
  }
  if (line === lineNumber && column > 0 && start + column - 1 <= source.length) return start + column - 1;
}

export function mapSourceOffset(offset: number, edits: readonly Edit[]): number | undefined {
  let mapped = offset;
  for (const { start, end, newText } of edits) {
    if (offset >= end) mapped += newText.length - (end - start);
    else if (offset >= start) return;
  }
  return mapped;
}

export function applyEditsToSource(source: string, edits: Edit[]): string | undefined {
  let boundary = source.length;
  for (const { start, end, newText } of [...edits].sort((a, b) => b.start - a.start || b.end - a.end)) {
    if (start < 0 || end < start || end > boundary) return;
    source = source.slice(0, start) + newText + source.slice(end);
    boundary = start;
  }
  return source;
}

export function readObjectSourceMappings(source: string, strict = true): SourceMappings | undefined {
  const mappings: SourceMappings = {};
  return instrumentCode(source, true, undefined, mappings, strict).error ? undefined : mappings;
}

export function findObjectConstructor(mappings: SourceMappings, source: string, line: number, column: number) {
  const offset = getSourceOffset(source, line, column);
  if (offset === undefined) return;
  return Object.values(mappings).find(mapping => mapping.start <= offset && offset < mapping.contentStart);
}

export interface CanvasPlacementTransaction {
  edits: Edit[];
  transforms: CanvasTransformChange[];
}

/** Read source capabilities for one unambiguous standalone constructor. */
export function getStandaloneSceneObject(sourceId: string) {
  const mapping = getUniqueObjectSourceMapping(sourceId);
  if (!mapping?.standalone) return null;
  return { statement: mapping.standalone, mapping };
}

export function getSceneObjectRename(source: string, sourceId: string, tag: string) {
  const mapping = getUniqueObjectSourceMapping(sourceId);
  if (!mapping || mapping.hasDynamicProperties) return;
  const edit = getSurgicalEdit(sourceId, 'tag', tag, () => undefined);
  if (!edit) return;
  const updated = applyEditsToSource(source, [edit]);
  if (updated === undefined) return;
  const mappings = readObjectSourceMappings(updated, false);
  const replacement = mappings && Object.values(mappings).find(item => item.start === mapping.start && item.literalTag === tag);
  if (!replacement || !getUniqueObjectSourceMapping(replacement.sourceId, mappings)) return;
  return { edit, sourceId: replacement.sourceId, previousTag: mapping.literalTag };
}

function findStandaloneSceneObject(source: string, sourceId: string) {
  if (instrumentCode(source).error) return null;
  return getStandaloneSceneObject(sourceId);
}

export function getSceneObjectDeletion(source: string, sourceId: string): Edit | null {
  const match = findStandaloneSceneObject(source, sourceId);
  if (!match) return null;
  const { statement } = match;
  const lineStart = source.lastIndexOf('\n', statement.start - 1) + 1;
  const lineEnd = source.indexOf('\n', statement.end);
  if (lineEnd >= 0 && !source.slice(lineStart, statement.start).trim() &&
      !source.slice(statement.end, lineEnd).trim()) {
    return { start: lineStart, end: lineEnd + 1, newText: '' };
  }
  return { start: statement.start, end: statement.end, newText: '' };
}

const spriteImageExpression = (source: string) => `Object.assign(new Image(), { src: ${source} })`;

export function getSpriteImageReplacement(source: string, sourceId: string, imageSource: string): Edit | null {
  if (!sourceId.startsWith('DinoPlace')) return null;
  const match = findStandaloneSceneObject(source, sourceId);
  const img = match?.mapping.properties.img;
  if (match?.mapping.type !== 'Sprite' || !img) return null;
  return { start: img.valueStart, end: img.valueEnd, newText: spriteImageExpression(imageSource) };
}

/** Copy the constructor's static options without evaluating the game script. */
export function getSceneObjectDuplication(source: string, sourceId: string, x: number, y: number) {
  const match = findStandaloneSceneObject(source, sourceId);
  if (!match || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const { statement, mapping } = match;
  const { options, canDuplicate } = statement;
  const { tag, position } = mapping.properties;
  if (!canDuplicate || typeof options?.tag !== 'string' || !tag || !position?.args) return null;
  const base = `${options.tag} copy`;
  let newTag = base;
  for (let i = 2; source.includes(newTag); i++) newTag = `${base} ${i}`;
  const [argX, argY] = position.args;
  const changes = [
    { start: tag.valueStart, end: tag.valueEnd, newText: JSON.stringify(newTag) },
    { ...argX, newText: String(x) },
    { ...argY, newText: String(y) },
  ];
  let copy = source.slice(statement.start, statement.end);
  for (const change of changes.sort((a, b) => b.start - a.start)) {
    copy = copy.slice(0, change.start - statement.start) + change.newText + copy.slice(change.end - statement.start);
  }
  const lineStart = source.lastIndexOf('\n', statement.start - 1) + 1;
  const indent = source.slice(lineStart, statement.start).match(/^\s*/)?.[0] ?? '';
  const lineEnd = source.indexOf('\n', statement.end);
  const suffix = source.slice(statement.end, lineEnd < 0 ? source.length : lineEnd).trim();
  const insertion = lineEnd >= 0 && (!suffix || suffix.startsWith('//')) ? lineEnd : statement.end;
  const alias = sourceId.slice(0, sourceId.indexOf('-'));
  return {
    edit: { start: insertion, end: insertion, newText: `\n${indent}${copy}` },
    tag: newTag, sourceId: `${alias}-${newTag}-0`, type: mapping.type, options,
  };
}

/** Find the end of the placement block generated around a setup callback. */
function getPlacedObjectInsertion(callback: acorn.Expression | undefined): number | undefined {
  if (callback?.type !== 'CallExpression' || callback.arguments.length !== 1) return;
  const factory = callback.callee;
  if (factory.type !== 'ArrowFunctionExpression' || factory.params.length !== 1 ||
      factory.params[0].type !== 'Identifier' || factory.params[0].name !== 'DinoPlaceSetup' ||
      factory.body.type !== 'FunctionExpression' || factory.body.id?.name !== 'DinoPlaceLoad') return;
  const finalStatement = factory.body.body.body.at(-1);
  if (finalStatement?.type === 'ReturnStatement' &&
      finalStatement.argument?.type === 'Identifier' && finalStatement.argument.name === 'DinoPlaceResult') {
    return finalStatement.start;
  }
}

/** Edit a local callback object only when its binding belongs exclusively to this Engine call. */
function getLocalEngineConfiguration(ast: acorn.Program, argument: acorn.Identifier) {
  const bindings: ScopedBinding[] = [];
  collectBindingScopes(ast, new Map([[argument.name, bindings]]));
  bindings.sort((a, b) => (a.scope.end - a.scope.start) - (b.scope.end - b.scope.start));
  const bindingAt = (node: acorn.Node) => bindings.find(({ scope }) => node.start >= scope.start && node.end <= scope.end);
  const binding = bindingAt(argument);
  if (!binding) return;

  let configuration: acorn.ObjectExpression | undefined;
  let shared = false;
  const visit = (node: acorn.AnyNode, parent?: acorn.AnyNode) => {
    if (node.type === 'VariableDeclaration' && node.kind === 'const') {
      const declaration = node.declarations.find(item => item.id === binding.identifier);
      if (declaration?.init?.type === 'ObjectExpression') {
        if (parent?.type === 'ExportNamedDeclaration') shared = true;
        else configuration = declaration.init;
      }
    }
    if (node.type === 'Identifier' && node.name === argument.name && node !== argument &&
        node !== binding.identifier && bindingAt(node) === binding) {
      const propertyName = (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) ||
        (parent?.type === 'Property' && parent.key === node && !parent.computed && !parent.shorthand);
      if (!propertyName) shared = true;
    }
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'eval' &&
        bindingAt(node) === binding) shared = true;
    if (shared) return;
    for (const value of Object.values(node)) {
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child && typeof child === 'object' && 'type' in child) visit(child as acorn.AnyNode, node);
      }
    }
  };
  visit(ast);
  return shared ? undefined : configuration;
}

/** Adds a constructor to the active setup, or to a standalone script when requested. */
export function getSceneObjectCreation(source: string, placement: SceneObjectPlacement, allowStandalone = false) {
  let ast: acorn.Program;
  try {
    ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch {
    return null;
  }
  const imports = dinoImports(ast);
  const isOnLoad = (key: acorn.Node) =>
    (key.type === 'Identifier' && (key as acorn.Identifier).name === 'onLoad') ||
    (key.type === 'Literal' && (key as acorn.Literal).value === 'onLoad');
  let callback: acorn.Expression | undefined;
  let engineHook: acorn.Property | undefined;
  let insertion: number | undefined;
  if (placement.scene) {
    const scene = sceneDeclarations(ast, imports).find(item => item.id?.name === placement.scene?.className);
    if (!scene || scene.body.body.some(member => 'computed' in member && member.computed)) return null;
    const hooks = scene.body.body.filter(member => 'key' in member && !member.static && isOnLoad(member.key));
    if (hooks.length > 1) return null;
    const [hook] = hooks;
    if (hook && (hook.type !== 'MethodDefinition' || hook.kind !== 'method')) return null;
    callback = hook?.value;
    insertion = scene.body.start + 1;
  } else {
    const engines: acorn.NewExpression[] = [];
    const visit = (node: acorn.AnyNode) => {
      if (node.type === 'NewExpression' && resolveDinoImport(node.callee, imports)?.name === 'Engine') engines.push(node);
      for (const value of Object.values(node)) {
        for (const child of Array.isArray(value) ? value : [value]) {
          if (child && typeof child === 'object' && 'type' in child) visit(child as acorn.AnyNode);
        }
      }
    };
    visit(ast);
    if (engines.length === 1) {
      const [argument] = engines[0].arguments;
      const config = argument?.type === 'Identifier' ? getLocalEngineConfiguration(ast, argument)
        : argument?.type === 'ObjectExpression' ? argument : undefined;
      if (!config || config.properties.some(prop => prop.type !== 'Property' || prop.computed ||
          (prop.key.type === 'Identifier' && prop.key.name === '__proto__') ||
          (prop.key.type === 'Literal' && prop.key.value === '__proto__'))) return null;
      const hooks = config.properties.filter((prop): prop is acorn.Property => prop.type === 'Property' && isOnLoad(prop.key));
      if (hooks.length > 1 || (hooks[0] && hooks[0].kind !== 'init')) return null;
      engineHook = hooks[0];
      callback = engineHook?.value;
      insertion = config.start + 1;
    } else if (engines.length || !allowStandalone) return null;
  }
  const wrappedInsertion = getPlacedObjectInsertion(callback);
  const body = callback?.type === 'ArrowFunctionExpression' || callback?.type === 'FunctionExpression' ? callback.body : undefined;
  const callbackToWrap = callback?.type === 'Identifier' || callback?.type === 'MemberExpression' ||
    (callback?.type === 'ArrowFunctionExpression' && callback.body.type !== 'BlockStatement') ? callback : undefined;
  if (callback && body?.type !== 'BlockStatement' && !callbackToWrap && wrappedInsertion === undefined) return null;

  const addedImports: string[] = [];
  const binding = (name: string) => {
    const existing = Array.from(imports.named).find(([local, exported]) => exported === name && local.startsWith('DinoPlace'));
    if (existing) return existing[0];
    const base = `DinoPlace${name}`;
    let local = base;
    for (let i = 2; source.includes(local); i++) local = `${base}${i}`;
    addedImports.push(`${name} as ${local}`);
    return local;
  };
  const constructor = binding(placement.kind);
  const vector = binding('Vector2');
  let tag = placement.tag;
  for (let i = 2; source.includes(tag); i++) tag = `${placement.tag} ${i}`;
  const options = placement.kind === 'Sprite'
    ? `img: ${spriteImageExpression(placement.asset.source)}, rows: 1, cols: 1, scale: new ${vector}(${placement.asset.scale}, ${placement.asset.scale})`
    : getSceneShapeOptionLines(placement.kind, vector).join(', ');
  const registration = placement.kind === 'Sprite' ? '.play()' : '';
  const statement = `new ${constructor}({ tag: ${JSON.stringify(tag)}, position: new ${vector}(${placement.x}, ${placement.y}), ${options} })${registration};`;
  const edits: Edit[] = [];
  if (wrappedInsertion !== undefined) {
    const lineStart = source.lastIndexOf('\n', wrappedInsertion - 1) + 1;
    const indent = source.slice(lineStart, wrappedInsertion).match(/^[ \t]*/)?.[0] ?? '';
    edits.push({ start: wrappedInsertion, end: wrappedInsertion, newText: `${statement}\n${indent}` });
  } else if (callbackToWrap && engineHook) {
    // Capture the original callback at configuration time. Arrows keep their lexical receiver.
    const original = source.slice(callbackToWrap.start, callbackToWrap.end);
    const isArrow = callbackToWrap.type === 'ArrowFunctionExpression';
    const asyncSetup = isArrow && callbackToWrap.async;
    const call = isArrow ? 'DinoPlaceSetup()' : 'DinoPlaceSetup == null ? undefined : Reflect.apply(DinoPlaceSetup, this, [])';
    const key = engineHook.shorthand ? 'onLoad: ' : '';
    edits.push({
      start: callbackToWrap.start,
      end: callbackToWrap.end,
      newText: `${key}(DinoPlaceSetup => ${asyncSetup ? 'async ' : ''}function DinoPlaceLoad() {
    const DinoPlaceResult = ${asyncSetup ? 'await ' : ''}${call};
    ${statement}
    return DinoPlaceResult;
  })(${original})`,
    });
  } else if (body?.type === 'BlockStatement') {
    const directive = body.body.filter(item => 'directive' in item).at(-1);
    const start = directive?.end ?? body.start + 1;
    edits.push({ start, end: start, newText: `\n    ${statement}\n` });
  } else if (insertion !== undefined) {
    const separator = placement.scene ? '' : ',';
    edits.push({ start: insertion, end: insertion, newText: `\n  onLoad() {\n    ${statement}\n  }${separator}\n` });
  } else {
    edits.push({ start: source.length, end: source.length, newText: `\n${statement}\n` });
  }
  if (addedImports.length) {
    const start = ast.body.find(node => node.type === 'ImportDeclaration')?.start ??
      ast.body.find(node => !('directive' in node))?.start ?? source.length;
    const newText = `import { ${addedImports.join(', ')} } from 'dino-ge';\n`;
    if (start === source.length) {
      // An empty or directive-only script gets a single insertion at the end.
      edits[0].newText = `${source.length ? '\n' : ''}${newText}${statement}\n`;
    } else {
      edits.push({ start, end: start, newText });
    }
  }
  return { edits, tag, sourceId: `${constructor}-${tag}-0` };
}

/** Save an explicit origin for a line whose constructor defaults to its start point. */
export function getLineOriginEdit(sourceId: string, { x, y }: ScenePoint, mappings = sourceMappingRegistry): Edit | null {
  const mapping = mappings[sourceId];
  const start = mapping?.properties.p1;
  if (mapping?.type !== 'Line' || mapping.hasDynamicProperties || mapping.properties.position || !start?.vectorConstructor ||
      !start.args?.every(argument => argument.numeric) ||
      !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    start: start.nodeEnd,
    end: start.nodeEnd,
    newText: `, position: new ${start.vectorConstructor}(${x}, ${y})`,
  };
}

/** Calculates the surgical edit required to update a property value in the source code. */
export const getSurgicalEdit = (
  sourceId: string, 
  propertyPath: string, 
  value: any,
  getRuntimeValue: (path: string) => any,
  mappings = sourceMappingRegistry,
): Edit | null => {
  const mapping = mappings[sourceId];
  if (!mapping) return null;
  const vectorConstructor = mapping.vectorConstructor ?? 'Vector2';

  // Map prefix paths (e.g., _physics -> physics)
  let actualPath = propertyPath;
  if (propertyPath.startsWith('_physics.')) {
    actualPath = propertyPath.replace('_physics.', 'physics.');
  }

  const paths = actualPath.split('.');
  const formattedVal = typeof value === 'string' ? JSON.stringify(value) : String(value);

  // Helper to find property mapping deeply
  const findPropMapping = (props: Record<string, PropertyLocation>, pathArr: string[]): { mapping: PropertyLocation, depth: number } | null => {
    let currentProps = props;
    let lastFound: PropertyLocation | null = null;
    let depth = 0;

    for (const segment of pathArr) {
      const m = currentProps[segment];
      if (!m) return lastFound ? { mapping: lastFound, depth } : null;
      lastFound = m;
      depth++;
      if (m.properties) {
        currentProps = m.properties;
      } else {
        break;
      }
    }
    return lastFound ? { mapping: lastFound, depth } : null;
  };

  const found = findPropMapping(mapping.properties, paths);
  if (propertyPath === 'rotation' || propertyPath === 'radius') {
    const valid = propertyPath === 'rotation'
      ? (mapping.type === 'Sprite' || sceneObjectKinds.some(kind => kind === mapping.type)) && (!found || found.mapping.numeric)
      : mapping.type === 'Circle' && found?.mapping.numeric;
    if (!valid) return null;
    const group = sourceId.slice(0, sourceId.lastIndexOf('-') + 1);
    if (Object.keys(mappings).filter(id => id.startsWith(group) &&
        /^\d+$/.test(id.slice(group.length))).length !== 1) return null;
  }
  if (mapping.type === 'Line' && paths.length === 2 && (paths[0] === 'p1' || paths[0] === 'p2') &&
      !found?.mapping.args?.[paths[1] === 'x' ? 0 : 1]?.numeric) {
    return null;
  }

  // PRIORITY 1: Precise match found
  if (found && found.depth === paths.length) {
    return {
      start: found.mapping.valueStart,
      end: found.mapping.valueEnd,
      newText: formattedVal
    };
  }

  // PRIORITY 2: Match found for a parent property that is a Vector2 (surgical update to arg)
  if (found && found.mapping.args && (paths.length - found.depth === 1)) {
    const subProp = paths[paths.length - 1];
    if (subProp === 'x' && found.mapping.args.length >= 1) {
      return {
        start: found.mapping.args[0].start,
        end: found.mapping.args[0].end,
        newText: String(value)
      };
    }
    if (subProp === 'y' && found.mapping.args.length >= 2) {
      return {
        start: found.mapping.args[1].start,
        end: found.mapping.args[1].end,
        newText: String(value)
      };
    }
  }

  // PRIORITY 3: Match found for parent property but it's a scalar (convert to Vector2)
  if (found && found.depth === paths.length - 1) {
    const subProp = paths[paths.length - 1];
    
    if (subProp === 'x' || subProp === 'y') {
      const x = subProp === 'x' ? value : getRuntimeValue(actualPath.replace(/\.[xy]$/, '.x'));
      const y = subProp === 'y' ? value : getRuntimeValue(actualPath.replace(/\.[xy]$/, '.y'));
      return {
        start: found.mapping.valueStart,
        end: found.mapping.valueEnd,
        newText: `new ${vectorConstructor}(${x}, ${y})`
      };
    }
  }

  // PRIORITY 4: Property truly missing, perform generic insertion
  if (!found || found.depth < paths.length) {
    // Generate the nested object string generically
    // e.g., physics.velocity.x -> physics: { velocity: new Vector2(val, y) }
    
    // Determine where to start inserting. If depth > 0, we found a partial match
    // However, inserting into an existing object without full AST parsing of its 
    // exact token positions (like commas) is risky.
    // For safety, if it's a top-level insertion, we insert at the start of the component.
    // If it's a deep insertion and the parent object exists but the child doesn't, 
    // it's safest to rewrite the parent object entirely based on runtime state, 
    // but that drops formatting.
    // As a robust middle ground, we only support inserting at the top level (mapping.contentStart).
    
    const topProp = paths[0];
    
    // If topProp already exists and it's NOT physics, we shouldn't insert another topProp at the root.
    // If it IS physics, we might want to insert into it if it's missing the subproperty.
    if (mapping.properties[topProp] && topProp !== 'physics') {
      return null; // Deep insertion not supported cleanly without rewriting parent node
    }

    if (topProp === 'physics' && mapping.properties['physics']) {
      // Insert into existing physics object
      const physMapping = mapping.properties['physics'];
      const subProp = paths[1];
      if (physMapping.properties && physMapping.properties[subProp]) {
        return null; // Should have been handled by Priority 1
      }

      let insertionText = ` ${subProp}: ${formattedVal},`;
      if (paths.length === 3 && (paths[2] === 'x' || paths[2] === 'y')) {
        const x = paths[2] === 'x' ? value : getRuntimeValue(`physics.${subProp}.x`);
        const y = paths[2] === 'y' ? value : getRuntimeValue(`physics.${subProp}.y`);
        insertionText = ` ${subProp}: new ${vectorConstructor}(${x}, ${y}),`;
      }

      return {
        start: physMapping.valueStart + 1,
        end: physMapping.valueStart + 1,
        newText: insertionText
      };
    }

    let insertionText = `\n    ${topProp}: `;
    
    if (paths.length === 1) {
      insertionText += `${formattedVal},`;
    } else if (paths.length === 2 && (paths[1] === 'x' || paths[1] === 'y')) {
      const x = paths[1] === 'x' ? value : getRuntimeValue(`${topProp}.x`);
      const y = paths[1] === 'y' ? value : getRuntimeValue(`${topProp}.y`);
      insertionText += `new ${vectorConstructor}(${x}, ${y}),`;
    } else if (paths[0] === 'physics') {
      // Special handling for nested physics insertion to keep it clean
      insertionText += `{ `;
      if (paths.length === 2) {
        insertionText += `${paths[1]}: ${formattedVal} `;
      } else if (paths.length === 3 && (paths[2] === 'x' || paths[2] === 'y')) {
        const x = paths[2] === 'x' ? value : getRuntimeValue(`physics.${paths[1]}.x`);
        const y = paths[2] === 'y' ? value : getRuntimeValue(`physics.${paths[1]}.y`);
        insertionText += `${paths[1]}: new ${vectorConstructor}(${x}, ${y}) `;
      }
      insertionText += `},`;
    } else {
      return null; // Unsupported generic deep insertion
    }

    return {
      start: mapping.contentStart,
      end: mapping.contentStart,
      newText: insertionText
    };
  }

  return null;
};
