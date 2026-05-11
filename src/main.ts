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

// ── Bullet system ─────────────────────────────────────────────────────────────
const BULLET_SPEED      = 14;   // px per frame
const BULLET_LIFETIME   = 60;   // frames before bullet expires
const CLIP_SIZE         = 15;   // rounds per cartridge
const SHOT_DELAY        = 7;    // frames between shots (like zombie4 pistol shotTime=7)
const RELOAD_TIME       = 50;   // frames to reload (like zombie4 pistol reloadTime=30..40)
const RECOIL_GROWTH_SPEED = 7;   // how much fireTime grows per shot
const RECOIL_DECAY_SPEED  = 14;  // how much fireTime drops per frame when not shooting (faster than growth = encourages bursting)
const RECOIL_MAX        = 60;   // max fireTime cap
const BULLET_DAMAGE     = 34;   // HP per bullet hit

// ── Corpse system ─────────────────────────────────────────────────────────────
const BEING_MAX_HP      = 100;
const CORPSE_SIZE       = 14;   // square side length
const CORPSE_VEL_DECAY = 0.80; // how fast corpse slide velocity damps

interface Corpse {
  x: number;
  y: number;
  vx: number; // slide velocity from bullet impact
  vy: number;
  color: string;
  actor: Actor;
}

const corpses: Corpse[] = [];

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
}

const bullets: Bullet[] = [];
let bFired     = 0;        // shots fired in current clip
let bTime      = SHOT_DELAY; // frames since last shot (start ready)
let reloading  = false;
let reloadTimer = 0;
let fireTime   = 0;        // accumulated recoil
let mouseDown  = false;
let mouseWorldX = 0;
let mouseWorldY = 0;

// ── Mobile detection & joystick state ────────────────────────────────────────
const IS_MOBILE = !window.matchMedia('(pointer: fine)').matches;
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

// PC mouse input is registered after game.start() using Excalibur's pointer system

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
  hp: number;
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
    hp: BEING_MAX_HP,
    type,
    actor,
  };
}

function makeCorpse(scene: Scene, x: number, y: number, colorStr: string): Corpse {
  const actor = new Actor({ x, y, z: 1 });
  const corpse: Corpse = { x, y, vx: 0, vy: 0, color: colorStr, actor };
  const cv = new Canvas({
    width: CORPSE_SIZE,
    height: CORPSE_SIZE,
    cache: false,
    draw(ctx) {
      ctx.clearRect(0, 0, CORPSE_SIZE, CORPSE_SIZE);
      ctx.fillStyle = corpse.color;
      ctx.fillRect(0, 0, CORPSE_SIZE, CORPSE_SIZE);
    },
  });
  actor.graphics.use(cv);
  scene.add(actor);
  return corpse;
}

