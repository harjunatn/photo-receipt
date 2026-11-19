/**
 * A small PDF writer for table reports: A4 landscape, the standard Helvetica
 * font (no font files needed), the column header repeated on every page and
 * page numbers at the bottom.
 */

export interface PdfColumn {
  header: string;
  /** Width in points (1/72 inch); the usable width of a landscape A4 page is 770. */
  width: number;
  align?: 'left' | 'right';
}

export interface PdfReport {
  title: string;
  /** Lines under the title: period, filters, totals. */
  lines: string[];
  columns: PdfColumn[];
  rows: string[][];
  /** A bold last row, e.g. totals. */
  total?: string[];
  /** Printed small at the bottom of every page, before the page number. */
  footer: string;
}

const PAGE_W = 842;
const PAGE_H = 595;
const MARGIN = 36;
const ROW_H = 15;
const FONT_SIZE = 8.5;
const PAD = 4;

// Helvetica widths per 1000 units, for the printable ASCII characters (space to ~).
const ASCII_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
// Helvetica-Bold differs from regular for some letters; close enough for headers by scaling.
const BOLD_FACTOR = 1.06;

/** Characters outside ASCII that the standard PDF fonts can print, and their byte. */
const WIN_ANSI: Record<string, number> = {
  '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
};

/** One byte per character in the font's encoding; anything it cannot print becomes '?'. */
function toWinAnsi(text: string): number[] {
  const bytes: number[] = [];
  for (const ch of text.normalize('NFC')) {
    const code = ch.codePointAt(0)!;
    if (code >= 32 && code < 127) bytes.push(code);
    else if (WIN_ANSI[ch] !== undefined) bytes.push(WIN_ANSI[ch]);
    else if (code >= 0xa0 && code <= 0xff) bytes.push(code);
    else if (code === 9 || code === 10) bytes.push(32);
    else bytes.push(63);
  }
  return bytes;
}

function charWidth(byte: number): number {
  if (byte >= 32 && byte < 127) return ASCII_WIDTHS[byte - 32];
  if (byte === 0xb7 || byte === 0x95) return 350;
  if (byte === 0x85) return 1000;
  if (byte === 0x96) return 556;
  if (byte === 0x97) return 1000;
  return 556;
}

export function textWidth(text: string, size: number, bold = false): number {
  const units = toWinAnsi(text).reduce((sum, byte) => sum + charWidth(byte), 0);
  return (units * size * (bold ? BOLD_FACTOR : 1)) / 1000;
}

/** Shortens text with "…" until it fits. */
export function fitText(text: string, width: number, size: number, bold = false): string {
  if (textWidth(text, size, bold) <= width) return text;
  let cut = text;
  while (cut.length > 0 && textWidth(`${cut}…`, size, bold) > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/** A PDF string literal: printable bytes as they are, the rest as octal escapes. */
function pdfString(text: string): string {
  let out = '(';
  for (const byte of toWinAnsi(text)) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
    else if (byte < 32 || byte > 126) out += `\\${byte.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(byte);
  }
  return `${out})`;
}

const num = (value: number) => (Math.round(value * 100) / 100).toString();

function textOp(text: string, x: number, y: number, size: number, bold: boolean): string {
  return `BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${num(x)} ${num(y)} Td ${pdfString(text)} Tj ET`;
}

/** Puts every row's cells in place, column by column, aligned and shortened to fit. */
function rowOps(cells: string[], columns: PdfColumn[], top: number, bold: boolean): string[] {
  const ops: string[] = [];
  let x = MARGIN;
  const baseline = top - ROW_H + 4.5;
  columns.forEach((column, i) => {
    const text = fitText(cells[i] ?? '', column.width - PAD * 2, FONT_SIZE, bold);
    const tx = column.align === 'right' ? x + column.width - PAD - textWidth(text, FONT_SIZE, bold) : x + PAD;
    if (text) ops.push(textOp(text, tx, baseline, FONT_SIZE, bold));
    x += column.width;
  });
  return ops;
}

export function buildPdf(report: PdfReport): Uint8Array<ArrayBuffer> {
  const tableWidth = report.columns.reduce((sum, column) => sum + column.width, 0);
  const firstTop = PAGE_H - MARGIN - 22 - report.lines.length * 13 - 12;
  const otherTop = PAGE_H - MARGIN;
  const bottom = MARGIN + 20;
  const all = report.total ? [...report.rows, report.total] : report.rows;

  // Split the rows over pages; every page repeats the column header.
  const pages: { top: number; rows: string[][]; first: boolean }[] = [];
  let index = 0;
  do {
    const first = pages.length === 0;
    const top = first ? firstTop : otherTop;
    const fits = Math.max(1, Math.floor((top - ROW_H - bottom) / ROW_H));
    pages.push({ top, rows: all.slice(index, index + fits), first });
    index += fits;
  } while (index < all.length);

  const contents = pages.map((page, p) => {
    const ops: string[] = [];
    if (page.first) {
      ops.push(textOp(report.title, MARGIN, PAGE_H - MARGIN - 14, 16, true));
      report.lines.forEach((line, i) => ops.push(textOp(line, MARGIN, PAGE_H - MARGIN - 34 - i * 13, 9.5, false)));
    }
    // Column header on a soft band.
    ops.push(`0.93 0.92 0.89 rg ${num(MARGIN)} ${num(page.top - ROW_H)} ${num(tableWidth)} ${ROW_H} re f 0 g`);
    ops.push(...rowOps(report.columns.map((column) => column.header), report.columns, page.top, true));
    page.rows.forEach((cells, r) => {
      const top = page.top - ROW_H * (r + 1);
      const isTotal = report.total !== undefined && cells === report.total;
      if (isTotal) {
        ops.push(`0 g 0.6 w ${num(MARGIN)} ${num(top)} m ${num(MARGIN + tableWidth)} ${num(top)} l S`);
      } else if (r % 2 === 1) {
        ops.push(`0.97 0.965 0.95 rg ${num(MARGIN)} ${num(top - ROW_H)} ${num(tableWidth)} ${ROW_H} re f 0 g`);
      }
      ops.push(...rowOps(cells, report.columns, top, isTotal));
    });
    const pageNo = `Halaman ${p + 1} dari ${pages.length}`;
    ops.push(`0.4 g`);
    ops.push(textOp(report.footer, MARGIN, MARGIN, 7.5, false));
    ops.push(textOp(pageNo, PAGE_W - MARGIN - textWidth(pageNo, 7.5), MARGIN, 7.5, false));
    ops.push('0 g');
    return ops.join('\n');
  });

  // Objects: 1 catalog, 2 page tree, 3–4 fonts, 5 info, then a page and its content per page.
  const objects: string[] = [];
  const pageIds = pages.map((_, p) => 6 + p * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objects[5] = `<< /Title ${pdfString(report.title)} /Producer (Photobooth) >>`;
  contents.forEach((content, p) => {
    const pageId = pageIds[p];
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });

  // Every character above is a single byte, so string length is the byte offset.
  let out = '%PDF-1.4\n%âãÏÓ\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
