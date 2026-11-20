/**
 * A minimal MP4 writer for one H.264 video track, enough for the booth's short
 * clips: every encoded frame goes into a single chunk, and the index (moov) is
 * written before the data, so phones start playing before the download ends.
 */

export interface Mp4Sample {
  /** One encoded frame in "avc" form: NAL units, each prefixed by its 4-byte length. */
  data: Uint8Array;
  /** How long the frame shows, in `timescale` units. */
  duration: number;
  /** A frame that decodes on its own (IDR); players can start or seek here. */
  key: boolean;
}

export interface Mp4Track {
  width: number;
  height: number;
  /** Units per second of the sample durations. */
  timescale: number;
  /** The encoder's AVCDecoderConfigurationRecord (the "description" WebCodecs reports). */
  avcC: Uint8Array;
  samples: Mp4Sample[];
}

/** Units per second of the movie header; only the total duration is stated in it. */
const MOVIE_TIMESCALE = 1000;

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

/** Builds a byte array from numbers of fixed widths, written big-endian. */
class Bytes {
  private parts: number[] = [];
  u8(value: number) {
    this.parts.push(value & 0xff);
    return this;
  }
  u16(value: number) {
    return this.u8(value >>> 8).u8(value);
  }
  u32(value: number) {
    return this.u16(value >>> 16).u16(value);
  }
  raw(values: ArrayLike<number>) {
    for (let i = 0; i < values.length; i++) this.parts.push(values[i] & 0xff);
    return this;
  }
  zeros(count: number) {
    for (let i = 0; i < count; i++) this.parts.push(0);
    return this;
  }
  get length() {
    return this.parts.length;
  }
  toArray(): number[] {
    return this.parts;
  }
}

function box(type: string, ...content: (number[] | Bytes)[]): number[] {
  const body = content.flatMap((part) => (part instanceof Bytes ? part.toArray() : part));
  return new Bytes()
    .u32(8 + body.length)
    .raw(ascii(type))
    .raw(body)
    .toArray();
}

/** A box whose content starts with a version byte and three flag bytes. */
function fullBox(type: string, version: number, flags: number, ...content: (number[] | Bytes)[]): number[] {
  return box(type, new Bytes().u8(version).u8(flags >>> 16).u8(flags >>> 8).u8(flags), ...content);
}

/** The identity transformation, as every header that carries one expects. */
const MATRIX = new Bytes().u32(0x00010000).u32(0).u32(0).u32(0).u32(0x00010000).u32(0).u32(0).u32(0).u32(0x40000000);

/** Equal durations in a row are stored once, with their count. */
function timeToSample(samples: Mp4Sample[]): [count: number, duration: number][] {
  const runs: [number, number][] = [];
  for (const sample of samples) {
    const last = runs[runs.length - 1];
    if (last && last[1] === sample.duration) last[0]++;
    else runs.push([1, sample.duration]);
  }
  return runs;
}

function moov(track: Mp4Track, dataOffset: number): number[] {
  const { width, height, timescale, samples } = track;
  const mediaDuration = samples.reduce((sum, s) => sum + s.duration, 0);
  const movieDuration = Math.round((mediaDuration * MOVIE_TIMESCALE) / timescale);

  const mvhd = fullBox(
    'mvhd',
    0,
    0,
    new Bytes()
      .u32(0)
      .u32(0)
      .u32(MOVIE_TIMESCALE)
      .u32(movieDuration)
      .u32(0x00010000) // rate 1.0
      .u16(0x0100) // volume 1.0
      .zeros(10),
    MATRIX,
    new Bytes().zeros(24).u32(2), // next track id
  );

  const tkhd = fullBox(
    'tkhd',
    0,
    0x3, // enabled, in movie
    new Bytes()
      .u32(0)
      .u32(0)
      .u32(1) // track id
      .u32(0)
      .u32(movieDuration)
      .zeros(8)
      .u16(0) // layer
      .u16(0) // alternate group
      .u16(0) // volume: none for video
      .u16(0),
    MATRIX,
    new Bytes().u32(width * 0x10000).u32(height * 0x10000),
  );

  const mdhd = fullBox('mdhd', 0, 0, new Bytes().u32(0).u32(0).u32(timescale).u32(mediaDuration).u16(0x55c4 /* und */).u16(0));
  const hdlr = fullBox('hdlr', 0, 0, new Bytes().u32(0).raw(ascii('vide')).zeros(12).raw(ascii('VideoHandler')).u8(0));
  const vmhd = fullBox('vmhd', 0, 1, new Bytes().zeros(8));
  const dinf = box('dinf', fullBox('dref', 0, 0, new Bytes().u32(1), fullBox('url ', 0, 1)));

  const compressor = new Bytes().zeros(32);
  const avc1 = box(
    'avc1',
    new Bytes()
      .zeros(6)
      .u16(1) // data reference index
      .zeros(16)
      .u16(width)
      .u16(height)
      .u32(0x00480000) // 72 dpi
      .u32(0x00480000)
      .u32(0)
      .u16(1), // frames per sample
    compressor,
    new Bytes().u16(0x18).u16(0xffff),
    box('avcC', Array.from(track.avcC)),
  );
  const stsd = fullBox('stsd', 0, 0, new Bytes().u32(1), avc1);

  const runs = timeToSample(samples);
  const stts = fullBox('stts', 0, 0, new Bytes().u32(runs.length), runs.flatMap(([count, duration]) => new Bytes().u32(count).u32(duration).toArray()));
  const keys = samples.flatMap((sample, i) => (sample.key ? [i + 1] : []));
  const stss = fullBox('stss', 0, 0, new Bytes().u32(keys.length), keys.flatMap((n) => new Bytes().u32(n).toArray()));
  const stsc = fullBox('stsc', 0, 0, new Bytes().u32(1).u32(1).u32(samples.length).u32(1));
  const stsz = fullBox('stsz', 0, 0, new Bytes().u32(0).u32(samples.length), samples.flatMap((s) => new Bytes().u32(s.data.byteLength).toArray()));
  const stco = fullBox('stco', 0, 0, new Bytes().u32(1).u32(dataOffset));
  const stbl = box('stbl', stsd, stts, stss, stsc, stsz, stco);

  return box('moov', mvhd, box('trak', tkhd, box('mdia', mdhd, hdlr, box('minf', vmhd, dinf, stbl))));
}

/** The complete file. */
export function writeMp4(track: Mp4Track): Uint8Array<ArrayBuffer> {
  if (track.samples.length === 0) throw new Error('Video tanpa gambar.');
  if (!track.samples[0].key) throw new Error('Gambar pertama video harus keyframe.');
  const ftyp = box('ftyp', ascii('isom'), new Bytes().u32(0x200), ascii('isomiso2avc1mp41'));
  // The index states where the frames start, which depends on the index's own size; that size does not.
  const headerSize = ftyp.length + moov(track, 0).length + 8;
  const index = moov(track, headerSize);
  const dataSize = track.samples.reduce((sum, s) => sum + s.data.byteLength, 0);

  const out = new Uint8Array(new ArrayBuffer(headerSize + dataSize));
  out.set(ftyp, 0);
  out.set(index, ftyp.length);
  const mdat = ftyp.length + index.length;
  new DataView(out.buffer).setUint32(mdat, 8 + dataSize);
  out.set(ascii('mdat'), mdat + 4);
  let at = headerSize;
  for (const sample of track.samples) {
    out.set(sample.data, at);
    at += sample.data.byteLength;
  }
  return out;
}
