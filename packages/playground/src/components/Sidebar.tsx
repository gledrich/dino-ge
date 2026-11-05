import React, { useRef, useState } from 'react';
import AssetPanel from './AssetPanel';
import { usePlayground } from '../context/PlaygroundContext';
import { getDefaultSceneObjectTag, sceneObjectCodeEvent, sceneObjectDragType, type SceneObjectKind, type SceneObjectPlacement } from '../utils/scene-objects';
import { useScenePlacementSource } from '../hooks/useScenePlacementSource';
import '../styles/sidebar.css';

const shapeItems = [
  { kind: 'Text', icon: 'fa-font' },
  { kind: 'Rectangle', icon: 'fa-square' },
  { kind: 'Circle', icon: 'fa-circle' },
  { kind: 'Line', icon: 'fa-minus' },
] as const;

const codeSnippets = [
  { icon: 'fa-arrows-up-down-left-right', label: 'Vector2', code: 'new Vector2(0, 0)' },
  { icon: 'fa-image', label: 'Sprite animation', code: `new Sprite({
  tag: 'spriteObj',
  img: 'dino',
  rows: 1,
  cols: 24,
  position: new Vector2(100, 100),
  startCol: 0,
  endCol: 4,
  zIndex: 5
});` },
  { icon: 'fa-volleyball', label: 'Physics', code: `const ball = new Circle({
  tag: 'bouncy',
  position: new Vector2(200, 100),
  radius: 20,
  colour: '#f9c74f'
});
const phys = new PhysicsComponent();
phys.velocity = new Vector2(150, 150);
phys.restitution = 0.8;
ball.addComponent(phys);

const floor = new Rectangle({
  tag: 'floor',
  position: new Vector2(0, 400),
  width: 800,
  height: 50,
  colour: '#90be6d'
});
const floorPhys = new PhysicsComponent();
floorPhys.isStatic = true;
floor.addComponent(floorPhys);` }
];

type TabType = 'library' | 'assets';

const Sidebar: React.FC = () => {
  const { currentScriptId } = usePlayground();
  const [activeTab, setActiveTab] = useState<TabType>('library');
  const [feedback, setFeedback] = useState<{ scriptId: string; message: string; error: boolean }>();
  const assetsTab = useRef<HTMLButtonElement>(null);
  const placementSource = useScenePlacementSource(activeTab === 'library');

  const insertSnippet = (code: string) => {
    window.dispatchEvent(new CustomEvent('playground-insert-text', { detail: code }));
  };

  const insertShapeCode = (kind: SceneObjectKind) => {
    const placement: SceneObjectPlacement = { kind, tag: getDefaultSceneObjectTag(kind), x: 100, y: 100 };
    window.dispatchEvent(new CustomEvent<SceneObjectPlacement>(sceneObjectCodeEvent, { detail: placement }));
    const message = placement.sourceId ? `Inserted ${placement.tag} into the script.`
      : placement.error ?? 'Open a script in the editor before inserting shape code.';
    setFeedback({ scriptId: currentScriptId, message, error: !placement.sourceId });
  };

  return (
    <div className="sidebar">
      <div className="sidebar-tabs">
        <button type="button" aria-pressed={activeTab === 'library'}
          className={`sidebar-tab ${activeTab === 'library' ? 'active' : ''}`}
          onClick={() => setActiveTab('library')}
        >
          <i className="fa-solid fa-cubes" aria-hidden="true" />
          <span>Library</span>
        </button>
        <button type="button" ref={assetsTab} aria-pressed={activeTab === 'assets'}
          className={`sidebar-tab ${activeTab === 'assets' ? 'active' : ''}`} 
          onClick={() => setActiveTab('assets')}
        >
          <i className="fa-solid fa-images" aria-hidden="true" />
          <span>Assets</span>
        </button>
      </div>
      
      <div className="sidebar-content">
        {activeTab === 'library' ? (
          <div className="object-library">
            <section className="library-section" aria-labelledby="library-objects" aria-describedby="library-placement-hint">
              <h3 id="library-objects">Scene objects</h3>
              <p id="library-placement-hint" className="library-hint">
                Drag or click to place. Shift+Enter positions with keys. Use Insert to add code.
              </p>
              {feedback?.scriptId === currentScriptId && <p className={`library-feedback${feedback.error ? ' library-feedback-error' : ''}`}
                role={feedback.error ? 'alert' : 'status'}>{feedback.message}</p>}
              {shapeItems.map(({ icon, kind }) => (
                <div className="library-row" key={kind}>
                  <button type="button" className="scene-control snippet-btn" draggable
                    aria-label={`Add ${kind.toLowerCase()}`}
                    title={`Drag ${kind.toLowerCase()} onto the scene or click to add at the centre`}
                    {...placementSource.forItem({ kind })}
                    onDragStart={event => {
                      if (placementSource.isActive()) {
                        event.preventDefault();
                        return;
                      }
                      event.dataTransfer.setData(sceneObjectDragType, kind);
                      event.dataTransfer.setData(`${sceneObjectDragType}-${kind.toLowerCase()}`, '');
                      event.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={event => {
                      if (placementSource.consumeClick(event)) return;
                      window.dispatchEvent(new CustomEvent('playground-place-object', { detail: kind }));
                    }}
                  >
                    <i className={`fa-solid ${icon}`} aria-hidden="true" />
                    <span>{kind}</span>
                    <i className="fa-solid fa-grip-vertical library-affordance" aria-hidden="true" />
                  </button>
                  <button type="button" className="scene-control library-code" aria-label={`Insert ${kind.toLowerCase()} code`}
                    title={`Insert ${kind.toLowerCase()} code`} onClick={() => insertShapeCode(kind)}>
                    <span aria-hidden="true">Insert</span>
                  </button>
                </div>
              ))}
              <button type="button" className="scene-control snippet-btn" aria-label="Choose sprite image"
                title="Choose an image in Assets to place or insert as code" onClick={() => {
                  setActiveTab('assets');
                  assetsTab.current?.focus();
                }}>
                <i className="fa-solid fa-image" aria-hidden="true" />
                <span>Sprite</span>
                <i className="fa-solid fa-chevron-right library-affordance" aria-hidden="true" />
              </button>
            </section>
            <section className="library-section" aria-labelledby="library-code-snippets">
              <h3 id="library-code-snippets">Code snippets</h3>
              {codeSnippets.map(({ label, icon, code }) => (
                <button type="button" className="scene-control snippet-btn" key={label}
                  title={`Insert ${label} code`} onClick={() => insertSnippet(code)}>
                  <i className={`fa-solid ${icon}`} aria-hidden="true" />
                  <span>{label}</span>
                  <i className="fa-solid fa-code library-affordance" aria-hidden="true" />
                </button>
              ))}
            </section>
          </div>
        ) : (activeTab === 'assets' && (
          <AssetPanel />
        ))}
      </div>
    </div>
  );
};

export default Sidebar;
