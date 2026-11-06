import {
  Engine,
  Rectangle,
  Vector2,
  Text,
  Circle,
  PhysicsComponent
} from 'dino-ge';

new Engine(
{
  onLoad: async () => {
    // 1. Create a Bouncy Ball
    const ball = new Circle({
      tag: 'bouncy-ball',
      position: new Vector2(200, 100),
      radius: 25,
      colour: '#f9c74f',
      zIndex: 5
    });

    const ballPhys = new PhysicsComponent();
    ballPhys.velocity = new Vector2(200, 150);
    ballPhys.restitution = 0.9; // Very bouncy
    ballPhys.friction = 0.1;
    ball.addComponent(ballPhys);

    // 2. Create another ball to collide with
    const ball2 = new Circle({
      tag: 'static-ball',
      position: new Vector2(400, 200),
      radius: 40,
      colour: '#f94144',
      zIndex: 5
    });
    const ball2Phys = new PhysicsComponent();
    ball2Phys.isStatic = true;
    ball2Phys.restitution = 0.8;
    ball2.addComponent(ball2Phys);

    // 3. Create boundaries (walls)
    const wallProps = {
      colour: '#577590',
      zIndex: 1
    };

    const floor = new Rectangle({
      ...wallProps,
      tag: 'floor',
      position: new Vector2(0, 550),
      width: 800,
      height: 50
    });
    const floorPhys = new PhysicsComponent();
    floorPhys.isStatic = true;
    floor.addComponent(floorPhys);

    const ceiling = new Rectangle({
      ...wallProps,
      tag: 'ceiling',
      position: new Vector2(0, 0),
      width: 800,
      height: 20
    });
    const ceilPhys = new PhysicsComponent();
    ceilPhys.isStatic = true;
    ceiling.addComponent(ceilPhys);

    const leftWall = new Rectangle({
      ...wallProps,
      tag: 'left-wall',
      position: new Vector2(0, 0),
      width: 20,
      height: 600
    });
    const leftPhys = new PhysicsComponent();
    leftPhys.isStatic = true;
    leftWall.addComponent(leftPhys);

    const rightWall = new Rectangle({
      ...wallProps,
      tag: 'right-wall',
      position: new Vector2(780, 0),
      width: 20,
      height: 600
    });
    const rightPhys = new PhysicsComponent();
    rightPhys.isStatic = true;
    rightWall.addComponent(rightPhys);

    // A sparse field of static bumpers exercises the collision broad phase.
    for (let row = 0; row < 12; row++) {
      for (let column = 0; column < 18; column++) {
        const bumper = new Circle({
          position: new Vector2(64 + column * 38, 130 + row * 33),
          radius: 4,
          colour: '#43aa8b',
          tag: 'bumper',
        });
        const physics = new PhysicsComponent();
        physics.isStatic = true;
        physics.restitution = 0.9;
        bumper.addComponent(physics);
      }
    }

    // 4. Instructions
    new Text({
      text: 'Bouncy Ball Example',
      fontSize: 24,
      colour: 'white',
      position: new Vector2(400, 50),
      tag: 'ui-text'
    });

    new Text({
      text: 'Select the ball in Debug Mode to tweak properties!',
      fontSize: 14,
      colour: '#aaa',
      position: new Vector2(400, 80),
      tag: 'ui-subtext'
    });
  },
  update: () => {
    // Custom scene logic could go here
  }
}, {
  title: 'Bouncy Physics',
  containerId: 'playground-canvas-container',
  backgroundColour: '#264653'
});

