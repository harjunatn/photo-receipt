import { describe, expect, it } from 'vitest';
import { buildPdf, fitText, textWidth } from '../src/lib/export/pdf';
import { buildXlsx, columnName, excelDate } from '../src/lib/export/xlsx';
import { crc32, zip } from '../src/lib/export/zip';

const ascii = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

describe('zip', () => {
  it('computes the standard checksum', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('lists every file in the central directory', () => {
    const out = zip([
      { name: 'a.txt', data: new TextEncoder().encode('halo') },
      { name: 'b/c.xml', data: new TextEncoder().encode('<x/>') },
    ]);
    const text = ascii(out);
    expect(text.startsWith('PK\u0003\u0004')).toBe(true);
    expect(text.split('PK\u0001\u0002')).toHaveLength(3);
    expect(text).toContain('PK\u0005\u0006');
  });
});

describe('Excel workbook', () => {
  it('names columns like Excel does', () => {
    expect([0, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
  });

  it('turns a moment into the day number Excel shows as that local date and time', () => {
    expect(excelDate(new Date(2026, 10, 19, 12, 0, 0))).toBe(46345.5);
  });

  it('writes text safely, numbers as numbers, and a total row with sums', () => {
    const out = buildXlsx('Transaksi', [{ header: 'Perangkat', width: 20 }, { header: 'Harga', width: 12, format: 'rupiah', sum: true }], [
      ['Booth <Kafe> & "Senja"', 15000],
      ['Booth B', 20000],
    ]);
    const text = new TextDecoder().decode(out);
    expect(text).toContain('Booth &lt;Kafe&gt; &amp; &quot;Senja&quot;');
    expect(text).toContain('<v>15000</v>');
    expect(text).toContain('<f>SUM(B2:B3)</f>');
  });
});

describe('PDF report', () => {
  const report = (rows: number) =>
    buildPdf({
      title: 'Laporan transaksi Booth (Senja)',
      lines: ['Periode 13/11/2026 – 19/11/2026 · Cara bayar: Semua'],
      columns: [
        { header: 'Perangkat', width: 300 },
        { header: 'Harga', width: 100, align: 'right' },
      ],
      rows: Array.from({ length: rows }, (_, i) => [`Booth ${i + 1}`, 'Rp15.000']),
      total: ['Total', `Rp${rows * 15}.000`],
      footer: 'Dibuat 19 Nov 2026',
    });

  it('is a well-formed PDF whose index points at every object', () => {
    const text = ascii(report(3));
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    const xrefAt = Number(text.match(/startxref\n(\d+)/)![1]);
    expect(text.slice(xrefAt, xrefAt + 4)).toBe('xref');
    const entries = text.slice(xrefAt).split('\n').slice(3).filter((line) => / 00000 n $/.test(line));
    entries.forEach((line, i) => {
      const offset = Number(line.slice(0, 10));
      expect(text.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true);
    });
    // Brackets in text are escaped, and the en dash and middle dot use the font's own codes.
    expect(text).toContain('Booth \\(Senja\\)');
    expect(text).toContain('\\226');
    expect(text).toContain('\\267');
  });

  it('spreads long reports over pages and numbers them', () => {
    const text = ascii(report(200));
    const pages = Number(text.match(/\/Count (\d+)/)![1]);
    expect(pages).toBeGreaterThan(5);
    expect(text).toContain(`(Halaman ${pages} dari ${pages})`);
  });

  it('measures text with Helvetica widths and shortens what does not fit', () => {
    expect(textWidth('0123456789', 10)).toBeCloseTo(55.6);
    expect(textWidth('iiii', 10)).toBeLessThan(textWidth('MMMM', 10));
    const cut = fitText('Booth Kafe Senja di Lantai Dua Dekat Eskalator', 80, 8.5);
    expect(cut.endsWith('…')).toBe(true);
    expect(textWidth(cut, 8.5)).toBeLessThanOrEqual(80);
  });
});

describe('payment status in the session history', () => {
  it('reads automatic QRIS from the provider and treats every other payment as settled', async () => {
    const { paymentState } = await import('../src/dashboard/Transactions');
    expect(paymentState({ method: 'qris', payment_status: 'paid' })).toEqual({ label: 'Berhasil', tag: 'ok' });
    expect(paymentState({ method: 'qris', payment_status: 'pending' })).toEqual({ label: 'Menunggu', tag: 'warn' });
    expect(paymentState({ method: 'qris', payment_status: 'failed' })).toEqual({ label: 'Gagal', tag: 'err' });
    expect(paymentState({ method: 'qris', payment_status: 'expired' })).toEqual({ label: 'Gagal', tag: 'err' });
    // Static QRIS has no provider behind it; staff took the payment.
    expect(paymentState({ method: 'qris', payment_status: null })).toEqual({ label: 'Berhasil', tag: 'ok' });
    expect(paymentState({ method: 'cash', payment_status: null })).toEqual({ label: 'Berhasil', tag: 'ok' });
    expect(paymentState({ method: 'voucher', payment_status: null })).toEqual({ label: 'Berhasil', tag: 'ok' });
  });
});
