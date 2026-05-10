import {
  Engine,
  DisplayMode,
  Color,
  Actor,
  Circle,
  PolygonCollider,
  Vector,
  Scene,
  Keys,
  Canvas,
  GraphicsGroup,
} from 'excalibur';
import nipplejs from 'nipplejs';

// ── Mobile detection & joystick state ────────────────────────────────────────
const IS_MOBILE = window.matchMedia('(pointer: coarse)').matches;
let joystickDx = 0;
let joystickDy = 0;

if (IS_MOBILE) {
  const zone = document.getElementById('joystick-zone') as HTMLElement;
  const manager = nipplejs.create({
    zone,
    mode: 'static',
    position: { left: '50%', top: '50%' },
    color: 'white',
    size: 100,
  });
  manager.on('move', (evt) => {
    const v = evt.data.vector;
    joystickDx = v.x;
    joystickDy = -v.y; // nipplejs y is inverted vs screen
  });
  manager.on('end', () => {
    joystickDx = 0;
    joystickDy = 0;
  });
}

// ── Constants ──────────────────────────────────────────────────────────────────
const GRID_W = 1200;
const GRID_H = 900;
const PLAYER_SPEED = 3.5;
const ZOMBIE_ALERT_DIST = 200;       // px: zombie chases player when closer than this
const ZOMBIE_MAX_SPEED = 2.2;
const ZOMBIE_ACCEL = 0.12;
const HUMAN_MAX_SPEED = 2.0;
const HUMAN_MIN_SPEED = 0.8;
const INFECT_DIST_SQ = 20 * 20;     // zombie infects human when this close
const ZOMBIE_DAMAGE_DIST_SQ = 16 * 16;

const NUM_ZOMBIES = 20;
const NUM_CIVILIANS = 30;

const ZOMBIE_RADIUS = 10;
const PLAYER_RADIUS = 12;
const CIVILIAN_RADIUS = 9;

// ── Colours ───────────────────────────────────────────────────────────────────
const BG_COLOR       = Color.fromHex('#d0d0d0'); // light gray background
const ZOMBIE_COLOR   = Color.fromRGB(144, 238, 144); // pale green
const CIVILIAN_COLOR = Color.fromRGB(80, 80, 80); // dark grey
const PLAYER_COLOR   = Color.fromRGB(60, 100, 230);  // blue

// ── Helpers ───────────────────────────────────────────────────────────────────
function randFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}
function randPos(): { x: number; y: number } {
  return { x: randFloat(20, GRID_W - 20), y: randFloat(20, GRID_H - 20) };
}
function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}
function atan2Approx(dy: number, dx: number): number {
  return Math.atan2(dy, dx);
}
/** Clamp a to [-PI, PI] */
function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
/** Keep position inside the grid */
function clampToGrid(x: number, y: number): { x: number; y: number } {
  return {
    x: clamp(x, 0, GRID_W),
    y: clamp(y, 0, GRID_H),
  };
}

// ── Star polygon points for the player ───────────────────────────────────────
function starPoints(cx: number, cy: number, outer: number, inner: number, n: number): Vector[] {
  const pts: Vector[] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const angle = (i * Math.PI) / n - Math.PI / 2;
    pts.push(new Vector(cx + r * Math.cos(angle), cy + r * Math.sin(angle)));
  }
  return pts;
}

// ── Entity types ──────────────────────────────────────────────────────────────
interface Being {
  x: number;
  y: number;
  angle: number; // heading in radians (atan2 convention: angle of velocity)
  speed: number;
  type: 'zombie' | 'human';
  actor: Actor;
  pendingInfect?: boolean;
}

// ── Game setup ────────────────────────────────────────────────────────────────
const game = new Engine({
  width: GRID_W,
  height: GRID_H,
  displayMode: DisplayMode.FitScreen,
  backgroundColor: BG_COLOR,
});

