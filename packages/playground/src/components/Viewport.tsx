import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Engine, Loader, SpriteComponent, snapToGrid, type ObjectManipulationPreview } from 'dino-ge';
import { usePlayground } from '../context/PlaygroundContext';
import Toolbar from './Toolbar';
import Logo from './Logo';
import { getAssetSource, getSceneAssetPreviewType, getSceneSource, getSceneSpriteScale, nudgeSceneSelection, sceneAssetDragType, sceneObjectDefaults, sceneObjectDragType, sceneObjectKinds, type SceneObjectKind, type SceneObjectPlacement } from '../utils/scene-objects';

const shapePreviewDimensions: Partial<Record<SceneObjectKind, { width: number; height: number }>> = {
  Rectangle: sceneObjectDefaults.Rectangle,
  Circle: { width: sceneObjectDefaults.Circle.radius * 2, height: sceneObjectDefaults.Circle.radius * 2 },
  Line: { width: sceneObjectDefaults.Line.length, height: sceneObjectDefaults.Line.strokeWidth },
  Text: sceneObjectDefaults.Text,
};
const sceneGridSizes = [8, 16, 32, 64];

function TextDropPreview() {
  const { width, height, text, colour, backgroundColour, fontSize, font } = sceneObjectDefaults.Text;
  return (
    <svg className="scene-drop-text" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <rect width={width} height={height} fill={backgroundColour} />
      <text x={width / 2} y={height / 2} fill={colour} fontSize={fontSize} fontFamily={font}
        textAnchor="middle" dominantBaseline="central">{text}</text>
    </svg>
  );
}

