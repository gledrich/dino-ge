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

/** A screen-space canvas layer. The game chooses which controls to draw each frame. */
export default class ScreenUI {
  private readonly lifetime = new AbortController();
  private readonly canvas: HTMLCanvasElement;
  private buttons: ScreenButton[] = [];
  private pointer?: Vector2;
  private focused?: string;
  private previousCursor?: string;

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

  render(draw: (ui: ScreenUI) => void): void {
    this.buttons = [];
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
      this.ctx.restore();
    }
  }

  panel({ x, y, width, height }: ScreenRect, colour: string): void {
    this.ctx.fillStyle = colour;
    this.ctx.fillRect(x, y, width, height);
  }

  label({ x, y, text, colour = '#fff', font = '16px sans-serif', align = 'left', maxWidth }: ScreenLabel): void {
    this.ctx.fillStyle = colour;
    this.ctx.font = font;
    this.ctx.textAlign = align;
    this.ctx.textBaseline = 'middle';
    if (maxWidth === undefined) this.ctx.fillText(text, x, y);
    else this.ctx.fillText(text, x, y, maxWidth);
  }

  image(image: CanvasImageSource, { x, y, width, height }: ScreenRect): void {
    this.ctx.drawImage(image, x, y, width, height);
  }

  button(button: ScreenButton): void {
    this.buttons.push(button);
    const { x, y, width, height, text, enabled = true, colour = '#fff',
      background = '#25383e', hoverBackground = '#39515a', font = 'bold 14px sans-serif' } = button;
    const highlighted = enabled && ((this.pointer && this.contains(button, this.pointer)) ||
      (this.focused === (button.id ?? text) && document.activeElement === this.canvas));
    this.panel(button, highlighted ? hoverBackground : enabled ? background : '#424c4e');
    this.label({ x: x + width / 2, y: y + height / 2, text, align: 'center', colour, font, maxWidth: width - 8 });
  }

  progressBar({ value, colour = '#f6b754', background = '#30434a', ...rect }: ScreenProgressBar): void {
    this.panel(rect, background);
    const progress = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
    this.panel({ ...rect, width: rect.width * progress }, colour);
  }

  dispose(): void {
    this.lifetime.abort();
    this.buttons = [];
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
