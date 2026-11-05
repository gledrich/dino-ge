import React, { useEffect, useId, useRef } from 'react';
import * as Dino from 'dino-ge';
import { getSurgicalEdit } from '../utils/ast-utils';

export interface PropertyRowDef {
  label: string;
  type: string;
  propertyPath: string;
  min?: number;
}

const lineProperties = new Map([
  ['p1.x', 'x1'], ['p1.y', 'y1'], ['p2.x', 'x2'], ['p2.y', 'y2'], ['width', 'strokeWidth'],
]);

export interface InspectableObject extends Dino.GameObject {
  [key: string]: any;
}

/**
 * Resolves a dot-notation property path to the actual target object and property key.
 * Maps flat configuration keys (e.g., 'tag', '_physics.velocity.x') to their respective ECS Components.
 */
export const resolveComponentPath = (obj: InspectableObject, pathStr: string): { target: any, prop: string } | null => {
  const lineProperty = obj instanceof Dino.Line ? lineProperties.get(pathStr) : undefined;
  if (lineProperty) return { target: obj, prop: lineProperty };

  let target: any = obj;
  let propPath = pathStr;

  if (pathStr === 'tag' || pathStr === 'zIndex') {
    target = obj.metadata;
    propPath = pathStr;
  } else if (pathStr === 'visible') {
    let vc = obj.getComponent(Dino.VisibilityComponent);
    if (!vc) {
      vc = new Dino.VisibilityComponent(true);
      obj.addComponent(vc);
    }
    target = vc;
    propPath = pathStr;
  } else if (pathStr === 'width' || pathStr === 'height') {
    // Try components first as they might be the source of truth syncing to bounds
    const shape = obj.getComponent(Dino.ShapeComponent);
    const text = obj.getComponent(Dino.TextComponent);
    target = shape || text || obj.bounds;
    propPath = pathStr;
  } else if (pathStr.startsWith('_physics.')) {
    let pc = obj.getComponent(Dino.PhysicsComponent);
    if (!pc) {
      pc = new Dino.PhysicsComponent();
      obj.addComponent(pc);
    }
    target = pc;
    propPath = pathStr.replace('_physics.', '');
  }

  if (!target) return null;

  const paths = propPath.split('.');
  if (paths.length === 2) {
    if (paths[0] === 'position') {
      // Use transform.position so we can read and write to the actual Vector2 reference
      return { target: obj.transform.position, prop: paths[1] };
    }
    if (paths[0] === 'scale') {
      return { target: obj.transform.scale, prop: paths[1] };
    }
    return { target: target[paths[0]], prop: paths[1] };
  }
  
  return { target, prop: propPath };
};

/**
 * Individual input row for a property, handles its own sync loop and value formatting.
 */
const InspectorRow: React.FC<{
  def: PropertyRowDef;
  selectedObject: InspectableObject;
}> = ({ def, selectedObject }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [prevSelectedObject, setPrevSelectedObject] = React.useState(selectedObject);
  const [lastSyncedValue, setLastSyncedValue] = React.useState<any>(() => {
    const resolved = resolveComponentPath(selectedObject, def.propertyPath);
    return resolved && resolved.target ? resolved.target[resolved.prop] : undefined;
  });
  const [isModified, setIsModified] = React.useState(false);

  // Sync state during render if selectedObject changes
  if (selectedObject !== prevSelectedObject) {
    setPrevSelectedObject(selectedObject);
    const resolved = resolveComponentPath(selectedObject, def.propertyPath);
    setLastSyncedValue(resolved && resolved.target ? resolved.target[resolved.prop] : undefined);
  }

  // Refresh baseline when code is updated externally
  useEffect(() => {
    const handleUpdate = () => {
      const resolved = resolveComponentPath(selectedObject, def.propertyPath);
      if (resolved && resolved.target) {
        setLastSyncedValue(resolved.target[resolved.prop]);
      }
    };
    window.addEventListener('playground-update-code', handleUpdate);
    window.addEventListener('playground-script-selected', handleUpdate);
    return () => {
      window.removeEventListener('playground-update-code', handleUpdate);
      window.removeEventListener('playground-script-selected', handleUpdate);
    };
  }, [selectedObject, def.propertyPath]);

  // Sync runtime value to the input box and check for modifications
  useEffect(() => {
    let rafId: number;
    const loop = () => {
      const resolved = resolveComponentPath(selectedObject, def.propertyPath);
      if (resolved && resolved.target) {
        const val = resolved.target[resolved.prop];
        
        // Update input if not focused
        if (inputRef.current && document.activeElement !== inputRef.current) {
          if (def.type === 'checkbox') {
            inputRef.current.checked = !!val;
          } else if (def.type === 'number') {
            inputRef.current.value = typeof val === 'number' ? val.toFixed(2) : '0';
          } else {
            inputRef.current.value = val !== undefined ? String(val) : '';
          }
        }

        // Compare runtime value with baseline to determine modified state
        let modified = false;
        if (typeof val === 'number' && typeof lastSyncedValue === 'number') {
          // Use epsilon for float comparison to handle dragging jitter
          modified = Math.abs(val - lastSyncedValue) > 0.01;
        } else {
          modified = val !== lastSyncedValue;
        }
        setIsModified(modified);
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [selectedObject, def, lastSyncedValue]);

  const parseValue = (element: HTMLInputElement) => {
    if (def.type === 'checkbox') return element.checked;
    if (def.type !== 'number') return element.value;
    const value = element.valueAsNumber;
    if (Number.isFinite(value) && !element.validity.rangeUnderflow) return value;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseValue(e.target);
    const resolved = resolveComponentPath(selectedObject, def.propertyPath);
    if (resolved?.target && val !== undefined) {
      resolved.target[resolved.prop] = val;
    }
  };

  const handleSync = () => {
    if (!inputRef.current) return;
    const sourceId = selectedObject.metadata.sourceId;
    if (!sourceId) {
      console.warn('Cannot sync object without sourceId. Ensure it was defined in a script.');
      return;
    }

    const val = parseValue(inputRef.current);
    if (val === undefined) return;
    window.dispatchEvent(new Event('playground-sync-source-mapping'));
    const edit = getSurgicalEdit(sourceId, def.propertyPath, val, (path) => {
      const res = resolveComponentPath(selectedObject, path);
      return res && res.target ? res.target[res.prop] : undefined;
    });

    if (edit) {
      window.dispatchEvent(new CustomEvent('playground-apply-edit', { detail: edit }));
      setLastSyncedValue(val);
      setIsModified(false);
    } else {
      console.warn(`Could not calculate surgical edit for ${def.propertyPath}`);
    }
  };

  return (
    <div className={`prop-row ${isModified ? 'modified' : ''}`}>
      <label htmlFor={inputId}>{def.label}</label>
      <div className="input-group">
        <input
          id={inputId}
          type={def.type}
          min={def.min}
          step="any"
          ref={inputRef}
          onChange={handleChange}
        />
        <button type="button"
          className="save-prop-icon"
          onClick={handleSync}
          aria-label={`Save ${def.label} to code`}
          title="Save this property to code"
        ><i className="fa-solid fa-floppy-disk" aria-hidden="true" /></button>
      </div>
    </div>
  );
};

export default InspectorRow;
