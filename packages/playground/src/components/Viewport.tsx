import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Engine, SpriteComponent, snapToGrid, type ObjectManipulationPreview } from 'dino-ge';
import { usePlayground } from '../context/PlaygroundContext';
import Toolbar from './Toolbar';
import Logo from './Logo';
import { getAssetSource, getSceneArrowMovement, getSceneAssetPreviewType, getSceneSource, getSceneSpriteScale, isReplaceableSprite, nudgeSceneSelection, sceneAssetDragType, sceneKeyboardPlacementEvent, sceneObjectDefaults, sceneObjectDragType, sceneObjectKinds, scenePointerDragEvent, type SceneImageAsset, type SceneKeyboardPlacementRequest, type SceneObjectKind, type SceneObjectPlacement, type ScenePointerDrag, type ScenePoint } from '../utils/scene-objects';
import { maxSpriteImageBytes, spriteImageTypes, storeSpriteImage } from '../utils/helpers';

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

function getCanvasProjection(canvas: HTMLCanvasElement) {
  const bounds = canvas.getBoundingClientRect();
  const { zoom, position } = Engine.camera;
  if (!bounds.width || !bounds.height || !canvas.width || !canvas.height || zoom <= 0) return;
  const scaleX = bounds.width / canvas.width * zoom;
  const scaleY = bounds.height / canvas.height * zoom;
  return { bounds, position, scaleX, scaleY };
}

type CanvasProjection = NonNullable<ReturnType<typeof getCanvasProjection>>;

function projectCanvasPoint({ x, y }: ScenePoint, { bounds, position, scaleX, scaleY }: CanvasProjection) {
  return { x, y, scaleX, scaleY, left: bounds.left + (x - position.x) * scaleX,
    top: bounds.top + (y - position.y) * scaleY };
}

function getCanvasPlacement(canvas: HTMLCanvasElement, step: number, clientX?: number, clientY?: number) {
  const projection = getCanvasProjection(canvas);
  if (!projection) return;
  const { bounds, position, scaleX, scaleY } = projection;
  const x = snapToGrid(((clientX ?? bounds.left + bounds.width / 2) - bounds.left) / scaleX + position.x, step);
  const y = snapToGrid(((clientY ?? bounds.top + bounds.height / 2) - bounds.top) / scaleY + position.y, step);
  return projectCanvasPoint({ x, y }, projection);
}

function keepPointOnCanvas(point: ScenePoint, { bounds, position, scaleX, scaleY }: CanvasProjection, step: number) {
  const clamp = (value: number, start: number, span: number) => {
    const min = Math.ceil(start / step) * step;
    const max = Math.floor((start + span) / step) * step;
    return min <= max ? Math.min(max, Math.max(min, value)) : snapToGrid(start + span / 2, step);
  };
  return { x: clamp(point.x, position.x, bounds.width / scaleX), y: clamp(point.y, position.y, bounds.height / scaleY) };
}

interface KeyboardPlacement extends SceneKeyboardPlacementRequest {
  canvas: HTMLCanvasElement;
  scene: typeof Engine.currentScene;
  point: ScenePoint;
}

