import { useRef } from 'react';
import type { ScreenUIControl } from 'dino-ge';
import { getScreenUIBounds, screenUIArrowOffsets, screenUIPreview, type ScreenUIMove } from '../utils/screen-ui-preview';
import { screenUIControlName } from './ScreenUIFields';

const corners = [
  { label: 'top left', x: -1, y: -1 },
  { label: 'top right', x: 1, y: -1 },
  { label: 'bottom left', x: -1, y: 1 },
  { label: 'bottom right', x: 1, y: 1 },
] as const;
type Corner = typeof corners[number];
type Start = { pointer: number; clientX: number; clientY: number; move?: ScreenUIMove };

export function ScreenUIResizeHandles({ control, move, projection, scaleX, scaleY }: {
  control: ScreenUIControl; move?: ScreenUIMove;
  projection: { left: number; top: number; width: number; height: number };
  scaleX: number; scaleY: number;
}) {
  const start = useRef<Start>(undefined);
  const changeSize = (corner: Corner, initial: ScreenUIMove | undefined, dx: number, dy: number) => {
    const bounds = getScreenUIBounds(control, initial);
    const width = Math.max(1, bounds.width + corner.x * dx);
    const height = Math.max(1, bounds.height + corner.y * dy);
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
      start.current = { pointer: event.pointerId, clientX: event.clientX, clientY: event.clientY, move };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      const initial = start.current;
      if (initial?.pointer !== event.pointerId) return;
      changeSize(corner, initial.move, Math.round((event.clientX - initial.clientX) / scaleX),
        Math.round((event.clientY - initial.clientY) / scaleY));
    }}
    onPointerUp={event => { if (start.current?.pointer === event.pointerId) start.current = undefined; }}
    onLostPointerCapture={event => {
      const initial = start.current;
      if (initial?.pointer !== event.pointerId) return;
      start.current = undefined;
      const original = initial.move;
      screenUIPreview.resize(original?.x ?? 0, original?.y ?? 0,
        original?.properties?.width ?? 0, original?.properties?.height ?? 0);
    }}
    onKeyDown={event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const direction = screenUIArrowOffsets[event.key];
      if (!direction) return;
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? 10 : 1;
      changeSize(corner, move, direction[0] * step, direction[1] * step);
    }} />);
}
