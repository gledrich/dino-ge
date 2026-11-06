import Engine from '../core/Engine.js';
import GameObject from '../core/GameObject.js';
import Vector2 from '../math/Vector2.js';
import Input from '../core/Input.js';
import TextComponent from '../components/TextComponent.js';
import VisibilityComponent from '../components/VisibilityComponent.js';
import PhysicsComponent from '../components/PhysicsComponent.js';

/** Horizontal alignment options for text. */
export type HorizontalAlign = 'left' | 'right' | 'centre' | 'start' | 'end';
/** Vertical alignment options for text. */
export type VerticalAlign =
  | 'top'
  | 'hanging'
  | 'middle'
  | 'alphabetic'
  | 'ideographic'
  | 'bottom';

/**
 * Configuration for creating a Text object.
 */
export interface TextProperties {
  /** Unique tag for identification. */
  tag?: string;
  /** Hidden identifier linking runtime object to its source code location. */
  __sourceId?: string;
  /** Fill colour of the text. */
  colour?: string;
  /** Optional background box colour. */
  backgroundColour?: string;
  /** Font size in pixels. */
  fontSize?: string;
  /** Font family (e.g., 'Arial', 'Helvetica'). */
  font?: string;
  /** The text content to display. */
  text: string;
  /** Horizontal alignment relative to the position. */
  horizontalAlign?: HorizontalAlign;
  /** Vertical alignment relative to the position. */
  verticalAlign?: VerticalAlign;
  /** Anchor position for the text. */
  position: Vector2;
  /** Initial rotation in radians. */
  rotation?: number;
  /** Optional width for background box. */
  width?: number;
  /** Optional height for background box. */
  height?: number;
  /** Render order. */
  zIndex?: number;
  /** Whether to register with the engine immediately. */
  register?: boolean;
  /** Callback for click events. */
  onClick?: () => void;
  /** Whether the text is initially visible. */
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
  tag: 'text',
  colour: 'black',
  fontSize: '25', // px
  font: 'Helvetica',
  text: '',
  horizontalAlign: 'centre',
  verticalAlign: 'middle',
  position: new Vector2(0, 0),
  zIndex: 0,
  register: true,
};

/**
 * Represents text that can be drawn to the screen and interact with input.
 */
export default class Text extends GameObject {
  #onMouseClick;
  /** Internal text component. */
  private _textComponent: TextComponent;

  /** Text fill colour. */
  get colour(): string { return this._textComponent.colour; }
  set colour(val: string) { this._textComponent.colour = val; }

  /** Background box colour. */
  public get backgroundColour(): string { return this._textComponent.backgroundColour; }
  public set backgroundColour(val: string) { this._textComponent.backgroundColour = val; }

  /** Font size in pixels. */
  public fontSize: number;

  /** Compiled font string (e.g., '25px Helvetica'). */
  public get font(): string { return this._textComponent.font; }
  public set font(val: string) { this._textComponent.font = val; }

  /** The text content. */
  public get text(): string { return this._textComponent.text; }
  public set text(val: string) {
    this._textComponent.text = val;
    this.length = val.length;
  }

  /** Number of characters in the text string. */
  public length: number;

  /** Horizontal alignment ('left', 'centre', 'right'). */
  public get horizontalAlign(): HorizontalAlign { return this._textComponent.horizontalAlign; }
  public set horizontalAlign(val: HorizontalAlign) { this._textComponent.horizontalAlign = val; }

  /** Vertical alignment ('top', 'middle', 'bottom'). */
  public get verticalAlign(): VerticalAlign { return this._textComponent.verticalAlign; }
  public set verticalAlign(val: VerticalAlign) { this._textComponent.verticalAlign = val; }

  /** Whether the object should be automatically registered with the engine. */
  public register: boolean = true;
  /** Whether the object is currently registered with the engine. */
  public registered: boolean = false;

  /** 
   * Callback function for click events.
   * Only triggered if the object is registered.
   */
  public onClick: () => void = function defaultOnClick() {};

  /**
   * initialises a new instance of a Text object.
   * @param props Configuration properties for the text.
   */
  constructor(props: TextProperties) {
    super(props.tag || defaultProps.tag, props.zIndex || defaultProps.zIndex, props.__sourceId);

    const defaultedProps = {
      ...defaultProps,
      ...props,
    };

    this.fontSize = parseInt(defaultedProps.fontSize, 10);
    const font = `${this.fontSize}px ${defaultedProps.font}`;
    const text = defaultedProps.text;
    this.length = defaultedProps.text.length;
    this.transform.position = defaultedProps.position;
    this.transform.rotation = defaultedProps.rotation ?? 0;
    const horizontalAlign: HorizontalAlign = defaultedProps.horizontalAlign as HorizontalAlign;
    const verticalAlign: VerticalAlign = defaultedProps.verticalAlign as VerticalAlign;
    const width = defaultedProps.width || this.fontSize * this.length;
    const height = defaultedProps.height || this.fontSize * 2;
    const backgroundColour = defaultedProps.backgroundColour || '';
    
    this.#onMouseClick = this.#mouseClick.bind(this);
    
    if (props.onClick) {
      this.onClick = props.onClick;
    }

    this._textComponent = new TextComponent(
      text,
      font,
      defaultedProps.colour,
      horizontalAlign,
      verticalAlign,
      width,
      height,
      backgroundColour
    );
    // TextComponent will automatically create/update BoundsComponent via onAttach
    this.addComponent(this._textComponent);

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
      if (props.physics.collisionCategory !== undefined) pc.collisionCategory = props.physics.collisionCategory;
      if (props.physics.collisionMask !== undefined) pc.collisionMask = props.physics.collisionMask;
      this.addComponent(pc);
    }

    if (defaultedProps.register) {
      this.registerSelf();
    }
  }

  /** Registers the text object with the engine for rendering and interaction. */
  registerSelf() {
    if (!this.registered) {
      Input.addClickListener(this.#onMouseClick);
      Engine.registerObject(this);
      this.registered = true;
    }
  }

  /** Removes the text object from the engine. */
  destroySelf() {
    if (this.registered) {
      Input.removeClickListener(this.#onMouseClick);
      Engine.destroyObject(this);
      this.registered = false;
    }
  }

  #mouseClick(pos: Vector2) {
    const width = this.bounds?.width ?? 0;
    const height = this.bounds?.height ?? 0;
    const { worldPosition } = this.transform;
    if (
      pos.x > worldPosition.x &&
      pos.x < worldPosition.x + width &&
      pos.y > worldPosition.y &&
      pos.y < worldPosition.y + height
    ) {
      if (this.onClick) {
        this.onClick();
      }
    }
  }
}
