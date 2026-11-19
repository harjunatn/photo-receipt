import { useEffect, useState } from 'preact/hooks';
import { samplePhoto } from '../lib/demoScene';
import type { BitImage } from '../lib/image/types';
import { composeReceipt, loadImage, loadReceiptFonts, receiptToBits } from '../lib/receipt/compose';
import { activeFrames } from '../lib/receipt/frames';
import { useSettings } from '../lib/settings';
import { ReceiptPaper } from '../ui/components';
import { edit } from './actions';
import { AreaField, Check, TextField } from './fields';

/**
 * What this booth's receipt says. Each tablet writes its own texts, so booths can
 * carry their own names; the logo and the frames come from the owner's dashboard.
 */
export function ReceiptTab() {
  const settings = useSettings();
  const { receipt, printer } = settings;
  // The sample receipt uses whichever frame guests are offered first.
  const frame = activeFrames(settings.frames.active)[0];
  const [preview, setPreview] = useState<BitImage | null>(null);

  // Rebuild the sample receipt shortly after the last change, so typing stays smooth.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      await loadReceiptFonts();
      const logo = receipt.logo ? await loadImage(receipt.logo).catch(() => null) : null;
      const composed = composeReceipt({
        width: printer.dots,
        frame,
        photos: frame.slots.map((aspect, i) => samplePhoto(aspect, i * 2.1)),
        texts: receipt,
        quote: receipt.quotes.find((q) => q.trim()) ?? '',
        when: new Date(),
        sessionNo: 12,
        logo,
      });
      if (!cancelled) setPreview(receiptToBits(composed, printer.raster));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [receipt, frame, printer.dots, printer.raster]);

  return (
    <div class="admin-grid">
      <section class="panel">
        <h2>Teks struk</h2>
        <p class="hint">Khusus tablet ini. Logo dan frame diatur di dashboard pemilik.</p>
        <TextField label="Judul" value={receipt.title} onChange={(v) => edit((s) => void (s.receipt.title = v))} />
        <TextField label="Sub-judul" value={receipt.subtitle} onChange={(v) => edit((s) => void (s.receipt.subtitle = v))} />
        <TextField label="Kalimat penutup" value={receipt.closing} onChange={(v) => edit((s) => void (s.receipt.closing = v))} />
        <TextField label="Media sosial" value={receipt.social} placeholder="@hellosnaply" onChange={(v) => edit((s) => void (s.receipt.social = v))} />
        <Check label="Tampilkan tanggal dan nomor sesi" checked={receipt.showMeta} onChange={(v) => edit((s) => void (s.receipt.showMeta = v))} />
        <Check label="Tampilkan barcode hiasan" checked={receipt.barcode} onChange={(v) => edit((s) => void (s.receipt.barcode = v))} />
      </section>

      <section class="panel">
        <h2>Kutipan dan kode QR</h2>
        <TextField label="Judul kutipan" value={receipt.quoteTitle} onChange={(v) => edit((s) => void (s.receipt.quoteTitle = v))} />
        <AreaField
          label="Kutipan (satu per baris, dipilih acak)"
          value={receipt.quotes.join('\n')}
          onChange={(v) => edit((s) => void (s.receipt.quotes = v.split('\n')))}
        />
        <TextField
          label="Tautan kode QR"
          value={receipt.qrUrl}
          placeholder="https://instagram.com/…"
          hint="Kosongkan kalau tidak ingin kode QR."
          onChange={(v) => edit((s) => void (s.receipt.qrUrl = v))}
        />
        <TextField label="Tulisan di bawah kode QR" value={receipt.qrCaption} onChange={(v) => edit((s) => void (s.receipt.qrCaption = v))} />
      </section>

      <section class="panel">
        <h2>Pratinjau struk</h2>
        <p class="hint">Contoh frame {frame.name} dengan foto uji, persis titik-titik yang dikirim ke printer.</p>
        <div class="preview-box">
          <ReceiptPaper bits={preview} />
        </div>
      </section>
    </div>
  );
}
