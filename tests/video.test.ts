import { describe, expect, it } from 'vitest';
import { includesVideos } from '../src/lib/settings';
import { boomerangOrder, boomerangSize, BOOMERANG } from '../src/lib/video/boomerang';
import { writeMp4, type Mp4Sample } from '../src/lib/video/mp4';
import { slidePlan, slidesAt, SLIDESHOW } from '../src/lib/video/slideshow';

interface Box {
  type: string;
  start: number;
  size: number;
  children: Box[];
}

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf']);

/** Reads the box tree of an MP4 file, as a player would. */
function boxes(bytes: Uint8Array, from = 0, to = bytes.length): Box[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found: Box[] = [];
  let at = from;
  while (at < to) {
    const size = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    expect(size).toBeGreaterThanOrEqual(8);
    expect(at + size).toBeLessThanOrEqual(to);
    found.push({ type, start: at, size, children: CONTAINERS.has(type) ? boxes(bytes, at + 8, at + size) : [] });
    at += size;
  }
  expect(at).toBe(to);
  return found;
}

function find(tree: Box[], path: string[]): Box {
  let level = tree;
  let box: Box | undefined;
  for (const type of path) {
    box = level.find((b) => b.type === type);
    if (!box) throw new Error(`no ${type}`);
    level = box.children;
  }
  return box!;
}

const sample = (size: number, key: boolean, fill: number): Mp4Sample => ({ data: new Uint8Array(size).fill(fill), duration: 3600, key });

