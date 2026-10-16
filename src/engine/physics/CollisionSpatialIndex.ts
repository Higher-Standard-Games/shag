/** Q3-space conservative collision bounds. Missing constraints stay unculled. */
export type CollisionBounds = [number, number, number, number, number, number];

export function planeBounds(
  planes: ArrayLike<number>,
  first = 0,
  last = planes.length / 4,
  allowPartial = false,
): CollisionBounds | null {
  const bounds: CollisionBounds = [-Infinity, -Infinity, -Infinity, Infinity, Infinity, Infinity];
  for (let i = first; i < last; i++) {
    const n = [planes[i * 4], planes[i * 4 + 1], planes[i * 4 + 2]];
    const dist = planes[i * 4 + 3];
    if (!n.every(Number.isFinite) || !Number.isFinite(dist)) return null;
    for (let axis = 0; axis < 3; axis++) {
      // Only exact axial constraints prove these bounds. Near-axial normals
      // cannot be treated as axial without assumptions about the other axes.
      if (!n[axis] || n[(axis + 1) % 3] !== 0 || n[(axis + 2) % 3] !== 0) continue;
      const limit = (dist + 0.125) / n[axis];
      if (n[axis] > 0) bounds[axis + 3] = Math.min(bounds[axis + 3], limit);
      else bounds[axis] = Math.max(bounds[axis], limit);
    }
  }
  const valid = bounds.slice(0, 3).every((v, i) => v <= bounds[i + 3]);
  const constrained = allowPartial ? bounds.some(Number.isFinite) : bounds.every(Number.isFinite);
  return valid && constrained ? bounds : null;
}

export function boundsOverlap(a: CollisionBounds, b: CollisionBounds): boolean {
  return a[0] <= b[3] && a[3] >= b[0] && a[1] <= b[4] && a[4] >= b[1] && a[2] <= b[5] && a[5] >= b[2];
}

export interface CollisionBoundItem {
  id: number;
  bounds: CollisionBounds | null;
}
interface Node {
  bounds: CollisionBounds;
  left?: Node;
  right?: Node;
  items?: CollisionBoundItem[];
}

/** Finite partition anchor for full boxes and half-infinite slabs alike. */
function splitPosition(bounds: CollisionBounds, axis: number): number {
  const low = bounds[axis],
    high = bounds[axis + 3];
  if (Number.isFinite(low)) return Number.isFinite(high) ? low / 2 + high / 2 : low;
  return Number.isFinite(high) ? high : 0;
}

/** Static median-split BVH. Results retain source order for equal-time contacts. */
export class CollisionSpatialIndex {
  private root?: Node;
  private readonly unbounded: number[];
  constructor(items: CollisionBoundItem[]) {
    this.unbounded = items.filter((item) => !item.bounds).map((item) => item.id);
    const build = (entries: CollisionBoundItem[]): Node | undefined => {
      if (!entries.length) return undefined;
      const bounds: CollisionBounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (const entry of entries)
        for (let j = 0; j < 3; j++) {
          bounds[j] = Math.min(bounds[j], entry.bounds![j]);
          bounds[j + 3] = Math.max(bounds[j + 3], entry.bounds![j + 3]);
        }
      if (entries.length <= 8) return { bounds, items: entries };
      let axis = 0;
      let widest = -1;
      for (let j = 0; j < 3; j++) {
        let low = Infinity,
          high = -Infinity;
        for (const entry of entries) {
          const anchor = splitPosition(entry.bounds!, j);
          low = Math.min(low, anchor);
          high = Math.max(high, anchor);
        }
        if (high - low > widest) {
          widest = high - low;
          axis = j;
        }
      }
      entries.sort((a, b) => splitPosition(a.bounds!, axis) - splitPosition(b.bounds!, axis) || a.id - b.id);
      const mid = entries.length >>> 1;
      return { bounds, left: build(entries.slice(0, mid)), right: build(entries.slice(mid)) };
    };
    this.root = build(items.filter((item) => item.bounds));
  }
  query(bounds: CollisionBounds): number[] {
    const result = [...this.unbounded];
    const visit = (node?: Node) => {
      if (!node || !boundsOverlap(bounds, node.bounds)) return;
      if (node.items) {
        for (const item of node.items) if (boundsOverlap(bounds, item.bounds!)) result.push(item.id);
      } else {
        visit(node.left);
        visit(node.right);
      }
    };
    visit(this.root);
    return result.sort((a, b) => a - b);
  }
}
