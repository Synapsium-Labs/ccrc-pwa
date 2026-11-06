// Which list the Waiting page and an opened item draw before live data (console speed, Task C4; spec §2.6, Figure 8,
// D16): a pure decider over what this page has heard and what the device saved.
import { describe, expect, it } from 'vitest';
import { actsOpen, itemSource, listSource } from '../src/ledgers/savedCopy';
import { fleetSession } from './fleetFixture';
import { NOW, itemView, waitingView } from './ledgersFixture';

const heardList = waitingView({ items: [itemView({ id: 1, title: 'Live item' })] });
const savedList = waitingView({ items: [itemView({ id: 2, title: 'Saved item' })] });
const saved = { savedAt: NOW - 4 * 60_000, view: savedList };
const heardRows = [fleetSession({ id: 'sess-a' })];
const deviceRows = [fleetSession({ id: 'sess-b' })];

describe('listSource: what the Waiting page draws', () => {
  it('live when the list and the rows are both heard, whatever is saved', () => {
    expect(listSource({ view: heardList, sessions: heardRows }, saved, deviceRows))
      .toEqual({ kind: 'live', view: heardList, sessions: heardRows });
  });

  it('the list saved, with the rows heard', () => {
    expect(listSource({ view: null, sessions: heardRows }, saved, deviceRows))
      .toEqual({ kind: 'saved-list', view: savedList, sessions: heardRows, savedAt: saved.savedAt });
  });

  it('the list saved, with the device\'s rows when no rows are heard', () => {
    expect(listSource({ view: null, sessions: null }, saved, deviceRows))
      .toEqual({ kind: 'saved-list', view: savedList, sessions: deviceRows, savedAt: saved.savedAt });
  });

  it('the rows saved: the list heard, the rows not yet', () => {
    expect(listSource({ view: heardList, sessions: null }, saved, deviceRows))
      .toEqual({ kind: 'saved-rows', view: heardList, sessions: deviceRows });
  });

  // Review 1556 R1: with no fleet snapshot on the device (first visit, cleared data, private window, storage absent or
  // throwing) the store's rows are `[]`, which is not a saved copy of anything: the page draws what it drew before C4.
  it('no rows heard and none on the device: nothing to draw, even with a saved list', () => {
    expect(listSource({ view: null, sessions: null }, saved, [])).toEqual({ kind: 'none' });
  });

  it('the list heard, no rows heard and none on the device: nothing to draw', () => {
    expect(listSource({ view: heardList, sessions: null }, saved, [])).toEqual({ kind: 'none' });
    expect(listSource({ view: heardList, sessions: null }, null, [])).toEqual({ kind: 'none' });
  });

  it('nothing anywhere: no list heard and none saved', () => {
    expect(listSource({ view: null, sessions: heardRows }, null, deviceRows)).toEqual({ kind: 'none' });
    expect(listSource({ view: null, sessions: null }, null, [])).toEqual({ kind: 'none' });
  });
});

describe('itemSource: what an opened item reads', () => {
  it('live when the list is heard, whatever is saved', () => {
    expect(itemSource(heardList, saved)).toEqual({ kind: 'live', view: heardList });
  });

  it('saved when no list is heard and the device has one', () => {
    expect(itemSource(null, saved)).toEqual({ kind: 'saved', view: savedList, savedAt: saved.savedAt });
  });

  it('nothing when no list is heard and none saved', () => {
    expect(itemSource(null, null)).toEqual({ kind: 'none' });
  });
});

describe('actsOpen', () => {
  it('acts open for live only', () => {
    expect(actsOpen({ kind: 'live', view: heardList, sessions: heardRows })).toBe(true);
    expect(actsOpen({ kind: 'live', view: heardList })).toBe(true);
    expect(actsOpen({ kind: 'saved-list', view: savedList, sessions: deviceRows, savedAt: saved.savedAt })).toBe(false);
    expect(actsOpen({ kind: 'saved-rows', view: heardList, sessions: deviceRows })).toBe(false);
    expect(actsOpen({ kind: 'saved', view: savedList, savedAt: saved.savedAt })).toBe(false);
    expect(actsOpen({ kind: 'none' })).toBe(false);
  });
});
