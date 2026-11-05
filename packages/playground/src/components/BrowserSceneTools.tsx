import { useSyncExternalStore } from 'react';
import { usePlayground } from '../context/PlaygroundContext';
import { browserPreviewScene, type PreviewTransform } from '../utils/browser-preview';
import { screenUIPreview } from '../utils/screen-ui-preview';
import { ScreenUIExplorer } from './ScreenUITools';
import '../styles/inspector.css';
import '../styles/scene-explorer.css';

function usePreviewScene() {
  return useSyncExternalStore(browserPreviewScene.subscribe, browserPreviewScene.getSnapshot);
}

export function BrowserSceneExplorer() {
  const { objects, selectedId } = usePreviewScene();
  return (
    <div className="scene-explorer">
      <div className="explorer-content">
        {objects.length === 0 && <p className="empty-scene">No objects in scene</p>}
        {objects.map(object => (
          <div className={`scene-node ${object.id === selectedId ? 'selected' : ''}`} key={object.id}>
            <button type="button" className="scene-node-select" aria-pressed={object.id === selectedId}
              onClick={() => {
                screenUIPreview.select(undefined);
                browserPreviewScene.select(object.id);
              }}>
              <span className="node-tag">{object.tag || 'Object'}</span>
            </button>
          </div>
        ))}
        <ScreenUIExplorer />
      </div>
    </div>
  );
}

const transformFields: [PreviewTransform, string][] = [
  ['x', 'X'], ['y', 'Y'], ['scaleX', 'Scale X'], ['scaleY', 'Scale Y'], ['rotation', 'Rotation (°)'],
];

export function BrowserInspector({ visible }: { visible: boolean }) {
  const { objects, selectedId } = usePreviewScene();
  const { isPaused } = usePlayground();
  if (!visible) return null;
  const selected = objects.find(object => object.id === selectedId);
  return (
    <div className="inspector-container">
      <div className="inspector-body">
        {selected ? (
          <section className="inspector-section">
            <h3>{selected.tag || 'Object'} transform</h3>
            <p className="inspector-section-description">
              {isPaused ? 'Changes apply to this preview until you run the game again.' : 'Pause the game to edit its transform.'}
            </p>
            {transformFields.map(([field, label]) => {
              const display = field === 'rotation' ? selected[field] * 180 / Math.PI : selected[field];
              return (
                <label key={field} className="prop-row">
                  {label}
                  <input type="number" step="any" disabled={!isPaused}
                    key={`${selected.id}:${display}`} defaultValue={display}
                    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                    onBlur={event => {
                      const value = event.currentTarget.valueAsNumber;
                      if (!Number.isFinite(value)) {
                        event.currentTarget.value = String(display);
                        return;
                      }
                      if (value !== display) browserPreviewScene.transform(
                        selected.id, field, field === 'rotation' ? value * Math.PI / 180 : value
                      );
                    }} />
                </label>
              );
            })}
          </section>
        ) : <p className="inspector-section-description">Select a scene object to inspect it.</p>}
      </div>
    </div>
  );
}