// Player actor (blue star drawn via Canvas)
const playerActor = new Actor({ x: 0, y: 0, z: 10 });
const playerCanvas = new Canvas({
  width: PLAYER_RADIUS * 4,
  height: PLAYER_RADIUS * 4,
  draw(ctx) {
    ctx.beginPath();
    const pts = starPoints(PLAYER_RADIUS * 2, PLAYER_RADIUS * 2, PLAYER_RADIUS, PLAYER_RADIUS * 0.45, 5);
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fillStyle = `rgb(${PLAYER_COLOR.r},${PLAYER_COLOR.g},${PLAYER_COLOR.b})`;
    ctx.fill();
  },
  cache: true,
});
playerActor.graphics.use(playerCanvas);

const playerPos = randPos();
let playerX = playerPos.x;
let playerY = playerPos.y;
playerActor.pos = new Vector(playerX, playerY);

// Beings array (zombies + civilians)
const beings: Being[] = [];

function makeBeing(type: 'zombie' | 'human', x: number, y: number): Being {
  const color = type === 'zombie' ? ZOMBIE_COLOR : CIVILIAN_COLOR;
  const radius = type === 'zombie' ? ZOMBIE_RADIUS : CIVILIAN_RADIUS;
  const actor = new Actor({ x, y, z: type === 'zombie' ? 5 : 3 });
  actor.graphics.use(new Circle({ radius, color }));
  return {
    x, y,
    angle: Math.random() * Math.PI * 2,
    speed: type === 'zombie' ? ZOMBIE_MAX_SPEED * 0.5 : HUMAN_MIN_SPEED,
    type,
    actor,
  };
}

for (let i = 0; i < NUM_ZOMBIES; i++) {
  const p = randPos();
  beings.push(makeBeing('zombie', p.x, p.y));
}
for (let i = 0; i < NUM_CIVILIANS; i++) {
  const p = randPos();
  beings.push(makeBeing('human', p.x, p.y));
}

