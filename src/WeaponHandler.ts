// ── Weapon sub-system ─────────────────────────────────────────────────────────
// All gun configuration, ammo state, recoil and switching logic live here.
// main.ts creates one WeaponHandler instance and calls reset() at the start of
// each level, passing the list of weapon IDs to enable for that level.

export interface GunConfig {
  id: string;
  name: string;
  bulletSpeed: number;
  clipSize: number;
  shotDelay: number;         // min frames between shots
  reloadTime: number;        // frames to fully reload
  recoilGrowthSpeed: number; // recoil added per shot
  recoilDecaySpeed: number;  // recoil removed per frame when not firing
  recoilMax: number;         // recoil cap
  bulletDamage: number;      // HP removed per hit
}

/** Live state exposed to the HUD. Mutated in-place so references stay valid. */
export interface GunState {
  bFired: number;
  reloading: boolean;
  reloadTimer: number;
  clipSize: number;
  reloadTime: number;
}

/** Returned by update() — one entry per bullet to spawn this frame. */
export interface SpawnBulletRequest {
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
}

// ── All gun definitions ───────────────────────────────────────────────────────
export const ALL_GUNS: Record<string, GunConfig> = {
  pistol: {
    id: 'pistol',
    name: 'Pistol',
    bulletSpeed: 14,
    clipSize: 15,
    shotDelay: 14,
    reloadTime: 50,
    recoilGrowthSpeed: 7,
    recoilDecaySpeed: 14,
    recoilMax: 60,
    bulletDamage: 34,
  },
  shotgun: {
    id: 'shotgun',
    name: 'Shotgun',
    bulletSpeed: 12,
    clipSize: 6,
    shotDelay: 20,
    reloadTime: 80,
    recoilGrowthSpeed: 20,
    recoilDecaySpeed: 10,
    recoilMax: 80,
    bulletDamage: 25,  // per pellet; shotgun fires multiple
  },
  rifle: {
    id: 'rifle',
    name: 'Rifle',
    bulletSpeed: 20,
    clipSize: 30,
    shotDelay: 2,
    reloadTime: 70,
    recoilGrowthSpeed: 4,
    recoilDecaySpeed: 18,
    recoilMax: 50,
    bulletDamage: 50,
  },
  machine_gun: {
    id: 'machine_gun',
    name: 'Machine Gun',
    bulletSpeed: 16,
    clipSize: 1000,
    shotDelay: 1,
    reloadTime: 120,
    recoilGrowthSpeed: 2,
    recoilDecaySpeed: 8,
    recoilMax: 120,
    bulletDamage: 25,
  },
  sniper: {
    id: 'sniper',
    name: 'Sniper Rifle',
    bulletSpeed: 30,
    clipSize: 5,
    shotDelay: 40,
    reloadTime: 90,
    recoilGrowthSpeed: 0,
    recoilDecaySpeed: 0,
    recoilMax: 0,
    bulletDamage: 100,  // one-shot kill
  },
};

// ── WeaponHandler ─────────────────────────────────────────────────────────────
export class WeaponHandler {
  private enabledGuns: GunConfig[] = [];
  private currentGunIdx: number = 0;
  private bTime: number = 0;    // frames since last shot
  private fireTime: number = 0; // accumulated recoil

  /** Saved bFired per gun id so ammo is remembered when switching. */
  private savedBFired: Map<string, number> = new Map();

  /**
   * Mutable state object — pass this reference to the HUD once.
   * reset() and switchTo*() mutate it in-place so the HUD ref never goes stale.
   */
  readonly state: GunState = {
    bFired: 0,
    reloading: false,
    reloadTimer: 0,
    clipSize: 1,
    reloadTime: 1,
  };

