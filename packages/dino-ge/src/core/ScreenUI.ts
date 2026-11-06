import Vector2 from '../math/Vector2.js';

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenLabel {
  x: number;
  y: number;
  text: string;
  colour?: string;
  font?: string;
  align?: CanvasTextAlign;
  maxWidth?: number;
}

export interface ScreenButton extends ScreenRect {
  id?: string;
  text: string;
  onPress: () => void;
  enabled?: boolean;
  colour?: string;
  background?: string;
  hoverBackground?: string;
  font?: string;
}

export interface ScreenProgressBar extends ScreenRect {
  value: number;
  colour?: string;
  background?: string;
}

/** Data describing one logical ScreenUI draw in canvas pixels. */
export interface ScreenUIControl extends ScreenRect {
  kind: 'panel' | 'label' | 'image' | 'button' | 'progressBar';
  id?: string;
  text?: string;
  enabled?: boolean;
  value?: number;
  colour?: string;
  background?: string;
  font?: string;
  reversedX?: boolean;
  reversedY?: boolean;
  /** Preview bounds at the original position, before applying move offsets. */
  painted?: ScreenRect;
}

export interface ScreenUISnapshot {
  width: number;
  height: number;
  controls: readonly ScreenUIControl[];
  source?: { index: number; stack: string };
}

export interface ScreenUIPositionPreview {
  index: number;
  control: ScreenUIControl;
  /** Offset from the current draw position in canvas pixels. */
  x: number;
  y: number;
  properties?: ScreenUIPropertyChanges;
}

export interface ScreenUIPropertyChanges {
  /** Change in the visual dimensions in canvas pixels. */
  width?: number;
  height?: number;
  text?: string;
  colour?: string;
  background?: string;
  font?: string;
  enabled?: boolean;
}

export interface ScreenUIEditing {
  positions: readonly ScreenUIPositionPreview[];
}

export interface ScreenUIObservation {
  listener: (snapshot: ScreenUISnapshot) => void;
  getSourceIndex?: () => number | undefined;
  getEditing?: () => ScreenUIEditing | undefined;
}

interface ObservedFrame {
  controls: ScreenUIControl[];
  editing?: ScreenUIEditing;
  requests: Map<ScreenUIObservation, number | undefined>;
  stacks: Map<number, string | undefined>;
}

const controlTextFields = ['id', 'text', 'colour', 'background', 'font'] as const;
let styleContext: CanvasRenderingContext2D | null | undefined;

/** Check whether Canvas 2D accepts a Screen UI style without changing the game's context. */
export function isScreenUIStyle(field: 'colour' | 'background' | 'font', value: string): boolean {
  if (typeof document === 'undefined') return false;
  styleContext ??= document.createElement('canvas').getContext('2d');
  if (!styleContext) return false;
  const property = field === 'font' ? 'font' : 'fillStyle';
  const sentinels = field === 'font' ? ['11px serif', '23px monospace'] : ['#123456', '#fedcba'];
  for (const sentinel of sentinels) {
    styleContext[property] = sentinel;
    const before = styleContext[property];
    styleContext[property] = value;
    if (styleContext[property] !== before) return true;
  }
  return false;
}

function matchesDrawnControl(control: ScreenUIControl, target: ScreenUIControl): boolean {
  if (control.kind !== target.kind) return false;
  if (control.id || target.id) return control.id === target.id;
  return control.x === target.x && control.y === target.y &&
    control.width === target.width && control.height === target.height &&
    control.text === target.text && control.colour === target.colour &&
    control.background === target.background && control.font === target.font &&
    control.reversedX === target.reversedX && control.reversedY === target.reversedY;
}

function normaliseRect(rect: ScreenRect): void {
  if (rect.width < 0) {
    rect.x += rect.width;
    rect.width = -rect.width;
  }
  if (rect.height < 0) {
    rect.y += rect.height;
    rect.height = -rect.height;
  }
}

function resizedDimension(size: number, delta?: number): number {
  if (!delta || !Number.isFinite(delta)) return size;
  const magnitude = Math.abs(size) + delta;
  return Number.isFinite(magnitude) ? Math.max(1, magnitude) * (size < 0 ? -1 : 1) : size;
}

function previewRect({ x, y, width, height }: ScreenRect, control: ScreenUIControl, edit: ScreenUIPositionPreview): ScreenRect {
  const painted = {
    x: x + edit.x, y: y + edit.y,
    width: resizedDimension(width, edit.properties?.width),
    height: resizedDimension(height, edit.properties?.height),
  };
  if (painted.width !== width || painted.height !== height) {
    control.painted = { ...painted, x, y };
    normaliseRect(control.painted);
  }
  return painted;
}

