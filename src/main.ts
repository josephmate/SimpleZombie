/// <reference types="vite/client" />
import {
  Engine,
  DisplayMode,
  Color,
  Actor,
  Circle,
  Vector,
  Canvas,
} from 'excalibur';
import { InputHandler, IS_MOBILE } from './InputHandler';
import { HudDisplay } from './HudDisplay';
import { LevelLoader, LevelData, CELL_SIZE } from './LevelLoader';
import { WeaponHandler } from './WeaponHandler';

// ── Bullet system ─────────────────────────────────────────────────────────────
const BULLET_LIFETIME   = 60;   // frames before bullet expires

// Weapon sub-system — gun configs, ammo, recoil and switching
const weaponHandler = new WeaponHandler(['pistol']);

// ── Corpse system ─────────────────────────────────────────────────────────────
const BEING_MAX_HP      = 100;
const CORPSE_SIZE       = 14;   // square side length
const CORPSE_VEL_DECAY = 0.80; // how fast corpse slide velocity damps
const CORPSE_SLOW       = 0.35; // speed multiplier when moving over a corpse

interface Corpse {
  x: number;
  y: number;
  vx: number; // slide velocity from bullet impact
  vy: number;
  color: string;
}

const corpses: Corpse[] = [];

// ── Wall system ───────────────────────────────────────────────────────────────
// CELL_SIZE imported from LevelLoader
const WALL_COLOR_STR = '#8B4513'; // saddle brown

interface Wall { col: number; row: number; }
const walls: Wall[] = [];
const wallSet = new Set<number>();

function wallKey(c: number, r: number): number { return c * 10000 + r; }
function isWallCell(c: number, r: number): boolean { return wallSet.has(wallKey(c, r)); }

/** True if a circle at (px,py) with given radius overlaps any wall cell. */
function circleOverlapsWall(px: number, py: number, radius: number): boolean {
  const c0 = Math.floor((px - radius) / CELL_SIZE);
  const c1 = Math.floor((px + radius) / CELL_SIZE);
  const r0 = Math.floor((py - radius) / CELL_SIZE);
  const r1 = Math.floor((py + radius) / CELL_SIZE);
  for (let c = c0; c <= c1; c++) {
    for (let r = r0; r <= r1; r++) {
      if (!isWallCell(c, r)) continue;
      const wx = c * CELL_SIZE, wy = r * CELL_SIZE;
      const nearX = clamp(px, wx, wx + CELL_SIZE);
      const nearY = clamp(py, wy, wy + CELL_SIZE);
      const dx = px - nearX, dy = py - nearY;
      if (dx * dx + dy * dy < radius * radius) return true;
    }
  }
  return false;
}

/** True if the point (px,py) sits inside a wall cell. */
function pointInWall(px: number, py: number): boolean {
  return isWallCell(Math.floor(px / CELL_SIZE), Math.floor(py / CELL_SIZE));
}

/** True if a circle at (px,py) with given radius overlaps any corpse square. */
function circleOverlapsCorpse(px: number, py: number, radius: number): boolean {
  const half = CORPSE_SIZE / 2;
  for (const co of corpses) {
    const nearX = clamp(px, co.x - half, co.x + half);
    const nearY = clamp(py, co.y - half, co.y + half);
    const dx = px - nearX, dy = py - nearY;
    if (dx * dx + dy * dy < radius * radius) return true;
  }
  return false;
}

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  actor: Actor;
  damage: number;
}

const bullets: Bullet[] = [];
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

const ZOMBIE_RADIUS = 10;
const PLAYER_RADIUS = 12;
const CIVILIAN_RADIUS = 9;

