import { Engine, DisplayMode, Color, Actor, Circle, Vector } from 'excalibur';

const RADIUS = 30;
const SPEED = 300;

const game = new Engine({
  width: 800,
  height: 600,
  displayMode: DisplayMode.FitScreen,
  backgroundColor: Color.fromHex('#1a1a2e'),
});

const ball = new Actor({
  x: 400,
  y: 300,
  vel: new Vector(SPEED, SPEED * 0.7),
});

ball.graphics.use(
  new Circle({
    radius: RADIUS,
    color: Color.fromHex('#e94560'),
  })
);

ball.onPreUpdate = () => {
  const { width, height } = game.screen.drawWidth > 0
    ? { width: game.screen.drawWidth, height: game.screen.drawHeight }
    : { width: 800, height: 600 };

  if (ball.pos.x - RADIUS <= 0 || ball.pos.x + RADIUS >= width) {
    ball.vel.x *= -1;
    ball.pos.x = Math.max(RADIUS, Math.min(width - RADIUS, ball.pos.x));
  }
  if (ball.pos.y - RADIUS <= 0 || ball.pos.y + RADIUS >= height) {
    ball.vel.y *= -1;
    ball.pos.y = Math.max(RADIUS, Math.min(height - RADIUS, ball.pos.y));
  }
};

game.add(ball);
game.start();
