import { describe, expect, it } from 'vitest';
import { fitSize, flowLines, newsStory, photoColumns } from '../src/lib/newspaper';

/** Every character as wide as the next: enough to check where lines break. */
const measure = (text: string) => text.length * 10;

describe('the newspaper page', () => {
  it('writes the place and the booth into the report, and nothing else changes', () => {
    const story = newsStory('Cibinong', 'Hello Snaply');
    expect(story[0].startsWith('CIBINONG — ')).toBe(true);
    expect(story.join(' ')).toContain('terekam di Cibinong');
    expect(story.join(' ')).toContain('Hello Snaply');
    // The same report for another place, word for word apart from the names.
    const other = newsStory('Depok', 'Foto Senja').map((p) => p.replaceAll('Depok', 'Cibinong').replaceAll('DEPOK', 'CIBINONG').replaceAll('Foto Senja', 'Hello Snaply'));
    expect(other).toEqual(story);
  });

  it('fills every column and ends on the "continued" note instead of stopping in mid-sentence', () => {
    const columns = flowLines(newsStory('Cibinong', 'Hello Snaply'), [6, 14, 6], 350, measure, 26);
    expect(columns.map((column) => column.length)).toEqual([6, 14, 6]);
    const last = columns[2][5];
    expect(last.note).toBe(true);
    expect(last.words.join(' ')).toBe('Bersambung ke hal. 7');
    // No line is wider than its column, and only the note is marked as one.
    for (const line of columns.flat()) {
      expect(measure(line.words.join(' ')) + line.indent).toBeLessThanOrEqual(350);
      if (line !== last) expect(line.note).toBeUndefined();
    }
  });

  it('starts the report flush left and indents the paragraphs after it', () => {
    const [column] = flowLines(['satu dua tiga empat', 'lima enam', 'tujuh'], [8], 100, measure, 20);
    expect(column.map((line) => [line.words.join(' '), line.indent, line.justify])).toEqual([
      ['satu dua', 0, true],
      ['tiga empat', 0, false],
      ['lima', 20, true],
      ['enam', 0, false],
      ['tujuh', 20, false],
      // The text ran out, so it starts over to fill the column.
      ['satu dua', 20, true],
      ['tiga empat', 0, false],
      ['Bersambung ke hal. 7', 0, false],
    ]);
  });

  it('copes with a column that has no room at all', () => {
    expect(flowLines(['a b c'], [0, 3], 100, measure, 10).map((column) => column.length)).toEqual([0, 3]);
    expect(flowLines(['a b c'], [0, 0], 100, measure, 10)).toEqual([[], []]);
    expect(flowLines([], [2], 100, measure, 10)[0].map((line) => line.note)).toEqual([true]);
  });

  it('makes the headline as large as fits, within its limits', () => {
    const widthAt = (letters: number) => (size: number) => letters * size * 0.5;
    // A short name stops at the largest size; a long one shrinks until it fits; a very long one stops at the smallest.
    expect(fitSize(widthAt(3), 1120, 250, 70)).toBe(250);
    const fitted = fitSize(widthAt(18), 1120, 250, 70);
    expect(fitted).toBeLessThan(250);
    expect(widthAt(18)(fitted)).toBeLessThanOrEqual(1120);
    expect(widthAt(18)(fitted + 2)).toBeGreaterThan(1120);
    expect(fitSize(widthAt(60), 1120, 250, 70)).toBe(70);
  });

  it('puts the small photos left to right as they were taken', () => {
    expect(photoColumns(0)).toEqual([]);
    expect(photoColumns(1)).toEqual([0]);
    // Two leave the middle column to the forecast box.
    expect(photoColumns(2)).toEqual([0, 2]);
    expect(photoColumns(3)).toEqual([0, 1, 2]);
    expect(photoColumns(5)).toEqual([0, 1, 2]);
  });
});
