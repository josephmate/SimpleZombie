import { Actor, Canvas, Scene, Vector } from 'excalibur';
import { GunState } from './WeaponHandler';

export type { GunState };

const HUD_W = 200;
const HUD_H = 30;

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
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, HUD_W, HUD_H);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    if (this.state.reloading) {
      const pct = this.state.reloadTimer / this.state.reloadTime;
      ctx.fillText(`Reloading... ${Math.round(pct * 100)}%`, 8, HUD_H / 2);
    } else {
      const ammoLeft = this.state.clipSize - this.state.bFired;
      ctx.fillText(`Ammo: ${ammoLeft} / ${this.state.clipSize}`, 8, HUD_H / 2);
    }
  }
}
