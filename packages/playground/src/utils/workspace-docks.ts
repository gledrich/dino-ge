export const dockIds = ['left', 'right', 'bottom'] as const;
export const toolIds = ['explorer', 'editor', 'inspector', 'console'] as const;
export type DockId = typeof dockIds[number];
export type ToolId = typeof toolIds[number];

export const toolLabels: Record<ToolId, string> = {
  explorer: 'Explorer', editor: 'Editor', inspector: 'Inspector', console: 'Console',
};

interface DesktopDock {
  tabs: ToolId[];
  active: ToolId | null;
  collapsed: boolean;
  size: number;
}

export type DesktopLayout = Record<DockId, DesktopDock>;

const defaults: DesktopLayout = {
  left: { tabs: ['explorer'], active: 'explorer', collapsed: false, size: 20 },
  right: { tabs: ['editor', 'inspector'], active: 'editor', collapsed: false, size: 30 },
  bottom: { tabs: ['console'], active: 'console', collapsed: false, size: 28 },
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function isToolId(value: unknown): value is ToolId {
  return toolIds.some(tab => tab === value);
}

export function readDesktopLayout(value: unknown): DesktopLayout {
  const saved = record(value);
  const used = new Set<ToolId>();
  const readDock = (id: DockId): DesktopDock => {
    const dock = record(saved[id]);
    const tabs = (Array.isArray(dock.tabs) ? dock.tabs : defaults[id].tabs).filter((tab): tab is ToolId => {
      if (!isToolId(tab) || used.has(tab)) return false;
      used.add(tab);
      return true;
    });
    const size = typeof dock.size === 'number' && dock.size >= 5 && dock.size <= 80 ? dock.size : defaults[id].size;
    return { tabs, active: isToolId(dock.active) ? dock.active : null, collapsed: dock.collapsed === true, size };
  };
  const layout = { left: readDock('left'), right: readDock('right'), bottom: readDock('bottom') };
  for (const id of dockIds) {
    const dock = layout[id];
    dock.tabs.push(...defaults[id].tabs.filter(tab => !used.has(tab)));
    if (!dock.active || !dock.tabs.includes(dock.active)) dock.active = dock.tabs[0] ?? null;
  }
  return layout;
}

export function findToolDock(layout: DesktopLayout, tool: ToolId) {
  return dockIds.find(id => layout[id].tabs.includes(tool));
}

export function selectDockTab(layout: DesktopLayout, tab: ToolId): DesktopLayout {
  const id = findToolDock(layout, tab);
  if (!id || (layout[id].active === tab && !layout[id].collapsed)) return layout;
  return { ...layout, [id]: { ...layout[id], active: tab, collapsed: false } };
}

/** The destination index is measured after removing the moving tab. */
export function moveDockTab(layout: DesktopLayout, tab: ToolId, destination: DockId, index: number): DesktopLayout {
  const source = findToolDock(layout, tab);
  if (!source) return layout;
  const previous = layout[source];
  const target = layout[destination];
  const remaining = previous.tabs.filter(tool => tool !== tab);
  const tabs = source === destination ? [...remaining] : [...target.tabs];
  tabs.splice(Math.max(0, Math.min(index, tabs.length)), 0, tab);
  if (source === destination && target.tabs.every((tool, at) => tool === tabs[at])) return selectDockTab(layout, tab);
  const next = { ...layout };
  if (source !== destination) {
    const neighbour = Math.min(previous.tabs.indexOf(tab), remaining.length - 1);
    next[source] = { ...previous, tabs: remaining, active: previous.active === tab ? remaining[neighbour] ?? null : previous.active };
  }
  next[destination] = { ...target, tabs, active: tab, collapsed: false };
  return next;
}
