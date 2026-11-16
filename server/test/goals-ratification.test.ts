// Overlord W1, portfolio B (plan `w1-portfolio.md` Task 4): what each goals version rests on (`ratifiedBy`), and the one
// decider that says whether that ratifies it (`goalRatification`), with `itemAnswered`, the parser and `ratificationOf`.
// Then the store: every writer records its source, `goalsFor` computes the verdicts at read time, and the operator's
// `ratifyGoalsVersion`. Question 1 (operator item 328, 2026-11-16): a coordinator's own pin counts, and only the pin (review
// 2240 F3). Fixture coord.db files only; neutral names (prog-a, prog-b, lane-a, phone-a).
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import * as ledgers from '../../shared/ledgers.js';
import type { RatifiedBy } from '../../shared/ledgers.js';
import { ALL_RATIFICATION_CASES } from './ratificationCases.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const NOW = 1_800_000_000_000;
const SPEC = 'docs/superpowers/specs/2026-11-01-x-design.md';
const COORD: RatifiedBy = { kind: 'coordinator' };
const ITEM: RatifiedBy = { kind: 'item' };
const OPERATOR: RatifiedBy = { kind: 'operator' };
/** The account gate's actor text, as `String(g.actor)` writes it: a device label and the session hash's first 8 hex. */
const ACTOR = 'phone-a 0123abcd';

// The deciders' cases live in `ratificationCases.ts`, so the mutation sets (`sim/ratificationSets.ts`) run the same ones.
describe('the parser, itemAnswered (one row per item state) and goalRatification', () => {
  for (const c of ALL_RATIFICATION_CASES) it(c.name, () => c.run(ledgers));
});

