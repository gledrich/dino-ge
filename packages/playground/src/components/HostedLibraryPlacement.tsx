import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePlayground } from '../context/PlaygroundContext';
import { browserPreviewPlacement } from '../utils/browser-preview';
import { hostedAssetDragEvent, hostedPlacementEvent, hostedShapeDragEvent, type HostedCanvasBounds, type HostedPlacementRequest } from '../utils/hosted-placement';
import { sceneAssetDragType, sceneKeyboardPlacementEvent, sceneObjectDragType, sceneObjectKinds,
  scenePointerDragEvent, type SceneImageAsset, type SceneKeyboardPlacementRequest, type SceneObjectKind,
  type ScenePoint, type ScenePointerDrag, type ScenePointerDragItem } from '../utils/scene-objects';
import '../styles/hosted-placement.css';
import { screenUIPreview } from '../utils/screen-ui-preview';

type Surface = {
  frame: HTMLIFrameElement;
  canvas: HostedCanvasBounds;
  visible: HostedCanvasBounds;
  layer: DOMRect;
};

const directions: Record<string, ScenePoint> = {
  ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
};
const nameOf = (item: ScenePointerDragItem) => 'asset' in item ? `${item.asset.tag} sprite` : item.kind;
const centre = (bounds: HostedCanvasBounds) => ({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });

function contains(bounds: HostedCanvasBounds, point: ScenePoint) {
  return point.x >= bounds.x && point.x < bounds.x + bounds.width &&
    point.y >= bounds.y && point.y < bounds.y + bounds.height;
}

function measureSurface(layer: HTMLElement | null, remote: HostedCanvasBounds | undefined, mobile: boolean): Surface | undefined {
  const viewport = layer?.parentElement;
  const frame = viewport?.querySelector<HTMLIFrameElement>('.browser-game-preview');
  if (!layer || !viewport || !frame || !remote) return;
  const frameBounds = frame.getBoundingClientRect();
  const viewportBounds = viewport.getBoundingClientRect();
  const layerBounds = layer.getBoundingClientRect();
  const canvas = { x: frameBounds.x + remote.x, y: frameBounds.y + remote.y, width: remote.width, height: remote.height };
  const left = Math.max(canvas.x, viewportBounds.left, 0);
  const top = Math.max(canvas.y, mobile ? 0 : viewportBounds.top);
  const right = Math.min(canvas.x + canvas.width, viewportBounds.right, window.innerWidth);
  let bottom = Math.min(canvas.y + canvas.height, window.innerHeight);
  if (mobile) {
    const root = viewport.closest('.mobile-workspace');
    for (const control of root?.querySelectorAll('.mobile-dock-resize, .dock-rail-mobile') ?? []) {
      const rect = control.getBoundingClientRect();
      if (rect.height > 0) bottom = Math.min(bottom, rect.top);
    }
  } else {
    bottom = Math.min(bottom, viewportBounds.bottom);
  }
  if (right <= left || bottom <= top) return;
  return { frame, canvas, visible: { x: left, y: top, width: right - left, height: bottom - top }, layer: layerBounds };
}

