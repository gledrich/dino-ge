import type GameObject from './GameObject.js';
import { getEngineState } from './EngineState.js';

/**
 * Helper class to manage game object registration and destruction.
 * Breaking circular dependencies by isolating these operations.
 */
export default class Registry {
  /**
   * Registers a game object with the active scene or global engine loop.
   */
  static registerObject(object: GameObject) {
    const state = getEngineState();
    if (!state) return;

    state.zOrderDirty = true;
    state.sortedObjects = [];
    if (state.currentScene) {
      state.currentScene.add(object);
    } else {
      state.objects.add(object);
    }
  }

  /**
   * Removes a game object from the active scene or global engine loop.
   */
  static destroyObject(object: GameObject) {
    const state = getEngineState();
    if (!state) return;

    state.zOrderDirty = true;
    state.sortedObjects = [];
    if (state.currentScene) {
      state.currentScene.remove(object);
    } else {
      state.objects.delete(object);
    }
    if (state.selectedObject === object) {
      state.selectedObject = null;
      state.events.dispatchEvent(new CustomEvent('selectedObjectChanged', { detail: null }));
    }
  }
}
