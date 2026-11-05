import type { ScreenUIControl, ScreenUIEditing, ScreenUIPositionPreview, ScreenUISnapshot } from 'dino-ge';

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
  writeVerified?: boolean;
};

export const openScreenUISourceEvent = 'playground-open-screen-ui-source';
export type OpenScreenUISource = { location: ScreenUISource; trigger: HTMLButtonElement };

export type ScreenUIMove = ScreenUIPositionPreview & { applied?: number };

type ScreenUIView = {
  frame?: ScreenUIFrame;
  canvas?: ScreenUIBounds;
  selected?: number;
  source?: ScreenUISource;
  editing: boolean;
  wasPaused: boolean;
  moves: readonly ScreenUIMove[];
};

const emptyView: ScreenUIView = { editing: false, wasPaused: false, moves: [] };

function matchesControl(left: ScreenUIControl, right: ScreenUIControl) {
  return left.kind === right.kind && (left.id || right.id
    ? left.id === right.id
    : left.text === right.text && left.font === right.font && left.colour === right.colour &&
      left.background === right.background && left.x === right.x && left.y === right.y &&
      left.width === right.width && left.height === right.height);
}

function followControl(previous: ScreenUIFrame | undefined, previousIndex: number | undefined, controls: readonly ScreenUIControl[]) {
  if (previousIndex === undefined || !previous) return;
  const original = previous.controls[previousIndex];
  const same = previous.controls.filter(control => matchesControl(control, original));
  if (same.length !== 1) return;
  const matches = controls.flatMap((control, index) => matchesControl(control, original) ? [index] : []);
  if (matches.length !== 1) return;
  const [index] = matches;
  if (original.id || index === previousIndex) return index;
}

export function createScreenUIPreview() {
  let view = emptyView;
  let requestSource: ((index: number) => void) | undefined;
  let sendEditing: ((editing: ScreenUIEditing | undefined) => void) | undefined;
  let connection: object | undefined;
  let appliedMoveId = 0;
  let frameKey = '';
  const listeners = new Set<() => void>();
  const update = (next: ScreenUIView) => {
    const editingChanged = view.editing !== next.editing || view.moves !== next.moves;
    view = next;
    if (editingChanged) sendEditing?.(view.editing ? { positions: view.moves } : undefined);
    listeners.forEach(listener => listener());
  };
  const hasPendingMoves = () => view.moves.some(move => !move.applied);

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => view,
    getEditing: (): ScreenUIEditing | undefined => view.editing ? { positions: view.moves } : undefined,
    hasPendingMoves,
    beginEditing(wasPaused = false) {
      if (!connection || view.editing || view.selected === undefined) return false;
      update({ ...view, editing: true, wasPaused });
      return true;
    },
    finishEditing() {
      if (hasPendingMoves()) return false;
      update({ ...view, editing: false, moves: emptyView.moves });
      return true;
    },
    move(x: number, y: number) {
      const { selected, frame, editing, moves } = view;
      if (!editing || selected === undefined || !frame || !Number.isFinite(x) || !Number.isFinite(y)) return;
      const current = moves.find(move => move.index === selected);
      if (current?.applied || (current?.x === x && current.y === y) || (!current && !x && !y)) return;
      const next = moves.filter(move => move !== current);
      const limit = 65_536;
      if (x || y) next.push({
        index: selected, control: frame.controls[selected],
        x: Math.max(-limit, Math.min(limit, x)), y: Math.max(-limit, Math.min(limit, y)),
      });
      update({ ...view, moves: next });
    },
    discardMove() {
      const moves = view.moves.filter(move => move.index !== view.selected || move.applied);
      if (moves.length !== view.moves.length) update({ ...view, moves });
    },
    markApplied(move: ScreenUIMove) {
      if (!view.moves.includes(move)) return;
      const owner = connection;
      const origin = view.frame;
      const applied = { ...move, applied: ++appliedMoveId };
      update({ ...view, moves: view.moves.map(item => item === move ? applied : item) });
      return {
        remove() {
          if (connection !== owner) return;
          const moves = view.moves.filter(item => item.applied !== applied.applied);
          if (moves.length !== view.moves.length) update({ ...view, moves });
        },
        restore() {
          if (connection !== owner || !view.editing || !view.frame) return;
          const index = followControl(origin, move.index, view.frame.controls);
          if (index === undefined || view.moves.some(item => item.index === index)) return;
          update({ ...view, moves: [...view.moves, { ...applied, index }] });
        },
      };
    },
    select(index: number | undefined) {
      if (index === view.selected || (index !== undefined && !view.frame?.controls[index])) return;
      update({ ...view, selected: index, source: undefined });
      if (index !== undefined) requestSource?.(index);
    },
    start(lookup: (index: number) => void, edit?: (editing: ScreenUIEditing | undefined) => void) {
      update(emptyView);
      const owner = {};
      connection = owner;
      frameKey = '';
      requestSource = lookup;
      sendEditing = edit;
      return {
        publish(frame: ScreenUIFrame, canvas?: ScreenUIBounds) {
          if (connection !== owner) return;
          const { width, height, controls } = frame;
          const key = JSON.stringify([width, height, controls, canvas]);
          if (key === frameKey) return;
          frameKey = key;
          const selected = followControl(view.frame, view.selected, controls);
          const same = selected === view.selected;
          const followed = view.moves.flatMap(move => {
            const index = followControl(view.frame, move.index, controls);
            return index === undefined ? [] : [index === move.index ? move : { ...move, index }];
          });
          const moves = followed.length === view.moves.length && followed.every((move, index) => move === view.moves[index])
            ? view.moves : followed;
          update({ ...view, frame: { width, height, controls }, canvas, selected, moves, source: same ? view.source : undefined });
          if (!same && selected !== undefined) lookup(selected);
        },
        setSource(index: number, source: ScreenUISource) {
          if (connection === owner && index === view.selected) update({ ...view, source });
        },
        dispose() {
          if (connection !== owner) return;
          connection = undefined;
          requestSource = undefined;
          update(emptyView);
          sendEditing = undefined;
        },
      };
    },
  };
}

export const screenUIPreview = createScreenUIPreview();