function killBeing(scene: Scene, beings: Being[], idx: number): Corpse {
  const be = beings[idx];
  const colorStr = be.type === 'zombie'
    ? `rgb(${ZOMBIE_COLOR.r},${ZOMBIE_COLOR.g},${ZOMBIE_COLOR.b})`
    : `rgb(${CIVILIAN_COLOR.r},${CIVILIAN_COLOR.g},${CIVILIAN_COLOR.b})`;
  be.actor.kill();
  beings.splice(idx, 1);
  return makeCorpse(scene, be.x, be.y, colorStr);
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

  // ── PC mouse input via Excalibur (gives worldPos accounting for camera/scale) ──
  if (!IS_MOBILE) {
    game.input.pointers.primary.on('down', () => { mouseDown = true; });
    game.input.pointers.primary.on('up',   () => { mouseDown = false; });
    game.input.pointers.primary.on('move', (evt) => {
      mouseWorldX = evt.worldPos.x;
      mouseWorldY = evt.worldPos.y;
    });
  }

  scene.add(playerActor);
  for (const b of beings) scene.add(b.actor);

  // ── Bullet canvas (redraws every frame) ──────────────────────────────────
  const bulletActor = new Actor({ x: GRID_W / 2, y: GRID_H / 2, z: 8 });
  const bulletCanvas = new Canvas({
    width: GRID_W,
    height: GRID_H,
    cache: false,
    draw(ctx) {
      ctx.clearRect(0, 0, GRID_W, GRID_H);
      ctx.strokeStyle = '#2a1a0a'; // dark dry brown
      ctx.lineWidth = 1.2;
      for (const bul of bullets) {
        // Tail offset: one velocity step back for short line
        const tailX = bul.x - bul.vx;
        const tailY = bul.y - bul.vy;
        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(bul.x, bul.y);
        ctx.stroke();
      }
    },
  });
  bulletActor.graphics.use(bulletCanvas);
  scene.add(bulletActor);

  // ── HUD canvas (ammo display) ─────────────────────────────────────────────
  const HUD_W = 200, HUD_H = 30;
  const hudActor = new Actor({ x: HUD_W / 2 + 8, y: GRID_H - HUD_H / 2 - 8, z: 100 });
  hudActor.pos = new Vector(HUD_W / 2 + 8, GRID_H - HUD_H / 2 - 8);
  const hudCanvas = new Canvas({
    width: HUD_W,
    height: HUD_H,
    cache: false,
    draw(ctx) {
      ctx.clearRect(0, 0, HUD_W, HUD_H);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, HUD_W, HUD_H);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      if (reloading) {
        const pct = reloadTimer / RELOAD_TIME;
        ctx.fillText(`Reloading... ${Math.round(pct * 100)}%`, 8, HUD_H / 2);
      } else {
        const ammoLeft = CLIP_SIZE - bFired;
        ctx.fillText(`Ammo: ${ammoLeft} / ${CLIP_SIZE}`, 8, HUD_H / 2);
      }
    },
  });
  hudActor.graphics.use(hudCanvas);
  scene.add(hudActor);

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

    // ── Keep HUD pinned to bottom-left of viewport ────────────────────────
    const cam = scene.camera;
    const vp = cam.viewport;
    hudActor.pos = new Vector(vp.left + HUD_W / 2 + 8, vp.bottom - HUD_H / 2 - 8);

    // ── Shooting (PC only) ────────────────────────────────────────────────
    if (!IS_MOBILE) {
      // R key: manual reload
      if (game.input.keyboard.wasPressed(Keys.R) && !reloading && bFired > 0) {
        reloading = true;
        reloadTimer = 0;
        fireTime = 0;
      }

      // Reload tick
      if (reloading) {
        reloadTimer++;
        if (reloadTimer >= RELOAD_TIME) {
          reloading = false;
          reloadTimer = 0;
          bFired = 0;
        }
      }

      bTime++;

      if (mouseDown && !reloading) {
        if (bTime >= SHOT_DELAY && bFired < CLIP_SIZE) {
          // Direction from player to mouse (world coords)
          const dx = mouseWorldX - playerX;
          const dy = mouseWorldY - playerY;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len > 0.001) {
            // Apply recoil spread (like zombie4: random in [-fireTime/400, fireTime/400])
            const spreadMax = fireTime / 400;
            const spread = randFloat(-spreadMax, spreadMax);
            const angle = Math.atan2(dy, dx) + spread;
            const speed = BULLET_SPEED * randFloat(0.95, 1.05);
            bullets.push({
              x:  playerX,
              y:  playerY,
              vx: speed * Math.cos(angle),
              vy: speed * Math.sin(angle),
              age: 0,
            });
          }

          bTime = 0;
          bFired++;
          fireTime = Math.min(fireTime + RECOIL_GROWTH_SPEED, RECOIL_MAX);

          // Auto-reload when clip exhausted
          if (bFired >= CLIP_SIZE) {
            reloading = true;
            reloadTimer = 0;
            fireTime = 0;
          }
        }
      } else {
        // Decay recoil when not shooting
        if (fireTime > 0) fireTime = Math.max(0, fireTime - RECOIL_DECAY_SPEED);
      }

      // ── Bullet movement + zombie hit detection ──────────────────────────
      for (let i = bullets.length - 1; i >= 0; i--) {
        const bul = bullets[i];
        bul.x += bul.vx;
        bul.y += bul.vy;
        bul.age++;

        // Remove if out of bounds or expired
        if (bul.age >= BULLET_LIFETIME ||
            bul.x < 0 || bul.x > GRID_W ||
            bul.y < 0 || bul.y > GRID_H) {
          bullets.splice(i, 1);
          continue;
        }

        // Check hit against beings (zombies and civilians)
        let hit = false;
        for (let j = beings.length - 1; j >= 0; j--) {
          const be = beings[j];
          const HIT_R = (be.type === 'zombie' ? ZOMBIE_RADIUS : CIVILIAN_RADIUS) + 4;
          if (dist2(bul.x, bul.y, be.x, be.y) < HIT_R * HIT_R ||
              dist2(bul.x - bul.vx / 2, bul.y - bul.vy / 2, be.x, be.y) < HIT_R * HIT_R) {
            be.hp -= BULLET_DAMAGE;
            bullets.splice(i, 1);
            hit = true;
            if (be.hp <= 0) {
              corpses.push(killBeing(scene, beings, j));
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
            bullets.splice(i, 1);
            hit = true;
            break;
          }
        }
        if (hit) continue;
      }
    }

    // ── Beings update ────────────────────────────────────────────────────────
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

    // ── Corpse jiggle update ──────────────────────────────────────────────
    for (const co of corpses) {
      co.x += co.vx;
      co.y += co.vy;
      co.vx *= CORPSE_VEL_DECAY;
      co.vy *= CORPSE_VEL_DECAY;
      co.actor.pos = new Vector(co.x, co.y);
    }
  };
});
