import Component from '../core/Component.js';
import Vector2 from '../math/Vector2.js';

/**
 * Component that holds physics-related data for a GameObject.
 */
export default class PhysicsComponent extends Component {
  /** Current velocity in pixels per second. */
  velocity: Vector2 = new Vector2(0, 0);
  /** Current acceleration in pixels per second squared. */
  acceleration: Vector2 = new Vector2(0, 0);
  /** Mass of the object (used for physics resolution). */
  mass: number = 1;
  /** Whether the object is immovable (e.g., walls). */
  isStatic: boolean = false;
  /** Bounciness of the object (0 = inelastic, 1 = perfectly elastic). */
  restitution: number = 0.5;
  /** Resistance to sliding. */
  friction: number = 0.2;
  /** Whether the object should detect collisions but not respond to them physically. */
  isSensor: boolean = false;
  /** Category bits this body belongs to. Defaults to category 1. */
  collisionCategory: number = 0x1;
  /** Category bits this body can collide with. Defaults to all categories. */
  collisionMask: number = 0xffffffff;
}
