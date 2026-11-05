import React, { useEffect, useState } from 'react';
import * as Dino from 'dino-ge';
import InspectorRow, { clearInspectorPlacementBaselines, InspectableObject, PropertyRowDef, resolveComponentPath } from './InspectorRow';
import { applyEditsToSource, findObjectConstructor, getLineOriginEdit, getStandaloneSceneObject, getSurgicalEdit, getSourceMapping, readObjectSourceMappings, type CanvasPlacementTransaction, type Edit } from '../utils/ast-utils';
import { usePlayground } from '../context/PlaygroundContext';
import { getProjectObjectLocation, getProjectObjectSource, openProjectObjectSourceEvent, type ProjectObjectSourceRequest } from '../utils/project-object-source';
import { getCanvasPlacementBaseline, isCanvasTransformProperty, openEntryObjectSourceEvent, restoreSceneTransform, revealSceneObjectEvent, type CanvasPlacement, type SceneTransformState } from '../utils/scene-objects';
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
      { label: 'Text colour', type: 'colour', propertyPath: 'colour' },
      { label: 'Background', type: 'colour', propertyPath: 'backgroundColour', emptyColourLabel: 'None' },
    ]
  },
  Appearance: {
    component: Dino.ShapeComponent,
    rows: [{ label: 'Fill colour', type: 'colour', propertyPath: 'colour' }],
  },
  Bounds: {
    component: Dino.BoundsComponent,
    rows: [
      { label: 'Width', type: 'number', propertyPath: 'width' },
      { label: 'Height', type: 'number', propertyPath: 'height' }
    ]
  },
  Circle: {
    component: Dino.ShapeComponent,
    rows: [
      { label: 'Radius', type: 'number', propertyPath: 'radius', min: Number.MIN_VALUE },
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
      { label: 'Stroke colour', type: 'colour', propertyPath: 'colour', emptyColourLabel: 'Inherit' },
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
    if (name === 'Circle') return object instanceof Dino.Circle && object.hasComponent(component);
    if (name === 'Bounds' && (object instanceof Dino.Circle || object.hasComponent(Dino.LineComponent))) return false;
    return object.hasComponent(component);
  });

function getModulePlacementKind(object: Dino.GameObject, path: string): Dino.ObjectManipulationPreview['kind'] | undefined {
  if (path === 'position.x' || path === 'position.y') return 'drag';
  if (path === 'rotation') return 'rotate';
  if (object instanceof Dino.Line) {
    if (path === 'p1.x' || path === 'p1.y') return 'p1';
    if (path === 'p2.x' || path === 'p2.y') return 'p2';
  }
  if (object instanceof Dino.Sprite && (path === 'scale.x' || path === 'scale.y')) return 'resize';
  if (object instanceof Dino.Circle && path === 'radius') return 'resize';
  if ((object instanceof Dino.Rectangle || object instanceof Dino.Text) && (path === 'width' || path === 'height')) return 'resize';
}

