import React, { useState } from 'react';
import AssetPanel from './AssetPanel';
import '../styles/sidebar.css';

interface Snippet {
  icon: string;
  label: string;
  code: string;
}

const snippets: Snippet[] = [
  { icon: 'fa-arrows-up-down-left-right', label: 'Vector2', code: 'new Vector2(0, 0)' },
  { icon: 'fa-font', label: 'Text', code: `new Text({
  tag: 'textObj',
  text: 'Hello World',
  fontSize: 30,
  colour: 'white',
  position: new Vector2(100, 100),
  width: 200,
  zIndex: 10
});` },
  { icon: 'fa-square', label: 'Rectangle', code: `new Rectangle({
  tag: 'rectObj',
  position: new Vector2(100, 100),
  width: 50,
  height: 50,
  colour: '#43aa8b',
  zIndex: 5
});` },
  { icon: 'fa-circle', label: 'Circle', code: `new Circle({
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
  { icon: 'fa-minus', label: 'Line', code: `new Line({
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

type TabType = 'snippets' | 'assets';

const Sidebar: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('snippets');

  const insertSnippet = (code: string) => {
    window.dispatchEvent(new CustomEvent('playground-insert-text', { detail: code }));
  };

  return (
    <div className="sidebar">
      <div className="sidebar-tabs">
        <button type="button" aria-pressed={activeTab === 'snippets'}
          className={`sidebar-tab ${activeTab === 'snippets' ? 'active' : ''}`} 
          onClick={() => setActiveTab('snippets')}
        >
          <i className="fa-solid fa-code" />
          <span>Snippets</span>
        </button>
        <button type="button" aria-pressed={activeTab === 'assets'}
          className={`sidebar-tab ${activeTab === 'assets' ? 'active' : ''}`} 
          onClick={() => setActiveTab('assets')}
        >
          <i className="fa-solid fa-images" />
          <span>Assets</span>
        </button>
      </div>
      
      <div className="sidebar-content">
        {activeTab === 'snippets' ? (
          <div className="snippets-grid">
            {snippets.map((s, index) => (
              <button 
                key={index} 
                className="snippet-btn" 
                title={s.label}
                onClick={() => insertSnippet(s.code)}
              >
                <i className={`fa-solid ${s.icon}`} />
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        ) : (activeTab === 'assets' && (
          <AssetPanel />
        ))}
      </div>
    </div>
  );
};

export default Sidebar;
