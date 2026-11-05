import React, { useRef, useState } from 'react';
import AssetPanel from './AssetPanel';
import { getDefaultSceneObjectTag, getSceneShapeOptionLines, sceneObjectDragType, type SceneObjectKind } from '../utils/scene-objects';
import { useScenePlacementSource } from '../hooks/useScenePlacementSource';
import '../styles/sidebar.css';

function shapeSnippet(kind: SceneObjectKind, icon: string) {
  const options = [
    `tag: ${JSON.stringify(getDefaultSceneObjectTag(kind))}`,
    'position: new Vector2(100, 100)',
    ...getSceneShapeOptionLines(kind),
  ];
  return { icon, kind, code: `new ${kind}({\n  ${options.join(',\n  ')}\n});` };
}

const shapeSnippets = [
  shapeSnippet('Text', 'fa-font'),
  shapeSnippet('Rectangle', 'fa-square'),
  shapeSnippet('Circle', 'fa-circle'),
  shapeSnippet('Line', 'fa-minus'),
];

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
  const [activeTab, setActiveTab] = useState<TabType>('library');
  const assetsTab = useRef<HTMLButtonElement>(null);
  const placementSource = useScenePlacementSource(activeTab === 'library');

  const insertSnippet = (code: string) => {
    window.dispatchEvent(new CustomEvent('playground-insert-text', { detail: code }));
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
              {shapeSnippets.map(({ icon, code, kind }) => (
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
                    title={`Insert ${kind.toLowerCase()} code`} onClick={() => insertSnippet(code)}>
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
