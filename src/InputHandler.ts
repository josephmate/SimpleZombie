import { Engine, Keys } from 'excalibur';
import nipplejs from 'nipplejs';

export const IS_MOBILE = !window.matchMedia('(pointer: fine)').matches;

export interface PlayerInputs {
  dx: number;               // movement x: keyboard -1/0/1, joystick -1..1
  dy: number;               // movement y: keyboard -1/0/1, joystick -1..1
  reloadRequested: boolean; // PC: R key; mobile: not implemented
  shootDx: number;          // shoot direction x (raw, caller normalises)
  shootDy: number;          // shoot direction y (raw, caller normalises)
  isShooting: boolean;      // PC: mouse held; mobile: fire stick active
}

export class InputHandler {
  private readonly engine: Engine;

  // Mobile joystick state
  private joystickDx = 0;
  private joystickDy = 0;
  private fireJoyDx = 0;
  private fireJoyDy = 0;
  private mobileFireActive = false;

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
      return {
        dx: this.joystickDx,
        dy: this.joystickDy,
        reloadRequested: false,
        shootDx: this.fireJoyDx,
        shootDy: this.fireJoyDy,
        isShooting: this.mobileFireActive,
      };
    }

    let dx = 0, dy = 0;
    if (this.engine.input.keyboard.isHeld(Keys.W)) dy -= 1;
    if (this.engine.input.keyboard.isHeld(Keys.S)) dy += 1;
    if (this.engine.input.keyboard.isHeld(Keys.A)) dx -= 1;
    if (this.engine.input.keyboard.isHeld(Keys.D)) dx += 1;
    return {
      dx,
      dy,
      reloadRequested: this.engine.input.keyboard.wasPressed(Keys.R),
      shootDx: this.mouseWorldX - playerX,
      shootDy: this.mouseWorldY - playerY,
      isShooting: this.mouseDown,
    };
  }
}
