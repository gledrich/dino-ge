import React, { useEffect, useState, useCallback } from 'react';
import * as Dino from 'dino-ge';
import InspectorRow, { InspectableObject, PropertyRowDef, resolveComponentPath } from './InspectorRow';
import { getSurgicalEdit, Edit } from '../utils/ast-utils';
import { usePlayground } from '../context/PlaygroundContext';
import '../styles/inspector.css';

const { Engine } = Dino;

interface InspectorProps {
  visible: boolean;
}

const SECTIONS: Record<string, { rows: PropertyRowDef[], component?: any }> = {
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
      { label: 'Rotation', type: 'number', propertyPath: 'rotation' }
    ]
  },
  Bounds: {
    component: Dino.BoundsComponent,
    rows: [
      { label: 'Width', type: 'number', propertyPath: 'width' },
      { label: 'Height', type: 'number', propertyPath: 'height' }
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

const Inspector: React.FC<InspectorProps> = ({ visible }) => {
  const { isDebug } = usePlayground();
  const [selectedObject, setSelectedObject] = useState<InspectableObject | null>(Engine.selectedObject as InspectableObject | null);
  const [isApplying, setIsApplying] = useState(false);
  const [syntaxError, setSyntaxError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!visible) return;

    const onSelectedObjectChanged = (e: any) => {
      setSelectedObject(e.detail as InspectableObject | null);
    };

    const onSyntaxError = (e: Event) => {
      const customEvent = e as CustomEvent<string | null>;
      setSyntaxError(customEvent.detail);
    };

    const onEngineUpdate = () => {
      setTick(t => t + 1);
    };

    Engine.on('selectedObjectChanged', onSelectedObjectChanged);
    window.addEventListener('playground-syntax-error', onSyntaxError);
    window.addEventListener('playground-update-inspector', onEngineUpdate);

    return () => {
      Engine.off('selectedObjectChanged', onSelectedObjectChanged);
      window.removeEventListener('playground-syntax-error', onSyntaxError);
      window.removeEventListener('playground-update-inspector', onEngineUpdate);
    };
  }, [visible]);

  const handleApplyToCode = useCallback(() => {
    if (!selectedObject) return;
    const sourceId = selectedObject.metadata.sourceId;
    if (!sourceId) {
      console.warn('Cannot sync object without sourceId. Ensure it was defined in a script.');
      return;
    }

    setIsApplying(true);
    window.dispatchEvent(new Event('playground-sync-source-mapping'));

    const edits: Edit[] = [];

    Object.values(SECTIONS).forEach(section => {
      if (section.component && !selectedObject.hasComponent(section.component)) {
        return;
      }

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
  }, [selectedObject]);

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
              Object.entries(SECTIONS).map(([sectionName, config]) => {
                if (config.component && !selectedObject.hasComponent(config.component)) {
                  return null;
                }
                
                return (
                  <div key={sectionName} className="inspector-section">
                    <h3>{sectionName}</h3>
                    {config.rows.map((def) => (
                      <InspectorRow 
                        key={def.propertyPath} 
                        def={def} 
                        selectedObject={selectedObject} 
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
