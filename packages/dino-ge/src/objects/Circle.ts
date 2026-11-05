import Vector2 from '../math/Vector2.js';
import GameObject from '../core/GameObject.js';
import ShapeComponent from '../components/ShapeComponent.js';
import VisibilityComponent from '../components/VisibilityComponent.js';
import PhysicsComponent from '../components/PhysicsComponent.js';

/**
 * Configuration for creating a Circle object.
 */
export interface CircleProps {
  /** Unique tag for identification. */
  tag?: string;
  /** Hidden identifier linking runtime object to its source code location. */
  __sourceId?: string;
  /** Initial position of the circle. */
  position: Vector2;
  /** Initial rotation in radians. */
  rotation?: number;
  /** Radius of the circle. */
  radius: number;
  /** Fill colour. */
  colour?: string;
  /** Render order (lower is background). */
  zIndex?: number;
  /** Whether the circle is initially visible. */
  visible?: boolean;
  /** Initial physics configuration. */
  physics?: {
    velocity?: Vector2;
    acceleration?: Vector2;
    mass?: number;
    isStatic?: boolean;
    restitution?: number;
    friction?: number;
    isSensor?: boolean;
  };
}

const defaultProps = {
  tag: 'circle',
  colour: 'black',
  zIndex: 0,
};

/**
 * A basic circle shape that can be drawn to the screen.
 */
export default class Circle extends GameObject {
  private readonly shape: ShapeComponent;

  /** Radius of the circle in local space. */
  public get radius(): number { return this.shape.width; }
  public set radius(value: number) { this.shape.width = value; }

  /** Fill colour (CSS colour string). */
  public get colour(): string { return this.shape.colour; }
  public set colour(value: string) { this.shape.colour = value; }

  /**
   * The centre point of the circle in world space.
   */
  public get centre(): Vector2 {
    const { worldPosition, worldScale, worldRotation } = this.transform;
    const x = this.radius * worldScale.x;
    const y = this.radius * worldScale.y;
    const cos = Math.cos(worldRotation);
    const sin = Math.sin(worldRotation);
    return new Vector2(worldPosition.x + x * cos - y * sin, worldPosition.y + x * sin + y * cos);
  }

  /**
   * The radius of the circle in world space (accounting for scale).
   */
  public get worldRadius(): number {
    return Math.abs(this.radius * this.transform.worldScale.x);
  }

  /**
   * initialises a new instance of a Circle.
   * @param props Configuration properties for the circle.
   */
  constructor(props: CircleProps) {
    super(props.tag || defaultProps.tag, props.zIndex || defaultProps.zIndex, props.__sourceId);

    const defaultedProps = {
      ...defaultProps,
      ...props
    };

    if (!(defaultedProps.position instanceof Vector2)) {
      throw new Error('"position" must be a Vector2!');
    }

    if (!defaultedProps.radius) {
      throw new Error('You must provide a radius for Circle');
    }

    this.metadata.tag = defaultedProps.tag;
    this.transform.position = defaultedProps.position;
    this.transform.rotation = defaultedProps.rotation ?? 0;
    this.metadata.zIndex = defaultedProps.zIndex;

    // ShapeComponent will automatically create the BoundsComponent (radius * 2) via onAttach
    this.shape = new ShapeComponent('circle', defaultedProps.colour, defaultedProps.radius, defaultedProps.radius);
    this.addComponent(this.shape);

    this.addComponent(new VisibilityComponent(props.visible ?? true));

    if (props.physics) {
      const pc = new PhysicsComponent();
      if (props.physics.velocity) pc.velocity.copy(props.physics.velocity);
      if (props.physics.acceleration) pc.acceleration.copy(props.physics.acceleration);
      if (props.physics.mass !== undefined) pc.mass = props.physics.mass;
      if (props.physics.isStatic !== undefined) pc.isStatic = props.physics.isStatic;
      if (props.physics.restitution !== undefined) pc.restitution = props.physics.restitution;
      if (props.physics.friction !== undefined) pc.friction = props.physics.friction;
      if (props.physics.isSensor !== undefined) pc.isSensor = props.physics.isSensor;
      this.addComponent(pc);
    }

    this.registerSelf();
  }
}
