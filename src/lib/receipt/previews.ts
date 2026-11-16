import { useEffect, useState } from 'preact/hooks';
import { samplePhoto } from '../demoScene';
import type { Settings } from '../settings';
import { composeReceipt, loadReceiptFonts, paintBits, receiptToBits } from './compose';
import type { FrameDef } from './frames';

/** Finished pictures by frame and by the settings that change how they look. */
const cache = new Map<string, string>();

function cacheKey(frame: FrameDef, settings: Settings): string {
  return [frame.id, settings.printer.dots, settings.receipt.title, JSON.stringify(settings.printer.raster)].join('|');
}

/** A small picture of a frame filled with sample photos, drawn with the same dots the printer would use. */
async function framePreview(frame: FrameDef, settings: Settings): Promise<string> {
  const key = cacheKey(frame, settings);
  const cached = cache.get(key);
  if (cached) return cached;

  await loadReceiptFonts();
  const composed = composeReceipt({
    width: settings.printer.dots,
    frame,
    photos: frame.slots.map((aspect, i) => samplePhoto(aspect, 0.4 + i * 1.9)),
    texts: settings.receipt,
    quote: '',
    when: new Date(),
    sessionNo: 1,
    logo: null,
    compact: true,
  });
  const canvas = document.createElement('canvas');
  paintBits(canvas, receiptToBits(composed, settings.printer.raster));
  const url = canvas.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

/** Picture URLs for the given frames, keyed by frame id. They arrive one at a time as each is drawn. */
export function useFramePreviews(frames: FrameDef[], settings: Settings): Record<string, string> {
  const ready = () => {
    const urls: Record<string, string> = {};
    for (const frame of frames) {
      const cached = cache.get(cacheKey(frame, settings));
      if (cached) urls[frame.id] = cached;
    }
    return urls;
  };
  const [urls, setUrls] = useState(ready);
  const ids = frames.map((frame) => frame.id).join(',');

  useEffect(() => {
    let cancelled = false;
    setUrls(ready());
    void (async () => {
      for (const frame of frames) {
        const url = await framePreview(frame, settings);
        if (cancelled) return;
        setUrls((previous) => (previous[frame.id] === url ? previous : { ...previous, [frame.id]: url }));
        // Yield between frames so the screen stays responsive while they are drawn.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ids, settings.printer.dots, settings.receipt.title, settings.printer.raster]);

  return urls;
}
