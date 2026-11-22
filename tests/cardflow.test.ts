import { describe, expect, it } from 'vitest';
import { flowColumns, flowLayout, type FlowCard } from '../src/ui/CardFlow';

const card = (height: number, wide = false): FlowCard => ({ height, wide });
/** Rows are 4 pixels; with a gap of 20 a card of height h takes ceil((h + 20) / 4) rows. */
const GAP = 20;
const end = (place: { row: number; rows: number }) => place.row + place.rows;

describe('cards of unequal height', () => {
  it('puts each card under the shortest column and ends every column on one line', () => {
    // The dashboard's settings page: Outlet, Cara bayar, Unduh foto, Akun pemilik, then the full-width Harga.
    const places = flowLayout([card(556), card(408), card(544), card(272), card(800, true)], 2, GAP);
    expect(places.map((place) => place.column)).toEqual([0, 1, 1, 0, 0]);
    // No hole under the short left column: its last card is drawn out to where the right column ends.
    expect(end(places[3])).toBe(end(places[2]));
    expect(places[3].rows).toBeGreaterThan(Math.ceil((272 + GAP) / 4));
    // The full-width card starts right below both columns.
    expect(places[4]).toMatchObject({ of: 1, row: end(places[2]) });
  });

  it('never overlaps two cards and never leaves a row empty between them', () => {
    const heights = [310, 120, 150, 260, 190, 90, 400, 75];
    for (const columns of [2, 3, 4]) {
      const places = flowLayout(heights.map((h) => card(h)), columns, GAP);
      for (let c = 0; c < columns; c++) {
        const column = places.filter((place) => place.column === c).sort((a, b) => a.row - b.row);
        expect(column.length).toBeGreaterThan(0);
        expect(column[0].row).toBe(0);
        for (let i = 1; i < column.length; i++) expect(column[i].row).toBe(end(column[i - 1]));
      }
      const bottoms = new Set(Array.from({ length: columns }, (_, c) => Math.max(...places.filter((place) => place.column === c).map(end))));
      expect(bottoms.size).toBe(1);
    }
  });

  it('gives every card at least the room it needs', () => {
    const cards = [card(100), card(333), card(41), card(250, true), card(77)];
    flowLayout(cards, 3, GAP).forEach((place, index) => expect(place.rows * 4).toBeGreaterThanOrEqual(cards[index].height + GAP));
  });

  it('spreads cards too few to fill the columns over the full width', () => {
    // One card beside nothing would leave two columns empty; it takes the full width instead.
    expect(flowColumns([card(325), card(297, true)], 3)).toEqual([1, 1]);
    expect(flowColumns([card(100), card(100)], 3)).toEqual([2, 2]);
    expect(flowColumns([card(1), card(1), card(1), card(1, true), card(1)], 3)).toEqual([3, 3, 3, 1, 1]);
    const places = flowLayout([card(325), card(297, true)], 3, GAP);
    expect(places[0]).toMatchObject({ column: 0, of: 1, row: 0 });
    expect(places[1].row).toBe(end(places[0]));
  });

  it('makes two cards alone the same height', () => {
    const [left, right] = flowLayout([card(432), card(260)], 2, GAP);
    expect([left.column, right.column]).toEqual([0, 1]);
    expect(right.rows).toBe(left.rows);
  });
});
