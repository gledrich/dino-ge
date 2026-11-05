import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Engine, Loader } from 'dino-ge';
import { usePlayground } from '../context/PlaygroundContext';
import Toolbar from './Toolbar';
import Logo from './Logo';
import { getAssetSource, getSceneAssetPreviewType, getSceneSource, getSceneSpriteScale, nudgeSceneSelection, sceneAssetDragType, sceneObjectDefaults, sceneObjectDragType, sceneObjectKinds, type SceneObjectKind, type SceneObjectPlacement } from '../utils/scene-objects';

function getCanvasPlacement(canvas: HTMLCanvasElement, clientX?: number, clientY?: number) {
  const bounds = canvas.getBoundingClientRect();
  const { zoom, position } = Engine.camera;
  if (!bounds.width || !bounds.height || !canvas.width || !canvas.height || zoom <= 0) return;
  const scaleX = bounds.width / canvas.width * zoom;
  const scaleY = bounds.height / canvas.height * zoom;
  const x = Math.round(((clientX ?? bounds.left + bounds.width / 2) - bounds.left) / scaleX + position.x);
  const y = Math.round(((clientY ?? bounds.top + bounds.height / 2) - bounds.top) / scaleY + position.y);
  return { x, y, scaleX, scaleY, left: bounds.left + (x - position.x) * scaleX,
    top: bounds.top + (y - position.y) * scaleY };
}

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
  const [dropGuide, setDropGuide] = useState<{
    x: number; y: number; left: number; top: number; kind?: SceneObjectKind;
    width?: number; height?: number;
    asset?: { tag: string; src: string };
  }>();

  const addObject = useCallback((kind: SceneObjectKind | 'Sprite', clientX?: number, clientY?: number, assetTag?: string) => {
    const canvas = viewportContainerRef.current?.querySelector<HTMLCanvasElement>('canvas#canvas');
    const point = canvas && getCanvasPlacement(canvas, clientX, clientY);
    if (!point) {
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
    const options = {
      tag: `New ${kind.toLowerCase()}`, scene,
      x: point.x, y: point.y,
    };
    let placement: SceneObjectPlacement;
    if (kind === 'Sprite') {
      const image = Loader.getLoadedAssets().find(asset => asset.tag === assetTag)?.image;
      const source = image && getAssetSource(image.src, currentScriptId);
      if (!image || !source) {
        setPlacementStatus('This image needs a reusable URL before it can be added to the script.');
        return;
      }
      const scale = getSceneSpriteScale(image);
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
          const point = getCanvasPlacement(event.target, event.clientX, event.clientY);
          if (!point) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const kind = sceneObjectKinds.find(item => types.includes(`${sceneObjectDragType}-${item.toLowerCase()}`));
          const asset = types.includes(sceneAssetDragType)
            ? Loader.getLoadedAssets().find(item => types.includes(getSceneAssetPreviewType(item.tag))) : undefined;
          const dimensions = kind === 'Rectangle' ? sceneObjectDefaults.Rectangle : kind === 'Circle'
            ? { width: sceneObjectDefaults.Circle.radius * 2, height: sceneObjectDefaults.Circle.radius * 2 } : undefined;
          const spriteScale = asset ? getSceneSpriteScale(asset.image) : 1;
          const width = asset ? asset.image.naturalWidth * spriteScale : dimensions?.width;
          const height = asset ? asset.image.naturalHeight * spriteScale : dimensions?.height;
          setDropGuide({ x: point.x, y: point.y, left: point.left - rect.left, top: point.top - rect.top, kind,
            width: width && width * point.scaleX, height: height && height * point.scaleY,
            asset: asset && { tag: asset.tag, src: asset.image.src } });
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
          <div className="scene-edit-controls" role="group" aria-label="Scene editing">
            <div className="scene-object-options scene-history-actions" role="group" aria-label="Edit history">
              <span className="scene-edit-label">Scene editing</span>
              {(['undo', 'redo'] as const).map(action => (
                <button key={action} type="button" className="scene-control" aria-label={`${action === 'undo' ? 'Undo' : 'Redo'} code edit`}
                  onClick={() => window.dispatchEvent(new CustomEvent('playground-code-history', { detail: action }))}
                ><i className={`fa-solid ${action === 'undo' ? 'fa-rotate-left' : 'fa-rotate-right'}`} aria-hidden="true" />
                  {action === 'undo' ? 'Undo' : 'Redo'}</button>
              ))}
            </div>
            <span id="scene-keyboard-hint" className="scene-edit-hint">Arrows move 1 unit · Shift + arrows move 10</span>
            {placementStatus && <span className="scene-edit-status" role="status">{placementStatus}</span>}
          </div>
      )}
      {dropGuide && <div className="scene-drop-preview" aria-hidden="true">
        {dropGuide.width && dropGuide.height && <div className="scene-drop-outline" style={{
          left: dropGuide.left, top: dropGuide.top, width: dropGuide.width, height: dropGuide.height,
          borderRadius: dropGuide.kind === 'Circle' ? '50%' : undefined,
        }}>{dropGuide.asset && <img className="scene-drop-image" src={dropGuide.asset.src} alt="" />}</div>}
        <div className="scene-drop-guide" style={{ left: dropGuide.left, top: dropGuide.top }} />
        <div className="scene-drop-position">{dropGuide.asset?.tag ?? dropGuide.kind ?? 'Drop position'} · X {dropGuide.x} · Y {dropGuide.y}</div>
      </div>}
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
