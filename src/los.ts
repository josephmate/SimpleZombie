import { CELL_SIZE } from './LevelLoader';

/**
 * True if the straight line from (x1,y1) to (x2,y2) passes through no wall cell.
 * Uses a grid DDA traversal — O(grid cells crossed).
 */
export function hasLineOfSight(
  x1: number, y1: number,
  x2: number, y2: number,
  wallSet: Set<number>,
): boolean {
  const key = (c: number, r: number) => c * 10000 + r;
  let cx = Math.floor(x1 / CELL_SIZE), cy = Math.floor(y1 / CELL_SIZE);
  const endCX = Math.floor(x2 / CELL_SIZE), endCY = Math.floor(y2 / CELL_SIZE);
  if (wallSet.has(key(cx, cy)) || wallSet.has(key(endCX, endCY))) return false;
  if (cx === endCX && cy === endCY) return true;
  const dx = x2 - x1, dy = y2 - y1;
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
  const tDX = dx !== 0 ? Math.abs(CELL_SIZE / dx) : Infinity;
  const tDY = dy !== 0 ? Math.abs(CELL_SIZE / dy) : Infinity;
  let tX = dx > 0 ? ((cx + 1) * CELL_SIZE - x1) / dx
          : dx < 0 ? (cx * CELL_SIZE - x1) / dx
          : Infinity;
  let tY = dy > 0 ? ((cy + 1) * CELL_SIZE - y1) / dy
          : dy < 0 ? (cy * CELL_SIZE - y1) / dy
          : Infinity;
  for (let step = 0; step < 400; step++) {
    if (tX < tY) { cx += stepX; tX += tDX; }
    else          { cy += stepY; tY += tDY; }
    if (wallSet.has(key(cx, cy))) return false;
    if (cx === endCX && cy === endCY) return true;
  }
  return true;
}