function getCanvasPlacement(canvas: HTMLCanvasElement, step: number, clientX?: number, clientY?: number) {
  const bounds = canvas.getBoundingClientRect();
  const { zoom, position } = Engine.camera;
  if (!bounds.width || !bounds.height || !canvas.width || !canvas.height || zoom <= 0) return;
  const scaleX = bounds.width / canvas.width * zoom;
  const scaleY = bounds.height / canvas.height * zoom;
  const x = snapToGrid(((clientX ?? bounds.left + bounds.width / 2) - bounds.left) / scaleX + position.x, step);
  const y = snapToGrid(((clientY ?? bounds.top + bounds.height / 2) - bounds.top) / scaleY + position.y, step);
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
  const savedCamera = useRef<{ canvas: HTMLCanvasElement; scene: typeof Engine.currentScene;
    x: number; y: number; zoom: number } | null>(null);
  const pan = useRef<{ id: number; x: number; y: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [isGridSnapping, setIsGridSnapping] = useState(false);
  const [sceneGridSize, setSceneGridSize] = useState(16);
  const placementStep = isGridSnapping ? sceneGridSize : 1;
  const [placementStatus, setPlacementStatus] = useState<{ message: string; error?: boolean }>();
  const [manipulationReadout, setManipulationReadout] = useState('');
  const [dropGuide, setDropGuide] = useState<{
    x: number; y: number; left: number; top: number; kind?: SceneObjectKind;
    width?: number; height?: number;
    asset?: { tag: string; src: string };
  }>();

  useEffect(() => {
    if (!isEditingScene) return;
    const previous = Engine.showDebugHud;
    Engine.showDebugHud = false;
    return () => { Engine.showDebugHud = previous; };
  }, [isEditingScene]);

  useEffect(() => {
    if (!isEditingScene || !isGridSnapping) return;
    const previous = Engine.debugPositionGridSize;
    Engine.debugPositionGridSize = sceneGridSize;
    return () => { Engine.debugPositionGridSize = previous; };
  }, [isEditingScene, isGridSnapping, sceneGridSize]);

  useEffect(() => {
    if (!isEditingScene) return;
    const clear = () => setManipulationReadout('');
    const update = ({ detail }: CustomEvent<ObjectManipulationPreview | null>) => {
      if (!detail) {
        clear();
        return;
      }
      const { object, kind, value } = detail;
      const x = Math.round(value.x * 100) / 100;
      const y = Math.round(value.y * 100) / 100;
      if (kind === 'drag') {
        setManipulationReadout(`Move · ${object.transform.parent ? 'Local ' : ''}X ${x} · Y ${y}`);
      } else if (object.getComponent(SpriteComponent)) {
        setManipulationReadout(`Resize · Scale X ${x} · Y ${y}`);
      } else {
        setManipulationReadout(`Resize · W ${x} · H ${y}`);
      }
    };
    Engine.on('objectManipulationPreview', update);
    Engine.on('selectedObjectChanged', clear);
    window.addEventListener('playground-before-run', clear);
    return () => {
      Engine.off('objectManipulationPreview', update);
      Engine.off('selectedObjectChanged', clear);
      window.removeEventListener('playground-before-run', clear);
      clear();
    };
  }, [isEditingScene]);

  const addObject = useCallback((kind: SceneObjectKind | 'Sprite', clientX?: number, clientY?: number, assetTag?: string) => {
    const rejectPlacement = (message: string) => {
      setPlacementStatus({ message, error: true });
      return false;
    };
    const canvas = viewportContainerRef.current?.querySelector<HTMLCanvasElement>('canvas#canvas');
    const point = canvas && getCanvasPlacement(canvas, placementStep, clientX, clientY);
    if (!point) return rejectPlacement('Run the Dino GE script before adding objects.');
    const runningScript = document.querySelector<HTMLElement>('[data-playground-script]')?.dataset.playgroundScript;
    if (runningScript !== currentScriptId) {
      return rejectPlacement('Wait for the open script to start before adding objects.');
    }
    const scene = Engine.currentScene ? getSceneSource(Engine.currentScene) : undefined;
    if (Engine.currentScene && !scene) {
      return rejectPlacement('Add objects in a named scene class declared in the open script.');
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
        return rejectPlacement('This image needs a reusable URL before it can be added to the script.');
      }
      const scale = getSceneSpriteScale(image);
      placement = { ...options, kind, tag: `${assetTag} sprite`, asset: { image, source, scale } };
    } else {
      placement = { ...options, kind };
    }
    window.dispatchEvent(new CustomEvent('playground-add-scene-object', { detail: placement }));
    if (!placement.sourceId) {
      return rejectPlacement(placement.error ?? 'Open the game script in the editor before adding objects.');
    }
    setPlacementStatus({ message: `Added ${placement.tag}${scene ? ` to ${scene.className}` : ''}. Save the script to keep it.` });
    return true;
  }, [currentScriptId, placementStep]);

  const placeLibraryObject = useCallback((kind: SceneObjectKind, x?: number, y?: number) => {
    if (!addObject(kind, x, y)) return;
    setIsPaused(true);
    setIsDebug(true);
    setIsInspectorVisible(true);
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
    const reportHistory = (event: Event) => setPlacementStatus({ message: (event as CustomEvent<string>).detail });
    const clearPlacementStatus = () => setPlacementStatus(undefined);
    window.addEventListener('playground-scene-history', reportHistory);
    window.addEventListener('playground-before-run', clearPlacementStatus);
    return () => {
      window.removeEventListener('playground-scene-history', reportHistory);
      window.removeEventListener('playground-before-run', clearPlacementStatus);
    };
  }, []);

  useEffect(() => {
    if (!isEditingScene) return;
    const placeAsset = (event: Event) => addObject('Sprite', undefined, undefined, (event as CustomEvent<string>).detail);
    window.addEventListener('playground-place-asset', placeAsset);
    return () => window.removeEventListener('playground-place-asset', placeAsset);
  }, [addObject, isEditingScene]);

  const toggleSceneEditing = () => {
    const editing = !isEditingScene;
    if (!editing) restoreCamera();
    setIsPaused(editing);
    setIsDebug(editing);
    if (editing) {
      setIsInspectorVisible(true);
      viewportContainerRef.current?.focus();
    }
  };

  const rememberCamera = (canvas: HTMLCanvasElement) => {
    const scene = Engine.currentScene;
    if (savedCamera.current?.canvas === canvas && savedCamera.current.scene === scene) return;
    const { position, zoom } = Engine.camera;
    savedCamera.current = { canvas, scene, x: position.x, y: position.y, zoom };
  };

  const restoreCamera = useCallback(() => {
    const saved = savedCamera.current;
    savedCamera.current = null;
    pan.current = null;
    setIsPanning(false);
    if (saved?.canvas.isConnected && saved.scene === Engine.currentScene) {
      Engine.camera.position.set(saved.x, saved.y);
      Engine.camera.zoom = saved.zoom;
    }
  }, []);

  useEffect(() => {
    if (!isEditingScene) return;
    window.addEventListener('playground-before-run', restoreCamera);
    return () => {
      window.removeEventListener('playground-before-run', restoreCamera);
      restoreCamera();
    };
  }, [isEditingScene, restoreCamera]);

  const zoomView = (factor: number) => {
    const canvas = viewportContainerRef.current?.querySelector<HTMLCanvasElement>('canvas#canvas');
    if (!canvas || !canvas.width || !canvas.height) return;
    const { position, zoom } = Engine.camera;
    const next = Math.max(0.1, Math.min(8, zoom * factor));
    if (next === zoom) return;
    rememberCamera(canvas);
    position.set(position.x + canvas.width / 2 * (1 / zoom - 1 / next),
      position.y + canvas.height / 2 * (1 / zoom - 1 / next));
    Engine.camera.zoom = next;
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
        className={isPanning ? 'scene-panning' : undefined}
        role={isEditingScene ? 'region' : undefined}
        aria-label={isEditingScene ? 'Scene viewport' : undefined}
        aria-describedby={isEditingScene ? 'scene-keyboard-hint' : undefined}
        tabIndex={isEditingScene ? 0 : -1}
        onPointerDownCapture={event => {
          if (!isEditingScene || event.button !== 1 || !(event.target instanceof HTMLCanvasElement)) return;
          event.preventDefault();
          event.stopPropagation();
          rememberCamera(event.target);
          pan.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
          event.target.setPointerCapture(event.pointerId);
          setIsPanning(true);
        }}
        onPointerMove={event => {
          const drag = pan.current;
          if (!drag || drag.id !== event.pointerId || !(event.target instanceof HTMLCanvasElement)) return;
          const canvas = event.target;
          const bounds = canvas.getBoundingClientRect();
          const { position, zoom } = Engine.camera;
          if (!bounds.width || !bounds.height) return;
          position.set(position.x - (event.clientX - drag.x) * canvas.width / bounds.width / zoom,
            position.y - (event.clientY - drag.y) * canvas.height / bounds.height / zoom);
          drag.x = event.clientX;
          drag.y = event.clientY;
        }}
        onLostPointerCapture={event => {
          if (pan.current?.id !== event.pointerId) return;
          pan.current = null;
          setIsPanning(false);
        }}
        onDragOver={event => {
          const types = event.dataTransfer.types;
          if ((!types.includes(sceneObjectDragType) && !(isEditingScene && types.includes(sceneAssetDragType))) ||
              !(event.target instanceof HTMLCanvasElement)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          const point = getCanvasPlacement(event.target, placementStep, event.clientX, event.clientY);
          if (!point) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const kind = sceneObjectKinds.find(item => types.includes(`${sceneObjectDragType}-${item.toLowerCase()}`));
          const asset = types.includes(sceneAssetDragType)
            ? Loader.getLoadedAssets().find(item => types.includes(getSceneAssetPreviewType(item.tag))) : undefined;
          const dimensions = kind && shapePreviewDimensions[kind];
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
      {(isEditingScene || placementStatus?.error) && (
        <div className="scene-edit-controls" role={isEditingScene ? 'group' : undefined}
          aria-label={isEditingScene ? 'Scene editing' : undefined}>
          {isEditingScene && <>
            <div className="scene-object-options scene-history-actions" role="group" aria-label="Edit history">
              <span className="scene-edit-label">Scene editing</span>
              {(['undo', 'redo'] as const).map(action => (
                <button key={action} type="button" className="scene-control" aria-label={`${action === 'undo' ? 'Undo' : 'Redo'} code edit`}
                  onClick={() => window.dispatchEvent(new CustomEvent('playground-code-history', { detail: action }))}
                ><i className={`fa-solid ${action === 'undo' ? 'fa-rotate-left' : 'fa-rotate-right'}`} aria-hidden="true" />
                  {action === 'undo' ? 'Undo' : 'Redo'}</button>
              ))}
            </div>
            <div className="scene-object-options scene-history-actions" role="group" aria-label="Scene camera and grid">
              <button type="button" className="scene-control" onClick={() => zoomView(1 / 1.25)}>Zoom out</button>
              <button type="button" className="scene-control" onClick={() => zoomView(1.25)}>Zoom in</button>
              <button type="button" className="scene-control" onClick={restoreCamera}>Reset view</button>
              <button type="button" className="scene-control scene-grid-toggle"
                aria-pressed={isGridSnapping} title={`Snap moves and drops to the ${sceneGridSize} px grid`}
                onClick={() => setIsGridSnapping(enabled => !enabled)}>Snap to grid</button>
              <select className="scene-control scene-grid-size" aria-label="Grid cell size" value={sceneGridSize}
                onChange={event => setSceneGridSize(Number(event.target.value))}>
                {sceneGridSizes.map(size => <option key={size} value={size}>{size} px</option>)}
              </select>
            </div>
            <span id="scene-keyboard-hint" className="scene-edit-hint">
              Middle drag pans · {isGridSnapping ? 'Arrows move 1 cell · Shift moves 10 cells' : 'Arrows move 1 px · Shift moves 10 px'}<br />
              Esc cancels a move or resize
            </span>
          </>}
          {placementStatus?.error ? (
            <div className="scene-placement-error">
              <span role="alert">{placementStatus.message}</span>
              <button type="button" className="scene-control" aria-label="Dismiss placement error"
                onClick={() => setPlacementStatus(undefined)}>
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </div>
          ) : placementStatus && (
            <span className="scene-edit-status" role="status">{placementStatus.message}</span>
          )}
        </div>
      )}
      {dropGuide && <div className="scene-drop-preview" aria-hidden="true">
        {dropGuide.width && dropGuide.height && <div className={dropGuide.kind === 'Line' ? 'scene-drop-line' : 'scene-drop-outline'} style={{
          left: dropGuide.left, top: dropGuide.top, width: dropGuide.width, height: dropGuide.height,
          borderRadius: dropGuide.kind === 'Circle' ? '50%' : undefined,
        }}>
          {dropGuide.asset && <img className="scene-drop-image" src={dropGuide.asset.src} alt="" />}
          {dropGuide.kind === 'Text' && <TextDropPreview />}
        </div>}
        <div className="scene-drop-guide" style={{ left: dropGuide.left, top: dropGuide.top }} />
        <div className="scene-drop-position">{dropGuide.asset?.tag ?? dropGuide.kind ?? 'Drop position'} · X {dropGuide.x} · Y {dropGuide.y}</div>
      </div>}
      {isEditingScene && manipulationReadout && (
        <div className="scene-manipulation-readout" role="group" aria-label="Current scene gesture">{manipulationReadout}</div>
      )}
      <Logo visible={!isInspectorVisible && isViewportReady && !isEditingScene} />
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