function prepareCanvasPlacement(object: Dino.GameObject, placement: CanvasPlacement,
  sourceId: string, mappings = getSourceMapping()) {
  const mapping = mappings[sourceId];
  const sourceGroup = sourceId.slice(0, sourceId.lastIndexOf('-') + 1);
  const sameGroup = Object.keys(mappings).filter(id => id.startsWith(sourceGroup) &&
    /^\d+$/.test(id.slice(sourceGroup.length)));
  if (sameGroup.length !== 1) {
    return 'Give this object a unique tag in the open script.';
  }
  const properties = mapping?.properties;
  const needsLineOrigin = mapping?.type === 'Line' && !properties?.position &&
    (placement.has('drag') || placement.has('p1'));
  const shape = object.getComponent(Dino.ShapeComponent);
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
    const resolved = resolveComponentPath(object, path);
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
    const rounded = Number(value.toFixed(6));
    if ((path === 'width' || path === 'height' || path === 'radius') && rounded <= 0) return 'Use dimensions greater than zero.';
    const edit = getSurgicalEdit(sourceId, path, rounded, valueAt, mappings);
    if (!edit) break;
    edits.push(edit);
  }
  if ((!paths.length && !needsLineOrigin) || edits.length !== paths.length ||
      (placement.has('resize') && !['Sprite', 'Circle', 'Rectangle', 'Text'].includes(mapping?.type))) {
    return 'Use literal transform options in the script to apply this edit.';
  }
  if (needsLineOrigin) {
    const origin = getLineOriginEdit(sourceId, object.transform.position, mappings);
    if (!origin) {
      return 'Give the line an explicit position in the script before applying this edit.';
    }
    edits.push(origin);
  }
  const before = getCanvasPlacementBaseline(object, placement);
  const after: SceneTransformState = {};
  if (object instanceof Dino.Line) {
    for (const endpoint of endpoints) {
      after[endpoint] = endpoint === 'p1'
        ? { x: object.x1, y: object.y1 }
        : { x: object.x2, y: object.y2 };
    }
  }
  if (before.position) {
    const { x, y } = object.transform.position;
    after.position = { x, y };
  }
  if (before.rotation !== undefined) after.rotation = object.transform.rotation;
  if (before.scale) {
    const { x, y } = object.transform.scale;
    after.scale = { x, y };
  } else if (before.size && object.bounds) {
    after.size = { x: object.bounds.width, y: object.bounds.height };
  }
  return { edits, transform: { object, before, after } };
}

