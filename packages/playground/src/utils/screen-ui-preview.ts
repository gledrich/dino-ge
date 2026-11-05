import type { ScreenUIControl, ScreenUIEditing, ScreenUIPositionPreview, ScreenUIPropertyChanges, ScreenUISnapshot } from 'dino-ge';

export type ScreenUIBounds = { x: number; y: number; width: number; height: number };
export const screenUIArrowOffsets: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
};
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
      (control.painted === undefined || isScreenUIBounds(control.painted)) &&
      (control.reversedX === undefined || typeof control.reversedX === 'boolean') &&
      (control.reversedY === undefined || typeof control.reversedY === 'boolean') &&
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
const dimensionKeys = ['width', 'height'] as const;
const propertyKeys = ['text', 'colour', 'background', 'font', 'enabled'] as const;
const limit = 65_536;
const clampOffset = (value: number) => Math.max(-limit, Math.min(limit, value));

export function getScreenUIBounds(control: ScreenUIControl, move?: ScreenUIMove): ScreenUIBounds {
  const { x, y, width, height } = control;
  if (!move) return { x, y, width, height };
  const widthChange = move.properties?.width;
  const heightChange = move.properties?.height;
  const nextWidth = widthChange === undefined ? width : Math.max(1, width + widthChange);
  const nextHeight = heightChange === undefined ? height : Math.max(1, height + heightChange);
  if (control.kind === 'label' && control.painted &&
      (move.properties?.text !== undefined || move.properties?.font !== undefined)) {
    return { ...control.painted, x: control.painted.x + move.x, y: control.painted.y + move.y };
  }
  return {
    x: x + move.x - (control.reversedX ? nextWidth - width : 0),
    y: y + move.y - (control.reversedY ? nextHeight - height : 0),
    width: nextWidth,
    height: nextHeight,
  };
}

function matchesControl(left: ScreenUIControl, right: ScreenUIControl) {
  return left.kind === right.kind && (left.id || right.id
    ? left.id === right.id
    : left.text === right.text && left.font === right.font && left.colour === right.colour &&
      left.background === right.background && left.x === right.x && left.y === right.y &&
      left.width === right.width && left.height === right.height &&
      left.reversedX === right.reversedX && left.reversedY === right.reversedY);
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
  const selectedMove = () => view.moves.find(move => move.index === view.selected);
  const changeSelected = (x: number, y: number, changes?: ScreenUIPropertyChanges) => {
    const { selected, frame, editing, moves } = view;
    if (!editing || selected === undefined || !frame || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const current = selectedMove();
    if (current?.applied) return;
    const control = frame.controls[selected];
    const properties = { ...current?.properties, ...changes };
    for (const key of dimensionKeys) {
      const amount = properties[key];
      if (!amount || !Number.isFinite(amount)) delete properties[key];
      else properties[key] = clampOffset(Math.max(1 - control[key], amount));
    }
    for (const key of propertyKeys) {
      if (properties[key] === undefined || properties[key] === control[key]) delete properties[key];
    }
    x = clampOffset(x);
    y = clampOffset(y);
    const hasProperties = Object.keys(properties).length > 0;
    if (current?.x === x && current.y === y &&
        JSON.stringify(current.properties) === JSON.stringify(hasProperties ? properties : undefined)) return;
    if (!current && !x && !y && !hasProperties) return;
    const next = moves.filter(move => move !== current);
    if (x || y || hasProperties) next.push({
      index: selected, control, x, y, ...(hasProperties ? { properties } : {}),
    });
    update({ ...view, moves: next });
  };

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
      changeSelected(x, y);
    },
    setProperties(changes: ScreenUIPropertyChanges) {
      const current = selectedMove();
      changeSelected(current?.x ?? 0, current?.y ?? 0, changes);
    },
    resize(x: number, y: number, width: number, height: number) {
      changeSelected(x, y, { width, height });
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
