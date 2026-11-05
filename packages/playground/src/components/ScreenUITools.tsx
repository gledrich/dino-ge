import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Engine, type GameObject, type ScreenUIControl } from 'dino-ge';
import { usePlayground } from '../context/PlaygroundContext';
import { openScreenUISourceEvent, screenUIPreview, type OpenScreenUISource, type ScreenUIBounds, type ScreenUIMove } from '../utils/screen-ui-preview';
import { applyScreenUIMoveEvent, getScreenUIMoveEdits, type ApplyScreenUIMove } from '../utils/screen-ui-source';
import '../styles/screen-ui.css';

const controlNames = { panel: 'Panel', label: 'Label', image: 'Image', button: 'Button', progressBar: 'Progress bar' };
const controlName = (control: ScreenUIControl) => control.text || control.id || controlNames[control.kind];
const arrowOffsets: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
};

export function ScreenUIExplorer() {
  const { frame, selected, moves } = useSyncExternalStore(screenUIPreview.subscribe, screenUIPreview.getSnapshot);
  const { openTool } = usePlayground();
  if (!frame?.controls.length) return null;
  return (
    <section className="screen-ui-explorer" aria-label="Screen UI">
      <h3>Screen UI</h3>
      {frame.controls.map((control, index) => {
        const pending = moves.some(move => move.index === index && !move.applied);
        return <div className={`scene-node${selected === index ? ' selected' : ''}`} key={index}>
          <button type="button" className="scene-node-select" aria-pressed={selected === index}
            aria-description={pending ? 'Pending move' : undefined}
            title={controlNames[control.kind]} onClick={() => {
              screenUIPreview.select(index);
              openTool('inspector');
            }}>
            <i className="fa-solid fa-layer-group type-icon" aria-hidden="true" />
            <span className="node-tag">{controlName(control)}</span>
            {pending && <i className="fa-solid fa-pen scene-node-pending" aria-hidden="true" />}
          </button>
        </div>;
      })}
    </section>
  );
}

export function ScreenUIInspector({ children }: { children: ReactNode }) {
  const { editing, frame, selected, source, moves, wasPaused } = useSyncExternalStore(screenUIPreview.subscribe, screenUIPreview.getSnapshot);
  const { isPaused, setIsPaused } = usePlayground();
  const control = selected === undefined ? undefined : frame?.controls[selected];
  const move = moves.find(item => item.index === selected);
  const pending = moves.some(item => !item.applied);
  useEffect(() => {
    const selectWorldObject = ({ detail }: CustomEvent<GameObject | null>) => {
      if (detail) screenUIPreview.select(undefined);
    };
    const keepPaused = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.key.toLowerCase() !== 'p' || !screenUIPreview.getSnapshot().editing ||
          (target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea')))) return;
      event.stopPropagation();
    };
    Engine.on('selectedObjectChanged', selectWorldObject);
    document.addEventListener('keydown', keepPaused, true);
    return () => {
      Engine.off('selectedObjectChanged', selectWorldObject);
      document.removeEventListener('keydown', keepPaused, true);
    };
  }, []);
  return <>
    <div style={{ display: control || editing ? 'none' : 'contents' }}>{children}</div>
    {(control || editing) && <ScreenUIProperties control={control} source={source} move={move} editing={editing} pending={pending}
      onStart={() => {
        if (!screenUIPreview.beginEditing(isPaused)) return;
        setIsPaused(true);
        requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.screen-ui-drag-handle[aria-pressed="true"]')
          ?.focus({ preventScroll: true }));
      }}
      onFinish={() => { if (screenUIPreview.finishEditing()) setIsPaused(wasPaused); }} />}
  </>;
}

