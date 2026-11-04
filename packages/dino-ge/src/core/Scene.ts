import type GameObject from './GameObject.js';
import { ObjectSet } from './ObjectSet.js';

/**
 * Represents a separate world or level in the game.
 * Scenes manage their own set of game objects and lifecycle.
 */
export default abstract class Scene {
  /** The set of game objects currently in the scene. */
  public objects: Set<GameObject> = new ObjectSet();

  /**
   * Called once when the scene becomes active.
   * Useful for initialising scene-specific objects.
   */
  public onLoad(): void {}

  /**
   * Called when the game window or container is resized.
   * Useful for updating UI positions or camera bounds.
   * @param width The new width of the game window.
   * @param height The new height of the game window.
   */
  public onResize?(width: number, height: number): void;

  /**
   * Called every frame to update game logic within the scene.
   */
  public update(): void {}

  /**
   * Adds a game object to the scene.
   * @param object The object to add.
   */
  public add(object: GameObject) {
    this.objects.add(object);
  }

  /**
   * Removes a game object from the scene.
   * @param object The object to remove.
   */
  public remove(object: GameObject) {
    this.objects.delete(object);
  }

  /**
   * Removes all objects from the scene.
   */
  public clear() {
    this.objects.clear();
  }
}
