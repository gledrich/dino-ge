import React, { useEffect, useState } from 'react';
import * as Dino from 'dino-ge';
import InspectorRow, { InspectableObject, PropertyRowDef, resolveComponentPath } from './InspectorRow';
import { getLineOriginEdit, getSurgicalEdit, getSourceMapping, Edit } from '../utils/ast-utils';
import { usePlayground } from '../context/PlaygroundContext';
import { getCanvasPlacementBaseline, isCanvasTransformProperty, restoreSceneTransform, type SceneTransformState } from '../utils/scene-objects';
import '../styles/inspector.css';

const { Engine } = Dino;

interface InspectorProps {
  visible: boolean;
}

const SECTIONS: Record<string, { rows: PropertyRowDef[], component: any, description?: string }> = {
  General: {
    component: Dino.TagComponent,
    rows: [
      { label: 'Tag', type: 'text', propertyPath: 'tag' },
      { label: 'Visible', type: 'checkbox', propertyPath: 'visible' },
      { label: 'Z-Index', type: 'number', propertyPath: 'zIndex' }
    ]
  },
  Transform: {
    component: Dino.TransformComponent,
    rows: [
      { label: 'X', type: 'number', propertyPath: 'position.x' },
      { label: 'Y', type: 'number', propertyPath: 'position.y' },
      { label: 'Scale X', type: 'number', propertyPath: 'scale.x' },
      { label: 'Scale Y', type: 'number', propertyPath: 'scale.y' },
      { label: 'Rotation (°)', type: 'number', propertyPath: 'rotation' }
    ]
  },
  Text: {
    component: Dino.TextComponent,
    rows: [
      { label: 'Content', type: 'text', propertyPath: 'text' },
      { label: 'Text colour', type: 'text', propertyPath: 'colour' },
      { label: 'Background', type: 'text', propertyPath: 'backgroundColour' },
    ]
  },
  Bounds: {
    component: Dino.BoundsComponent,
    rows: [
      { label: 'Width', type: 'number', propertyPath: 'width' },
      { label: 'Height', type: 'number', propertyPath: 'height' }
    ]
  },
  Line: {
    component: Dino.LineComponent,
    description: 'Drag the square handles in Edit scene. The coordinates below are relative to the line’s origin.',
    rows: [
      { label: 'Start X', type: 'number', propertyPath: 'p1.x' },
      { label: 'Start Y', type: 'number', propertyPath: 'p1.y' },
      { label: 'End X', type: 'number', propertyPath: 'p2.x' },
      { label: 'End Y', type: 'number', propertyPath: 'p2.y' },
      { label: 'Stroke width', type: 'number', propertyPath: 'width', min: 0.01 },
    ]
  },
  Physics: {
    component: Dino.PhysicsComponent,
    rows: [
      { label: 'Velocity X', type: 'number', propertyPath: '_physics.velocity.x' },
      { label: 'Velocity Y', type: 'number', propertyPath: '_physics.velocity.y' },
      { label: 'Accel X', type: 'number', propertyPath: '_physics.acceleration.x' },
      { label: 'Accel Y', type: 'number', propertyPath: '_physics.acceleration.y' },
      { label: 'Mass', type: 'number', propertyPath: '_physics.mass' },
      { label: 'Restitution', type: 'number', propertyPath: '_physics.restitution' },
      { label: 'Friction', type: 'number', propertyPath: '_physics.friction' },
      { label: 'Is Static', type: 'checkbox', propertyPath: '_physics.isStatic' },
      { label: 'Is Sensor', type: 'checkbox', propertyPath: '_physics.isSensor' }
    ]
  }
};

const getInspectorSections = (object: InspectableObject) => Object.entries(SECTIONS)
  .filter(([name, { component }]) => {
    if (name === 'Line') return object instanceof Dino.Line && object.hasComponent(component);
    if (name === 'Bounds' && object.hasComponent(Dino.LineComponent)) return false;
    return object.hasComponent(component);
  });

