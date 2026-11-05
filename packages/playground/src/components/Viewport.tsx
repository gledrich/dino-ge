import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Engine, Loader } from 'dino-ge';
import { usePlayground } from '../context/PlaygroundContext';
import Toolbar from './Toolbar';
import Logo from './Logo';
import { getAssetSource, getSceneSource, nudgeSceneSelection, sceneAssetDragType, sceneObjectDragType, sceneObjectKinds, type SceneObjectKind, type SceneObjectPlacement } from '../utils/scene-objects';

const Viewport: React.FC = () => {
  const { 
    currentScriptId,
    isViewportReady, 
    setIsViewportReady, 
    isInspectorVisible, 
    setIsInspectorVisible,
    isPaused, 
    setIsPaused,
    isDebug, 
    setIsDebug,
    togglePause, 
    toggleDebug, 
    arePanelsMinimized, 
    togglePanels 
  } = usePlayground();

  const viewportContainerRef = useRef<HTMLDivElement>(null);
  const isEditingScene = isPaused && isDebug;
  const [placementStatus, setPlacementStatus] = useState('');
  const [dropGuide, setDropGuide] = useState<{ x: number; y: number }>();

  const addObject = useCallback((kind: SceneObjectKind | 'Sprite', clientX?: number, clientY?: number, assetTag?: string) => {
    const canvas = viewportContainerRef.current?.querySelector<HTMLCanvasElement>('canvas#canvas');
    const bounds = canvas?.getBoundingClientRect();
    if (!canvas || !bounds?.width || !bounds.height) {
      setPlacementStatus('Run the Dino GE script before adding objects.');
      return;
    }
    const runningScript = document.querySelector<HTMLElement>('[data-playground-script]')?.dataset.playgroundScript;
    if (runningScript !== currentScriptId) {
      setPlacementStatus('Wait for the open script to start before adding objects.');
      return;
    }
    const scene = Engine.currentScene ? getSceneSource(Engine.currentScene) : undefined;
    if (Engine.currentScene && !scene) {
      setPlacementStatus('Add objects in a named scene class declared in the open script.');
      return;
    }
    const { zoom, position } = Engine.camera;
    const x = clientX === undefined ? canvas.width / 2 : (clientX - bounds.left) * canvas.width / bounds.width;
    const y = clientY === undefined ? canvas.height / 2 : (clientY - bounds.top) * canvas.height / bounds.height;
    const options = {
      tag: `New ${kind.toLowerCase()}`, scene,
      x: Math.round(x / zoom + position.x), y: Math.round(y / zoom + position.y),
    };
    let placement: SceneObjectPlacement;
    if (kind === 'Sprite') {
      const image = Loader.getLoadedAssets().find(asset => asset.tag === assetTag)?.image;
      const source = image && getAssetSource(image.src, currentScriptId);
      if (!image || !source) {
        setPlacementStatus('This image needs a reusable URL before it can be added to the script.');
        return;
      }
      const scale = Math.min(1, 128 / Math.max(image.naturalWidth, image.naturalHeight));
      placement = { ...options, kind, tag: `${assetTag} sprite`, asset: { image, source, scale } };
    } else {
      placement = { ...options, kind };
    }
    window.dispatchEvent(new CustomEvent('playground-add-scene-object', { detail: placement }));
    if (!placement.sourceId) {
      setPlacementStatus(placement.error ?? 'Open the game script in the editor before adding objects.');
      return;
    }
    setPlacementStatus(`Added ${placement.tag}${scene ? ` to ${scene.className}` : ''}. Save the script to keep it.`);
  }, [currentScriptId]);

  const placeLibraryObject = useCallback((kind: SceneObjectKind, x?: number, y?: number) => {
    setIsPaused(true);
    setIsDebug(true);
    setIsInspectorVisible(true);
    addObject(kind, x, y);
  }, [addObject, setIsDebug, setIsInspectorVisible, setIsPaused]);

  useEffect(() => {
    const placeObject = (event: Event) => {
      const kind = (event as CustomEvent<SceneObjectKind>).detail;
      if (sceneObjectKinds.includes(kind)) placeLibraryObject(kind);
    };
    window.addEventListener('playground-place-object', placeObject);
    return () => window.removeEventListener('playground-place-object', placeObject);
  }, [placeLibraryObject]);

  useEffect(() => {
    const reportHistory = (event: Event) => setPlacementStatus((event as CustomEvent<string>).detail);
    window.addEventListener('playground-scene-history', reportHistory);
    return () => window.removeEventListener('playground-scene-history', reportHistory);
  }, []);

  useEffect(() => {
    if (!isEditingScene) return;
    const placeAsset = (event: Event) => addObject('Sprite', undefined, undefined, (event as CustomEvent<string>).detail);
    window.addEventListener('playground-place-asset', placeAsset);
    return () => window.removeEventListener('playground-place-asset', placeAsset);
  }, [addObject, isEditingScene]);

  const toggleSceneEditing = () => {
    const editing = !isEditingScene;
    setIsPaused(editing);
    setIsDebug(editing);
    if (editing) {
      setIsInspectorVisible(true);
      viewportContainerRef.current?.focus();
    }
  };

  const suppressGameActivation = (event: React.MouseEvent | React.KeyboardEvent) => {
    if (!isEditingScene || !(event.target instanceof HTMLCanvasElement)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  useEffect(() => {
    if (!viewportContainerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setIsViewportReady(true);
          observer.disconnect();
        }
      }
    });

    observer.observe(viewportContainerRef.current);
    return () => observer.disconnect();
  }, [setIsViewportReady]);

  return (
    <div className="viewport-panel">
      {!isViewportReady && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-primary)',
          zIndex: 200,
          color: 'var(--accent-primary)',
          flexDirection: 'column',
          gap: '15px'
        }}>
          <i className="fa-solid fa-circle-notch fa-spin" style={{ fontSize: '40px' }} />
          <span style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase' }}>
            initialising Engine
          </span>
        </div>
      )}
      <div id="playground-canvas-container" ref={viewportContainerRef}
        role={isEditingScene ? 'region' : undefined}
        aria-label={isEditingScene ? 'Scene viewport' : undefined}
        aria-describedby={isEditingScene ? 'scene-keyboard-hint' : undefined}
        tabIndex={isEditingScene ? 0 : -1}
        onDragOver={event => {
          const types = event.dataTransfer.types;
          if ((!types.includes(sceneObjectDragType) && !(isEditingScene && types.includes(sceneAssetDragType))) ||
              !(event.target instanceof HTMLCanvasElement)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          const rect = event.currentTarget.getBoundingClientRect();
          setDropGuide({ x: event.clientX - rect.left, y: event.clientY - rect.top });
        }}
        onDragLeave={() => setDropGuide(undefined)}
        onDrop={event => {
          setDropGuide(undefined);
          if (!(event.target instanceof HTMLCanvasElement)) return;
          if (isEditingScene && event.dataTransfer.types.includes(sceneAssetDragType)) {
            event.preventDefault();
            addObject('Sprite', event.clientX, event.clientY, event.dataTransfer.getData(sceneAssetDragType));
            return;
          }
          const kind = sceneObjectKinds.find(item => item === event.dataTransfer.getData(sceneObjectDragType));
          if (!kind) return;
          event.preventDefault();
          placeLibraryObject(kind, event.clientX, event.clientY);
        }}
        onClickCapture={suppressGameActivation}
        onKeyDownCapture={event => {
          if (isEditingScene && (event.target === event.currentTarget || event.target instanceof HTMLCanvasElement) &&
              nudgeSceneSelection(event)) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (event.key === 'Enter' || event.key === ' ') suppressGameActivation(event);
        }}
      />
      {isEditingScene && (
        <>
          <div className="scene-object-palette" role="group" aria-label="Scene editing">
            <span id="scene-keyboard-hint">Arrow keys move 1 unit · Shift moves 10</span>
            <div className="scene-object-options scene-history-actions" role="group" aria-label="Edit history">
              {(['undo', 'redo'] as const).map(action => (
                <button key={action} type="button" aria-label={`${action === 'undo' ? 'Undo' : 'Redo'} code edit`}
                  onClick={() => window.dispatchEvent(new CustomEvent('playground-code-history', { detail: action }))}
                >{action === 'undo' ? 'Undo' : 'Redo'}</button>
              ))}
            </div>
            {placementStatus && <span role="status">{placementStatus}</span>}
          </div>
        </>
      )}
      {dropGuide && <div className="scene-drop-guide" aria-hidden="true"
        style={{ left: dropGuide.x, top: dropGuide.y }} />}
      <Logo visible={!isInspectorVisible && isViewportReady} />
      <Toolbar 
        isPaused={isPaused}
        isDebug={isDebug}
        isEditingScene={isEditingScene}
        arePanelsMinimized={arePanelsMinimized}
        onTogglePause={isEditingScene ? toggleSceneEditing : togglePause}
        onToggleDebug={toggleDebug}
        onToggleSceneEditing={toggleSceneEditing}
        onTogglePanels={togglePanels}
        onRefresh={() => window.dispatchEvent(new CustomEvent('playground-refresh'))}
      />
    </div>
  );
};

export default Viewport;
