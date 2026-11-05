import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Panel, Group, Separator, useGroupRef, type Layout, type LayoutChangedMeta } from 'react-resizable-panels';
import Sidebar from './components/Sidebar';
import Editor from './components/Editor';
import Inspector from './components/Inspector';
import SceneExplorer from './components/SceneExplorer';
import { BrowserInspector, BrowserSceneExplorer } from './components/BrowserSceneTools';
import { ScreenUIInspector } from './components/ScreenUITools';
import Console from './components/Console';
import Viewport from './components/Viewport';
import CanvasChangesDialog from './components/CanvasChangesDialog';
import WorkspaceDock, { dockTabDragType, focusToolTab } from './components/WorkspaceDock';
import { usePlayground } from './context/PlaygroundContext';
import { usePlaygroundScripts } from './hooks/usePlaygroundScripts';
import { captureConsole } from './utils/LogManager';
import { browserPreviewUrl } from './utils/helpers';
import { isToolId, minimumDockSize, toolIds, type DockId, type ToolId } from './utils/workspace-docks';
import './App.css';
import './styles/browser-preview.css';

function useDockContent() {
  const [host] = useState(() => {
    const element = document.createElement('div');
    element.className = 'panel-content';
    return element;
  });
  // A stable portal host keeps the tool mounted when its slot changes.
  const attach = useCallback((slot: HTMLDivElement | null) => {
    slot?.appendChild(host);
  }, [host]);
  return [host, attach] as const;
}

