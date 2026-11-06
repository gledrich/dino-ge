import { useEffect, useRef } from 'react';
import type { ScreenUIControl } from 'dino-ge';
import { getScreenUIBounds, screenUIArrowOffsets, screenUIPreview, type ScreenUIMove } from '../utils/screen-ui-preview';
import { snapScreenUIDelta } from '../utils/screen-ui-grid';
import { screenUIControlName } from './ScreenUIFields';

const corners = [
  { label: 'top left', x: -1, y: -1 },
  { label: 'top right', x: 1, y: -1 },
  { label: 'bottom left', x: -1, y: 1 },
  { label: 'bottom right', x: 1, y: 1 },
] as const;
type Corner = typeof corners[number];
type Start = { pointer: number; clientX: number; clientY: number; move?: ScreenUIMove; finish: (cancel?: boolean) => void };

export function ScreenUIResizeHandles({ control, move, projection, scaleX, scaleY, gridSize }: {
  control: ScreenUIControl; move?: ScreenUIMove;
  projection: { left: number; top: number; width: number; height: number };
  scaleX: number; scaleY: number; gridSize: number;
}) {
  const start = useRef<Start>(undefined);
  useEffect(() => () => start.current?.finish(true), []);
  const changeSize = (corner: Corner, initial: ScreenUIMove | undefined, dx: number, dy: number) => {
    const bounds = getScreenUIBounds(control, initial);
    const edgeX = bounds.x + (corner.x > 0 ? bounds.width : 0);
    const edgeY = bounds.y + (corner.y > 0 ? bounds.height : 0);
    const width = Math.max(1, bounds.width + corner.x * snapScreenUIDelta(edgeX, dx, gridSize));
    const height = Math.max(1, bounds.height + corner.y * snapScreenUIDelta(edgeY, dy, gridSize));
    const x = (initial?.x ?? 0) + ((corner.x < 0) !== !!control.reversedX ? bounds.width - width : 0) *
      (control.reversedX ? -1 : 1);
    const y = (initial?.y ?? 0) + ((corner.y < 0) !== !!control.reversedY ? bounds.height - height : 0) *
      (control.reversedY ? -1 : 1);
    screenUIPreview.resize(x, y, width - control.width, height - control.height);
  };

  return corners.map(corner => <button key={corner.label} type="button" className="screen-ui-resize-handle"
    aria-label={`Resize ${screenUIControlName(control, move)} from ${corner.label}`}
    style={{ left: projection.left + (corner.x > 0 ? projection.width : 0),
      top: projection.top + (corner.y > 0 ? projection.height : 0),
      cursor: corner.x === corner.y ? 'nwse-resize' : 'nesw-resize' }}
    onPointerDown={event => {
      if (event.button !== 0 || !event.isPrimary) return;
      const finish = screenUIPreview.beginGesture();
      if (!finish) return;
      start.current = { pointer: event.pointerId, clientX: event.clientX, clientY: event.clientY, move, finish };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      const initial = start.current;
      if (initial?.pointer !== event.pointerId) return;
      changeSize(corner, initial.move, Math.round((event.clientX - initial.clientX) / scaleX),
        Math.round((event.clientY - initial.clientY) / scaleY));
    }}
    onPointerUp={event => {
      if (start.current?.pointer !== event.pointerId) return;
      start.current.finish();
      start.current = undefined;
    }}
    onLostPointerCapture={event => {
      const initial = start.current;
      if (initial?.pointer !== event.pointerId) return;
      start.current = undefined;
      initial.finish(true);
    }}
    onKeyDown={event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const direction = screenUIArrowOffsets[event.key];
      if (!direction) return;
      event.preventDefault();
      event.stopPropagation();
      const step = (gridSize || 1) * (event.shiftKey ? 10 : 1);
      changeSize(corner, move, direction[0] * step, direction[1] * step);
    }} />);
}
