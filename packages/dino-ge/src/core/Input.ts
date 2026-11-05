import Vector2 from '../math/Vector2.js';
import Engine from './Engine.js';
import SpriteComponent from '../components/SpriteComponent.js';
import ShapeComponent from '../components/ShapeComponent.js';
import TextComponent from '../components/TextComponent.js';
import VisibilityComponent from '../components/VisibilityComponent.js';
import Line from '../objects/Line.js';
import type GameObject from './GameObject.js';
import { containsViewportPoint, getViewportDrawOrder, getViewportGeometry, getViewportLineEndpoints, getViewportRotationHandle, projectOntoObjectAxes, snapToGrid } from './ViewportGeometry.js';

/** Detail of an objectManipulationPreview event. A null detail ends the preview. */
export interface ObjectManipulationPreview {
  object: GameObject;
  kind: 'drag' | 'resize' | 'rotate' | 'p1' | 'p2';
  value: Vector2;
}

type ObjectGesture = {
  object: GameObject;
  startedPaused: boolean;
  pointer?: { id: number; canvas: HTMLCanvasElement };
  initial?: Vector2;
  previewValue?: Vector2;
} & (
  | { kind: 'drag' | 'resize'; offset: Vector2; initialBounds?: Vector2 }
  | { kind: 'rotate'; pointerAngle: number; rotation: number }
  | { kind: 'p1' | 'p2'; object: Line; offset: Vector2 }
);

/**
 * Handles mouse and keyboard input and pointer gestures in paused debug mode.
 */
export default class Input {
  private static mousePosition: Vector2 = new Vector2(0, 0);
  private static clickListeners: Set<(pos: Vector2) => void> = new Set();
  private static keys: Set<string> = new Set();
  private static isinitialised = false;

  private static gesture: ObjectGesture | null = null;

  private static isGestureActive(gesture: ObjectGesture) {
    return Engine.debug && gesture.object === Engine.selectedObject && (!gesture.startedPaused || Engine.paused);
  }

  private static finishGesture(commit = false) {
    const gesture = this.gesture;
    if (!gesture) return;
    this.gesture = null;
    const pointer = gesture.pointer;
    if (pointer?.canvas.hasPointerCapture(pointer.id)) pointer.canvas.releasePointerCapture(pointer.id);
    const { object, kind, initial, previewValue } = gesture;
    if (!commit && initial && previewValue) {
      if (kind === 'drag') {
        if (object instanceof Line) object.setOrigin(initial.x, initial.y);
        else object.transform.position.set(initial.x, initial.y);
      } else if (kind === 'rotate') {
        object.transform.rotation = initial.x;
      } else if (kind === 'p1' || kind === 'p2') {
        object.setEndpoint(kind, initial.x, initial.y);
      } else if (kind === 'resize') {
        const { initialBounds } = gesture;
        if (object.getComponent(SpriteComponent)) object.transform.scale.set(initial.x, initial.y);
        if (initialBounds && object.bounds &&
            (object.bounds.width !== initialBounds.x || object.bounds.height !== initialBounds.y)) {
          this.restoreObjectSize(object, initialBounds.x, initialBounds.y);
        }
      }
    }
    const canvas = document.getElementById('canvas');
    const gestureCursor = kind === 'resize' ? 'se-resize' : 'grabbing';
    if (kind !== 'drag' && canvas?.style?.cursor === gestureCursor) canvas.style.cursor = 'default';
    if (previewValue) Engine.emit('objectManipulationPreview', null);
    if (commit && initial) {
      const value = this.getGestureValue(object, kind);
      if (value.x !== initial.x || value.y !== initial.y) {
        Engine.emit('objectManipulated', { object, kind, initial });
      }
    }
  }

  private static publishPreview(gesture: ObjectGesture) {
    const previous = gesture.previewValue ?? gesture.initial;
    if (!previous) return;
    const { object, kind } = gesture;
    const value = this.getGestureValue(object, kind);
    if (value.x === previous.x && value.y === previous.y) return;
    gesture.previewValue = value;
    Engine.emit('objectManipulationPreview', { object, kind, value: value.clone() } satisfies ObjectManipulationPreview);
  }

