import React, { useState } from 'react';
import AssetPanel from './AssetPanel';
import { sceneObjectDragType, type SceneObjectKind } from '../utils/scene-objects';
import { useScenePointerDrag } from '../hooks/useScenePointerDrag';
import '../styles/sidebar.css';

interface Snippet {
  icon: string;
  label: string;
  code: string;
  kind?: SceneObjectKind;
}

const snippets: Snippet[] = [
  { icon: 'fa-arrows-up-down-left-right', label: 'Vector2', code: 'new Vector2(0, 0)' },
  { icon: 'fa-font', label: 'Text', kind: 'Text', code: `new Text({
  tag: 'textObj',
  text: 'Hello World',
  fontSize: 30,
  colour: 'white',
  position: new Vector2(100, 100),
  width: 200,
  zIndex: 10
});` },
  { icon: 'fa-square', label: 'Rectangle', kind: 'Rectangle', code: `new Rectangle({
  tag: 'rectObj',
  position: new Vector2(100, 100),
  width: 50,
  height: 50,
  colour: '#43aa8b',
  zIndex: 5
});` },
  { icon: 'fa-circle', label: 'Circle', kind: 'Circle', code: `new Circle({
  tag: 'circleObj',
  position: new Vector2(100, 100),
  radius: 25,
  colour: '#F94144',
  zIndex: 5
});` },
  { icon: 'fa-image', label: 'Sprite', code: `new Sprite({
  tag: 'spriteObj',
  img: 'dino',
  rows: 1,
  cols: 24,
  position: new Vector2(100, 100),
  startCol: 0,
  endCol: 4,
  zIndex: 5
});` },
  { icon: 'fa-minus', label: 'Line', kind: 'Line', code: `new Line({
  tag: 'lineObj',
  width: 2,
  p1: new Vector2(0, 0),
  p2: new Vector2(100, 100),
  zIndex: 1
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
  const pointerDrag = useScenePointerDrag(activeTab === 'library');

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
        <button type="button" aria-pressed={activeTab === 'assets'}
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
                Drag or click to place. Use Insert to add code.
              </p>
              {snippets.filter(item => item.kind || item.label === 'Sprite').map(({ label, icon, code, kind }) => (
                <div className="library-row" key={label}>
                  <button type="button" className="scene-control snippet-btn" draggable={!!kind}
                    aria-label={kind ? `Add ${label.toLowerCase()}` : 'Choose sprite image'}
                    title={kind ? `Drag ${label.toLowerCase()} onto the scene or click to add at the centre` : 'Choose an image in Assets'}
                    {...pointerDrag.forItem(kind ? { kind } : undefined)}
                    onDragStart={event => {
                      if (pointerDrag.isActive()) {
                        event.preventDefault();
                        return;
                      }
                      if (!kind) return;
                      event.dataTransfer.setData(sceneObjectDragType, kind);
                      event.dataTransfer.setData(`${sceneObjectDragType}-${kind.toLowerCase()}`, '');
                      event.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={event => {
                      if (pointerDrag.consumeClick(event)) return;
                      if (kind) window.dispatchEvent(new CustomEvent('playground-place-object', { detail: kind }));
                      else setActiveTab('assets');
                    }}
                  >
                    <i className={`fa-solid ${icon}`} aria-hidden="true" />
                    <span>{label}</span>
                    <i className={`fa-solid ${kind ? 'fa-grip-vertical' : 'fa-chevron-right'} library-affordance`} aria-hidden="true" />
                  </button>
                  <button type="button" className="scene-control library-code" aria-label={`Insert ${label.toLowerCase()} code`}
                    title={`Insert ${label.toLowerCase()} code`} onClick={() => insertSnippet(code)}>
                    <span aria-hidden="true">Insert</span>
                  </button>
                </div>
              ))}
            </section>
            <section className="library-section" aria-labelledby="library-code-snippets">
              <h3 id="library-code-snippets">Code snippets</h3>
              {snippets.filter(item => !item.kind && item.label !== 'Sprite').map(({ label, icon, code }) => (
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
