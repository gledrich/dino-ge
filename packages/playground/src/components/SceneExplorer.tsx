import React, { useEffect, useState } from 'react';
import * as Dino from 'dino-ge';
import { usePlayground } from '../context/PlaygroundContext';
import { nudgeSceneSelection, type CanvasPlacement } from '../utils/scene-objects';
import '../styles/scene-explorer.css';

const { Engine } = Dino;

interface SceneNodeProps {
  object: Dino.GameObject;
  selectedId: Dino.GameObject | null;
  onSelect: (obj: Dino.GameObject) => void;
  editing: boolean;
  depth: number;
  members: ReadonlySet<Dino.GameObject>;
  pending: ReadonlyMap<Dino.GameObject, CanvasPlacement>;
  pendingBranches: ReadonlySet<Dino.GameObject>;
}

const SceneNode: React.FC<SceneNodeProps> = ({ object, selectedId, onSelect, editing, depth, members, pending, pendingBranches }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  
  const children = Array.from(object.transform.children, transform => transform.gameObject)
    .filter((child): child is Dino.GameObject => !!child && members.has(child));

  const hasChildren = children.length > 0;
  const isSelected = selectedId === object;
  const tag = object.metadata?.tag || 'GameObject';
  const hasPendingChanges = pending.has(object);
  const hasHiddenChanges = hasChildren && !isExpanded && pendingBranches.has(object);
  const pendingDescription = hasHiddenChanges
    ? (hasPendingChanges ? 'Pending canvas changes here and in collapsed children' : 'Pending canvas changes in collapsed children')
    : (hasPendingChanges ? 'Pending canvas changes' : undefined);

  return (
    <div className="scene-node-container">
      <div
        className={`scene-node ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: `${depth * 12 + 5}px` }}
      >
        {hasChildren ? (
          <button type="button" className="scene-branch-toggle" aria-expanded={isExpanded}
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} children of ${tag}`}
            onClick={() => setIsExpanded(expanded => !expanded)}>
            <i className={`fa-solid ${isExpanded ? 'fa-caret-down' : 'fa-caret-right'}`} aria-hidden="true" />
          </button>
        ) : (
          <span className="spacer" />
        )}
        <button type="button" className="scene-node-select" aria-pressed={isSelected}
          aria-description={pendingDescription} onClick={() => onSelect(object)}
          onKeyDown={event => {
            if (editing && isSelected && nudgeSceneSelection(event)) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}>
          <i className={`fa-solid ${getIconForObject(object)} type-icon`} aria-hidden="true" />
          <span className="node-tag">{tag}</span>
          {pendingDescription && (
            <i className="fa-solid fa-pen scene-node-pending" title={pendingDescription} aria-hidden="true" />
          )}
        </button>
      </div>
      {hasChildren && isExpanded && (
        <div className="node-children">
          {children.map((child) => (
            <SceneNode 
              key={child.id} 
              object={child} 
              selectedId={selectedId}
              onSelect={onSelect}
              editing={editing}
              depth={depth + 1}
              members={members}
              pending={pending}
              pendingBranches={pendingBranches}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const getIconForObject = (obj: Dino.GameObject): string => {
  if (obj.constructor.name === 'Circle') return 'fa-circle';
  if (obj.constructor.name === 'Rectangle') return 'fa-square';
  if (obj.constructor.name === 'Sprite') return 'fa-image';
  if (obj.constructor.name === 'Text') return 'fa-font';
  if (obj.constructor.name === 'Line') return 'fa-minus';
  if (obj.constructor.name === 'Tilemap') return 'fa-border-all';
  return 'fa-cube';
};

const SceneExplorer: React.FC = () => {
  const { isPaused, isDebug, selectedObject, pendingCanvasPlacements } = usePlayground();
  const [members, setMembers] = useState(() => new Set(Engine.currentScene?.objects ?? Engine.objects));
  const rootObjects = Array.from(members).filter(object => {
    const parent = object.transform.parent?.gameObject;
    return !parent || !members.has(parent);
  });
  const pendingBranches = new Set<Dino.GameObject>();
  for (const object of pendingCanvasPlacements.keys()) {
    if (!members.has(object)) continue;
    let parent = object.transform.parent?.gameObject;
    while (parent && members.has(parent) && !pendingBranches.has(parent)) {
      pendingBranches.add(parent);
      parent = parent.transform.parent?.gameObject;
    }
  }

  useEffect(() => {
    let scheduled = false;
    let disposed = false;
    const updateHierarchy = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (!disposed) setMembers(new Set(Engine.currentScene?.objects ?? Engine.objects));
      });
    };
    Engine.on('sceneHierarchyChanged', updateHierarchy);
    updateHierarchy();
    return () => {
      disposed = true;
      Engine.off('sceneHierarchyChanged', updateHierarchy);
    };
  }, []);

  const handleSelect = (obj: Dino.GameObject) => {
    Engine.selectedObject = obj;
    // If not in debug mode, enable it to show the selection
    if (!Engine.debug) {
      Engine.debug = true;
    }
  };

  return (
    <div className="scene-explorer">
      <div className="explorer-content">
        {rootObjects.length === 0 ? (
          <div className="empty-scene">No objects in scene</div>
        ) : (
          rootObjects.map((obj) => (
            <SceneNode 
              key={obj.id} 
              object={obj} 
              selectedId={selectedObject}
              onSelect={handleSelect}
              editing={isPaused && isDebug}
              depth={0}
              members={members}
              pending={pendingCanvasPlacements}
              pendingBranches={pendingBranches}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default SceneExplorer;
