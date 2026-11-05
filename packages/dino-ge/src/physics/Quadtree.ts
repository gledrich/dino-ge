export interface CollisionBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface CollisionEntry extends CollisionBounds {
  index: number;
}

function overlaps(a: CollisionBounds, b: CollisionBounds): boolean {
  // Narrow-phase centre/radius arithmetic rounds differently from edge arithmetic.
  const xTolerance = Number.EPSILON * 4 * Math.max(1, Math.abs(a.left), Math.abs(a.right),
    Math.abs(b.left), Math.abs(b.right));
  const yTolerance = Number.EPSILON * 4 * Math.max(1, Math.abs(a.top), Math.abs(a.bottom),
    Math.abs(b.top), Math.abs(b.bottom));
  return a.left - b.right <= xTolerance && b.left - a.right <= xTolerance &&
    a.top - b.bottom <= yTolerance && b.top - a.bottom <= yTolerance;
}

/** A per-step index of finite world-space collision bounds. */
export default class Quadtree {
  private readonly children: Quadtree[] = [];
  private readonly entries: CollisionEntry[] = [];

  constructor(private readonly bounds: CollisionBounds, entries: CollisionEntry[], depth = 0) {
    if (entries.length <= 8 || depth === 12) {
      this.entries = entries;
      return;
    }

    const { left, right, top, bottom } = bounds;
    const x = left / 2 + right / 2;
    const y = top / 2 + bottom / 2;
    const splitX = x !== left && x !== right && entries.some(entry => entry.right <= x || entry.left >= x);
    const splitY = y !== top && y !== bottom && entries.some(entry => entry.bottom <= y || entry.top >= y);
    if (!splitX && !splitY) {
      this.entries = entries;
      return;
    }

    const childEntries: CollisionEntry[][] = [[], [], [], []];
    for (const entry of entries) {
      const column = !splitX || entry.right <= x ? 0 : entry.left >= x ? 1 : -1;
      const row = !splitY || entry.bottom <= y ? 0 : entry.top >= y ? 1 : -1;
      if (column === -1 || row === -1) this.entries.push(entry);
      else childEntries[row * 2 + column].push(entry);
    }

    const childBounds = [
      { left, right: splitX ? x : right, top, bottom: splitY ? y : bottom },
      { left: x, right, top, bottom: splitY ? y : bottom },
      { left, right: splitX ? x : right, top: y, bottom },
      { left: x, right, top: y, bottom },
    ];
    childEntries.forEach((group, index) => {
      if (group.length) this.children.push(new Quadtree(childBounds[index], group, depth + 1));
    });
  }

  public insert(entry: CollisionEntry): boolean {
    const { left, right, top, bottom } = this.bounds;
    if (entry.left < left || entry.right > right || entry.top < top || entry.bottom > bottom) return false;
    if (!this.children.some(child => child.insert(entry))) this.entries.push(entry);
    return true;
  }

  public remove(entry: CollisionEntry): boolean {
    if (!overlaps(this.bounds, entry)) return false;
    const index = this.entries.indexOf(entry);
    if (index === -1) return this.children.some(child => child.remove(entry));
    this.entries.splice(index, 1);
    return true;
  }

  public query(bounds: CollisionBounds, after: number, results: number[]): void {
    if (!overlaps(this.bounds, bounds)) return;
    for (const entry of this.entries) {
      if (entry.index > after && overlaps(entry, bounds)) results.push(entry.index);
    }
    for (const child of this.children) child.query(bounds, after, results);
  }
}
