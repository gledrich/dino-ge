import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import * as Dino from 'dino-ge';
import { getCurrentScriptId } from '../utils/helpers';
import type { CanvasPlacement } from '../utils/scene-objects';

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
  canvasPlacement: CanvasPlacement | undefined;
  setCanvasPlacement: (placement: CanvasPlacement | undefined) => void;
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
  const [canvasPlacement, setCanvasPlacement] = useState<CanvasPlacement>();
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

    Engine.on('paused', onPaused);
    Engine.on('debug', onDebug);

    return () => {
      Engine.off('paused', onPaused);
      Engine.off('debug', onDebug);
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
    canvasPlacement,
    setCanvasPlacement,
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
