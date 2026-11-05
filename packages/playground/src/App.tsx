import { useEffect } from 'react';
import { Panel, Group, Separator, usePanelRef } from 'react-resizable-panels';
import Sidebar from './components/Sidebar';
import Editor from './components/Editor';
import Inspector from './components/Inspector';
import SceneExplorer from './components/SceneExplorer';
import Console from './components/Console';
import Viewport from './components/Viewport';
import CanvasChangesDialog from './components/CanvasChangesDialog';
import { usePlayground } from './context/PlaygroundContext';
import { usePlaygroundScripts } from './hooks/usePlaygroundScripts';
import { captureConsole } from './utils/LogManager';
import './App.css';

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
    arePanelsMinimized,
  } = usePlayground();

  const { handleSave, selectScript, pendingRunChange, cancelRunChange, confirmRunChange } = usePlaygroundScripts();
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

    syncPanel(explorerPanelRef, isExplorerVisible);
    syncPanel(editorPanelRef, isEditorVisible);
    syncPanel(inspectorPanelRef, isInspectorVisible);
  }, [isExplorerVisible, isEditorVisible, isInspectorVisible, explorerPanelRef, editorPanelRef, inspectorPanelRef]);

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
    }
  }, [arePanelsMinimized, setIsExplorerVisible, setIsEditorVisible, setIsInspectorVisible]);

  return (
    <div className="playground-root">
      <Group orientation="horizontal" className="main-layout">
        {/* Left Panel: Sidebar & Scene Explorer */}
        <Panel 
          defaultSize={20} 
          minSize={20} 
          collapsible={true} 
          collapsedSize={0} 
          panelRef={explorerPanelRef}
          onResize={(size: any) => {
            requestAnimationFrame(() => {
              const collapsed = size.asPercentage === 0;
              if (collapsed && isExplorerVisible) setIsExplorerVisible(false);
              if (!collapsed && !isExplorerVisible) setIsExplorerVisible(true);
            });
          }}
        >
          <div className="panel-container" hidden={!isExplorerVisible}>
            <div
              className="panel-header"
              onClick={() => setIsExplorerVisible(false)}
              style={{ cursor: 'pointer' }}
            >
              Explorer
            </div>
            <div className="panel-content" style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, overflow: 'auto' }}>
                <SceneExplorer />
              </div>
              <div style={{ height: '50%', borderTop: '1px solid var(--border-color)' }}>
                {isExplorerVisible && <Sidebar />}
              </div>
            </div>
          </div>
        </Panel>
        
        {!isExplorerVisible && (
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
        <Panel defaultSize={60}>
          <Group orientation="vertical">
            {/* Top: Viewport */}
            <Panel defaultSize={60} minSize={50}>
              <Viewport />
            </Panel>
            
            {!isEditorVisible && (
              <button
                type="button"
                aria-label="Expand editor"
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
                onClick={() => setIsEditorVisible(true)}
                data-testid="editor-expand-button"
              >
                <span aria-hidden="true">▴</span>
              </button>
            )}

            <Separator 
              className="resize-handle-vertical" 
              onDoubleClick={() => setIsEditorVisible(!isEditorVisible)}
            />

            {/* Bottom: Editor & Console Tabs */}
            <Panel 
              defaultSize={40} 
              minSize={40} 
              collapsible={true} 
              collapsedSize={0} 
              panelRef={editorPanelRef}
              onResize={(size: any) => {
                requestAnimationFrame(() => {
                  const collapsed = size.asPercentage === 0;
                  if (collapsed && isEditorVisible) setIsEditorVisible(false);
                  if (!collapsed && !isEditorVisible) setIsEditorVisible(true);
                });
              }}
            >
                <div className="panel-container" hidden={!isEditorVisible}>
                  <div className="panel-header" style={{ display: 'flex', gap: '10px' }}>
                    <div className="playground-tabs" aria-label="Bottom panel" role="tablist"
                      onKeyDown={event => {
                        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                        event.preventDefault();
                        event.stopPropagation();
                        const next = event.key === 'Home' ? 'editor' : event.key === 'End' ? 'console'
                          : activeTab === 'editor' ? 'console' : 'editor';
                        setActiveTab(next);
                        document.getElementById(`playground-tab-${next}`)?.focus();
                      }}>
                    <button type="button" id="playground-tab-editor" role="tab"
                      aria-selected={activeTab === 'editor'} aria-controls="playground-panel-editor"
                      tabIndex={activeTab === 'editor' ? 0 : -1}
                      onClick={() => setActiveTab('editor')}
                    >
                      Editor
                    </button>
                    <button type="button" id="playground-tab-console" role="tab"
                      aria-selected={activeTab === 'console'} aria-controls="playground-panel-console"
                      tabIndex={activeTab === 'console' ? 0 : -1}
                      onClick={() => setActiveTab('console')}
                    >
                      Console
                    </button>
                    </div>
                    <span style={{ flex: 1 }} />
                    <button
                      type="button"
                      aria-label="Collapse editor"
                      className="editor-panel-toggle"
                      style={{ cursor: 'pointer', opacity: 0.6 }}
                      onClick={() => setIsEditorVisible(false)}
                    >
                      <span aria-hidden="true">▾</span>
                    </button>
                  </div>
                  <div className="panel-content">
                    <div className="editor-tab-panel" id="playground-panel-editor" role="tabpanel"
                      aria-labelledby="playground-tab-editor" hidden={activeTab !== 'editor'}>
                      <Editor 
                        currentScriptId={currentScriptId} 
                        onSave={handleSave}
                        onSelectScript={selectScript}
                      />
                    </div>
                    <div className="editor-tab-panel" id="playground-panel-console" role="tabpanel"
                      aria-labelledby="playground-tab-console" hidden={activeTab !== 'console'}>
                      {activeTab === 'console' && <Console />}
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
        
        {!isInspectorVisible && (
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

        <Panel 
          defaultSize={20} 
          minSize={20} 
          collapsible={true} 
          collapsedSize={0} 
          panelRef={inspectorPanelRef}
          onResize={(size: any) => {
            // Defer state update to avoid update-during-render crashes
            requestAnimationFrame(() => {
              const isCurrentlyCollapsed = size.asPercentage === 0;
              if (isCurrentlyCollapsed && isInspectorVisible) setIsInspectorVisible(false);
              if (!isCurrentlyCollapsed && !isInspectorVisible) setIsInspectorVisible(true);
            });
          }}
        >
          <div className="panel-container" data-testid="inspector-panel" hidden={!isInspectorVisible}>
            <div
              className="panel-header"
              onClick={() => setIsInspectorVisible(false)}
              style={{ cursor: 'pointer' }}
            >
              Inspector
            </div>
            <div className="panel-content">
              <Inspector visible={isInspectorVisible} />
            </div>
          </div>
        </Panel>
      </Group>
      {pendingRunChange && (
        <CanvasChangesDialog action={pendingRunChange.kind} onCancel={cancelRunChange} onConfirm={confirmRunChange} />
      )}
    </div>
  );
}

export default App;
