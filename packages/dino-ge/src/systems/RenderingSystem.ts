import System from '../core/System.js';
import type GameObject from '../core/GameObject.js';
import RenderComponent from '../components/RenderComponent.js';
import VisibilityComponent from '../components/VisibilityComponent.js';
import Engine from '../core/Engine.js';
import PhysicsComponent from '../components/PhysicsComponent.js';
import Vector2 from '../math/Vector2.js';
import { getEngineState } from '../core/EngineState.js';
import { getViewportDrawOrder, getViewportGeometry, getViewportRotationHandle } from '../core/ViewportGeometry.js';

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

    state.sortedObjects.forEach((object) => {
      const geometry = getViewportGeometry(object);
      const { origin: worldPosition, width, height, rotation, cos, sin, cornerX, cornerY, line } = geometry;
      const acrossX = width * cos;
      const acrossY = width * sin;
      const downX = -height * sin;
      const downY = height * cos;
      const left = line ? Math.min(line.x1, line.x2) - line.padding : worldPosition.x + Math.min(0, acrossX) + Math.min(0, downX);
      const right = line ? Math.max(line.x1, line.x2) + line.padding : worldPosition.x + Math.max(0, acrossX) + Math.max(0, downX);
      const top = line ? Math.min(line.y1, line.y2) - line.padding : worldPosition.y + Math.min(0, acrossY) + Math.min(0, downY);
      const bottom = line ? Math.max(line.y1, line.y2) + line.padding : worldPosition.y + Math.max(0, acrossY) + Math.max(0, downY);

      // Frustum Culling
      if (left < bounds.x + bounds.width && right > bounds.x && top < bounds.y + bounds.height && bottom > bounds.y) {
        // Find any RenderComponent on the entity
        const renderable = object.getComponent(RenderComponent);
        const visibility = object.getComponent(VisibilityComponent);
        const isVisible = visibility ? visibility.visible : true;

        if (renderable && isVisible) {
          renderable.draw(this.ctx);
        }

        // Draw debug overlays in world space
        if (debug) {
          const physics = object.getComponent(PhysicsComponent);
          this.ctx.save();
          this.ctx.strokeStyle = object === Engine.selectedObject ? '#65d9b2' : 'red';
          this.ctx.lineWidth = (object === Engine.selectedObject ? 2 : 1) / Engine.camera.zoom;
          
          if (physics?.isSensor) {
            this.ctx.setLineDash([5 / Engine.camera.zoom, 5 / Engine.camera.zoom]);
          }

          if (line) {
            this.ctx.beginPath();
            this.ctx.moveTo(line.x1, line.y1);
            this.ctx.lineTo(line.x2, line.y2);
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

          // Draw resize handle if selected
          if (!line && object === Engine.selectedObject && width !== 0 && height !== 0) {
            const handleSize = 8 / Engine.camera.zoom;
            this.ctx.fillStyle = '#FFD166';
            this.ctx.fillRect(
              cornerX - handleSize / 2,
              cornerY - handleSize / 2,
              handleSize,
              handleSize
            );
            this.ctx.strokeStyle = '#000000';
            this.ctx.lineWidth = 1 / Engine.camera.zoom;
            this.ctx.strokeRect(
              cornerX - handleSize / 2,
              cornerY - handleSize / 2,
              handleSize,
              handleSize
            );
          }

          if (Engine.paused && object === Engine.selectedObject) {
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
    });

    this.ctx.restore();
  }
}
