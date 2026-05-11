import {
  Engine,
  DisplayMode,
  Color,
  Actor,
  Circle,
  Vector,
  Keys,
  Canvas,
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
}

const corpses: Corpse[] = [];

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  actor: Actor;
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
let fireJoyDx = 0;  // fire joystick direction (unit-ish, from nipplejs)
let fireJoyDy = 0;
let mobileFireActive = false; // true while fire stick is being held

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

  const fireZone = document.getElementById('fire-zone') as HTMLElement;
  const fireManager = nipplejs.create({
    zone: fireZone,
    mode: 'static',
    position: { left: '50%', top: '50%' },
    color: 'red',
    size: 100,
  });
  fireManager.on('move', (evt) => {
    const v = evt.data.vector;
    fireJoyDx = v.x;
    fireJoyDy = -v.y; // nipplejs y is inverted vs screen
    mobileFireActive = true;
  });
  fireManager.on('end', () => {
    fireJoyDx = 0;
    fireJoyDy = 0;
    mobileFireActive = false;
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

const NUM_ZOMBIES   = IS_MOBILE ? 12 : 20;
const NUM_CIVILIANS = IS_MOBILE ? 18 : 30;

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
    playerActor.pos.x = playerX;
    playerActor.pos.y = playerY;

    // ── Keep HUD pinned to bottom-left of viewport ────────────────────────
    const cam = scene.camera;
    const vp = cam.viewport;
    hudActor.pos.x = vp.left + HUD_W / 2 + 8;
    hudActor.pos.y = vp.bottom - HUD_H / 2 - 8;

    // ── Shooting (PC only) ────────────────────────────────────
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
            const bActor = new Actor({ x: playerX, y: playerY, z: 8 });
            bActor.graphics.use(new Circle({ radius: 2, color: Color.fromHex('#2a1a0a') }));
            scene.add(bActor);
            bullets.push({
              x:  playerX,
              y:  playerY,
              vx: speed * Math.cos(angle),
              vy: speed * Math.sin(angle),
              age: 0,
              actor: bActor,
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
        bul.actor.pos.x = bul.x;
        bul.actor.pos.y = bul.y;

        // Remove if out of bounds or expired
        if (bul.age >= BULLET_LIFETIME ||
            bul.x < 0 || bul.x > GRID_W ||
            bul.y < 0 || bul.y > GRID_H) {
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
            be.hp -= BULLET_DAMAGE;
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
    }

    // ── Shooting (mobile fire joystick) ──────────────────────────────────
    if (IS_MOBILE) {
      bTime++;

      if (mobileFireActive) {
        if (bTime >= SHOT_DELAY && bFired < CLIP_SIZE) {
          const len = Math.sqrt(fireJoyDx * fireJoyDx + fireJoyDy * fireJoyDy);
          if (len > 0.1) {
            const spreadMax = fireTime / 400;
            const spread = randFloat(-spreadMax, spreadMax);
            const angle = Math.atan2(fireJoyDy, fireJoyDx) + spread;
            const speed = BULLET_SPEED * randFloat(0.95, 1.05);
            const bActor = new Actor({ x: playerX, y: playerY, z: 8 });
            bActor.graphics.use(new Circle({ radius: 2, color: Color.fromHex('#2a1a0a') }));
            scene.add(bActor);
            bullets.push({
              x:  playerX,
              y:  playerY,
              vx: speed * Math.cos(angle),
              vy: speed * Math.sin(angle),
              age: 0,
              actor: bActor,
            });
          }
          bTime = 0;
          bFired++;
          fireTime = Math.min(fireTime + RECOIL_GROWTH_SPEED, RECOIL_MAX);

          if (bFired >= CLIP_SIZE) {
            reloading = true;
            reloadTimer = 0;
            fireTime = 0;
          }
        }
      } else {
        if (fireTime > 0) fireTime = Math.max(0, fireTime - RECOIL_DECAY_SPEED);
      }

      // Reload tick (auto only — no manual reload on mobile)
      if (reloading) {
        reloadTimer++;
        if (reloadTimer >= RELOAD_TIME) {
          reloading = false;
          reloadTimer = 0;
          bFired = 0;
        }
      }

      // Bullet movement + hit detection (same as PC)
      for (let i = bullets.length - 1; i >= 0; i--) {
        const bul = bullets[i];
        bul.x += bul.vx;
        bul.y += bul.vy;
        bul.age++;
        bul.actor.pos.x = bul.x;
        bul.actor.pos.y = bul.y;

        if (bul.age >= BULLET_LIFETIME ||
            bul.x < 0 || bul.x > GRID_W ||
            bul.y < 0 || bul.y > GRID_H) {
          removeBullet(i);
          continue;
        }

        let hit = false;
        for (let j = beings.length - 1; j >= 0; j--) {
          const be = beings[j];
          const HIT_R = (be.type === 'zombie' ? ZOMBIE_RADIUS : CIVILIAN_RADIUS) + 4;
          if (dist2(bul.x, bul.y, be.x, be.y) < HIT_R * HIT_R ||
              dist2(bul.x - bul.vx / 2, bul.y - bul.vy / 2, be.x, be.y) < HIT_R * HIT_R) {
            be.hp -= BULLET_DAMAGE;
            removeBullet(i);
            hit = true;
            if (be.hp <= 0) {
              corpses.push(killBeing(beings, j));
            }
            break;
          }
        }
        if (hit) continue;

        for (let j = corpses.length - 1; j >= 0; j--) {
          const co = corpses[j];
          const half = CORPSE_SIZE / 2;
          if (bul.x >= co.x - half && bul.x <= co.x + half &&
              bul.y >= co.y - half && bul.y <= co.y + half) {
            co.vx += bul.vx * 0.4;
            co.vy += bul.vy * 0.4;
            removeBullet(i);
            hit = true;
            break;
          }
        }
        if (hit) continue;
      }
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

      // Always apply velocity
      const vx = b.speed * Math.cos(b.angle);
      const vy = b.speed * Math.sin(b.angle);
      b.x = clamp(b.x + vx, 0, GRID_W);
      b.y = clamp(b.y + vy, 0, GRID_H);
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
