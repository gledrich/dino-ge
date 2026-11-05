import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Engine, Input, type GameObject, type ObjectManipulationPreview, type Scene } from 'dino-ge';
import { getCanvasPlacementBaseline, restoreSceneTransform, type CanvasPlacement, type ScenePoint, type SceneTransformState } from '../utils/scene-objects';

type EditKind = ObjectManipulationPreview['kind'];
type HistoryAction = 'undo' | 'redo';

interface CanvasEdit {
  scene: Scene | null;
  object: GameObject;
  kind: EditKind;
  before: ScenePoint;
  after: ScenePoint;
  group?: symbol;
}

interface CanvasHistory {
  scene: Scene | null;
  undo: CanvasEdit[];
  redo: CanvasEdit[];
}

const editLabels: Record<EditKind, string> = {
  drag: 'move', resize: 'resize', rotate: 'rotation', p1: 'line start edit', p2: 'line end edit',
};

export function useCanvasHistory() {
  const [history, setHistory] = useState<CanvasHistory>(() => ({ scene: Engine.currentScene, undo: [], redo: [] }));
  const currentHistory = useRef(history);
  const updateHistory = useCallback((next: CanvasHistory) => {
    currentHistory.current = next;
    setHistory(next);
  }, []);

  useEffect(() => {
    const onManipulation = ({ detail }: CustomEvent<{ object: GameObject; kind: EditKind; initial: ScenePoint; group?: symbol }>) => {
      const { object, kind, initial, group } = detail;
      const scene = Engine.currentScene;
      if (!(scene?.objects ?? Engine.objects).has(object)) return;
      const after = Input.getObjectManipulationValue(object, kind);
      if (initial.x === after.x && initial.y === after.y) return;
      const { undo, redo } = currentHistory.current;
      const last = undo.at(-1);
      const coalesced = group && last?.group === group && last.object === object && last.scene === scene && last.kind === kind;
      const before = coalesced ? last.before : { x: initial.x, y: initial.y };
      const entries = coalesced ? undo.slice(0, -1) : [...undo];
      if (before.x !== after.x || before.y !== after.y) entries.push({ scene, object, kind, before, after, group });
      updateHistory({ scene, undo: entries, redo: redo.filter(edit => edit.scene !== scene) });
    };

    const onPlacementHistory = (event: Event) => {
      const { object, state } = (event as CustomEvent<{ object: GameObject; state: SceneTransformState }>).detail;
      const resolved: Record<EditKind, boolean> = {
        drag: !!state.position, resize: !!(state.scale || state.size), rotate: state.rotation !== undefined,
        p1: !!state.p1, p2: !!state.p2,
      };
      const current = currentHistory.current;
      const keep = (edit: CanvasEdit) => edit.object !== object || !resolved[edit.kind];
      const undo = current.undo.filter(keep);
      const redo = current.redo.filter(keep);
      if (undo.length !== current.undo.length || redo.length !== current.redo.length) updateHistory({ ...current, undo, redo });
    };

    const onHierarchyChanged = () => {
      const current = currentHistory.current;
      const scene = Engine.currentScene;
      const members = scene?.objects ?? Engine.objects;
      const keep = (edit: CanvasEdit) => edit.scene !== scene || members.has(edit.object);
      const undo = current.undo.filter(keep);
      const redo = current.redo.filter(keep);
      if (scene !== current.scene || undo.length !== current.undo.length || redo.length !== current.redo.length) {
        updateHistory({ scene, undo, redo });
      }
    };

    const reset = () => updateHistory({ scene: Engine.currentScene, undo: [], redo: [] });
    Engine.on('objectManipulated', onManipulation);
    Engine.on('sceneHierarchyChanged', onHierarchyChanged);
    window.addEventListener('playground-placement-history', onPlacementHistory);
    window.addEventListener('playground-before-run', reset);
    return () => {
      Engine.off('objectManipulated', onManipulation);
      Engine.off('sceneHierarchyChanged', onHierarchyChanged);
      window.removeEventListener('playground-placement-history', onPlacementHistory);
      window.removeEventListener('playground-before-run', reset);
    };
  }, [updateHistory]);

  const changeCanvasHistory = useCallback((action: HistoryAction) => {
    const current = currentHistory.current;
    const scene = Engine.currentScene;
    const members = scene?.objects ?? Engine.objects;
    const entries = current[action];
    const index = entries.findLastIndex(edit => edit.scene === scene && members.has(edit.object));
    if (index < 0) return false;
    const entry = entries[index];
    const remaining = entries.filter((_, i) => i !== index);
    const undo = action === 'undo';
    updateHistory({ scene,
      undo: undo ? remaining : [...current.undo, entry],
      redo: undo ? [...current.redo, entry] : remaining,
    });
    const transform = getCanvasPlacementBaseline(entry.object, new Map([[entry.kind, undo ? entry.before : entry.after]]));
    restoreSceneTransform(entry.object, transform);
    window.dispatchEvent(new CustomEvent('playground-scene-history', {
      detail: `${undo ? 'Undid' : 'Redid'} canvas ${editLabels[entry.kind]} for ${entry.object.metadata.tag}.`,
    }));
    return true;
  }, [updateHistory]);

  const pendingCanvasPlacements = useMemo<ReadonlyMap<GameObject, CanvasPlacement>>(() => {
    const pending = new Map<GameObject, Map<EditKind, ScenePoint>>();
    for (const { object, kind, before } of history.undo) {
      const placement = pending.get(object) ?? new Map<EditKind, ScenePoint>();
      if (!placement.has(kind)) placement.set(kind, before);
      pending.set(object, placement);
    }
    return pending;
  }, [history.undo]);

  return {
    pendingCanvasPlacements,
    canUndoCanvasEdit: history.undo.some(edit => edit.scene === history.scene),
    canRedoCanvasEdit: history.redo.some(edit => edit.scene === history.scene),
    changeCanvasHistory,
  };
}
