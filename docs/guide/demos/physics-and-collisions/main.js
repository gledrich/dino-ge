import { Circle, Engine, PhysicsComponent, Rectangle, Vector2 } from 'dino-ge';

const status = document.querySelector('#status');
let ball;
let body;

function staticBody(object, isSensor = false) {
  const physics = new PhysicsComponent();
  physics.isStatic = true;
  physics.isSensor = isSensor;
  physics.restitution = 1;
  object.addComponent(physics);
}

new Engine({
  onLoad() {
    const sensor = new Rectangle({
      tag: 'sensor', position: new Vector2(94, 65), width: 22, height: 92, colour: '#ac7742',
    });
    const wall = new Rectangle({
      tag: 'wall', position: new Vector2(230, 65), width: 20, height: 92, colour: '#6288ab',
    });
    staticBody(sensor, true);
    staticBody(wall);

    ball = new Circle({ tag: 'ball', position: new Vector2(34, 110), radius: 11, colour: '#b5eee0', zIndex: 2 });
    body = new PhysicsComponent();
    body.restitution = 1;
    ball.addComponent(body);

    let bounced = false;
    ball.on('collision', ({ detail }) => {
      if (detail.other === wall) {
        bounced = true;
        status.textContent = 'Bounced off the wall';
      } else if (detail.other === sensor && !bounced) {
        status.textContent = 'Sensor contact: ball keeps moving';
      }
    });
    const launch = () => {
      bounced = false;
      ball.transform.position.set(34, 110);
      body.velocity.set(155, 0);
      status.textContent = 'Ball launched';
    };
    const launchButton = document.querySelector('#launch');
    launchButton.addEventListener('click', launch);
    launchButton.disabled = false;
    launch();
  },
  fixedUpdate() {
    if (ball.transform.position.x < 16) body.velocity.set(0, 0);
  },
}, { containerId: 'game', width: '100%', height: '100%', backgroundColour: '#183035' });

document.querySelector('#debug').addEventListener('click', () => {
  Engine.debug = !Engine.debug;
  Engine.showPhysicsVectors = Engine.debug;
  Engine.showCollisionLines = Engine.debug;
});
