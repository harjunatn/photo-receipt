import type { ComponentChildren } from 'preact';
import { loadImage } from '../lib/receipt/compose';

interface FieldProps {
  label: string;
  hint?: string;
}

export function TextField(props: FieldProps & { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label class="field">
      <span>{props.label}</span>
      <input
        type="text"
        value={props.value}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
      {props.hint && <small class="hint">{props.hint}</small>}
    </label>
  );
}

export function AreaField(props: FieldProps & { value: string; onChange: (v: string) => void }) {
  return (
    <label class="field">
      <span>{props.label}</span>
      <textarea value={props.value} onChange={(event) => props.onChange(event.currentTarget.value)} />
      {props.hint && <small class="hint">{props.hint}</small>}
    </label>
  );
}

export function NumberField(
  props: FieldProps & { value: number; onChange: (v: number) => void; min: number; max: number; step?: number },
) {
  return (
    <label class="field">
      <span>{props.label}</span>
      <input
        type="number"
        inputMode="numeric"
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        onChange={(event) => {
          const parsed = Number(event.currentTarget.value);
          const value = Number.isFinite(parsed) ? Math.min(props.max, Math.max(props.min, parsed)) : props.value;
          // Show the value actually stored, e.g. after clamping an out-of-range entry.
          event.currentTarget.value = String(value);
          props.onChange(value);
        }}
      />
      {props.hint && <small class="hint">{props.hint}</small>}
    </label>
  );
}

export function Slider(
  props: FieldProps & {
    value: number;
    onChange: (v: number) => void;
    min: number;
    max: number;
    step?: number;
    format?: (v: number) => string;
  },
) {
  return (
    <label class="field">
      <span>
        {props.label}: <span class="mono">{props.format ? props.format(props.value) : props.value}</span>
      </span>
      <input
        type="range"
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        onInput={(event) => props.onChange(Number(event.currentTarget.value))}
      />
      {props.hint && <small class="hint">{props.hint}</small>}
    </label>
  );
}

export function Check(props: FieldProps & { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label class="check">
      <input type="checkbox" checked={props.checked} onChange={(event) => props.onChange(event.currentTarget.checked)} />
      <span>
        {props.label}
        {/* Reading the small print with a finger on it must not flip the setting; only the box and its title do. */}
        {props.hint && <small onClick={(event) => event.preventDefault()}>{props.hint}</small>}
      </span>
    </label>
  );
}

export function Segmented<T extends string | number>(
  props: FieldProps & { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void },
) {
  return (
    <div class="field">
      <span>{props.label}</span>
      <div class="seg">
        {props.options.map((option) => (
          <button
            key={option.value}
            type="button"
            class={option.value === props.value ? 'on' : ''}
            onClick={() => props.onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {props.hint && <small class="hint">{props.hint}</small>}
    </div>
  );
}

/** Reads an image file, shrinks it and hands it back as a data URL small enough to keep in the settings. */
async function fileToDataUrl(file: File, maxSide: number): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ImageField(
  props: FieldProps & { value: string; onChange: (dataUrl: string) => void; maxSide: number; children?: ComponentChildren },
) {
  return (
    <div class="field">
      <span>{props.label}</span>
      <div class="row">
        {props.value && <img src={props.value} alt="" style={{ height: '64px', border: '2px solid var(--ink)', background: '#fff' }} />}
        <label class="btn small">
          {props.value ? 'Ganti gambar' : 'Pilih gambar'}
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={async (event) => {
              const input = event.currentTarget;
              const file = input.files?.[0];
              input.value = '';
              if (file) props.onChange(await fileToDataUrl(file, props.maxSide));
            }}
          />
        </label>
        {props.value && (
          <button type="button" class="btn small danger" onClick={() => props.onChange('')}>
            Hapus
          </button>
        )}
      </div>
      {props.hint && <small class="hint">{props.hint}</small>}
    </div>
  );
}
