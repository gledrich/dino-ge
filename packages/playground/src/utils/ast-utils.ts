import * as acorn from 'acorn';

export interface PropertyLocation {
  nodeStart: number;
  nodeEnd: number;
  valueStart: number;
  valueEnd: number;
  // For special types like Vector2
  args?: Array<{ start: number, end: number }>;
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
const mapProperties = (objExpr: any): Record<string, PropertyLocation> => {
  const mapping: Record<string, PropertyLocation> = {};
  if (!objExpr || objExpr.type !== 'ObjectExpression') return mapping;

  objExpr.properties.forEach((prop: any) => {
    if (prop.key.type === 'Identifier') {
      const propLoc: PropertyLocation = {
        nodeStart: prop.start,
        nodeEnd: prop.end,
        valueStart: prop.value.start,
        valueEnd: prop.value.end,
      };

      // Handle Vector2 instantiations
      if (prop.value.type === 'NewExpression' && 
          (prop.value.callee.name === 'Vector2' || (prop.value.callee.property && prop.value.callee.property.name === 'Vector2'))) {
        propLoc.args = prop.value.arguments.map((arg: any) => ({
          start: arg.start,
          end: arg.end
        }));
      }

      // Handle nested objects
      if (prop.value.type === 'ObjectExpression') {
        propLoc.properties = mapProperties(prop.value);
      }

      mapping[prop.key.name] = propLoc;
    }
  });

  return mapping;
};

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
export const instrumentCode = (code: string, trackEditorSource = true): InstrumentationResult => {
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

  let offset = 0;
  let instrumentedCode = code;

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
        const tagProp = props.find((p: any) => p.key.name === 'tag');
        const tagValue = (tagProp && tagProp.value.type === 'Literal') ? String(tagProp.value.value) : 'no-tag';
        const type = node.callee.name;
        const idKey = `${type}-${tagValue}`;
        const index = occurrenceCounts[idKey] || 0;
        occurrenceCounts[idKey] = index + 1;
        const sourceId = `${idKey}-${index}`;
        
        // Record property locations (using original offsets)
        if (trackEditorSource) sourceMappingRegistry[sourceId] = {
          sourceId,
          type: node.callee.name,
          start: node.start,
          end: node.end,
          contentStart: args[0].start + 1, // After {
          contentEnd: args[0].end - 1,    // Before }
          properties: mapProperties(args[0]),
        };

        // Inject __sourceId into the object literal in the instrumented version
        const injection = `__sourceId: ${JSON.stringify(sourceId)}, `;
        const insertPos = args[0].start + 1 + offset;
        instrumentedCode = instrumentedCode.slice(0, insertPos) + injection + instrumentedCode.slice(insertPos);
        offset += injection.length;
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
  return { code: instrumentedCode };
};

export interface Edit {
  start: number;
  end: number;
  newText: string;
}

/**
 * Calculates the surgical edit required to update a property value in the source code.
 */
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
