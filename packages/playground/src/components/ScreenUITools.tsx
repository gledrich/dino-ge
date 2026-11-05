import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Engine, type GameObject, type ScreenUIControl } from 'dino-ge';
import { usePlayground } from '../context/PlaygroundContext';
import { openScreenUISourceEvent, screenUIPreview, type OpenScreenUISource, type ScreenUIBounds } from '../utils/screen-ui-preview';
import '../styles/screen-ui.css';

const controlNames = { panel: 'Panel', label: 'Label', image: 'Image', button: 'Button', progressBar: 'Progress bar' };
const controlName = (control: ScreenUIControl) => control.text || control.id || controlNames[control.kind];

export function ScreenUIExplorer() {
  const { frame, selected } = useSyncExternalStore(screenUIPreview.subscribe, screenUIPreview.getSnapshot);
  const { openTool } = usePlayground();
  if (!frame?.controls.length) return null;
  return (
    <section className="screen-ui-explorer" aria-label="Screen UI">
      <h3>Screen UI</h3>
      {frame.controls.map((control, index) => (
        <div className={`scene-node${selected === index ? ' selected' : ''}`} key={index}>
          <button type="button" className="scene-node-select" aria-pressed={selected === index}
            title={controlNames[control.kind]} onClick={() => {
              screenUIPreview.select(index);
              openTool('inspector');
            }}>
            <i className="fa-solid fa-layer-group type-icon" aria-hidden="true" />
            <span className="node-tag">{controlName(control)}</span>
          </button>
        </div>
      ))}
    </section>
  );
}

export function ScreenUIInspector({ children }: { children: ReactNode }) {
  const { frame, selected, source } = useSyncExternalStore(screenUIPreview.subscribe, screenUIPreview.getSnapshot);
  const control = selected === undefined ? undefined : frame?.controls[selected];
  useEffect(() => {
    const selectWorldObject = ({ detail }: CustomEvent<GameObject | null>) => {
      if (detail) screenUIPreview.select(undefined);
    };
    Engine.on('selectedObjectChanged', selectWorldObject);
    return () => Engine.off('selectedObjectChanged', selectWorldObject);
  }, []);
  return <>
    <div style={{ display: control ? 'none' : 'contents' }}>{children}</div>
    {control && <ScreenUIProperties control={control} source={source} />}
  </>;
}

function ScreenUIProperties({ control, source }: { control: ScreenUIControl; source?: OpenScreenUISource['location'] }) {
  const rows = [
    ['Type', controlNames[control.kind]],
    ['ID', control.id],
    ['Text', control.text],
    ['X', control.x.toFixed(1)],
    ['Y', control.y.toFixed(1)],
    ['Width', control.width.toFixed(1)],
    ['Height', control.height.toFixed(1)],
    ['Colour', control.colour],
    ['Background', control.background],
    ['Font', control.font],
    ['Enabled', control.enabled === undefined ? undefined : control.enabled ? 'Yes' : 'No'],
    ['Value', control.value === undefined ? undefined : `${Math.round(control.value * 100)}%`],
  ];
  return (
    <div className="inspector-container">
      <div className="inspector-body">
        <section className="inspector-section" aria-label="Screen UI properties">
          <h3>{controlName(control)}</h3>
          <p className="inspector-section-description">Screen UI · Live preview</p>
          <dl className="screen-ui-properties">
            {rows.map(([label, value]) => value !== undefined &&
              <div className="prop-row" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
          {source && <button type="button" className="scene-control" onClick={event =>
            window.dispatchEvent(new CustomEvent<OpenScreenUISource>(openScreenUISourceEvent, {
              detail: { location: source, trigger: event.currentTarget },
            }))}>View source</button>}
          <button type="button" className="scene-control" onClick={() => screenUIPreview.select(undefined)}>Clear selection</button>
        </section>
      </div>
    </div>
  );
}

export function ScreenUIOutline() {
  const { frame, canvas, selected } = useSyncExternalStore(screenUIPreview.subscribe, screenUIPreview.getSnapshot);
  const origin = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState<ScreenUIBounds>();
  const active = selected !== undefined;
  const hosted = canvas !== undefined;

  useLayoutEffect(() => {
    if (!active) return;
    const viewport = origin.current?.parentElement;
    const surface = viewport?.querySelector('iframe.browser-game-preview, #playground-canvas-container canvas');
    if (!viewport || !surface) return;
    const update = () => {
      const outer = viewport.getBoundingClientRect();
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
  return <div ref={origin} className="screen-ui-outline-layer" aria-hidden="true">
    {bounds && control && scaleX > 0 && scaleY > 0 && <div className="screen-ui-outline" style={{
      left: bounds.x + (canvas?.x ?? 0) + control.x * scaleX,
      top: bounds.y + (canvas?.y ?? 0) + control.y * scaleY,
      width: control.width * scaleX,
      height: control.height * scaleY,
    }} />}
  </div>;
}