function previewText(value: string | undefined, original: string): string {
  return typeof value === 'string' ? value : original;
}

/** A screen-space canvas layer. The game chooses which controls to draw each frame. */
export default class ScreenUI {
  private readonly lifetime = new AbortController();
  private readonly canvas: HTMLCanvasElement;
  private buttons: ScreenButton[] = [];
  private pointer?: Vector2;
  private focused?: string;
  private previousCursor?: string;
  private observedFrame?: ObservedFrame;
  private observers?: ReadonlySet<ScreenUIObservation>;
  private lastControls: readonly ScreenUIControl[] = [];
  private readonly lastPublished = new WeakMap<ScreenUIObservation, {
    frame: string;
    source?: ScreenUISnapshot['source'];
  }>();

  constructor(private readonly ctx: CanvasRenderingContext2D) {
    this.canvas = ctx.canvas;
    this.canvas.tabIndex = 0;
    const options = { signal: this.lifetime.signal };
    this.canvas.addEventListener('pointermove', event => {
      this.pointer = this.position(event);
    }, options);
    this.canvas.addEventListener('pointerleave', () => { this.pointer = undefined; }, options);
    this.canvas.addEventListener('blur', () => { this.focused = undefined; }, options);
    this.canvas.addEventListener('click', event => {
      if (this.getEditing()) return;
      const point = this.position(event);
      for (let index = this.buttons.length - 1; index >= 0; index--) {
        const button = this.buttons[index];
        if (button.enabled !== false && this.contains(button, point)) {
          this.focused = button.id ?? button.text;
          button.onPress();
          break;
        }
      }
    }, options);
    this.canvas.addEventListener('keydown', event => {
      if (this.getEditing()) return;
      const index = this.buttons.findIndex(button => (button.id ?? button.text) === this.focused);
      if (event.key === 'Tab') {
        const direction = event.shiftKey ? -1 : 1;
        let next = index < 0 && direction < 0 ? this.buttons.length - 1 : index + direction;
        while (next >= 0 && next < this.buttons.length && this.buttons[next].enabled === false) next += direction;
        if (next >= 0 && next < this.buttons.length) {
          this.focused = this.buttons[next].id ?? this.buttons[next].text;
          event.preventDefault();
        } else {
          this.focused = undefined;
        }
      } else if (!event.repeat && (event.key === 'Enter' || event.key === ' ')) {
        const focused = this.buttons[index];
        const button = focused && focused.enabled !== false ? focused : this.buttons.find(item => item.enabled !== false);
        if (button) {
          event.preventDefault();
          button.onPress();
        }
      }
    }, options);
  }

  get width(): number { return this.canvas.width; }
  get height(): number { return this.canvas.height; }

  anchor(horizontal: 'left' | 'centre' | 'right', vertical: 'top' | 'centre' | 'bottom', x = 0, y = 0): Vector2 {
    const left = horizontal === 'left' ? 0 : horizontal === 'centre' ? this.width / 2 : this.width;
    const top = vertical === 'top' ? 0 : vertical === 'centre' ? this.height / 2 : this.height;
    return new Vector2(left + x, top + y);
  }

  render(draw: (ui: ScreenUI) => void, observers?: ReadonlySet<ScreenUIObservation>): void {
    this.buttons = [];
    this.observers = observers;
    const frame = this.beginObservation(observers);
    this.observedFrame = frame;
    this.ctx.save();
    try {
      draw(this);
      const pointer = this.pointer;
      const hovered = pointer && !frame?.editing &&
        this.buttons.some(button => button.enabled !== false && this.contains(button, pointer));
      if (hovered && this.previousCursor === undefined) {
        this.previousCursor = this.canvas.style.cursor;
        this.canvas.style.cursor = 'pointer';
      } else if (!hovered && this.previousCursor !== undefined) {
        this.canvas.style.cursor = this.previousCursor;
        this.previousCursor = undefined;
      }
    } finally {
      this.observedFrame = undefined;
      this.ctx.restore();
    }
    this.lastControls = frame?.controls ?? [];
    if (frame && !this.lifetime.signal.aborted) this.publish(frame, observers);
  }

