import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { toast } from '../ui/components';
import { CheckIcon, ChevronDownIcon, CopyIcon } from '../ui/icons';

export interface Loaded<T> {
  data: T | null;
  error: string;
  loading: boolean;
  reload: () => void;
  /** Asks again without showing it is loading, for updates in the background. */
  refresh: () => void;
}

/** Runs a query when the page opens and whenever its inputs change; the previous result stays visible meanwhile. */
export function useLoad<T>(query: () => Promise<T>, inputs: unknown[]): Loaded<T> {
  const [state, setState] = useState<{ data: T | null; error: string; loading: boolean }>({ data: null, error: '', loading: true });
  const [turn, setTurn] = useState(0);
  const latest = useRef(0);
  const quiet = useRef(false);

  useEffect(() => {
    const mine = ++latest.current;
    // A refresh in the background keeps what is on screen until the new answer is there.
    if (!quiet.current) setState((previous) => ({ ...previous, loading: true }));
    quiet.current = false;
    query()
      .then((data) => {
        // A slower, older request must not overwrite a newer answer.
        if (mine === latest.current) setState({ data, error: '', loading: false });
      })
      .catch((cause: unknown) => {
        if (mine === latest.current) setState((previous) => ({ ...previous, error: describe(cause), loading: false }));
      });
  }, [...inputs, turn]);

  const reload = useCallback(() => setTurn((n) => n + 1), []);
  const refresh = useCallback(() => {
    quiet.current = true;
    setTurn((n) => n + 1);
  }, []);
  return { ...state, reload, refresh };
}

export function describe(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : '';
  if (/failed to fetch|networkerror|load failed/i.test(message)) return 'Tidak bisa menghubungi server. Periksa sambungan internet.';
  return message || 'Terjadi kesalahan.';
}

/** The heading of a dashboard page, with room for its main action on the right. */
export function PageHead({ title, lead, children }: { title: string; lead: string; children?: ComponentChildren }) {
  return (
    <header class="dash-head">
      <div>
        <h1 class="heading small">{title}</h1>
        <p class="hint">{lead}</p>
      </div>
      {children && <div class="row">{children}</div>}
    </header>
  );
}

/**
 * A headline number with its label and a note. The dashboard draws the number
 * as large as the tile allows; it is told how many characters it has, so a long
 * amount shrinks to fit on one line instead of breaking between digits.
 */
export function Tile({ label, value, note }: { label: string; value: string | number; note: string }) {
  const text = String(value);
  return (
    <div class="tile">
      <span>{label}</span>
      <b style={{ '--chars': Math.max(1, text.length) }}>{text}</b>
      <small>{note}</small>
    </div>
  );
}

/** What to show instead of a page's content while it has none. */
export function LoadState({ load }: { load: Loaded<unknown> }) {
  if (load.error) {
    return (
      <p class="banner err">
        {load.error}{' '}
        <button class="link" onClick={load.reload}>
          Coba lagi
        </button>
      </p>
    );
  }
  return load.data === null ? <div class="spinner" /> : null;
}

export function Pager({ offset, limit, total, onChange }: { offset: number; limit: number; total: number; onChange: (offset: number) => void }) {
  if (total <= limit) return null;
  return (
    <div class="row pager">
      <button class="btn small" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
        ← Sebelumnya
      </button>
      <span class="hint">
        {offset + 1}–{Math.min(total, offset + limit)} dari {total.toLocaleString('id-ID')}
      </span>
      <button class="btn small" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>
        Berikutnya →
      </button>
    </div>
  );
}

export function dateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function dateOnly(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** "baru saja", "5 menit lalu", "3 hari lalu". */
export function ago(iso: string | null, now: number): string {
  if (!iso) return 'belum pernah';
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'baru saja';
  if (minutes < 60) return `${minutes} menit lalu`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} jam lalu`;
  return `${Math.floor(minutes / (60 * 24))} hari lalu`;
}

/** Closes a menu when the pointer goes down outside it, or Escape is pressed. Returns the ref for the menu's box. */
export function useDismiss<T extends HTMLElement>(open: boolean, close: () => void) {
  const box = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return box;
}

/** A button that opens a short list of things to do, e.g. the formats a report can be downloaded in. */
export function MenuButton({
  label,
  disabled,
  items,
}: {
  label: ComponentChildren;
  disabled?: boolean;
  items: { label: string; hint?: string; onPick: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  const box = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  return (
    <div class="menu" ref={box}>
      <button type="button" class="btn small" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}>
        {label}
        <ChevronDownIcon />
      </button>
      {open && (
        <div class="menu-list" role="menu">
          {items.map((item) => (
            <button
              type="button"
              role="menuitem"
              key={item.label}
              onClick={() => {
                setOpen(false);
                item.onPick();
              }}
            >
              <b>{item.label}</b>
              {item.hint && <small>{item.hint}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A small button beside a code that copies it, showing a tick for a moment afterwards. */
export function CopyButton({ text, label, onCopied }: { text: string; label: string; onCopied?: () => void }) {
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(timer);
  }, [done]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      onCopied?.();
    } catch {
      toast('Browser tidak mengizinkan menyalin.');
    }
  };

  return (
    <button type="button" class={`copy-btn ${done ? 'done' : ''}`} title={label} aria-label={`${label} ${text}`} onClick={() => void copy()}>
      {done ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}
