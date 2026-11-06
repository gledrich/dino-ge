import { useState, type DragEvent, type RefCallback } from 'react';
import { dockIds, isToolId, toolLabels, type DockId, type ToolId } from '../utils/workspace-docks';

export const dockTabDragType = 'application/x-dino-workspace-tab';

interface DockMoves {
  dragging: ToolId | null;
  setDragging: (tool: ToolId | null) => void;
  move: (tool: ToolId, destination: DockId, index: number) => void;
  reset: () => void;
}

type SlotRefs = Record<ToolId, RefCallback<HTMLDivElement>>;

interface WorkspaceDockProps {
  id: DockId | 'mobile';
  tabs: readonly ToolId[];
  active: ToolId | null;
  visible: boolean;
  slots: SlotRefs;
  onSelect: (tab: ToolId) => void;
  onCollapse: () => void;
  moves?: DockMoves;
}

export function focusToolTab(tab: ToolId) {
  document.getElementById(`playground-tab-${tab}`)?.focus();
}

export default function WorkspaceDock({ id, tabs, active, visible, slots, onSelect, onCollapse, moves }: WorkspaceDockProps) {
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const title = id === 'mobile' ? 'Bottom dock' : `${id[0].toUpperCase()}${id.slice(1)} dock`;
  const activeIndex = active ? tabs.indexOf(active) : -1;
  const insertionIndex = (event: DragEvent<HTMLElement>) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-dock-tab]') : null;
    const tab = target?.dataset.dockTab;
    if (!target || !isToolId(tab) || !tabs.includes(tab)) return tabs.length;
    const { left, width } = target.getBoundingClientRect();
    return tabs.indexOf(tab) + (event.clientX >= left + width / 2 ? 1 : 0);
  };
  const activeDrop = !!moves?.dragging && dropIndex !== null;
  return (
    <section className="panel-container workspace-dock" aria-label={title} hidden={!visible}
      data-dock-drop={activeDrop || undefined}
      onDragOver={event => {
        if (!moves || !event.dataTransfer.types.includes(dockTabDragType)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDropIndex(insertionIndex(event));
      }}
      onDragLeave={event => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropIndex(null);
      }}
      onDrop={event => {
        if (!moves || id === 'mobile' || !event.dataTransfer.types.includes(dockTabDragType)) return;
        event.preventDefault();
        const tool = event.dataTransfer.getData(dockTabDragType);
        if (isToolId(tool)) {
          const at = insertionIndex(event);
          const from = tabs.indexOf(tool);
          moves.move(tool, id, at - (from !== -1 && from < at ? 1 : 0));
        }
        setDropIndex(null);
        moves.setDragging(null);
      }}>
      <div className="panel-header dock-header">
        <div className="playground-tabs" aria-label={id === 'mobile' ? 'Workspace tools' : `${title} tools`} role="tablist"
          onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            const offset = event.key === 'ArrowLeft' ? -1 : 1;
            const index = active ? tabs.indexOf(active) : 0;
            const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1)
              : tabs[(index + offset + tabs.length) % tabs.length];
            if (!next) return;
            event.preventDefault();
            event.stopPropagation();
            onSelect(next);
            requestAnimationFrame(() => focusToolTab(next));
          }}>
          {tabs.map((tab, index) => (
            <button key={tab} type="button" id={`playground-tab-${tab}`} role="tab"
              aria-selected={active === tab} aria-controls={`playground-panel-${tab}`}
              draggable={!!moves} data-dock-tab={tab}
              data-dock-insert={activeDrop && dropIndex === index ? 'before'
                : activeDrop && dropIndex === tabs.length && index === tabs.length - 1 ? 'after' : undefined}
              onDragStart={event => {
                if (!moves) return;
                event.dataTransfer.setData(dockTabDragType, tab);
                event.dataTransfer.effectAllowed = 'move';
                moves.setDragging(tab);
              }}
              onDragEnd={() => moves?.setDragging(null)}
              tabIndex={active === tab ? 0 : -1} onClick={() => onSelect(tab)}>
              {toolLabels[tab]}
            </button>
          ))}
        </div>
        {moves && active && id !== 'mobile' && (
          <span className="dock-move editor-panel-toggle">
            <i className="fa-solid fa-arrows-up-down-left-right" aria-hidden="true" />
            <select aria-label={`Move ${toolLabels[active]}`} title={`Move ${toolLabels[active]}`} value=""
              onChange={event => {
                const destination = event.currentTarget.value;
                if (destination === 'reset') moves.reset();
                else if (destination === 'earlier' || destination === 'later') {
                  moves.move(active, id, activeIndex + (destination === 'earlier' ? -1 : 1));
                } else if (dockIds.some(dock => dock === destination)) moves.move(active, destination as DockId, Infinity);
              }}>
              <option value="" disabled>Move…</option>
              {dockIds.filter(dock => dock !== id).map(dock => <option key={dock} value={dock}>Move to {dock} dock</option>)}
              {activeIndex > 0 && <option value="earlier">Move one tab left</option>}
              {activeIndex < tabs.length - 1 && <option value="later">Move one tab right</option>}
              <option value="reset">Reset dock layout</option>
            </select>
          </span>
        )}
        <button type="button" className="editor-panel-toggle" aria-label={`Collapse ${title.toLowerCase()}`} onClick={onCollapse}>
          <i className="fa-solid fa-chevron-down" aria-hidden="true" />
        </button>
      </div>
      <div className="panel-content">
        {tabs.map(tab => <div key={tab} className="editor-tab-panel" id={`playground-panel-${tab}`} role="tabpanel"
          aria-labelledby={`playground-tab-${tab}`} hidden={active !== tab} ref={slots[tab]} />)}
      </div>
    </section>
  );
}
