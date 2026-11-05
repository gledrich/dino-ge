import * as Dino from 'dino-ge';

export const sceneObjectKinds = ['Rectangle', 'Circle', 'Text', 'Line'] as const;
export type SceneObjectKind = typeof sceneObjectKinds[number];
export const sceneObjectDragType = 'application/x-dino-scene-object';
export const scenePointerDragEvent = 'playground-pointer-drag-scene-item';
export const sceneKeyboardPlacementEvent = 'playground-position-scene-item';
export const sceneObjectCodeEvent = 'playground-insert-scene-object-code';
export const openEntryObjectSourceEvent = 'playground-open-entry-object-source';
export const revealSceneObjectEvent = 'playground-reveal-scene-object';
export const frameSceneObjectEvent = 'playground-frame-scene-object';
export const renameEntryObjectEvent = 'playground-rename-entry-object';
export const sceneObjectTagHistoryEvent = 'playground-object-tag-history';
export interface EntryObjectRename { object: Dino.GameObject; tag: string; previousTag: string; error?: string }
export const sceneAssetDragType = 'application/x-dino-scene-asset';
export const sceneAssetDragEvent = 'playground-drag-scene-asset';
export const sceneSourceKey = '__dinoPlaygroundSceneSource';

// Drag payloads are protected until drop, but their type names remain visible.
export function getSceneAssetPreviewType(tag: string): string {
  const bytes = new TextEncoder().encode(tag);
  return `${sceneAssetDragType}-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function getSceneSpriteScale(image: HTMLImageElement): number {
  return Math.min(1, 128 / Math.max(image.naturalWidth, image.naturalHeight));
}

export interface SceneImageAsset { tag: string; image: HTMLImageElement }

export function isReplaceableSprite(object: Dino.GameObject | null): object is Dino.Sprite {
  return object instanceof Dino.Sprite && object.rows === 1 && object.cols === 1 &&
    object.metadata.sourceId?.startsWith('DinoPlace') === true;
}

export interface ScenePoint { x: number; y: number }

export function getSceneSelectionBounds(object: Dino.GameObject, members: ReadonlySet<Dino.GameObject>) {
  const selection = Dino.getViewportBounds(Dino.getViewportGeometry(object));
  if (selection.left !== selection.right || selection.top !== selection.bottom) return selection;

  // For a group, use the extent of its scene members instead of its origin.
  let bounds: typeof selection | undefined;
  const descendants = [...object.transform.children];
  for (const transform of descendants) {
    const child = transform.gameObject;
    if (!child || !members.has(child)) continue;
    descendants.push(...transform.children);
    if (!child.bounds) continue;
    const next = Dino.getViewportBounds(Dino.getViewportGeometry(child));
    bounds = bounds ? {
      left: Math.min(bounds.left, next.left), right: Math.max(bounds.right, next.right),
      top: Math.min(bounds.top, next.top), bottom: Math.max(bounds.bottom, next.bottom),
    } : next;
  }
  return bounds ?? selection;
}

export type ScenePointerDragItem = { kind: SceneObjectKind } | { asset: SceneImageAsset };

export type ScenePointerDrag = ScenePointerDragItem & {
  phase: 'preview' | 'drop';
  point: ScenePoint;
};

export interface SceneKeyboardPlacementRequest {
  item: ScenePointerDragItem;
  source: HTMLButtonElement;
}

export type CanvasPlacement = ReadonlyMap<Dino.ObjectManipulationPreview['kind'], ScenePoint>;

export interface SceneTransformState {
  position?: ScenePoint;
  rotation?: number;
  scale?: ScenePoint;
  size?: ScenePoint;
  p1?: ScenePoint;
  p2?: ScenePoint;
}

export interface CanvasTransformChange {
  object: Dino.GameObject;
  before: SceneTransformState;
  after: SceneTransformState;
}

export function getCanvasPlacementBaseline(object: Dino.GameObject, placement: CanvasPlacement): SceneTransformState {
  const resize = placement.get('resize');
  const isSprite = object.hasComponent(Dino.SpriteComponent);
  return {
    position: placement.get('drag'),
    rotation: placement.get('rotate')?.x,
    scale: isSprite ? resize : undefined,
    size: isSprite ? undefined : resize,
    p1: placement.get('p1'),
    p2: placement.get('p2'),
  };
}

export function isCanvasTransformProperty(path: string, state: SceneTransformState): boolean {
  const [property] = path.split('.');
  const key = property === 'width' || property === 'height' || property === 'radius' ? 'size' : property;
  return Object.hasOwn(state, key) && state[key as keyof SceneTransformState] !== undefined;
}

function gridNudge(coordinate: number, steps: number, cellSize: number): number {
  if (!steps) return 0;
  const cell = coordinate / cellSize;
  // Treat tiny transform round-off as already on the grid.
  const boundary = steps > 0 ? Math.floor(cell + 1e-9) : Math.ceil(cell - 1e-9);
  return (boundary + steps) * cellSize - coordinate;
}

type SceneKeyEvent = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'>;

export function isSceneFrameShortcut(event: SceneKeyEvent) {
  return event.key.toLowerCase() === 'f' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
}

export function getSceneArrowMovement(event: SceneKeyEvent): ScenePoint | undefined {
  const { key, shiftKey, altKey, ctrlKey, metaKey } = event;
  if (altKey || ctrlKey || metaKey) return;
  const step = shiftKey ? 10 : 1;
  switch (key) {
    case 'ArrowLeft': return { x: -step, y: 0 };
    case 'ArrowRight': return { x: step, y: 0 };
    case 'ArrowUp': return { x: 0, y: -step };
    case 'ArrowDown': return { x: 0, y: step };
  }
}

/** Move the selection in viewport axes while retaining its local transform. */
export function nudgeSceneSelection(event: SceneKeyEvent): boolean {
  const movement = getSceneArrowMovement(event);
  if (!movement) return false;
  if (Dino.Input.isManipulatingObject) return true;
  let { x, y } = movement;
  const { Engine } = Dino;
  const object = Engine.selectedObject;
  if (!object || !(Engine.currentScene?.objects ?? Engine.objects).has(object)) return true;
  const { position, parent, worldPosition } = object.transform;
  const cellSize = Engine.debugPositionGridSize;
  if (cellSize > 0) {
    x = gridNudge(worldPosition.x, x, cellSize);
    y = gridNudge(worldPosition.y, y, cellSize);
  }
  const initial = position.clone();
  if (parent) {
    const { worldRotation, worldScale } = parent;
    const cos = Math.cos(worldRotation);
    const sin = Math.sin(worldRotation);
    const localX = worldScale.x ? (x * cos + y * sin) / worldScale.x : 0;
    y = worldScale.y ? (-x * sin + y * cos) / worldScale.y : 0;
    x = localX;
  }
  if (object instanceof Dino.Line) {
    object.setOrigin(position.x + x, position.y + y);
  } else {
    position.set(position.x + x, position.y + y);
  }
  const current = object.transform.position;
  if (current.x !== initial.x || current.y !== initial.y) {
    Engine.emit('objectManipulated', { object, kind: 'drag', initial });
  }
  return true;
}

export function restoreSceneTransform(object: Dino.GameObject, state: SceneTransformState) {
  if (state.position) {
    const { x, y } = state.position;
    if (object instanceof Dino.Line) object.setOrigin(x, y);
    else object.transform.position.set(x, y);
  }
  if (state.rotation !== undefined) object.transform.rotation = state.rotation;
  if (state.scale) object.transform.scale.set(state.scale.x, state.scale.y);
  if (object instanceof Dino.Line) {
    if (state.p1) object.setEndpoint('p1', state.p1.x, state.p1.y);
    if (state.p2) object.setEndpoint('p2', state.p2.x, state.p2.y);
  }
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
  Text: {
    text: 'New text', colour: '#203148', backgroundColour: '#e8f0fa',
    width: 180, height: 46, fontSize: '25', font: 'Helvetica',
  },
  Line: { length: 96, strokeWidth: 4 },
};

export function getDefaultSceneObjectTag(kind: SceneObjectKind) {
  return `New ${kind.toLowerCase()}`;
}

export function insertSceneObjectCode(item: ScenePointerDragItem, scriptId: string): { tag?: string; sourceId?: string; error?: string } {
  const point = { x: 100, y: 100 };
  const placement: SceneObjectPlacement | undefined = 'asset' in item
    ? getSceneSpritePlacement(item.asset, point, scriptId)
    : { kind: item.kind, tag: getDefaultSceneObjectTag(item.kind), ...point };
  if (!placement) return { error: 'This image needs a reusable URL before it can be added to the script.' };
  window.dispatchEvent(new CustomEvent<SceneObjectPlacement>(sceneObjectCodeEvent, { detail: placement }));
  return placement;
}

/** Source options shared by the Library snippet and the canvas-generated constructor. */
export function getSceneShapeOptionLines(kind: SceneObjectKind, vector = 'Vector2') {
  if (kind === 'Line') {
    const { length, strokeWidth } = sceneObjectDefaults.Line;
    return [`p1: new ${vector}(0, 0)`, `p2: new ${vector}(${length}, 0)`, `width: ${strokeWidth}`, 'visible: true'];
  }
  return Object.entries(sceneObjectDefaults[kind]).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
}

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

export function getSceneSpritePlacement({ tag, image }: SceneImageAsset, { x, y }: ScenePoint,
  scriptId: string, scene?: SceneSource): SceneObjectPlacement | undefined {
  const source = getAssetSource(image.src, scriptId);
  if (!source) return;
  return { kind: 'Sprite', tag: `${tag} sprite`, x, y, scene, asset: { image, source, scale: getSceneSpriteScale(image) } };
}

export function createSceneObject(placement: SceneObjectPlacement) {
  const { kind, tag, x, y, sourceId } = placement;
  const options = { tag, position: new Dino.Vector2(x, y), __sourceId: sourceId };
  switch (kind) {
    case 'Rectangle': return new Dino.Rectangle({ ...options, ...sceneObjectDefaults.Rectangle });
    case 'Circle': return new Dino.Circle({ ...options, ...sceneObjectDefaults.Circle });
    case 'Text': return new Dino.Text({ ...options, ...sceneObjectDefaults.Text });
    case 'Line': return new Dino.Line({
      ...options, p1: new Dino.Vector2(0, 0), p2: new Dino.Vector2(sceneObjectDefaults.Line.length, 0),
      width: sceneObjectDefaults.Line.strokeWidth, visible: true,
    });
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
    case 'Line': return new Dino.Line(props as ConstructorParameters<typeof Dino.Line>[0]);
    case 'Sprite': {
      const img = original.getComponent(Dino.SpriteComponent)?.img;
      if (!img) return;
      const sprite = new Dino.Sprite({ ...props, img } as ConstructorParameters<typeof Dino.Sprite>[0]);
      sprite.play();
      return sprite;
    }
  }
}
