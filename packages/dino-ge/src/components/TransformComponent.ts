import Component from '../core/Component.js';
import Vector2 from '../math/Vector2.js';
import { notifySceneObjectChanged } from '../core/EngineState.js';

/**
 * Component that holds the position, rotation, and scale of an entity.
 * Supports hierarchical transformations (parent-child relationships).
 */
export default class TransformComponent extends Component {
  private _position: Vector2 = new Vector2(0, 0);
  private _rotation: number = 0;
  private _scale: Vector2 = new Vector2(1, 1);

  /** Local position relative to the parent. */
  get position(): Vector2 { return this._position; }
  set position(val: Vector2) {
    this._position = val;
    this._position.onChange = this.onLocalTransformChange.bind(this);
    this.setDirty();
  }

  /** Local rotation in radians relative to the parent. */
  get rotation(): number { return this._rotation; }
  set rotation(val: number) {
    this._rotation = val;
    this.setDirty();
  }

  /** Local scale relative to the parent. */
  get scale(): Vector2 { return this._scale; }
  set scale(val: Vector2) {
    this._scale = val;
    this._scale.onChange = this.onLocalTransformChange.bind(this);
    this.setDirty();
  }

  /** Reference to the parent transform. */
  parent?: TransformComponent;
  /** List of children transforms. */
  children: Set<TransformComponent> = new Set();

  // Cache for world-space properties
  private _isDirty = true;
  private _worldPosition: Vector2 = new Vector2(0, 0);
  private _worldRotation: number = 0;
  private _worldScale: Vector2 = new Vector2(1, 1);

  constructor() {
    super();
    this._position.onChange = this.onLocalTransformChange.bind(this);
    this._scale.onChange = this.onLocalTransformChange.bind(this);
    this.setDirty();
  }

  /**
   * Internal callback for when local vectors are modified.
   * @private
   */
  private onLocalTransformChange() {
    this.setDirty();
  }

  /**
   * Sets this transform and all its children as dirty, forcing a recalculation 
   * of world-space properties on the next access.
   */
  public setDirty() {
    if (this._isDirty) return;
    this._isDirty = true;
    this.children.forEach(child => child.setDirty());
  }

  /**
   * Adds a child transform to this one.
   * @param child The child transform to add.
   */
  addChild(child: TransformComponent) {
    if (child.parent === this) return;
    
    if (child.parent) {
      child.parent.children.delete(child);
    }
    
    child.parent = this;
    this.children.add(child);
    child.setDirty();
    notifySceneObjectChanged(child.gameObject);
  }

  /**
   * Removes a child transform from this one.
   * @param child The child transform to remove.
   */
  removeChild(child: TransformComponent) {
    if (child.parent === this) {
      child.parent = undefined;
      this.children.delete(child);
      child.setDirty();
      notifySceneObjectChanged(child.gameObject);
    }
  }

  /**
   * Gets the world-space position.
   * Note: This returns a clone to prevent accidental cache mutation.
   * For performance, use getWorldPosition(out).
   */
  get worldPosition(): Vector2 {
    if (this._isDirty) {
      this.updateWorldTransform();
    }
    return this._worldPosition.clone();
  }

  /**
   * Writes the world-space position into the provided 'out' vector.
   * Allocation-free alternative to the worldPosition getter.
   * @param out The vector to write into.
   * @returns The 'out' vector for chaining.
   */
  getWorldPosition(out: Vector2): Vector2 {
    if (this._isDirty) {
      this.updateWorldTransform();
    }
    return out.copy(this._worldPosition);
  }

  /**
   * Calculates the world-space rotation.
   */
  get worldRotation(): number {
    if (this._isDirty) {
      this.updateWorldTransform();
    }
    return this._worldRotation;
  }

  /**
   * Calculates the world-space scale.
   * Note: This returns a clone to prevent accidental cache mutation.
   * For performance, use getWorldScale(out).
   */
  get worldScale(): Vector2 {
    if (this._isDirty) {
      this.updateWorldTransform();
    }
    return this._worldScale.clone();
  }

  /**
   * Writes the world-space scale into the provided 'out' vector.
   * Allocation-free alternative to the worldScale getter.
   * @param out The vector to write into.
   * @returns The 'out' vector for chaining.
   */
  getWorldScale(out: Vector2): Vector2 {
    if (this._isDirty) {
      this.updateWorldTransform();
    }
    return out.copy(this._worldScale);
  }

  /**
   * Recalculates all world-space properties from the root parent down.
   * @private
   */
  private updateWorldTransform() {
    if (!this.parent) {
      this._worldPosition.x = this.position.x;
      this._worldPosition.y = this.position.y;
      this._worldRotation = this.rotation;
      this._worldScale.x = this.scale.x;
      this._worldScale.y = this.scale.y;
    } else {
      const parentWorldPos = this.parent.worldPosition;
      const parentWorldRot = this.parent.worldRotation;
      const parentWorldScale = this.parent.worldScale;

      // Apply parent's scale and rotation to local position
      const localX = this.position.x * parentWorldScale.x;
      const localY = this.position.y * parentWorldScale.y;

      const cos = Math.cos(parentWorldRot);
      const sin = Math.sin(parentWorldRot);
      
      const rotatedX = localX * cos - localY * sin;
      const rotatedY = localX * sin + localY * cos;

      this._worldPosition.x = parentWorldPos.x + rotatedX;
      this._worldPosition.y = parentWorldPos.y + rotatedY;
      this._worldRotation = parentWorldRot + this.rotation;
      this._worldScale.x = parentWorldScale.x * this.scale.x;
      this._worldScale.y = parentWorldScale.y * this.scale.y;
    }
    this._isDirty = false;
  }
}
