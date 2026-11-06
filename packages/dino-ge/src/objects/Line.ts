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
  /** CSS stroke colour. An empty value uses the canvas stroke style. */
  colour?: string;
  /** Transform origin for local endpoints. Defaults to p1 for existing lines. */
  position?: Vector2;
  /** Initial rotation in radians. */
  rotation?: number;
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
    collisionCategory?: number;
    collisionMask?: number;
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
  private readonly lineComponent: LineComponent;

  /** Stroke width of the line in pixels. */
  get strokeWidth(): number { return this.lineComponent.strokeWidth; }
  set strokeWidth(value: number) { this.lineComponent.strokeWidth = value; }

  /** CSS stroke colour. An empty value uses the canvas stroke style. */
  get colour(): string | undefined { return this.lineComponent.colour; }
  set colour(value: string | undefined) { this.lineComponent.colour = value; }

  /** Start x coordinate relative to the line's transform. */
  get x1(): number { return this.lineComponent.p1.x; }
  set x1(value: number) {
    this.lineComponent.p1.x = value;
    this.updateBounds();
  }

  /** Start y coordinate relative to the line's transform. */
  get y1(): number { return this.lineComponent.p1.y; }
  set y1(value: number) {
    this.lineComponent.p1.y = value;
    this.updateBounds();
  }

  /** End x coordinate relative to the line's transform. */
  get x2(): number { return this.lineComponent.p2.x; }
  set x2(value: number) {
    this.lineComponent.p2.x = value;
    this.updateBounds();
  }

  /** End y coordinate relative to the line's transform. */
  get y2(): number { return this.lineComponent.p2.y; }
  set y2(value: number) {
    this.lineComponent.p2.y = value;
    this.updateBounds();
  }

  /** Move the line's local origin while keeping both endpoints relative to it. */
  setOrigin(x: number, y: number) {
    const { position } = this.transform;
    if (position.x === x && position.y === y) return;
    if (position === this.lineComponent.p1 || position === this.lineComponent.p2) {
      this.transform.position = new Vector2(x, y);
    } else {
      position.set(x, y);
    }
  }

  /** Move one local endpoint without moving the line's origin or its other endpoint. */
  setEndpoint(endpoint: 'p1' | 'p2', x: number, y: number) {
    const line = this.lineComponent;
    const point = line[endpoint];
    if (point.x === x && point.y === y) return;
    if (point === this.transform.position || line.p1 === line.p2) {
      line[endpoint] = new Vector2(x, y);
    } else {
      point.set(x, y);
    }
    this.updateBounds();
  }

  private updateBounds() {
    const bounds = this.bounds;
    if (!bounds) return;
    bounds.width = Math.abs(this.x2 - this.x1);
    bounds.height = Math.abs(this.y2 - this.y1);
  }

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
    this.lineComponent = new LineComponent(defaultedProps.width, defaultedProps.p1, defaultedProps.p2, props.colour);
    this.metadata.zIndex = defaultedProps.zIndex;
    this.transform.position = defaultedProps.position ?? defaultedProps.p1;
    this.transform.rotation = defaultedProps.rotation ?? 0;

    const width = Math.abs(this.x2 - this.x1);
    const height = Math.abs(this.y2 - this.y1);
    this.bounds = new BoundsComponent(width, height);
    this.addComponent(this.bounds);

    this.addComponent(this.lineComponent);

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
      if (props.physics.collisionCategory !== undefined) pc.collisionCategory = props.physics.collisionCategory;
      if (props.physics.collisionMask !== undefined) pc.collisionMask = props.physics.collisionMask;
      this.addComponent(pc);
    }

    this.registerSelf();
  }
}
