import { useEffect, useState } from 'preact/hooks';
import { pairingStore } from '../lib/cloud/device';
import { boothTitle } from '../lib/cloud/shared';
import { samplePhoto } from '../lib/demoScene';
import type { BitImage } from '../lib/image/types';
import { drawNewspaper, loadNewsFonts } from '../lib/newspaper';
import { composeReceipt, loadImage, loadReceiptFonts, receiptToBits } from '../lib/receipt/compose';
import { activeFrames } from '../lib/receipt/frames';
import { useSettings } from '../lib/settings';
import { useStore } from '../lib/store';
import { ReceiptPaper } from '../ui/components';
import { edit } from './actions';
import { AreaField, Check, TextField } from './fields';
import { CardFlow } from '../ui/CardFlow';

/** Longer than this and the headline gets too small to look like one. */
const NEWS_HEADLINE_MAX = 24;

/** The newspaper page with sample photos, redrawn shortly after the headline changes. */
function NewsPreview({ headline, title, footer }: { headline: string; title: string; footer: string }) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      await loadNewsFonts();
      const page = drawNewspaper({
        headline: headline.trim() || title,
        brand: title,
        when: new Date(),
        sessionNo: 12,
        photos: [0, 1, 2].map((i) => samplePhoto(4 / 3, 0.4 + i * 1.9, 1280)),
        footer,
      });
      if (!cancelled) setUrl(page.toDataURL('image/jpeg', 0.8));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [headline, title, footer]);

  return <div class="preview-box">{url ? <img class="news-preview" src={url} alt="Contoh halaman koran dengan foto uji" /> : <div class="spinner" />}</div>;
}

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
  const pairing = useStore(pairingStore);
  // The booth's name as the newspaper's masthead shows it.
  const title = boothTitle(settings, pairing ? (pairing.franchise ?? '') : null);

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
        platformLine: settings.platform.receiptLine,
      });
      if (!cancelled) setPreview(receiptToBits(composed, printer.raster));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [receipt, frame, printer.dots, printer.raster, settings.platform.receiptLine]);

  return (
    <CardFlow>
      <section class="panel">
        <h2>Teks struk</h2>
        <p class="hint">Khusus tablet ini. Logo dan frame diatur di dashboard franchise.</p>
        <TextField label="Judul" value={receipt.title} onChange={(v) => edit((s) => void (s.receipt.title = v))} />
        <TextField label="Sub-judul" value={receipt.subtitle} onChange={(v) => edit((s) => void (s.receipt.subtitle = v))} />
        <TextField label="Kalimat penutup" value={receipt.closing} onChange={(v) => edit((s) => void (s.receipt.closing = v))} />
        <TextField label="Media sosial" value={receipt.social} placeholder="@namabooth" onChange={(v) => edit((s) => void (s.receipt.social = v))} />
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
        <h2>Koran</h2>
        <p class="hint">
          Di halaman unduh, tamu juga mendapat fotonya sebagai halaman depan koran. Desain dan beritanya tetap; yang diatur di sini hanya
          judul besarnya.
        </p>
        <Check label="Buat versi koran" checked={settings.news.enabled} onChange={(v) => edit((s) => void (s.news.enabled = v))} />
        <TextField
          label="Judul besar (nama lokasi)"
          hint={`Misalnya nama kota atau tempat booth ini berdiri, paling banyak ${NEWS_HEADLINE_MAX} huruf. Kalau kosong, nama booth yang dipakai.`}
          value={settings.news.headline}
          placeholder="CIBINONG"
          onChange={(v) => edit((s) => void (s.news.headline = v.trim().slice(0, NEWS_HEADLINE_MAX)))}
        />
        {settings.news.enabled && <NewsPreview headline={settings.news.headline} footer={settings.platform.receiptLine} title={title} />}
      </section>

      <section class="panel">
        <h2>Pratinjau struk</h2>
        <p class="hint">
          Contoh frame {frame.name} dengan foto uji, persis titik-titik yang dikirim ke printer.
          {settings.platform.receiptLine.trim() ? ` Baris paling bawah (${settings.platform.receiptLine.trim()}) berasal dari platform.` : ''}
        </p>
        <div class="preview-box">
          <ReceiptPaper bits={preview} />
        </div>
      </section>
    </CardFlow>
  );
}
