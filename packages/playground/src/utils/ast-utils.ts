import * as acorn from 'acorn';
import { Vector2 } from 'dino-ge';
import { sceneObjectDefaults, sceneObjectKinds, sceneSourceKey, type CanvasTransformChange, type SceneObjectPlacement, type ScenePoint } from './scene-objects';

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
  start: number;
  end: number;
  // Boundaries of the ObjectExpression { ... }
  contentStart: number;
  contentEnd: number;
  hasDynamicProperties: boolean;
  properties: Record<string, PropertyLocation>;
}

let sourceMappingRegistry: Record<string, ObjectSourceMapping> = {};

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

/**
 * Recursively maps properties of an ObjectExpression.
 */
const mapProperties = (objExpr: any, imports: Map<string, string>, code: string): Record<string, PropertyLocation> => {
  const mapping: Record<string, PropertyLocation> = {};
  if (!objExpr || objExpr.type !== 'ObjectExpression') return mapping;

  objExpr.properties.forEach((prop: any) => {
    if (prop.key?.type === 'Identifier') {
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
      if (prop.value.type === 'NewExpression' && 
          (prop.value.callee.name === 'Vector2' || imports.get(prop.value.callee.name) === 'Vector2' ||
            prop.value.callee.property?.name === 'Vector2')) {
        propLoc.vectorConstructor = code.slice(prop.value.callee.start, prop.value.callee.end);
        propLoc.args = prop.value.arguments.map((arg: any) => ({
          start: arg.start,
          end: arg.end,
          numeric: isNumeric(arg),
        }));
      }

      // Handle nested objects
      if (prop.value.type === 'ObjectExpression') {
        propLoc.properties = mapProperties(prop.value, imports, code);
      }

      mapping[prop.key.name] = propLoc;
    }
  });

  return mapping;
};

function dinoImports(ast: acorn.Program): Map<string, string> {
  const imports = new Map<string, string>();
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration' || node.source.value !== 'dino-ge') continue;
    for (const specifier of node.specifiers) {
      if (specifier.type === 'ImportSpecifier' && specifier.imported.type === 'Identifier') {
        imports.set(specifier.local.name, specifier.imported.name);
      }
    }
  }
  return imports;
}

function sceneDeclarations(ast: acorn.Program, imports: Map<string, string>) {
  return ast.body.flatMap(node => {
    const declaration = node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration'
      ? node.declaration : node;
    return declaration?.type === 'ClassDeclaration' && declaration.id &&
      declaration.superClass?.type === 'Identifier' && imports.get(declaration.superClass.name) === 'Scene'
      ? [declaration] : [];
  });
}

export interface InstrumentationResult {
  code: string;
  error?: string;
}

/** Preserves an imported entry module's file location when the Playground runs it inline. */
export function rebaseModule(code: string, moduleUrl: URL): string {
  const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  const replacements: Edit[] = [];
  const visit = (node: any) => {
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type)) {
      const source = node.source;
      if (typeof source?.value === 'string' && /^\.{1,2}\//.test(source.value)) {
        replacements.push({
          start: source.start, end: source.end,
          newText: JSON.stringify(new URL(source.value, moduleUrl).href),
        });
      } else if (node.type === 'ImportExpression' && source && typeof source.value !== 'string') {
        // Wrap only the expression so nested edits, including import.meta.url, still apply.
        replacements.push({
          start: source.start, end: source.start,
          newText: `((specifier) => typeof specifier === 'string' && /^\\.{1,2}\\//.test(specifier) ? new URL(specifier, ${JSON.stringify(moduleUrl.href)}).href : specifier)(`,
        }, { start: source.end, end: source.end, newText: ')' });
      }
    } else if (node.type === 'MemberExpression' && node.object.type === 'MetaProperty' &&
        node.object.meta.name === 'import' && node.object.property.name === 'meta' &&
        (node.computed ? node.property.value === 'url' : node.property.name === 'url')) {
      replacements.push({ start: node.start, end: node.end, newText: JSON.stringify(moduleUrl.href) });
    }
    for (const child of Object.values(node)) {
      for (const item of Array.isArray(child) ? child : [child]) {
        if (item && typeof item === 'object' && 'type' in item) visit(item);
      }
    }
  };
  visit(ast);
  for (const edit of replacements.sort((a, b) => b.start - a.start || b.end - a.end)) {
    code = code.slice(0, edit.start) + edit.newText + code.slice(edit.end);
  }
  return code;
}