describe('the store: sources written, verdicts computed at read', () => {
  const mk = (): CoordStore => {
    const s = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-goals-ratify-'), '.ccrc', 'coord.db')));
    for (const slug of ['prog-a', 'prog-b']) {
      s.db.prepare("INSERT INTO programs (slug, title, createdAt, state) VALUES (?, ?, 1, 'active')").run(slug, slug.toUpperCase());
    }
    return s;
  };
  const raise = (s: CoordStore, program = 'prog-a'): number => s.raiseItem({
    program, runId: null, raisedBy: 'lane-a', kind: 'decide', title: 'Which list?', why: 'w', how: ['Pick'], options: ['a', 'b'],
    neededBy: 'soon', soonLabel: null, secretSlot: null, recommended: 0, recommendedWhy: 'a is smaller.',
  }, NOW);
  const cols = (s: CoordStore, sql: string, ...args: (string | number)[]): unknown => s.db.prepare(sql).get(...args);

  it('a pin records its source and time, and a list it writes names the pin; (question 1) a coordinator pin reads ratified', () => {
    const s = mk();
    s.setSpecPin('prog-a', SPEC, 'What it builds.', NOW, ['It ships.'], COORD);
    expect(cols(s, 'SELECT ratifiedBy, ratifiedAt, doneWhenBy FROM programs WHERE slug = ?', 'prog-a'))
      .toEqual({ ratifiedBy: 'coordinator', ratifiedAt: NOW, doneWhenBy: 'pin' });
    const g = s.goalsFor('prog-a');
    expect(g.pinRatification).toEqual({ ratified: true, source: COORD });
    expect(g.doneWhenRatification).toEqual(g.pinRatification);
  });

  it('(question 1) a re-pin after an operator ratification reads the re-pin\'s own source: ratified again, by the coordinator', () => {
    const s = mk();
    s.setSpecPin('prog-a', SPEC, 'First.', NOW, null, COORD);
    s.db.prepare("UPDATE programs SET ratifiedBy = NULL WHERE slug = 'prog-a'").run();
    expect(s.ratifyGoalsVersion('prog-a', { pin: { inShortAt: NOW } }, NOW + 1, ACTOR)).toEqual({ ok: true, changed: true });
    expect(s.goalsFor('prog-a').pinRatification).toEqual({ ratified: true, source: OPERATOR });
    s.setSpecPin('prog-a', SPEC, 'Second.', NOW + 2, null, COORD);
    expect(s.goalsFor('prog-a').pinRatification).toEqual({ ratified: true, source: COORD });
  });

  it('a re-pin over an operator-ratified text is never carried by the older act: the row holds the re-pin\'s source, and no actor', () => {
    const s = mk();
    s.setSpecPin('prog-a', SPEC, 'First.', NOW, null, ITEM);
    expect(s.ratifyGoalsVersion('prog-a', { pin: { inShortAt: NOW } }, NOW + 1, ACTOR)).toEqual({ ok: true, changed: true });
    s.setSpecPin('prog-a', SPEC, 'Second.', NOW + 2, null, ITEM);
    expect(cols(s, 'SELECT ratifiedBy, ratifiedAt, ratifiedActor FROM programs WHERE slug = ?', 'prog-a'))
      .toEqual({ ratifiedBy: 'item', ratifiedAt: NOW + 2, ratifiedActor: null });
    expect(s.goalsFor('prog-a').pinRatification).toMatchObject({ ratified: false });
  });

  it('a modification records its source; one that carries a list moves the definition of done\'s verdict to that row\'s', () => {
    const s = mk();
    s.setSpecPin('prog-a', SPEC, 'What it builds.', NOW, ['It ships.'], COORD);
    const item = raise(s);
    const mod = s.addModification('prog-a', { text: 'New list.', ruling: null, itemId: item, pr: null, doneWhen: ['It ships twice.'] }, NOW + 1);
    expect(cols(s, 'SELECT ratifiedBy, ratifiedAt FROM programme_modifications WHERE id = ?', mod)).toEqual({ ratifiedBy: 'item', ratifiedAt: NOW + 1 });
    expect(cols(s, 'SELECT doneWhenBy FROM programs WHERE slug = ?', 'prog-a')).toEqual({ doneWhenBy: `mod:${mod}` });
    const g = s.goalsFor('prog-a');
    expect(g.modifications[0]!.ratification).toEqual({ ratified: false, why: 'item-not-answered', source: ITEM });
    expect(g.doneWhenRatification).toEqual(g.modifications[0]!.ratification);
    s.tickWithMail(item, 'a', NOW + 2, () => null);
    expect(s.goalsFor('prog-a').doneWhenRatification).toEqual({ ratified: false, why: 'effect-unmeasured', source: ITEM });
  });

  it('a modification citing a returned item reads item-not-answered; one whose item is gone reads unreadable', () => {
    const s = mk();
    const item = raise(s);
    s.tickWithMail(item, 'a', NOW + 1, () => null);
    expect(s.moveItem(item, 'return', 'coordinator', {}, NOW + 2, { programmeHasOpenRun: false })).toMatchObject({ ok: true });
    const mod = s.addModification('prog-a', { text: 'x', ruling: null, itemId: item, pr: null }, NOW + 3);
    expect(s.goalsFor('prog-a').modifications[0]!.ratification).toMatchObject({ why: 'item-not-answered' });
    s.db.prepare('UPDATE programme_modifications SET itemId = ? WHERE id = ?').run(item + 99, mod);
    expect(s.goalsFor('prog-a').modifications[0]!.ratification).toMatchObject({ why: 'unreadable' });
  });

  it('rows from before the migration read unrecorded, and unreadable text reads unreadable: nothing is back-filled or guessed', () => {
    const s = mk();
    s.db.prepare("UPDATE programs SET specPath = ?, inShort = 'Old.', inShortAt = ?, doneWhen = '[\"x\"]' WHERE slug = 'prog-a'").run(SPEC, NOW);
    s.db.prepare("INSERT INTO programme_modifications (program, at, text) VALUES ('prog-a', ?, 'Old change.')").run(NOW);
    const g = s.goalsFor('prog-a');
    expect(g.pinRatification).toEqual({ ratified: false, why: 'unrecorded', source: null });
    expect(g.doneWhenRatification).toEqual({ ratified: false, why: 'unrecorded', source: null });
    expect(g.modifications[0]!.ratification).toEqual({ ratified: false, why: 'unrecorded', source: null });
    s.db.prepare("UPDATE programs SET ratifiedBy = 'request', ratifiedAt = ?, doneWhenBy = 'mod:x' WHERE slug = 'prog-a'").run(NOW);
    const h = s.goalsFor('prog-a');
    expect(h.pinRatification).toEqual({ ratified: false, why: 'unreadable', source: null });
    expect(h.doneWhenRatification).toEqual({ ratified: false, why: 'unreadable', source: null });
  });

  it('ratifyGoalsVersion: a stale stamp is refused with the stored one and writes nothing; a second call changes nothing', () => {
    const s = mk();
    s.setSpecPin('prog-a', SPEC, 'What it builds.', NOW, null, ITEM);
    expect(s.ratifyGoalsVersion('prog-a', { pin: { inShortAt: NOW - 1 } }, NOW + 1, ACTOR)).toEqual({ ok: false, why: 'stale', inShortAt: NOW });
    expect(cols(s, 'SELECT ratifiedBy, ratifiedActor FROM programs WHERE slug = ?', 'prog-a')).toEqual({ ratifiedBy: 'item', ratifiedActor: null });
    expect(s.ratifyGoalsVersion('prog-a', { pin: { inShortAt: NOW } }, NOW + 1, ACTOR)).toEqual({ ok: true, changed: true });
    expect(cols(s, 'SELECT ratifiedBy, ratifiedAt, ratifiedActor FROM programs WHERE slug = ?', 'prog-a'))
      .toEqual({ ratifiedBy: 'operator', ratifiedAt: NOW + 1, ratifiedActor: ACTOR });
    expect(s.ratifyGoalsVersion('prog-a', { pin: { inShortAt: NOW } }, NOW + 2, 'phone-b 89abcdef')).toEqual({ ok: true, changed: false });
    expect(cols(s, 'SELECT ratifiedAt FROM programs WHERE slug = ?', 'prog-a')).toEqual({ ratifiedAt: NOW + 1 });
  });

  it('ratifyGoalsVersion: no pin, or another programme\'s modification, is unknown', () => {
    const s = mk();
    expect(s.ratifyGoalsVersion('prog-a', { pin: { inShortAt: NOW } }, NOW, ACTOR)).toEqual({ ok: false, why: 'unknown' });
    expect(s.ratifyGoalsVersion('prog-z', { pin: { inShortAt: NOW } }, NOW, ACTOR)).toEqual({ ok: false, why: 'unknown' });
    const other = s.addModification('prog-b', { text: 'theirs', ruling: null, itemId: null, pr: null }, NOW);
    expect(s.ratifyGoalsVersion('prog-a', { modification: other }, NOW, ACTOR)).toEqual({ ok: false, why: 'unknown' });
    expect(s.ratifyGoalsVersion('prog-b', { modification: other }, NOW, ACTOR)).toEqual({ ok: true, changed: true });
  });

  it('(question 1) ratifying a coordinator pin, which already reads ratified, changes nothing: the no-op asks the verdict', () => {
    const s = mk();
    s.setSpecPin('prog-a', SPEC, 'What it builds.', NOW, null, COORD);
    expect(s.ratifyGoalsVersion('prog-a', { pin: { inShortAt: NOW } }, NOW + 1, ACTOR)).toEqual({ ok: true, changed: false });
    expect(cols(s, 'SELECT ratifiedBy, ratifiedAt, ratifiedActor FROM programs WHERE slug = ?', 'prog-a'))
      .toEqual({ ratifiedBy: 'coordinator', ratifiedAt: NOW, ratifiedActor: null });
  });

  it('ratifyGoalsVersion\'s no-op asks the VERDICT, never the source: a modification whose item source reads unratified is ratified', () => {
    const s = mk();
    const item = raise(s);
    s.tickWithMail(item, 'a', NOW + 1, () => null);
    const mod = s.addModification('prog-a', { text: 'x', ruling: null, itemId: item, pr: null }, NOW + 2);
    expect(s.ratifyGoalsVersion('prog-a', { modification: mod }, NOW + 3, ACTOR)).toEqual({ ok: true, changed: true });
    expect(s.goalsFor('prog-a').modifications[0]!.ratification).toEqual({ ratified: true, source: OPERATOR });
    expect(cols(s, 'SELECT ratifiedBy, ratifiedAt, ratifiedActor FROM programme_modifications WHERE id = ?', mod))
      .toEqual({ ratifiedBy: 'operator', ratifiedAt: NOW + 3, ratifiedActor: ACTOR });
  });

  it('(review 2240 F3) a coordinator\'s modification never ratifies: it records coordinator and reads source-does-not-ratify', () => {
    const s = mk();
    s.setSpecPin('prog-a', SPEC, 'What it builds.', NOW, ['It ships.'], COORD);
    const mod = s.addModification('prog-a', { text: 'New list.', ruling: 'The operator said so.', itemId: null, pr: null, doneWhen: ['It ships twice.'] }, NOW + 1);
    expect(cols(s, 'SELECT ratifiedBy FROM programme_modifications WHERE id = ?', mod)).toEqual({ ratifiedBy: 'coordinator' });
    const g = s.goalsFor('prog-a');
    expect(g.modifications[0]!.ratification).toEqual({ ratified: false, why: 'source-does-not-ratify', source: COORD });
    expect(g.doneWhenRatification).toEqual({ ratified: false, why: 'source-does-not-ratify', source: COORD });
    // The pin itself still reads ratified by the coordinator (item 328), and the operator can ratify the modification.
    expect(g.pinRatification).toEqual({ ratified: true, source: COORD });
    expect(s.ratifyGoalsVersion('prog-a', { modification: mod }, NOW + 2, ACTOR)).toEqual({ ok: true, changed: true });
    expect(s.goalsFor('prog-a').doneWhenRatification).toEqual({ ratified: true, source: OPERATOR });
  });

  it('(review 2240 F2) a rollback\'s re-pin, which writes the text and not the source, reads unrecorded, never the older act', () => {
    const s = mk();
    s.setSpecPin('prog-a', SPEC, 'Text A.', NOW, null, ITEM);
    expect(s.ratifyGoalsVersion('prog-a', { pin: { inShortAt: NOW } }, NOW + 1, ACTOR)).toEqual({ ok: true, changed: true });
    // An older build's re-pin: text and stamp only, the source columns as they stood.
    s.db.prepare("UPDATE programs SET inShort = 'Text B.', inShortAt = ? WHERE slug = 'prog-a'").run(NOW + 5);
    expect(cols(s, 'SELECT ratifiedBy FROM programs WHERE slug = ?', 'prog-a')).toEqual({ ratifiedBy: 'operator' });
    expect(s.goalsFor('prog-a').pinRatification).toEqual({ ratified: false, why: 'unrecorded', source: null });
    // The operator can ratify text B, which they are shown, by its own stamp.
    expect(s.ratifyGoalsVersion('prog-a', { pin: { inShortAt: NOW + 5 } }, NOW + 6, ACTOR)).toEqual({ ok: true, changed: true });
    expect(s.goalsFor('prog-a').pinRatification).toEqual({ ratified: true, source: OPERATOR });
  });

  it('(review 2240 F9) the list\'s provenance moves only when its text changes: the same list, or none, keeps it', () => {
    const s = mk();
    s.setSpecPin('prog-a', SPEC, 'What it builds.', NOW, null, COORD);
    const item = raise(s);
    const mod = s.addModification('prog-a', { text: 'List.', ruling: null, itemId: item, pr: null, doneWhen: ['It ships.'] }, NOW + 1);
    const by = (): unknown => cols(s, 'SELECT doneWhenBy FROM programs WHERE slug = ?', 'prog-a');
    s.setSpecPin('prog-a', SPEC, 'Re-pinned, same list.', NOW + 2, ['It ships.'], COORD);
    expect(by()).toEqual({ doneWhenBy: `mod:${mod}` });
    s.setSpecPin('prog-a', SPEC, 'Re-pinned, no list.', NOW + 3, null, COORD);
    expect(by()).toEqual({ doneWhenBy: `mod:${mod}` });
    expect(s.goalsFor('prog-a').doneWhenRatification).toMatchObject({ ratified: false, source: ITEM });
    s.setSpecPin('prog-a', SPEC, 'Re-pinned, new list.', NOW + 4, ['It ships twice.'], COORD);
    expect(by()).toEqual({ doneWhenBy: 'pin' });
  });

  it('(review 2240 F4) the read names the version that wrote the list: the pin by its stamp, a modification by id, else null', () => {
    const s = mk();
    s.setSpecPin('prog-a', SPEC, 'What it builds.', NOW, ['It ships.'], COORD);
    expect(s.goalsFor('prog-a').doneWhenVersion).toEqual({ pin: { inShortAt: NOW } });
    const mod = s.addModification('prog-a', { text: 'List.', ruling: 'r', itemId: null, pr: null, doneWhen: ['Twice.'] }, NOW + 1);
    expect(s.goalsFor('prog-a').doneWhenVersion).toEqual({ modification: mod });
    s.db.prepare("UPDATE programs SET doneWhenBy = NULL WHERE slug = 'prog-a'").run();
    expect(s.goalsFor('prog-a').doneWhenVersion).toBeNull();
    s.db.prepare("UPDATE programs SET doneWhenBy = 'mod:999' WHERE slug = 'prog-a'").run();
    expect(s.goalsFor('prog-a').doneWhenVersion).toBeNull();
  });
});
