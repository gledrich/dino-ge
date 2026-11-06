import Component from '../core/Component.js';

/**
 * Component that determines whether an object should be rendered.
 */
export default class VisibilityComponent extends Component {
  /** Whether the object should be rendered. */
  visible: boolean;
  private _opacity = 1;

  /** The rendered opacity between zero (transparent) and one (opaque). */
  get opacity(): number { return this._opacity; }
  set opacity(value: number) {
    if (Number.isFinite(value)) this._opacity = Math.max(0, Math.min(1, value));
  }

  constructor(visible: boolean = true) {
    super();
    this.visible = visible;
  }
}
