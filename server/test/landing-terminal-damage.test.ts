// Landing order wave 5i, fix round 1 (R1): a raw terminal row (landed, closed, withdrawn) with display-level damage reads
// `unknown` through the strict reader, and must not hold the binding as an open blocker. Openness is classified from the
// STORED state word (`LandingMutationFacts.stateWords`), not the damage-folded display state. Real `CoordStore` over a
// temporary coord.db; raw rows are inserted with SQL and damaged in turn. Controls: a raw `pinned`, `unknown` or unrecognised
// word with the same damage still holds, and an independent recovery hold still answers `recovery`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import type { CoordStore } from '../src/coord/store.js';
import { landingBindingOf } from '../src/coord/landingLine.js';
import { CONTROL_BASE_SHA, CONTROL_HEAD_SHA, CONTROL_NOW, controlRead, landingFactsOf, landingStoreOver } from './landingFixture.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(() => { vi.useRealTimers(); removeTmpFixtures(); });

const P = 'project-a';
const HC = 'c'.repeat(40);
const OLD = 'f'.repeat(40);
let coord: CoordStore;
beforeEach(() => {
  const dbPath = path.join(mkTmp('ccrc-landing-damage-'), '.ccrc', 'coord.db');
  coord = landingStoreOver(openCoordDb(dbPath), dbPath);
});

const rows = (sql: string): Record<string, unknown>[] => coord.db.prepare(sql).all() as Record<string, unknown>[];
/** A raw row for PR 5 in `word`, with one column damaged. */
const rawRow = (word: string, damage: Record<string, unknown> | null): void => {
  coord.db.prepare('INSERT INTO landing_entries (project, pr, pinnedSha, handoffCommit, runId, state, setBy, pinnedAt) VALUES (?, 5, ?, ?, NULL, ?, ?, 1)')
    .run(P, OLD, HC, word, 'operator');
  // The schema has no CHECK on these columns; `runId` carries a foreign key, so its damage is written with the check off.
  coord.db.exec('PRAGMA foreign_keys = OFF');
  for (const [col, v] of Object.entries(damage ?? {})) coord.db.prepare(`UPDATE landing_entries SET ${col} = ? WHERE pr = 5`).run(v as never);
  coord.db.exec('PRAGMA foreign_keys = ON');
};
/** The clean pinned head, PR 7, created through the authority writer. */
const cleanHead = (): void => {
  expect(coord.writeLandingAuthority({ kind: 'entry', project: P, pr: 7, pinnedSha: CONTROL_HEAD_SHA, handoffCommit: HC, setBy: 'creator-a' }, 1000)).toMatchObject({ ok: true });
};
const READY = { mode: 'ready', pr: 7, pinnedSha: CONTROL_HEAD_SHA, baseSha: CONTROL_BASE_SHA, fixesMain: false };
const binding = () => landingBindingOf(landingFactsOf(coord, P), controlRead(), CONTROL_NOW);
const cueMails = () => rows("SELECT * FROM mail WHERE subject LIKE 'next-to-land:%' ORDER BY id");
const apply = () => coord.applyLandingControl({ project: P, control: controlRead(), nowMs: CONTROL_NOW });

const DAMAGE: [string, Record<string, unknown>][] = [
  ['afterIds not json', { afterIds: 'not-json' }],
  ['fixesMain 7', { fixesMain: 7 }],
  ['ejectionKind bogus', { ejectionKind: 'bogus-kind' }],
  ['pinnedAt text', { pinnedAt: 'later' }],
  ['ejections negative', { ejections: -1 }],
  ['runId text', { runId: 'run-x' }],
];
const TERMINAL = ['landed', 'closed', 'withdrawn'] as const;

