import * as Dino from 'dino-ge';

export const sceneObjectKinds = ['Rectangle', 'Circle', 'Text'] as const;
export type SceneObjectKind = typeof sceneObjectKinds[number];
export const sceneObjectDragType = 'application/x-dino-scene-object';
export const sceneAssetDragType = 'application/x-dino-scene-asset';
export const sceneSourceKey = '__dinoPlaygroundSceneSource';

export interface ScenePoint { x: number; y: number }

export interface SceneTransformState {
  position?: ScenePoint;
  scale?: ScenePoint;
  size?: ScenePoint;
}

/** Move the selection in viewport axes while retaining its local transform. */
export function nudgeSceneSelection(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'>): boolean {
  const { key, shiftKey, altKey, ctrlKey, metaKey } = event;
  if (altKey || ctrlKey || metaKey) return false;
  const step = shiftKey ? 10 : 1;
  let x = 0;
  let y = 0;
  switch (key) {
    case 'ArrowLeft': x = -step; break;
    case 'ArrowRight': x = step; break;
    case 'ArrowUp': y = -step; break;
    case 'ArrowDown': y = step; break;
    default: return false;
  }

  const { Engine } = Dino;
  const object = Engine.selectedObject;
  if (!object || !(Engine.currentScene?.objects ?? Engine.objects).has(object)) return true;
  const { position, parent } = object.transform;
  const initial = position.clone();
  if (parent) {
    const { worldRotation, worldScale } = parent;
    const cos = Math.cos(worldRotation);
    const sin = Math.sin(worldRotation);
    const localX = worldScale.x ? (x * cos + y * sin) / worldScale.x : 0;
    const localY = worldScale.y ? (-x * sin + y * cos) / worldScale.y : 0;
    position.set(position.x + localX, position.y + localY);
  } else {
    position.set(position.x + x, position.y + y);
  }
  if (position.x !== initial.x || position.y !== initial.y) {
    Engine.emit('objectManipulated', { object, kind: 'drag', initial });
  }
  return true;
}

export function restoreSceneTransform(object: Dino.GameObject, state: SceneTransformState) {
  if (state.position) object.transform.position.set(state.position.x, state.position.y);
  if (state.scale) object.transform.scale.set(state.scale.x, state.scale.y);
  if (!state.size) return;
  const shape = object.getComponent(Dino.ShapeComponent);
  if (shape?.type === 'circle') {
    shape.width = state.size.x / 2;
    return;
  }
  const dimensions = shape ?? object.getComponent(Dino.TextComponent) ?? object.bounds;
  if (dimensions) {
    dimensions.width = state.size.x;
    dimensions.height = state.size.y;
  }
}

export interface SceneSource {
  scriptId: string;
  className: string;
}

export function getSceneSource(scene: Dino.Scene): SceneSource | undefined {
  return Object.getOwnPropertyDescriptor(scene.constructor, sceneSourceKey)?.value;
}

export const sceneObjectDefaults = {
  Rectangle: { width: 80, height: 48, colour: '#54d6ad' },
  Circle: { radius: 28, colour: '#ffd166' },
  Text: { text: 'New text', colour: '#f4f5f7' },
};

interface PlacementOptions {
  tag: string;
  x: number;
  y: number;
  scene?: SceneSource;
  sourceId?: string;
  error?: string;
}

export type SceneObjectPlacement = PlacementOptions & (
  | { kind: SceneObjectKind }
  | { kind: 'Sprite'; asset: { image: HTMLImageElement; source: string; scale: number } }
);

/** Turn the preview server's asset URL into a reusable expression in the game script. */
export function getAssetSource(src: string, scriptId: string): string | undefined {
  const url = new URL(src, location.href);
  if (url.protocol === 'data:' && src.startsWith('data:image/')) return JSON.stringify(src);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (url.origin !== location.origin) return JSON.stringify(url.href);

  const workspacePath = url.pathname.replace(/^\/project-runs\/[^/]+\//, '/scripts/');
  const entry = scriptId.split('/').map(encodeURIComponent);
  if (entry.length > 1 && workspacePath.startsWith(`/scripts/${entry[0]}/`)) {
    const folder = entry.slice(0, -1);
    const target = workspacePath.slice('/scripts/'.length).split('/');
    while (folder.length && target.length && folder[0] === target[0]) {
      folder.shift();
      target.shift();
    }
    const relative = `${folder.length ? '../'.repeat(folder.length) : './'}${target.join('/')}${url.search}${url.hash}`;
    return `new URL(${JSON.stringify(relative)}, import.meta.url).href`;
  }
  return JSON.stringify(`${workspacePath}${url.search}${url.hash}`);
}

export function createSceneObject(placement: SceneObjectPlacement) {
  const { kind, tag, x, y, sourceId } = placement;
  const options = { tag, position: new Dino.Vector2(x, y), __sourceId: sourceId };
  switch (kind) {
    case 'Rectangle': return new Dino.Rectangle({ ...options, ...sceneObjectDefaults.Rectangle });
    case 'Circle': return new Dino.Circle({ ...options, ...sceneObjectDefaults.Circle });
    case 'Text': return new Dino.Text({ ...options, ...sceneObjectDefaults.Text });
    case 'Sprite': {
      const sprite = new Dino.Sprite({
        ...options, img: placement.asset.image, rows: 1, cols: 1,
        scale: new Dino.Vector2(placement.asset.scale, placement.asset.scale),
      });
      sprite.play();
      return sprite;
    }
  }
}

export function duplicateSceneObject(original: Dino.GameObject, type: string, options: Record<string, unknown>,
  tag: string, sourceId: string, position: Dino.Vector2): Dino.GameObject | undefined {
  const props = { ...options, tag, __sourceId: sourceId, position };
  switch (type) {
    case 'Rectangle': return new Dino.Rectangle(props as ConstructorParameters<typeof Dino.Rectangle>[0]);
    case 'Circle': return new Dino.Circle(props as ConstructorParameters<typeof Dino.Circle>[0]);
    case 'Text': return new Dino.Text(props as ConstructorParameters<typeof Dino.Text>[0]);
    case 'Sprite': {
      const img = original.getComponent(Dino.SpriteComponent)?.img;
      if (!img) return;
      const sprite = new Dino.Sprite({ ...props, img } as ConstructorParameters<typeof Dino.Sprite>[0]);
      sprite.play();
      return sprite;
    }
  }
}
