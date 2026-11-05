import { useId, useState, type ReactNode } from 'react';
import { isScreenUIStyle, type ScreenUIControl } from 'dino-ge';
import { getScreenUIBounds, screenUIPreview, type ScreenUIMove } from '../utils/screen-ui-preview';

export const screenUIControlKinds = {
  panel: 'Panel', label: 'Label', image: 'Image', button: 'Button', progressBar: 'Progress bar',
};
export const screenUIControlName = (control: ScreenUIControl, move?: ScreenUIMove) =>
  (move?.properties?.text ?? control.text) || control.id || screenUIControlKinds[control.kind];

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return <div className="prop-row"><dt id={id}>{label}</dt><dd>{children(id)}</dd></div>;
}

function TextField({ id, value, onChange, validate }: {
  id: string; value: string; onChange: (value: string) => void; validate?: (value: string) => boolean;
}) {
  const [draft, setDraft] = useState<string>();
  const invalid = draft !== undefined && validate && !validate(draft);
  return <input type="text" aria-labelledby={id} value={draft ?? value} maxLength={500}
    aria-invalid={invalid || undefined}
    onChange={event => {
      const text = event.currentTarget.value;
      setDraft(text);
      if (!validate || validate(text)) onChange(text);
    }}
    onBlur={() => setDraft(undefined)}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />;
}

function NumberField({ id, value, min, onChange }: {
  id: string; value: number; min?: number; onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string>();
  return <input type="number" aria-labelledby={id} value={draft ?? Number(value.toFixed(1))}
    min={min} step="any" inputMode="decimal"
    onChange={event => {
      const input = event.currentTarget;
      setDraft(input.value);
      if (Number.isFinite(input.valueAsNumber) && (min === undefined || input.valueAsNumber >= min)) {
        onChange(input.valueAsNumber);
      }
    }}
    onBlur={() => setDraft(undefined)}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />;
}

const axisNames = { x: 'X', y: 'Y', width: 'Width', height: 'Height' } as const;
const styleNames = { text: 'Text', colour: 'Colour', background: 'Background', font: 'Font' } as const;

export function ScreenUIFields({ control, move, editable }: {
  control: ScreenUIControl; move?: ScreenUIMove; editable: boolean;
}) {
  const bounds = getScreenUIBounds(control, move);
  const props = move?.properties;
  const enabled = props?.enabled ?? control.enabled;
  const value = control.value;
  const dimensions = Object.keys(axisNames) as (keyof typeof axisNames)[];
  const styles = Object.keys(styleNames) as (keyof typeof styleNames)[];
  const changeDimension = (field: keyof typeof axisNames, value: number) => {
    if (field === 'x') screenUIPreview.move((move?.x ?? 0) + value - bounds.x, move?.y ?? 0);
    else if (field === 'y') screenUIPreview.move(move?.x ?? 0, (move?.y ?? 0) + value - bounds.y);
    else screenUIPreview.setProperties({ [field]: value - control[field] });
  };
  return <dl className="screen-ui-properties">
    <Field label="Type">{() => screenUIControlKinds[control.kind]}</Field>
    {control.id && <Field label="ID">{() => control.id}</Field>}
    {dimensions.map(field => {
      const size = field === 'width' || field === 'height';
      return <Field key={field} label={axisNames[field]}>{id =>
        editable && (!size || control.kind !== 'label')
          ? <NumberField id={id} value={bounds[field]} min={size ? 1 : undefined}
              onChange={value => changeDimension(field, value)} />
          : bounds[field].toFixed(1)
      }</Field>;
    })}
    {styles.map(field => {
      const value = props?.[field] ?? control[field];
      if (value === undefined) return null;
      return <Field key={field} label={styleNames[field]}>{id => editable
        ? <TextField id={id} value={value} validate={field === 'text' ? undefined :
            text => isScreenUIStyle(field, text)}
            onChange={text => screenUIPreview.setProperties({ [field]: text })} />
        : value
      }</Field>;
    })}
    {enabled !== undefined && <Field label="Enabled">{id => editable
      ? <input type="checkbox" aria-labelledby={id} checked={enabled}
          onChange={event => screenUIPreview.setProperties({ enabled: event.currentTarget.checked })} />
      : enabled ? 'Yes' : 'No'
    }</Field>}
    {value !== undefined && <Field label="Value">{() => `${Math.round(value * 100)}%`}</Field>}
  </dl>;
}