const Inspector: React.FC<InspectorProps> = ({ visible }) => {
  const { isDebug, isPaused, selectedObject, pendingCanvasPlacements } = usePlayground();
  const placement = selectedObject ? pendingCanvasPlacements.get(selectedObject) : undefined;
  const [isApplying, setIsApplying] = useState(false);
  const [syntaxError, setSyntaxError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [placementStatus, setPlacementStatus] = useState('');
  const baseline = selectedObject && placement ? getCanvasPlacementBaseline(selectedObject, placement) : undefined;
  const canEditPaletteObject = isPaused && !syntaxError && selectedObject?.metadata.sourceId?.startsWith('DinoPlace');

  const deleteObject = () => {
    if (!selectedObject) return;
    const accepted = !window.dispatchEvent(new CustomEvent('playground-remove-scene-object', {
      detail: selectedObject, cancelable: true,
    }));
    if (!accepted) setPlacementStatus('Delete is available for standalone palette objects in the open script.');
  };

  const duplicateObject = () => {
    if (!selectedObject) return;
    const accepted = !window.dispatchEvent(new CustomEvent('playground-duplicate-scene-object', {
      detail: selectedObject, cancelable: true,
    }));
    if (!accepted) setPlacementStatus('Duplicate is available for standalone palette objects with literal options in the open script.');
  };

  useEffect(() => {
    const clearStatus = () => setPlacementStatus('');
    const onPlacementChanged = (event: Event) => {
      const { object } = (event as CustomEvent<{ object: Dino.GameObject }>).detail;
      if (Engine.selectedObject === object) clearStatus();
    };

    const onSyntaxError = (e: Event) => {
      const customEvent = e as CustomEvent<string | null>;
      setSyntaxError(customEvent.detail);
    };

    const onEngineUpdate = () => {
      setTick(t => t + 1);
    };

    Engine.on('selectedObjectChanged', clearStatus);
    Engine.on('objectManipulated', onPlacementChanged);
    window.addEventListener('playground-syntax-error', onSyntaxError);
    window.addEventListener('playground-placement-history', onPlacementChanged);
    window.addEventListener('playground-before-run', clearStatus);
    window.addEventListener('playground-update-inspector', onEngineUpdate);

    return () => {
      Engine.off('selectedObjectChanged', clearStatus);
      Engine.off('objectManipulated', onPlacementChanged);
      window.removeEventListener('playground-syntax-error', onSyntaxError);
      window.removeEventListener('playground-placement-history', onPlacementChanged);
      window.removeEventListener('playground-before-run', clearStatus);
      window.removeEventListener('playground-update-inspector', onEngineUpdate);
    };
  }, []);

  const finishPlacement = (object: Dino.GameObject, state: SceneTransformState, message: string) => {
    window.dispatchEvent(new CustomEvent('playground-placement-history', { detail: { object, state } }));
    setPlacementStatus(message);
  };

  const discardPlacement = () => {
    if (!selectedObject || !baseline || Engine.selectedObject !== selectedObject) return;
    restoreSceneTransform(selectedObject, baseline);
    finishPlacement(selectedObject, baseline, 'Discarded canvas changes.');
  };

  const applyPlacement = () => {
    if (!selectedObject || !placement || !baseline) return;
    const sourceId = selectedObject.metadata.sourceId;
    const objects = Engine.currentScene?.objects ?? Engine.objects;
    if (!sourceId || Array.from(objects).filter(object => object.metadata.sourceId === sourceId).length !== 1) {
      setPlacementStatus('This object needs its own constructor in the open script.');
      return;
    }

    window.dispatchEvent(new Event('playground-sync-source-mapping'));
    const mapping = getSourceMapping()[sourceId];
    const sourceGroup = sourceId.slice(0, sourceId.lastIndexOf('-') + 1);
    const sameGroup = Object.keys(getSourceMapping()).filter(id => id.startsWith(sourceGroup) &&
      /^\d+$/.test(id.slice(sourceGroup.length)));
    if (sameGroup.length !== 1) {
      setPlacementStatus('Give this object a unique tag in the open script.');
      return;
    }
    const properties = mapping?.properties;
    const needsLineOrigin = mapping?.type === 'Line' && !properties?.position &&
      (placement.has('drag') || placement.has('p1'));
    const shape = selectedObject.getComponent(Dino.ShapeComponent);
    const paths: string[] = [];
    if (placement.has('drag') && !needsLineOrigin) paths.push('position.x', 'position.y');
    if (placement.has('rotate')) paths.push('rotation');
    const endpoints = (['p1', 'p2'] as const).filter(endpoint => placement.has(endpoint));
    for (const endpoint of endpoints) paths.push(`${endpoint}.x`, `${endpoint}.y`);
    if (placement.has('resize')) {
      if (mapping?.type === 'Sprite') paths.push('scale.x', 'scale.y');
      else if (mapping?.type === 'Circle') paths.push('radius');
      else if (mapping?.type === 'Rectangle' || mapping?.type === 'Text') paths.push('width', 'height');
    }
    // Preserve computed options. A missing line origin is handled separately.
    const valueAt = (path: string): unknown => {
      if (path === 'radius') return shape?.width;
      const resolved = resolveComponentPath(selectedObject, path);
      return resolved?.target?.[resolved.prop];
    };
    const edits: Edit[] = [];
    for (const path of paths) {
      const [option, axis] = path.split('.');
      const property = properties?.[option];
      const literal = axis ? property?.args?.[axis === 'x' ? 0 : 1] : property;
      const value = valueAt(path);
      if ((!literal?.numeric && !(path === 'rotation' && !property)) ||
          typeof value !== 'number' || !Number.isFinite(value)) break;
      const edit = getSurgicalEdit(sourceId, path, Number(value.toFixed(6)), valueAt);
      if (!edit) break;
      edits.push(edit);
    }
    if ((!paths.length && !needsLineOrigin) || edits.length !== paths.length ||
        (placement.has('resize') && !['Sprite', 'Circle', 'Rectangle', 'Text'].includes(mapping?.type))) {
      setPlacementStatus('Use literal transform options in the script to apply this edit.');
      return;
    }
    if (needsLineOrigin) {
      const origin = getLineOriginEdit(sourceId, selectedObject.transform.position);
      if (!origin) {
        setPlacementStatus('Give the line an explicit position in the script before applying this edit.');
        return;
      }
      edits.push(origin);
    }
    const before = baseline;
    const after: SceneTransformState = {};
    if (selectedObject instanceof Dino.Line) {
      for (const endpoint of endpoints) {
        after[endpoint] = endpoint === 'p1'
          ? { x: selectedObject.x1, y: selectedObject.y1 }
          : { x: selectedObject.x2, y: selectedObject.y2 };
      }
    }
    if (before.position) {
      const { x, y } = selectedObject.transform.position;
      after.position = { x, y };
    }
    if (before.rotation !== undefined) after.rotation = selectedObject.transform.rotation;
    if (before.scale) {
      const { x, y } = selectedObject.transform.scale;
      after.scale = { x, y };
    } else if (before.size && selectedObject.bounds) {
      after.size = { x: selectedObject.bounds.width, y: selectedObject.bounds.height };
    }
    const applied = !window.dispatchEvent(new CustomEvent('playground-apply-placement', {
      detail: { edits, object: selectedObject, before, after }, cancelable: true,
    }));
    if (!applied) {
      setPlacementStatus('The open script could not be updated.');
      return;
    }
    finishPlacement(selectedObject, after, 'Applied to code. Save the script to keep it.');
  };

  const handleApplyToCode = () => {
    if (!selectedObject) return;
    const sourceId = selectedObject.metadata.sourceId;
    if (!sourceId) {
      console.warn('Cannot sync object without sourceId. Ensure it was defined in a script.');
      return;
    }

    setIsApplying(true);
    window.dispatchEvent(new Event('playground-sync-source-mapping'));

    const edits: Edit[] = [];

    getInspectorSections(selectedObject).forEach(([, section]) => {
      section.rows.forEach(def => {
        const resolved = resolveComponentPath(selectedObject, def.propertyPath);
        if (resolved && resolved.target) {
          const val = resolved.target[resolved.prop];
          const edit = getSurgicalEdit(sourceId, def.propertyPath, val, (path) => {
            const res = resolveComponentPath(selectedObject, path);
            return res && res.target ? res.target[res.prop] : undefined;
          });
          if (edit && !edits.some(item =>
            item.start === edit.start && item.end === edit.end && item.newText === edit.newText
          )) {
            edits.push(edit);
          }
        }
      });
    });

    if (edits.length > 0) {
      window.dispatchEvent(new CustomEvent('playground-apply-multi-edit', { detail: edits }));
    }
    
    setTimeout(() => setIsApplying(false), 500);
  };

  if (!visible) return null;

  return (
    <div className="inspector-container">
      <div className="inspector-header">
        <div className="header-left">
          <h2>Inspector</h2>
          {selectedObject && !syntaxError && (
            <button 
              className={`apply-btn ${isApplying ? 'applying' : ''}`} 
              onClick={handleApplyToCode}
              title="Apply all current values to code"
            >
              <i className={`fa-solid ${isApplying ? 'fa-check' : 'fa-save'}`} />
              <span>Apply to Code</span>
            </button>
          )}
        </div>
      </div>
      {syntaxError && (
        <div className="syntax-error-banner" style={{ padding: '8px', background: '#dc3545', color: 'white', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <i className="fa-solid fa-triangle-exclamation"></i>
          <span>Code Sync Paused: {syntaxError}</span>
        </div>
      )}
      <div className="inspector-body">
        {!isDebug ? (
          <div className="no-selection">Toggle Debug Mode to inspect objects.</div>
        ) : (
          <div className="inspector-form" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {placement && (
              <section id="canvas-changes" className="inspector-section" aria-labelledby="canvas-changes-title" tabIndex={-1}>
                <h3 id="canvas-changes-title">Canvas changes</h3>
                <p className="inspector-section-description">Changes are live in the scene.</p>
                <button type="button" className="scene-control inspector-apply" onClick={applyPlacement}>
                  <i className="fa-solid fa-code" aria-hidden="true" /> Apply placement to code
                </button>
                <button type="button" className="scene-control" onClick={discardPlacement}>
                  <i className="fa-solid fa-rotate-left" aria-hidden="true" /> Discard canvas changes
                </button>
              </section>
            )}
            {placementStatus && <span className="inspector-action-status" role="status">{placementStatus}</span>}
            {canEditPaletteObject && (
              <div className="inspector-section">
                <h3>Object actions</h3>
                <button type="button" className="scene-control" onClick={duplicateObject}>
                  <i className="fa-solid fa-copy" aria-hidden="true" /> Duplicate object
                </button>
                <button type="button" className="scene-control inspector-delete" onClick={deleteObject}>
                  <i className="fa-solid fa-trash" aria-hidden="true" /> Delete object
                </button>
              </div>
            )}
            <div className="inspector-section">
              <h3>Debug Settings</h3>
              <div className="inspector-row">
                <label htmlFor="inspector-physics-vectors">Physics Vectors</label>
                <input 
                  id="inspector-physics-vectors"
                  type="checkbox" 
                  checked={Engine.showPhysicsVectors} 
                  onChange={(e) => {
                    Engine.showPhysicsVectors = e.target.checked;
                    setTick(t => t + 1);
                  }} 
                />
              </div>
              <div className="inspector-row">
                <label htmlFor="inspector-collision-normals">Collision Normals</label>
                <input 
                  id="inspector-collision-normals"
                  type="checkbox" 
                  checked={Engine.showCollisionLines} 
                  onChange={(e) => {
                    Engine.showCollisionLines = e.target.checked;
                    setTick(t => t + 1);
                  }} 
                />
              </div>
            </div>

            {!selectedObject ? (
              <div className="no-selection">Click an object to inspect.</div>
            ) : (
              getInspectorSections(selectedObject).map(([sectionName, config]) => {
                return (
                  <div key={sectionName} className={sectionName === 'Text' ? 'inspector-section inspector-text-section' : 'inspector-section'}>
                    <h3>{sectionName}</h3>
                    {config.description && <p className="inspector-section-description">{config.description}</p>}
                    {config.rows.map((def) => (
                      <InspectorRow 
                        key={def.propertyPath} 
                        def={def} 
                        selectedObject={selectedObject} 
                        deferSave={baseline && isCanvasTransformProperty(def.propertyPath, baseline)}
                      />
                    ))}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Inspector;
