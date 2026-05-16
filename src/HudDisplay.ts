import { Actor, Canvas, Scene, Vector } from 'excalibur';
import { GunState } from './WeaponHandler';

export type { GunState };

const HUD_W    = 230;
const HUD_H    = 56;
const ICON_W   = 62; // width of the gun icon column

export class HudDisplay {
  private readonly actor: Actor;
  private readonly state: GunState;

  constructor(scene: Scene, gridH: number, state: GunState) {
    this.state = state;

    this.actor = new Actor({ x: HUD_W / 2 + 8, y: gridH - HUD_H / 2 - 8, z: 100 });
    this.actor.pos = new Vector(HUD_W / 2 + 8, gridH - HUD_H / 2 - 8);

    const canvas = new Canvas({
      width: HUD_W,
      height: HUD_H,
      cache: false,
      draw: (ctx) => this.draw(ctx),
    });

    this.actor.graphics.use(canvas);
    scene.add(this.actor);
  }

  /** Call each frame to keep the HUD pinned to the bottom-left of the viewport. */
  pinToViewport(vpLeft: number, vpBottom: number): void {
    this.actor.pos.x = vpLeft  + HUD_W / 2 + 8;
    this.actor.pos.y = vpBottom - HUD_H / 2 - 8;
  }

  private draw(ctx: CanvasRenderingContext2D): void {
    ctx.clearRect(0, 0, HUD_W, HUD_H);

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(0, 0, HUD_W, HUD_H);

    // Gun icon (left column)
    this.drawGunIcon(ctx, this.state.gunId, ICON_W / 2, HUD_H / 2);

    // Divider
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(ICON_W, 6, 1, HUD_H - 12);

    // Text area
    const tx = ICON_W + 10;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    // Gun name (green accent)
    ctx.fillStyle = '#90ee90';
    ctx.font = 'bold 13px monospace';
    ctx.fillText(this.state.gunName, tx, 17);

    // Ammo / reload
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px monospace';
    if (this.state.reloading) {
      const pct = this.state.reloadTimer / this.state.reloadTime;
      ctx.fillText(`Reloading... ${Math.round(pct * 100)}%`, tx, 40);
    } else {
      const ammoLeft = this.state.clipSize - this.state.bFired;
      ctx.fillText(`Ammo: ${ammoLeft} / ${this.state.clipSize}`, tx, 40);
    }
  }

  // ── Gun icon drawings ──────────────────────────────────────────────────────
  // All guns drawn pointing right. Coordinate origin at centre of icon area.
  // Design space: ±24 x  ±14 y  (fits comfortably in 62×56 px column).

  private drawGunIcon(ctx: CanvasRenderingContext2D, gunId: string, cx: number, cy: number): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle   = '#e0e0e0';
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';

    switch (gunId) {

      case 'pistol': {
        // Slide / frame
        ctx.fillRect(-9, -7, 21, 10);
        // Barrel extension
        ctx.fillRect(12, -5, 12, 6);
        // Grip
        ctx.beginPath();
        ctx.moveTo(-7, 3); ctx.lineTo(-7, 14); ctx.lineTo(1, 14); ctx.lineTo(4, 3);
        ctx.closePath(); ctx.fill();
        // Trigger guard
        ctx.beginPath();
        ctx.arc(-1, 4, 5, 0, Math.PI);
        ctx.lineWidth = 2; ctx.stroke();
        break;
      }

      case 'shotgun': {
        // Stock
        ctx.fillRect(-22, -2, 14, 9);
        // Receiver
        ctx.fillRect(-10, -7, 16, 14);
        // Double barrel (stacked tubes)
        ctx.fillRect(4, -8, 20, 5);
        ctx.fillRect(4, -2, 20, 5);
        // Pump grip
        ctx.fillRect(7, 3, 10, 5);
        break;
      }

      case 'rifle': {
        // Stock
        ctx.fillRect(-24, 0, 16, 7);
        // Receiver
        ctx.fillRect(-10, -6, 18, 12);
        // Long barrel
        ctx.fillRect(6, -3, 20, 5);
        // Magazine
        ctx.fillRect(-4, 6, 7, 9);
        break;
      }

      case 'machine_gun': {
        // Stock
        ctx.fillRect(-24, 0, 14, 8);
        // Receiver (bigger than rifle)
        ctx.fillRect(-12, -7, 22, 14);
        // Long barrel
        ctx.fillRect(8, -3, 18, 5);
        // Large box magazine
        ctx.fillRect(-8, 7, 16, 12);
        break;
      }

      case 'sniper': {
        // Stock
        ctx.fillRect(-24, 0, 16, 7);
        // Receiver
        ctx.fillRect(-10, -5, 16, 9);
        // Very long thin barrel
        ctx.fillRect(4, -2, 22, 3);
        // Scope body
        ctx.fillRect(-8, -12, 16, 6);
        // Scope end-caps (circles)
        ctx.beginPath(); ctx.arc(-8, -9, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc( 7, -9, 3.5, 0, Math.PI * 2); ctx.fill();
        break;
      }

      case 'grenade_launcher': {
        // Stock
        ctx.fillRect(-22, -2, 12, 9);
        // Fat body
        ctx.fillRect(-12, -9, 18, 18);
        // Short fat barrel
        ctx.fillRect(4, -7, 16, 14);
        // Barrel opening ring
        ctx.beginPath();
        ctx.arc(20, 0, 7, -Math.PI / 2, Math.PI / 2);
        ctx.lineWidth = 3; ctx.stroke();
        break;
      }

      case 'sandbag_launcher': {
        // Bazooka-style shoulder tube
        ctx.fillRect(-24, -5, 48, 10);
        // Front flare ring
        ctx.fillRect(22, -7, 4, 14);
        // Pistol-grip handle
        ctx.fillRect(-8, 5, 8, 10);
        // Sandbag projectile loaded (sandy colour)
        ctx.fillStyle = '#c2a96e';
        ctx.fillRect(-20, -3, 8, 6);
        break;
      }

      default: {
        ctx.fillRect(-14, -5, 28, 10);
        break;
      }
    }

    ctx.restore();
  }
}

