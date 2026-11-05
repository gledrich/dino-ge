import type { SceneObjectKind, ScenePoint, ScenePointerDragItem, SceneSource } from './scene-objects';

export type HostedCanvasBounds = ScenePoint & { width: number; height: number };
export type PreparedHostedPlacement = ScenePoint & { handle: string; scene?: SceneSource };

export type HostedPlacementObject =
  | { kind: SceneObjectKind; tag: string; options: Record<string, string | number> }
  | { kind: 'Sprite'; tag: string; image: Blob; scale: number };

export interface HostedPlacementConnection {
  readonly scriptId: string;
  readonly source: string;
  active(): boolean;
  prepare(point: ScenePoint): Promise<PreparedHostedPlacement>;
  create(handle: string, object: HostedPlacementObject): Promise<{ id: string }>;
  finalise(handle: string): Promise<void>;
  cancel(handle: string): void;
  setVisible(handle: string, visible: boolean): void;
}

export const hostedPlacementEvent = 'playground-hosted-placement';
export const hostedShapeDragEvent = 'playground-hosted-shape-drag';
export const hostedAssetDragEvent = 'playground-hosted-asset-drag';
export type HostedPlacementRequest = {
  item: ScenePointerDragItem;
  run: HostedPlacementConnection;
  prepared: PreparedHostedPlacement;
  complete(result: { tag?: string; error?: string }): void;
};
