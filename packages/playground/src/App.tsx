import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Panel, Group, Separator, usePanelRef } from 'react-resizable-panels';
import Sidebar from './components/Sidebar';
import Editor from './components/Editor';
import Inspector from './components/Inspector';
import SceneExplorer from './components/SceneExplorer';
import Console from './components/Console';
import Viewport from './components/Viewport';
import CanvasChangesDialog from './components/CanvasChangesDialog';
import { usePlayground, type MobileDockTab } from './context/PlaygroundContext';
import { usePlaygroundScripts } from './hooks/usePlaygroundScripts';
import { captureConsole } from './utils/LogManager';
import './App.css';

const mobileDockQuery = '(max-width: 720px), (max-height: 500px) and (pointer: coarse)';
const desktopTabs = ['editor', 'console'] as const;
const mobileTabs = ['explorer', 'editor', 'inspector', 'console'] as const;

function useDockContent() {
  const [host] = useState(() => {
    const element = document.createElement('div');
    element.className = 'panel-content';
    return element;
  });
  // Moving the portal host preserves the tool's state across layouts.
  const attach = useCallback((slot: HTMLDivElement | null) => {
    slot?.appendChild(host);
  }, [host]);
  return [host, attach] as const;
}

function App() {
  const {
    currentScriptId,
    isInspectorVisible,
    setIsInspectorVisible,
    isExplorerVisible,
    setIsExplorerVisible,
    isEditorVisible,
    setIsEditorVisible,
    activeTab,
    setActiveTab,
    mobileDockTab,
    setMobileDockTab,
    isMobileDockOpen,
    setIsMobileDockOpen,
    arePanelsMinimized,
    setArePanelsMinimized,
  } = usePlayground();
  const [mobile, setMobile] = useState(() => window.matchMedia(mobileDockQuery).matches);
  const mobileRef = useRef(mobile);
  useLayoutEffect(() => { mobileRef.current = mobile; }, [mobile]);
  useEffect(() => {
    const media = window.matchMedia(mobileDockQuery);
    const sync = () => setMobile(media.matches);
    media.addEventListener('change', sync);
    sync();
    return () => media.removeEventListener('change', sync);
  }, []);

  const [explorerHost, attachExplorer] = useDockContent();
  const [inspectorHost, attachInspector] = useDockContent();
  const dockVisible = mobile ? isMobileDockOpen && !arePanelsMinimized : isEditorVisible;
  const tabs: readonly MobileDockTab[] = mobile ? mobileTabs : desktopTabs;
  const selectedTab = mobile ? mobileDockTab : activeTab;
  const selectTab = (tab: MobileDockTab) => {
    if (mobile) setMobileDockTab(tab);
    else if (tab === 'editor' || tab === 'console') setActiveTab(tab);
  };
  const setDockVisible = (visible: boolean) => {
    if (mobile) {
      setIsMobileDockOpen(visible);
      if (visible) setArePanelsMinimized(false);
    } else setIsEditorVisible(visible);
  };
  const toggleDockFromButton = (visible: boolean) => {
    setDockVisible(visible);
    if (mobile) requestAnimationFrame(() => {
      const target = visible ? `playground-tab-${selectedTab}` : 'playground-expand-bottom-dock';
      document.getElementById(target)?.focus();
    });
  };
  const openMobileTool = useCallback((tab: MobileDockTab) => {
    if (!mobile) return;
    setMobileDockTab(tab);
    setIsMobileDockOpen(true);
    setArePanelsMinimized(false);
  }, [mobile, setArePanelsMinimized, setIsMobileDockOpen, setMobileDockTab]);
  const revealExplorer = useCallback(() => openMobileTool('explorer'), [openMobileTool]);
  const openInspector = () => {
    setIsInspectorVisible(true);
    openMobileTool('inspector');
    requestAnimationFrame(() => document.getElementById('canvas-changes')?.focus());
  };

  const { handleSave, selectScript, pendingRunChange, cancelRunChange, confirmRunChange, runtimeError } = usePlaygroundScripts();
  useEffect(captureConsole, []);

  const explorerPanelRef = usePanelRef();
  const editorPanelRef = usePanelRef();
  const inspectorPanelRef = usePanelRef();

  // Sync panels with state
  useEffect(() => {
    const syncPanel = (ref: any, visible: boolean) => {
      const panel = ref.current;
      if (!panel) return;
      if (visible && panel.isCollapsed()) panel.expand();
      else if (!visible && !panel.isCollapsed()) panel.collapse();
    };

    syncPanel(explorerPanelRef, !mobile && isExplorerVisible);
    syncPanel(editorPanelRef, dockVisible);
    syncPanel(inspectorPanelRef, !mobile && isInspectorVisible);
  }, [mobile, isExplorerVisible, dockVisible, isInspectorVisible, explorerPanelRef, editorPanelRef, inspectorPanelRef]);

  // Sync all panels when arePanelsMinimized changes
  useEffect(() => {
    if (arePanelsMinimized) {
      setIsExplorerVisible(false);
      setIsEditorVisible(false);
      setIsInspectorVisible(false);
    } else {
      setIsExplorerVisible(true);
      setIsEditorVisible(true);
      setIsInspectorVisible(true);
      setIsMobileDockOpen(true);
    }
  }, [arePanelsMinimized, setIsExplorerVisible, setIsEditorVisible, setIsInspectorVisible, setIsMobileDockOpen]);

  return (
    <div className={`playground-root${mobile ? ' mobile-workspace' : ''}`}>
      <Group orientation="horizontal" className="main-layout">
        {/* Left Panel: Sidebar & Scene Explorer */}
        <Panel id="explorer-dock"
          defaultSize={20} 
          minSize={20} 
          collapsible={true} 
          collapsedSize={0} 
          panelRef={explorerPanelRef}
          onResize={(size: any) => {
            requestAnimationFrame(() => {
              if (mobile || mobileRef.current) return;
              const collapsed = explorerPanelRef.current?.isCollapsed() ?? size.asPercentage === 0;
              if (collapsed && isExplorerVisible) setIsExplorerVisible(false);
              if (!collapsed && !isExplorerVisible) setIsExplorerVisible(true);
            });
          }}
        >
          <div className="panel-container" hidden={mobile || !isExplorerVisible}>
            <div
              className="panel-header"
              onClick={() => setIsExplorerVisible(false)}
              style={{ cursor: 'pointer' }}
            >
              Explorer
            </div>
            <div className="panel-content" ref={mobile ? undefined : attachExplorer} />
          </div>
        </Panel>
        
        {!mobile && !isExplorerVisible && (
          <div 
            style={{ 
              width: '15px', 
              height: '100%', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              cursor: 'pointer',
              opacity: 0.6
            }}
            onClick={() => setIsExplorerVisible(true)}
            data-testid="explorer-expand-button"
          >
            <i className="fa-solid fa-chevron-right" style={{ fontSize: '12px' }} />
          </div>
        )}

        <Separator
          className="resize-handle-horizontal" 
          onDoubleClick={() => setIsExplorerVisible(!isExplorerVisible)}
        />

        {/* Centre Panel: Viewport & Editor/Console */}
        <Panel key="workspace" id="workspace-main" defaultSize={60}>
          <Group orientation="vertical">
            {/* Top: Viewport */}
            <Panel defaultSize={60} minSize={mobile ? '30%' : 50}>
              <Viewport runtimeError={runtimeError} onOpenInspector={openInspector}
                inspectorVisible={mobile ? dockVisible && selectedTab === 'inspector' : isInspectorVisible}
                onOpenConsole={() => {
                setIsEditorVisible(true);
                setActiveTab('console');
                openMobileTool('console');
                requestAnimationFrame(() => document.getElementById('playground-tab-console')?.focus());
              }} />
            </Panel>
            
            {!dockVisible && (
              <button
                type="button"
                id={mobile ? 'playground-expand-bottom-dock' : undefined}
                aria-label={mobile ? 'Expand bottom dock' : 'Expand editor'}
                className="editor-panel-toggle"
                style={{ 
                  width: '100%', 
                  height: '15px', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  cursor: 'pointer',
                  opacity: 0.6
                }}
                onClick={() => toggleDockFromButton(true)}
                data-testid="editor-expand-button"
              >
                <span aria-hidden="true">▴</span>
              </button>
            )}

            <Separator 
              className={`resize-handle-vertical${mobile ? ' mobile-dock-resize' : ''}`}
              aria-label={mobile ? 'Resize bottom dock' : undefined}
              disabled={mobile && arePanelsMinimized}
              onDoubleClick={() => {
                if (!mobile || !arePanelsMinimized) setDockVisible(!dockVisible);
              }}
            />

            {/* Bottom: Editor & Console Tabs */}
            <Panel 
              className={mobile ? 'mobile-drawer-panel' : undefined}
              defaultSize={40} 
              minSize={mobile ? '24%' : 40}
              collapsible={true} 
              collapsedSize={0} 
              panelRef={editorPanelRef}
              onResize={(size: any) => {
                requestAnimationFrame(() => {
                  if (mobile !== mobileRef.current || (mobile && arePanelsMinimized)) return;
                  const visible = !(editorPanelRef.current?.isCollapsed() ?? size.asPercentage === 0);
                  if (visible !== dockVisible) setDockVisible(visible);
                });
              }}
            >
                <div className="panel-container" hidden={!dockVisible}>
                  <div className="panel-header dock-header">
                    <div className="playground-tabs" aria-label={mobile ? 'Workspace tools' : 'Bottom panel'} role="tablist"
                      onKeyDown={event => {
                        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                        event.preventDefault();
                        event.stopPropagation();
                        const offset = event.key === 'ArrowLeft' ? -1 : 1;
                        const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1]
                          : tabs[(tabs.indexOf(selectedTab) + offset + tabs.length) % tabs.length];
                        selectTab(next);
                        document.getElementById(`playground-tab-${next}`)?.focus();
                      }}>
                      {tabs.map(tab => (
                        <button key={tab} type="button" id={`playground-tab-${tab}`} role="tab"
                          aria-selected={selectedTab === tab} aria-controls={`playground-panel-${tab}`}
                          tabIndex={selectedTab === tab ? 0 : -1}
                          onClick={() => selectTab(tab)}>
                          {tab[0].toUpperCase() + tab.slice(1)}
                        </button>
                      ))}
                    </div>
                    {!mobile && <span style={{ flex: 1 }} />}
                    <button
                      type="button"
                      aria-label={mobile ? 'Collapse bottom dock' : 'Collapse editor'}
                      className="editor-panel-toggle"
                      style={{ cursor: 'pointer', opacity: 0.6 }}
                      onClick={() => toggleDockFromButton(false)}
                    >
                      <span aria-hidden="true">▾</span>
                    </button>
                  </div>
                  <div className="panel-content">
                    {mobile && <div className="editor-tab-panel" id="playground-panel-explorer" role="tabpanel"
                      aria-labelledby="playground-tab-explorer" hidden={selectedTab !== 'explorer'} ref={attachExplorer} />}
                    <div className="editor-tab-panel" id="playground-panel-editor" role="tabpanel"
                      key="editor" aria-labelledby="playground-tab-editor" hidden={selectedTab !== 'editor'}>
                      <Editor 
                        currentScriptId={currentScriptId} 
                        onSave={handleSave}
                        onSelectScript={selectScript}
                      />
                    </div>
                    {mobile && <div className="editor-tab-panel" id="playground-panel-inspector" role="tabpanel"
                      aria-labelledby="playground-tab-inspector" hidden={selectedTab !== 'inspector'} ref={attachInspector} />}
                    <div className="editor-tab-panel" id="playground-panel-console" role="tabpanel"
                      key="console" aria-labelledby="playground-tab-console" hidden={selectedTab !== 'console'}>
                      {selectedTab === 'console' && <Console />}
                    </div>
                  </div>
                </div>
            </Panel>
          </Group>
        </Panel>

        {/* Right Panel: Inspector */}
        <Separator
          className="resize-handle-horizontal" 
          onDoubleClick={() => setIsInspectorVisible(!isInspectorVisible)}
          data-testid="inspector-separator"
        />
        
        {!mobile && !isInspectorVisible && (
          <div 
            style={{ 
              width: '15px', 
              height: '100%', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              cursor: 'pointer',
              opacity: 0.6
            }}
            onClick={() => setIsInspectorVisible(true)}
            data-testid="inspector-expand-button"
          >
            <i className="fa-solid fa-chevron-left" style={{ fontSize: '12px' }} />
          </div>
        )}

        <Panel id="inspector-dock"
          defaultSize={20} 
          minSize={20} 
          collapsible={true} 
          collapsedSize={0} 
          panelRef={inspectorPanelRef}
          onResize={(size: any) => {
            // Defer state update to avoid update-during-render crashes
            requestAnimationFrame(() => {
              if (mobile || mobileRef.current) return;
              const isCurrentlyCollapsed = inspectorPanelRef.current?.isCollapsed() ?? size.asPercentage === 0;
              if (isCurrentlyCollapsed && isInspectorVisible) setIsInspectorVisible(false);
              if (!isCurrentlyCollapsed && !isInspectorVisible) setIsInspectorVisible(true);
            });
          }}
        >
          <div className="panel-container" data-testid="inspector-panel" hidden={mobile || !isInspectorVisible}>
            <div
              className="panel-header"
              onClick={() => setIsInspectorVisible(false)}
              style={{ cursor: 'pointer' }}
            >
              Inspector
            </div>
            <div className="panel-content" ref={mobile ? undefined : attachInspector} />
          </div>
        </Panel>
      </Group>
      {createPortal(<>
        <div className="explorer-scene"><SceneExplorer onReveal={revealExplorer} /></div>
        <div className="explorer-library">{(mobile || isExplorerVisible) && <Sidebar mobileDock={mobile} />}</div>
      </>, explorerHost)}
      {createPortal(<Inspector visible={mobile || isInspectorVisible} />, inspectorHost)}
      {pendingRunChange && (
        <CanvasChangesDialog action={pendingRunChange.kind} onCancel={cancelRunChange} onConfirm={confirmRunChange} />
      )}
    </div>
  );
}

export default App;
