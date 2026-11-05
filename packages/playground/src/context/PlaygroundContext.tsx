import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import * as Dino from 'dino-ge';
import { getCurrentScriptId } from '../utils/helpers';
import type { CanvasPlacement } from '../utils/scene-objects';
import { useCanvasHistory } from '../hooks/useCanvasHistory';
import { useWorkspaceDocks } from '../hooks/useWorkspaceDocks';

const { Engine } = Dino;

interface PlaygroundContextType extends ReturnType<typeof useWorkspaceDocks> {
  currentScriptId: string;
  setCurrentScriptId: (id: string) => void;
  isPaused: boolean;
  setIsPaused: (paused: boolean) => void;
  isDebug: boolean;
  setIsDebug: (debug: boolean) => void;
  selectedObject: Dino.GameObject | null;
  pendingCanvasPlacements: ReadonlyMap<Dino.GameObject, CanvasPlacement>;
  canUndoCanvasEdit: boolean;
  canRedoCanvasEdit: boolean;
  changeCanvasHistory: (action: 'undo' | 'redo') => boolean;
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
  const [selectedObject, setSelectedObject] = useState(Engine.selectedObject);
  const canvasHistory = useCanvasHistory();
  const [isViewportReady, setIsViewportReady] = useState(false);
  const [arePanelsMinimized, setArePanelsMinimized] = useState(false);
  const restorePanels = useCallback(() => setArePanelsMinimized(false), []);
  const workspace = useWorkspaceDocks(arePanelsMinimized, restorePanels);

  // Sync state with Engine
  useEffect(() => {
    (globalThis as any).Engine = Engine;

    const onPaused = (e: any) => setIsPausedState(e.detail);
    const onDebug = (e: any) => setIsDebugState(e.detail);
    const onSelection = ({ detail }: CustomEvent<Dino.GameObject | null>) => setSelectedObject(detail);
    Engine.on('paused', onPaused);
    Engine.on('debug', onDebug);
    Engine.on('selectedObjectChanged', onSelection);

    return () => {
      Engine.off('paused', onPaused);
      Engine.off('debug', onDebug);
      Engine.off('selectedObjectChanged', onSelection);
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
    setIsDebug(!isDebug);
  }, [isDebug, setIsDebug]);

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
    selectedObject,
    ...canvasHistory,
    ...workspace,
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
