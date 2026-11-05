import GameObject from '../core/GameObject.js';
import Vector2 from '../math/Vector2.js';
import LineComponent from '../components/LineComponent.js';
import BoundsComponent from '../components/BoundsComponent.js';
import VisibilityComponent from '../components/VisibilityComponent.js';
import PhysicsComponent from '../components/PhysicsComponent.js';

/**
 * Configuration for creating a Line object.
 */
export interface LineProperties {
  /** Unique tag for identification. */
  tag?: string;
  /** Hidden identifier linking runtime object to its source code location. */
  __sourceId?: string;
  /** Stroke width of the line. */
  width?: number;
  /** Transform origin for local endpoints. Defaults to p1 for existing lines. */
  position?: Vector2;
  /** Start point of the line. */
  p1: Vector2;
  /** End point of the line. */
  p2: Vector2;
  /** Render order (lower is background). */
  zIndex?: number;
  /** Whether the line is initially visible. */
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
  tag: 'line',
  width: 1,
  zIndex: 0,
  p1: new Vector2(),
  p2: new Vector2(),
};

/**
 * A basic line object that can be drawn between two points.
 */
export default class Line extends GameObject {
  /** Stroke width of the line in pixels. */
  public strokeWidth: number;
  /** Start x coordinate in world space. */
  public x1: number;
  /** Start y coordinate in world space. */
  public y1: number;
  /** End x coordinate in world space. */
  public x2: number;
  /** End y coordinate in world space. */
  public y2: number;

  /** Gets the starting position of the line as a Vector2. */
  public get startPosition(): Vector2 { return new Vector2(this.x1, this.y1); }

  /**
   * initialises a new instance of a Line.
   * @param props Configuration properties for the line.
   */
  constructor(props: LineProperties) {
    super(props.tag || defaultProps.tag, props.zIndex || defaultProps.zIndex, props.__sourceId);

    const defaultedProps = {
      ...defaultProps,
      ...props,
    };

    this.metadata.tag = defaultedProps.tag;
    this.strokeWidth = defaultedProps.width;
    this.x1 = defaultedProps.p1.x;
    this.y1 = defaultedProps.p1.y;
    this.x2 = defaultedProps.p2.x;
    this.y2 = defaultedProps.p2.y;
    this.metadata.zIndex = defaultedProps.zIndex;
    this.transform.position = defaultedProps.position ?? defaultedProps.p1;

    const width = Math.abs(this.x2 - this.x1);
    const height = Math.abs(this.y2 - this.y1);
    this.bounds = new BoundsComponent(width, height);
    this.addComponent(this.bounds);

    this.addComponent(new LineComponent(this.strokeWidth, defaultedProps.p1, defaultedProps.p2));

    if (props.visible !== undefined) {
      this.addComponent(new VisibilityComponent(props.visible));
    }

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
