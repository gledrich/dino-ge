import React, { useEffect, useState } from 'react';
import * as Dino from 'dino-ge';
import '../styles/scene-explorer.css';

const { Engine } = Dino;

interface SceneNodeProps {
  object: Dino.GameObject;
  selectedId: Dino.GameObject | null;
  onSelect: (obj: Dino.GameObject) => void;
  depth: number;
}

const SceneNode: React.FC<SceneNodeProps> = ({ object, selectedId, onSelect, depth }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  
  let children: Dino.GameObject[] = [];
  try {
    if (object && object.transform && object.transform.children) {
      children = Array.from(object.transform.children)
        .map(t => t.gameObject)
        .filter((obj): obj is Dino.GameObject => !!obj);
    }
  } catch (err) {
    console.error('Error mapping children in SceneNode:', err);
  }

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
              depth={depth + 1}
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
  const [rootObjects, setRootObjects] = useState<Dino.GameObject[]>([]);
  const [selectedObject, setSelectedObject] = useState<Dino.GameObject | null>(Engine.selectedObject);

  useEffect(() => {
    const updateHierarchy = () => {
      let allObjects: Dino.GameObject[] = [];
      
      const scene = (Engine as any).currentScene;
      const sceneObjects = scene?.objects;
      const globalObjects = Engine.objects;

      if (sceneObjects) {
        allObjects = Array.from(sceneObjects);
      } else {
        allObjects = Array.from(globalObjects);
      }

      const roots = allObjects.filter(obj => {
        try {
          return obj && obj.transform && !obj.transform.parent;
        } catch (err) {
          console.error('Error filtering root objects:', err);
          return false;
        }
      });
      setRootObjects(roots);
    };

    const onSelectedObjectChanged = (e: any) => {
      setSelectedObject(e.detail as Dino.GameObject | null);
      updateHierarchy();
    };

    const onDebugChanged = () => {
      // Re-trigger update on debug change if needed
    };

    Engine.on('selectedObjectChanged', onSelectedObjectChanged);
    Engine.on('debug', onDebugChanged);
    window.addEventListener('playground-scene-history', updateHierarchy);

    // Initial update
    updateHierarchy();

    // Scene hierarchy is relatively static, poll at 1Hz instead of 60Hz
    const intervalId = setInterval(updateHierarchy, 1000);

    return () => {
      Engine.off('selectedObjectChanged', onSelectedObjectChanged);
      Engine.off('debug', onDebugChanged);
      window.removeEventListener('playground-scene-history', updateHierarchy);
      clearInterval(intervalId);
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
              depth={0}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default SceneExplorer;
