import { Engine, Keys } from 'excalibur';
import nipplejs from 'nipplejs';

export const IS_MOBILE = !window.matchMedia('(pointer: fine)').matches;

const NUMBER_KEYS = [
  Keys.Key1, Keys.Key2, Keys.Key3, Keys.Key4, Keys.Key5,
  Keys.Key6, Keys.Key7, Keys.Key8, Keys.Key9,
];

export interface PlayerInputs {
  dx: number;               // movement x: keyboard -1/0/1, joystick -1..1
  dy: number;               // movement y: keyboard -1/0/1, joystick -1..1
  reloadRequested: boolean; // PC: R key; mobile: not implemented
  shootDx: number;          // shoot direction x (raw, caller normalises)
  shootDy: number;          // shoot direction y (raw, caller normalises)
  isShooting: boolean;      // PC: mouse held; mobile: fire stick active
  weaponSlot: number | null; // 1-9 if a number key was pressed, null otherwise
  weaponCyclePrev: boolean;  // cycle to previous weapon
  weaponCycleNext: boolean;  // cycle to next weapon
}

export class InputHandler {
  private readonly engine: Engine;

  // Mobile joystick state
  private joystickDx = 0;
  private joystickDy = 0;
  private fireJoyDx = 0;
  private fireJoyDy = 0;
  private mobileFireActive = false;
  private mobileCyclePrev = false;
  private mobileCycleNext = false;

  // PC mouse state
  private mouseDown = false;
  private mouseWorldX = 0;
  private mouseWorldY = 0;

  constructor(engine: Engine) {
    this.engine = engine;
    if (IS_MOBILE) {
      this.setupJoysticks();
    }
  }

  private setupJoysticks(): void {
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
      this.joystickDx = v.x;
      this.joystickDy = -v.y; // nipplejs y is inverted vs screen
    });
    manager.on('end', () => {
      this.joystickDx = 0;
      this.joystickDy = 0;
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
      this.fireJoyDx = v.x;
      this.fireJoyDy = -v.y; // nipplejs y is inverted vs screen
      this.mobileFireActive = true;
    });
    fireManager.on('end', () => {
      this.fireJoyDx = 0;
      this.fireJoyDy = 0;
      this.mobileFireActive = false;
    });

    const prevBtn = document.getElementById('weapon-prev');
    const nextBtn = document.getElementById('weapon-next');
    prevBtn?.addEventListener('touchstart', (e) => { e.preventDefault(); this.mobileCyclePrev = true; }, { passive: false });
    nextBtn?.addEventListener('touchstart', (e) => { e.preventDefault(); this.mobileCycleNext = true; }, { passive: false });
  }

  /** Call once after game.start() to register pointer events. */
  setupPointers(): void {
    if (!IS_MOBILE) {
      this.engine.input.pointers.primary.on('down', () => { this.mouseDown = true; });
      this.engine.input.pointers.primary.on('up',   () => { this.mouseDown = false; });
      this.engine.input.pointers.primary.on('move', (evt) => {
        this.mouseWorldX = evt.worldPos.x;
        this.mouseWorldY = evt.worldPos.y;
      });
    }
  }

  /** Returns the current player inputs for this frame. */
  getInputs(playerX: number, playerY: number): PlayerInputs {
    if (IS_MOBILE) {
      const cyclePrev = this.mobileCyclePrev;
      const cycleNext = this.mobileCycleNext;
      this.mobileCyclePrev = false;
      this.mobileCycleNext = false;
      return {
        dx: this.joystickDx,
        dy: this.joystickDy,
        reloadRequested: false,
        shootDx: this.fireJoyDx,
        shootDy: this.fireJoyDy,
        isShooting: this.mobileFireActive,
        weaponSlot: null,
        weaponCyclePrev: cyclePrev,
        weaponCycleNext: cycleNext,
      };
    }

    let dx = 0, dy = 0;
    if (this.engine.input.keyboard.isHeld(Keys.W)) dy -= 1;
    if (this.engine.input.keyboard.isHeld(Keys.S)) dy += 1;
    if (this.engine.input.keyboard.isHeld(Keys.A)) dx -= 1;
    if (this.engine.input.keyboard.isHeld(Keys.D)) dx += 1;

    let weaponSlot: number | null = null;
    for (let i = 0; i < NUMBER_KEYS.length; i++) {
      if (this.engine.input.keyboard.wasPressed(NUMBER_KEYS[i])) {
        weaponSlot = i + 1;
        break;
      }
    }

    return {
      dx,
      dy,
      reloadRequested: this.engine.input.keyboard.wasPressed(Keys.R),
      shootDx: this.mouseWorldX - playerX,
      shootDy: this.mouseWorldY - playerY,
      isShooting: this.mouseDown,
      weaponSlot,
      weaponCyclePrev: false,
      weaponCycleNext: false,
    };
  }
}