  panel(rect: ScreenRect, colour: string): void;
  /**
   * Draw a panel with a stable ID and return its effective bounds for dependent layout.
   * Use a unique string literal ID at the call site to opt into Playground source editing.
   */
  panel(rect: ScreenRect, colour: string, id: string): ScreenRect;
  panel(rect: ScreenRect, colour: string, id?: string): ScreenRect | void {
    const frame = this.observedFrame;
    if (!frame) {
      this.drawPanel(rect, colour);
      return id === undefined ? undefined : rect;
    }
    const { x, y, width, height } = rect;
    const dimensions = { x, y, width, height };
    const control: ScreenUIControl = { kind: 'panel', ...dimensions, colour, ...(id ? { id } : {}) };
    const edit = this.record(frame, control);
    const painted = edit ? previewRect(dimensions, control, edit) : dimensions;
    this.drawPanel(painted, previewText(edit?.properties?.colour, colour));
    return id === undefined ? undefined : painted;
  }

  label(label: ScreenLabel): void {
    this.drawLabel(label, this.observedFrame);
  }

  image(image: CanvasImageSource, { x, y, width, height }: ScreenRect): void {
    const frame = this.observedFrame;
    const control: ScreenUIControl | undefined = frame && { kind: 'image', x, y, width, height };
    const edit = frame && control && this.record(frame, control);
    if (control && edit) {
      const painted = previewRect({ x, y, width, height }, control, edit);
      this.ctx.drawImage(image, painted.x, painted.y, painted.width, painted.height);
    } else {
      this.ctx.drawImage(image, x, y, width, height);
    }
  }

  button(button: ScreenButton): void {
    this.buttons.push(button);
    const { x, y, width, height, text, enabled = true, colour = '#fff',
      background = '#25383e', hoverBackground = '#39515a', font = 'bold 14px sans-serif' } = button;
    const frame = this.observedFrame;
    const control: ScreenUIControl | undefined = frame && {
      kind: 'button', x, y, width, height, id: button.id, text, enabled, colour, background, font,
    };
    const edit = frame && control && this.record(frame, control);
    const properties = edit?.properties;
    const rect = { x, y, width, height };
    const painted = control && edit ? previewRect(rect, control, edit) : rect;
    const paintEnabled = typeof properties?.enabled === 'boolean' ? properties.enabled : enabled;
    const highlighted = paintEnabled && !frame?.editing && ((this.pointer && this.contains(button, this.pointer)) ||
      (this.focused === (button.id ?? text) && document.activeElement === this.canvas));
    this.drawPanel(painted, highlighted ? hoverBackground : paintEnabled ? previewText(properties?.background, background) : '#424c4e');
    this.drawLabel({
      x: painted.x + painted.width / 2, y: painted.y + painted.height / 2,
      text: previewText(properties?.text, text), align: 'center', colour: previewText(properties?.colour, colour),
      font: previewText(properties?.font, font), maxWidth: painted.width - 8,
    });
  }

  progressBar({ value, colour = '#f6b754', background = '#30434a', x, y, width, height }: ScreenProgressBar): void {
    const progress = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
    const frame = this.observedFrame;
    const control: ScreenUIControl | undefined = frame && {
      kind: 'progressBar', x, y, width, height, value: progress, colour, background,
    };
    const edit = frame && control && this.record(frame, control);
    const rect = { x, y, width, height };
    const painted = control && edit ? previewRect(rect, control, edit) : rect;
    this.drawPanel(painted, previewText(edit?.properties?.background, background));
    this.drawPanel({ ...painted, width: painted.width * progress }, previewText(edit?.properties?.colour, colour));
  }

  dispose(): void {
    if (this.lifetime.signal.aborted) return;
    this.lifetime.abort();
    this.buttons = [];
    this.lastControls = [];
    const observers = this.observers;
    this.observers = undefined;
    if (observers?.size) {
      const snapshot = { width: this.width, height: this.height, controls: [] };
      for (const observer of observers) observer.listener(snapshot);
    }
  }

  private drawPanel({ x, y, width, height }: ScreenRect, colour: string): void {
    this.ctx.fillStyle = colour;
    this.ctx.fillRect(x, y, width, height);
  }