  /**
   * @param enabledWeaponIds  IDs of guns available for the first/current level.
   *                          Call reset() at the start of each subsequent level.
   */
  constructor(enabledWeaponIds: string[]) {
    this.reset(enabledWeaponIds);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Call at the start of each level to set which weapons are available.
   * All ammo counters and recoil are cleared.
   */
  reset(enabledWeaponIds: string[]): void {
    if (enabledWeaponIds.length === 0) throw new Error('WeaponHandler requires at least one weapon id');
    this.enabledGuns = enabledWeaponIds.map(id => {
      const cfg = ALL_GUNS[id];
      if (!cfg) throw new Error(`Unknown weapon id: "${id}"`);
      return cfg;
    });
    this.currentGunIdx = 0;
    this.bTime = this.enabledGuns[0].shotDelay; // ready to fire immediately
    this.fireTime = 0;
    this.savedBFired.clear();
    this._syncState();
    this.state.bFired = 0;
    this.state.reloading = false;
    this.state.reloadTimer = 0;
  }

  /** The currently active gun configuration. */
  get currentGun(): GunConfig {
    return this.enabledGuns[this.currentGunIdx];
  }

  /** A snapshot list of the enabled guns (for UI, cycling, etc.). */
  get enabledGunList(): readonly GunConfig[] {
    return this.enabledGuns;
  }

  /** Switch to a gun by its index in the enabled list. Saves current ammo. */
  switchToIndex(idx: number): void {
    if (idx < 0 || idx >= this.enabledGuns.length || idx === this.currentGunIdx) return;
    this._saveCurrentAmmo();
    this.currentGunIdx = idx;
    this._restoreAmmo();
  }

  /** Switch to a gun by its id string. Saves current ammo. */
  switchTo(id: string): void {
    const idx = this.enabledGuns.findIndex(g => g.id === id);
    if (idx >= 0) this.switchToIndex(idx);
  }

  /** Cycle to the previous enabled gun (wraps around). */
  cyclePrev(): void {
    const n = this.enabledGuns.length;
    this.switchToIndex((this.currentGunIdx - 1 + n) % n);
  }

  /** Cycle to the next enabled gun (wraps around). */
  cycleNext(): void {
    this.switchToIndex((this.currentGunIdx + 1) % this.enabledGuns.length);
  }

  /**
   * Call once per frame from the update loop.
   * Handles reload ticks, firing, and recoil.
   *
   * @returns  Array of bullet spawn requests (usually 0 or 1; shotgun returns multiple).
   */
  update(
    isShooting: boolean,
    reloadRequested: boolean,
    playerX: number,
    playerY: number,
    shootDx: number,
    shootDy: number,
    randFloat: (min: number, max: number) => number,
  ): SpawnBulletRequest[] {
    const gun = this.currentGun;
    const spawns: SpawnBulletRequest[] = [];

    // Manual reload
    if (reloadRequested && !this.state.reloading && this.state.bFired > 0) {
      this.state.reloading = true;
      this.state.reloadTimer = 0;
      this.fireTime = 0;
    }

    // Reload tick
    if (this.state.reloading) {
      this.state.reloadTimer++;
      if (this.state.reloadTimer >= gun.reloadTime) {
        this.state.reloading = false;
        this.state.reloadTimer = 0;
        this.state.bFired = 0;
        this.savedBFired.delete(gun.id);
      }
    }

    this.bTime++;

    if (isShooting && !this.state.reloading) {
      if (this.bTime >= gun.shotDelay && this.state.bFired < gun.clipSize) {
        const len = Math.sqrt(shootDx * shootDx + shootDy * shootDy);
        if (len > 0.001) {
          const baseAngle = Math.atan2(shootDy, shootDx);
          const spreadMax = this.fireTime / 400;

          if (gun.id === 'shotgun') {
            // Fire 5 pellets in a spread cone
            const PELLETS = 5;
            const CONE = 0.25; // radians half-width
            for (let p = 0; p < PELLETS; p++) {
              const spread = randFloat(-CONE, CONE);
              const angle = baseAngle + spread;
              const speed = gun.bulletSpeed * randFloat(0.9, 1.1);
              spawns.push({
                x: playerX, y: playerY,
                vx: speed * Math.cos(angle),
                vy: speed * Math.sin(angle),
                damage: gun.bulletDamage,
              });
            }
          } else {
            const spread = randFloat(-spreadMax, spreadMax);
            const angle = baseAngle + spread;
            const speed = gun.bulletSpeed * randFloat(0.95, 1.05);
            spawns.push({
              x: playerX, y: playerY,
              vx: speed * Math.cos(angle),
              vy: speed * Math.sin(angle),
              damage: gun.bulletDamage,
            });
          }
        }
        this.bTime = 0;
        this.state.bFired++;
        this.fireTime = Math.min(this.fireTime + gun.recoilGrowthSpeed, gun.recoilMax);

        // Auto-reload when clip is empty
        if (this.state.bFired >= gun.clipSize) {
          this.state.reloading = true;
          this.state.reloadTimer = 0;
          this.fireTime = 0;
        }
      }
    } else {
      // Decay recoil when not shooting
      if (this.fireTime > 0) this.fireTime = Math.max(0, this.fireTime - gun.recoilDecaySpeed);
    }

    return spawns;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private _syncState(): void {
    const gun = this.currentGun;
    this.state.clipSize = gun.clipSize;
    this.state.reloadTime = gun.reloadTime;
  }

  private _saveCurrentAmmo(): void {
    this.savedBFired.set(this.currentGun.id, this.state.bFired);
  }

  private _restoreAmmo(): void {
    const gun = this.currentGun;
    const saved = this.savedBFired.get(gun.id) ?? 0;
    this.state.bFired = saved;
    this.state.reloading = false;
    this.state.reloadTimer = 0;
    this.bTime = gun.shotDelay; // ready to fire after switch
    this.fireTime = 0;
    this._syncState();
  }
}
