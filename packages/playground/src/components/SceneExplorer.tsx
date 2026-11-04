import React, { useEffect, useState } from 'react';
import * as Dino from 'dino-ge';
import { usePlayground } from '../context/PlaygroundContext';
import { nudgeSceneSelection } from '../utils/scene-objects';
import '../styles/scene-explorer.css';

const { Engine } = Dino;

interface SceneNodeProps {
  object: Dino.GameObject;
  selectedId: Dino.GameObject | null;
  onSelect: (obj: Dino.GameObject) => void;
  editing: boolean;
  depth: number;
  members: ReadonlySet<Dino.GameObject>;
}

const SceneNode: React.FC<SceneNodeProps> = ({ object, selectedId, onSelect, editing, depth, members }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  
  const children = Array.from(object.transform.children, transform => transform.gameObject)
    .filter((child): child is Dino.GameObject => !!child && members.has(child));

  const hasChildren = children.length > 0;
  const isSelected = selectedId === object;

  return (
    <div className="scene-node-container">
      <div 
        className={`scene-node ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: `${depth * 12 + 5}px` }}
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        onClick={() => onSelect(object)}
        onKeyDown={event => {
          if (editing && isSelected && nudgeSceneSelection(event)) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          onSelect(object);
        }}
      >
        {hasChildren ? (
          <i 
            className={`fa-solid ${isExpanded ? 'fa-caret-down' : 'fa-caret-right'} toggle-icon`}
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
          />
        ) : (
          <span className="spacer" />
        )}
        <i className={`fa-solid ${getIconForObject(object)} type-icon`} />
        <span className="node-tag">{object.metadata?.tag || 'GameObject'}</span>
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
  const { isPaused, isDebug } = usePlayground();
  const [members, setMembers] = useState(() => new Set(Engine.currentScene?.objects ?? Engine.objects));
  const rootObjects = Array.from(members).filter(object => {
    const parent = object.transform.parent?.gameObject;
    return !parent || !members.has(parent);
  });
  const [selectedObject, setSelectedObject] = useState<Dino.GameObject | null>(Engine.selectedObject);

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
    const onSelectedObjectChanged = (event: CustomEvent<Dino.GameObject | null>) => {
      setSelectedObject(event.detail);
    };

    Engine.on('selectedObjectChanged', onSelectedObjectChanged);
    Engine.on('sceneHierarchyChanged', updateHierarchy);
    updateHierarchy();
    return () => {
      disposed = true;
      Engine.off('selectedObjectChanged', onSelectedObjectChanged);
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
            />
          ))
        )}
      </div>
    </div>
  );
};

export default SceneExplorer;
