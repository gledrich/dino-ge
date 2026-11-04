import Component from '../core/Component.js';
import { getEngineState, notifySceneObjectChanged } from '../core/EngineState.js';

/**
 * Component that holds metadata like tags and rendering order.
 */
export default class TagComponent extends Component {
  /** A unique identifier for the object type. */
  get tag(): string { return this._tag; }
  set tag(value: string) {
    if (this._tag === value) return;
    this._tag = value;
    notifySceneObjectChanged(this.gameObject);
  }
  private _tag: string;
  /** Hidden identifier linking runtime object to its source code location. */
  sourceId?: string;
  private _zIndex: number;

  /** Rendering order (lower is background, higher is foreground). */
  get zIndex(): number { return this._zIndex; }
  set zIndex(val: number) {
    if (this._zIndex !== val) {
      this._zIndex = val;
      const state = getEngineState();
      if (state) {
        state.zOrderDirty = true;
      }
    }
  }

  constructor(tag: string = 'obj', zIndex: number = 0, sourceId?: string) {
    super();
    this._tag = tag;
    this._zIndex = zIndex;
    this.sourceId = sourceId;
  }
}
