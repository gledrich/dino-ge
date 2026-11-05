import System from '../core/System.js';
import type GameObject from '../core/GameObject.js';
import RenderComponent from '../components/RenderComponent.js';
import VisibilityComponent from '../components/VisibilityComponent.js';
import Engine from '../core/Engine.js';
import PhysicsComponent from '../components/PhysicsComponent.js';
import Vector2 from '../math/Vector2.js';
import Line from '../objects/Line.js';
import { getEngineState } from '../core/EngineState.js';
import { getViewportBounds, getViewportDrawOrder, getViewportGeometry, getViewportLineEndpoints, getViewportRotationHandle } from '../core/ViewportGeometry.js';

/**
 * A system that processes entities with RenderComponents.
 * Handles camera transforms, frustum culling, and drawing.
 */
export default class RenderingSystem extends System {
  private ctx: CanvasRenderingContext2D;

  constructor(ctx: CanvasRenderingContext2D) {
    super();
    this.ctx = ctx;
  }

  /**
   * Updates the rendering context (used when the engine is re-initialised).
   * @param ctx The new canvas rendering context.
   */
  public setContext(ctx: CanvasRenderingContext2D): void {
    this.ctx = ctx;
  }

  /**
   * Main rendering loop.
   * @param entities The set of entities to process.
   * @param deltaTime Time passed since the last frame (optional).
   * @param debug Whether to draw debug overlays (hitboxes/tags).
   */
  public override update(entities: Set<GameObject>, deltaTime?: number, debug: boolean = false): void {
    const state = getEngineState();
    if (!state) return;

    const bounds = Engine.camera.getViewportBounds(
      (this.ctx.canvas as HTMLCanvasElement).width,
      (this.ctx.canvas as HTMLCanvasElement).height
    );

    this.ctx.save();

    // Apply camera transform
    this.ctx.scale(Engine.camera.zoom, Engine.camera.zoom);
    this.ctx.translate(-Engine.camera.position.x, -Engine.camera.position.y);

    // Update sorted cache if dirty
    if (state.zOrderDirty || !state.sortedObjects) {
      state.sortedObjects = getViewportDrawOrder(entities);
      state.zOrderDirty = false;
    }

    // Draw Debug Collisions (Briefly)
    if (debug && Engine.showCollisionLines) {
      const now = Date.now();
      const TTL = 500; // 500ms

      Engine.cleanDebugCollisions(now);

      Engine.debugCollisions.forEach(({ manifold, timestamp }) => {
        const { obj1, obj2, normal } = manifold;
        const opacity = 1 - (now - timestamp) / TTL;
        
        // Calculate contact point (approx centre between objects along normal)
        const pos1 = obj1.transform.worldPosition;
        const pos2 = obj2.transform.worldPosition;
        const centre = new Vector2(
          (pos1.x + pos2.x) / 2,
          (pos1.y + pos2.y) / 2
        );

        this.ctx.save();
        this.ctx.globalAlpha = opacity;
        this.ctx.beginPath();
        this.ctx.strokeStyle = '#ff00ff'; // Magenta for collisions
        this.ctx.lineWidth = 2 / Engine.camera.zoom;
        
        // Draw Normal
        this.ctx.moveTo(centre.x, centre.y);
        this.ctx.lineTo(centre.x + normal.x * 20, centre.y + normal.y * 20);
        this.ctx.stroke();

        // Draw Dot at contact
        this.ctx.fillStyle = '#ff00ff';
        this.ctx.beginPath();
        this.ctx.arc(centre.x, centre.y, 3 / Engine.camera.zoom, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.restore();
      });
    }

    const editSelection = debug && Engine.paused ? Engine.selectedObject : null;
    let selectedGeometry: ReturnType<typeof getViewportGeometry> | undefined;
    state.sortedObjects.forEach((object) => {
      const geometry = getViewportGeometry(object);
      const { left, right, top, bottom } = getViewportBounds(geometry);

      // Frustum Culling
      if (left < bounds.x + bounds.width && right > bounds.x && top < bounds.y + bounds.height && bottom > bounds.y) {
        // Find any RenderComponent on the entity
        const renderable = object.getComponent(RenderComponent);
        const visibility = object.getComponent(VisibilityComponent);
        const isVisible = visibility ? visibility.visible : true;

        if (renderable && isVisible) {
          renderable.draw(this.ctx);
        }

        if (object === editSelection) {
          selectedGeometry = geometry;
        } else if (debug) {
          this.drawDebugOverlay(object, geometry);
        }
      }
    });

    // Keep the selection handles above foreground objects in the editor.
    if (editSelection && selectedGeometry) this.drawDebugOverlay(editSelection, selectedGeometry);
    this.ctx.restore();
  }

  private drawDebugOverlay(object: GameObject, geometry: ReturnType<typeof getViewportGeometry>): void {
    const { origin: worldPosition, width, height, rotation, cornerX, cornerY, line } = geometry;
    const selected = object === Engine.selectedObject;
    const physics = object.getComponent(PhysicsComponent);
    this.ctx.save();
    this.ctx.strokeStyle = selected ? '#65d9b2' : 'red';
    this.ctx.lineWidth = (selected ? 2 : 1) / Engine.camera.zoom;

    if (physics?.isSensor) {
      this.ctx.setLineDash([5 / Engine.camera.zoom, 5 / Engine.camera.zoom]);
    }

    if (line) {
      const dx = line.x2 - line.x1;
      const dy = line.y2 - line.y1;
      const length = Math.hypot(dx, dy) || 1;
      this.ctx.lineWidth = 1 / Engine.camera.zoom;
      // Draw outside the stroke so the debug overlay leaves its colour visible.
      const offset = (line.radius + this.ctx.lineWidth) / length;
      const normalX = -dy * offset;
      const normalY = dx * offset;
      this.ctx.beginPath();
      this.ctx.moveTo(line.x1 + normalX, line.y1 + normalY);
      this.ctx.lineTo(line.x2 + normalX, line.y2 + normalY);
      this.ctx.moveTo(line.x1 - normalX, line.y1 - normalY);
      this.ctx.lineTo(line.x2 - normalX, line.y2 - normalY);
      this.ctx.stroke();
    } else if (rotation !== 0) {
      this.ctx.save();
      this.ctx.translate(worldPosition.x, worldPosition.y);
      this.ctx.rotate(rotation);
      this.ctx.strokeRect(0, 0, width, height);
      this.ctx.restore();
    } else {
      this.ctx.strokeRect(worldPosition.x, worldPosition.y, width, height);
    }
    this.ctx.setLineDash([]);

    if (selected) {
      const handles = line
        ? (Engine.paused && object instanceof Line ? getViewportLineEndpoints(line) : [])
        : (width !== 0 && height !== 0 ? [{ x: cornerX, y: cornerY }] : []);
      const handleSize = 8 / Engine.camera.zoom;
      this.ctx.fillStyle = '#FFD166';
      this.ctx.strokeStyle = '#000000';
      this.ctx.lineWidth = 1 / Engine.camera.zoom;
      for (const { x, y } of handles) {
        this.ctx.fillRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
        this.ctx.strokeRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
      }
    }

    if (Engine.paused && selected) {
      const handle = getViewportRotationHandle(geometry, Engine.camera.zoom);
      if (handle) {
        this.ctx.strokeStyle = '#65d9b2';
        this.ctx.lineWidth = 1 / Engine.camera.zoom;
        this.ctx.beginPath();
        this.ctx.moveTo(handle.anchorX, handle.anchorY);
        this.ctx.lineTo(handle.x, handle.y);
        this.ctx.stroke();
        this.ctx.beginPath();
        this.ctx.arc(handle.x, handle.y, handle.radius, 0, Math.PI * 2);
        this.ctx.fillStyle = '#65d9b2';
        this.ctx.fill();
        this.ctx.strokeStyle = '#111';
        this.ctx.stroke();
      }
    }

    this.ctx.save();
    this.ctx.font = `${12 / Engine.camera.zoom}px monospace`;
    this.ctx.fillStyle = '#f5f7fa';
    this.ctx.shadowColor = '#000000';
    this.ctx.shadowBlur = 3;
    this.ctx.fillText(object.metadata.tag || 'obj', worldPosition.x, worldPosition.y - (5 / Engine.camera.zoom));
    this.ctx.restore();

    // Draw Physics Vectors
    if (physics && Engine.showPhysicsVectors) {
      const centreX = worldPosition.x + width / 2;
      const centreY = worldPosition.y + height / 2;

      // Velocity (Blue)
      if (physics.velocity.x !== 0 || physics.velocity.y !== 0) {
        this.ctx.beginPath();
        this.ctx.strokeStyle = '#00bbff';
        this.ctx.moveTo(centreX, centreY);
        this.ctx.lineTo(centreX + physics.velocity.x, centreY + physics.velocity.y);
        this.ctx.stroke();
      }

      // Acceleration (Orange)
      if (physics.acceleration.x !== 0 || physics.acceleration.y !== 0) {
        this.ctx.beginPath();
        this.ctx.strokeStyle = '#ff9900';
        this.ctx.moveTo(centreX, centreY);
        this.ctx.lineTo(centreX + physics.acceleration.x, centreY + physics.acceleration.y);
        this.ctx.stroke();
      }
    }

    this.ctx.restore();
  }
}
