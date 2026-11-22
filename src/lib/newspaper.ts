/**
 * The session as the front page of a newspaper: the booth's place name as the
 * headline, the first photo as the lead picture, the others further down, and
 * a tongue-in-cheek report set in columns around them. One fixed design; the
 * only thing staff choose is the headline (the name of the place).
 */

/** Upright, two by three like a 4R photo print: fills a phone's screen, sharp enough, and fits photo paper. */
export const NEWS = { width: 1240, height: 1860, margin: 60 };

const PAPER = '#f2ede2';
const INK = '#17150f';
const SOFT_INK = '#57524a';
const HEAD = 'Anton, "Arial Narrow", Impact, sans-serif';
const SERIF = '"Instrument Serif", "Times New Roman", serif';
const SANS = '"Inter Variable", Inter, system-ui, sans-serif';

type Picture = CanvasImageSource & { width: number; height: number };

export interface NewsInput {
  /** The big word across the page: the place where the booth stands. */
  headline: string;
  /** The booth's own name, in the masthead. */
  brand: string;
  when: Date;
  sessionNo: number;
  /** The session's photos as taken, first one first. */
  photos: Picture[];
  /** A line for the bottom corner, e.g. the platform's social media account. '' for none. */
  footer: string;
}

/** The report. `place` is the headline as staff typed it. */
export function newsStory(place: string, brand: string): string[] {
  return [
    `${place.toUpperCase()} — Kamera photobooth ${brand} hari ini menangkap momen yang langsung jadi buah bibir: senyum paling cerah yang pernah terekam di ${place}. Saksi mata menyebut suasana mendadak hangat begitu hitungan mundur dimulai.`,
    '“Baru hitungan ketiga, gayanya sudah keluar semua,” kata seorang pengunjung yang ikut mengantre. Ia mengaku belum pernah melihat pose sekompak itu sepanjang pekan ini.',
    'Pengamat gaya setempat menilai foto ini layak masuk halaman depan. Pencahayaannya pas, ekspresinya lepas, dan tidak ada yang berkedip, sebuah prestasi yang jarang terjadi.',
    'Hingga berita ini diturunkan, senyum tersebut dilaporkan masih bertahan. Warga yang ingin menyusul diimbau menyiapkan gaya terbaiknya sebelum masuk ke dalam booth.',
    `Pihak ${brand} menyatakan seluruh foto sudah diamankan dalam bentuk digital dan bisa diunduh lewat kode QR pada struk. Tidak ada senyum yang terluka dalam peristiwa ini.`,
    'Sementara itu, prakiraan suasana hati untuk sisa hari ini adalah cerah berawan, dengan peluang tertawa lepas pada sore hingga malam hari.',
    'Di tempat terpisah, sejumlah pengunjung mengaku ketagihan dan berencana kembali membawa teman, keluarga, maupun gebetan.',
    'Redaksi mengucapkan terima kasih sudah mampir. Jangan lupa tersenyum, dan sampai jumpa di edisi berikutnya.',
  ];
}

export interface FlowLine {
  words: string[];
  /** Pixels the line starts in from the left: the first line of a paragraph after the first. */
  indent: number;
  /** Spread to the full width; false for the last line of a paragraph. */
  justify: boolean;
  /** The closing "continued on page …" line, set apart from the text. */
  note?: boolean;
}

const CONTINUED = 'Bersambung ke hal. 7';

/**
 * Sets the paragraphs into columns: `capacity` says how many lines each column
 * holds, in reading order. The text is repeated if it runs out, so every column
 * is full, and the very last line is the "continued" note a newspaper ends on
 * when a story does not fit, so the report never just stops in mid-sentence.
 */
export function flowLines(paragraphs: string[], capacity: number[], width: number, measure: (text: string) => number, indent: number): FlowLine[][] {
  const total = capacity.reduce((sum, lines) => sum + Math.max(0, lines), 0);
  const lines: FlowLine[] = [];
  const room = total - 1;
  for (let turn = 0; lines.length < room && paragraphs.length > 0 && turn < 400; turn++) {
    const words = paragraphs[turn % paragraphs.length].split(/\s+/).filter(Boolean);
    // Only the opening paragraph starts flush left.
    let lead = turn === 0 ? 0 : indent;
    let current: string[] = [];
    for (const word of words) {
      if (current.length > 0 && measure([...current, word].join(' ')) > width - lead) {
        lines.push({ words: current, indent: lead, justify: true });
        lead = 0;
        current = [];
        if (lines.length >= room) break;
      }
      current.push(word);
    }
    if (lines.length < room && current.length > 0) lines.push({ words: current, indent: lead, justify: false });
  }
  if (total > 0) lines.push({ words: CONTINUED.split(' '), indent: 0, justify: false, note: true });

  const columns: FlowLine[][] = [];
  let at = 0;
  for (const size of capacity) {
    columns.push(lines.slice(at, at + Math.max(0, size)));
    at += Math.max(0, size);
  }
  return columns;
}

