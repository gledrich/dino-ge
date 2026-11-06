import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Engine, Input, SpriteComponent, getViewportAlignment, snapToGrid, type GameObject, type ObjectManipulationPreview } from 'dino-ge';
import { usePlayground } from '../context/PlaygroundContext';
import type { GameRunError } from '../hooks/usePlaygroundScripts';
import Toolbar from './Toolbar';
import { ScreenUIOutline } from './ScreenUITools';
import HostedLibraryPlacement from './HostedLibraryPlacement';
import { screenUIPreview } from '../utils/screen-ui-preview';
import { useScreenUIEditing } from '../hooks/useScreenUIEditing';
import { frameSceneObjectEvent, getAssetSource, getDefaultSceneObjectTag, getSceneArrowMovement, getSceneAssetPreviewType, getSceneSelectionBounds, getSceneSource, getSceneSpritePlacement, getSceneSpriteScale, isReplaceableSprite, isSceneFrameShortcut, nudgeSceneSelection, sceneAssetDragEvent, sceneAssetDragType, sceneKeyboardPlacementEvent, sceneObjectDefaults, sceneObjectDragType, sceneObjectKinds, scenePointerDragEvent, type SceneImageAsset, type SceneKeyboardPlacementRequest, type SceneObjectKind, type SceneObjectPlacement, type ScenePointerDrag, type ScenePoint } from '../utils/scene-objects';
import { browserPreviewUrl, getSpriteImageFileError, importSpriteImage } from '../utils/helpers';

const shapePreviewDimensions: Record<SceneObjectKind, { width: number; height: number }> = {
  Rectangle: sceneObjectDefaults.Rectangle,
  Circle: { width: sceneObjectDefaults.Circle.radius * 2, height: sceneObjectDefaults.Circle.radius * 2 },
  Line: { width: sceneObjectDefaults.Line.length, height: sceneObjectDefaults.Line.strokeWidth },
  Text: sceneObjectDefaults.Text,
};
const sceneGridSizes = [8, 16, 32, 64];
const clampSceneZoom = (zoom: number) => Math.max(0.1, Math.min(8, zoom));

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
  // The mobile drawer covers part of the canvas without changing its world projection.
  const viewport = canvas.closest('.viewport-panel')?.getBoundingClientRect();
  const exposedHeight = Math.max(0, Math.min(bounds.bottom, viewport?.bottom ?? bounds.bottom) - bounds.top);
  const { zoom, position } = Engine.camera;
  if (!bounds.width || !exposedHeight || !canvas.width || !canvas.height || zoom <= 0) return;
  const scaleX = bounds.width / canvas.width * zoom;
  const scaleY = bounds.height / canvas.height * zoom;
  return { bounds, exposedHeight, position, scaleX, scaleY };
}

type CanvasProjection = NonNullable<ReturnType<typeof getCanvasProjection>>;

function projectCanvasPoint({ x, y }: ScenePoint, { bounds, position, scaleX, scaleY }: CanvasProjection) {
  return { x, y, scaleX, scaleY, left: bounds.left + (x - position.x) * scaleX,
    top: bounds.top + (y - position.y) * scaleY };
}

type ProjectedPlacement = ReturnType<typeof projectCanvasPoint> & {
  alignment?: ReturnType<typeof getViewportAlignment>;
};

function getDropDimensions({ kind, asset }: DropPreviewItem) {
  if (asset) {
    const scale = getSceneSpriteScale(asset.image);
    return { width: asset.image.naturalWidth * scale, height: asset.image.naturalHeight * scale };
  }
  return kind && shapePreviewDimensions[kind];
}

function getCanvasPlacement(canvas: HTMLCanvasElement, step: number, clientX?: number, clientY?: number,
  alignItem?: DropPreviewItem): ProjectedPlacement | undefined {
  const projection = getCanvasProjection(canvas);
  if (!projection) return;
  const { bounds, exposedHeight, position, scaleX, scaleY } = projection;
  const x = snapToGrid(((clientX ?? bounds.left + bounds.width / 2) - bounds.left) / scaleX + position.x, step);
  const y = snapToGrid(((clientY ?? bounds.top + exposedHeight / 2) - bounds.top) / scaleY + position.y, step);
  const dimensions = alignItem && getDropDimensions(alignItem);
  if (!dimensions) return projectCanvasPoint({ x, y }, projection);

  // A Line's origin is on the stroke centre, while other Library objects start at the top left.
  const top = alignItem?.kind === 'Line' ? y - dimensions.height / 2 : y;
  const footprint = { left: x, right: x + dimensions.width, top, bottom: top + dimensions.height };
  const objects = Engine.currentScene?.objects ?? Engine.objects;
  const alignment = getViewportAlignment(footprint, objects, Engine.camera, canvas);
  const snapped = { x: x + (alignment?.x?.delta ?? 0), y: y + (alignment?.y?.delta ?? 0) };
  return { ...projectCanvasPoint(snapped, projection), alignment };
}

function keepPointOnCanvas(point: ScenePoint, { bounds, exposedHeight, position, scaleX, scaleY }: CanvasProjection, step: number) {
  const clamp = (value: number, start: number, span: number) => {
    const min = Math.ceil(start / step) * step;
    const max = Math.floor((start + span) / step) * step;
    return min <= max ? Math.min(max, Math.max(min, value)) : snapToGrid(start + span / 2, step);
  };
  return { x: clamp(point.x, position.x, bounds.width / scaleX), y: clamp(point.y, position.y, exposedHeight / scaleY) };
}

interface KeyboardPlacement extends SceneKeyboardPlacementRequest {
  canvas: HTMLCanvasElement;
  scene: typeof Engine.currentScene;
  point: ScenePoint;
}

interface CameraPan {
  canvas: HTMLCanvasElement;
  scene: typeof Engine.currentScene;
  pointerType: string;
  contacts: Map<number, ScenePoint>;
  origin: ScenePoint & { zoom: number };
}

interface DropPreviewItem {
  kind?: SceneObjectKind;
  asset?: SceneImageAsset;
  importingImage?: boolean;
}

interface DropPan {
  canvas: HTMLCanvasElement;
  scene: typeof Engine.currentScene;
  camera: typeof Engine.camera;
  point: ScenePoint;
  item: DropPreviewItem;
  frame: number;
  origin?: ScenePoint;
}