  private static updateMousePosition(event: MouseEvent, canvas: HTMLCanvasElement | null) {
    const rect = typeof canvas?.getBoundingClientRect === 'function' ? canvas.getBoundingClientRect() : undefined;
    if (!canvas || !rect) {
      this.mousePosition.set(event.clientX, event.clientY);
      return;
    }
    const scaleX = rect.width > 0 && canvas.width > 0 ? canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 && canvas.height > 0 ? canvas.height / rect.height : 1;
    this.mousePosition.set((event.clientX - rect.left) * scaleX, (event.clientY - rect.top) * scaleY);
  }

  private static getGestureValue(object: GameObject, kind: ObjectGesture['kind']): Vector2 {
    if (kind === 'rotate') return new Vector2(object.transform.rotation, 0);
    if (object instanceof Line) {
      if (kind === 'p1') return new Vector2(object.x1, object.y1);
      if (kind === 'p2') return new Vector2(object.x2, object.y2);
    }
    if (kind === 'drag') {
      const position = object.transform.position;
      return new Vector2(position?.x, position?.y);
    }
    if (object.getComponent?.(SpriteComponent)) return object.transform.scale.clone();
    return new Vector2(object.bounds?.width ?? 0, object.bounds?.height ?? 0);
  }

  private static restoreObjectSize(object: GameObject, width: number, height: number) {
    const shape = object.getComponent(ShapeComponent);
    const size = shape ?? object.getComponent(TextComponent) ?? object.bounds;
    if (!size) return;
    size.width = shape?.type === 'circle' ? width / 2 : width;
    size.height = height;
  }

  private static getHoveredResizeHandle(object: GameObject, x: number, y: number, slop = 0) {
    if (!object.bounds) return null;
    const geometry = getViewportGeometry(object);
    const { cornerX, cornerY, width, height, line } = geometry;
    const halfSize = (4 + slop) / Engine.camera.zoom;
    const isInside = Math.abs(x - cornerX) < halfSize && Math.abs(y - cornerY) < halfSize;
    return !line && width !== 0 && height !== 0 && isInside ? geometry : null;
  }

  private static isOverRotationHandle(object: GameObject, x: number, y: number, slop = 0) {
    if (!Engine.paused || !object.bounds) return false;
    const zoom = Engine.camera.zoom;
    const handle = getViewportRotationHandle(getViewportGeometry(object), zoom);
    return !!handle && Math.hypot(x - handle.x, y - handle.y) <= handle.radius + (2 + slop) / zoom;
  }

  private static getHoveredLineEndpoint(object: Line, x: number, y: number, slop = 0) {
    if (!Engine.paused) return;
    const { line } = getViewportGeometry(object);
    const tolerance = (6 + slop) / Engine.camera.zoom;
    return line && getViewportLineEndpoints(line).find(endpoint =>
      Math.abs(x - endpoint.x) <= tolerance && Math.abs(y - endpoint.y) <= tolerance);
  }