// ── Colours ───────────────────────────────────────────────────────────────────
const BG_COLOR       = Color.fromHex('#d0d0d0'); // light gray background
const ZOMBIE_COLOR   = Color.fromRGB(144, 238, 144); // pale green
const CIVILIAN_COLOR = Color.fromRGB(80, 80, 80); // dark grey
const PLAYER_COLOR   = Color.fromRGB(60, 100, 230);  // blue
const ZOMBIE_COLOR_STR   = 'rgb(144,238,144)';
const CIVILIAN_COLOR_STR = 'rgb(80,80,80)';

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
  hp: number;
  pendingInfect?: boolean;
}

// ── Game setup ────────────────────────────────────────────────────────────────
const game = new Engine({
  width: GRID_W,
  height: GRID_H,
  displayMode: DisplayMode.FitScreen,
  backgroundColor: BG_COLOR,
  // Cap pixel ratio to 1 on mobile — phones have 2x/3x DPR which makes the
  // backing canvas 4–9× larger, killing fill-rate performance.
  pixelRatio: IS_MOBILE ? 1 : Math.min(window.devicePixelRatio, 2),
});

const inputHandler = new InputHandler(game);

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
  return {
    x, y,
    angle: Math.random() * Math.PI * 2,
    speed: type === 'zombie' ? ZOMBIE_MAX_SPEED * 0.5 : HUMAN_MIN_SPEED,
    hp: BEING_MAX_HP,
    type,
  };
}

function makeCorpse(x: number, y: number, colorStr: string): Corpse {
  return { x, y, vx: 0, vy: 0, color: colorStr };
}

function killBeing(beings: Being[], idx: number): Corpse {
  const be = beings[idx];
  const colorStr = be.type === 'zombie' ? ZOMBIE_COLOR_STR : CIVILIAN_COLOR_STR;
  beings.splice(idx, 1);
  return makeCorpse(be.x, be.y, colorStr);
}

// ── Level loading ─────────────────────────────────────────────────────────────
const levelLoader = new LevelLoader();

// ── Level-select screen ────────────────────────────────────────────────────────────
function buildLevelSelect(): void {
  const levelsGrid = document.getElementById('levels-grid');
  if (!levelsGrid) return;
  levelsGrid.innerHTML = '';
  levelLoader.getAllLevels().forEach(summary => {
    const btn = document.createElement('button');
    btn.innerHTML =
      `<span class="lvl-num">${summary.name}</span>` +
      `<span class="lvl-info">\u{1F9DF} ${summary.zombieCount}<br>\u{1F6B6} ${summary.civilianCount}</span>`;
    btn.onclick = () => {
      const overlay = document.getElementById('level-select');
      if (overlay) overlay.style.display = 'none';
      (window as any).__startLevel(summary.id);
    };
    levelsGrid.appendChild(btn);
  });
}

