import React, { useEffect, useRef, useState } from 'react';
import * as Dino from 'dino-ge';
import { usePlayground } from '../context/PlaygroundContext';
import { frameSceneObjectEvent, isSceneFrameShortcut, nudgeSceneSelection, revealSceneObjectEvent, type CanvasPlacement } from '../utils/scene-objects';
import '../styles/scene-explorer.css';

const { Engine } = Dino;

interface SceneTree {
  selectedObject: Dino.GameObject | null;
  onSelect: (obj: Dino.GameObject) => void;
  editing: boolean;
  members: ReadonlySet<Dino.GameObject>;
  filtering: boolean;
  collapsedBranches: ReadonlySet<Dino.GameObject>;
  toggleBranch: (object: Dino.GameObject) => void;
  pending: ReadonlyMap<Dino.GameObject, CanvasPlacement>;
  pendingBranches: ReadonlySet<Dino.GameObject>;
  revealTarget: Dino.GameObject | null;
  revealRow: React.RefObject<HTMLButtonElement | null>;
}

const getSceneObjectName = (object: Dino.GameObject) => object.metadata?.tag || 'GameObject';

const SceneNode: React.FC<{ object: Dino.GameObject; depth: number; tree: SceneTree }> = ({ object, depth, tree }) => {
  const { members, filtering, collapsedBranches, toggleBranch, pending, pendingBranches, editing, selectedObject, onSelect } = tree;
  const children = Array.from(object.transform.children, transform => transform.gameObject)
    .filter((child): child is Dino.GameObject => !!child && members.has(child));

  const hasChildren = children.length > 0;
  const isExpanded = filtering || !collapsedBranches.has(object);
  const isSelected = selectedObject === object;
  const tag = getSceneObjectName(object);
  const hasPendingChanges = pending.has(object);
  const hasHiddenChanges = (filtering || (hasChildren && !isExpanded)) && pendingBranches.has(object);
  const hiddenChildren = filtering ? 'filtered children' : 'collapsed children';
  const pendingDescription = hasHiddenChanges
    ? `Pending canvas changes ${hasPendingChanges ? 'here and ' : ''}in ${hiddenChildren}`
    : (hasPendingChanges ? 'Pending canvas changes' : undefined);

  return (
    <div className="scene-node-container">
      <div
        className={`scene-node ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: `${depth * 12 + 5}px` }}
      >
        {hasChildren && filtering ? (
          <i className="fa-solid fa-caret-down scene-branch-indicator" aria-hidden="true" />
        ) : hasChildren ? (
          <button type="button" className="scene-branch-toggle" aria-expanded={isExpanded}
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} children of ${tag}`}
            onClick={() => toggleBranch(object)}>
            <i className={`fa-solid ${isExpanded ? 'fa-caret-down' : 'fa-caret-right'}`} aria-hidden="true" />
          </button>
        ) : (
          <span className="spacer" />
        )}
        <button type="button" className="scene-node-select" aria-pressed={isSelected}
          ref={object === tree.revealTarget ? tree.revealRow : undefined}
          aria-keyshortcuts={editing ? 'F' : undefined}
          aria-description={pendingDescription} onClick={() => onSelect(object)}
          onKeyDown={event => {
            if (!editing) return;
            if (isSceneFrameShortcut(event)) {
              event.preventDefault();
              event.stopPropagation();
              if (!event.repeat) window.dispatchEvent(new CustomEvent(frameSceneObjectEvent, { detail: object }));
            } else if (isSelected && nudgeSceneSelection(event)) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}>
          <i className={`fa-solid ${getIconForObject(object)} type-icon`} aria-hidden="true" />
          <span className="node-tag" title={editing ? `${tag} · F to frame` : tag}>{tag}</span>
          {pendingDescription && (
            <i className="fa-solid fa-pen scene-node-pending" title={pendingDescription} aria-hidden="true" />
          )}
        </button>
      </div>
      {hasChildren && isExpanded && (
        <div className="node-children">
          {children.map((child) => (
            <SceneNode key={child.id} object={child} depth={depth + 1} tree={tree} />
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
  const { isPaused, isDebug, isToolVisible, openTool, selectedObject, pendingCanvasPlacements } = usePlayground();
  const isExplorerVisible = isToolVisible('explorer');
  const [members, setMembers] = useState(() => new Set(Engine.currentScene?.objects ?? Engine.objects));
  const [collapsedBranches, setCollapsedBranches] = useState<ReadonlySet<Dino.GameObject>>(() => new Set());
  const [query, setQuery] = useState('');
  const [revealTarget, setRevealTarget] = useState<Dino.GameObject | null>(null);
  const revealRow = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const filter = query.trim().toLowerCase();
  const matches = filter ? [...members].filter(object => getSceneObjectName(object).toLowerCase().includes(filter)) : null;
  const visibleMembers = matches ? new Set(matches) : members;
  if (matches) {
    for (const object of matches) {
      let parent = object.transform.parent?.gameObject;
      while (parent && members.has(parent) && !visibleMembers.has(parent)) {
        visibleMembers.add(parent);
        parent = parent.transform.parent?.gameObject;
      }
    }
  }
  const rootObjects = Array.from(members).filter(object => {
    const parent = object.transform.parent?.gameObject;
    return visibleMembers.has(object) && (!parent || !members.has(parent));
  });
  const pendingBranches = new Set<Dino.GameObject>();
  for (const object of pendingCanvasPlacements.keys()) {
    if (!members.has(object) || (matches && visibleMembers.has(object))) continue;
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
        if (disposed) return;
        const current = new Set(Engine.currentScene?.objects ?? Engine.objects);
        setMembers(current);
        setCollapsedBranches(previous => {
          const remaining = [...previous].filter(object => current.has(object));
          return remaining.length === previous.size ? previous : new Set(remaining);
        });
      });
    };
    Engine.on('sceneHierarchyChanged', updateHierarchy);
    updateHierarchy();
    return () => {
      disposed = true;
      Engine.off('sceneHierarchyChanged', updateHierarchy);
    };
  }, []);

  useEffect(() => {
    const reveal = (event: Event) => {
      const { detail: object } = event as CustomEvent<Dino.GameObject>;
      const current = Engine.currentScene?.objects ?? Engine.objects;
      if (Engine.selectedObject !== object || !current.has(object)) return;
      const ancestors = new Set<Dino.GameObject>();
      let parent = object.transform.parent?.gameObject;
      while (parent && current.has(parent) && !ancestors.has(parent)) {
        ancestors.add(parent);
        parent = parent.transform.parent?.gameObject;
      }
      setCollapsedBranches(previous => {
        const next = new Set(previous);
        for (const ancestor of ancestors) next.delete(ancestor);
        return next.size === previous.size ? previous : next;
      });
      const name = getSceneObjectName(object).toLowerCase();
      setQuery(previous => name.includes(previous.trim().toLowerCase()) ? previous : '');
      openTool('explorer');
      setRevealTarget(object);
    };
    window.addEventListener(revealSceneObjectEvent, reveal);
    return () => window.removeEventListener(revealSceneObjectEvent, reveal);
  }, [openTool]);

  useEffect(() => {
    if (!isExplorerVisible || !revealTarget) return;
    const frame = requestAnimationFrame(() => {
      if (Engine.selectedObject === revealTarget) {
        revealRow.current?.focus({ preventScroll: true });
        revealRow.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      setRevealTarget(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [isExplorerVisible, revealTarget]);

  const handleSelect = (obj: Dino.GameObject) => {
    Engine.selectedObject = obj;
    // If not in debug mode, enable it to show the selection
    if (!Engine.debug) {
      Engine.debug = true;
    }
  };

  const toggleBranch = (object: Dino.GameObject) => {
    setCollapsedBranches(previous => {
      const next = new Set(previous);
      if (!next.delete(object)) next.add(object);
      return next;
    });
  };

  const clearSearch = () => {
    setQuery('');
    search.current?.focus();
  };

  const tree: SceneTree = {
    selectedObject, onSelect: handleSelect, editing: isPaused && isDebug, members: visibleMembers,
    filtering: !!matches, collapsedBranches, toggleBranch, pending: pendingCanvasPlacements, pendingBranches,
    revealTarget, revealRow,
  };

  return (
    <div className="scene-explorer">
      <div className="explorer-search" role="search" aria-label="Scene Explorer">
        {!query && <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />}
        <input ref={search} type="search" aria-label="Search scene objects" placeholder="Find objects"
          value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Escape' && query) {
              event.preventDefault();
              event.stopPropagation();
              clearSearch();
            } else if (event.key === 'Enter' && matches?.length === 1) {
              event.preventDefault();
              handleSelect(matches[0]);
            }
          }} />
        {query && <button type="button" aria-label="Clear scene search" title="Clear scene search"
          onClick={clearSearch}><i className="fa-solid fa-xmark" aria-hidden="true" /></button>}
      </div>
      <p className="explorer-search-status" role="status">{matches && (
        matches.length === 0 ? 'No matching objects' : matches.length === 1 ? '1 match · Enter selects' : `${matches.length} matches`
      )}</p>
      <div className="explorer-content">
        {!matches && rootObjects.length === 0 && <div className="empty-scene">No objects in scene</div>}
        {isExplorerVisible && rootObjects.map(object => <SceneNode key={object.id} object={object} depth={0} tree={tree} />)}
      </div>
    </div>
  );
};

export default SceneExplorer;