/** The largest size, from `max` down to `min`, at which the text is no wider than `width`. */
export function fitSize(widthAt: (size: number) => number, width: number, max: number, min: number): number {
  for (let size = max; size > min; size -= 2) if (widthAt(size) <= width) return size;
  return min;
}

/**
 * Which columns get a small photo at their foot, in the order the photos were
 * taken: one goes left, two go to the outer columns (the forecast box keeps the
 * middle), three fill all of them.
 */
export function photoColumns(smallPhotos: number): number[] {
  if (smallPhotos <= 0) return [];
  if (smallPhotos === 1) return [0];
  return smallPhotos === 2 ? [0, 2] : [0, 1, 2];
}

/** Draws the picture so that it fills the box, keeping faces (usually in the upper part) when it has to cut. */
function drawCover(ctx: CanvasRenderingContext2D, picture: Picture, x: number, y: number, w: number, h: number): void {
  const scale = Math.max(w / picture.width, h / picture.height);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (picture.width - sw) / 2;
  const sy = (picture.height - sh) * 0.35;
  ctx.drawImage(picture, sx, sy, sw, sh, x, y, w, h);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
}

function rule(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, thickness: number): void {
  ctx.fillStyle = INK;
  ctx.fillRect(x, y, w, thickness);
}

function spaced(ctx: CanvasRenderingContext2D, spacing: number): void {
  // Letter spacing on a canvas is recent; where it is missing the text is simply set tighter.
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${spacing}px`;
}

/** Canvas text quietly falls back to another font unless the web font is loaded first. */
export async function loadNewsFonts(): Promise<void> {
  await Promise.all([
    document.fonts.load('400 200px Anton'),
    document.fonts.load('400 40px "Instrument Serif"'),
    document.fonts.load('italic 400 40px "Instrument Serif"'),
    document.fonts.load('600 18px "Inter Variable"'),
  ]).catch(() => undefined);
}

const TEXT_SIZE = 23;
const LINE = 31;
const GUTTER = 30;

/** The front page, drawn. Load the fonts first (loadNewsFonts). */
export function drawNewspaper(input: NewsInput): HTMLCanvasElement {
  const { width: W, height: H, margin: M } = NEWS;
  const inner = W - 2 * M;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';

  const place = input.headline.trim() || input.brand.trim() || 'Photobooth';
  const brand = input.brand.trim() || 'Photobooth';
  const longDate = input.when.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const time = input.when.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const number = String(input.sessionNo).padStart(3, '0');

  // Newsprint: warm off-white with a little grain.
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? 'rgb(0 0 0 / 0.035)' : 'rgb(255 255 255 / 0.18)';
    ctx.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);
  }

  // ---- The line above the masthead.
  ctx.fillStyle = INK;
  ctx.textBaseline = 'alphabetic';
  ctx.font = `600 17px ${SANS}`;
  spaced(ctx, 3);
  ctx.textAlign = 'left';
  ctx.fillText(`EDISI SPESIAL · NO. ${number}`, M, 76);
  ctx.textAlign = 'right';
  ctx.fillText(`PUKUL ${time}`, W - M, 76);

  // ---- Masthead: the booth's name between rules, the date on one side and the price on the other.
  rule(ctx, M, 92, inner, 5);
  rule(ctx, M, 101, inner, 1.5);
  const side = 250;
  ctx.textAlign = 'left';
  ctx.font = `600 16px ${SANS}`;
  spaced(ctx, 2);
  const [weekday, ...rest] = longDate.toUpperCase().split(', ');
  ctx.fillText(weekday, M, 134);
  ctx.fillText(rest.join(', '), M, 158);
  ctx.textAlign = 'right';
  ctx.fillText('HARGA ECERAN', W - M, 134);
  ctx.fillText('SATU SENYUMAN', W - M, 158);
  ctx.textAlign = 'center';
  spaced(ctx, 5);
  const brandText = brand.toUpperCase();
  const brandSize = fitSize(
    (size) => {
      ctx.font = `400 ${size}px ${SERIF}`;
      return ctx.measureText(brandText).width;
    },
    inner - 2 * side,
    58,
    24,
  );
  ctx.font = `400 ${brandSize}px ${SERIF}`;
  ctx.fillText(brandText, W / 2, 142 + brandSize * 0.3);
  rule(ctx, M, 176, inner, 1.5);
  rule(ctx, M, 184, inner, 5);

  // ---- The headline: the place, as wide as the page allows.
  spaced(ctx, 0);
  const headline = place.toUpperCase();
  const headSize = fitSize(
    (size) => {
      ctx.font = `400 ${size}px ${HEAD}`;
      return ctx.measureText(headline).width;
    },
    inner,
    250,
    70,
  );
  ctx.font = `400 ${headSize}px ${HEAD}`;
  const metrics = ctx.measureText(headline);
  const headTop = 206;
  const headBase = headTop + metrics.actualBoundingBoxAscent;
  ctx.textAlign = 'center';
  ctx.fillStyle = INK;
  ctx.fillText(headline, W / 2, headBase);
  let y = headBase + metrics.actualBoundingBoxDescent + 22;

  // ---- The deck: a tag and one line saying what the story is.
  const tag = 'BERITA UTAMA';
  ctx.font = `700 16px ${SANS}`;
  spaced(ctx, 2);
  const tagWidth = ctx.measureText(tag).width + 26;
  ctx.fillStyle = INK;
  ctx.fillRect(M, y, tagWidth, 40);
  ctx.fillStyle = PAPER;
  ctx.textAlign = 'left';
  ctx.fillText(tag, M + 13, y + 26);
  spaced(ctx, 0);
  ctx.fillStyle = INK;
  const deck = 'Senyum paling cerah hari ini tertangkap kamera';
  const deckSize = fitSize(
    (size) => {
      ctx.font = `italic 400 ${size}px ${SERIF}`;
      return ctx.measureText(deck).width;
    },
    inner - tagWidth - 22,
    42,
    22,
  );
  ctx.font = `italic 400 ${deckSize}px ${SERIF}`;
  ctx.fillText(deck, M + tagWidth + 22, y + 31);
  y += 56;
  rule(ctx, M, y, inner, 1.5);
  y += 18;

  // ---- Columns below the lead picture are planned from the bottom up, so the picture takes what is left.
  const footTop = H - 132;
  const columnWidth = (inner - 2 * GUTTER) / 3;
  const smallHeight = Math.round(columnWidth / 1.5);
  const small = input.photos.slice(1, 4);
  const withPhoto = photoColumns(small.length);
  const box = withPhoto.includes(1) ? 0 : 176;
  // Six lines of text above the small photos; a page without them has shorter columns and a taller lead picture.
  const columnsHeight = small.length > 0 ? 6 * LINE + smallHeight + 52 : 11 * LINE;
  const columnsTop = footTop - 26 - columnsHeight;

  // ---- The lead picture and its caption.
  const [lead] = input.photos;
  const leadHeight = columnsTop - 54 - y;
  if (lead) drawCover(ctx, lead, M, y, inner, leadHeight);
  else {
    ctx.fillStyle = '#d9d2c2';
    ctx.fillRect(M, y, inner, leadHeight);
  }
  y += leadHeight + 28;
  ctx.fillStyle = SOFT_INK;
  ctx.font = `italic 400 21px ${SERIF}`;
  ctx.textAlign = 'left';
  ctx.fillText(`Tertangkap kamera di ${place}, ${longDate}.`, M, y);
  ctx.textAlign = 'right';
  ctx.font = `600 14px ${SANS}`;
  spaced(ctx, 2);
  ctx.fillText(`FOTO: ${brandText}`, W - M, y);
  spaced(ctx, 0);

  // ---- Three columns: text on top, and at the foot of each a small photo, the forecast box, or more text.
  const captions = ['Gaya kedua, tak kalah heboh.', 'Bonus: pose andalan.', 'Edisi kolektor.'];
  const columnBottom = footTop - 26;
  const capacity: number[] = [];
  for (let c = 0; c < 3; c++) {
    const slot = withPhoto.indexOf(c);
    const block = slot >= 0 ? smallHeight + 52 : c === 1 && box > 0 ? box + 22 : 0;
    capacity.push(Math.floor((columnBottom - columnsTop - block) / LINE));
  }
  ctx.font = `400 ${TEXT_SIZE}px ${SERIF}`;
  const columns = flowLines(newsStory(place, brand), capacity, columnWidth, (text) => ctx.measureText(text).width, 26);
  for (let c = 0; c < 3; c++) {
    const x = M + c * (columnWidth + GUTTER);
    if (c > 0) rule(ctx, x - GUTTER / 2, columnsTop - 8, 1, columnBottom - columnsTop + 8);
    let lineY = columnsTop + TEXT_SIZE;
    for (const line of columns[c]) {
      if (line.note) {
        ctx.font = `italic 400 ${TEXT_SIZE - 2}px ${SERIF}`;
        ctx.fillStyle = SOFT_INK;
        ctx.textAlign = 'right';
        ctx.fillText(line.words.join(' '), x + columnWidth, lineY);
      } else {
        ctx.font = `400 ${TEXT_SIZE}px ${SERIF}`;
        ctx.fillStyle = INK;
        ctx.textAlign = 'left';
        const widths = line.words.map((word) => ctx.measureText(word).width);
        const space = ctx.measureText(' ').width;
        const free = columnWidth - line.indent - widths.reduce((sum, w) => sum + w, 0);
        const gaps = line.words.length - 1;
        // Spread to the full width, unless that would tear the words too far apart.
        const gap = line.justify && gaps > 0 && free / gaps < space * 4 ? free / gaps : space;
        let wordX = x + line.indent;
        line.words.forEach((word, index) => {
          ctx.fillText(word, wordX, lineY);
          wordX += widths[index] + gap;
        });
      }
      lineY += LINE;
    }

    const slot = withPhoto.indexOf(c);
    if (slot >= 0) {
      const top = columnBottom - smallHeight - 34;
      drawCover(ctx, small[slot], x, top, columnWidth, smallHeight);
      ctx.fillStyle = SOFT_INK;
      ctx.font = `italic 400 19px ${SERIF}`;
      ctx.textAlign = 'left';
      ctx.fillText(captions[slot], x, columnBottom - 8);
    } else if (c === 1 && box > 0) {
      const top = columnBottom - box;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, top + 1, columnWidth - 2, box - 2);
      ctx.fillStyle = INK;
      ctx.fillRect(x + 1, top + 1, columnWidth - 2, 38);
      ctx.fillStyle = PAPER;
      ctx.textAlign = 'center';
      ctx.font = `700 15px ${SANS}`;
      spaced(ctx, 3);
      ctx.fillText('PRAKIRAAN HARI INI', x + columnWidth / 2, top + 26);
      spaced(ctx, 0);
      ctx.fillStyle = INK;
      ctx.font = `400 78px ${HEAD}`;
      ctx.fillText('CERAH', x + columnWidth / 2, top + 118);
      ctx.font = `italic 400 22px ${SERIF}`;
      ctx.fillText('Peluang tertawa lepas 99%', x + columnWidth / 2, top + 154);
    }
  }

  // ---- The foot of the page: a barcode, where and when, and the platform's line.
  rule(ctx, M, footTop, inner, 1.5);
  let barX = M;
  const seed = input.sessionNo * 7919 + input.when.getDate() * 131;
  for (let i = 0; i < 34; i++) {
    const wide = ((seed >> i % 13) + i * 5) % 3;
    const barWidth = 2 + wide * 2;
    if (i % 2 === 0) {
      ctx.fillStyle = INK;
      ctx.fillRect(barX, footTop + 20, barWidth, 46);
    }
    barX += barWidth;
  }
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.font = `600 14px ${SANS}`;
  spaced(ctx, 3);
  ctx.fillText(`NO. ${number}`, M, footTop + 88);
  ctx.textAlign = 'center';
  ctx.fillText(`${brandText} · ${longDate.toUpperCase()}`, W / 2, footTop + 50);
  ctx.textAlign = 'right';
  if (input.footer.trim()) ctx.fillText(input.footer.trim().toUpperCase(), W - M, footTop + 50);
  spaced(ctx, 0);
  rule(ctx, M, H - 34, inner, 5);

  return canvas;
}
