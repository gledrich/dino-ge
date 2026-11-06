import { snapToGrid } from 'dino-ge';

// Keep an untouched axis fixed even when its starting coordinate is off-grid.
export function snapScreenUIDelta(origin: number, delta: number, gridSize: number) {
  return gridSize && delta ? snapToGrid(origin + delta, gridSize) - origin : delta;
}
