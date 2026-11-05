import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import * as Dino from 'dino-ge';
import { getCurrentScriptId } from '../utils/helpers';
import type { CanvasPlacement, ScenePoint, SceneTransformState } from '../utils/scene-objects';

const { Engine } = Dino;

interface PlaygroundContextType {
  currentScriptId: string;
  setCurrentScriptId: (id: string) => void;
  isPaused: boolean;
  setIsPaused: (paused: boolean) => void;
  isDebug: boolean;
  setIsDebug: (debug: boolean) => void;
  isInspectorVisible: boolean;
  setIsInspectorVisible: (visible: boolean) => void;
  selectedObject: Dino.GameObject | null;
  pendingCanvasPlacements: ReadonlyMap<Dino.GameObject, CanvasPlacement>;
  isExplorerVisible: boolean;
  setIsExplorerVisible: (visible: boolean) => void;
  isEditorVisible: boolean;
  setIsEditorVisible: (visible: boolean) => void;
  activeTab: 'editor' | 'console';
  setActiveTab: (tab: 'editor' | 'console') => void;
  isViewportReady: boolean;
  setIsViewportReady: (ready: boolean) => void;
  arePanelsMinimized: boolean;
  setArePanelsMinimized: (minimized: boolean) => void;
  togglePause: () => void;
  toggleDebug: () => void;
  togglePanels: () => void;
}

const PlaygroundContext = createContext<PlaygroundContextType | undefined>(undefined);

export const PlaygroundProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentScriptId, setCurrentScriptIdState] = useState(getCurrentScriptId());
  const [isPaused, setIsPausedState] = useState(false);
  const [isDebug, setIsDebugState] = useState(false);
  const [isInspectorVisible, setIsInspectorVisible] = useState(true);
  const [selectedObject, setSelectedObject] = useState(Engine.selectedObject);
  const [pendingCanvasPlacements, setPendingCanvasPlacements] = useState<ReadonlyMap<Dino.GameObject, CanvasPlacement>>(() => new Map());
  const [isExplorerVisible, setIsExplorerVisible] = useState(true);
  const [isEditorVisible, setIsEditorVisible] = useState(true);
  const [activeTab, setActiveTab] = useState<'editor' | 'console'>('editor');
  const [isViewportReady, setIsViewportReady] = useState(false);
  const [arePanelsMinimized, setArePanelsMinimized] = useState(false);

  // Sync state with Engine
  useEffect(() => {
    (globalThis as any).Engine = Engine;

    const onPaused = (e: any) => setIsPausedState(e.detail);
    const onDebug = (e: any) => setIsDebugState(e.detail);
    const onSelection = ({ detail }: CustomEvent<Dino.GameObject | null>) => setSelectedObject(detail);
    const onManipulation = ({ detail }: CustomEvent<{
      object: Dino.GameObject; kind: Dino.ObjectManipulationPreview['kind']; initial: ScenePoint;
    }>) => {
      const { object, kind, initial } = detail;
      setPendingCanvasPlacements(pending => {
        const previous = pending.get(object);
        if (previous?.has(kind)) return pending;
        const changes = new Map(previous);
        changes.set(kind, { x: initial.x, y: initial.y });
        return new Map(pending).set(object, changes);
      });
    };
    const onPlacementHistory = (event: Event) => {
      const { object, state } = (event as CustomEvent<{ object: Dino.GameObject; state: SceneTransformState }>).detail;
      setPendingCanvasPlacements(pending => {
        const previous = pending.get(object);
        if (!previous) return pending;
        const changes = new Map(previous);
        if (state.position) changes.delete('drag');
        if (state.scale || state.size) changes.delete('resize');
        if (state.rotation !== undefined) changes.delete('rotate');
        if (state.p1) changes.delete('p1');
        if (state.p2) changes.delete('p2');
        if (changes.size === previous.size) return pending;
        const next = new Map(pending);
        if (changes.size) next.set(object, changes);
        else next.delete(object);
        return next;
      });
    };
    const clearPendingPlacements = () => setPendingCanvasPlacements(pending => pending.size ? new Map() : pending);

    Engine.on('paused', onPaused);
    Engine.on('debug', onDebug);
    Engine.on('selectedObjectChanged', onSelection);
    Engine.on('objectManipulated', onManipulation);
    window.addEventListener('playground-placement-history', onPlacementHistory);
    window.addEventListener('playground-before-run', clearPendingPlacements);

    return () => {
      Engine.off('paused', onPaused);
      Engine.off('debug', onDebug);
      Engine.off('selectedObjectChanged', onSelection);
      Engine.off('objectManipulated', onManipulation);
      window.removeEventListener('playground-placement-history', onPlacementHistory);
      window.removeEventListener('playground-before-run', clearPendingPlacements);
    };
  }, []);

  const setIsPaused = useCallback((paused: boolean) => {
    setIsPausedState(paused);
    if (Engine.paused !== paused) Engine.paused = paused;
  }, []);

  const setIsDebug = useCallback((debug: boolean) => {
    setIsDebugState(debug);
    if (Engine.debug !== debug) Engine.debug = debug;
  }, []);

  const togglePause = useCallback(() => {
    setIsPaused(!isPaused);
  }, [isPaused, setIsPaused]);

  const toggleDebug = useCallback(() => {
    const newDebug = !isDebug;
    setIsDebug(newDebug);
    if (newDebug && !isInspectorVisible) setIsInspectorVisible(true);
  }, [isDebug, isInspectorVisible, setIsDebug]);

  const togglePanels = useCallback(() => {
    setArePanelsMinimized(prev => !prev);
  }, []);

  const setCurrentScriptId = useCallback((id: string) => {
    setCurrentScriptIdState(id);
  }, []);

  const value = {
    currentScriptId,
    setCurrentScriptId,
    isPaused,
    setIsPaused,
    isDebug,
    setIsDebug,
    isInspectorVisible,
    setIsInspectorVisible,
    selectedObject,
    pendingCanvasPlacements,
    isExplorerVisible,
    setIsExplorerVisible,
    isEditorVisible,
    setIsEditorVisible,
    activeTab,
    setActiveTab,
    isViewportReady,
    setIsViewportReady,
    arePanelsMinimized,
    setArePanelsMinimized,
    togglePause,
    toggleDebug,
    togglePanels,
  };

  return (
    <PlaygroundContext.Provider value={value}>
      {children}
    </PlaygroundContext.Provider>
  );
};

export const usePlayground = () => {
  const context = useContext(PlaygroundContext);
  if (context === undefined) {
    throw new Error('usePlayground must be used within a PlaygroundProvider');
  }
  return context;
};
