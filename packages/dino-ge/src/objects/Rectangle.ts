import Vector2 from '../math/Vector2.js';
import GameObject from '../core/GameObject.js';
import ShapeComponent from '../components/ShapeComponent.js';
import VisibilityComponent from '../components/VisibilityComponent.js';
import PhysicsComponent from '../components/PhysicsComponent.js';

/**
 * Configuration for creating a Rectangle object.
 */
export interface RectProps {
  /** Unique tag for identification. */
  tag?: string;
  /** Hidden identifier linking runtime object to its source code location. */
  __sourceId?: string;
  /** Initial position of the top-left corner. */
  position: Vector2;
  /** Initial rotation in radians. */
  rotation?: number;
  /** Width of the rectangle. */
  width: number;
  /** Height of the rectangle. */
  height: number;
  /** Fill colour. */
  colour?: string;
  /** Render order. */
  zIndex?: number;
  /** Whether the rectangle is initially visible. */
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
  tag: 'rect', colour: 'black', zIndex: 0,
}

/**
 * A basic rectangle shape that can be drawn to the screen.
 */
export default class Rectangle extends GameObject {
  private readonly shape: ShapeComponent;

  /** Fill colour (CSS colour string). */
  public get colour(): string { return this.shape.colour; }
  public set colour(value: string) { this.shape.colour = value; }

  /**
   * initialises a new instance of a Rectangle.
   * @param props Configuration properties for the rectangle.
   */
  constructor(props: RectProps) {
    super(props.tag || defaultProps.tag, props.zIndex || defaultProps.zIndex, props.__sourceId);
    
    const defaultedProps = {
      ...defaultProps,
      ...props
    }

    if (!(defaultedProps.position instanceof Vector2)) {
      throw new Error('"position" must be a Vector2!');
    }

    if (!defaultedProps.width || !defaultedProps.height) {
      throw new Error('You must provide a width and height for Rectangle');
    }

    this.metadata.tag = defaultedProps.tag;
    this.transform.position = defaultedProps.position;
    this.transform.rotation = defaultedProps.rotation ?? 0;
    this.metadata.zIndex = defaultedProps.zIndex;

    // ShapeComponent will automatically create the BoundsComponent via onAttach
    this.shape = new ShapeComponent('rect', defaultedProps.colour, defaultedProps.width, defaultedProps.height);
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