function App() {
  const {
    currentScriptId, desktopLayout, mobile, mobileTab, mobileOpen, mobileSize, setMobileOpen, setMobileSize,
    openTool, isToolVisible, setDockCollapsed, resizeDesktopDocks, moveTool, resetDesktopLayout,
    arePanelsMinimized, setArePanelsMinimized,
  } = usePlayground();
  const { handleSave, selectScript, pendingRunChange, cancelRunChange, confirmRunChange, runtimeError } = usePlaygroundScripts();
  useEffect(captureConsole, []);

  const [explorerHost, attachExplorer] = useDockContent();
  const [inspectorHost, attachInspector] = useDockContent();
  const [editorHost, attachEditor] = useDockContent();
  const [consoleHost, attachConsole] = useDockContent();
  const [dragging, setDragging] = useState<ToolId | null>(null);
  const [railTarget, setRailTarget] = useState<DockId | null>(null);
  const slots = { explorer: attachExplorer, inspector: attachInspector, editor: attachEditor, console: attachConsole };

  const row = useGroupRef();
  const column = useGroupRef();
  const dockVisible = (id: DockId) => !arePanelsMinimized && !!desktopLayout[id].tabs.length && !desktopLayout[id].collapsed;
  const leftOpen = !mobile && dockVisible('left');
  const rightOpen = !mobile && dockVisible('right');
  const bottomOpen = mobile ? mobileOpen && !arePanelsMinimized : dockVisible('bottom');
  const leftSize = leftOpen ? desktopLayout.left.size : 0;
  const rightSize = rightOpen ? desktopLayout.right.size : 0;
  const leftMinimum = leftOpen ? minimumDockSize.left : 0;
  const rightMinimum = rightOpen ? minimumDockSize.right : 0;
  const sideRoom = 75 - leftMinimum - rightMinimum;
  const sideScale = Math.min(1, sideRoom / Math.max(1, leftSize + rightSize - leftMinimum - rightMinimum));
  const leftWidth = leftMinimum + (leftSize - leftMinimum) * sideScale;
  const rightWidth = rightMinimum + (rightSize - rightMinimum) * sideScale;
  const bottomHeight = bottomOpen ? Math.min(mobile ? 70 : 65, mobile ? mobileSize : desktopLayout.bottom.size) : 0;

  useEffect(() => {
    row.current?.setLayout({ left: leftWidth, workspace: 100 - leftWidth - rightWidth, right: rightWidth });
  }, [row, leftWidth, rightWidth]);

  useEffect(() => {
    column.current?.setLayout({ viewport: 100 - bottomHeight, bottom: bottomHeight });
  }, [column, bottomHeight]);

  const setBottomOpen = (open: boolean) => {
    if (mobile) {
      setMobileOpen(open);
      if (open) setArePanelsMinimized(false);
    } else setDockCollapsed('bottom', !open);
  };

  const collapseDock = (id: DockId | 'mobile') => {
    const previousFocus = document.activeElement;
    if (id === 'mobile') setBottomOpen(false);
    else setDockCollapsed(id, true);
    requestAnimationFrame(() => {
      if (document.activeElement === previousFocus || document.activeElement === document.body) {
        document.getElementById(`playground-expand-${id}-dock`)?.focus();
      }
    });
  };

  const expandDock = (id: DockId | 'mobile') => {
    if (id === 'mobile') setBottomOpen(true);
    else setDockCollapsed(id, false);
    const active = id === 'mobile' ? mobileTab : desktopLayout[id].active;
    if (active) requestAnimationFrame(() => focusToolTab(active));
  };

  const move = (tool: ToolId, destination: DockId, index: number) => {
    moveTool(tool, destination, index);
    setDragging(null);
    setRailTarget(null);
    requestAnimationFrame(() => focusToolTab(tool));
  };

  const renderRail = (id: DockId | 'mobile') => {
    const empty = id !== 'mobile' && !desktopLayout[id].tabs.length;
    return (
      <div className={`dock-rail dock-rail-${id}`} data-testid={`dock-drop-${id}`}
        data-dock-ready={id !== 'mobile' && !!dragging || undefined} data-dock-drop={!!dragging && railTarget === id || undefined}
        onDragOver={event => {
          if (id === 'mobile' || !event.dataTransfer.types.includes(dockTabDragType)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          setRailTarget(id);
        }}
        onDragLeave={event => {
          if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setRailTarget(null);
        }}
        onDrop={event => {
          if (id === 'mobile' || !event.dataTransfer.types.includes(dockTabDragType)) return;
          event.preventDefault();
          const tool = event.dataTransfer.getData(dockTabDragType);
          if (isToolId(tool)) move(tool, id, Infinity);
        }}>
        {!empty && <button type="button" id={`playground-expand-${id}-dock`} className="editor-panel-toggle"
          aria-label={`Expand ${id === 'mobile' ? 'bottom' : id} dock`} onClick={() => expandDock(id)}>
          <i className={`fa-solid fa-chevron-${id === 'left' ? 'right' : id === 'right' ? 'left' : 'up'}`} aria-hidden="true" />
        </button>}
      </div>
    );
  };

  const renderDock = (id: DockId, visible: boolean) => (
    <WorkspaceDock id={id} tabs={mobile ? [] : desktopLayout[id].tabs} active={desktopLayout[id].active}
      visible={visible} slots={slots} onSelect={openTool} onCollapse={() => collapseDock(id)}
      moves={mobile ? undefined : { dragging, setDragging, move, reset: () => {
        resetDesktopLayout();
        requestAnimationFrame(() => focusToolTab('editor'));
      } }} />
  );

  const openInspector = () => {
    openTool('inspector');
    requestAnimationFrame(() => document.getElementById('canvas-changes')?.focus());
  };
  const openConsole = () => {
    openTool('console');
    requestAnimationFrame(() => focusToolTab('console'));
  };

  return (
    <div className={`playground-root${mobile ? ' mobile-workspace' : ''}`}>
      <Group orientation="horizontal" className="main-layout" groupRef={row}
        defaultLayout={{ left: leftWidth, workspace: 100 - leftWidth - rightWidth, right: rightWidth }}
        onLayoutChanged={(layout: Layout, meta: LayoutChangedMeta) => {
          if (meta.isUserInteraction && !mobile && !arePanelsMinimized) resizeDesktopDocks({ left: layout.left, right: layout.right });
        }}>
        <Panel id="left" minSize={`${minimumDockSize.left}%`} collapsible>{renderDock('left', leftOpen)}</Panel>
        {!mobile && !leftOpen && renderRail('left')}
        <Separator className="resize-handle-horizontal" disabled={mobile || arePanelsMinimized || !desktopLayout.left.tabs.length}
          aria-label="Resize left dock" disableDoubleClick
          onDoubleClick={() => !mobile && !arePanelsMinimized && setDockCollapsed('left', leftOpen)} />

        <Panel id="workspace" minSize="25%">
          <Group orientation="vertical" groupRef={column} defaultLayout={{ viewport: 100 - bottomHeight, bottom: bottomHeight }}
            onLayoutChanged={(layout: Layout, meta: LayoutChangedMeta) => {
              if (!meta.isUserInteraction || arePanelsMinimized) return;
              if (!mobile) resizeDesktopDocks({ bottom: layout.bottom });
              else {
                setMobileOpen(layout.bottom > 0);
                if (layout.bottom > 0) setMobileSize(layout.bottom);
              }
            }}>
            <Panel id="viewport" minSize={mobile ? '30%' : '35%'}>
              <Viewport runtimeError={runtimeError} inspectorVisible={isToolVisible('inspector')}
                onOpenInspector={openInspector} onOpenConsole={openConsole} />
            </Panel>
            {!bottomOpen && renderRail(mobile ? 'mobile' : 'bottom')}
            <Separator className={`resize-handle-vertical${mobile ? ' mobile-dock-resize' : ''}`}
              aria-label="Resize bottom dock" disabled={arePanelsMinimized || (!mobile && !desktopLayout.bottom.tabs.length)}
              disableDoubleClick onDoubleClick={() => !arePanelsMinimized && setBottomOpen(!bottomOpen)} />
            <Panel id="bottom" className={mobile ? 'mobile-drawer-panel' : undefined} minSize={mobile ? '24%' : `${minimumDockSize.bottom}%`} collapsible>
              {mobile
                ? <WorkspaceDock id="mobile" tabs={toolIds} active={mobileTab} visible={bottomOpen} slots={slots}
                    onSelect={openTool} onCollapse={() => collapseDock('mobile')} />
                : renderDock('bottom', bottomOpen)}
            </Panel>
          </Group>
        </Panel>

        <Separator className="resize-handle-horizontal" disabled={mobile || arePanelsMinimized || !desktopLayout.right.tabs.length}
          aria-label="Resize right dock" disableDoubleClick
          onDoubleClick={() => !mobile && !arePanelsMinimized && setDockCollapsed('right', rightOpen)} />
        {!mobile && !rightOpen && renderRail('right')}
        <Panel id="right" minSize={`${minimumDockSize.right}%`} collapsible>{renderDock('right', rightOpen)}</Panel>
      </Group>
      {createPortal(<>
        <div className="explorer-scene">{browserPreviewUrl ? <BrowserSceneExplorer /> : <SceneExplorer />}</div>
        <div className="explorer-library"><Sidebar mobileDock={mobile} /></div>
      </>, explorerHost)}
      {createPortal(<ScreenUIInspector>
        {browserPreviewUrl ? <BrowserInspector visible /> : <Inspector visible />}
      </ScreenUIInspector>, inspectorHost)}
      {createPortal(<Editor currentScriptId={currentScriptId} onSave={handleSave} onSelectScript={selectScript} />, editorHost)}
      {createPortal(isToolVisible('console') && <Console />, consoleHost)}
      {pendingRunChange && (
        <CanvasChangesDialog action={pendingRunChange.kind} onCancel={cancelRunChange} onConfirm={confirmRunChange} />
      )}
    </div>
  );
}

export default App;
