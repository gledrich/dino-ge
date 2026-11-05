import React, { useEffect, useId, useLayoutEffect, useRef } from 'react';
import * as Dino from 'dino-ge';
import { getSurgicalEdit, type CanvasPlacementTransaction, type Edit } from '../utils/ast-utils';
import { getCanvasPlacementBaseline, isCanvasTransformProperty, renameEntryObjectEvent, restoreSceneTransform, sceneObjectTagHistoryEvent, type EntryObjectRename, type SceneTransformState } from '../utils/scene-objects';

export interface PropertyRowDef {
  label: string;
  type: string;
  propertyPath: string;
  min?: number;
  emptyColourLabel?: string;
}

export interface InspectorPropertyEdit {
  edit: Edit;
  object: Dino.GameObject;
  path: string;
  before: unknown;
  after: string | number | boolean;
}

const inspectorPropertyHistoryEvent = 'playground-inspector-property-history';
const inspectorBaselines = new WeakMap<Dino.GameObject, Map<string, unknown>>();

const lineProperties = new Map([
  ['p1.x', 'x1'], ['p1.y', 'y1'], ['p2.x', 'x2'], ['p2.y', 'y2'], ['width', 'strokeWidth'],
  ['colour', 'colour'],
]);

let colourContext: CanvasRenderingContext2D | null | undefined;

function getCanvasColourHex(value: string) {
  if (!value.trim()) return;
  if (colourContext === undefined) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    colourContext = canvas.getContext('2d', { willReadFrequently: true });
  }
  if (!colourContext) return;
  // Invalid canvas colours retain the previous fill style.
  colourContext.fillStyle = '#000001';
  colourContext.fillStyle = value;
  const first = colourContext.fillStyle;
  colourContext.fillStyle = '#000002';
  colourContext.fillStyle = value;
  if (first !== colourContext.fillStyle) return;
  colourContext.clearRect(0, 0, 1, 1);
  colourContext.fillRect(0, 0, 1, 1);
  const channels = colourContext.getImageData(0, 0, 1, 1).data;
  const hex = Array.from(channels.subarray(0, 3)).map(channel => channel.toString(16).padStart(2, '0'));
  return `#${hex.join('')}`;
}

export interface InspectableObject extends Dino.GameObject {
  [key: string]: any;
}

/**
 * Resolves a dot-notation property path to the actual target object and property key.
 * Maps flat configuration keys (e.g., 'tag', '_physics.velocity.x') to their respective ECS Components.
 */