describe('the MP4 writer', () => {
  const avcC = new Uint8Array([1, 0x42, 0xe0, 0x1f, 0xff, 0xe1, 0, 4, 0x67, 0x42, 0xe0, 0x1f, 1, 0, 4, 0x68, 0xce, 0x3c, 0x80]);
  const samples = [sample(500, true, 1), sample(120, false, 2), sample(80, false, 3), sample(300, true, 4)];
  const file = writeMp4({ width: 720, height: 1280, timescale: 90_000, avcC, samples });
  const view = new DataView(file.buffer);
  const tree = boxes(file);

  it('lays out the boxes players expect, with the index before the pictures', () => {
    expect(tree.map((b) => b.type)).toEqual(['ftyp', 'moov', 'mdat']);
    expect(find(tree, ['moov', 'trak', 'mdia', 'minf', 'stbl']).children.map((b) => b.type)).toEqual(['stsd', 'stts', 'stss', 'stsc', 'stsz', 'stco']);
    expect(String.fromCharCode(...file.subarray(8, 12))).toBe('isom');
  });

  it('points at every picture exactly where it was written', () => {
    const stco = find(tree, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stco']);
    const offset = view.getUint32(stco.start + 16);
    expect(offset).toBe(find(tree, ['mdat']).start + 8);
    const stsz = find(tree, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsz']);
    expect(view.getUint32(stsz.start + 16)).toBe(4);
    const sizes = [0, 1, 2, 3].map((i) => view.getUint32(stsz.start + 20 + i * 4));
    expect(sizes).toEqual([500, 120, 80, 300]);
    let at = offset;
    sizes.forEach((_, i) => {
      expect(file[at]).toBe(i + 1);
      expect(file[at + sizes[i] - 1]).toBe(i + 1);
      at += sizes[i];
    });
    expect(at).toBe(file.length);
  });

  it('states the size, duration and keyframes', () => {
    const tkhd = find(tree, ['moov', 'trak', 'tkhd']);
    expect(view.getUint32(tkhd.start + tkhd.size - 8)).toBe(720 * 0x10000);
    expect(view.getUint32(tkhd.start + tkhd.size - 4)).toBe(1280 * 0x10000);
    const mvhd = find(tree, ['moov', 'mvhd']);
    // 4 frames of 1/25 s = 160 ms.
    expect(view.getUint32(mvhd.start + 24)).toBe(160);
    const mdhd = find(tree, ['moov', 'trak', 'mdia', 'mdhd']);
    expect(view.getUint32(mdhd.start + 20)).toBe(90_000);
    expect(view.getUint32(mdhd.start + 24)).toBe(4 * 3600);
    const stts = find(tree, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stts']);
    expect([view.getUint32(stts.start + 12), view.getUint32(stts.start + 16), view.getUint32(stts.start + 20)]).toEqual([1, 4, 3600]);
    const stss = find(tree, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stss']);
    expect([view.getUint32(stss.start + 12), view.getUint32(stss.start + 16), view.getUint32(stss.start + 20)]).toEqual([2, 1, 4]);
  });

  it('carries the encoder configuration unchanged', () => {
    const avcCAt = new TextDecoder('latin1').decode(file).indexOf('avcC');
    expect(avcCAt).toBeGreaterThan(find(tree, ['moov']).start);
    expect(Array.from(file.subarray(avcCAt + 4, avcCAt + 4 + avcC.length))).toEqual(Array.from(avcC));
    expect(view.getUint32(avcCAt - 4)).toBe(8 + avcC.length);
  });

  it('refuses a video without pictures or one that does not start on a keyframe', () => {
    expect(() => writeMp4({ width: 16, height: 16, timescale: 90_000, avcC, samples: [] })).toThrow();
    expect(() => writeMp4({ width: 16, height: 16, timescale: 90_000, avcC, samples: [sample(10, false, 1)] })).toThrow();
  });
});

describe('the boomerang', () => {
  it('plays forwards then back without showing either end twice in a row, so it loops smoothly', () => {
    expect(boomerangOrder(4, 1)).toEqual([0, 1, 2, 3, 2, 1]);
    expect(boomerangOrder(4, 2)).toEqual([0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1]);
    const order = boomerangOrder(BOOMERANG.frames, BOOMERANG.loops);
    order.forEach((n, i) => i > 0 && expect(n).not.toBe(order[i - 1]));
    // About 4.5 seconds.
    expect(order.length / BOOMERANG.fps).toBeGreaterThan(4);
    expect(order.length / BOOMERANG.fps).toBeLessThan(5);
  });

  it('copes with a burst of a single picture', () => {
    expect(boomerangOrder(1, 3)).toEqual([0, 0, 0]);
  });

  it('keeps the camera shape in whole blocks, upright or sideways', () => {
    expect(boomerangSize(1920, 1440)).toEqual({ width: 960, height: 720 });
    expect(boomerangSize(1440, 1920)).toEqual({ width: 720, height: 960 });
    const wide = boomerangSize(1280, 720);
    expect(wide.width % 16 + (wide.height % 16)).toBe(0);
    expect(wide.width / wide.height).toBeCloseTo(16 / 9, 1);
  });
});

describe('the slideshow', () => {
  it('shows each photo in turn, then the receipt, crossfading between them', () => {
    const plan = slidePlan(3, true);
    expect(plan.durations).toEqual([SLIDESHOW.hold, SLIDESHOW.hold, SLIDESHOW.hold, SLIDESHOW.receipt]);
    expect(plan.total).toBeCloseTo(3 * SLIDESHOW.hold + SLIDESHOW.receipt - 3 * SLIDESHOW.fade);
    expect(slidesAt(plan, 0)).toEqual([{ item: 0, progress: 0, alpha: 1 }]);
    // Halfway through the first fade both photos show, half each.
    const mid = slidesAt(plan, plan.starts[1] + SLIDESHOW.fade / 2);
    expect(mid.map((s) => s.item)).toEqual([0, 1]);
    mid.forEach((s) => expect(s.alpha).toBeCloseTo(0.5));
    // The receipt stays to the very end.
    expect(slidesAt(plan, plan.total - 0.01).map((s) => s.item)).toEqual([3]);
  });

  it('gives one or two photos more time each', () => {
    expect(slidePlan(1, true).durations[0]).toBe(SLIDESHOW.holdFew);
    expect(slidePlan(4, false).durations).toEqual([SLIDESHOW.hold, SLIDESHOW.hold, SLIDESHOW.hold, SLIDESHOW.hold]);
  });

  it('never shows nothing', () => {
    const plan = slidePlan(4, true);
    for (let t = 0; t < plan.total; t += 1 / SLIDESHOW.fps) {
      const visible = slidesAt(plan, t);
      expect(visible.length).toBeGreaterThan(0);
      expect(visible.reduce((sum, s) => sum + s.alpha, 0)).toBeCloseTo(1);
    }
  });
});

describe('prices', () => {
  it('include the videos unless the franchise unticked them, also prices saved before videos existed', () => {
    const base = { id: 'a', name: 'Sesi', description: '', price: 15000, prints: 1, active: true };
    expect(includesVideos(base)).toBe(true);
    expect(includesVideos({ ...base, videos: true })).toBe(true);
    expect(includesVideos({ ...base, videos: false })).toBe(false);
  });
});