  /**
   * initialises input event listeners.
   */
  static init() {
    if (this.isinitialised) return;
    this.isinitialised = true;

    const cancelInactiveGesture = () => {
      if (this.gesture && !this.isGestureActive(this.gesture)) this.finishGesture();
    };
    Engine.on('selectedObjectChanged', cancelInactiveGesture);
    Engine.on('paused', cancelInactiveGesture);
    Engine.on('debug', cancelInactiveGesture);

    const moveCanvasPointer = (event: MouseEvent) => {
      const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
      this.updateMousePosition(event, canvas);

      if (this.gesture && !this.gesture.pointer && typeof event.buttons === 'number' && !(event.buttons & 1)) {
        this.keys.delete('mouse0');
        this.finishGesture();
      }
      cancelInactiveGesture();
      const gesture = this.gesture;

      if (gesture?.kind === 'p1' || gesture?.kind === 'p2') {
        const { object, kind, offset } = gesture;
        const geometry = getViewportGeometry(object);
        const step = Engine.debugPositionGridSize;
        const point = projectOntoObjectAxes(geometry,
          snapToGrid(this.mouseX - offset.x, step), snapToGrid(this.mouseY - offset.y, step));
        const current = this.getGestureValue(object, kind);
        object.setEndpoint(kind, geometry.scaleX ? point.x / geometry.scaleX : current.x,
          geometry.scaleY ? point.y / geometry.scaleY : current.y);
        this.publishPreview(gesture);
        return;
      }

      if (gesture?.kind === 'rotate') {
        const { transform } = gesture.object;
        const origin = transform.worldPosition;
        const dx = this.mouseX - origin.x;
        const dy = this.mouseY - origin.y;
        if (Math.hypot(dx, dy) < 2 / Engine.camera.zoom) return;
        const angle = Math.atan2(dy, dx);
        const delta = angle - gesture.pointerAngle;
        gesture.rotation += Math.atan2(Math.sin(delta), Math.cos(delta));
        gesture.pointerAngle = angle;
        transform.rotation = event.shiftKey ? snapToGrid(gesture.rotation, Math.PI / 12) : gesture.rotation;
        this.publishPreview(gesture);
        return;
      }

      if (gesture?.kind === 'resize') {
        const obj = gesture.object;
        const geometry = getViewportGeometry(obj);
        const pointer = projectOntoObjectAxes(geometry,
          this.mouseX - gesture.offset.x, this.mouseY - gesture.offset.y);
        const signX = Math.sign(geometry.scaleX);
        const signY = Math.sign(geometry.scaleY);
        const width = Math.max(5, pointer.x * signX);
        const height = Math.max(5, pointer.y * signY);

        const sprite = obj.getComponent(SpriteComponent);
        if (sprite && sprite.frameWidth > 0 && sprite.frameHeight > 0) {
          const parentScale = obj.transform.parent?.worldScale;
          const parentX = parentScale?.x ?? 1;
          const parentY = parentScale?.y ?? 1;
          if (signX && parentX) obj.transform.scale.x = width * signX / (sprite.frameWidth * parentX);
          if (signY && parentY) obj.transform.scale.y = height * signY / (sprite.frameHeight * parentY);
        } else if (signX && signY) {
          const localWidth = width / Math.abs(geometry.scaleX);
          const localHeight = height / Math.abs(geometry.scaleY);

          const shape = obj.getComponent(ShapeComponent);
          if (shape?.type === 'circle') {
            shape.width = localWidth / 2;
          } else {
            const size = shape ?? obj.getComponent(TextComponent) ?? obj.bounds;
            if (size) {
              size.width = localWidth;
              size.height = localHeight;
            }
          }
        }
        this.publishPreview(gesture);
        return;
      }

      if (gesture?.kind === 'drag') {
        const { object } = gesture;
        const { parent, position } = object.transform;
        const step = Engine.debugPositionGridSize;
        let x = snapToGrid(this.mouseX - gesture.offset.x, step);
        let y = snapToGrid(this.mouseY - gesture.offset.y, step);
        if (parent) {
          const origin = parent.worldPosition;
          const scale = parent.worldScale;
          const rotation = parent.worldRotation;
          const dx = x - origin.x;
          const dy = y - origin.y;
          const cos = Math.cos(rotation);
          const sin = Math.sin(rotation);
          // Undo the parent's translation, rotation and scale in reverse order.
          // A collapsed axis has no inverse, so retain its local coordinate.
          x = scale.x === 0 ? position.x : (dx * cos + dy * sin) / scale.x;
          y = scale.y === 0 ? position.y : (-dx * sin + dy * cos) / scale.y;
        }
        if (object instanceof Line) {
          object.setOrigin(x, y);
        } else {
          position.x = x;
          position.y = y;
        }
        this.publishPreview(gesture);
        return;
      }

      const selected = Engine.selectedObject;
      if (canvas && Engine.debug && selected && (this.isOverRotationHandle(selected, this.mouseX, this.mouseY) ||
          (selected instanceof Line && this.getHoveredLineEndpoint(selected, this.mouseX, this.mouseY)))) {
        canvas.style.cursor = 'grab';
      } else if (canvas && Engine.debug && selected && this.getHoveredResizeHandle(selected, this.mouseX, this.mouseY)) {
        canvas.style.cursor = 'se-resize';
      } else if (canvas && (canvas.style?.cursor === 'se-resize' || canvas.style?.cursor === 'grab')) {
        canvas.style.cursor = 'default';
      }
    };

    const pressCanvas = (event: MouseEvent, pointerEvent?: PointerEvent) => {
      const target = event.target as HTMLCanvasElement | null;
      if (target?.tagName !== 'CANVAS') return;
      const canvas = document.getElementById('canvas');
      if (canvas instanceof HTMLCanvasElement && target !== canvas) return;
      if (pointerEvent) {
        // Keep compatibility mouse events from replaying the contact as a second gesture.
        pointerEvent.preventDefault();
        if (this.gesture) return;
      } else {
        if (this.gesture?.pointer) return;
        this.keys.add(`mouse${event.button}`);
      }
      if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) this.updateMousePosition(event, target);

      const worldPos = new Vector2(this.mouseX, this.mouseY);

      // If debug mode is on, try to select/drag/resize an object
      if (Engine.debug && event.button === 0) {
        this.finishGesture();
        const selected = Engine.selectedObject;
        const start = {
          startedPaused: Engine.paused,
          pointer: pointerEvent && { id: pointerEvent.pointerId, canvas: target },
        };
        const slop = pointerEvent?.pointerType === 'touch' ? 6 : 0;
        if (selected && this.isOverRotationHandle(selected, worldPos.x, worldPos.y, slop)) {
          const { rotation, worldPosition } = selected.transform;
          this.gesture = {
            kind: 'rotate', object: selected, rotation, ...start,
            pointerAngle: Math.atan2(worldPos.y - worldPosition.y, worldPos.x - worldPosition.x),
            initial: this.getGestureValue(selected, 'rotate'),
          };
          target.style.cursor = 'grabbing';
          return;
        }
        if (selected instanceof Line) {
          const endpoint = this.getHoveredLineEndpoint(selected, worldPos.x, worldPos.y, slop);
          if (endpoint) {
            this.gesture = {
              kind: endpoint.kind,
              object: selected,
              ...start,
              offset: new Vector2(worldPos.x - endpoint.x, worldPos.y - endpoint.y),
              initial: this.getGestureValue(selected, endpoint.kind),
            };
            target.style.cursor = 'grabbing';
            return;
          }
        }
        const handle = selected && this.getHoveredResizeHandle(selected, worldPos.x, worldPos.y, slop);
        if (selected && handle) {
          this.gesture = {
            kind: 'resize',
            object: selected,
            ...start,
            offset: new Vector2(worldPos.x - handle.cornerX, worldPos.y - handle.cornerY),
            initial: this.getGestureValue(selected, 'resize'),
            initialBounds: selected.bounds && new Vector2(selected.bounds.width, selected.bounds.height),
          };
          return;
        }

        const objects = Engine.currentScene ? Engine.currentScene.objects : Engine.objects;
        let found = false;

        const sorted = getViewportDrawOrder(objects);

        for (let i = sorted.length - 1; i >= 0; i--) {
          const obj = sorted[i];
          if (!obj.bounds || obj.getComponent?.(VisibilityComponent)?.visible === false) continue;
          
          const geometry = getViewportGeometry(obj);
          if (containsViewportPoint(obj, geometry, worldPos.x, worldPos.y, 5 / Engine.camera.zoom)) {
            Engine.selectedObject = obj;
            this.gesture = {
              kind: 'drag',
              object: obj,
              ...start,
              offset: new Vector2(worldPos.x - geometry.origin.x, worldPos.y - geometry.origin.y),
              initial: this.getGestureValue(obj, 'drag'),
            };
            found = true;
            break;
          }
        }

        if (!found) {
          Engine.selectedObject = null;
        }
      }

      if (!Engine.paused) {
        this.clickListeners.forEach((listener) => listener(worldPos));
      }
    };

