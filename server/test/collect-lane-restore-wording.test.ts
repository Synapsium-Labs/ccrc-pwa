// #166 wave 10, Task 13 (path-identity spec 2026-10-12 §5.3, §5.9): the temp-root collector's generation journal is
// never backed up, restored or rolled back. A coord.db snapshot may move backward while the journal stays current, so a
// restored database that disagrees with it stops the lane instead of re-arming it. These cases pin what the operator is
// TOLD: both `CoordDbUnmigratable` restore sentences, `ccrc`'s update and backup usage, the one cross-side name, and the
// whole-state boundary no check can see. What the tools DO is pinned against the real `ccrc` in fixture HOMEs
// (`ccrc-update.test.ts`, `ccrc-uninstall.test.ts`), and the shell holders in `single-definition.test.ts`.
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CoordDbUnmigratable, openCoordDb } from '../src/coord/db.js';
import { COLLECT_LANE_JOURNAL_BASENAME } from '../src/coord/collectLaneJournal.js';
import { mkTmp } from './tmpHelpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string): string => readFileSync(path.join(root, rel), 'utf8');
const flat = (s: string): string => s.replace(/\s+/g, ' ');
/** The name as the operator types it. The basename is the adapter's one constant, never retyped here. */
const JOURNAL = `~/.ccrc/${COLLECT_LANE_JOURNAL_BASENAME}`;

/** `openCoordDb`'s refusal on a fixture file that `plant` prepared, as its flattened message. Never the live HOME. */
function refusal(prefix: string, plant: (dbPath: string) => void): string {
  const p = path.join(mkTmp(prefix), '.ccrc', 'coord.db');
  mkdirSync(path.dirname(p), { recursive: true });
  plant(p);
  let caught: unknown;
  try { openCoordDb(p).close(); } catch (err) { caught = err; }
  expect(caught, `${prefix}: openCoordDb did not refuse the fixture`).toBeInstanceOf(CoordDbUnmigratable);
  return flat((caught as Error).message);
}
/** The 0-byte refusal: a pre-existing truncated file (coord-db.test.ts's fixture). */
const zeroByte = (): string => refusal('ccrc-restore-wording-zero-', (p) => writeFileSync(p, ''));
/** The migration-failure refusal: migration 1 meets a clashing `work_items` (coord-db.test.ts's fixture). */
const migrationFailure = (): string => refusal('ccrc-restore-wording-migrate-', (p) => {
  const raw = new DatabaseSync(p);
  raw.exec('PRAGMA user_version = 0');
  raw.exec('CREATE TABLE work_items (nonsense INTEGER)');
  raw.close();
});

/** One verb's paragraph of `ccrc`'s usage heredoc, whitespace collapsed: from `\n  <verb> ` to `\n  <next> `. */
function usageParagraph(verb: string, next: string): string {
  const lines = read('ccd/ccrc').split('\n');
  const open = lines.indexOf('usage() {');
  const close = lines.indexOf('EOF', open);
  expect(open, 'ccd/ccrc has no usage() {').toBeGreaterThan(-1);
  expect(close, 'the usage heredoc has no closing EOF').toBeGreaterThan(open);
  const usage = lines.slice(open, close).join('\n');
  const a = usage.indexOf(`\n  ${verb} `);
  const b = usage.indexOf(`\n  ${next} `, a + 1);
  expect(a, `no "${verb}" paragraph in the usage`).toBeGreaterThan(-1);
  expect(b, `no "${next}" paragraph after "${verb}"`).toBeGreaterThan(a);
  return flat(usage.slice(a, b));
}

describe('restore wording keeps the journal (path-identity spec §5.3, §5.9)', () => {
  it('both CoordDbUnmigratable messages say to leave collect-lane-generation.log in place', () => {
    const messages = [['the 0-byte refusal', zeroByte()], ['the migration-failure refusal', migrationFailure()]] as const;
    for (const [name, message] of messages) {
      expect(message, `${name}: the snapshot advice the clause amends`).toMatch(/ccrc-backups\/<ts>\/coord\.db/);
      expect(message, name).toContain(`leave ${JOURNAL} in place`);
      expect(message, `${name}: the restore runs with the server stopped`).toContain('only with ccrc.service stopped');
      expect(message, `${name}: what a disagreeing restore does`)
        .toContain('the temp-root collector stays stopped until a fresh choice in Settings');
    }
  });

  it('db.ts interpolates COLLECT_LANE_JOURNAL_BASENAME and spells no basename literal', () => {
    const src = read('server/src/coord/db.ts');
    expect(src).toMatch(/^import \{ COLLECT_LANE_JOURNAL_BASENAME \} from '\.\/collectLaneJournal\.js';$/m);
    expect(src).toContain('~/.ccrc/${COLLECT_LANE_JOURNAL_BASENAME}');
    expect(src, 'a hand-spelled basename in db.ts').not.toContain('collect-lane-generation');
    expect(src.match(/\+ JOURNAL_RESTORE_CLAUSE,$/gm) ?? [], 'both restore sentences end with the one clause').toHaveLength(2);
  });

  it('the update and backup usage say so', () => {
    expect(usageParagraph('update', 'rollback')).toContain(`leaves ${JOURNAL} in place (no backup holds it)`);
    expect(usageParagraph('backup', 'logs')).toContain(`(never ${JOURNAL}: a restore leaves it in place)`);
  });

  it('ccd/ccrc names ~/.ccrc/<COLLECT_LANE_JOURNAL_BASENAME>', () => {
    const text = read('ccd/ccrc');
    expect(text, 'ccd/ccrc never names the journal by the name the server writes').toContain(JOURNAL);
    const spellings = (text.match(/collect-lane-generation[\w.-]*/g) ?? []).map((s) => s.replace(/\.+$/, ''));
    expect(spellings.length, 'the usage twice and the downgrade echo at least').toBeGreaterThanOrEqual(3);
    expect([...new Set(spellings)], 'ccd/ccrc spells the journal another way').toEqual([COLLECT_LANE_JOURNAL_BASENAME]);
  });

  it('the whole-state restore limitation is stated', () => {
    for (const message of [zeroByte(), migrationFailure()]) {
      expect(message).toContain('A restore that moves that file back to the same older point too cannot be detected');
      expect(message).toContain('raise the cleanup pause and confirm a fresh choice in Settings before choosing Live');
    }
  });
});
