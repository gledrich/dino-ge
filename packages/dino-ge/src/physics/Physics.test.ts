import Physics from './Physics.js';
import Rectangle from '../objects/Rectangle.js';
import Circle from '../objects/Circle.js';
import Vector2 from '../math/Vector2.js';
import PhysicsComponent from '../components/PhysicsComponent.js';
import BoundsComponent from '../components/BoundsComponent.js';
import GameObject from '../core/GameObject.js';
import Engine from '../core/Engine.js';

describe('Physics', () => {
  describe('checkCollision - Rectangle vs Rectangle', () => {
    it('returns true when rectangles overlap', () => {
      const r1 = new Rectangle({
        position: new Vector2(0, 0),
        width: 50,
        height: 50
      });
      const r2 = new Rectangle({
        position: new Vector2(25, 25),
        width: 50,
        height: 50
      });
      expect(Physics.checkCollision(r1, r2)).toBe(true);
    });

    it('returns false when rectangles do not overlap', () => {
      const r1 = new Rectangle({
        position: new Vector2(0, 0),
        width: 50,
        height: 50
      });
      const r2 = new Rectangle({
        position: new Vector2(100, 100),
        width: 50,
        height: 50
      });
      expect(Physics.checkCollision(r1, r2)).toBe(false);
    });
  });

  it('applies filters to manual collision checks without changing geometry queries', () => {
    const first = new Rectangle({ position: new Vector2(0, 0), width: 10, height: 10 });
    const second = new Rectangle({ position: new Vector2(5, 0), width: 10, height: 10 });
    const body = new PhysicsComponent();
    first.addComponent(body);
    body.collisionMask = 0;
    const collision = jest.fn();
    const start = jest.fn();
    first.on('collision', collision);
    first.on('collisionStart', start);

    expect(Physics.getCollisionManifold(first, second)?.depth).toBe(5);
    expect(Physics.checkCollision(first, second)).toBe(false);
    expect(first.transform.position.x).toBe(0);
    expect(collision).not.toHaveBeenCalled();

    body.collisionMask = 0x1;
    expect(Physics.checkCollision(first, second)).toBe(true);
    expect(first.transform.position.x).toBeLessThan(0);
    expect(collision).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  });

  describe('checkCollision - Circle vs Circle', () => {
    it('returns true when circles overlap', () => {
      const c1 = new Circle({
        position: new Vector2(0, 0),
        radius: 10
      }); // centre (10, 10)
      const c2 = new Circle({
        position: new Vector2(10, 10),
        radius: 10
      }); // centre (20, 20)
      // Distance approx 14.14 < sum of radii (20)
      expect(Physics.checkCollision(c1, c2)).toBe(true);
    });

    it('returns false when circles do not overlap', () => {
      const c1 = new Circle({
        position: new Vector2(0, 0),
        radius: 10
      }); // centre (10, 10)
      const c2 = new Circle({
        position: new Vector2(30, 30),
        radius: 10
      }); // centre (40, 40)
      // Distance approx 42.4 > 20
      expect(Physics.checkCollision(c1, c2)).toBe(false);
    });
  });

  describe('checkCollision - Circle vs Rectangle', () => {
    it('returns true when circle and rectangle overlap', () => {
      const rect = new Rectangle({
        position: new Vector2(0, 0),
        width: 100,
        height: 100
      });
      const circle = new Circle({
        position: new Vector2(90, 90),
        radius: 20
      }); // centre (110, 110)
      expect(Physics.checkCollision(rect, circle)).toBe(true);
    });

    it('regression: maintains object order and normal direction for Rect vs Circle', () => {
      const rect = new Rectangle({
        position: new Vector2(0, 0),
        width: 50,
        height: 50
      });
      const circle = new Circle({
        position: new Vector2(40, 0),
        radius: 20
      }); 
      // Circle centre: (60, 20)
      // Rect: (0,0) to (50,50)
      // Closest point on rect: (50, 20)
      // Vector from rect to circle: (10, 0)
      // Normal should be (1, 0) pointing from rect to circle

      const manifold = Physics.getCollisionManifold(rect, circle);
      expect(manifold).not.toBeNull();
      expect(manifold!.obj1).toBe(rect);
      expect(manifold!.obj2).toBe(circle);
      expect(manifold!.normal.x).toBe(1);
      expect(manifold!.normal.y).toBe(0);

      // Verify resolution pushes them apart
      const initialRectX = rect.transform.position.x;
      const initialCircleX = circle.transform.position.x;
      
      // Add physics components to allow resolution
      rect.addComponent(new PhysicsComponent());
      circle.addComponent(new PhysicsComponent());
      
      Physics.checkCollision(rect, circle);
      
      // Rect should move left, Circle should move right
      expect(rect.transform.position.x).toBeLessThan(initialRectX);
      expect(circle.transform.position.x).toBeGreaterThan(initialCircleX);
    });

    it('resolves correctly when circle centre is inside rectangle', () => {
      const rect = new Rectangle({
        position: new Vector2(0, 0),
        width: 100,
        height: 100
      });
      const circle = new Circle({
        position: new Vector2(0, 0), // centre (10, 10) - inside rect
        radius: 10
      });

      rect.addComponent(new PhysicsComponent());
      circle.addComponent(new PhysicsComponent());

      const initialCircleX = circle.transform.position.x;

      Physics.checkCollision(rect, circle);

      // Circle centre (10, 10) is closest to left edge (x=0, dist=10)
      // and top edge (y=0, dist=10).
      // If it picks left edge (dLeft), it should be pushed LEFT.
      // initialCircleX=0, so new x should be < 0.
      expect(circle.transform.position.x).toBeLessThan(initialCircleX);
    });

    it('resolves collision when only one object has a PhysicsComponent', () => {
      const active = new Rectangle({ position: new Vector2(0, 0), width: 10, height: 10 });
      const stat = new Rectangle({ position: new Vector2(5, 0), width: 10, height: 10 });
      
      const pc = new PhysicsComponent();
      pc.velocity = new Vector2(10, 0);
      active.addComponent(pc);
      active.addComponent(new BoundsComponent(10, 10));
      stat.addComponent(new BoundsComponent(10, 10));

      Physics.checkCollision(active, stat);
      
      // active was moving RIGHT (10, 0) and hit stat (at x=5)
      // relative velocity (stat-active) = (-10, 0)
      // velAlongNormal (normal 1,0) = -10. separating? no.
      // it should be pushed BACK or have velocity reflected
      expect(pc.velocity.x).toBeLessThan(0);
    });

    it('does not resolve collision when objects are already separating in single-active-physics case', () => {
      const active = new Rectangle({ position: new Vector2(0, 0), width: 10, height: 10 });
      const stat = new Rectangle({ position: new Vector2(5, 0), width: 10, height: 10 });
      
      const pc = new PhysicsComponent();
      // Moving AWAY (Left) from stat (at x=5)
      pc.velocity = new Vector2(-10, 0);
      active.addComponent(pc);
      active.addComponent(new BoundsComponent(10, 10));
      stat.addComponent(new BoundsComponent(10, 10));

      Physics.checkCollision(active, stat);
      
      // velAlongNormal = Vector2.dot((-10,0) * -1, (1,0)) = dot((10,0), (1,0)) = 10
      // velAlongNormal > 0 means they are separating. 
      // Velocity should remain unchanged.
      expect(pc.velocity.x).toBe(-10);
    });

    it('does not resolve collision when velAlongNormal is exactly 0 in single-active-physics case', () => {
      const active = new Rectangle({ position: new Vector2(0, 0), width: 10, height: 10 });
      const stat = new Rectangle({ position: new Vector2(10, 0), width: 10, height: 10 });
      
      const pc = new PhysicsComponent();
      // Moving PERPENDICULAR (Up) to normal (Right)
      pc.velocity = new Vector2(0, -10);
      active.addComponent(pc);
      active.addComponent(new BoundsComponent(10, 10));
      stat.addComponent(new BoundsComponent(10, 10));

      Physics.checkCollision(active, stat);
      
      // Relative velocity = (0, 10). Normal = (1, 0). Dot = 0.
      expect(pc.velocity.y).toBe(-10);
    });

    it('resolves collision when only the second object has a PhysicsComponent', () => {
      const stat = new Rectangle({ position: new Vector2(0, 0), width: 10, height: 10 });
      const active = new Rectangle({ position: new Vector2(5, 0), width: 10, height: 10 });
      
      const pc = new PhysicsComponent();
      // Moving LEFT (-10, 0) towards stat (at x=0)
      pc.velocity = new Vector2(-10, 0);
      active.addComponent(pc);
      active.addComponent(new BoundsComponent(10, 10));
      stat.addComponent(new BoundsComponent(10, 10));

      // Normal will be (1, 0) from stat to active
      Physics.checkCollision(stat, active);
      
      // phys1 is null, phys2 is active. 
      // n = normal * -1 = (-1, 0) (from active to static)
      // rv = active.velocity * -1 = (10, 0)
      // velAlongNormal = dot((10,0), (-1,0)) = -10.
      expect(pc.velocity.x).toBeGreaterThan(0); // Should be pushed back RIGHT
    });

    it('resolves collision when both objects have physics but one is static', () => {
      const active = new Rectangle({ position: new Vector2(0, 0), width: 10, height: 10 });
      const stat = new Rectangle({ position: new Vector2(5, 0), width: 10, height: 10 });
      
      const pc1 = new PhysicsComponent();
      pc1.velocity = new Vector2(10, 0);
      active.addComponent(pc1);
      active.addComponent(new BoundsComponent(10, 10));

      const pc2 = new PhysicsComponent();
      pc2.isStatic = true;
      stat.addComponent(pc2);
      stat.addComponent(new BoundsComponent(10, 10));

      Physics.checkCollision(active, stat);
      
      expect(pc1.velocity.x).toBeLessThan(0); // active should be pushed back
      expect(pc2.velocity.x).toBe(0); // static should not move
    });

    it('resolves collision when both objects have physics but the FIRST one is static', () => {
      const stat = new Rectangle({ position: new Vector2(0, 0), width: 10, height: 10 });
      const active = new Rectangle({ position: new Vector2(5, 0), width: 10, height: 10 });
      
      const pc1 = new PhysicsComponent();
      pc1.isStatic = true;
      stat.addComponent(pc1);
      stat.addComponent(new BoundsComponent(10, 10));

      const pc2 = new PhysicsComponent();
      pc2.velocity = new Vector2(-10, 0);
      active.addComponent(pc2);
      active.addComponent(new BoundsComponent(10, 10));

      Physics.checkCollision(stat, active);
      
      expect(pc1.velocity.x).toBe(0); // static should not move
      expect(pc2.velocity.x).toBeGreaterThan(0); // active should be pushed back
    });

    it('does not resolve collision when NEITHER object has a PhysicsComponent', () => {
      const obj1 = new Rectangle({ position: new Vector2(0, 0), width: 10, height: 10 });
      const obj2 = new Rectangle({ position: new Vector2(5, 0), width: 10, height: 10 });
      
      obj1.addComponent(new BoundsComponent(10, 10));
      obj2.addComponent(new BoundsComponent(10, 10));

      const pos1 = obj1.transform.position.clone();
      const pos2 = obj2.transform.position.clone();

      // This should hit the 'else' (doing nothing) after 'if (phys1 && phys2)' and 'else if (phys1 || phys2)'
      Physics.checkCollision(obj1, obj2);
      
      expect(obj1.transform.position.x).toBe(pos1.x);
      expect(obj2.transform.position.x).toBe(pos2.x);
    });

    it('handles collision with only second object having a STATIC PhysicsComponent', () => {
      const obj1 = new Rectangle({ position: new Vector2(0, 0), width: 10, height: 10 });
      const obj2 = new Rectangle({ position: new Vector2(5, 0), width: 10, height: 10 });
      
      obj1.addComponent(new BoundsComponent(10, 10));
      const pc2 = new PhysicsComponent();
      // Keep it active (not static) so it can be pushed
      pc2.isStatic = false;
      obj2.addComponent(pc2);
      obj2.addComponent(new BoundsComponent(10, 10));

      const pos1 = obj1.transform.position.clone();
      const pos2 = obj2.transform.position.clone();

      Physics.checkCollision(obj1, obj2);
      
      // obj1 has no physics, obj2 has active physics. 
      // Resolve should do positional correction if they overlap.
      // obj2 should be pushed away from obj1 (to the right).
      expect(obj1.transform.position.x).toBe(pos1.x);
      expect(obj2.transform.position.x).toBeGreaterThan(pos2.x);
    });

    it('resolves collision when only second object has physics (v2)', () => {
      const obj1 = new Rectangle({ position: new Vector2(0, 0), width: 10, height: 10 });
      const obj2 = new Rectangle({ position: new Vector2(5, 0), width: 10, height: 10 });
      
      obj1.addComponent(new BoundsComponent(10, 10));
      const pc2 = new PhysicsComponent();
      pc2.velocity = new Vector2(-10, 0); // Moving towards obj1
      obj2.addComponent(pc2);
      obj2.addComponent(new BoundsComponent(10, 10));

      Physics.checkCollision(obj1, obj2);
      
      // phys1=null, phys2=pc2. 
      // This should hit else if (phys1 || phys2) -> true
      // activePhys = pc2
      // n = phys1 ? normal : normal * -1 -> normal * -1
      expect(pc2.velocity.x).toBeGreaterThan(0);
    });

    it('does not resolve collision between two objects without PhysicsComponents', () => {
      const r1 = new Rectangle({ position: new Vector2(0, 0), width: 50, height: 50 });
      const r2 = new Rectangle({ position: new Vector2(25, 25), width: 50, height: 50 });
      
      // No PhysicsComponents added
      const pos1 = r1.transform.position.clone();
      const pos2 = r2.transform.position.clone();

      expect(Physics.checkCollision(r1, r2)).toBe(true);
      expect(r1.transform.position.x).toBe(pos1.x);
      expect(r2.transform.position.x).toBe(pos2.x);
    });

    it('returns false when circle and rectangle do not overlap', () => {
      const rect = new Rectangle({
        position: new Vector2(0, 0),
        width: 50,
        height: 50
      });
      const circle = new Circle({
        position: new Vector2(100, 100),
        radius: 10
      });
      expect(Physics.checkCollision(rect, circle)).toBe(false);
    });
  });

  describe('Collision Resolution', () => {
    it('resolves collision by pushing objects apart', () => {
      const r1 = new Rectangle({
        position: new Vector2(0, 0),
        width: 50,
        height: 50
      });
      const r2 = new Rectangle({
        position: new Vector2(40, 0),
        width: 50,
        height: 50
      });

      // Static objects don't move
      r1.addComponent(new PhysicsComponent());
      r1.getComponent(PhysicsComponent)!.isStatic = true;

      r2.addComponent(new PhysicsComponent());

      const initialR2X = r2.transform.position.x;
      Physics.checkCollision(r1, r2);

      // r2 should have been pushed right
      expect(r2.transform.position.x).toBeGreaterThan(initialR2X);
      // r1 should remain at 0
      expect(r1.transform.position.x).toBe(0);
    });

    it('applies impulse to change velocities on collision', () => {
      const r1 = new Rectangle({
        position: new Vector2(0, 0),
        width: 50,
        height: 50
      });
      const r2 = new Rectangle({
        position: new Vector2(40, 0),
        width: 50,
        height: 50
      });

      const phys1 = new PhysicsComponent();
      phys1.velocity = new Vector2(100, 0);
      r1.addComponent(phys1);

      const phys2 = new PhysicsComponent();
      phys2.velocity = new Vector2(-100, 0);
      r2.addComponent(phys2);

      Physics.checkCollision(r1, r2);

      // With restitution 0.5 (default), they should bounce back
      // Relative velocity was 200. After impulse it should be reversed and scaled by e.
      expect(phys1.velocity.x).toBeLessThan(100);
      expect(phys2.velocity.x).toBeGreaterThan(-100);
    });

    it('records collisions in debug mode and caps history', () => {
      Engine.debug = true;
      (Engine as unknown as { debugCollisions: unknown[] }).debugCollisions.length = 0;
      
      const r1 = new Rectangle({ position: new Vector2(0, 0), width: 50, height: 50 });
      const r2 = new Rectangle({ position: new Vector2(10, 0), width: 50, height: 50 });

      Physics.checkCollision(r1, r2);
      expect(Engine.debugCollisions.length).toBe(1);

      // Fill up to cap (50)
      for (let i = 0; i < 60; i++) {
        Physics.checkCollision(r1, r2);
      }
      expect(Engine.debugCollisions.length).toBe(50);

      Engine.debug = false;
      Engine.debugCollisions.length = 0;
    });

    it('respects restitution (bounciness) values', () => {
      const r1 = new Rectangle({ position: new Vector2(0, 0), width: 50, height: 50 });
      const r2 = new Rectangle({ position: new Vector2(40, 0), width: 50, height: 50 });

      const phys1 = new PhysicsComponent();
      phys1.velocity = new Vector2(100, 0);
      phys1.restitution = 1.0; // Perfectly elastic
      r1.addComponent(phys1);

      const phys2 = new PhysicsComponent();
      phys2.velocity = new Vector2(0, 0);
      phys2.restitution = 1.0;
      phys2.isStatic = true;
      r2.addComponent(phys2);

      Physics.checkCollision(r1, r2);

      // Should bounce back with exactly same speed (100 -> -100)
      expect(phys1.velocity.x).toBeCloseTo(-100);
    });

    it('does not resolve collision between two static objects', () => {
      const r1 = new Rectangle({ position: new Vector2(0, 0), width: 50, height: 50 });
      const r2 = new Rectangle({ position: new Vector2(25, 0), width: 50, height: 50 });

      const p1 = new PhysicsComponent(); p1.isStatic = true;
      const p2 = new PhysicsComponent(); p2.isStatic = true;
      r1.addComponent(p1);
      r2.addComponent(p2);

      const pos1 = r1.transform.position.clone();
      const pos2 = r2.transform.position.clone();

      expect(Physics.checkCollision(r1, r2)).toBe(true);
      expect(r1.transform.position.x).toBe(pos1.x);
      expect(r2.transform.position.x).toBe(pos2.x);
    });

    it('does not apply impulse if velocities are separating', () => {
      const r1 = new Rectangle({ position: new Vector2(0, 0), width: 50, height: 50 });
      const r2 = new Rectangle({ position: new Vector2(40, 0), width: 50, height: 50 });

      const phys1 = new PhysicsComponent();
      phys1.velocity = new Vector2(-100, 0); // Moving left, away from r2
      r1.addComponent(phys1);

      const phys2 = new PhysicsComponent();
      phys2.velocity = new Vector2(100, 0); // Moving right, away from r1
      r2.addComponent(phys2);

      Physics.checkCollision(r1, r2);

      expect(phys1.velocity.x).toBe(-100);
      expect(phys2.velocity.x).toBe(100);
    });

    it('resolves collision when only one object has a PhysicsComponent', () => {
      const r1 = new Rectangle({
        position: new Vector2(0, 0),
        width: 50,
        height: 50
      });
      const r2 = new Rectangle({
        position: new Vector2(40, 0),
        width: 50,
        height: 50
      });

      const phys1 = new PhysicsComponent();
      phys1.velocity = new Vector2(100, 0);
      r1.addComponent(phys1);
      // r2 has no PhysicsComponent

      Physics.checkCollision(r1, r2);
      expect(phys1.velocity.x).toBeLessThan(100);

      // Other way around
      const r3 = new Rectangle({ position: new Vector2(0, 0), width: 50, height: 50 });
      const r4 = new Rectangle({ position: new Vector2(40, 0), width: 50, height: 50 });
      const phys4 = new PhysicsComponent();
      phys4.velocity = new Vector2(-100, 0);
      r4.addComponent(phys4);

      Physics.checkCollision(r3, r4);
      expect(phys4.velocity.x).toBeGreaterThan(-100);
    });

    it('emits collision events on colliding objects', () => {
      const r1 = new Rectangle({ position: new Vector2(0, 0), width: 50, height: 50 });
      const r2 = new Rectangle({ position: new Vector2(25, 0), width: 50, height: 50 });

      const onCollision1 = jest.fn();
      const onCollision2 = jest.fn();

      r1.on('collision', onCollision1);
      r2.on('collision', onCollision2);

      Physics.checkCollision(r1, r2);

      expect(onCollision1).toHaveBeenCalledTimes(1);
      expect(onCollision2).toHaveBeenCalledTimes(1);

      const eventDetail = onCollision1.mock.calls[0][0].detail;
      expect(eventDetail.other).toBe(r2);
      expect(eventDetail.manifold).toBeDefined();
    });

    it('does not resolve collision if one object is a sensor but still emits events', () => {
      const r1 = new Rectangle({ position: new Vector2(0, 0), width: 50, height: 50 });
      const r2 = new Rectangle({ position: new Vector2(25, 0), width: 50, height: 50 });

      const p1 = new PhysicsComponent();
      p1.isSensor = true;
      r1.addComponent(p1);

      const p2 = new PhysicsComponent();
      r2.addComponent(p2);

      const pos1 = r1.transform.position.clone();
      const pos2 = r2.transform.position.clone();
      const onCollision = jest.fn();
      r1.on('collision', onCollision);

      expect(Physics.checkCollision(r1, r2)).toBe(true);

      // Positions should not have changed
      expect(r1.transform.position.x).toBe(pos1.x);
      expect(r2.transform.position.x).toBe(pos2.x);
      // Event should still have been emitted
      expect(onCollision).toHaveBeenCalledTimes(1);
    });
    });
  describe('Edge Cases and Branch Coverage', () => {
    it('flips normal correctly in Rect vs Circle', () => {
      const rect = new Rectangle({ position: new Vector2(0, 0), width: 50, height: 50 });
      const circle = new Circle({ position: new Vector2(40, 0), radius: 25 }); // centre (65, 25)

      const manifold = Physics.getCollisionManifold(rect, circle);
      expect(manifold).not.toBeNull();
      // Direction from rect to circle is positive X
      expect(manifold!.normal.x).toBeGreaterThan(0);
    });

    it('resolves AABB collision on X axis with 0 diff', () => {
      // Objects perfectly aligned on X centre.
      // width 50. r1 pos -25 (centre 0). r2 pos -20 (centre 5). diff.x = 5.
      // To get diff.x = 0, they must have same centre X.
      const r1 = new Rectangle({ position: new Vector2(0, 0), width: 50, height: 100 });
      const r2 = new Rectangle({ position: new Vector2(0, 40), width: 50, height: 100 });
      // overlapX = 50. overlapY = 100 - 40 = 60.
      // overlapX < overlapY is TRUE. 50 < 60.
      // diff.x = 0. Hits -1 branch.
      const manifold = Physics.getCollisionManifold(r1, r2);
      expect(manifold!.normal.x).toBe(-1);
    });

    it('resolves AABB collision on Y axis with 0 diff', () => {
      const r1 = new Rectangle({ position: new Vector2(0, 0), width: 100, height: 50 });
      const r2 = new Rectangle({ position: new Vector2(40, 0), width: 100, height: 50 });
      // overlapX = 100 - 40 = 60. overlapY = 50.
      // overlapX < overlapY is FALSE. 60 < 50 is False.
      // diff.y = 0. Hits -1 branch for Y normal.
      const manifold = Physics.getCollisionManifold(r1, r2);
      expect(manifold!.normal.y).toBe(-1);
    });

    it('resolves AABB collision on Y axis if overlaps are equal', () => {
      const r1 = new Rectangle({ position: new Vector2(0, 0), width: 50, height: 50 });
      const r2 = new Rectangle({ position: new Vector2(40, 40), width: 50, height: 50 });
      // overlapX = 50 - 40 = 10. overlapY = 50 - 40 = 10.
      // overlapX < overlapY is FALSE. Hits else branch (Y axis).
      const manifold = Physics.getCollisionManifold(r1, r2);
      expect(manifold!.normal.y).toBe(1);
    });

    it('handles perfectly overlapping circles', () => {
      const c1 = new Circle({ position: new Vector2(0, 0), radius: 10 });
      const c2 = new Circle({ position: new Vector2(0, 0), radius: 10 });
      const manifold = Physics.getCollisionManifold(c1, c2);
      expect(manifold!.normal.y).toBe(1); // Default normal
      expect(manifold!.depth).toBe(20);
    });

    it('resolves AABB collision on Y axis if it is the axis of least penetration', () => {
      const r1 = new Rectangle({ position: new Vector2(0, 0), width: 100, height: 50 });
      const r2 = new Rectangle({ position: new Vector2(0, 40), width: 100, height: 50 });
      // X overlap is 100, Y overlap is 10. Normal should be (0, 1)
      const manifold = Physics.getCollisionManifold(r1, r2);
      expect(manifold!.normal.x).toBe(0);
      expect(manifold!.normal.y).toBe(1);
    });

    it('resolves AABB collision on X axis if it is the axis of least penetration', () => {
      const r1 = new Rectangle({ position: new Vector2(0, 0), width: 50, height: 100 });
      const r2 = new Rectangle({ position: new Vector2(40, 0), width: 50, height: 100 });
      // X overlap is 10, Y overlap is 100. Normal should be (1, 0)
      const manifold = Physics.getCollisionManifold(r1, r2);
      expect(manifold!.normal.x).toBe(1);
      expect(manifold!.normal.y).toBe(0);

      // Test negative X direction
      const r3 = new Rectangle({ position: new Vector2(0, 0), width: 50, height: 100 });
      const r4 = new Rectangle({ position: new Vector2(-40, 0), width: 50, height: 100 });
      const manifold2 = Physics.getCollisionManifold(r3, r4);
      expect(manifold2!.normal.x).toBe(-1);
    });

    it('resolves AABB collision on Y axis with negative direction', () => {
      const r1 = new Rectangle({ position: new Vector2(0, 0), width: 100, height: 50 });
      const r2 = new Rectangle({ position: new Vector2(0, -40), width: 100, height: 50 });
      const manifold = Physics.getCollisionManifold(r1, r2);
      expect(manifold!.normal.y).toBe(-1);

      // Test positive Y direction
      const r3 = new Rectangle({ position: new Vector2(0, 0), width: 100, height: 50 });
      const r4 = new Rectangle({ position: new Vector2(0, 40), width: 100, height: 50 });
      const manifold2 = Physics.getCollisionManifold(r3, r4);
      expect(manifold2!.normal.y).toBe(1);
    });

    it('returns null for AABBs that only overlap on X axis', () => {
      const r1 = new Rectangle({ position: new Vector2(0, 0), width: 50, height: 50 });
      const r2 = new Rectangle({ position: new Vector2(0, 100), width: 50, height: 50 });
      expect(Physics.getCollisionManifold(r1, r2)).toBeNull();
    });

    it('returns early when single-object velocities are already separating', () => {
      const r1 = new Rectangle({ position: new Vector2(0, 0), width: 50, height: 50 });
      const r2 = new Rectangle({ position: new Vector2(40, 0), width: 50, height: 50 });

      const phys1 = new PhysicsComponent();
      phys1.velocity = new Vector2(-100, 0); // Moving left, away from r2
      r1.addComponent(phys1);

      const initialVel = phys1.velocity.clone();
      Physics.checkCollision(r1, r2);

      expect(phys1.velocity.x).toBe(initialVel.x);
    });

    it('handles circle centreed inside rectangle (all edges)', () => {
      const rect = new Rectangle({ position: new Vector2(0, 0), width: 100, height: 100 });

      // Closer to left
      const cLeft = new Circle({ position: new Vector2(0, 40), radius: 10 }); // centre (10, 50)
      let m = Physics.getCollisionManifold(cLeft, rect);
      expect(m!.normal.x).toBe(1);

      // Closer to right
      const cRight = new Circle({ position: new Vector2(80, 40), radius: 10 }); // centre (90, 50)
      m = Physics.getCollisionManifold(cRight, rect);
      expect(m!.normal.x).toBe(-1);

      // Closer to top
      const cTop = new Circle({ position: new Vector2(40, 0), radius: 10 }); // centre (50, 10)
      m = Physics.getCollisionManifold(cTop, rect);
      expect(m!.normal.y).toBe(1);

      // Closer to bottom
      const cBottom = new Circle({ position: new Vector2(40, 80), radius: 10 }); // centre (50, 90)
      m = Physics.getCollisionManifold(cBottom, rect);
      expect(m!.normal.y).toBe(-1);
    });

    it('handles collision where one object has no bounds component', () => {
      class NoBoundsObject extends GameObject { }
      const o1 = new NoBoundsObject('o1', 0);
      o1.transform.position = new Vector2(10, 10);

      const o2 = new Rectangle({ position: new Vector2(0, 0), width: 100, height: 100 });

      // o1 has no bounds (w1=0, h1=0). o2 has width 100, height 100.
      // centre1 = (10, 10). centre2 = (50, 50). diff = (40, 40).
      // overlapX = (0 + 50) - 40 = 10.
      // overlapY = (0 + 50) - 40 = 10.
      // Both positive
      const manifold = Physics.getCollisionManifold(o1, o2);
      expect(manifold).not.toBeNull();
      expect(manifold!.depth).toBe(10);
    });

    it('handles circleVsRect where rect has no bounds', () => {
      const circle = new Circle({ position: new Vector2(0, 0), radius: 10 });
      class NoBoundsObject extends GameObject {}
      const rect = new NoBoundsObject('rect', 0);
      rect.transform.position = new Vector2(5, 5);
      
      // rectWidth/rectHeight will be 0.
      // closestX = max(5, min(5, 5+0)) = 5
      // closestY = max(5, min(5, 5+0)) = 5
      // dist to (5,5) from centre (5,5) is 0.
      // distSq = 0. Hits dist === 0 branch.
      const manifold = Physics.getCollisionManifold(circle, rect);
      expect(manifold).not.toBeNull();
      // radius 10 - dist(centre(10,10) to closest(5,5) which is sqrt(50))
      // 10 - 7.071 = 2.9289...
      expect(manifold!.depth).toBeCloseTo(2.9289);
    });

    it('handles objects without bounds components', () => {
      class RawObject extends GameObject { }
      const o1 = new RawObject('o1', 0);
      const o2 = new RawObject('o2', 0);
      o1.transform.position = new Vector2(0, 0);
      o2.transform.position = new Vector2(0, 0);

      // Both at same pos, no bounds = width/height 0. Should return null or handle gracefully.
      expect(Physics.getCollisionManifold(o1, o2)).toBeNull();
    });
  });
});
