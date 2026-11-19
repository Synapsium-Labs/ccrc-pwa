// Overlord W1 private store A (plan w1-private-store.md, Task 4; spec §7.6, H27): the privacy journal is never copied into a
// snapshot or restored with one, so a restored `operator-model.db` never reissues a message id. The twin of
// `landing-entry-census.test.ts#landing-journal-left-in-place`: the prose says so, and no backup set, restore pair or snapshot
// capture names the journal's file. A test that reds when any of them does is the mechanism; the prose is the request.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './scan/symbols.js';
import { PRIVACY_JOURNAL_BASENAME, PRIVACY_JOURNAL_TORN_DIR } from '../src/operatorModel/privacyJournal.js';

const flat = (s: string): string => s.replace(/\s+/g, ' ');
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');
/** A bash text with every comment line blanked, so prose that names the journal (to say it is left out) never reads as a copy. */
const code = (bash: string): string => bash.split('\n').map((l) => (/^\s*#/.test(l) ? '' : l)).join('\n');
/** The names a copy of the journal would spell; any one of them in a backup's code is a red. */
const journalNamed = (body: string): boolean =>
  [PRIVACY_JOURNAL_BASENAME, PRIVACY_JOURNAL_TORN_DIR, 'privacy-journal'].some((n) => body.includes(n));
/** `deploy.sh`'s server-lane backup block: from the served bundle's backup comment to its coordination-snapshot capture. */
function deployServerBackup(text: string): string {
  const a = text.indexOf('# Back up the served bundle before rsync --delete replaces it.');
  expect(a, 'deploy.sh\'s server-lane backup block is gone: a moved block must turn this red').toBeGreaterThan(-1);
  const b = text.indexOf('coordination-snapshot.mjs capture --dir', a);
  expect(b, 'deploy.sh\'s server-lane capture is gone').toBeGreaterThan(a);
  return text.slice(a, b);
}
/** The body of one bash function of `ccd/ccrc`, from its definition to its closing brace at column 0. */
function bashFn(text: string, name: string): string {
  const a = text.indexOf(`\n${name}() {`);
  expect(a, `${name} is gone: a moved function must turn this red`).toBeGreaterThan(-1);
  return text.slice(a, text.indexOf('\n}\n', a));
}

describe('the privacy journal is left in place by every backup and restore', () => {
  it('privacy-journal-left-in-place: the prose says so, and no backup set, restore pair or snapshot capture names privacy-journal.log', () => {
    expect(PRIVACY_JOURNAL_BASENAME).toBe('privacy-journal.log');
    const claude = flat(read('CLAUDE.md'));
    const at = claude.indexOf('The privacy journal, `~/.ccrc/privacy-journal.log`');
    expect(at, 'CLAUDE.md\'s privacy-journal sentence, beside landing.log\'s').toBeGreaterThan(-1);
    const sentence = claude.slice(at, claude.indexOf('reissues a message id.', at) + 'reissues a message id.'.length);
    expect(sentence).toContain('is never copied into a snapshot or restored with one');
    expect(sentence).toContain('leave it in place, so a restored store never reissues a message id');
    const ccrc = read('ccd/ccrc');
    const set = bashFn(ccrc, '_upd_backup_set');
    expect(set).toContain('_upd_backup_copy');
    const pairs = bashFn(ccrc, '_upd_backup_pairs');
    expect(pairs).toContain('_upd_backup_set');
    for (const [name, body] of [['_upd_backup_set', set], ['_upd_backup_pairs', pairs]] as const) {
      expect(body, name).not.toContain(PRIVACY_JOURNAL_BASENAME);
      expect(body, name).not.toContain(PRIVACY_JOURNAL_TORN_DIR);
      expect(body, name).not.toContain('privacy-journal');
    }
    // `_upd_backup` (which snapshots the store) and `deploy.sh`'s server-lane block (which does too), comments blanked (F3).
    const backup = bashFn(ccrc, '_upd_backup');
    expect(backup).toContain('operator-model.db');
    const lane = deployServerBackup(read('deploy/deploy.sh'));
    expect(lane).toContain('operator-model.db');
    for (const [name, body] of [['_upd_backup', backup], ['deploy.sh server lane', lane]] as const) {
      expect(journalNamed(code(body)), name).toBe(false);
    }
    for (const f of ['deploy/backup-coord.mjs', 'deploy/coordination-snapshot.mjs']) {
      expect(existsSync(path.join(REPO_ROOT, f)), `${f} is gone: a moved file must turn this red`).toBe(true);
      expect(read(f), f).not.toContain('privacy-journal');
    }
  });

  it('README\'s restore section says the store goes back with coord.db, and the journal stays', () => {
    const readme = flat(read('README.md'));
    expect(readme).toContain('operator-model.db');
    expect(readme).toContain('no backup copies `~/.ccrc/privacy-journal.log`');
  });

  it('the scan of _upd_backup and deploy.sh\'s server lane sees a planted copy and ignores the journal named in a comment (control)', () => {
    const ccrc = read('ccd/ccrc');
    const backup = bashFn(ccrc, '_upd_backup');
    const planted = backup.replace('  _upd_backup_set\n', '  cp -a "$HOME/.ccrc/privacy-journal.log" "$UPD_BACKUP_DIR/"\n  _upd_backup_set\n');
    expect(planted).not.toBe(backup);
    expect(journalNamed(code(planted))).toBe(true);
    expect(journalNamed(code(`${backup}\n  # the privacy-journal.log stays in place\n`))).toBe(false);
    const lane = deployServerBackup(read('deploy/deploy.sh'));
    const plantedLane = lane.replace('~/ccrc-backups/$TS/operator-model.db;', '~/ccrc-backups/$TS/operator-model.db; cp ~/.ccrc/privacy-journal.log ~/ccrc-backups/$TS/;');
    expect(plantedLane).not.toBe(lane);
    expect(journalNamed(code(plantedLane))).toBe(true);
  });
});
