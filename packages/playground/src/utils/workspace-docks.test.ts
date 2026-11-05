import { dockIds, moveDockTab, readDesktopLayout, selectDockTab } from './workspace-docks';

test('restores the default tools, selection and sizes', () => {
  const layout = readDesktopLayout(null);
  expect(layout.left).toEqual({ tabs: ['explorer'], active: 'explorer', collapsed: false, size: 20 });
  expect(layout.right).toEqual({ tabs: ['editor', 'inspector'], active: 'editor', collapsed: false, size: 30 });
  expect(layout.bottom).toEqual({ tabs: ['console'], active: 'console', collapsed: false, size: 28 });
});

test('repairs duplicate, missing or unknown tools and rejects invalid sizes', () => {
  const layout = readDesktopLayout({
    left: { tabs: ['editor', 'unknown'], active: 'unknown', size: -10 },
    right: { tabs: ['editor', 'inspector'], active: 'editor', size: 33 },
    bottom: { tabs: [], size: 1000, collapsed: true },
  });
  expect(dockIds.flatMap(id => layout[id].tabs)).toEqual(['editor', 'explorer', 'inspector', 'console']);
  expect(layout.left.active).toBe('editor');
  expect(layout.right.active).toBe('inspector');
  expect(layout.bottom.active).toBe('console');
  expect(dockIds.map(id => layout[id].size)).toEqual([20, 33, 28]);
});

test('moves, reorders and reopens a tool while keeping valid active tabs', () => {
  const initial = readDesktopLayout(null);
  const reordered = moveDockTab(initial, 'inspector', 'right', 0);
  expect(reordered.right).toMatchObject({ tabs: ['inspector', 'editor'], active: 'inspector' });
  const empty = moveDockTab(reordered, 'console', 'left', 1);
  expect(empty.bottom).toMatchObject({ tabs: [], active: null });
  const moved = moveDockTab(empty, 'inspector', 'bottom', 10);
  expect(moved.right).toMatchObject({ tabs: ['editor'], active: 'editor' });
  expect(moved.bottom).toMatchObject({ tabs: ['inspector'], active: 'inspector', collapsed: false });
  expect(moveDockTab(moved, 'inspector', 'bottom', 0)).toBe(moved);
  expect(selectDockTab({ ...moved, bottom: { ...moved.bottom, collapsed: true } }, 'inspector').bottom.collapsed).toBe(false);
  expect(readDesktopLayout(JSON.parse(JSON.stringify(moved)))).toEqual(moved);
});