export default function HostedLibraryPlacement() {
  const { run, canvas } = useSyncExternalStore(browserPreviewPlacement.subscribe, browserPreviewPlacement.getSnapshot);
  const { mobile, openTool, setIsPaused, setIsDebug } = usePlayground();
  const layer = useRef<HTMLDivElement>(null);
  const keyboardTarget = useRef<HTMLButtonElement>(null);
  const placing = useRef<object>(undefined);
  const [surface, setSurface] = useState<Surface>();
  const [drag, setDrag] = useState<ScenePointerDragItem>();
  const [guide, setGuide] = useState<{ item: ScenePointerDragItem; point: ScenePoint }>();
  const [keyboard, setKeyboard] = useState<{ item: ScenePointerDragItem; point: ScenePoint; source: HTMLButtonElement }>();
  const [status, setStatus] = useState<{ message: string; error?: boolean }>();
  const measure = useCallback(() => measureSurface(layer.current, canvas, mobile), [canvas, mobile]);

  useLayoutEffect(() => {
    const update = () => setSurface(measure());
    update();
    const observer = new ResizeObserver(update);
    const viewport = layer.current?.parentElement;
    if (viewport) {
      observer.observe(viewport);
      const frame = viewport.querySelector('iframe');
      if (frame) observer.observe(frame);
    }
    const root = viewport?.closest('.mobile-workspace');
    for (const element of root?.querySelectorAll('.mobile-dock-resize, .dock-rail-mobile') ?? []) observer.observe(element);
    window.addEventListener('resize', update);
    return () => { observer.disconnect(); window.removeEventListener('resize', update); };
  }, [measure, run]);

  const pointOnCanvas = useCallback((point: ScenePoint, target: Surface) => {
    if (!contains(target.visible, point)) return false;
    const top = document.elementFromPoint(point.x, point.y);
    return top === target.frame || !!(top && layer.current?.contains(top));
  }, []);

  const place = useCallback(async (item: ScenePointerDragItem, point?: ScenePoint) => {
    if (placing.current) return;
    if (screenUIPreview.getSnapshot().editing) {
      setStatus({ message: 'Finish editing Screen UI before placing a game object.', error: true });
      return;
    }
    const target = measure();
    if (!run?.active() || !target) {
      setStatus({ message: 'Wait for the hosted game to start before placing an object.', error: true });
      return;
    }
    const destination = point ?? centre(target.visible);
    if (!pointOnCanvas(destination, target)) return;
    const operation = {};
    placing.current = operation;
    setStatus(undefined);
    try {
      const prepared = await run.prepare({
        x: (destination.x - target.canvas.x) / target.canvas.width,
        y: (destination.y - target.canvas.y) / target.canvas.height,
      });
      if (placing.current !== operation || !run.active()) {
        run.cancel(prepared.handle);
        return;
      }
      const result = await new Promise<{ tag?: string; error?: string }>(complete => {
        const handled = !window.dispatchEvent(new CustomEvent<HostedPlacementRequest>(hostedPlacementEvent, {
          cancelable: true, detail: { item, run, prepared, complete },
        }));
        if (!handled) {
          run.cancel(prepared.handle);
          complete({ error: 'Open an editable game script before placing an object.' });
        }
      });
      if (placing.current !== operation || !run.active()) return;
      if (!result.tag) {
        setStatus({ message: result.error ?? 'The object could not be placed.', error: true });
        return;
      }
      setIsPaused(true);
      setIsDebug(true);
      if (!mobile) openTool('inspector');
      setStatus({ message: `Added ${result.tag}. Save the script to keep it.` });
    } catch (error) {
      if (placing.current === operation && run.active()) {
        setStatus({ message: error instanceof Error ? error.message : 'The object could not be placed.', error: true });
      }
    } finally {
      if (placing.current === operation) placing.current = undefined;
    }
  }, [measure, mobile, openTool, pointOnCanvas, run, setIsDebug, setIsPaused]);

  useEffect(() => {
    const shapeDrag = (event: Event) => {
      const { detail } = event as CustomEvent<SceneObjectKind | null>;
      setDrag(detail && sceneObjectKinds.includes(detail) ? { kind: detail } : undefined);
      setGuide(undefined);
    };
    const assetDrag = (event: Event) => {
      const { detail } = event as CustomEvent<SceneImageAsset | null>;
      setDrag(detail?.projectPath ? { asset: detail } : undefined);
      setGuide(undefined);
    };
    const pointerDrag = (event: Event) => {
      const { detail } = event as CustomEvent<ScenePointerDrag | null>;
      const target = measure();
      if (!detail || !target || !pointOnCanvas(detail.point, target)) {
        setGuide(undefined);
      } else if (detail.phase === 'preview') {
        setGuide({ item: detail, point: detail.point });
      } else {
        setGuide(undefined);
        void place(detail, detail.point);
      }
    };
    const chooseShape = (event: Event) => {
      const { detail } = event as CustomEvent<SceneObjectKind>;
      if (sceneObjectKinds.includes(detail)) void place({ kind: detail });
    };
    const chooseAsset = (event: Event) => {
      const { detail } = event as CustomEvent<SceneImageAsset>;
      if (detail?.projectPath) void place({ asset: detail });
    };
    const keyboardPlacement = (event: Event) => {
      const { detail } = event as CustomEvent<SceneKeyboardPlacementRequest>;
      const target = measure();
      if (!target) {
        setStatus({ message: 'Wait for the hosted game to start before placing an object.', error: true });
        return;
      }
      setKeyboard({ ...detail, point: centre(target.visible) });
    };
    const clear = () => {
      placing.current = undefined;
      setDrag(undefined);
      setGuide(undefined);
      setKeyboard(undefined);
      setStatus(undefined);
    };
    const events: [string, EventListener][] = [
      [hostedShapeDragEvent, shapeDrag], [hostedAssetDragEvent, assetDrag], [scenePointerDragEvent, pointerDrag],
      ['playground-place-object', chooseShape], ['playground-place-asset', chooseAsset],
      [sceneKeyboardPlacementEvent, keyboardPlacement], ['playground-before-run', clear],
    ];
    events.forEach(([name, listener]) => window.addEventListener(name, listener));
    return () => events.forEach(([name, listener]) => window.removeEventListener(name, listener));
  }, [measure, place, pointOnCanvas]);

  const keyboardActive = !!keyboard;
  useLayoutEffect(() => {
    if (keyboardActive) keyboardTarget.current?.focus({ preventScroll: true });
  }, [keyboardActive]);
  const marker = keyboard ?? guide;
  return <div className="hosted-placement-layer" ref={layer}>
    {drag && surface && <div className="hosted-canvas-drop" data-testid="hosted-canvas-drop"
      style={{ left: surface.visible.x - surface.layer.x, top: surface.visible.y - surface.layer.y,
        width: surface.visible.width, height: surface.visible.height }}
      onDragOver={event => {
        const type = 'asset' in drag ? sceneAssetDragType : sceneObjectDragType;
        if (!event.dataTransfer.types.includes(type)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setGuide({ item: drag, point: { x: event.clientX, y: event.clientY } });
      }}
      onDragLeave={() => setGuide(undefined)}
      onDrop={event => {
        const match = 'asset' in drag ? event.dataTransfer.getData(sceneAssetDragType) === drag.asset.tag
          : event.dataTransfer.getData(sceneObjectDragType) === drag.kind;
        setDrag(undefined);
        setGuide(undefined);
        if (!match) return;
        event.preventDefault();
        event.stopPropagation();
        void place(drag, { x: event.clientX, y: event.clientY });
      }} />}
    {marker && surface && <div className="hosted-placement-guide"
      style={{ left: marker.point.x - surface.layer.x, top: marker.point.y - surface.layer.y }}>
      {keyboard ? <button type="button" ref={keyboardTarget} className="hosted-placement-keyboard"
        aria-label={`Position ${nameOf(keyboard.item)}`} onKeyDown={event => {
          if (event.key === 'Escape' || event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            setKeyboard(undefined);
            keyboard.source.focus();
            if (event.key === 'Enter') void place(keyboard.item, keyboard.point);
          } else {
            const direction = directions[event.key];
            if (!direction) return;
            event.preventDefault();
            event.stopPropagation();
            const { visible } = surface;
            const step = event.shiftKey ? 10 : 1;
            setKeyboard({ ...keyboard, point: {
              x: Math.max(visible.x, Math.min(visible.x + visible.width - 1, keyboard.point.x + direction.x * step)),
              y: Math.max(visible.y, Math.min(visible.y + visible.height - 1, keyboard.point.y + direction.y * step)),
            } });
          }
        }}><span aria-hidden="true">+</span></button> : <span aria-hidden="true">+</span>}
      <span>{keyboard ? 'Arrows to move · Enter to place · Esc to cancel' : `Place ${nameOf(marker.item)}`}</span>
    </div>}
    {status && <div className={`hosted-placement-status${status.error ? ' hosted-placement-error' : ''}`}
      role={status.error ? 'alert' : 'status'}>{status.message}</div>}
  </div>;
}