function ScreenUIProperties({ control, source, move, editing, pending, onStart, onFinish }: {
  control?: ScreenUIControl; source?: OpenScreenUISource['location']; move?: ScreenUIMove;
  editing: boolean; pending: boolean; onStart: () => void; onFinish: () => void;
}) {
  const canApply = useMemo(() => source?.writeVerified &&
    !!getScreenUIMoveEdits(source.source, source.kind, source, { x: 1, y: 1 }), [source]);
  const rows = control ? [
    ['Type', controlNames[control.kind]],
    ['ID', control.id],
    ['Text', control.text],
    ['X', (control.x + (move?.x ?? 0)).toFixed(1)],
    ['Y', (control.y + (move?.y ?? 0)).toFixed(1)],
    ['Width', control.width.toFixed(1)],
    ['Height', control.height.toFixed(1)],
    ['Colour', control.colour],
    ['Background', control.background],
    ['Font', control.font],
    ['Enabled', control.enabled === undefined ? undefined : control.enabled ? 'Yes' : 'No'],
    ['Value', control.value === undefined ? undefined : `${Math.round(control.value * 100)}%`],
  ] : [];
  return (
    <div className="inspector-container">
      <div className="inspector-body">
        <section className="inspector-section screen-ui-inspector" aria-label="Screen UI properties">
          <h3>{control ? controlName(control) : 'Screen UI'}</h3>
          <p className="inspector-section-description">{editing
            ? 'Drag a control or focus it and use the arrow keys. Hold Shift to move 10 pixels.'
            : 'Screen UI · Live preview'}</p>
          <dl className="screen-ui-properties">
            {rows.map(([label, value]) => value !== undefined &&
              <div className="prop-row" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
          {source && <button type="button" className="scene-control" onClick={event =>
            window.dispatchEvent(new CustomEvent<OpenScreenUISource>(openScreenUISourceEvent, {
              detail: { location: source, trigger: event.currentTarget },
            }))}>View source</button>}
          {editing && move && (move.applied
            ? <p role="status">Move applied to the draft. Save the script to keep it.</p>
            : <>
              {!canApply && <p className="inspector-section-description">
                This move is preview-only because its source position cannot be safely changed here.
              </p>}
              <button type="button" className="scene-control" disabled={!canApply}
                onClick={event => {
                  if (!source) return;
                  let appliedMove: ReturnType<typeof screenUIPreview.markApplied>;
                  window.dispatchEvent(new CustomEvent<ApplyScreenUIMove>(applyScreenUIMoveEvent, {
                    detail: { location: source, offset: move, trigger: event.currentTarget,
                      applied: () => {
                        if (appliedMove) appliedMove.restore();
                        else appliedMove = screenUIPreview.markApplied(move);
                      }, reverted: () => appliedMove?.remove() },
                  }));
                }}>Apply move</button>
              <button type="button" className="scene-control" onClick={() => screenUIPreview.discardMove()}>Discard move</button>
            </>)}
          {editing && pending && (!move || move.applied) && <p className="inspector-section-description">
            Apply or discard the other pending moves to finish editing.
          </p>}
          {editing
            ? <button type="button" className="scene-control" disabled={pending} onClick={onFinish}>Finish editing Screen UI</button>
            : <>
              <button type="button" className="scene-control" onClick={onStart}>Edit Screen UI</button>
              <button type="button" className="scene-control" onClick={() => screenUIPreview.select(undefined)}>Clear selection</button>
            </>}
        </section>
      </div>
    </div>
  );
}

export function ScreenUIOutline() {
  const { frame, canvas, selected, editing, moves } = useSyncExternalStore(screenUIPreview.subscribe, screenUIPreview.getSnapshot);
  const origin = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; index: number; clientX: number; clientY: number; x: number; y: number } | undefined>(undefined);
  const [bounds, setBounds] = useState<ScreenUIBounds>();
  const active = selected !== undefined || editing;
  const hosted = canvas !== undefined;

  useLayoutEffect(() => {
    if (!active) return;
    const layer = origin.current;
    const viewport = layer?.parentElement;
    const surface = viewport?.querySelector('iframe.browser-game-preview, #playground-canvas-container canvas');
    if (!layer || !viewport || !surface) return;
    const update = () => {
      const outer = layer.getBoundingClientRect();
      const rect = surface.getBoundingClientRect();
      setBounds({ x: rect.left - outer.left, y: rect.top - outer.top, width: rect.width, height: rect.height });
    };
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    observer.observe(surface);
    window.addEventListener('resize', update);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [active, hosted]);

  const control = selected === undefined ? undefined : frame?.controls[selected];
  const scaleX = frame?.width ? (canvas?.width ?? bounds?.width ?? 0) / frame.width : 0;
  const scaleY = frame?.height ? (canvas?.height ?? bounds?.height ?? 0) / frame.height : 0;
  const project = (control: ScreenUIControl, offset?: ScreenUIMove) => ({
      left: (bounds?.x ?? 0) + (canvas?.x ?? 0) + (control.x + (offset?.x ?? 0)) * scaleX,
      top: (bounds?.y ?? 0) + (canvas?.y ?? 0) + (control.y + (offset?.y ?? 0)) * scaleY,
      width: control.width * scaleX,
      height: control.height * scaleY,
  });
  return <div ref={origin} className="screen-ui-outline-layer" data-editing={editing || undefined}
    aria-hidden={editing ? undefined : true}>
    {bounds && scaleX > 0 && scaleY > 0 && (editing ? frame?.controls.map((item, index) => {
      const offset = moves.find(move => move.index === index);
      return <button key={index} type="button" aria-label={`Move ${controlName(item)}`}
        aria-pressed={selected === index} aria-disabled={!!offset?.applied || undefined}
        className={`screen-ui-drag-handle${selected === index ? ' screen-ui-outline' : ''}`}
        style={project(item, offset)}
        onPointerDown={event => {
          if (event.button !== 0 || !event.isPrimary) return;
          screenUIPreview.select(index);
          if (offset?.applied) return;
          drag.current = { pointer: event.pointerId, index, clientX: event.clientX, clientY: event.clientY,
            x: offset?.x ?? 0, y: offset?.y ?? 0 };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          const start = drag.current;
          if (!start || start.pointer !== event.pointerId || start.index !== screenUIPreview.getSnapshot().selected) return;
          screenUIPreview.move(start.x + Math.round((event.clientX - start.clientX) / scaleX),
            start.y + Math.round((event.clientY - start.clientY) / scaleY));
        }}
        onPointerUp={event => {
          if (drag.current?.pointer === event.pointerId) drag.current = undefined;
        }}
        onLostPointerCapture={event => {
          const start = drag.current;
          if (start?.pointer !== event.pointerId) return;
          drag.current = undefined;
          if (start.index === screenUIPreview.getSnapshot().selected) screenUIPreview.move(start.x, start.y);
        }}
        onClick={() => screenUIPreview.select(index)}
        onKeyDown={event => {
          if (offset?.applied || event.altKey || event.ctrlKey || event.metaKey) return;
          const direction = arrowOffsets[event.key];
          if (!direction) return;
          event.preventDefault();
          event.stopPropagation();
          screenUIPreview.select(index);
          const step = event.shiftKey ? 10 : 1;
          screenUIPreview.move((offset?.x ?? 0) + direction[0] * step, (offset?.y ?? 0) + direction[1] * step);
        }} />;
    }) : control && <div className="screen-ui-outline" style={project(control)} />)}
  </div>;
}