  private drawLabel(
    { x, y, text, colour = '#fff', font = '16px sans-serif', align = 'left', maxWidth }: ScreenLabel,
    frame?: ObservedFrame,
  ): void {
    this.ctx.fillStyle = colour;
    this.ctx.font = font;
    this.ctx.textAlign = align;
    this.ctx.textBaseline = 'middle';
    if (frame && typeof text === 'string') {
      const control: ScreenUIControl = {
        kind: 'label', ...this.measureLabel(x, y, text, maxWidth), text, colour, font: this.ctx.font,
      };
      const edit = this.record(frame, control);
      if (edit) {
        x += edit.x;
        y += edit.y;
        const paintedText = previewText(edit.properties?.text, text);
        this.ctx.fillStyle = previewText(edit.properties?.colour, colour);
        this.ctx.font = previewText(edit.properties?.font, font);
        if (paintedText !== text || this.ctx.font !== control.font) {
          control.painted = this.measureLabel(x - edit.x, y - edit.y, paintedText, maxWidth);
        }
        text = paintedText;
      }
    }
    if (maxWidth === undefined) this.ctx.fillText(text, x, y);
    else this.ctx.fillText(text, x, y, maxWidth);
  }

  private measureLabel(x: number, y: number, text: string, maxWidth?: number): ScreenRect {
    const metrics = this.ctx.measureText(text);
    const scale = maxWidth === undefined || metrics.width <= 0
      ? 1 : Math.min(1, Math.max(0, maxWidth) / metrics.width);
    return {
      x: x - metrics.actualBoundingBoxLeft * scale,
      y: y - metrics.actualBoundingBoxAscent,
      width: (metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight) * scale,
      height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
    };
  }

  private getEditing(): ScreenUIEditing | undefined {
    if (!this.observers) return;
    for (const observer of this.observers) {
      const editing = observer.getEditing?.();
      if (editing && Array.isArray(editing.positions)) return editing;
    }
  }

  private beginObservation(observers?: ReadonlySet<ScreenUIObservation>): ObservedFrame | undefined {
    if (!observers?.size) return;
    const frame: ObservedFrame = { controls: [], editing: this.getEditing(), requests: new Map(), stacks: new Map() };
    for (const observer of observers) {
      const index = observer.getSourceIndex?.();
      frame.requests.set(observer, index);
      if (index !== undefined) frame.stacks.set(index, undefined);
    }
    return frame;
  }

  private record(frame: ObservedFrame, control: ScreenUIControl): ScreenUIPositionPreview | undefined {
    const { width, height } = control;
    if (width < 0) control.reversedX = true;
    if (height < 0) control.reversedY = true;
    normaliseRect(control);
    if (![control.x, control.y, width, height].every(Number.isFinite)) return;
    for (const field of controlTextFields) {
      if (typeof control[field] !== 'string') delete control[field];
    }
    if (typeof control.enabled !== 'boolean') delete control.enabled;
    const index = frame.controls.length;
    if (frame.stacks.has(index)) frame.stacks.set(index, new Error().stack ?? '');
    frame.controls.push(control);
    const position = frame.editing?.positions.find(candidate => candidate?.index === index);
    if (!position?.control || !Number.isFinite(position.x) || !Number.isFinite(position.y) ||
      !matchesDrawnControl(control, position.control)) return;
    const previous = this.lastControls[index];
    if (!previous || !matchesDrawnControl(previous, position.control)) return;
    // Explicit IDs can track responsive geometry, provided the previous frame had one matching control.
    if (control.id && this.lastControls.some((candidate, slot) => slot !== index &&
      matchesDrawnControl(candidate, position.control))) return;
    return position;
  }

  private publish(frame: ObservedFrame, observers?: ReadonlySet<ScreenUIObservation>): void {
    const snapshot = { width: this.width, height: this.height, controls: frame.controls };
    const signature = JSON.stringify(snapshot);
    for (const [observer, index] of frame.requests) {
      if (this.lifetime.signal.aborted) break;
      if (!observers?.has(observer)) continue;
      const previous = this.lastPublished.get(observer);
      const stack = index === undefined ? undefined : frame.stacks.get(index);
      const source = index !== undefined && stack !== undefined ? { index, stack } : undefined;
      const changedSource = source && (source.index !== previous?.source?.index || source.stack !== previous.source.stack);
      this.lastPublished.set(observer, { frame: signature, source });
      if (previous?.frame !== signature || changedSource) observer.listener(source ? { ...snapshot, source } : snapshot);
    }
  }

  private position(event: MouseEvent): Vector2 {
    const rect = this.canvas.getBoundingClientRect();
    return new Vector2(
      (event.clientX - rect.left) * this.width / (rect.width || 1),
      (event.clientY - rect.top) * this.height / (rect.height || 1),
    );
  }

  private contains(rect: ScreenRect, point: Vector2): boolean {
    return point.x >= rect.x && point.x < rect.x + rect.width &&
      point.y >= rect.y && point.y < rect.y + rect.height;
  }
}