    document.addEventListener('mousemove', event => {
      if (!this.gesture?.pointer) moveCanvasPointer(event);
    });
    document.addEventListener('mousedown', event => pressCanvas(event));
    document.addEventListener('mouseup', (event: MouseEvent) => {
      this.keys.delete(`mouse${event.button}`);
      if (event.button !== 0 || this.gesture?.pointer) return;
      if (this.gesture) this.finishGesture(this.isGestureActive(this.gesture));
    });

    document.addEventListener('pointerdown', event => {
      if (!Engine.debug || !Engine.paused || !event.isPrimary || event.button !== 0 ||
          (event.pointerType !== 'touch' && event.pointerType !== 'pen')) return;
      pressCanvas(event, event);
      const pointer = this.gesture?.pointer;
      if (event.isTrusted && pointer?.id === event.pointerId && pointer.canvas.isConnected) {
        pointer.canvas.setPointerCapture(pointer.id);
      }
    });
    document.addEventListener('pointermove', event => {
      if (this.gesture?.pointer?.id === event.pointerId) moveCanvasPointer(event);
    });
    document.addEventListener('pointerup', event => {
      const gesture = this.gesture;
      if (gesture?.pointer?.id === event.pointerId) this.finishGesture(this.isGestureActive(gesture));
    });
    document.addEventListener('pointercancel', event => {
      if (event.pointerType === 'mouse') {
        this.keys.delete('mouse0');
        if (!this.gesture?.pointer) this.finishGesture();
      } else if (this.gesture?.pointer?.id === event.pointerId) {
        this.finishGesture();
      }
    });
    document.addEventListener('lostpointercapture', event => {
      if (this.gesture?.pointer?.id === event.pointerId) this.finishGesture();
    });

