// Session helpers HF1, review 3080 F1: which migration holds each of the newest slots, pinned by its DDL.
//
// A migration's slot is its `user_version`: `db.ts` runs `MIGRATIONS[v]` for every `v` at or past a database's version,
// so a live database already at 117 never runs a migration moved into 116 or below. The slots are positional, and two
// branches that each append one are renumbered at landing (schema.ts' banners say so), so a swap of two neighbouring
// entries is the mistake a landing can make. Before this file nothing caught it: review 3080 measured a swap of 116 and
// 117 that survived run-close-switch and was killed in coord-db by its banner-order case only, and a whole-block swap
// with the banners left in order survived both. This pins each newest slot to a DDL fragment no other entry carries.
//
// A new migration appends a slot and changes no row here; add its row in the PR that adds it, if it wants one. A row is
// never edited: a slot that changed under a live database is the defect this file exists to catch.
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../src/coord/schema.js';

/** Slot -> a fragment of its DDL, whitespace collapsed. Measured on main at 841a8528f6 (2026-11-21). */
const NEWEST_SLOTS: ReadonlyArray<readonly [number, string]> = [
  [106, 'CREATE TABLE linear_drift_cursors'],
  [107, 'ALTER TABLE mail ADD COLUMN urgentAs'],
  [108, 'CREATE TABLE overlord_fence_refusals'],
  [109, 'CREATE TABLE continuity_hook_reports'],
  [110, "VALUES ('working-idle-sleep', 'shadow', 0)"],
  [111, "VALUES ('cap-counts-working', 'shadow', 0)"],
  [112, 'ALTER TABLE runs ADD COLUMN admissionWaitSince INTEGER'],
  [113, 'ALTER TABLE linear_migrations ADD COLUMN project TEXT'],
  [114, 'ALTER TABLE approvals ADD COLUMN parkWord TEXT'],
  [115, 'ALTER TABLE project_linking ADD COLUMN teamWorkspace TEXT'],
  [116, 'ALTER TABLE runs ADD COLUMN inPlace INTEGER'],
  [117, 'ALTER TABLE delegation_activities ADD COLUMN endBasis TEXT'],
];

/** A migration's text with SQL line comments dropped and whitespace collapsed, so a banner's wording never matches. */
const ddl = (sql: string): string => sql.split('\n').map((l) => l.replace(/--.*$/, '')).join(' ').replace(/\s+/g, ' ').trim();

describe('the newest migration slots, pinned by their DDL (review 3080 F1)', () => {
  it('each slot holds its own migration', () => {
    expect(MIGRATIONS.length).toBeGreaterThan(NEWEST_SLOTS.at(-1)![0]);
    for (const [slot, fragment] of NEWEST_SLOTS) expect({ slot, holds: ddl(MIGRATIONS[slot]!).includes(fragment) }).toEqual({ slot, holds: true });
  });

  it('each fragment names one migration only, so a swap of any two of them is red', () => {
    for (const [slot, fragment] of NEWEST_SLOTS) {
      const holders = MIGRATIONS.flatMap((m, i) => (ddl(m).includes(fragment) ? [i] : []));
      expect({ fragment, holders }).toEqual({ fragment, holders: [slot] });
    }
  });
});
