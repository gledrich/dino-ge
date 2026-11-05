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
}

export interface ScreenUISnapshot {
  width: number;
  height: number;
  controls: readonly ScreenUIControl[];
  source?: { index: number; stack: string };
}

export interface ScreenUIObservation {
  listener: (snapshot: ScreenUISnapshot) => void;
  getSourceIndex?: () => number | undefined;
}

interface ObservedFrame {
  controls: ScreenUIControl[];
  requests: Map<ScreenUIObservation, number | undefined>;
  stacks: Map<number, string | undefined>;
}

const controlTextFields = ['id', 'text', 'colour', 'background', 'font'] as const;

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
      const hovered = pointer && this.buttons.some(button => button.enabled !== false && this.contains(button, pointer));
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
    if (frame && !this.lifetime.signal.aborted) this.publish(frame, observers);
  }

  panel(rect: ScreenRect, colour: string): void {
    this.drawPanel(rect, colour, this.observedFrame);
  }

  label(label: ScreenLabel): void {
    this.drawLabel(label, this.observedFrame);
  }

  image(image: CanvasImageSource, { x, y, width, height }: ScreenRect): void {
    this.ctx.drawImage(image, x, y, width, height);
    if (this.observedFrame) this.record(this.observedFrame, { kind: 'image', x, y, width, height });
  }

  button(button: ScreenButton): void {
    this.buttons.push(button);
    const { x, y, width, height, text, enabled = true, colour = '#fff',
      background = '#25383e', hoverBackground = '#39515a', font = 'bold 14px sans-serif' } = button;
    const highlighted = enabled && ((this.pointer && this.contains(button, this.pointer)) ||
      (this.focused === (button.id ?? text) && document.activeElement === this.canvas));
    this.drawPanel(button, highlighted ? hoverBackground : enabled ? background : '#424c4e');
    this.drawLabel({ x: x + width / 2, y: y + height / 2, text, align: 'center', colour, font, maxWidth: width - 8 });
    if (this.observedFrame) this.record(this.observedFrame, {
      kind: 'button', x, y, width, height, id: button.id, text, enabled, colour, background, font,
    });
  }

  progressBar({ value, colour = '#f6b754', background = '#30434a', x, y, width, height }: ScreenProgressBar): void {
    this.drawPanel({ x, y, width, height }, background);
    const progress = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
    this.drawPanel({ x, y, width: width * progress, height }, colour);
    if (this.observedFrame) this.record(this.observedFrame, {
      kind: 'progressBar', x, y, width, height, value: progress, colour, background,
    });
  }

  dispose(): void {
    if (this.lifetime.signal.aborted) return;
    this.lifetime.abort();
    this.buttons = [];
    const observers = this.observers;
    this.observers = undefined;
    if (observers?.size) {
      const snapshot = { width: this.width, height: this.height, controls: [] };
      for (const observer of observers) observer.listener(snapshot);
    }
  }

  private drawPanel({ x, y, width, height }: ScreenRect, colour: string, frame?: ObservedFrame): void {
    this.ctx.fillStyle = colour;
    this.ctx.fillRect(x, y, width, height);
    if (frame) this.record(frame, { kind: 'panel', x, y, width, height, colour });
  }

  private drawLabel(
    { x, y, text, colour = '#fff', font = '16px sans-serif', align = 'left', maxWidth }: ScreenLabel,
    frame?: ObservedFrame,
  ): void {
    this.ctx.fillStyle = colour;
    this.ctx.font = font;
    this.ctx.textAlign = align;
    this.ctx.textBaseline = 'middle';
    if (maxWidth === undefined) this.ctx.fillText(text, x, y);
    else this.ctx.fillText(text, x, y, maxWidth);
    if (!frame || typeof text !== 'string') return;
    const metrics = this.ctx.measureText(text);
    const scale = maxWidth === undefined || metrics.width <= 0
      ? 1 : Math.min(1, Math.max(0, maxWidth) / metrics.width);
    this.record(frame, {
      kind: 'label',
      x: x - metrics.actualBoundingBoxLeft * scale,
      y: y - metrics.actualBoundingBoxAscent,
      width: (metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight) * scale,
      height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
      text, colour, font: this.ctx.font,
    });
  }

  private beginObservation(observers?: ReadonlySet<ScreenUIObservation>): ObservedFrame | undefined {
    if (!observers?.size) return;
    const frame: ObservedFrame = { controls: [], requests: new Map(), stacks: new Map() };
    for (const observer of observers) {
      const index = observer.getSourceIndex?.();
      frame.requests.set(observer, index);
      if (index !== undefined) frame.stacks.set(index, undefined);
    }
    return frame;
  }

  private record(frame: ObservedFrame, control: ScreenUIControl): void {
    const { width, height } = control;
    if (width < 0) {
      control.x += width;
      control.width = -width;
    }
    if (height < 0) {
      control.y += height;
      control.height = -height;
    }
    if (![control.x, control.y, width, height].every(Number.isFinite)) return;
    for (const field of controlTextFields) {
      if (typeof control[field] !== 'string') delete control[field];
    }
    if (typeof control.enabled !== 'boolean') delete control.enabled;
    const index = frame.controls.length;
    if (frame.stacks.has(index)) frame.stacks.set(index, new Error().stack ?? '');
    frame.controls.push(control);
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
