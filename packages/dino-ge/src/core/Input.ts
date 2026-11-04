import Vector2 from '../math/Vector2.js';
import Engine from './Engine.js';
import SpriteComponent from '../components/SpriteComponent.js';
import ShapeComponent from '../components/ShapeComponent.js';
import TextComponent from '../components/TextComponent.js';

/**
 * Handles mouse and keyboard input events.
 */
export default class Input {
  private static mousePosition: Vector2 = new Vector2(0, 0);
  private static clickListeners: Set<(pos: Vector2) => void> = new Set();
  private static keys: Set<string> = new Set();
  private static isinitialised = false;

  private static isDragging = false;
  private static isResizing = false;
  private static dragOffset: Vector2 = new Vector2(0, 0);

  /**
   * initialises input event listeners.
   */
  static init() {
    if (this.isinitialised) return;
    this.isinitialised = true;

    document.addEventListener('mousemove', (event: MouseEvent) => {
      const canvas = document.getElementById('canvas') as HTMLCanvasElement;
      if (canvas && typeof canvas.getBoundingClientRect === 'function') {
        const rect = canvas.getBoundingClientRect();
        this.mousePosition.x = event.clientX - rect.left;
        this.mousePosition.y = event.clientY - rect.top;
      } else {
        this.mousePosition.x = event.clientX;
        this.mousePosition.y = event.clientY;
      }

      if (this.isResizing && Engine.selectedObject && Engine.debug) {
        const obj = Engine.selectedObject;
        const { worldPosition } = obj.transform;
        const scale = obj.transform.scale || new Vector2(1, 1);
        const worldWidth = Math.max(5, this.mouseX - worldPosition.x);
        const worldHeight = Math.max(5, this.mouseY - worldPosition.y);

        const sprite = obj.getComponent(SpriteComponent);
        if (sprite && sprite.frameWidth > 0 && sprite.frameHeight > 0) {
          // Resizing sprites changes their transform scale
          obj.transform.scale.x = worldWidth / sprite.frameWidth;
          obj.transform.scale.y = worldHeight / sprite.frameHeight;
        } else {
          // Resizing other components changes their local dimensions
          // We must compensate for current scale so that: localDim * scale = worldWidth
          const localWidth = worldWidth / scale.x;
          const localHeight = worldHeight / scale.y;

          const shape = obj.getComponent(ShapeComponent);
          const text = obj.getComponent(TextComponent);

          if (shape) {
            shape.width = localWidth;
            shape.height = localHeight;
          } else if (text) {
            text.width = localWidth;
            text.height = localHeight;
          } else if (obj.bounds) {
            obj.bounds.width = localWidth;
            obj.bounds.height = localHeight;
          }
        }
        return;
      }

      if (Engine.debug && this.isDragging && Engine.selectedObject) {
        const { parent } = Engine.selectedObject.transform;
        if (parent) {
          const parentWorldPos = parent.worldPosition;
          Engine.selectedObject.transform.position.x = (this.mouseX - this.dragOffset.x) - parentWorldPos.x;
          Engine.selectedObject.transform.position.y = (this.mouseY - this.dragOffset.y) - parentWorldPos.y;
        } else {
          Engine.selectedObject.transform.position.x = this.mouseX - this.dragOffset.x;
          Engine.selectedObject.transform.position.y = this.mouseY - this.dragOffset.y;
        }
        return;
      }

      // Cursor feedback for resize handle
      if (Engine.debug && Engine.selectedObject && !this.isDragging && !this.isResizing) {
        const obj = Engine.selectedObject;
        const { worldPosition } = obj.transform;
        const worldScale = obj.transform.worldScale || new Vector2(1, 1);
        const width = (obj.bounds?.width ?? 0) * worldScale.x;
        const height = (obj.bounds?.height ?? 0) * worldScale.y;
        const handleSize = 8 / Engine.camera.zoom;
        const worldPos = new Vector2(this.mouseX, this.mouseY);

        if (
          worldPos.x > worldPosition.x + width - handleSize / 2 &&
          worldPos.x < worldPosition.x + width + handleSize / 2 &&
          worldPos.y > worldPosition.y + height - handleSize / 2 &&
          worldPos.y < worldPosition.y + height + handleSize / 2
        ) {
          const canvas = document.getElementById('canvas');
          if (canvas) canvas.style.cursor = 'se-resize';
          return;
        } else {
          const canvas = document.getElementById('canvas');
          if (canvas && canvas.style.cursor === 'se-resize') {
            canvas.style.cursor = 'default';
          }
        }
      }
    });

    document.addEventListener('mousedown', (event: MouseEvent) => {
      if ((event.target as HTMLElement).tagName !== 'CANVAS') return;
      this.keys.add(`mouse${event.button}`);

      const worldPos = new Vector2(this.mouseX, this.mouseY);

      // If debug mode is on, try to select/drag/resize an object
      if (Engine.debug && event.button === 0) {
        // First check if we're clicking the resize handle of the ALREADY selected object
        if (Engine.selectedObject) {
          const obj = Engine.selectedObject;
          const { worldPosition } = obj.transform;
          const worldScale = obj.transform.worldScale || new Vector2(1, 1);
          const width = (obj.bounds?.width ?? 0) * worldScale.x;
          const height = (obj.bounds?.height ?? 0) * worldScale.y;
          const handleSize = 8 / Engine.camera.zoom;

          if (
            worldPos.x > worldPosition.x + width - handleSize / 2 &&
            worldPos.x < worldPosition.x + width + handleSize / 2 &&
            worldPos.y > worldPosition.y + height - handleSize / 2 &&
            worldPos.y < worldPosition.y + height + handleSize / 2
          ) {
            this.isResizing = true;
            return;
          }
        }

        const objects = Engine.currentScene ? Engine.currentScene.objects : Engine.objects;
        let found = false;

        // Check objects from top to bottom (zIndex)
        const sorted = Array.from(objects).sort((a, b) => b.metadata.zIndex - a.metadata.zIndex);

        for (let i = 0; i < sorted.length; i++) {
          const obj = sorted[i];
          if (!obj.bounds) continue;
          
          const { worldPosition } = obj.transform;
          const worldScale = obj.transform.worldScale || new Vector2(1, 1);
          const width = obj.bounds.width * worldScale.x;
          const height = obj.bounds.height * worldScale.y;
          if (
            worldPos.x > worldPosition.x &&
            worldPos.x < worldPosition.x + width &&
            worldPos.y > worldPosition.y &&
            worldPos.y < worldPosition.y + height
          ) {
            Engine.selectedObject = obj;
            this.isDragging = true;
            this.dragOffset.x = worldPos.x - worldPosition.x;
            this.dragOffset.y = worldPos.y - worldPosition.y;
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
    });

    document.addEventListener('mouseup', (event: MouseEvent) => {
      this.keys.delete(`mouse${event.button}`);
      if (event.button === 0) {
        this.isDragging = false;
        this.isResizing = false;
      }
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

    window.addEventListener('blur', () => {
      this.keys.clear();
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
