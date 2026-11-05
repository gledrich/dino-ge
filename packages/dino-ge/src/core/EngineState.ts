import type GameObject from './GameObject.js';
import type Scene from './Scene.js';
import type Camera from './Camera.js';
import type System from './System.js';
import type RenderingSystem from '../systems/RenderingSystem.js';
import type { CollisionManifold } from '../physics/Physics.js';
import type { ObjectSet } from './ObjectSet.js';

/**
 * Internal state of the engine, shared across instances.
 */
export interface EngineState {
  objects: ObjectSet;
  paused: boolean;
  debug: boolean;
  selectedObject: GameObject | null;
  camera: Camera;
  systems: System[];
  renderingSystem?: RenderingSystem;
  events: EventTarget;
  totalPausedTime: number;
  pauseStartTime: number;
  currentScene: Scene | null;
  debugCollisions: { manifold: CollisionManifold, timestamp: number }[];
  showDebugHud: boolean;
  debugPositionGridSize: number;
  debugKeepProportions: boolean;
  debugSnapRotation: boolean;
  showPhysicsVectors: boolean;
  showCollisionLines: boolean;
  zOrderDirty: boolean;
  sortedObjects: GameObject[];
}

/**
 * Helper to access the global shared state without full Engine dependency.
 */
export const getEngineState = (): EngineState => {
  const global = globalThis as unknown as { __DINO_ENGINE_STATE__: EngineState };
  return global.__DINO_ENGINE_STATE__;
};

/** Notify observers after membership changes in the active object collection. */
export function notifySceneObjectsChanged(collection?: Set<GameObject>) {
  const state = getEngineState();
  if (!state) return;
  const active = state.currentScene?.objects ?? state.objects;
  if (collection && collection !== active) return;
  state.zOrderDirty = true;
  if (state.selectedObject && !active.has(state.selectedObject)) {
    state.selectedObject = null;
    state.events.dispatchEvent(new CustomEvent('selectedObjectChanged', { detail: null }));
  }
  state.events.dispatchEvent(new CustomEvent('sceneHierarchyChanged'));
}

export function notifySceneObjectChanged(object?: GameObject) {
  const state = getEngineState();
  if (object && (state?.currentScene?.objects ?? state?.objects)?.has(object)) {
    state.events.dispatchEvent(new CustomEvent('sceneHierarchyChanged'));
  }
}
