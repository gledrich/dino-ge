import type GameObject from './GameObject.js';
import { notifySceneObjectsChanged } from './EngineState.js';

/**
 * A specialised Set for managing GameObjects with tag-based lookups.
 */
export class ObjectSet extends Set<GameObject> {
  override add(object: GameObject): this {
    const size = this.size;
    super.add(object);
    if (this.size !== size) notifySceneObjectsChanged(this);
    return this;
  }

  override delete(object: GameObject): boolean {
    const removed = super.delete(object);
    if (removed) notifySceneObjectsChanged(this);
    return removed;
  }

  override clear(): void {
    if (!this.size) return;
    super.clear();
    notifySceneObjectsChanged(this);
  }

  /**
   * Finds all objects with a specific tag.
   * @param tag The tag to filter by. If omitted, returns all objects.
   */
  findAll(tag?: string): GameObject[] {
    if (!tag) return Array.from(this);
    return Array.from(this).filter((obj) => obj.metadata.tag === tag);
  }
}
