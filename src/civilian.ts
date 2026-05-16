// ── Civilian AI ───────────────────────────────────────────────────────────────

export interface EntityPos { x: number; y: number; }

export interface CivilianMoveResult {
  angle: number;
  speed: number;
  /** Desired position before collision resolution. */
  desiredX: number;
  desiredY: number;
}

// Constants – exported so main.ts can use them for drawing / hit-detection
export const CIVILIAN_RADIUS = 9;
export const HUMAN_MIN_SPEED = 0.8;

const HUMAN_MAX_SPEED = 2.0;
const FLEE_DIST_SQ    = 360000; // 600 px – civilian starts fleeing within this range

function wrapAngle(a: number): number {
  while (a >  Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Compute the civilian's desired next state for one AI tick.
 *
 * @param self     The civilian's current position/angle/speed.
 * @param zombies  Positions of all zombies this frame.
 * @param randFloat Injected RNG.
 */
export function civilianNextMove(
  self: { x: number; y: number; angle: number; speed: number },
  zombies: EntityPos[],
  randFloat: (min: number, max: number) => number,
): CivilianMoveResult {
  let angle = self.angle;
  let speed = self.speed;

  // Find nearest zombie
  let bestDist2 = Infinity, bestIdx = -1;
  for (let j = 0; j < zombies.length; j++) {
    const dx = self.x - zombies[j].x, dy = self.y - zombies[j].y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDist2) { bestDist2 = d2; bestIdx = j; }
  }

  if (bestIdx >= 0 && bestDist2 < FLEE_DIST_SQ) {
    // Flee away from nearest zombie
    const fleeAngle = Math.atan2(self.y - zombies[bestIdx].y, self.x - zombies[bestIdx].x);
    let diff = wrapAngle(fleeAngle - angle);
    diff = clamp(diff, -0.3, 0.3);
    angle = wrapAngle(angle + diff);
    angle = wrapAngle(angle + randFloat(-0.2, 0.2));
  } else {
    // Wander randomly
    angle = wrapAngle(angle + randFloat(-0.3, 0.3));
  }

  speed += randFloat(-0.1, 0.1);
  speed = clamp(speed, HUMAN_MIN_SPEED, HUMAN_MAX_SPEED);

  return {
    angle,
    speed,
    desiredX: self.x + speed * Math.cos(angle),
    desiredY: self.y + speed * Math.sin(angle),
  };
}
