import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { sceneKeyboardPlacementEvent, scenePointerDragEvent, type SceneKeyboardPlacementRequest, type ScenePoint, type ScenePointerDrag, type ScenePointerDragItem } from '../utils/scene-objects';

function reportPointerDrag(detail: ScenePointerDrag | null) {
  window.dispatchEvent(new CustomEvent(scenePointerDragEvent, { detail }));
}

export function useScenePlacementSource(enabled: boolean) {
  const pointerDrag = useRef<{
    id: number; item: ScenePointerDragItem; button: HTMLButtonElement;
    start: ScenePoint; fromHandle: boolean; dragging: boolean;
  } | null>(null);
  const suppressClick = useRef(false);

  const finishPointerDrag = useCallback((point?: ScenePoint) => {
    const drag = pointerDrag.current;
    if (!drag) return;
    pointerDrag.current = null;
    if (drag.dragging) reportPointerDrag(point ? { ...drag.item, phase: 'drop', point } : null);
    if (drag.button.hasPointerCapture(drag.id)) drag.button.releasePointerCapture(drag.id);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const cancel = () => finishPointerDrag();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    window.addEventListener('blur', cancel);
    window.addEventListener('playground-before-run', cancel);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('blur', cancel);
      window.removeEventListener('playground-before-run', cancel);
      window.removeEventListener('keydown', onKeyDown);
      cancel();
    };
  }, [enabled, finishPointerDrag]);

  const cancelPointer = (event: PointerEvent<HTMLButtonElement>) => {
    if (pointerDrag.current?.id === event.pointerId) finishPointerDrag();
  };

  const forItem = (item?: ScenePointerDragItem) => ({
    'aria-keyshortcuts': enabled && item ? 'Shift+Enter' : undefined,
    onKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
      if (!enabled || !item || event.key !== 'Enter' || !event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      window.dispatchEvent(new CustomEvent<SceneKeyboardPlacementRequest>(sceneKeyboardPlacementEvent, {
        detail: { item, source: event.currentTarget },
      }));
    },
    onPointerDown(event: PointerEvent<HTMLButtonElement>) {
      if (!enabled || !event.isPrimary || event.button !== 0 || pointerDrag.current) return;
      suppressClick.current = false;
      if (!item || (event.pointerType !== 'touch' && event.pointerType !== 'pen')) return;
      const { pointerId, currentTarget, clientX, clientY, target } = event;
      currentTarget.setPointerCapture(pointerId);
      pointerDrag.current = {
        id: pointerId, item, button: currentTarget, start: { x: clientX, y: clientY },
        fromHandle: target instanceof Element && !!target.closest('[data-scene-drag-handle]'), dragging: false,
      };
    },
    onPointerMove(event: PointerEvent<HTMLButtonElement>) {
      const drag = pointerDrag.current;
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.start.x;
      const distance = drag.fromHandle ? Math.hypot(dx, event.clientY - drag.start.y) : Math.abs(dx);
      if (!drag.dragging && distance < 8) return;
      drag.dragging = true;
      suppressClick.current = true;
      reportPointerDrag({ ...drag.item, phase: 'preview', point: { x: event.clientX, y: event.clientY } });
    },
    onPointerUp(event: PointerEvent<HTMLButtonElement>) {
      if (pointerDrag.current?.id === event.pointerId) finishPointerDrag({ x: event.clientX, y: event.clientY });
    },
    onPointerCancel: cancelPointer,
    onLostPointerCapture: cancelPointer,
  });

  const consumeClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (!suppressClick.current || event.detail === 0) return false;
    suppressClick.current = false;
    return true;
  };

  return { forItem, consumeClick, isActive: () => pointerDrag.current !== null };
}