describe('a raw terminal row with display-level damage is not an open blocker (R1)', () => {
  for (const word of TERMINAL) for (const [label, damage] of DAMAGE) {
    it(`raw ${word}, ${label}: displays unknown, the stored word reads ${word}, the clean head is ready and its cue queues once`, () => {
      rawRow(word, damage);
      cleanHead();
      const before = rows('SELECT * FROM landing_entries WHERE pr = 5');
      const facts = landingFactsOf(coord, P);
      const damaged = facts.entries.find((e) => e.pr === 5)!;
      expect(damaged.state).toBe('unknown');
      expect(facts.stateWords.find((w) => w.id === damaged.id)?.value).toBe(word);
      expect(facts.stateWords).toHaveLength(facts.entries.length);
      expect(binding()).toEqual({ ...READY, entryId: facts.entries.find((e) => e.pr === 7)!.id,
        landerAt: expect.any(String), probeAt: expect.any(String), healthAt: expect.any(String) });
      expect(apply()).toMatchObject({ kind: 'queued' });
      const mails = cueMails();
      expect(mails).toHaveLength(1);
      expect(mails[0]).toMatchObject({ toId: 'creator-a', runId: null, subject: expect.stringMatching(/^next-to-land:#7:/) });
      expect(apply()).toEqual({ kind: 'duplicate', holdChanged: false });
      expect(cueMails()).toHaveLength(1);
      expect(rows('SELECT * FROM landing_entries WHERE pr = 5')).toEqual(before);
    });
  }

  it('the closed re-pin restriction stands for a damaged closed row: the run\'s pin is kept, the raw bytes unchanged', () => {
    rawRow('closed', { afterIds: 'not-json' });
    const before = rows('SELECT * FROM landing_entries WHERE pr = 5');
    const opened = coord.openRun({ program: 'p', title: 't', project: P, wave: 1, waveOf: 1, claimedBy: 'coord-a' });
    if (!('id' in opened)) throw new Error('fixture openRun refused');
    coord.setSession(opened.id, 'project-a-ws1');
    for (const to of ['dispatched', 'working', 'awaiting-review'] as const) if (!coord.advance(opened.id, to, 'test').ok) throw new Error(`fixture ${to}`);
    const r = coord.advanceLanding({ runId: opened.id, to: 'merging', causedBy: 'coordinator',
      landing: { kind: 'pin', head: CONTROL_HEAD_SHA, pr: 5, mode: 'off', handoffCommit: HC } });
    expect(r).toMatchObject({ ok: true, landing: { kind: 'kept' } });
    expect(rows('SELECT * FROM landing_entries WHERE pr = 5')).toEqual(before);
  });
});

describe('controls: what must still hold projection-unreadable (R1)', () => {
  for (const word of ['pinned', 'unknown', 'parked-v9']) for (const [label, damage] of DAMAGE.slice(0, 3)) {
    it(`raw ${word}, ${label}: holds projection-unreadable`, () => {
      rawRow(word, damage);
      cleanHead();
      const facts = landingFactsOf(coord, P);
      const id = facts.entries.find((e) => e.pr === 5)!.id;
      expect(facts.stateWords.find((w) => w.id === id)?.value).toBe(word === 'parked-v9' ? 'unrecognised' : word);
      expect(binding()).toMatchObject({ mode: 'held', reason: 'projection-unreadable' });
    });
  }
  for (const word of ['parked-v9', 'unknown']) it(`an undamaged raw ${word} holds too`, () => {
    rawRow(word, null);
    cleanHead();
    expect(binding()).toMatchObject({ mode: 'held', reason: 'projection-unreadable' });
  });
  it('an independent recovery hold still answers recovery with the damaged terminal row present', () => {
    rawRow('landed', { afterIds: 'not-json' });
    cleanHead();
    const facts = landingFactsOf(coord, P);
    const held = { ...facts, recovery: { subjects: [], hold: { reason: 'landing-recovery-unresolved' as const, subjectIds: [facts.entries[1]!.id] } } };
    expect(landingBindingOf(held, controlRead(), CONTROL_NOW)).toMatchObject({ mode: 'held', reason: 'recovery' });
  });
});