function getCameraContactFrame(contacts: ReadonlyMap<number, ScenePoint>) {
  const [first, second] = contacts.values();
  if (!second) return { centre: first, distance: 1 };
  return {
    centre: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
    distance: Math.max(8, Math.hypot(first.x - second.x, first.y - second.y)),
  };
}

function getEdgePanStrength(offset: number, size: number) {
  const edge = Math.min(40, size / 4);
  if (offset < edge) return (offset - edge) / edge;
  if (offset > size - edge) return (offset - (size - edge)) / edge;
  return 0;
}

function getEdgePanDelta({ bounds, exposedHeight, scaleX, scaleY }: CanvasProjection, x: number, y: number, elapsedMs: number) {
  if (x < 0 || x > bounds.width || y < 0 || y > exposedHeight) return;
  const travel = 0.45 * Math.max(0, Math.min(elapsedMs, 50));
  const dx = getEdgePanStrength(x, bounds.width) * travel / scaleX;
  const dy = getEdgePanStrength(y, exposedHeight) * travel / scaleY;
  if (dx || dy) return { x: dx, y: dy };
}

const Viewport: React.FC<{
  runtimeError?: GameRunError;
  inspectorVisible: boolean;
  onOpenConsole: () => void;
  onOpenInspector: () => void;
}> = ({ runtimeError, inspectorVisible, onOpenConsole, onOpenInspector }) => {
  const { 
    currentScriptId,
    isViewportReady, 
    setIsViewportReady, 
    mobile,
    openTool,
    selectedObject,
    pendingCanvasPlacements,
    canUndoCanvasEdit,
    canRedoCanvasEdit,
    changeCanvasHistory,
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
  const sceneControlsRef = useRef<HTMLDivElement>(null);
  const [sceneControlsPosition, setSceneControlsPosition] = useState({ x: 12, y: 12 });
  const [screenControlsPosition, setScreenControlsPosition] = useState<ScenePoint>();
  const sceneControlsDrag = useRef<{ x: number; y: number } | null>(null);
  const sceneControlsResize = useRef<ScenePoint | null>(null);
  const [sceneControlsSize, setSceneControlsSize] = useState<{ width: number; height: number }>();

  const moveSceneControls = (x: number, y: number) => {
    const panel = sceneControlsRef.current;
    const parent = panel?.parentElement;
    if (!panel || !parent) return;
    const setPosition = isEditingScreenUI ? setScreenControlsPosition : setSceneControlsPosition;
    setPosition({
      x: Math.max(0, Math.min(x, parent.clientWidth - panel.offsetWidth)),
      y: Math.max(0, Math.min(y, parent.clientHeight - panel.offsetHeight)),
    });
  };

  const isEditingScreenUI = useSyncExternalStore(screenUIPreview.subscribe, () => screenUIPreview.getSnapshot().editing);
  const hasScreenUI = useSyncExternalStore(screenUIPreview.subscribe, () => !!screenUIPreview.getSnapshot().frame?.controls.length);
  const screenUISelected = useSyncExternalStore(screenUIPreview.subscribe, () => screenUIPreview.getSnapshot().selected !== undefined);
  const canUndoScreenUI = useSyncExternalStore(screenUIPreview.subscribe, () => !!screenUIPreview.getSnapshot().canUndo);
  const canRedoScreenUI = useSyncExternalStore(screenUIPreview.subscribe, () => !!screenUIPreview.getSnapshot().canRedo);
  const { start: startScreenUIEditing, finish: finishScreenUIEditing } = useScreenUIEditing();
  const isEditingScene = !isEditingScreenUI && !browserPreviewUrl && isPaused && isDebug;
  const showEditingControls = isEditingScene || isEditingScreenUI;
  const controlsPosition = isEditingScreenUI ? screenControlsPosition : sceneControlsPosition;
  const savedCamera = useRef<{ canvas: HTMLCanvasElement; scene: typeof Engine.currentScene;
    x: number; y: number; zoom: number } | null>(null);
  const pan = useRef<CameraPan | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [isPanTool, setIsPanTool] = useState(false);
  const [isSpacePan, setIsSpacePan] = useState(false);
  const [zoomPercent, setZoomPercent] = useState<number>();
  const [snapMode, setSnapMode] = useState<'off' | 'grid' | 'objects'>('off');
  const isGridSnapping = snapMode === 'grid';
  const isAlignmentSnapping = snapMode === 'objects';
  const [sceneGridSize, setSceneGridSize] = useState(16);
  const [screenGridSize, setScreenGridSize] = useState(16);
  const [snapScreenUI, setSnapScreenUI] = useState(false);
  const [keepProportions, setKeepProportions] = useState(false);
  const [snapRotation, setSnapRotation] = useState(false);
  const placementStep = isGridSnapping ? sceneGridSize : 1;
  const [placementStatus, setPlacementStatus] = useState<{ message: string; error?: boolean; pending?: boolean }>();
  const importingImage = useRef(false);
  const draggedAsset = useRef<SceneImageAsset | null>(null);
  const dropPan = useRef<DropPan | null>(null);
  const [manipulationReadout, setManipulationReadout] = useState('');
  const [keyboardPlacement, setKeyboardPlacement] = useState<KeyboardPlacement>();
  const isPanReady = isEditingScene && (isPanTool || isSpacePan) && !keyboardPlacement;
  const historyBlockedReason = keyboardPlacement || manipulationReadout
    ? 'Finish or cancel the current edit before using history.' : '';
  const codeHistoryBlockedReason = pendingCanvasPlacements.size > 0
    ? 'Apply or discard canvas changes before using code history.' : '';
  const [dropGuide, setDropGuide] = useState<{
    x: number; y: number; left: number; top: number; kind?: SceneObjectKind;
    width?: number; height?: number;
    alignmentLeft?: number; alignmentTop?: number;
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
    if (!isEditingScene || snapMode === 'off') return;
    const previousGridSize = Engine.debugPositionGridSize;
    const previousAlignment = Engine.debugSnapAlignment;
    Engine.debugPositionGridSize = snapMode === 'grid' ? sceneGridSize : 0;
    Engine.debugSnapAlignment = snapMode === 'objects';
    return () => {
      Engine.debugPositionGridSize = previousGridSize;
      Engine.debugSnapAlignment = previousAlignment;
    };
  }, [isEditingScene, snapMode, sceneGridSize]);

  useEffect(() => {
    if (!isEditingScene) return;
    const previousProportions = Engine.debugKeepProportions;
    const previousSnapRotation = Engine.debugSnapRotation;
    Engine.debugKeepProportions = keepProportions;
    Engine.debugSnapRotation = snapRotation;
    return () => {
      Engine.debugKeepProportions = previousProportions;
      Engine.debugSnapRotation = previousSnapRotation;
    };
  }, [isEditingScene, keepProportions, snapRotation]);

  useEffect(() => {
    if (!isEditingScene) return;
    const clear = () => setManipulationReadout('');
    const update = ({ detail }: CustomEvent<ObjectManipulationPreview | null>) => {
      if (!detail) {
        clear();
        return;
      }
      const { object, kind, value, proportional } = detail;
      const resizeLabel = proportional ? 'Resize proportionally' : 'Resize';
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
        setManipulationReadout(`${resizeLabel} · Scale X ${x} · Y ${y}`);
      } else {
        setManipulationReadout(`${resizeLabel} · W ${x} · H ${y}`);
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

  const getPointerPlacement = useCallback((canvas: HTMLCanvasElement, clientX?: number, clientY?: number, item?: DropPreviewItem) => {
    const align = isEditingScene && isAlignmentSnapping && clientX !== undefined && clientY !== undefined;
    return getCanvasPlacement(canvas, placementStep, clientX, clientY, align ? item : undefined);
  }, [isEditingScene, isAlignmentSnapping, placementStep]);

  const getPlacementPoint = useCallback((clientX?: number, clientY?: number, item?: DropPreviewItem) => {
    const canvas = viewportContainerRef.current?.querySelector<HTMLCanvasElement>('canvas#canvas');
    return canvas ? getPointerPlacement(canvas, clientX, clientY, item) : undefined;
  }, [getPointerPlacement]);

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
    const placement: SceneObjectPlacement | undefined = kind === 'Sprite'
      ? asset && getSceneSpritePlacement(asset, point, currentScriptId, scene)
      : { kind, tag: getDefaultSceneObjectTag(kind), x: point.x, y: point.y, scene };
    if (!placement) return rejectPlacement('This image needs a reusable URL before it can be added to the script.');
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
    if (!mobile) openTool('inspector');
  }, [mobile, openTool, setIsDebug, setIsPaused]);

  const placeLibraryObject = useCallback((kind: SceneObjectKind, x?: number, y?: number) => {
    const placed = addObject(kind, getPlacementPoint(x, y, { kind }));
    if (placed) enterSceneEditing();
    return placed;
  }, [addObject, enterSceneEditing, getPlacementPoint]);

  const rememberCamera = useCallback((canvas: HTMLCanvasElement) => {
    const scene = Engine.currentScene;
    if (savedCamera.current?.canvas === canvas && savedCamera.current.scene === scene) return;
    const { position, zoom } = Engine.camera;
    savedCamera.current = { canvas, scene, x: position.x, y: position.y, zoom };
  }, []);

  const showDropGuide = useCallback((point: ProjectedPlacement | undefined, item: DropPreviewItem) => {
    const rect = viewportContainerRef.current?.getBoundingClientRect();
    if (!point || !rect) {
      setDropGuide(undefined);
      return;
    }
    const { kind, asset, importingImage } = item;
    const dimensions = getDropDimensions(item);
    const { alignment, scaleX, scaleY } = point;
    const left = point.left - rect.left;
    const top = point.top - rect.top;
    setDropGuide({ x: point.x, y: point.y, left, top, kind, importingImage,
      width: dimensions && dimensions.width * scaleX, height: dimensions && dimensions.height * scaleY,
      alignmentLeft: alignment?.x && left + (alignment.x.coordinate - point.x) * scaleX,
      alignmentTop: alignment?.y && top + (alignment.y.coordinate - point.y) * scaleY,
      asset: asset && { tag: asset.tag, src: asset.image.src } });
  }, []);

  const finishDropPreview = useCallback((placed = false) => {
    const drag = dropPan.current;
    dropPan.current = null;
    if (drag) {
      cancelAnimationFrame(drag.frame);
      if (!placed && drag.origin && drag.canvas.isConnected && drag.scene === Engine.currentScene && drag.camera === Engine.camera) {
        drag.camera.position.set(drag.origin.x, drag.origin.y);
      }
    }
    setDropGuide(undefined);
  }, []);

  const showPointerDropGuide = useCallback((canvas: HTMLCanvasElement, point: ScenePoint, item: DropPreviewItem) => {
    showDropGuide(getPointerPlacement(canvas, point.x, point.y, item), item);
    if (!isEditingScene || item.importingImage || (!item.kind && !item.asset)) return;
    if (dropPan.current) {
      dropPan.current.point = point;
      dropPan.current.item = item;
      return;
    }

    const drag: DropPan = { canvas, scene: Engine.currentScene, camera: Engine.camera, point, item, frame: 0 };
    let previousTime = performance.now();
    const panAtEdge = (now: number) => {
      if (!canvas.isConnected || drag.scene !== Engine.currentScene || drag.camera !== Engine.camera) {
        finishDropPreview();
        return;
      }
      drag.frame = requestAnimationFrame(panAtEdge);
      const elapsed = now - previousTime;
      previousTime = now;
      const projection = getCanvasProjection(canvas);
      if (!projection || pan.current || Input.isManipulatingObject) return;
      const { point, item } = drag;
      const { bounds, position } = projection;
      const delta = getEdgePanDelta(projection, point.x - bounds.left, point.y - bounds.top, elapsed);
      if (!delta) return;
      rememberCamera(canvas);
      drag.origin ??= { x: position.x, y: position.y };
      position.set(position.x + delta.x, position.y + delta.y);
      showDropGuide(getPointerPlacement(canvas, point.x, point.y, item), item);
    };
    dropPan.current = drag;
    drag.frame = requestAnimationFrame(panAtEdge);
  }, [finishDropPreview, getPointerPlacement, isEditingScene, rememberCamera, showDropGuide]);

  useEffect(() => {
    const cancel = () => { if (dropPan.current) finishDropPreview(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    window.addEventListener('dragend', cancel, true);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', escape);
    window.addEventListener('playground-before-run', cancel);
    return () => {
      window.removeEventListener('dragend', cancel, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', escape);
      window.removeEventListener('playground-before-run', cancel);
      cancel();
    };
  }, [isEditingScene, finishDropPreview]);

  const cancelKeyboardPlacement = useCallback(() => {
    setKeyboardPlacement(undefined);
    setDropGuide(undefined);
  }, []);

  useEffect(() => {
    if (browserPreviewUrl) return;
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
    return addObject('Sprite', getPlacementPoint(x, y, { asset }), asset);
  }, [addObject, getPlacementPoint]);

  useEffect(() => {
    if (browserPreviewUrl) return;
    const updatePointerDrag = (event: Event) => {
      const { detail } = event as CustomEvent<ScenePointerDrag | null>;
      if (!detail || ('asset' in detail && !isEditingScene)) {
        finishDropPreview();
        return;
      }
      const { phase, point: { x, y } } = detail;
      setKeyboardPlacement(undefined);
      const target = document.elementFromPoint(x, y);
      const isOverCanvas = target instanceof HTMLCanvasElement && target.id === 'canvas' &&
        viewportContainerRef.current?.contains(target);
      if (isOverCanvas && phase === 'preview') {
        showPointerDropGuide(target, detail.point, detail);
      } else if (isOverCanvas && phase === 'drop') {
        const placed = 'asset' in detail ? placeLoadedImage(detail.asset, x, y) : placeLibraryObject(detail.kind, x, y);
        finishDropPreview(placed);
      } else {
        finishDropPreview();
      }
    };
    window.addEventListener(scenePointerDragEvent, updatePointerDrag);
    return () => window.removeEventListener(scenePointerDragEvent, updatePointerDrag);
  }, [finishDropPreview, isEditingScene, placeLibraryObject, placeLoadedImage, showPointerDropGuide]);

  const placeImageFile = useCallback(async (files: File[], x?: number, y?: number) => {
    const reject = (message: string) => setPlacementStatus({ message, error: true });
    if (importingImage.current) return reject('Wait for the current image to finish importing.');
    const fileError = getSpriteImageFileError(files);
    if (fileError) return reject(fileError);
    const [file] = files;
    const point = getPlacementPoint(x, y);
    const run = document.querySelector<HTMLElement>('script[data-playground-script]');
    if (!point || run?.dataset.playgroundScript !== currentScriptId) {
      return reject('Run the open Dino GE script before importing an image.');
    }
    const scene = Engine.currentScene;
    importingImage.current = true;
    setPlacementStatus({ message: `Importing ${file.name}…`, pending: true });
    try {
      const asset = await importSpriteImage(file, currentScriptId, () => run.isConnected);
      if (!asset) return;
      if (scene !== Engine.currentScene) return reject('The active scene changed. Drop the image again to place it there.');
      if (addObject('Sprite', point, asset)) enterSceneEditing();
    } catch (error) {
      if (run.isConnected) {
        reject(error instanceof Error ? error.message : 'The image could not be opened.');
      }
    } finally {
      importingImage.current = false;
    }
  }, [addObject, currentScriptId, enterSceneEditing, getPlacementPoint]);

  useEffect(() => {
    const importImage = (event: Event) => void placeImageFile((event as CustomEvent<File[]>).detail);
    window.addEventListener('playground-import-image', importImage);
    return () => window.removeEventListener('playground-import-image', importImage);
  }, [placeImageFile]);

  useEffect(() => {
    if (browserPreviewUrl) return;
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
    window.addEventListener(sceneAssetDragEvent, trackAssetDrag);
    window.addEventListener('playground-before-run', clearAssetDrag);
    return () => {
      window.removeEventListener('playground-place-asset', placeAsset);
      window.removeEventListener('playground-replace-sprite-image', replaceAsset);
      window.removeEventListener(sceneAssetDragEvent, trackAssetDrag);
      window.removeEventListener('playground-before-run', clearAssetDrag);
      clearAssetDrag();
    };
  }, [currentScriptId, placeLoadedImage, isEditingScene]);

  const toggleSceneEditing = () => {
    if (isEditingScreenUI && !finishScreenUIEditing()) {
      openTool('inspector');
      return;
    }
    const editing = !isEditingScene;
    if (!editing) restoreCamera();
    setIsPaused(editing);
    setIsDebug(editing);
    if (editing) {
      if (!mobile) openTool('inspector');
      viewportContainerRef.current?.focus();
    }
  };

  useEffect(() => {
    if (!isEditingScene) return;
    let frame: number | undefined;
    let canvas: HTMLCanvasElement | undefined;
    let scene = Engine.currentScene;
    let previousTime = 0;

    const stop = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      canvas = undefined;
    };

    const panAtEdge = (now: number) => {
      if (!canvas?.isConnected || scene !== Engine.currentScene || !Input.isManipulatingObject) {
        stop();
        return;
      }
      frame = requestAnimationFrame(panAtEdge);
      const elapsed = now - previousTime;
      previousTime = now;
      const projection = getCanvasProjection(canvas);
      if (!projection) return;
      const { position, scaleX, scaleY } = projection;
      const x = (Input.mouseX - position.x) * scaleX;
      const y = (Input.mouseY - position.y) * scaleY;
      const delta = getEdgePanDelta(projection, x, y, elapsed);
      if (!delta) return;
      rememberCamera(canvas);
      Input.panObjectDragBy(delta.x, delta.y);
    };

    const update = ({ detail }: CustomEvent<ObjectManipulationPreview | null>) => {
      if (detail?.kind !== 'drag') {
        stop();
        return;
      }
      if (frame !== undefined) return;
      canvas = viewportContainerRef.current?.querySelector<HTMLCanvasElement>('canvas#canvas') ?? undefined;
      if (!canvas) return;
      scene = Engine.currentScene;
      previousTime = performance.now();
      frame = requestAnimationFrame(panAtEdge);
    };

    Engine.on('objectManipulationPreview', update);
    window.addEventListener('playground-before-run', stop);
    return () => {
      Engine.off('objectManipulationPreview', update);
      window.removeEventListener('playground-before-run', stop);
      stop();
    };
  }, [isEditingScene, rememberCamera]);

  const endPan = useCallback((cancel = false) => {
    const drag = pan.current;
    if (!drag) return;
    pan.current = null;
    setIsPanning(false);
    if (cancel && drag.canvas.isConnected && drag.scene === Engine.currentScene) {
      Engine.camera.position.set(drag.origin.x, drag.origin.y);
      Engine.camera.zoom = drag.origin.zoom;
      setZoomPercent(Math.round(drag.origin.zoom * 100));
    }
    for (const id of drag.contacts.keys()) {
      if (drag.canvas.hasPointerCapture(id)) drag.canvas.releasePointerCapture(id);
    }
  }, []);

  const restoreCamera = useCallback(() => {
    const saved = savedCamera.current;
    savedCamera.current = null;
    if (dropPan.current) finishDropPreview();
    endPan();
    if (saved?.canvas.isConnected && saved.scene === Engine.currentScene) {
      Input.cancelObjectManipulation();
      Engine.camera.position.set(saved.x, saved.y);
      Engine.camera.zoom = saved.zoom;
    }
    setZoomPercent(undefined);
  }, [endPan, finishDropPreview]);

  useEffect(() => {
    if (!isEditingScene) return;
    let scene = Engine.currentScene;
    const updateSceneZoom = () => {
      if (Engine.currentScene === scene) return;
      scene = Engine.currentScene;
      endPan();
      setZoomPercent(undefined);
    };
    const cancelNavigation = () => {
      setIsSpacePan(false);
      endPan(true);
    };
    window.addEventListener('playground-before-run', restoreCamera);
    window.addEventListener('blur', cancelNavigation);
    Engine.on('sceneHierarchyChanged', updateSceneZoom);
    return () => {
      window.removeEventListener('playground-before-run', restoreCamera);
      window.removeEventListener('blur', cancelNavigation);
      Engine.off('sceneHierarchyChanged', updateSceneZoom);
      setIsPanTool(false);
      setIsSpacePan(false);
      restoreCamera();
    };
  }, [isEditingScene, endPan, restoreCamera]);

  const transformView = useCallback((canvas: HTMLCanvasElement, factor: number, from?: ScenePoint, to = from) => {
    const bounds = canvas.getBoundingClientRect();
    const { position, zoom } = Engine.camera;
    if (!bounds.width || !bounds.height || !canvas.width || !canvas.height || !Number.isFinite(zoom) || zoom <= 0) return;
    const next = factor === 1 ? zoom : clampSceneZoom(zoom * factor);
    const x = from ? from.x - bounds.left : bounds.width / 2;
    const y = from ? from.y - bounds.top : bounds.height / 2;
    const nextX = to ? to.x - bounds.left : x;
    const nextY = to ? to.y - bounds.top : y;
    if (next === zoom && nextX === x && nextY === y) return;
    rememberCamera(canvas);
    position.set(position.x + (x / zoom - nextX / next) * canvas.width / bounds.width,
      position.y + (y / zoom - nextY / next) * canvas.height / bounds.height);
    if (next !== zoom) {
      Engine.camera.zoom = next;
      setZoomPercent(Math.round(next * 100));
    }
  }, [rememberCamera]);

  const zoomView = useCallback((factor: number, pointer?: ScenePoint) => {
    if (pan.current || dropPan.current || keyboardPlacement || Input.isManipulatingObject) return;
    const canvas = viewportContainerRef.current?.querySelector<HTMLCanvasElement>('canvas#canvas');
    if (canvas) transformView(canvas, factor, pointer);
  }, [keyboardPlacement, transformView]);

  useEffect(() => {
    const viewport = viewportContainerRef.current;
    if (!isEditingScene || !viewport) return;
    const wheelZoom = (event: WheelEvent) => {
      if (!(event.target instanceof HTMLCanvasElement)) return;
      event.preventDefault();
      event.stopPropagation();
      const mode = event.deltaMode;
      if (!event.deltaY) return;
      const unit = mode === WheelEvent.DOM_DELTA_LINE ? 16
        : mode === WheelEvent.DOM_DELTA_PAGE ? event.target.clientHeight : 1;
      zoomView(Math.exp(-event.deltaY * unit / 500), { x: event.clientX, y: event.clientY });
    };
    viewport.addEventListener('wheel', wheelZoom, { capture: true, passive: false });
    return () => viewport.removeEventListener('wheel', wheelZoom, true);
  }, [isEditingScene, zoomView]);

  const frameObject = useCallback((object: GameObject | null) => {
    if (!isEditingScene || !object || keyboardPlacement || pan.current || dropPan.current || Input.isManipulatingObject) return;
    const canvas = viewportContainerRef.current?.querySelector<HTMLCanvasElement>('canvas#canvas');
    const view = canvas?.getBoundingClientRect();
    if (!canvas?.width || !canvas.height || !view?.height) return;
    const members = Engine.currentScene?.objects ?? Engine.objects;
    if (!members.has(object)) return;
    const bounds = getSceneSelectionBounds(object, members);
    if (!Object.values(bounds).every(Number.isFinite)) return;

    const { width, height } = canvas;
    const controls = sceneControlsRef.current?.getBoundingClientRect();
    const controlsBottom = controls ? (controls.bottom - view.top) * height / view.height : 0;
    const paddingX = Math.min(48, width / 4);
    // Leave room for object handles and the two floating toolbars.
    const top = Math.min(height / 2, Math.max(48, controlsBottom + 28));
    const bottom = height - Math.min(80, height / 4);
    const selectionWidth = bounds.right - bounds.left;
    const selectionHeight = bounds.bottom - bounds.top;
    const zoom = selectionWidth || selectionHeight ? clampSceneZoom(Math.min(
      (width - 2 * paddingX) / Math.max(1, selectionWidth),
      (bottom - top) / Math.max(1, selectionHeight),
    )) : Engine.camera.zoom;
    rememberCamera(canvas);
    Engine.camera.zoom = zoom;
    setZoomPercent(Math.round(zoom * 100));
    Engine.camera.position.set(bounds.left + selectionWidth / 2 - width / (2 * zoom),
      bounds.top + selectionHeight / 2 - (top + bottom) / (2 * zoom));
    Engine.selectedObject = object;
  }, [isEditingScene, keyboardPlacement, rememberCamera]);

  useEffect(() => {
    const onFrameObject = (event: Event) => frameObject((event as CustomEvent<GameObject>).detail);
    window.addEventListener(frameSceneObjectEvent, onFrameObject);
    return () => window.removeEventListener(frameSceneObjectEvent, onFrameObject);
  }, [frameObject]);

  const suppressGameActivation = (event: React.MouseEvent | React.KeyboardEvent) => {
    if (!isEditingScene || !(event.target instanceof HTMLCanvasElement)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const changeSceneHistory = (action: 'undo' | 'redo') => {
    if (historyBlockedReason || Input.isManipulatingObject || dropPan.current) return;
    if (changeCanvasHistory(action) || codeHistoryBlockedReason) return;
    window.dispatchEvent(new CustomEvent('playground-code-history', { detail: action }));
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

  const toggleScreenUIEditing = () => {
    if (isEditingScreenUI) {
      if (!finishScreenUIEditing()) openTool('inspector');
    } else if (startScreenUIEditing() && !mobile) {
      openTool('inspector');
    }
  };

  return (
    <div className="viewport-panel" onKeyDownCapture={event => {
      if (!isEditingScreenUI || event.altKey || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key !== 'z' && !(key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      if (key === 'y' || event.shiftKey) screenUIPreview.redo();
      else screenUIPreview.undo();
    }}>
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
        className={isPanning ? 'scene-panning' : isPanReady ? 'scene-pan-ready' : undefined}
        style={isEditingScene ? { touchAction: 'none' } : undefined}
        role={isEditingScene || keyboardPlacement ? 'region' : undefined}
        aria-label={isEditingScene || keyboardPlacement ? 'Scene viewport' : undefined}
        aria-describedby={keyboardPlacement ? 'scene-placement-keyboard-hint' : isEditingScene ? 'scene-edit-zoom scene-keyboard-hint' : undefined}
        tabIndex={isEditingScene ? 0 : -1}
        onBlur={event => {
          if (event.currentTarget.contains(event.relatedTarget)) return;
          setIsSpacePan(false);
          if (keyboardPlacement) cancelKeyboardPlacement();
        }}
        onPointerDownCapture={event => {
          if (keyboardPlacement) cancelKeyboardPlacement();
          if (!isEditingScene || !(event.target instanceof HTMLCanvasElement)) return;
          const canvas = event.target;
          const activePan = pan.current;
          if (activePan) {
            event.preventDefault();
            event.stopPropagation();
            if (isPanTool && event.pointerType === 'touch' && event.button === 0 && activePan.pointerType === 'touch' &&
                activePan.canvas === canvas && activePan.contacts.size === 1) {
              activePan.contacts.set(event.pointerId, { x: event.clientX, y: event.clientY });
              canvas.setPointerCapture(event.pointerId);
            }
            return;
          }
          const canPan = event.button === 1 || (event.button === 0 && isPanReady);
          if (!canPan || !event.isPrimary || Input.isManipulatingObject) return;
          event.preventDefault();
          event.stopPropagation();
          rememberCamera(canvas);
          const { position: { x, y }, zoom } = Engine.camera;
          pan.current = { canvas, scene: Engine.currentScene, pointerType: event.pointerType,
            contacts: new Map([[event.pointerId, { x: event.clientX, y: event.clientY }]]), origin: { x, y, zoom } };
          event.currentTarget.focus({ preventScroll: true });
          canvas.setPointerCapture(event.pointerId);
          setIsPanning(true);
        }}
        onPointerMove={event => {
          const drag = pan.current;
          if (!drag?.contacts.has(event.pointerId)) return;
          if (drag.scene !== Engine.currentScene) {
            endPan();
            return;
          }
          const previous = getCameraContactFrame(drag.contacts);
          drag.contacts.set(event.pointerId, { x: event.clientX, y: event.clientY });
          const next = getCameraContactFrame(drag.contacts);
          transformView(drag.canvas, next.distance / previous.distance, previous.centre, next.centre);
        }}
        onPointerUp={event => {
          const contacts = pan.current?.contacts;
          if (contacts?.delete(event.pointerId) && !contacts.size) endPan();
        }}
        onPointerCancel={event => {
          if (pan.current?.contacts.has(event.pointerId)) endPan(true);
        }}
        onLostPointerCapture={event => {
          if (pan.current?.contacts.has(event.pointerId)) endPan(true);
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
          showPointerDropGuide(event.target, { x: event.clientX, y: event.clientY }, { kind, asset, importingImage });
        }}
        onDragLeave={() => finishDropPreview()}
        onDrop={event => {
          if (!(event.target instanceof HTMLCanvasElement)) {
            finishDropPreview();
            return;
          }
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            finishDropPreview();
            void placeImageFile(Array.from(event.dataTransfer.files), event.clientX, event.clientY);
            return;
          }
          if (isEditingScene && event.dataTransfer.types.includes(sceneAssetDragType)) {
            event.preventDefault();
            const asset = draggedAsset.current;
            draggedAsset.current = null;
            const placed = asset?.tag === event.dataTransfer.getData(sceneAssetDragType) &&
              placeLoadedImage(asset, event.clientX, event.clientY);
            finishDropPreview(placed);
            return;
          }
          const kind = sceneObjectKinds.find(item => item === event.dataTransfer.getData(sceneObjectDragType));
          if (kind) event.preventDefault();
          finishDropPreview(!!kind && placeLibraryObject(kind, event.clientX, event.clientY));
        }}
        onClickCapture={suppressGameActivation}
        onKeyDownCapture={event => {
          if (handleKeyboardPlacement(event)) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (isEditingScene && (event.target === event.currentTarget || event.target instanceof HTMLCanvasElement)) {
            const key = event.key.toLowerCase();
            if ((key === 'escape' && pan.current) ||
                (key === ' ' && !keyboardPlacement && !event.altKey && !event.ctrlKey && !event.metaKey && !Input.isManipulatingObject)) {
              event.preventDefault();
              event.stopPropagation();
              if (key === 'escape') endPan(true);
              else setIsSpacePan(true);
              return;
            }
            const isHistoryShortcut = !event.altKey && (event.ctrlKey || event.metaKey) &&
              (key === 'z' || (key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey));
            const isFrameShortcut = isSceneFrameShortcut(event);
            if (isHistoryShortcut || isFrameShortcut || nudgeSceneSelection(event)) {
              event.preventDefault();
              event.stopPropagation();
              if (isHistoryShortcut && !event.repeat) changeSceneHistory(event.shiftKey || key === 'y' ? 'redo' : 'undo');
              if (isFrameShortcut && !event.repeat) frameObject(selectedObject);
              return;
            }
          }
          if (event.key === 'Enter' || event.key === ' ') suppressGameActivation(event);
        }}
        onKeyUpCapture={event => {
          if (event.key === ' ' && isSpacePan) setIsSpacePan(false);
        }}
      />
      {(showEditingControls || keyboardPlacement || placementStatus?.error || placementStatus?.pending) && (
        <div className={`scene-edit-controls${isEditingScreenUI ? ' screen-ui-edit-controls' : ''}`}
          ref={sceneControlsRef} role={showEditingControls ? 'group' : undefined}
          data-default-position={isEditingScreenUI && !screenControlsPosition || undefined}
          aria-label={isEditingScreenUI ? 'Screen UI editing' : isEditingScene ? 'Scene editing' : undefined}
          style={showEditingControls ? {
            '--scene-controls-left': controlsPosition ? `${controlsPosition.x}px` : 'max(12px, 100% - 240px)',
            '--scene-controls-top': `${controlsPosition?.y ?? 12}px`,
            ...(isEditingScene ? sceneControlsSize : undefined),
          } as React.CSSProperties : undefined}>
          {showEditingControls && <button type="button" className="scene-controls-drag"
              aria-label={isEditingScreenUI ? 'Move Screen UI controls' : 'Move scene controls'}
              title="Drag to move editing controls or use the arrow keys"
              onPointerDown={event => {
                if (!event.isPrimary || event.button !== 0) return;
                const panel = sceneControlsRef.current;
                if (!panel) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                sceneControlsDrag.current = { x: event.clientX - panel.offsetLeft, y: event.clientY - panel.offsetTop };
              }}
              onPointerMove={event => {
                const drag = sceneControlsDrag.current;
                if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
                moveSceneControls(event.clientX - drag.x, event.clientY - drag.y);
              }}
              onLostPointerCapture={() => { sceneControlsDrag.current = null; }}
              onKeyDown={event => {
                const direction = getSceneArrowMovement(event);
                const panel = sceneControlsRef.current;
                if (!direction || !panel) return;
                event.preventDefault();
                event.stopPropagation();
                moveSceneControls(panel.offsetLeft + direction.x * 12, panel.offsetTop + direction.y * 12);
              }}>
              <i className="fa-solid fa-grip-lines" aria-hidden="true" />
            </button>}
          {isEditingScreenUI && <>
            <div className="scene-object-options" role="group" aria-label="Screen UI edit history">
              <button type="button" className="scene-control" aria-label="Undo Screen UI edit"
                disabled={!canUndoScreenUI} onClick={screenUIPreview.undo}>
                <i className="fa-solid fa-rotate-left" aria-hidden="true" /> Undo
              </button>
              <button type="button" className="scene-control" aria-label="Redo Screen UI edit"
                disabled={!canRedoScreenUI} onClick={screenUIPreview.redo}>
                <i className="fa-solid fa-rotate-right" aria-hidden="true" /> Redo
              </button>
              <button type="button" className="scene-control" onClick={toggleScreenUIEditing}>Done</button>
            </div>
            <div className="scene-object-options" role="group" aria-label="Screen UI snapping">
              <button type="button" className="scene-control" aria-label="Snap to grid" aria-pressed={snapScreenUI}
                title={`Snap moves and resize edges to the ${screenGridSize} px screen grid`}
                onClick={() => setSnapScreenUI(enabled => !enabled)}>Grid snap</button>
              <select className="scene-control scene-grid-size" aria-label="Grid cell size" value={screenGridSize}
                onChange={event => setScreenGridSize(Number(event.target.value))}>
                {sceneGridSizes.map(size => <option key={size} value={size}>{size} px</option>)}
              </select>
            </div>
            <span className="scene-edit-hint">{!screenUISelected ? 'Select a control on the canvas.' :
              'Drag to move or resize. Apply changes in Inspector.'}</span>
          </>}
          {isEditingScene && <>
            <div className="scene-object-options">
              <div className="scene-object-options" role="group" aria-label="Edit history">
                {(['undo', 'redo'] as const).map(action => {
                  const undo = action === 'undo';
                  const text = undo ? 'Undo' : 'Redo';
                  const canvasEdit = undo ? canUndoCanvasEdit : canRedoCanvasEdit;
                  const label = `${text} ${canvasEdit ? 'canvas' : 'code'} edit`;
                  const blocked = historyBlockedReason || (!canvasEdit && codeHistoryBlockedReason);
                  return (
                    <button key={action} type="button" className="scene-control" aria-label={label} disabled={!!blocked}
                      title={blocked || `${label} (Ctrl/⌘+${undo ? 'Z' : 'Shift+Z'})`} onClick={() => changeSceneHistory(action)}>
                      <i className={`fa-solid ${undo ? 'fa-rotate-left' : 'fa-rotate-right'}`} aria-hidden="true" /> {text}
                    </button>
                  );
                })}
              </div>
              <div className="scene-object-options" role="group" aria-label="Resize and rotation options">
                <button type="button" className="scene-control" aria-pressed={keepProportions}
                  title="Keep the width and height in proportion when resizing"
                  onClick={() => setKeepProportions(enabled => !enabled)}>Keep proportions</button>
                <button type="button" className="scene-control" aria-pressed={snapRotation}
                  onClick={() => setSnapRotation(enabled => !enabled)}>Snap rotation to 15°</button>
              </div>
            </div>
            <div className="scene-object-options" role="group" aria-label="Scene camera and snapping">
              <button type="button" className="scene-control scene-icon-control" aria-label="Pan view"
                title="Pan view · Drag to pan or pinch to zoom" aria-pressed={isPanTool}
                disabled={!!keyboardPlacement || !!manipulationReadout} onClick={() => setIsPanTool(enabled => !enabled)}>
                <i className="fa-solid fa-hand" aria-hidden="true" />
              </button>
              <button type="button" className="scene-control scene-icon-control" aria-label="Zoom out" title="Zoom out"
                onClick={() => zoomView(1 / 1.25)}><i className="fa-solid fa-magnifying-glass-minus" aria-hidden="true" /></button>
              <button type="button" className="scene-control scene-icon-control" aria-label="Zoom in" title="Zoom in"
                onClick={() => zoomView(1.25)}><i className="fa-solid fa-magnifying-glass-plus" aria-hidden="true" /></button>
              <button type="button" className="scene-control scene-icon-control" aria-label="Reset view" title="Reset view"
                onClick={restoreCamera}><i className="fa-solid fa-arrows-rotate" aria-hidden="true" /></button>
              <button type="button" className="scene-control" aria-label="Frame selection" title="Frame selected object or group (F)"
                aria-keyshortcuts="F" disabled={!selectedObject || !!keyboardPlacement || !!manipulationReadout}
                onClick={() => frameObject(selectedObject)}>Frame</button>
              <button type="button" className="scene-control" aria-label="Snap to grid"
                aria-pressed={isGridSnapping} title={`Snap moves, resizes and drops to the ${sceneGridSize} px grid`}
                onClick={() => setSnapMode(mode => mode === 'grid' ? 'off' : 'grid')}>Grid snap</button>
              <select className="scene-control scene-grid-size" aria-label="Grid cell size" value={sceneGridSize}
                onChange={event => setSceneGridSize(Number(event.target.value))}>
                {sceneGridSizes.map(size => <option key={size} value={size}>{size} px</option>)}
              </select>
              <button type="button" className="scene-control" aria-label="Align to objects"
                aria-pressed={isAlignmentSnapping} title="Snap moves and drops to visible edges and centres"
                onClick={() => setSnapMode(mode => mode === 'objects' ? 'off' : 'objects')}>Align</button>
            </div>
            <div className="scene-edit-reference">
              <span id="scene-edit-zoom">Zoom {zoomPercent ?? Math.round(Engine.camera.zoom * 100)}%</span>
              {!keyboardPlacement && <details className="scene-edit-shortcuts">
                <summary>Shortcuts</summary>
                <div id="scene-keyboard-hint" className="scene-edit-hint">
                  {isPanTool ? 'Drag to pan · Pinch to zoom' : 'Hold Space and drag to pan, or use the middle mouse button'}<br />
                  Wheel zooms at the pointer · F frames the selection<br />
                  {isGridSnapping ? 'Arrows move 1 cell · Shift moves 10 cells' : 'Arrows move 1 px · Shift moves 10 px'}<br />
                  Alt/Option-click cycles overlapping objects<br />
                  Round handle rotates · Square handle resizes · Shift constrains · Esc cancels<br />
                  Ctrl/⌘+Z undoes · Add Shift to redo
                </div>
              </details>}
            </div>
            {!keyboardPlacement && historyBlockedReason && <span className="scene-edit-hint">{historyBlockedReason}</span>}
            {!inspectorVisible && selectedObject && pendingCanvasPlacements.has(selectedObject) && (
              <button type="button" className="scene-control scene-review-changes" onClick={onOpenInspector}>
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
          {isEditingScene && <span className="scene-controls-resize" aria-hidden="true"
            onPointerDown={event => {
              const panel = sceneControlsRef.current;
              if (!panel || !event.isPrimary || event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              sceneControlsResize.current = { x: event.clientX - panel.offsetWidth, y: event.clientY - panel.offsetHeight };
            }}
            onPointerMove={event => {
              const start = sceneControlsResize.current;
              if (!start || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
              setSceneControlsSize({ width: Math.max(80, event.clientX - start.x), height: Math.max(56, event.clientY - start.y) });
            }}
            onLostPointerCapture={() => { sceneControlsResize.current = null; }}
          />}
        </div>
      )}
      {dropGuide && <div className="scene-drop-preview" aria-hidden={keyboardPlacement ? undefined : true}>
        {dropGuide.alignmentLeft !== undefined && <div className="scene-drop-alignment-x"
          style={{ left: Math.round(dropGuide.alignmentLeft) }} aria-hidden="true" />}
        {dropGuide.alignmentTop !== undefined && <div className="scene-drop-alignment-y"
          style={{ top: Math.round(dropGuide.alignmentTop) }} aria-hidden="true" />}
        {dropGuide.width && dropGuide.height && <div className={dropGuide.kind === 'Line' ? 'scene-drop-line' : 'scene-drop-outline'} style={{
          left: dropGuide.left, top: dropGuide.top, width: dropGuide.width, height: dropGuide.height,
          borderRadius: dropGuide.kind === 'Circle' ? '50%' : undefined,
        }} aria-hidden="true">
          {dropGuide.asset && <img className="scene-drop-image" src={dropGuide.asset.src} alt="" />}
          {dropGuide.kind === 'Text' && <TextDropPreview />}
        </div>}
        <div className="scene-drop-guide" style={{ left: dropGuide.left, top: dropGuide.top }} aria-hidden="true" />
        <div className="scene-drop-position" role={keyboardPlacement ? 'status' : undefined}>
          {dropGuide.asset?.tag ?? dropGuide.kind ?? (dropGuide.importingImage ? 'Import image' : 'Drop position')} · X {Number(dropGuide.x.toFixed(2))} · Y {Number(dropGuide.y.toFixed(2))}
        </div>
      </div>}
      {isEditingScene && manipulationReadout && (
        <div className="scene-manipulation-readout" role="group" aria-label="Current scene gesture">{manipulationReadout}</div>
      )}
      {runtimeError && <div className="game-runtime-error">
        <div role="alert">
          <strong>{{ script: 'Game script failed to run', startup: 'Game setup failed', frame: 'Game stopped running' }[runtimeError.phase]}</strong>
          <div className="game-runtime-error-message">
            {(runtimeError.error instanceof Error ? runtimeError.error.message
              : typeof runtimeError.error === 'string' ? runtimeError.error : '') || 'See the Console for details.'}
          </div>
        </div>
        <button type="button" className="scene-control" onClick={onOpenConsole}>
          <i className="fa-solid fa-terminal" aria-hidden="true" /> Open Console
        </button>
        {browserPreviewUrl && <a className="scene-control" href="/playground/amber-ruins.html" target="_top">
          Play Amber Ruins directly
        </a>}
      </div>}
      <ScreenUIOutline gridSize={snapScreenUI ? screenGridSize : 0} />
      {browserPreviewUrl && <HostedLibraryPlacement />}
      <Toolbar 
        isPaused={isPaused}
        isDebug={isDebug}
        isEditingScene={isEditingScene}
        isEditingScreenUI={isEditingScreenUI}
        arePanelsMinimized={arePanelsMinimized}
        onTogglePause={isEditingScreenUI ? () => {
          if (screenUIPreview.finishEditing()) setIsPaused(false);
          else openTool('inspector');
        } : isEditingScene ? toggleSceneEditing : togglePause}
        onToggleDebug={toggleDebug}
        onToggleSceneEditing={browserPreviewUrl ? undefined : toggleSceneEditing}
        onToggleScreenUIEditing={isEditingScreenUI || hasScreenUI ? toggleScreenUIEditing : undefined}
        onTogglePanels={togglePanels}
        onRefresh={() => window.dispatchEvent(new CustomEvent('playground-refresh'))}
      />
    </div>
  );
};

export default Viewport;