    document.addEventListener('keydown', (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target && (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable === true ||
          (typeof target.getAttribute === 'function' && target.getAttribute('contenteditable') === 'true')
        )
      ) {
        return;
      }

      const key = String(event.key).toLowerCase();
      if (key === 'escape' && this.gesture) {
        this.finishGesture();
        event.preventDefault();
        return;
      }
      this.keys.add(key);

      // Toggle Pause with P
      if (key === 'p') {
        Engine.paused = !Engine.paused;

        if (Engine.paused) {
          const canvas = document.getElementById('canvas');
          if (canvas) canvas.style.cursor = 'default';
        }
      }
    });

    document.addEventListener('keyup', (event: KeyboardEvent) => {
      this.keys.delete(String(event.key).toLowerCase());
    });

    const resetInput = () => {
      this.keys.clear();
      this.finishGesture();
    };
    window.addEventListener('blur', resetInput);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) resetInput();
    });
  }

  /**
   * Checks if a specific key is currently held down.
   * @param key The key to check (e.g., 'w', 'ArrowUp', ' ').
   */
  static isKeyDown(key: string): boolean {
    return this.keys.has(key.toLowerCase());
  }

  /** Returns a connected standard-mapped pad, or the first one if no index is supplied. */
  static getGamepad(index?: number): Gamepad | null {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;

    try {
      const pads = navigator.getGamepads();
      const isStandard = (pad: Gamepad | null | undefined): pad is Gamepad =>
        pad?.connected === true && pad.mapping === 'standard';

      if (index === undefined) return Array.from(pads).find(isStandard) ?? null;
      const pad = pads[index];
      return isStandard(pad) ? pad : null;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'SecurityError') return null;
      throw error;
    }
  }

  /** Returns the left stick axes with a dead zone of 0.2 on each axis. */
  static getGamepadAxes(index?: number): Vector2 {
    const [x = 0, y = 0] = this.getGamepad(index)?.axes ?? [];
    return new Vector2(Math.abs(x) > 0.2 ? x : 0, Math.abs(y) > 0.2 ? y : 0);
  }

  /**
   * Current mouse x position in world space.
   */
  public static get mouseX(): number {
    return (this.mousePosition.x / Engine.camera.zoom) + Engine.camera.position.x;
  }

  /**
   * Current mouse y position in world space.
   */
  public static get mouseY(): number {
    return (this.mousePosition.y / Engine.camera.zoom) + Engine.camera.position.y;
  }

  /**
   * Adds a global click listener that will be called when the canvas is clicked.
   * @param listener The function to run when a click occurs.
   */
  public static addClickListener(listener: (pos: Vector2) => void) {
    this.clickListeners.add(listener);
  }

  /**
   * Removes a global click listener.
   * @param listener The function to remove.
   */
  public static removeClickListener(listener: (pos: Vector2) => void) {
    this.clickListeners.delete(listener);
  }
}
