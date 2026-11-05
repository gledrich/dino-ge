import { useCallback, useEffect, useState } from 'react';
import { dockIds, findToolDock, moveDockTab, readDesktopLayout, selectDockTab, type DockId, type ToolId } from '../utils/workspace-docks';

const storageKey = 'dino-ge-playground-docks-v1';
const mobileQuery = '(max-width: 720px), (max-height: 500px) and (pointer: coarse)';

function loadDesktopLayout() {
  try {
    return readDesktopLayout(JSON.parse(localStorage.getItem(storageKey) ?? 'null'));
  } catch {
    return readDesktopLayout(null);
  }
}

export function useWorkspaceDocks(minimised: boolean, restorePanels: () => void) {
  const [desktopLayout, setDesktopLayout] = useState(loadDesktopLayout);
  const [mobile, setMobile] = useState(() => window.matchMedia(mobileQuery).matches);
  const [mobileTab, setMobileTab] = useState<ToolId>('editor');
  const [mobileOpen, setMobileOpen] = useState(true);
  const [mobileSize, setMobileSize] = useState(40);

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(desktopLayout)); } catch { /* Storage may be unavailable. */ }
  }, [desktopLayout]);

  useEffect(() => {
    const media = window.matchMedia(mobileQuery);
    const sync = () => setMobile(media.matches);
    media.addEventListener('change', sync);
    sync();
    return () => media.removeEventListener('change', sync);
  }, []);

  const openTool = useCallback((tool: ToolId) => {
    if (mobile) {
      setMobileTab(tool);
      setMobileOpen(true);
    } else {
      setDesktopLayout(layout => selectDockTab(layout, tool));
    }
    restorePanels();
  }, [mobile, restorePanels]);

  const moveTool = (tool: ToolId, destination: DockId, index: number) => {
    setDesktopLayout(layout => moveDockTab(layout, tool, destination, index));
    restorePanels();
  };

  const setDockCollapsed = (id: DockId, collapsed: boolean) => {
    setDesktopLayout(layout => layout[id].collapsed === collapsed ? layout
      : { ...layout, [id]: { ...layout[id], collapsed } });
    if (!collapsed) restorePanels();
  };

  const resizeDesktopDocks = (sizes: Partial<Record<DockId, number>>) => {
    setDesktopLayout(layout => {
      let next = layout;
      for (const id of dockIds) {
        const size = sizes[id];
        const dock = layout[id];
        if (size === undefined || !dock.tabs.length) continue;
        const collapsed = size === 0;
        if (dock.collapsed === collapsed && (collapsed || dock.size === size)) continue;
        next = { ...next, [id]: { ...dock, collapsed, size: collapsed ? dock.size : size } };
      }
      return next;
    });
  };

  const isToolVisible = (tool: ToolId) => {
    if (minimised) return false;
    if (mobile) return mobileOpen && mobileTab === tool;
    const dock = findToolDock(desktopLayout, tool);
    return !!dock && !desktopLayout[dock].collapsed && desktopLayout[dock].active === tool;
  };

  return {
    desktopLayout, mobile, mobileTab, mobileOpen, setMobileOpen, mobileSize, setMobileSize,
    openTool, isToolVisible, moveTool, setDockCollapsed, resizeDesktopDocks,
    resetDesktopLayout: () => { setDesktopLayout(readDesktopLayout(null)); restorePanels(); },
  };
}
