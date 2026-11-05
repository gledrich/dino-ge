import type { ScreenUIControl, ScreenUISnapshot } from 'dino-ge';

export type ScreenUIBounds = { x: number; y: number; width: number; height: number };
type ScreenUIFrame = Pick<ScreenUISnapshot, 'width' | 'height' | 'controls'>;

const controlKinds = new Set(['panel', 'label', 'image', 'button', 'progressBar']);
const stringFields = ['id', 'text', 'colour', 'background', 'font'] as const;

export function isScreenUIBounds(value: unknown): value is ScreenUIBounds {
  if (!value || typeof value !== 'object') return false;
  const { x, y, width, height } = value as Partial<ScreenUIBounds>;
  return [x, y, width, height].every(Number.isFinite);
}

export function isScreenUIFrame(value: unknown): value is ScreenUIFrame {
  if (!value || typeof value !== 'object') return false;
  const { width, height, controls } = value as Partial<ScreenUIFrame>;
  return typeof width === 'number' && Number.isFinite(width) && width > 0 &&
    typeof height === 'number' && Number.isFinite(height) && height > 0 &&
    Array.isArray(controls) && controls.length <= 250 && controls.every((control: ScreenUIControl) =>
      controlKinds.has(control?.kind) && isScreenUIBounds(control) &&
      stringFields.every(key => control[key] === undefined ||
        (typeof control[key] === 'string' && control[key].length <= 500)) &&
      (control.enabled === undefined || typeof control.enabled === 'boolean') &&
      (control.value === undefined || Number.isFinite(control.value)));
}

export type ScreenUISource = {
  scriptId: string;
  kind: ScreenUIControl['kind'];
  path: string;
  entry: boolean;
  source: string;
  lineNumber: number;
  column: number;
};

export const openScreenUISourceEvent = 'playground-open-screen-ui-source';
export type OpenScreenUISource = { location: ScreenUISource; trigger: HTMLButtonElement };

type ScreenUIView = {
  frame?: ScreenUIFrame;
  canvas?: ScreenUIBounds;
  selected?: number;
  source?: ScreenUISource;
};

function matchesControl(left: ScreenUIControl, right: ScreenUIControl) {
  return left.kind === right.kind && (left.id || right.id
    ? left.id === right.id
    : left.text === right.text && left.font === right.font && left.colour === right.colour &&
      left.background === right.background);
}

function followSelection(previous: ScreenUIView, controls: readonly ScreenUIControl[]) {
  if (previous.selected === undefined || !previous.frame) return;
  const original = previous.frame.controls[previous.selected];
  const same = previous.frame.controls.filter(control => matchesControl(control, original));
  if (same.length !== 1) return;
  const matches = controls.flatMap((control, index) => matchesControl(control, original) ? [index] : []);
  if (matches.length !== 1) return;
  const [index] = matches;
  const control = controls[index];
  if (original.id || (index === previous.selected && original.x === control.x && original.y === control.y &&
    original.width === control.width && original.height === control.height)) return index;
}

export function createScreenUIPreview() {
  let view: ScreenUIView = {};
  let requestSource: ((index: number) => void) | undefined;
  let connection: object | undefined;
  let frameKey = '';
  const listeners = new Set<() => void>();
  const update = (next: ScreenUIView) => {
    view = next;
    listeners.forEach(listener => listener());
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => view,
    select(index: number | undefined) {
      if (index === view.selected || (index !== undefined && !view.frame?.controls[index])) return;
      update({ ...view, selected: index, source: undefined });
      if (index !== undefined) requestSource?.(index);
    },
    start(lookup: (index: number) => void) {
      const owner = {};
      connection = owner;
      frameKey = '';
      requestSource = lookup;
      update({});
      return {
        publish(frame: ScreenUIFrame, canvas?: ScreenUIBounds) {
          if (connection !== owner) return;
          const { width, height, controls } = frame;
          const key = JSON.stringify([width, height, controls, canvas]);
          if (key === frameKey) return;
          frameKey = key;
          const selected = followSelection(view, controls);
          const same = selected === view.selected;
          update({ frame: { width, height, controls }, canvas, selected, source: same ? view.source : undefined });
          if (!same && selected !== undefined) lookup(selected);
        },
        setSource(index: number, source: ScreenUISource) {
          if (connection === owner && index === view.selected) update({ ...view, source });
        },
        dispose() {
          if (connection !== owner) return;
          connection = undefined;
          requestSource = undefined;
          update({});
        },
      };
    },
  };
}

export const screenUIPreview = createScreenUIPreview();