const Inspector: React.FC<InspectorProps> = ({ visible }) => {
  const { currentScriptId, isDebug, isPaused, selectedObject, pendingCanvasPlacements } = usePlayground();
  const placement = selectedObject ? pendingCanvasPlacements.get(selectedObject) : undefined;
  const [isApplying, setIsApplying] = useState(false);
  const [syntaxError, setSyntaxError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [placementStatus, setPlacementStatus] = useState('');
  const activeObjects = Engine.currentScene?.objects ?? Engine.objects;
  const activePending = Array.from(pendingCanvasPlacements.keys()).filter(object => activeObjects.has(object));
  const pendingCount = activePending.length;
  const canApplyAll = activePending.every(object => !!object.metadata.sourceId);
  const hasPendingCanvasChanges = pendingCanvasPlacements.size > 0;
  const baseline = selectedObject && placement ? getCanvasPlacementBaseline(selectedObject, placement) : undefined;
  const sourceId = selectedObject?.metadata.sourceId;
  const moduleSource = selectedObject ? getProjectObjectSource(selectedObject) : undefined;
  const canOpenModule = moduleSource?.scriptId === currentScriptId;
  const canStageModuleTransform = canOpenModule && isPaused && !!selectedObject &&
    [Dino.Rectangle, Dino.Circle, Dino.Text, Dino.Line, Dino.Sprite].some(Type => selectedObject.constructor === Type);
  const modulePlacements = canOpenModule ? Array.from(pendingCanvasPlacements).flatMap(([object, changes]) => {
    const source = getProjectObjectSource(object);
    return activeObjects.has(object) && source?.scriptId === currentScriptId && source.run === moduleSource.run &&
      source.path === moduleSource.path ? [{ object, changes, source }] : [];
  }) : [];
  const standalone = isPaused && !syntaxError && sourceId && selectedObject &&
    !selectedObject.transform.parent && !selectedObject.transform.children.size ? getStandaloneSceneObject(sourceId) : null;
  const objectActions = standalone && Dino[standalone.mapping.type as keyof typeof Dino] === selectedObject?.constructor &&
    Array.from(activeObjects).filter(object => object.metadata.sourceId === sourceId).length === 1 ? standalone : null;
  const watchSceneChanges = hasPendingCanvasChanges || !!standalone;

  const deleteObject = () => {
    if (!selectedObject) return;
    const accepted = !window.dispatchEvent(new CustomEvent('playground-remove-scene-object', {
      detail: selectedObject, cancelable: true,
    }));
    if (!accepted) setPlacementStatus('Delete is available for standalone objects in the open script.');
  };

  const duplicateObject = () => {
    if (!selectedObject) return;
    const accepted = !window.dispatchEvent(new CustomEvent('playground-duplicate-scene-object', {
      detail: selectedObject, cancelable: true,
    }));
    if (!accepted) setPlacementStatus('Duplicate is available for standalone objects with literal options in the open script.');
  };

  useEffect(() => {
    const clearStatus = () => setPlacementStatus('');
    const onPlacementChanged = (event: Event) => {
      const { object } = (event as CustomEvent<{ object: Dino.GameObject }>).detail;
      if (Engine.selectedObject === object) clearStatus();
    };
    const onPlacementHistory = (event: Event) => {
      const { object, state } = (event as CustomEvent<{ object: Dino.GameObject; state: SceneTransformState }>).detail;
      clearInspectorPlacementBaselines(object, state);
      onPlacementChanged(event);
    };

    const onSyntaxError = (e: Event) => {
      const customEvent = e as CustomEvent<string | null>;
      setSyntaxError(customEvent.detail);
      setTick(tick => tick + 1);
    };

    const onEngineUpdate = () => {
      setTick(t => t + 1);
    };

    Engine.on('selectedObjectChanged', clearStatus);
    Engine.on('objectManipulated', onPlacementChanged);
    window.addEventListener('playground-syntax-error', onSyntaxError);
    window.addEventListener('playground-placement-history', onPlacementHistory);
    window.addEventListener('playground-scene-history', clearStatus);
    window.addEventListener('playground-before-run', clearStatus);
    window.addEventListener('playground-update-inspector', onEngineUpdate);

    return () => {
      Engine.off('selectedObjectChanged', clearStatus);
      Engine.off('objectManipulated', onPlacementChanged);
      window.removeEventListener('playground-syntax-error', onSyntaxError);
      window.removeEventListener('playground-placement-history', onPlacementHistory);
      window.removeEventListener('playground-scene-history', clearStatus);
      window.removeEventListener('playground-before-run', clearStatus);
      window.removeEventListener('playground-update-inspector', onEngineUpdate);
    };
  }, []);

  useEffect(() => {
    if (!watchSceneChanges) return;
    const updateScene = () => setTick(tick => tick + 1);
    Engine.on('sceneHierarchyChanged', updateScene);
    return () => { Engine.off('sceneHierarchyChanged', updateScene); };
  }, [watchSceneChanges]);

  const discardPlacement = () => {
    if (!selectedObject || !baseline || Engine.selectedObject !== selectedObject) return;
    restoreSceneTransform(selectedObject, baseline);
    window.dispatchEvent(new CustomEvent('playground-placement-history', {
      detail: { object: selectedObject, state: baseline },
    }));
    setPlacementStatus('Discarded canvas changes.');
  };

  const applyPlacements = (all: boolean) => {
    const objects = Engine.currentScene?.objects ?? Engine.objects;
    const entries = all ? Array.from(pendingCanvasPlacements).filter(([object]) => objects.has(object))
      : selectedObject && placement ? [[selectedObject, placement] as const] : [];
    if (!entries.length) return;

    window.dispatchEvent(new Event('playground-sync-source-mapping'));
    const transaction: CanvasPlacementTransaction = { edits: [], transforms: [] };
    for (const [object, changes] of entries) {
      const id = object.metadata.sourceId;
      const result = id && Array.from(objects).filter(member => member.metadata.sourceId === id).length === 1
        ? prepareCanvasPlacement(object, changes, id)
        : 'This object needs its own constructor in the open script.';
      if (typeof result === 'string') {
        setPlacementStatus(all ? `${object.metadata.tag || 'GameObject'}: ${result}` : result);
        return;
      }
      transaction.edits.push(...result.edits);
      transaction.transforms.push(result.transform);
    }
    const applied = !window.dispatchEvent(new CustomEvent<CanvasPlacementTransaction>('playground-apply-placement', {
      detail: transaction, cancelable: true,
    }));
    if (!applied) {
      setPlacementStatus('The open script could not be updated.');
      return;
    }
    setPlacementStatus(all ? `Applied canvas changes for ${entries.length} objects.` : 'Applied to code.');
  };

  const reviewModulePlacement = (trigger: HTMLButtonElement) => {
    if (!moduleSource || !modulePlacements.length) return;
    const scene = Engine.currentScene;
    const candidates = modulePlacements.map(({ object, changes, source }) => {
      const positions = Array.from(changes.keys(), kind => {
        const { x, y } = Dino.Input.getObjectManipulationValue(object, kind);
        return { kind, x, y };
      });
      const placementMatches = () => scene === Engine.currentScene && (scene?.objects ?? Engine.objects).has(object) &&
        positions.every(({ kind, x, y }) => {
          const current = Dino.Input.getObjectManipulationValue(object, kind);
          return current.x === x && current.y === y;
        });
      return { object, changes, source, placementMatches };
    });
    window.dispatchEvent(new CustomEvent<ProjectObjectSourceRequest>(openProjectObjectSourceEvent, {
      detail: { source: moduleSource, trigger, prepareDraft: value => {
        const mappings = readObjectSourceMappings(value);
        if (!mappings) return 'Fix the syntax in this module before applying canvas placements.';
        const edits: Edit[] = [];
        const applied: { object: Dino.GameObject; state: SceneTransformState; placementMatches: () => boolean }[] = [];
        for (const { object, changes, source, placementMatches } of candidates) {
          const location = getProjectObjectLocation(source, value);
          if (!location) return 'Reset the game to refresh the source locations before applying changes to this module.';
          if (!placementMatches()) return 'The canvas placement changed. Review the latest placement from the Inspector.';
          const matches = Array.from(scene?.objects ?? Engine.objects).filter(member => {
            const other = getProjectObjectSource(member);
            return other?.run === source.run && other.path === source.path &&
              other.lineNumber === source.lineNumber && other.column === source.column;
          });
          const tag = object.metadata.tag;
          if (matches.length !== 1) return `${tag}: Use a constructor that creates one object in the scene.`;
          const mapping = findObjectConstructor(mappings, value, location.lineNumber, location.column);
          if (!mapping || mapping.hasDynamicProperties || Dino[mapping.type as keyof typeof Dino] !== object.constructor ||
              mapping.literalTag !== tag) {
            return `${tag}: Use a Dino GE constructor with a literal tag and options at the recorded location.`;
          }
          const result = prepareCanvasPlacement(object, changes, mapping.sourceId, mappings);
          if (typeof result === 'string') return `${tag}: ${result}`;
          edits.push(...result.edits);
          applied.push({ object, state: result.transform.after, placementMatches });
        }
        const updated = applyEditsToSource(value, edits);
        if (updated === undefined || updated === value || !readObjectSourceMappings(updated)) {
          return 'This placement could not be added to the module draft.';
        }
        return { value: updated, edits, onSaved: () => {
          for (const { object, state, placementMatches } of applied) {
            if (!placementMatches()) continue;
            window.dispatchEvent(new CustomEvent('playground-placement-history', { detail: { object, state } }));
          }
        } };
      } },
    }));
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
        if (def.propertyPath === 'tag') return;
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
          {sourceId && !syntaxError && (
            <button 
              className={`apply-btn ${isApplying ? 'applying' : ''}`} 
              onClick={handleApplyToCode}
              title="Apply current values to code. Save the tag separately."
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
            {(placement || pendingCount > 1) && (
              <section id="canvas-changes" className="inspector-section" aria-labelledby="canvas-changes-title" tabIndex={-1}>
                <h3 id="canvas-changes-title">Canvas changes</h3>
                {pendingCount > 1 && (
                  <>
                    <p className="inspector-section-description">{pendingCount} objects in this scene have pending changes.</p>
                    {canApplyAll && <button type="button" className="scene-control inspector-apply" onClick={() => applyPlacements(true)}>
                      <i className="fa-solid fa-code" aria-hidden="true" /> Apply all canvas changes
                    </button>}
                  </>
                )}
                {placement && (
                  <>
                    {canOpenModule ? <p className="inspector-section-description">Review changes in this object’s source module.</p>
                      : !sourceId ? <p className="inspector-section-description">This placement affects the live scene.</p>
                      : pendingCount <= 1 && <p className="inspector-section-description">Apply these changes before saving the script.</p>}
                    {(canOpenModule || sourceId) && <button type="button" className={`scene-control${pendingCount <= 1 ? ' inspector-apply' : ''}`}
                      onClick={event => canOpenModule ? reviewModulePlacement(event.currentTarget) : applyPlacements(false)}>
                      <i className="fa-solid fa-code" aria-hidden="true" /> {canOpenModule
                        ? (modulePlacements.length > 1 ? `Review ${modulePlacements.length} placements in module` : 'Review placement in module')
                        : 'Apply placement to code'}
                    </button>}
                    <button type="button" className="scene-control" onClick={discardPlacement}>
                      <i className="fa-solid fa-rotate-left" aria-hidden="true" /> Discard canvas changes
                    </button>
                  </>
                )}
              </section>
            )}
            {placementStatus && <span className="inspector-action-status" role="status">{placementStatus}</span>}
            {selectedObject && (
              <div className="inspector-section">
                <h3>Object actions</h3>
                <button type="button" className="scene-control" onClick={() => {
                  window.dispatchEvent(new CustomEvent(revealSceneObjectEvent, { detail: selectedObject }));
                }}>
                  <i className="fa-solid fa-list" aria-hidden="true" /> Reveal in Explorer
                </button>
                {(canOpenModule || sourceId) && <button type="button" className="scene-control"
                  title={canOpenModule ? moduleSource.path : 'Open the constructor in the script editor'} onClick={event => {
                    if (canOpenModule) {
                      window.dispatchEvent(new CustomEvent<ProjectObjectSourceRequest>(openProjectObjectSourceEvent, {
                        detail: { source: moduleSource, trigger: event.currentTarget },
                      }));
                    } else {
                      const accepted = !window.dispatchEvent(new CustomEvent(openEntryObjectSourceEvent, {
                        detail: selectedObject, cancelable: true,
                      }));
                      setPlacementStatus(accepted ? '' : 'Could not locate a unique constructor in the open script.');
                    }
                  }}>
                  <i className="fa-solid fa-code" aria-hidden="true" /> View source
                </button>}
                {objectActions?.statement.canDuplicate && <button type="button" className="scene-control" onClick={duplicateObject}>
                  <i className="fa-solid fa-copy" aria-hidden="true" /> Duplicate object
                </button>}
                {objectActions && <button type="button" className="scene-control inspector-delete" onClick={deleteObject}>
                  <i className="fa-solid fa-trash" aria-hidden="true" /> Delete object
                </button>}
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

            {selectedObject && !sourceId && <p className="inspector-section-description">
              {canStageModuleTransform ? 'Fields marked with the code icon can be reviewed in the source module. All fields update the live scene.'
                : canOpenModule && !isPaused ? 'Enter Edit scene to review supported transform edits in the source module.'
                  : 'Inspector edits affect the live scene.'}
            </p>}
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
                        canSaveToCode={!!sourceId && !syntaxError}
                        placementKind={canStageModuleTransform ? getModulePlacementKind(selectedObject, def.propertyPath) : undefined}
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