// ── Scene ─────────────────────────────────────────────────────────────────────
game.start().then(() => {
  const scene = game.currentScene;

  scene.add(playerActor);
  for (const b of beings) scene.add(b.actor);

  // ── Update loop ──────────────────────────────────────────────────────────
  scene.onPreUpdate = (_eng, _delta) => {
    // ── Player movement (WASD on desktop, nipplejs on mobile) ───────────────
    let pdx = 0, pdy = 0;
    if (IS_MOBILE) {
      pdx = joystickDx * PLAYER_SPEED;
      pdy = joystickDy * PLAYER_SPEED;
    } else {
      if (game.input.keyboard.isHeld(Keys.W)) pdy -= PLAYER_SPEED;
      if (game.input.keyboard.isHeld(Keys.S)) pdy += PLAYER_SPEED;
      if (game.input.keyboard.isHeld(Keys.A)) pdx -= PLAYER_SPEED;
      if (game.input.keyboard.isHeld(Keys.D)) pdx += PLAYER_SPEED;
    }
    playerX = clamp(playerX + pdx, 0, GRID_W);
    playerY = clamp(playerY + pdy, 0, GRID_H);
    playerActor.pos = new Vector(playerX, playerY);

    // ── Beings to remove ────────────────────────────────────────────────────
    const toRemove: number[] = [];

    for (let i = 0; i < beings.length; i++) {
      const b = beings[i];

      if (b.type === 'zombie') {
        // ── Zombie movement (from zombie4 zombie.move()) ──────────────────
        const dpx = playerX - b.x;
        const dpy = playerY - b.y;
        const dPlayer2 = dpx * dpx + dpy * dpy;

        if (dPlayer2 < ZOMBIE_ALERT_DIST * ZOMBIE_ALERT_DIST) {
          // Chase player
          const targetAngle = Math.atan2(dpy, dpx) + randFloat(-0.2, 0.2);
          let diff = wrapAngle(targetAngle - b.angle);
          diff = clamp(diff, -0.1, 0.1);
          b.angle = wrapAngle(b.angle + diff);

          // Damage player if very close (handled conceptually - no HP display)
        } else {
          // Hunt nearest human
          let bestDist2 = 800000;
          let bestIdx = -1;
          for (let j = 0; j < beings.length; j++) {
            if (j !== i && beings[j].type === 'human') {
              const d2 = dist2(b.x, b.y, beings[j].x, beings[j].y);
              if (d2 < bestDist2) {
                bestDist2 = d2;
                bestIdx = j;
              }
            }
          }

          if (bestIdx >= 0) {
            const targetAngle = Math.atan2(beings[bestIdx].y - b.y, beings[bestIdx].x - b.x) + randFloat(-0.2, 0.2);
            let diff = wrapAngle(targetAngle - b.angle);
            diff = clamp(diff, -0.1, 0.1);
            b.angle = wrapAngle(b.angle + diff);

            // Infect human if close enough
            if (bestDist2 < INFECT_DIST_SQ) {
              beings[bestIdx].pendingInfect = true;
              b.speed = 0;
            }
          } else {
            // Wander
            b.angle = wrapAngle(b.angle + randFloat(-0.1, 0.1));
          }
        }

        // Small random wobble
        b.angle = wrapAngle(b.angle + randFloat(-0.01, 0.01));

        // Accelerate toward maxSpeed
        if (b.speed < ZOMBIE_MAX_SPEED) {
          b.speed = Math.min(b.speed + ZOMBIE_ACCEL, ZOMBIE_MAX_SPEED);
        } else {
          b.speed += randFloat(-0.1, ZOMBIE_ACCEL);
          b.speed = clamp(b.speed, 0.7, ZOMBIE_MAX_SPEED);
        }

        const vx = b.speed * Math.cos(b.angle);
        const vy = b.speed * Math.sin(b.angle);
        b.x = clamp(b.x + vx, 0, GRID_W);
        b.y = clamp(b.y + vy, 0, GRID_H);

      } else {
        // ── Human (civilian) movement (from zombie4 human.move()) ─────────
        // Find nearest zombie and flee from it
        let bestDist2 = 800000;
        let bestIdx = -1;
        for (let j = 0; j < beings.length; j++) {
          if (beings[j].type === 'zombie') {
            const d2 = dist2(b.x, b.y, beings[j].x, beings[j].y);
            if (d2 < bestDist2) {
              bestDist2 = d2;
              bestIdx = j;
            }
          }
        }

        // 360000 = 600^2 — flee if zombie within 600px (zombie4 used 360000 threshold)
        if (bestIdx >= 0 && bestDist2 < 360000) {
          // Flee: angle AWAY from zombie (+PI)
          const fleeAngle = Math.atan2(b.y - beings[bestIdx].y, b.x - beings[bestIdx].x);
          let diff = wrapAngle(fleeAngle - b.angle);
          diff = clamp(diff, -0.3, 0.3);
          b.angle = wrapAngle(b.angle + diff);
          b.angle = wrapAngle(b.angle + randFloat(-0.2, 0.2));
        } else {
          // Wander randomly
          b.angle = wrapAngle(b.angle + randFloat(-0.3, 0.3));
        }

        b.speed += randFloat(-0.1, 0.1);
        b.speed = clamp(b.speed, HUMAN_MIN_SPEED, HUMAN_MAX_SPEED);

        const vx = b.speed * Math.cos(b.angle);
        const vy = b.speed * Math.sin(b.angle);
        b.x = clamp(b.x + vx, 0, GRID_W);
        b.y = clamp(b.y + vy, 0, GRID_H);
      }

      b.actor.pos = new Vector(b.x, b.y);
    }

    // ── Handle infections (convert humans to zombies) ─────────────────────
    for (let i = beings.length - 1; i >= 0; i--) {
      if (beings[i].pendingInfect) {
        const old = beings[i];
        old.actor.kill();
        const newZombie = makeBeing('zombie', old.x, old.y);
        newZombie.speed = 0;
        beings[i] = newZombie;
        scene.add(newZombie.actor);
      }
    }
  };
});
