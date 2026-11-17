import qrcode from 'qrcode-generator';

export interface QrShape {
  /** Modules per side, including the quiet zone. */
  size: number;
  /** SVG path data that draws every dark module as a 1×1 square. */
  path: string;
}

/** Quiet modules around the code; scanners need this light border to find it. */
const QUIET = 4;

/**
 * The dark squares of a QR code for the given text, as one SVG path. Drawn as
 * vectors so it stays sharp at any size on the tablet. Returns null when the
 * text does not fit in a QR code.
 */
export function qrShape(text: string): QrShape | null {
  let code;
  try {
    code = qrcode(0, 'M');
    code.addData(text);
    code.make();
  } catch {
    return null;
  }
  const modules = code.getModuleCount();
  let path = '';
  for (let row = 0; row < modules; row++) {
    for (let column = 0; column < modules; column++) {
      if (code.isDark(row, column)) path += `M${column + QUIET} ${row + QUIET}h1v1h-1z`;
    }
  }
  return { size: modules + QUIET * 2, path };
}