export const resolveComponentPath = (obj: InspectableObject, pathStr: string): { target: any, prop: string } | null => {
  if (pathStr === 'rotation') return { target: obj.transform, prop: 'rotation' };
  const lineProperty = obj instanceof Dino.Line ? lineProperties.get(pathStr) : undefined;
  if (lineProperty) return { target: obj, prop: lineProperty };

  if (pathStr === 'text' || pathStr === 'colour' || pathStr === 'backgroundColour') {
    const text = obj.getComponent(Dino.TextComponent);
    if (text) return { target: obj instanceof Dino.Text ? obj : text, prop: pathStr };
    const shape = pathStr === 'colour' && obj.getComponent(Dino.ShapeComponent);
    if (shape) return { target: obj instanceof Dino.Rectangle || obj instanceof Dino.Circle ? obj : shape, prop: pathStr };
  }

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

function getInspectorBaseline(object: Dino.GameObject, path: string) {
  const baselines = inspectorBaselines.get(object);
  if (baselines?.has(path)) return baselines.get(path);
  const resolved = resolveComponentPath(object, path);
  return resolved?.target?.[resolved.prop];
}

export function clearInspectorPlacementBaselines(object: Dino.GameObject, state: SceneTransformState) {
  const baselines = inspectorBaselines.get(object);
  if (!baselines) return;
  for (const path of baselines.keys()) {
    if (isCanvasTransformProperty(path, state)) baselines.delete(path);
  }
}

export function restoreInspectorProperty(object: Dino.GameObject, path: string, value: unknown) {
  const resolved = resolveComponentPath(object, path);
  if (!resolved?.target) return;
  resolved.target[resolved.prop] = value;
  inspectorBaselines.get(object)?.delete(path);
  window.dispatchEvent(new CustomEvent(inspectorPropertyHistoryEvent, { detail: { object, path } }));
}

/**
 * Individual input row for a property, handles its own sync loop and value formatting.
 */
const InspectorRow: React.FC<{
  def: PropertyRowDef;
  selectedObject: InspectableObject;
  canSaveToCode: boolean;
  placementKind?: Dino.ObjectManipulationPreview['kind'];
  deferSave?: boolean;
}> = ({ def, selectedObject, canSaveToCode, placementKind, deferSave }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const colourRef = useRef<HTMLInputElement>(null);
  const editGroup = useRef<symbol>(undefined);
  const inputId = useId();
  const isRotation = def.propertyPath === 'rotation';
  const isColour = def.type === 'colour';
  const isDimension = def.propertyPath === 'width' || def.propertyPath === 'height' || def.propertyPath === 'radius';
  const isModuleDimension = placementKind === 'resize' && isDimension;
  const minimum = isModuleDimension ? 0.000001 : def.min;
  const [isValid, setIsValid] = React.useState(true);
  const [syncError, setSyncError] = React.useState('');
  const invalid = (isColour || isModuleDimension) && !isValid;
  const [prevSelectedObject, setPrevSelectedObject] = React.useState(selectedObject);
  const [lastSyncedValue, setLastSyncedValue] = React.useState(() => getInspectorBaseline(selectedObject, def.propertyPath));
  const [isModified, setIsModified] = React.useState(false);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (placementKind && input && document.activeElement === input) input.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [placementKind, deferSave]);

  // Sync state during render if selectedObject changes
  if (selectedObject !== prevSelectedObject) {
    setPrevSelectedObject(selectedObject);
    setIsValid(true);
    setSyncError('');
    setLastSyncedValue(getInspectorBaseline(selectedObject, def.propertyPath));
  }

  // Refresh baseline when code is updated externally
  useEffect(() => {
    const handleUpdate = () => {
      const resolved = resolveComponentPath(selectedObject, def.propertyPath);
      if (resolved && resolved.target) {
        inspectorBaselines.get(selectedObject)?.delete(def.propertyPath);
        setLastSyncedValue(resolved.target[resolved.prop]);
      }
    };
    const onPlacementHistory = (event: Event) => {
      const { object, state } = (event as CustomEvent<{ object: Dino.GameObject; state: SceneTransformState }>).detail;
      if (object === selectedObject && isCanvasTransformProperty(def.propertyPath, state)) handleUpdate();
    };
    const onTagHistory = (event: Event) => {
      if (def.propertyPath === 'tag' && (event as CustomEvent<Dino.GameObject>).detail === selectedObject) {
        handleUpdate();
        setSyncError('');
      }
    };
    const onPropertyHistory = (event: Event) => {
      const { object, path } = (event as CustomEvent<Pick<InspectorPropertyEdit, 'object' | 'path'>>).detail;
      if (object === selectedObject && path === def.propertyPath) handleUpdate();
    };
    window.addEventListener('playground-update-code', handleUpdate);
    window.addEventListener('playground-script-selected', handleUpdate);
    window.addEventListener('playground-placement-history', onPlacementHistory);
    window.addEventListener(sceneObjectTagHistoryEvent, onTagHistory);
    window.addEventListener(inspectorPropertyHistoryEvent, onPropertyHistory);
    return () => {
      window.removeEventListener('playground-update-code', handleUpdate);
      window.removeEventListener('playground-script-selected', handleUpdate);
      window.removeEventListener('playground-placement-history', onPlacementHistory);
      window.removeEventListener(sceneObjectTagHistoryEvent, onTagHistory);
      window.removeEventListener(inspectorPropertyHistoryEvent, onPropertyHistory);
    };
  }, [selectedObject, def.propertyPath]);

  // Sync runtime value to the input box and check for modifications
  useEffect(() => {
    let rafId: number;
    let previousColour: string | undefined;
    const loop = () => {
      const resolved = resolveComponentPath(selectedObject, def.propertyPath);
      if (resolved && resolved.target) {
        const val = resolved.target[resolved.prop];
        if (colourRef.current) {
          const colour = typeof val === 'string' ? val : '';
          if (colour !== previousColour) {
            previousColour = colour;
            colourRef.current.value = getCanvasColourHex(colour) ?? '#000000';
          }
        }
        
        // Update input if not focused
        if (inputRef.current && document.activeElement !== inputRef.current) {
          if (def.type === 'checkbox') {
            inputRef.current.checked = !!val;
          } else if (def.type === 'number') {
            inputRef.current.value = typeof val === 'number'
              ? (isRotation ? val * (180 / Math.PI) : val).toFixed(2) : '0';
          } else {
            inputRef.current.value = val !== undefined ? String(val) : '';
          }
          if (isColour || isModuleDimension) setIsValid(true);
        }

        // Compare runtime value with baseline to determine modified state
        let modified = false;
        if (typeof val === 'number' && typeof lastSyncedValue === 'number') {
          // Use epsilon for float comparison to handle dragging jitter
          modified = Math.abs(val - lastSyncedValue) > (isRotation ? 0.000001 : 0.01);
        } else {
          modified = val !== lastSyncedValue;
        }
        setIsModified(modified);
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [selectedObject, def, isColour, isModuleDimension, isRotation, lastSyncedValue]);

  const parseValue = (element: HTMLInputElement) => {
    if (def.type === 'checkbox') return element.checked;
    const emptyColour = def.emptyColourLabel && element.value === '';
    if (isColour && !emptyColour && !getCanvasColourHex(element.value)) return;
    if (def.type !== 'number') return element.value;
    const value = element.valueAsNumber;
    if (Number.isFinite(value) && !element.validity.rangeUnderflow) {
      return isRotation ? value * (Math.PI / 180) : value;
    }
  };

  const updateValue = (element: HTMLInputElement) => {
    const val = parseValue(element);
    if (syncError) setSyncError('');
    if (isColour) setIsValid(val !== undefined);
    if (isModuleDimension) setIsValid(!element.validity.rangeUnderflow);
    if (placementKind && typeof val === 'number' && Dino.Engine.paused && Dino.Engine.debug) {
      const initial = Dino.Input.getObjectManipulationValue(selectedObject, placementKind);
      const next = { x: initial.x, y: initial.y };
      if (def.propertyPath === 'radius') next.x = next.y = val * 2;
      else if (def.propertyPath.endsWith('.y') || def.propertyPath === 'height') next.y = val;
      else next.x = val;
      restoreSceneTransform(selectedObject, getCanvasPlacementBaseline(selectedObject, new Map([[placementKind, next]])));
      Dino.Engine.emit('objectManipulated', {
        object: selectedObject, kind: placementKind, initial, group: editGroup.current ??= Symbol(),
      });
      return;
    }
    const resolved = resolveComponentPath(selectedObject, def.propertyPath);
    if (resolved?.target && val !== undefined) {
      // Keep the starting value with the live object when the row is unmounted.
      let baselines = inspectorBaselines.get(selectedObject);
      if (!baselines) {
        baselines = new Map();
        inspectorBaselines.set(selectedObject, baselines);
      }
      if (!baselines.has(def.propertyPath)) baselines.set(def.propertyPath, lastSyncedValue);
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
    if (def.propertyPath === 'tag') {
      if (typeof val !== 'string' || typeof lastSyncedValue !== 'string') return;
      const request: EntryObjectRename = { object: selectedObject, tag: val, previousTag: lastSyncedValue };
      const accepted = !window.dispatchEvent(new CustomEvent<EntryObjectRename>(renameEntryObjectEvent, {
        cancelable: true, detail: request,
      }));
      if (!accepted) setSyncError(request.error ?? 'Could not save this tag to a unique constructor in the open script.');
      return;
    }
    window.dispatchEvent(new Event('playground-sync-source-mapping'));
    const edit = getSurgicalEdit(sourceId, def.propertyPath, val, (path) => {
      const res = resolveComponentPath(selectedObject, path);
      return res && res.target ? res.target[res.prop] : undefined;
    });

    if (edit) {
      if (isRotation || def.propertyPath === 'radius') {
        if (typeof val !== 'number' || typeof lastSyncedValue !== 'number') return;
        const stateFor = (value: number): SceneTransformState => isRotation
          ? { rotation: value }
          : { size: { x: value * 2, y: value * 2 } };
        const accepted = !window.dispatchEvent(new CustomEvent<CanvasPlacementTransaction>('playground-apply-placement', {
          cancelable: true,
          detail: {
            edits: [edit], transforms: [{
              object: selectedObject, before: stateFor(lastSyncedValue), after: stateFor(val),
            }],
          },
        }));
        if (!accepted) return;
      } else {
        if (window.dispatchEvent(new CustomEvent<InspectorPropertyEdit>('playground-apply-edit', {
          detail: { edit, object: selectedObject, path: def.propertyPath, before: lastSyncedValue, after: val },
          cancelable: true,
        }))) return;
      }
      inspectorBaselines.get(selectedObject)?.delete(def.propertyPath);
      setLastSyncedValue(val);
      setIsModified(false);
    } else {
      console.warn(`Could not calculate surgical edit for ${def.propertyPath}`);
    }
  };

  return (
    <div className={`prop-row ${isModified ? 'modified' : ''}`}>
      {isColour ? <div className="prop-colour-label">
        <label htmlFor={inputId}>{def.label}</label>
        <input type="color" ref={colourRef} aria-label={`Choose ${def.label.toLowerCase()}`}
          title="Choose a solid colour. Use the text field for transparency."
          onChange={event => {
            if (!inputRef.current) return;
            inputRef.current.value = event.currentTarget.value;
            updateValue(inputRef.current);
          }} />
      </div> : <label htmlFor={inputId}>{def.label}</label>}
      <div className={`input-group${isColour ? ' colour-input-group' : ''}${(isModuleDimension && invalid) || syncError ? ' input-group-invalid' : ''}`}>
        <input
          id={inputId}
          type={isColour ? 'text' : def.type}
          min={minimum}
          step="any"
          ref={inputRef}
          placeholder={def.emptyColourLabel}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid || syncError ? `${inputId}-error` : undefined}
          title={isColour ? 'CSS colour, such as #54d6ad, rebeccapurple or rgba(0, 0, 0, 0.5)'
            : placementKind ? 'Stages this transform for module review' : undefined}
          onChange={event => updateValue(event.currentTarget)}
          onBlur={() => { editGroup.current = undefined; }}
        />
        {canSaveToCode && !deferSave && <button type="button"
          className="save-prop-icon"
          onClick={handleSync}
          disabled={isColour && !isValid}
          aria-label={`Save ${def.label} to code`}
          title="Save this property to code"
        ><i className="fa-solid fa-floppy-disk" aria-hidden="true" /></button>}
        {placementKind && <i className="fa-solid fa-code prop-module-indicator" aria-hidden="true" />}
        {invalid && <span className="prop-validation" id={`${inputId}-error`} role="status">
          {isColour ? 'Enter a CSS colour, such as #54d6ad or rgba(0, 0, 0, 0.5).' : 'Enter a positive dimension.'}
        </span>}
        {syncError && <span className="prop-validation" id={`${inputId}-error`} role="status">{syncError}</span>}
      </div>
    </div>
  );
};

export default InspectorRow;
