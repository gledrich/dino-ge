import ColliderComponent from '../components/ColliderComponent.js';
import GameObject from '../core/GameObject.js';
import type { TiledTileLayer } from './TiledMap.js';

class TileCollider extends GameObject {}

/**
 * Creates one detached static body per cell with authored collision fixtures.
 * Enable readTileCollision when importing the map, then add the returned bodies
 * to your scene. The bodies snapshot current tile data and world transforms.
 */
export function createTiledColliders(layer: TiledTileLayer): GameObject[] {
  const bodies: GameObject[] = [];
  for (const { tileset, tilemap } of layer.tilemaps) {
    if (!tileset.tileCollision?.size) continue;
    const { worldPosition, worldRotation, worldScale } = tilemap.transform;
    const cos = Math.cos(worldRotation);
    const sin = Math.sin(worldRotation);
    tilemap.data.forEach((row, y) => {
      row.forEach((localId, x) => {
        const fixtures = tileset.tileCollision?.get(localId);
        if (!fixtures?.length) return;
        const body = new TileCollider(`${layer.name} collider (${x}, ${y})`);
        const localX = x * tilemap.tileSize * worldScale.x;
        const localY = y * tilemap.tileSize * worldScale.y;
        body.transform.position.set(
          worldPosition.x + localX * cos - localY * sin,
          worldPosition.y + localX * sin + localY * cos,
        );
        body.transform.scale.copy(worldScale);
        body.transform.rotation = worldRotation;
        body.addComponent(new ColliderComponent(fixtures));
        bodies.push(body);
      });
    });
  }
  return bodies;
}
