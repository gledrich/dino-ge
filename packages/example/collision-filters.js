import { Engine, PhysicsComponent, Rectangle, Vector2 } from 'dino-ge';

const category = { rover: 0x1, pad: 0x2, gate: 0x4 };
const startX = 24;
const finishX = 246;
const run = document.getElementById('run');
const gateContact = document.getElementById('gate-contact');
const status = document.querySelector('[role="status"]');
let rover;
let roverPhysics;

function rectangle(x, y, width, height, colour, zIndex = 1, physics) {
  return new Rectangle({ position: new Vector2(x, y), width, height, colour, zIndex, physics });
}

new Engine({
  onLoad() {
    rectangle(12, 50, 264, 12, '#4b6665', 0);
    const pad = rectangle(98, 34, 48, 44, '#407f65', 1, {
      isStatic: true, isSensor: true, collisionCategory: category.pad, collisionMask: category.rover,
    });
    const gate = rectangle(212, 22, 14, 68, '#6596c5', 1, {
      isStatic: true, restitution: 1, collisionCategory: category.gate, collisionMask: category.rover,
    });
    rover = rectangle(startX, 45, 22, 22, '#ffd78a', 2, {
      restitution: 1, collisionCategory: category.rover,
    });
    roverPhysics = rover.getComponent(PhysicsComponent);

    const rows = new Map([
      [pad, document.querySelectorAll('#pad td')],
      [gate, document.querySelectorAll('#gate td')],
    ]);
    for (const [column, event] of ['collisionStart', 'collisionStay', 'collisionEnd'].entries()) {
      rover.on(event, ({ detail }) => {
        const cell = rows.get(detail.other)[column];
        cell.textContent = String(Number(cell.textContent) + 1);
      });
    }

    run.addEventListener('click', () => {
      for (const cells of rows.values()) for (const cell of cells) cell.textContent = '0';
      rover.transform.position.x = startX;
      roverPhysics.collisionMask = category.pad | (gateContact.checked ? category.gate : 0);
      roverPhysics.velocity.x = 140;
      run.disabled = true;
      gateContact.disabled = true;
      status.textContent = 'Rover moving.';
    });
    run.disabled = false;
    status.textContent = 'Ready for a pass.';
  },
  fixedUpdate() {
    const position = rover.transform.position;
    const returning = roverPhysics.velocity.x < 0 && position.x <= startX;
    const crossed = roverPhysics.velocity.x > 0 && position.x >= finishX;
    if (!returning && !crossed) return;

    position.x = returning ? startX : finishX;
    roverPhysics.velocity.x = 0;
    run.disabled = false;
    gateContact.disabled = false;
    status.textContent = returning ? 'The rover bounced off the gate.' : 'The rover passed through the gate.';
  },
}, { title: 'Collision filters | Dino GE', containerId: 'track', backgroundColour: '#203438' });
