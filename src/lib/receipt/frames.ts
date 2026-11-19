import { createStore } from '../store';
import { pad, type Page } from './page';

type Photos = (CanvasImageSource | undefined)[];

/** A printable design the guest can pick: how many photos, their shape, and the decoration around them. */
export interface FrameDef {
  id: string;
  name: string;
  /** One line shown under the name on the picker. */
  blurb: string;
  /** Width ÷ height of each photo, in the order they are taken. */
  slots: number[];
  /** Changes when a franchise's own frame is edited, so pictures made of the old one are not reused. */
  version?: string;
  /** Draws the photos and their decoration at the page cursor and moves the cursor past them. */
  draw(page: Page, photos: Photos, when: Date): void;
}

const LANDSCAPE = 4 / 3;

/** Small repeatable random source, so a frame's doodles land in the same places on every print. */
function scatter(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

const klasik: FrameDef = {
  id: 'klasik',
  name: 'Klasik',
  blurb: '3 foto berurutan',
  slots: [LANDSCAPE, LANDSCAPE, LANDSCAPE],
  draw(page, photos) {
    for (let i = 0; i < this.slots.length; i++) {
      page.y += page.photo(photos[i], page.margin, page.inner, this.slots[i]) + page.px(12);
    }
  },
};

// Every frame puts one photo per row, across the full width: side by side, photos come out
// too small on receipt paper, above all on 58 mm.
const kolase: FrameDef = {
  id: 'kolase',
  name: 'Kolase',
  blurb: '4 foto berurutan, rapat',
  slots: [LANDSCAPE, LANDSCAPE, LANDSCAPE, LANDSCAPE],
  draw(page, photos) {
    // Close together, like one tall strip.
    for (let i = 0; i < this.slots.length; i++) {
      page.y += page.photo(photos[i], page.margin, page.inner, this.slots[i]) + page.px(i === this.slots.length - 1 ? 12 : 4);
    }
  },
};

const film: FrameDef = {
  id: 'film',
  name: 'Rol Film',
  blurb: '3 foto ala film jadul',
  slots: [LANDSCAPE, LANDSCAPE, LANDSCAPE],
  draw(page, photos) {
    const band = page.px(44);
    const gutter = page.px(14);
    const left = page.margin;
    const photoWidth = page.inner - band * 2;
    const photoHeight = Math.round(photoWidth / LANDSCAPE);
    const total = gutter + this.slots.length * (photoHeight + gutter);

    page.rect(left, page.y, page.inner, total);
    // Sprocket holes down both edges of the strip.
    const holeW = page.px(22);
    const holeH = page.px(15);
    for (let y = page.y + page.px(12); y + holeH < page.y + total - page.px(6); y += page.px(38)) {
      page.rect(left + (band - holeW) / 2, y, holeW, holeH, '#fff');
      page.rect(left + page.inner - band + (band - holeW) / 2, y, holeW, holeH, '#fff');
    }
    for (let i = 0; i < this.slots.length; i++) {
      page.photoAt(photos[i], left + band, page.y + gutter + i * (photoHeight + gutter), photoWidth, LANDSCAPE, 0);
    }
    page.y += total + page.px(12);
  },
};

const polaroid: FrameDef = {
  id: 'polaroid',
  name: 'Polaroid',
  blurb: '2 foto persegi bertumpuk',
  slots: [1, 1],
  draw(page, photos, when) {
    const cardWidth = page.px(430);
    const side = page.px(24);
    const caption = page.px(92);
    const shadow = page.px(9);
    const line = Math.max(2, page.px(3));
    const photoWidth = cardWidth - side * 2;
    const cardHeight = side + photoWidth + caption;

    for (let i = 0; i < this.slots.length; i++) {
      // The two cards lean apart, like prints dropped on a table.
      const x = Math.round((page.width - cardWidth) / 2) + (i === 0 ? -page.px(24) : page.px(24));
      page.rect(x + shadow, page.y + shadow, cardWidth, cardHeight);
      page.rect(x, page.y, cardWidth, cardHeight);
      page.rect(x + line, page.y + line, cardWidth - line * 2, cardHeight - line * 2, '#fff');
      page.photoAt(photos[i], x + side, page.y + side, photoWidth, 1, 2);

      const captionMiddle = page.y + side + photoWidth + caption / 2;
      if (i === 0) {
        const date = `${pad(when.getDate())}.${pad(when.getMonth() + 1)}.${when.getFullYear()}`;
        page.label(date, x + cardWidth / 2, captionMiddle - page.px(16), 26, true);
      } else {
        for (const offset of [-1, 0, 1]) page.heart(x + cardWidth / 2 + offset * page.px(46), captionMiddle, page.px(30));
      }
      page.y += cardHeight + shadow + page.px(22);
    }
  },
};

const NOTA_ITEMS = ['SENYUM MANIS', 'GAYA ANDALAN', 'POSE KOCAK', 'TAWA LEPAS', 'CANDID', 'KOMPAK'];

const nota: FrameDef = {
  id: 'nota',
  name: 'Nota Belanja',
  blurb: '3 foto dengan daftar belanja lucu',
  slots: [LANDSCAPE, LANDSCAPE, LANDSCAPE],
  draw(page, photos) {
    for (let i = 0; i < this.slots.length; i++) {
      page.row(`${pad(i + 1)} ${NOTA_ITEMS[i % NOTA_ITEMS.length]}`, '1x', 20, true);
      page.gap(6);
      page.y += page.photo(photos[i], page.margin, page.inner, this.slots[i]) + page.px(14);
    }
    page.dashed();
    page.gap(8);
    page.row('SUBTOTAL', `${this.slots.length} FOTO`, 20);
    page.row('PAJAK SENYUM', '0%', 20);
    page.row('DISKON TEMAN', '100%', 20);
    page.gap(6);
    page.solid();
    page.gap(8);
    page.row('TOTAL', 'TAK TERNILAI', 26, true);
    page.gap(12);
  },
};

const pesta: FrameDef = {
  id: 'pesta',
  name: 'Pesta',
  blurb: '3 foto persegi penuh hiasan',
  slots: [1, 1, 1],
  draw(page, photos) {
    const photoWidth = page.px(396);
    const x = Math.round((page.width - photoWidth) / 2);
    const gap = page.px(18);
    const top = page.y;
    for (let i = 0; i < this.slots.length; i++) {
      page.y += page.photoAt(photos[i], x, page.y, photoWidth, 1, 6) + gap;
    }

    // Stars, hearts and twinkles fill the margins on both sides of the photos.
    const lane = x - page.margin;
    const random = scatter(11);
    let kind = 0;
    for (let y = top + page.px(24); y < page.y - gap - page.px(24); y += page.px(62)) {
      for (const leftSide of [true, false]) {
        const inset = lane * (0.32 + 0.36 * random());
        const cx = leftSide ? page.margin + inset : page.width - page.margin - inset;
        const cy = y + page.px(20) * random();
        const size = page.px(13 + 8 * random());
        if (kind % 3 === 0) page.star(cx, cy, size);
        else if (kind % 3 === 1) page.heart(cx, cy, size * 1.7);
        else page.sparkle(cx, cy, size * 1.25);
        kind += 1;
      }
    }
  },
};

const potret: FrameDef = {
  id: 'potret',
  name: 'Potret',
  blurb: '1 foto besar berdiri',
  slots: [3 / 4],
  draw(page, photos) {
    // A double rule around the photo, like a mounted print.
    const line = Math.max(2, page.px(3));
    const inset = line + page.px(7);
    const photoWidth = page.inner - inset * 2;
    const height = Math.round(photoWidth / this.slots[0]) + inset * 2;
    page.rect(page.margin, page.y, page.inner, height);
    page.rect(page.margin + line, page.y + line, page.inner - line * 2, height - line * 2, '#fff');
    page.photoAt(photos[0], page.margin + inset, page.y + inset, photoWidth, this.slots[0], 2);
    page.y += height + page.px(12);
  },
};

/** The frames built into the app, available to every franchise. */
export const FRAMES: FrameDef[] = [klasik, kolase, film, polaroid, nota, pesta, potret];

/**
 * Frames the franchise made itself, ready to draw. Filled from the tablet's own
 * store when the booth starts and again whenever the server has newer ones.
 */
export const customFramesStore = createStore<FrameDef[]>([]);

function allFrames(): FrameDef[] {
  return [...FRAMES, ...customFramesStore.get()];
}

/** The frame with this id, or the first frame when the id is unknown (e.g. a frame that was deleted since). */
export function frameById(id: string | undefined): FrameDef {
  return allFrames().find((frame) => frame.id === id) ?? FRAMES[0];
}

/** The frames guests may choose, in the operator's order. Never empty. */
export function activeFrames(ids: string[]): FrameDef[] {
  const all = allFrames();
  const chosen = ids.map((id) => all.find((frame) => frame.id === id)).filter((frame) => frame !== undefined);
  return chosen.length > 0 ? chosen : FRAMES;
}
