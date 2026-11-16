import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { BitImage } from '../lib/image/types';
import { paintBits } from '../lib/receipt/compose';
import { settingsStore } from '../lib/settings';

/** Shows printer dots on a strip of "paper" exactly as they will print. */
export function ReceiptPaper({ bits }: { bits: BitImage | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current && bits) paintBits(canvas.current, bits);
  }, [bits]);
  return (
    <div class="paper">
      <canvas ref={canvas} width={bits?.width ?? 576} height={bits?.height ?? 300} />
    </div>
  );
}

const STEPS = ['Frame', 'Bayar', 'Foto', 'Edit', 'Cetak'];

/** The five steps of a session, with the current one highlighted, so guests know how far along they are. */
export function Steps({ current }: { current: number }) {
  return (
    <ol class="steps">
      {STEPS.map((label, i) => (
        <li key={label} class={i < current ? 'done' : i === current ? 'now' : ''}>
          <i>{i < current ? '✓' : i + 1}</i>
          <span>{label}</span>
        </li>
      ))}
    </ol>
  );
}

export function Overlay({ children, onClose }: { children: ComponentChildren; onClose?: () => void }) {
  return (
    <div class="overlay" onPointerDown={(event) => event.target === event.currentTarget && onClose?.()}>
      {children}
    </div>
  );
}

/** Numeric keypad that asks for the staff PIN. */
export function PinPad({ title, onSuccess, onCancel }: { title: string; onSuccess: () => void; onCancel: () => void }) {
  const [entry, setEntry] = useState('');
  const [wrong, setWrong] = useState(false);
  const pin = settingsStore.get().admin.pin;

  const press = (digit: string) => {
    const next = (entry + digit).slice(0, pin.length);
    setEntry(next);
    setWrong(false);
    if (next.length < pin.length) return;
    if (next === pin) {
      onSuccess();
    } else {
      setWrong(true);
      setTimeout(() => setEntry(''), 350);
    }
  };

  return (
    <Overlay onClose={onCancel}>
      <div class="card dialog">
        <span class="tag">Khusus petugas</span>
        <h2>{title}</h2>
        <div class={`pin-dots ${wrong ? 'shake' : ''}`}>
          {Array.from(pin, (_, i) => (
            <i key={i} class={i < entry.length ? 'filled' : ''} />
          ))}
        </div>
        <p class="error-text">{wrong ? 'PIN salah' : ''}</p>
        <div class="pinpad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
            <button key={digit} class="key" onClick={() => press(digit)}>
              {digit}
            </button>
          ))}
          <button class="key" onClick={onCancel} aria-label="Batal">
            ✕
          </button>
          <button class="key" onClick={() => press('0')}>
            0
          </button>
          <button class="key" onClick={() => setEntry(entry.slice(0, -1))} aria-label="Hapus">
            ⌫
          </button>
        </div>
      </div>
    </Overlay>
  );
}

const KEY_ROWS = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL-', 'ZXCVBNM'];

/** On-screen keyboard for voucher codes, so the tablet's own keyboard never covers the screen. */
export function CodeKeyboard({ value, onChange, maxLength = 20 }: { value: string; onChange: (v: string) => void; maxLength?: number }) {
  return (
    <div class="keys">
      {KEY_ROWS.flatMap((row) =>
        Array.from(row, (ch) => (
          <button key={ch} class="key" onClick={() => value.length < maxLength && onChange(value + ch)}>
            {ch}
          </button>
        )),
      )}
      <button class="key wide" onClick={() => onChange(value.slice(0, -1))} aria-label="Hapus satu huruf">
        ⌫
      </button>
      <button class="key" onClick={() => onChange('')} aria-label="Hapus semua">
        ✕
      </button>
    </div>
  );
}

let showToast: (message: string) => void = () => undefined;

/** Briefly shows a message at the bottom of the screen. */
export function toast(message: string): void {
  showToast(message);
}

export function ToastHost() {
  const [message, setMessage] = useState('');
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    showToast = (text) => {
      setMessage(text);
      clearTimeout(timer);
      timer = setTimeout(() => setMessage(''), 3200);
    };
    return () => clearTimeout(timer);
  }, []);
  return message ? <div class="toast">{message}</div> : null;
}
