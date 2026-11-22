import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

/**
 * Cards of unequal height, side by side without holes.
 *
 * In an ordinary grid a short card beside a tall one leaves an empty patch
 * under it, because the next row starts below the tallest. Here each card
 * goes under the shortest column so far, and the last card of every column
 * is drawn out to the same bottom line. A card marked `span` takes the full
 * width; the columns above it are levelled first. Cards too few to fill the
 * columns share the full width between them.
 */

/** Height of one grid row. Cards sit on rows this fine, so any height fits to within a few pixels. */
const UNIT = 4;

export interface FlowCard {
  height: number;
  /** Takes every column. */
  wide: boolean;
}

export interface FlowPlace {
  /** 0-based column among `of`. */
  column: number;
  /** How many columns the cards around this one share. 1 for a card that takes the full width. */
  of: number;
  /** 0-based first row, in units of UNIT pixels. */
  row: number;
  /** Rows taken, the space below the card included. */
  rows: number;
}

/**
 * How many columns each card shares with its neighbours. Cards between two
 * full-width ones form a group; a group with fewer cards than there are columns
 * spreads over the full width instead of leaving columns empty.
 */
export function flowColumns(cards: Pick<FlowCard, 'wide'>[], columns: number): number[] {
  const of: number[] = [];
  let index = 0;
  while (index < cards.length) {
    if (cards[index].wide) {
      of.push(1);
      index += 1;
      continue;
    }
    let end = index;
    while (end < cards.length && !cards[end].wide) end += 1;
    for (let i = index; i < end; i++) of.push(Math.min(columns, end - index));
    index = end;
  }
  return of;
}

/** Where each card goes. `gap` is the space kept below every card, in pixels. */
export function flowLayout(cards: FlowCard[], columns: number, gap: number): FlowPlace[] {
  const of = flowColumns(cards, columns);
  const places: FlowPlace[] = [];
  // The first free row below everything placed so far.
  let top = 0;
  let index = 0;
  while (index < cards.length) {
    if (cards[index].wide) {
      const rows = Math.ceil((cards[index].height + gap) / UNIT);
      places.push({ column: 0, of: 1, row: top, rows });
      top += rows;
      index += 1;
      continue;
    }
    const count = of[index];
    const ends = new Array<number>(count).fill(top);
    const last = new Array<number>(count).fill(-1);
    let end = index;
    for (; end < cards.length && !cards[end].wide; end++) {
      // Each card goes under the shortest column so far.
      let column = 0;
      for (let c = 1; c < count; c++) if (ends[c] < ends[column]) column = c;
      const rows = Math.ceil((cards[end].height + gap) / UNIT);
      places.push({ column, of: count, row: ends[column], rows });
      ends[column] += rows;
      last[column] = end;
    }
    // The last card of each column is drawn out to the longest column, so the group ends on one line.
    const bottom = Math.max(...ends);
    for (let c = 0; c < count; c++) if (last[c] >= 0) places[last[c]].rows += bottom - ends[c];
    top = bottom;
    index = end;
  }
  return places;
}

/** Grid tracks that 1, 2 … `columns` equal columns can all be laid on: 2 → 2, 3 → 6, 4 → 12. */
function tracksFor(columns: number): number {
  const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
  let tracks = 1;
  for (let n = 2; n <= columns; n++) tracks = (tracks * n) / gcd(tracks, n);
  return tracks;
}

const PLACED = ['gridColumn', 'gridRow', 'alignSelf', 'marginBottom'] as const;

function clear(box: HTMLElement, cards: HTMLElement[]): void {
  for (const name of ['gridTemplateColumns', 'gridAutoRows', 'rowGap', 'marginBottom'] as const) box.style[name] = '';
  for (const card of cards) for (const name of PLACED) card.style[name] = '';
}

function arrange(box: HTMLElement, minWidth: number): void {
  const all = [...box.children].filter((child): child is HTMLElement => child instanceof HTMLElement);
  const gap = parseFloat(getComputedStyle(box).columnGap) || 18;
  // As many columns as fit, up to four.
  const columns = Math.min(4, Math.max(1, Math.floor((box.clientWidth + gap) / (minWidth + gap))));
  const cards = all.filter((card) => card.offsetHeight > 0);
  for (const card of all) if (!cards.includes(card)) for (const name of PLACED) card.style[name] = '';
  if (columns < 2 || cards.length < 2) {
    // One column: the plain stacked grid from the stylesheet.
    clear(box, all);
    if (cards.length === 1) cards[0].style.gridColumn = '1 / -1';
    return;
  }

  const tracks = tracksFor(columns);
  box.style.gridTemplateColumns = `repeat(${tracks}, minmax(0, 1fr))`;
  box.style.gridAutoRows = `${UNIT}px`;
  box.style.rowGap = '0px';
  // The space kept under the last cards is not part of the page.
  box.style.marginBottom = `-${gap}px`;

  const wide = cards.map((card) => ({ wide: card.classList.contains('span') }));
  const of = flowColumns(wide, columns);
  // First their width, then their own height at that width.
  cards.forEach((card, index) => {
    card.style.alignSelf = 'start';
    card.style.marginBottom = `${gap}px`;
    const span = `span ${tracks / of[index]}`;
    if (!card.style.gridColumn.endsWith(span)) card.style.gridColumn = span;
  });
  const places = flowLayout(
    cards.map((card, index) => ({ height: card.offsetHeight, wide: wide[index].wide })),
    columns,
    gap,
  );
  cards.forEach((card, index) => {
    const place = places[index];
    const width = tracks / place.of;
    card.style.gridColumn = `${place.column * width + 1} / span ${width}`;
    card.style.gridRow = `${place.row + 1} / span ${place.rows}`;
    card.style.alignSelf = 'stretch';
  });
}

interface Props {
  children: ComponentChildren;
  /** The narrowest a column may get, in pixels; fewer columns are used when they would be narrower. */
  minWidth?: number;
}

export function CardFlow({ children, minWidth = 340 }: Props) {
  const host = useRef<HTMLDivElement>(null);

  // After every render, before the browser paints, so cards never jump.
  useLayoutEffect(() => {
    if (host.current) arrange(host.current, minWidth);
  });

  // And whenever something changes size by itself: the window, a card whose own state opened a section, a picture that loaded.
  useLayoutEffect(() => {
    const box = host.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    // Not requestAnimationFrame: that stops while the page is in a background tab, and the cards would stay as they were.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        arrange(box, minWidth);
      }, 0);
    };
    const sizes = new ResizeObserver(later);
    const watch = () => {
      sizes.observe(box);
      for (const child of box.children) sizes.observe(child);
    };
    watch();
    // A card drawn out to the bottom line does not change size when its content changes, so changes inside count too.
    // They are handled at once, before the browser paints.
    const changes = new MutationObserver(() => {
      watch();
      arrange(box, minWidth);
    });
    changes.observe(box, { childList: true, subtree: true, characterData: true });
    box.addEventListener('load', later, true);
    return () => {
      clearTimeout(timer);
      sizes.disconnect();
      changes.disconnect();
      box.removeEventListener('load', later, true);
    };
  }, [minWidth]);

  return (
    <div class="admin-grid card-flow" ref={host}>
      {children}
    </div>
  );
}