const Viewport: React.FC = () => {
  const { 
    currentScriptId,
    isViewportReady, 
    setIsViewportReady, 
    isInspectorVisible, 
    setIsInspectorVisible,
    selectedObject,
    pendingCanvasPlacements,
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
  const [placementStatus, setPlacementStatus] = useState<{ message: string; error?: boolean; pending?: boolean }>();
  const importingImage = useRef(false);
  const draggedAsset = useRef<SceneImageAsset | null>(null);
  const [manipulationReadout, setManipulationReadout] = useState('');
  const [keyboardPlacement, setKeyboardPlacement] = useState<KeyboardPlacement>();
  const [dropGuide, setDropGuide] = useState<{
    x: number; y: number; left: number; top: number; kind?: SceneObjectKind;
    width?: number; height?: number;
    asset?: { tag: string; src: string };
    importingImage?: boolean;
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
      } else if (kind === 'rotate') {
        const degrees = Math.round(value.x * (180 / Math.PI) * 100) / 100;
        setManipulationReadout(`Rotate · ${degrees}°`);
      } else if (kind === 'p1' || kind === 'p2') {
        setManipulationReadout(`Line ${kind === 'p1' ? 'start' : 'end'} · Local X ${x} · Y ${y}`);
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

  const getPlacementPoint = useCallback((clientX?: number, clientY?: number) => {
    const canvas = viewportContainerRef.current?.querySelector<HTMLCanvasElement>('canvas#canvas');
    return canvas ? getCanvasPlacement(canvas, placementStep, clientX, clientY) : undefined;
  }, [placementStep]);

  const addObject = useCallback((kind: SceneObjectKind | 'Sprite', point?: ScenePoint, asset?: SceneImageAsset) => {
    const rejectPlacement = (message: string) => {
      setPlacementStatus({ message, error: true });
      return false;
    };
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
      const source = asset && getAssetSource(asset.image.src, currentScriptId);
      if (!asset || !source) {
        return rejectPlacement('This image needs a reusable URL before it can be added to the script.');
      }
      const { image, tag } = asset;
      const scale = getSceneSpriteScale(image);
      placement = { ...options, kind, tag: `${tag} sprite`, asset: { image, source, scale } };
    } else {
      placement = { ...options, kind };
    }
    window.dispatchEvent(new CustomEvent('playground-add-scene-object', { detail: placement }));
    if (!placement.sourceId) {
      return rejectPlacement(placement.error ?? 'Open the game script in the editor before adding objects.');
    }
    setPlacementStatus({ message: `Added ${placement.tag}${scene ? ` to ${scene.className}` : ''}. Save the script to keep it.` });
    return true;
  }, [currentScriptId]);

  const enterSceneEditing = useCallback(() => {
    setIsPaused(true);
    setIsDebug(true);
    setIsInspectorVisible(true);
  }, [setIsDebug, setIsInspectorVisible, setIsPaused]);

  const placeLibraryObject = useCallback((kind: SceneObjectKind, x?: number, y?: number) => {
    if (addObject(kind, getPlacementPoint(x, y))) enterSceneEditing();
  }, [addObject, enterSceneEditing, getPlacementPoint]);

  const showDropGuide = useCallback((point: ReturnType<typeof getCanvasPlacement>,
    { kind, asset, importingImage }: { kind?: SceneObjectKind; asset?: SceneImageAsset; importingImage?: boolean }) => {
    const rect = viewportContainerRef.current?.getBoundingClientRect();
    if (!point || !rect) {
      setDropGuide(undefined);
      return;
    }
    const dimensions = kind && shapePreviewDimensions[kind];
    const spriteScale = asset ? getSceneSpriteScale(asset.image) : 1;
    const width = asset ? asset.image.naturalWidth * spriteScale : dimensions?.width;
    const height = asset ? asset.image.naturalHeight * spriteScale : dimensions?.height;
    setDropGuide({ x: point.x, y: point.y, left: point.left - rect.left, top: point.top - rect.top, kind,
      width: width && width * point.scaleX, height: height && height * point.scaleY,
      importingImage,
      asset: asset && { tag: asset.tag, src: asset.image.src } });
  }, []);

  const cancelKeyboardPlacement = useCallback(() => {
    setKeyboardPlacement(undefined);
    setDropGuide(undefined);
  }, []);

  useEffect(() => {
    const startKeyboardPlacement = (event: Event) => {
      const { item, source } = (event as CustomEvent<SceneKeyboardPlacementRequest>).detail;
      if ('asset' in item && !isEditingScene) return;
      const container = viewportContainerRef.current;
      const canvas = container?.querySelector<HTMLCanvasElement>('canvas#canvas');
      const centre = canvas && getCanvasPlacement(canvas, placementStep);
      if (!canvas || !centre) {
        setPlacementStatus({ message: 'Run the Dino GE script before adding objects.', error: true });
        return;
      }
      setPlacementStatus(undefined);
      setKeyboardPlacement({ item, source, canvas, scene: Engine.currentScene, point: { x: centre.x, y: centre.y } });
      showDropGuide(centre, item);
      container?.focus();
    };
    window.addEventListener(sceneKeyboardPlacementEvent, startKeyboardPlacement);
    return () => window.removeEventListener(sceneKeyboardPlacementEvent, startKeyboardPlacement);
  }, [isEditingScene, placementStep, showDropGuide]);

  const placementCanvas = keyboardPlacement?.canvas;
  const placementScene = keyboardPlacement?.scene;
  useEffect(() => {
    if (!placementCanvas) return;
    const onSceneChange = () => {
      if (Engine.currentScene !== placementScene) cancelKeyboardPlacement();
    };
    Engine.on('sceneHierarchyChanged', onSceneChange);
    Engine.on('paused', cancelKeyboardPlacement);
    window.addEventListener('blur', cancelKeyboardPlacement);
    window.addEventListener('playground-before-run', cancelKeyboardPlacement);
    return () => {
      Engine.off('sceneHierarchyChanged', onSceneChange);
      Engine.off('paused', cancelKeyboardPlacement);
      window.removeEventListener('blur', cancelKeyboardPlacement);
      window.removeEventListener('playground-before-run', cancelKeyboardPlacement);
    };
  }, [cancelKeyboardPlacement, placementCanvas, placementScene]);

  const handleKeyboardPlacement = (event: React.KeyboardEvent) => {
    if (!keyboardPlacement) return false;
    const { item, source, canvas, scene, point } = keyboardPlacement;
    if (event.key === 'Escape') {
      cancelKeyboardPlacement();
      source.focus();
      return true;
    }
    if (event.key === 'Enter' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      cancelKeyboardPlacement();
      if (canvas.isConnected && scene === Engine.currentScene) {
        if ('asset' in item) {
          if (isEditingScene) addObject('Sprite', point, item.asset);
        } else if (addObject(item.kind, point)) {
          enterSceneEditing();
        }
      }
      return true;
    }
    const movement = getSceneArrowMovement(event);
    if (!movement) return false;
    const projection = getCanvasProjection(canvas);
    if (projection) {
      const next = keepPointOnCanvas({
        x: point.x + movement.x * placementStep,
        y: point.y + movement.y * placementStep,
      }, projection, placementStep);
      setKeyboardPlacement({ ...keyboardPlacement, point: next });
      showDropGuide(projectCanvasPoint(next, projection), item);
    }
    return true;
  };

  const placeLoadedImage = useCallback((asset: SceneImageAsset, x?: number, y?: number) => {
    addObject('Sprite', getPlacementPoint(x, y), asset);
  }, [addObject, getPlacementPoint]);

  useEffect(() => {
    const updatePointerDrag = (event: Event) => {
      const { detail } = event as CustomEvent<ScenePointerDrag | null>;
      if (!detail || ('asset' in detail && !isEditingScene)) {
        setDropGuide(undefined);
        return;
      }
      const { phase, point: { x, y } } = detail;
      setKeyboardPlacement(undefined);
      const target = document.elementFromPoint(x, y);
      const isOverCanvas = target instanceof HTMLCanvasElement && target.id === 'canvas' &&
        viewportContainerRef.current?.contains(target);
      if (isOverCanvas && phase === 'preview') {
        showDropGuide(getCanvasPlacement(target, placementStep, x, y), detail);
      } else {
        setDropGuide(undefined);
        if (isOverCanvas && phase === 'drop') {
          if ('asset' in detail) placeLoadedImage(detail.asset, x, y);
          else placeLibraryObject(detail.kind, x, y);
        }
      }
    };
    window.addEventListener(scenePointerDragEvent, updatePointerDrag);
    return () => window.removeEventListener(scenePointerDragEvent, updatePointerDrag);
  }, [isEditingScene, placeLibraryObject, placeLoadedImage, placementStep, showDropGuide]);

  const placeImageFile = useCallback(async (files: File[], x?: number, y?: number) => {
    const reject = (message: string) => setPlacementStatus({ message, error: true });
    if (importingImage.current) return reject('Wait for the current image to finish importing.');
    if (files.length !== 1) return reject('Choose one image at a time.');
    const [file] = files;
    if (!spriteImageTypes.includes(file.type)) return reject('Choose a PNG, JPEG, GIF or WebP image.');
    if (file.size > maxSpriteImageBytes) return reject('Sprite images can be up to 5 MiB.');
    const point = getPlacementPoint(x, y);
    const run = document.querySelector<HTMLElement>('script[data-playground-script]');
    if (!point || run?.dataset.playgroundScript !== currentScriptId) {
      return reject('Run the open Dino GE script before importing an image.');
    }
    const scene = Engine.currentScene;
    importingImage.current = true;
    setPlacementStatus({ message: `Importing ${file.name}…`, pending: true });
    const previewUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = previewUrl;
      await image.decode();
      if (!run.isConnected) return;
      image.src = await storeSpriteImage(file, currentScriptId);
      window.dispatchEvent(new CustomEvent('playground-workspace-images-changed', { detail: currentScriptId }));
      await image.decode();
      if (!run.isConnected) return;
      if (scene !== Engine.currentScene) return reject('The active scene changed. Drop the image again to place it there.');
      const tag = file.name.replace(/\.[^.]*$/, '').trim() || 'Imported';
      if (addObject('Sprite', point, { tag, image })) enterSceneEditing();
    } catch (error) {
      if (run.isConnected) {
        reject(error instanceof Error && !(error instanceof DOMException) ? error.message : 'The image could not be opened.');
      }
    } finally {
      URL.revokeObjectURL(previewUrl);
      importingImage.current = false;
    }
  }, [addObject, currentScriptId, enterSceneEditing, getPlacementPoint]);

  useEffect(() => {
    const importImage = (event: Event) => void placeImageFile((event as CustomEvent<File[]>).detail);
    window.addEventListener('playground-import-image', importImage);
    return () => window.removeEventListener('playground-import-image', importImage);
  }, [placeImageFile]);

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
    const placeAsset = (event: Event) => placeLoadedImage((event as CustomEvent<SceneImageAsset>).detail);
    const replaceAsset = (event: Event) => {
      const { tag, image } = (event as CustomEvent<SceneImageAsset>).detail;
      const object = Engine.selectedObject;
      if (!isReplaceableSprite(object)) return;
      const source = getAssetSource(image.src, currentScriptId);
      if (!source) {
        setPlacementStatus({ message: 'This image needs a reusable URL before it can be saved to the script.', error: true });
        return;
      }
      const replaced = !window.dispatchEvent(new CustomEvent('playground-update-sprite-image', {
        detail: { object, image, source }, cancelable: true,
      }));
      setPlacementStatus(replaced
        ? { message: `Changed ${object.metadata.tag} to ${tag}. Save the script to keep it.` }
        : { message: 'Select a single-frame Library sprite defined in the open script.', error: true });
    };
    const trackAssetDrag = (event: Event) => { draggedAsset.current = (event as CustomEvent<SceneImageAsset | null>).detail; };
    const clearAssetDrag = () => { draggedAsset.current = null; };
    window.addEventListener('playground-place-asset', placeAsset);
    window.addEventListener('playground-replace-sprite-image', replaceAsset);
    window.addEventListener('playground-drag-scene-asset', trackAssetDrag);
    window.addEventListener('playground-before-run', clearAssetDrag);
    return () => {
      window.removeEventListener('playground-place-asset', placeAsset);
      window.removeEventListener('playground-replace-sprite-image', replaceAsset);
      window.removeEventListener('playground-drag-scene-asset', trackAssetDrag);
      window.removeEventListener('playground-before-run', clearAssetDrag);
      clearAssetDrag();
    };
  }, [currentScriptId, placeLoadedImage, isEditingScene]);

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
        style={isEditingScene ? { touchAction: 'none' } : undefined}
        role={isEditingScene || keyboardPlacement ? 'region' : undefined}
        aria-label={isEditingScene || keyboardPlacement ? 'Scene viewport' : undefined}
        aria-describedby={keyboardPlacement ? 'scene-placement-keyboard-hint' : isEditingScene ? 'scene-keyboard-hint' : undefined}
        tabIndex={isEditingScene ? 0 : -1}
        onBlur={event => {
          if (keyboardPlacement && !event.currentTarget.contains(event.relatedTarget)) cancelKeyboardPlacement();
        }}
        onPointerDownCapture={event => {
          if (keyboardPlacement) cancelKeyboardPlacement();
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
          const importingImage = types.includes('Files');
          if ((!importingImage && !types.includes(sceneObjectDragType) && !(isEditingScene && types.includes(sceneAssetDragType))) ||
              !(event.target instanceof HTMLCanvasElement)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setKeyboardPlacement(undefined);
          const kind = sceneObjectKinds.find(item => types.includes(`${sceneObjectDragType}-${item.toLowerCase()}`));
          const dragged = draggedAsset.current;
          const asset = dragged && types.includes(getSceneAssetPreviewType(dragged.tag)) ? dragged : undefined;
          showDropGuide(getCanvasPlacement(event.target, placementStep, event.clientX, event.clientY), { kind, asset, importingImage });
        }}
        onDragLeave={() => setDropGuide(undefined)}
        onDrop={event => {
          setDropGuide(undefined);
          if (!(event.target instanceof HTMLCanvasElement)) return;
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            void placeImageFile(Array.from(event.dataTransfer.files), event.clientX, event.clientY);
            return;
          }
          if (isEditingScene && event.dataTransfer.types.includes(sceneAssetDragType)) {
            event.preventDefault();
            const asset = draggedAsset.current;
            draggedAsset.current = null;
            if (asset?.tag === event.dataTransfer.getData(sceneAssetDragType)) {
              placeLoadedImage(asset, event.clientX, event.clientY);
            }
            return;
          }
          const kind = sceneObjectKinds.find(item => item === event.dataTransfer.getData(sceneObjectDragType));
          if (!kind) return;
          event.preventDefault();
          placeLibraryObject(kind, event.clientX, event.clientY);
        }}
        onClickCapture={suppressGameActivation}
        onKeyDownCapture={event => {
          if (handleKeyboardPlacement(event)) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (isEditingScene && (event.target === event.currentTarget || event.target instanceof HTMLCanvasElement) &&
              nudgeSceneSelection(event)) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (event.key === 'Enter' || event.key === ' ') suppressGameActivation(event);
        }}
      />
      {(isEditingScene || keyboardPlacement || placementStatus?.error || placementStatus?.pending) && (
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
            {!keyboardPlacement && <span id="scene-keyboard-hint" className="scene-edit-hint">
              Middle drag pans · {isGridSnapping ? 'Arrows move 1 cell · Shift moves 10 cells' : 'Arrows move 1 px · Shift moves 10 px'}<br />
              Drag the round handle to rotate · Hold Shift to snap to 15°<br />
              Esc cancels the current edit
            </span>}
            {!isInspectorVisible && selectedObject && pendingCanvasPlacements.has(selectedObject) && (
              <button type="button" className="scene-control scene-review-changes" onClick={() => {
                setIsInspectorVisible(true);
                requestAnimationFrame(() => document.getElementById('canvas-changes')?.focus());
              }}>
                <i className="fa-solid fa-pen-to-square" aria-hidden="true" /> Review canvas changes
              </button>
            )}
          </>}
          {keyboardPlacement && <span id="scene-placement-keyboard-hint" className="scene-edit-hint">
            Arrows position · {isGridSnapping ? 'Shift moves 10 cells' : 'Shift moves 10 px'}<br />
            Enter places the object · Esc cancels
          </span>}
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
      {dropGuide && <div className="scene-drop-preview" aria-hidden={keyboardPlacement ? undefined : true}>
        {dropGuide.width && dropGuide.height && <div className={dropGuide.kind === 'Line' ? 'scene-drop-line' : 'scene-drop-outline'} style={{
          left: dropGuide.left, top: dropGuide.top, width: dropGuide.width, height: dropGuide.height,
          borderRadius: dropGuide.kind === 'Circle' ? '50%' : undefined,
        }} aria-hidden="true">
          {dropGuide.asset && <img className="scene-drop-image" src={dropGuide.asset.src} alt="" />}
          {dropGuide.kind === 'Text' && <TextDropPreview />}
        </div>}
        <div className="scene-drop-guide" style={{ left: dropGuide.left, top: dropGuide.top }} aria-hidden="true" />
        <div className="scene-drop-position" role={keyboardPlacement ? 'status' : undefined}>
          {dropGuide.asset?.tag ?? dropGuide.kind ?? (dropGuide.importingImage ? 'Import image' : 'Drop position')} · X {dropGuide.x} · Y {dropGuide.y}
        </div>
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