// ── Level start ───────────────────────────────────────────────────────────────
function startLevel(level: number): void {
  // Clear previous state
  beings.length = 0;
  corpses.length = 0;
  for (const b of bullets) b.actor.kill();
  bullets.length = 0;
  weaponHandler.reset(['pistol']);
  walls.length = 0;
  wallSet.clear();

  const levelData: LevelData = levelLoader.getLevel(level);

  for (const w of levelData.walls) {
    walls.push(w);
    wallSet.add(wallKey(w.col, w.row));
  }
  for (const s of levelData.beings) {
    beings.push(makeBeing(s.type, s.x, s.y));
  }
  for (const s of levelData.corpses) {
    corpses.push(makeCorpse(s.x, s.y, s.color));
  }

  if (levelData.playerStart) {
    playerX = levelData.playerStart.x; playerY = levelData.playerStart.y;
  } else {
    playerX = GRID_W / 2; playerY = GRID_H / 2;
  }
  playerActor.pos.x = playerX; playerActor.pos.y = playerY;


// ── Scene ─────────────────────────────────────────────────────────────────────
game.start().then(() => {
  const scene = game.currentScene;

  inputHandler.setupPointers();

  scene.add(playerActor);

  // ── Wall canvas (static geometry, redraws each frame from walls[]) ─────────
  const wallActor = new Actor({ x: GRID_W / 2, y: GRID_H / 2, z: 1 });
  const wallCanvas = new Canvas({
    width: GRID_W,
    height: GRID_H,
    cache: false,
    draw(ctx) {
      ctx.clearRect(0, 0, GRID_W, GRID_H);
      ctx.fillStyle = WALL_COLOR_STR;
      for (const w of walls) {
        ctx.fillRect(w.col * CELL_SIZE, w.row * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      }
    },
  });
  wallActor.graphics.use(wallCanvas);
  scene.add(wallActor);

  // ── Beings+corpses canvas (one actor replaces 50+ individual actors) ───────
  const beingsActor = new Actor({ x: GRID_W / 2, y: GRID_H / 2, z: 3 });
  const beingsCanvas = new Canvas({
    width: GRID_W,
    height: GRID_H,
    cache: false,
    draw(ctx) {
      ctx.clearRect(0, 0, GRID_W, GRID_H);
      for (const co of corpses) {
        ctx.fillStyle = co.color;
        ctx.fillRect(co.x - CORPSE_SIZE / 2, co.y - CORPSE_SIZE / 2, CORPSE_SIZE, CORPSE_SIZE);
      }
      for (const b of beings) {
        ctx.fillStyle = b.type === 'zombie' ? ZOMBIE_COLOR_STR : CIVILIAN_COLOR_STR;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.type === 'zombie' ? ZOMBIE_RADIUS : CIVILIAN_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  });
  beingsActor.graphics.use(beingsCanvas);
  scene.add(beingsActor);

  // ── Bullet helper ──────────────────────────────────────────────────────────
  const removeBullet = (i: number) => {
    bullets[i].actor.kill();
    bullets.splice(i, 1);
  };

  const AI_THROTTLE = IS_MOBILE ? 2 : 1;
  let aiFrame = 0;

  // ── HUD canvas (ammo display) ─────────────────────────────────────────────
  const hud = new HudDisplay(scene, GRID_H, weaponHandler.state);

  // ── Update loop ──────────────────────────────────────────────────────────
  scene.onPreUpdate = (_eng, _delta) => {
    // ── Player movement ──────────────────────────────────────────────────────────────────
    const inputs = inputHandler.getInputs(playerX, playerY);
    const playerSlow = circleOverlapsCorpse(playerX, playerY, PLAYER_RADIUS) ? CORPSE_SLOW : 1;
    const pdx = inputs.dx * PLAYER_SPEED * playerSlow;
    const pdy = inputs.dy * PLAYER_SPEED * playerSlow;
    {
      const nx = clamp(playerX + pdx, 0, GRID_W);
      const ny = clamp(playerY + pdy, 0, GRID_H);
      if (!circleOverlapsWall(nx, ny, PLAYER_RADIUS)) {
        playerX = nx; playerY = ny;
      } else {
        // Try sliding along each axis separately
        const nx2 = clamp(playerX + pdx, 0, GRID_W);
        if (!circleOverlapsWall(nx2, playerY, PLAYER_RADIUS)) playerX = nx2;
        const ny2 = clamp(playerY + pdy, 0, GRID_H);
        if (!circleOverlapsWall(playerX, ny2, PLAYER_RADIUS)) playerY = ny2;
      }
    }
    playerActor.pos.x = playerX;
    playerActor.pos.y = playerY;

    // ── Keep HUD pinned to bottom-left of viewport ────────────────────────
    const cam = scene.camera;
    const vp = cam.viewport;
    hud.pinToViewport(vp.left, vp.bottom);

    // ── Shooting ──────────────────────────────────────────────────────────────
    const spawns = weaponHandler.update(
      inputs.isShooting,
      inputs.reloadRequested,
      playerX, playerY,
      inputs.shootDx, inputs.shootDy,
      randFloat,
    );
    for (const req of spawns) {
      const bActor = new Actor({ x: req.x, y: req.y, z: 8 });
      bActor.graphics.use(new Circle({ radius: 2, color: Color.fromHex('#2a1a0a') }));
      scene.add(bActor);
      bullets.push({ x: req.x, y: req.y, vx: req.vx, vy: req.vy, age: 0, damage: req.damage, actor: bActor });
    }

    // ── Bullet movement + hit detection ───────────────────────────────────────
    for (let i = bullets.length - 1; i >= 0; i--) {
      const bul = bullets[i];
      bul.x += bul.vx;
      bul.y += bul.vy;
      bul.age++;
      bul.actor.pos.x = bul.x;
      bul.actor.pos.y = bul.y;

      // Remove if out of bounds, expired, or hit a wall
      if (bul.age >= BULLET_LIFETIME ||
          bul.x < 0 || bul.x > GRID_W ||
          bul.y < 0 || bul.y > GRID_H ||
          pointInWall(bul.x, bul.y)) {
        removeBullet(i);
        continue;
      }

      // Check hit against beings (zombies and civilians)
      let hit = false;
      for (let j = beings.length - 1; j >= 0; j--) {
        const be = beings[j];
        const HIT_R = (be.type === 'zombie' ? ZOMBIE_RADIUS : CIVILIAN_RADIUS) + 4;
        if (dist2(bul.x, bul.y, be.x, be.y) < HIT_R * HIT_R ||
            dist2(bul.x - bul.vx / 2, bul.y - bul.vy / 2, be.x, be.y) < HIT_R * HIT_R) {
          be.hp -= bul.damage;
          removeBullet(i);
          hit = true;
          if (be.hp <= 0) {
            corpses.push(killBeing(beings, j));
          }
          break;
        }
      }
      if (hit) continue;

      // Check hit against corpses (bullets stop on corpses)
      for (let j = corpses.length - 1; j >= 0; j--) {
        const co = corpses[j];
        const half = CORPSE_SIZE / 2;
        if (bul.x >= co.x - half && bul.x <= co.x + half &&
            bul.y >= co.y - half && bul.y <= co.y + half) {
          // Jiggle the corpse slightly in the bullet's direction
          co.vx += bul.vx * 0.4;
          co.vy += bul.vy * 0.4;
          removeBullet(i);
          hit = true;
          break;
        }
      }
      if (hit) continue;
    }


    // ── Beings update (AI runs every AI_THROTTLE frames; movement every frame) ─
    aiFrame++;
    const runAI = (aiFrame % AI_THROTTLE === 0);
    for (let i = 0; i < beings.length; i++) {
      const b = beings[i];

      if (runAI) {
        if (b.type === 'zombie') {
          // ── Zombie AI ──────────────────────────────────────────────────
          const dpx = playerX - b.x;
          const dpy = playerY - b.y;
          const dPlayer2 = dpx * dpx + dpy * dpy;

          if (dPlayer2 < ZOMBIE_ALERT_DIST * ZOMBIE_ALERT_DIST) {
            // Chase player
            const targetAngle = Math.atan2(dpy, dpx) + randFloat(-0.2, 0.2);
            let diff = wrapAngle(targetAngle - b.angle);
            diff = clamp(diff, -0.1, 0.1);
            b.angle = wrapAngle(b.angle + diff);
          } else {
            // Hunt nearest human
            let bestDist2 = 800000;
            let bestIdx = -1;
            for (let j = 0; j < beings.length; j++) {
              if (j !== i && beings[j].type === 'human') {
                const d2 = dist2(b.x, b.y, beings[j].x, beings[j].y);
                if (d2 < bestDist2) { bestDist2 = d2; bestIdx = j; }
              }
            }
            if (bestIdx >= 0) {
              const targetAngle = Math.atan2(beings[bestIdx].y - b.y, beings[bestIdx].x - b.x) + randFloat(-0.2, 0.2);
              let diff = wrapAngle(targetAngle - b.angle);
              diff = clamp(diff, -0.1, 0.1);
              b.angle = wrapAngle(b.angle + diff);
              if (bestDist2 < INFECT_DIST_SQ) {
                beings[bestIdx].pendingInfect = true;
                b.speed = 0;
              }
            } else {
              b.angle = wrapAngle(b.angle + randFloat(-0.1, 0.1));
            }
          }

          b.angle = wrapAngle(b.angle + randFloat(-0.01, 0.01));
          if (b.speed < ZOMBIE_MAX_SPEED) {
            b.speed = Math.min(b.speed + ZOMBIE_ACCEL, ZOMBIE_MAX_SPEED);
          } else {
            b.speed += randFloat(-0.1, ZOMBIE_ACCEL);
            b.speed = clamp(b.speed, 0.7, ZOMBIE_MAX_SPEED);
          }

        } else {
          // ── Human AI ───────────────────────────────────────────────────
          let bestDist2 = 800000;
          let bestIdx = -1;
          for (let j = 0; j < beings.length; j++) {
            if (beings[j].type === 'zombie') {
              const d2 = dist2(b.x, b.y, beings[j].x, beings[j].y);
              if (d2 < bestDist2) { bestDist2 = d2; bestIdx = j; }
            }
          }
          if (bestIdx >= 0 && bestDist2 < 360000) {
            const fleeAngle = Math.atan2(b.y - beings[bestIdx].y, b.x - beings[bestIdx].x);
            let diff = wrapAngle(fleeAngle - b.angle);
            diff = clamp(diff, -0.3, 0.3);
            b.angle = wrapAngle(b.angle + diff);
            b.angle = wrapAngle(b.angle + randFloat(-0.2, 0.2));
          } else {
            b.angle = wrapAngle(b.angle + randFloat(-0.3, 0.3));
          }
          b.speed += randFloat(-0.1, 0.1);
          b.speed = clamp(b.speed, HUMAN_MIN_SPEED, HUMAN_MAX_SPEED);
        }
      }

      // Always apply velocity (with wall collision)
      const brad = b.type === 'zombie' ? ZOMBIE_RADIUS : CIVILIAN_RADIUS;
      const beingSlow = circleOverlapsCorpse(b.x, b.y, brad) ? CORPSE_SLOW : 1;
      const vx = b.speed * Math.cos(b.angle) * beingSlow;
      const vy = b.speed * Math.sin(b.angle) * beingSlow;
      const nx = clamp(b.x + vx, 0, GRID_W);
      const ny = clamp(b.y + vy, 0, GRID_H);
      if (!circleOverlapsWall(nx, ny, brad)) {
        b.x = nx; b.y = ny;
      } else {
        // Try sliding; if still blocked, reverse heading
        if (!circleOverlapsWall(nx, b.y, brad)) { b.x = nx; }
        else if (!circleOverlapsWall(b.x, ny, brad)) { b.y = ny; }
        else { b.angle = wrapAngle(b.angle + Math.PI + randFloat(-0.5, 0.5)); }
      }
    }

    // ── Handle infections (convert humans to zombies) ─────────────────────
    for (let i = beings.length - 1; i >= 0; i--) {
      if (beings[i].pendingInfect) {
        const old = beings[i];
        const newZombie = makeBeing('zombie', old.x, old.y);
        newZombie.speed = 0;
        beings[i] = newZombie;
      }
    }

    // ── Corpse jiggle update ──────────────────────────────────────────────
    for (const co of corpses) {
      co.x += co.vx;
      co.y += co.vy;
      co.vx *= CORPSE_VEL_DECAY;
      co.vy *= CORPSE_VEL_DECAY;
    }
  };
});
}

// ── Bootstrap: load levels then wire up the game ────────────────────────────────
(async () => {
  const base = import.meta.env.BASE_URL; // '/SimpleZombie/' in both dev and prod
  await levelLoader.load(base);
  buildLevelSelect();
  (window as any).__startLevel = startLevel;
})();