/**
 * Instruments the provided code by injecting __sourceId into Dino GE object instantiations.
 * Also builds the source mapping registry.
 */
export const instrumentCode = (code: string, trackEditorSource = true, scriptId?: string): InstrumentationResult => {
  if (trackEditorSource) resetSourceMapping();
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

  const imports = dinoImports(ast);
  const injections: Edit[] = [];
  if (scriptId) {
    for (const scene of sceneDeclarations(ast, imports)) {
      const start = scene.body.start + 1;
      const metadata = { scriptId, className: scene.id!.name };
      injections.push({ start, end: start, newText: `static ${sceneSourceKey} = ${JSON.stringify(metadata)};` });
    }
  }

  const isGameObject = (node: any, args: any[]) => {
    if (node.callee.type !== 'Identifier' || args.length === 0 || args[0].type !== 'ObjectExpression') return false;
    
    // Broad heuristic: known Dino GE classes OR any class instantiation that takes an object with a 'tag' property
    const knownClasses = ['Sprite', 'Rectangle', 'Circle', 'Line', 'Text', 'Tilemap'];
    if (knownClasses.includes(node.callee.name)) return true;
    
    const hasTag = args[0].properties.some((p: any) => p.key?.type === 'Identifier' && p.key.name === 'tag');
    return hasTag;
  };

  // Simple recursive walker
  const walk = (node: any) => {
    if (!node) return;

    if (node.type === 'NewExpression') {
      const args = node.arguments;
      
      if (isGameObject(node, args)) {
        const props = args[0].properties;
        
        // Deterministic ID based on type, tag, and occurrence
        const tagProp = props.find((p: any) => p.key?.name === 'tag');
        const tagValue = (tagProp && tagProp.value.type === 'Literal') ? String(tagProp.value.value) : 'no-tag';
        const type = node.callee.name;
        const idKey = `${type}-${tagValue}`;
        const index = occurrenceCounts[idKey] || 0;
        occurrenceCounts[idKey] = index + 1;
        const sourceId = `${idKey}-${index}`;
        
        // Record property locations (using original offsets)
        if (trackEditorSource) sourceMappingRegistry[sourceId] = {
          sourceId,
          type: imports.get(node.callee.name) ?? node.callee.name,
          start: node.start,
          end: node.end,
          contentStart: args[0].start + 1, // After {
          contentEnd: args[0].end - 1,    // Before }
          hasDynamicProperties: props.some((prop: any) => prop.type !== 'Property' || prop.computed ||
            (prop.key.type === 'Literal' && prop.key.value === 'position')),
          properties: mapProperties(args[0], imports, code),
        };

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
        child.forEach(walk);
      } else if (child && typeof child === 'object' && child.type) {
        walk(child);
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

export interface CanvasPlacementTransaction {
  edits: Edit[];
  transforms: CanvasTransformChange[];
}

/** Find a standalone constructor written by the visual editor. */
function findPaletteStatement(source: string, sourceId: string) {
  if (!sourceId.startsWith('DinoPlace') || instrumentCode(source).error) return null;
  const mapping = getSourceMapping()[sourceId];
  const group = sourceId.slice(0, sourceId.lastIndexOf('-') + 1);
  if (!mapping || Object.keys(getSourceMapping()).filter(id => id.startsWith(group) &&
      /^\d+$/.test(id.slice(group.length))).length !== 1) return null;

  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const imports = dinoImports(ast);
  const matches: { statement: acorn.ExpressionStatement; options: acorn.ObjectExpression }[] = [];
  const visit = (node: any) => {
    if (matches.length || node.start > mapping.start || node.end < mapping.end) return;
    if (node.type === 'BlockStatement') {
      for (const child of node.body) {
        if (child.type !== 'ExpressionStatement') continue;
        const expression = child.expression;
        const isPlay = expression.type === 'CallExpression' && !expression.arguments.length &&
          expression.callee.type === 'MemberExpression' && !expression.callee.computed &&
          expression.callee.property.name === 'play';
        const constructor = isPlay ? expression.callee.object : expression;
        if (constructor.type !== 'NewExpression' || constructor.start !== mapping.start ||
            constructor.end !== mapping.end || !constructor.callee.name?.startsWith('DinoPlace')) continue;
        const type = imports.get(constructor.callee.name);
        const options = constructor.arguments[0];
        if (options?.type === 'ObjectExpression' &&
            (isPlay ? type === 'Sprite' : type === 'Rectangle' || type === 'Circle' || type === 'Text' || type === 'Line')) {
          matches.push({ statement: child, options });
          return;
        }
      }
    }
    for (const value of Object.values(node)) {
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child && typeof child === 'object' && 'type' in child) visit(child);
      }
    }
  };
  visit(ast);
  const [match] = matches;
  if (!match) return null;
  return { ...match, mapping, imports };
}

export function getSceneObjectDeletion(source: string, sourceId: string): Edit | null {
  const match = findPaletteStatement(source, sourceId);
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
  const match = findPaletteStatement(source, sourceId);
  const img = match?.mapping.properties.img;
  if (match?.mapping.type !== 'Sprite' || !img) return null;
  return { start: img.valueStart, end: img.valueEnd, newText: spriteImageExpression(imageSource) };
}

/** Copy the constructor's static options without evaluating the game script. */
export function getSceneObjectDuplication(source: string, sourceId: string, x: number, y: number) {
  const match = findPaletteStatement(source, sourceId);
  if (!match || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const { statement, mapping, imports } = match;
  const { tag, position } = mapping.properties;
  if (!tag || position?.args?.length !== 2 || position.args.some(arg => !arg.numeric)) return null;

  const readOptions = (node: any, root = false): Record<string, unknown> => {
    if (node.type !== 'ObjectExpression') throw new Error('Expected constructor options');
    const options = new Map<string, unknown>();
    for (const prop of node.properties) {
      if (prop.type !== 'Property' || prop.kind !== 'init' || prop.computed || prop.key.type !== 'Identifier' ||
          options.has(prop.key.name) || prop.key.name === '__proto__') throw new Error('Unsupported option');
      const key = prop.key.name;
      if (root && mapping.type === 'Sprite' && key === 'img') {
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
    if (node.type === 'NewExpression' && imports.get(node.callee.name) === 'Vector2') {
      const [x, y] = node.arguments.map(readValue);
      if (node.arguments.length === 2 && typeof x === 'number' && typeof y === 'number') return new Vector2(x, y);
    }
    throw new Error('Unsupported option value');
  };

  let options: Record<string, unknown>;
  try {
    options = readOptions(match.options, true);
  } catch {
    return null;
  }
  if (typeof options.tag !== 'string') return null;
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

/** Adds a constructor to the active scene or engine startup callback. */
export function getSceneObjectCreation(source: string, placement: SceneObjectPlacement) {
  let ast: acorn.Program;
  try {
    ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch {
    return null;
  }
  const imports = dinoImports(ast);
  const configurations: acorn.ObjectExpression[] = [];
  const visit = (node: any) => {
    if (node.type === 'NewExpression' && imports.get(node.callee.name) === 'Engine' &&
      node.arguments[0]?.type === 'ObjectExpression') {
      configurations.push(node.arguments[0]);
    }
    for (const value of Object.values(node)) {
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child && typeof child === 'object' && 'type' in child) visit(child);
      }
    }
  };
  const isOnLoad = (key: acorn.Node) =>
    (key.type === 'Identifier' && (key as acorn.Identifier).name === 'onLoad') ||
    (key.type === 'Literal' && (key as acorn.Literal).value === 'onLoad');
  let callback: acorn.Expression | undefined;
  let engineHook: acorn.Property | undefined;
  let insertion: number;
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
    visit(ast);
    if (configurations.length !== 1) return null;
    const config = configurations[0];
    if (config.properties.some(prop => prop.type !== 'Property' || prop.computed)) return null;
    const hooks = config.properties.filter((prop): prop is acorn.Property => prop.type === 'Property' && isOnLoad(prop.key));
    if (hooks.length > 1 || (hooks[0] && hooks[0].kind !== 'init')) return null;
    engineHook = hooks[0];
    callback = engineHook?.value;
    insertion = config.start + 1;
  }
  const wrappedInsertion = getPlacedObjectInsertion(callback);
  const body = callback?.type === 'ArrowFunctionExpression' || callback?.type === 'FunctionExpression' ? callback.body : undefined;
  const callbackToWrap = callback?.type === 'Identifier' || callback?.type === 'MemberExpression' ||
    (callback?.type === 'ArrowFunctionExpression' && callback.body.type !== 'BlockStatement') ? callback : undefined;
  if (callback && body?.type !== 'BlockStatement' && !callbackToWrap && wrappedInsertion === undefined) return null;

  const addedImports: string[] = [];
  const binding = (name: string) => {
    const existing = Array.from(imports).find(([local, exported]) => exported === name && local.startsWith('DinoPlace'));
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
    : placement.kind === 'Line'
      ? `p1: new ${vector}(0, 0), p2: new ${vector}(${sceneObjectDefaults.Line.length}, 0), width: ${sceneObjectDefaults.Line.strokeWidth}, visible: true`
      : Object.entries(sceneObjectDefaults[placement.kind])
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(', ');
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
  } else {
    const separator = placement.scene ? '' : ',';
    edits.push({ start: insertion, end: insertion, newText: `\n  onLoad() {\n    ${statement}\n  }${separator}\n` });
  }
  if (addedImports.length) {
    const start = ast.body.find(node => node.type === 'ImportDeclaration')?.start ?? 0;
    edits.push({ start, end: start, newText: `import { ${addedImports.join(', ')} } from 'dino-ge';\n` });
  }
  return { edits, tag, sourceId: `${constructor}-${tag}-0` };
}

/** Save an explicit origin for a line whose constructor defaults to its start point. */
export function getLineOriginEdit(sourceId: string, { x, y }: ScenePoint): Edit | null {
  const mapping = sourceMappingRegistry[sourceId];
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
  getRuntimeValue: (path: string) => any
): Edit | null => {
  const mapping = sourceMappingRegistry[sourceId];
  if (!mapping) return null;

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
    if (Object.keys(sourceMappingRegistry).filter(id => id.startsWith(group) &&
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
        newText: `new Vector2(${x}, ${y})`
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
        insertionText = ` ${subProp}: new Vector2(${x}, ${y}),`;
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
      insertionText += `new Vector2(${x}, ${y}),`;
    } else if (paths[0] === 'physics') {
      // Special handling for nested physics insertion to keep it clean
      insertionText += `{ `;
      if (paths.length === 2) {
        insertionText += `${paths[1]}: ${formattedVal} `;
      } else if (paths.length === 3 && (paths[2] === 'x' || paths[2] === 'y')) {
        const x = paths[2] === 'x' ? value : getRuntimeValue(`physics.${paths[1]}.x`);
        const y = paths[2] === 'y' ? value : getRuntimeValue(`physics.${paths[1]}.y`);
        insertionText += `${paths[1]}: new Vector2(${x}, ${y}) `;
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
