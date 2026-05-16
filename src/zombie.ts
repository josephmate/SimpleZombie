// ── Zombie AI ─────────────────────────────────────────────────────────────────
import { hasLineOfSight } from './los';

export interface EntityPos { x: number; y: number; }

export interface ZombieMoveResult {
  angle: number;
  speed: number;
  /** Desired position before collision resolution. */
  desiredX: number;
  desiredY: number;
  /** Index into the civilians[] array passed in, -1 if no infection this tick. */
  infectCivilianIdx: number;
}

// Constants – exported so main.ts can use them for drawing / hit-detection
export const ZOMBIE_RADIUS    = 10;
export const ZOMBIE_MAX_SPEED = 2.2;

const ZOMBIE_ALERT_DIST = 50;   // px: detect without line-of-sight
const ZOMBIE_LOS_DIST   = 500;  // px: detect with line-of-sight
const ZOMBIE_ACCEL      = 0.12;
const INFECT_DIST_SQ    = 20 * 20;
const REPULSE_RADIUS    = ZOMBIE_RADIUS * 2.5; // ~25 px
const REPULSE_R2        = REPULSE_RADIUS * REPULSE_RADIUS;
const ALERT_D2          = ZOMBIE_ALERT_DIST * ZOMBIE_ALERT_DIST;
const LOS_D2            = ZOMBIE_LOS_DIST   * ZOMBIE_LOS_DIST;

function wrapAngle(a: number): number {
  while (a >  Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}

/**
 * Compute the zombie's desired next state for one AI tick.
 *
 * @param self       The zombie's current position/angle/speed.
 * @param selfIdx    This zombie's index inside the zombies[] array (used to
 *                   skip self during peer-repulsion).
 * @param zombies    Positions of ALL zombies this frame (including self).
 * @param civilians  Positions of all civilians this frame.
 * @param player     Player position.
 * @param wallSet    The active wall cell set for LOS checks.
 * @param randFloat  Injected RNG.
 */
export function zombieNextMove(
  self: { x: number; y: number; angle: number; speed: number },
  selfIdx: number,
  zombies: EntityPos[],
  civilians: EntityPos[],
  player: EntityPos,
  wallSet: Set<number>,
  randFloat: (min: number, max: number) => number,
): ZombieMoveResult {
  let angle = self.angle;
  let speed = self.speed;
  let infectCivilianIdx = -1;

  // ── Target detection ──────────────────────────────────────────────────────
  const dpx = player.x - self.x, dpy = player.y - self.y;
  const dPlayer2 = dpx * dpx + dpy * dpy;
  const playerDetected = dPlayer2 < ALERT_D2 ||
    (dPlayer2 < LOS_D2 && hasLineOfSight(self.x, self.y, player.x, player.y, wallSet));

  let bestCivDist2 = Infinity, bestCivIdx = -1;
  for (let j = 0; j < civilians.length; j++) {
    const hd2 = dist2(self.x, self.y, civilians[j].x, civilians[j].y);
    if (hd2 < bestCivDist2) {
      const detected = hd2 < ALERT_D2 ||
        (hd2 < LOS_D2 && hasLineOfSight(self.x, self.y, civilians[j].x, civilians[j].y, wallSet));
      if (detected) { bestCivDist2 = hd2; bestCivIdx = j; }
    }
  }

  // ── Steer toward closer detected target ───────────────────────────────────
  if (playerDetected && (bestCivIdx < 0 || dPlayer2 <= bestCivDist2)) {
    const targetAngle = Math.atan2(dpy, dpx) + randFloat(-0.2, 0.2);
    let diff = wrapAngle(targetAngle - angle);
    diff = clamp(diff, -0.1, 0.1);
    angle = wrapAngle(angle + diff);
  } else if (bestCivIdx >= 0) {
    const hx = civilians[bestCivIdx].x, hy = civilians[bestCivIdx].y;
    const targetAngle = Math.atan2(hy - self.y, hx - self.x) + randFloat(-0.2, 0.2);
    let diff = wrapAngle(targetAngle - angle);
    diff = clamp(diff, -0.1, 0.1);
    angle = wrapAngle(angle + diff);
    if (bestCivDist2 < INFECT_DIST_SQ) {
      infectCivilianIdx = bestCivIdx;
      speed = 0;
    }
  } else {
    // No target – wander
    angle = wrapAngle(angle + randFloat(-0.1, 0.1));
  }

  // ── Peer repulsion: nudge away from nearby zombies ────────────────────────
  let repX = 0, repY = 0;
  for (let j = 0; j < zombies.length; j++) {
    if (j === selfIdx) continue;
    const rx = self.x - zombies[j].x;
    const ry = self.y - zombies[j].y;
    const r2 = rx * rx + ry * ry;
    if (r2 > 0 && r2 < REPULSE_R2) {
      const w = 1 - Math.sqrt(r2) / REPULSE_RADIUS;
      repX += rx * w;
      repY += ry * w;
    }
  }
  if (repX !== 0 || repY !== 0) {
    const repAngle = Math.atan2(repY, repX);
    let diff = wrapAngle(repAngle - angle);
    diff = clamp(diff, -0.15, 0.15);
    angle = wrapAngle(angle + diff * 0.4);
  }

  // ── Speed + jitter ────────────────────────────────────────────────────────
  angle = wrapAngle(angle + randFloat(-0.01, 0.01));
  if (infectCivilianIdx < 0) {
    // Only accelerate if not currently infecting
    if (speed < ZOMBIE_MAX_SPEED) {
      speed = Math.min(speed + ZOMBIE_ACCEL, ZOMBIE_MAX_SPEED);
    } else {
      speed += randFloat(-0.1, ZOMBIE_ACCEL);
      speed = clamp(speed, 0.7, ZOMBIE_MAX_SPEED);
    }
  }

  return {
    angle,
    speed,
    desiredX: self.x + speed * Math.cos(angle),
    desiredY: self.y + speed * Math.sin(angle),
    infectCivilianIdx,
  };
}
