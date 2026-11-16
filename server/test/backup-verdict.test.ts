// D-7858: the backup decider (`shared/backup.ts`), one row per status and one per precedence edge. Each row names the
// mutant that turns it red (measured when the row was written): a row that no mutant can break proves nothing.
// Fixture lines are neutral: no tool, host or path of any deployment.
import { describe, expect, it } from 'vitest';
import {
  BACKUP_STALE_HOURS_DEFAULT, BACKUP_STATUSES, backupStaleHoursOf, backupVerdict, parseBackupLine, readBackupHealth,
  readBackupRead, type BackupFile, type BackupRead,
} from '../../shared/backup.js';

const H = 3_600_000;
const NOW = Date.parse('2026-11-03T12:00:00Z');
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const read = (files: Partial<Record<BackupFile, string>>): BackupRead => ({ state: 'read', files });
const verdict = (r: BackupRead, staleH = 36) => backupVerdict(r, NOW, NOW, staleH);

describe('parseBackupLine: <ISO>Z k=v ... words', () => {
  it('reads the time, the pairs and the note, and keeps unknown keys', () => {
    expect(parseBackupLine('2026-11-03T03:34:00Z mode=backup exit=1 step-a\n')).toEqual({
      at: Date.parse('2026-11-03T03:34:00Z'), kv: { mode: 'backup', exit: '1' }, note: 'step-a',
    });
    expect(parseBackupLine('2026-11-03T03:34:00Z some-key=3 the reason, in words')!.note).toBe('the reason, in words');
    expect(parseBackupLine('2026-11-03T03:34:00Z future=x mode=backup')!.kv).toEqual({ future: 'x', mode: 'backup' });
  });

  it('only the first line counts, and the first of a repeated key wins', () => {
    // mutant: the last repeated key wins → red.
    expect(parseBackupLine('2026-11-03T03:34:00Z exit=1 exit=2\n2026-11-04T00:00:00Z exit=9')).toMatchObject({
      at: Date.parse('2026-11-03T03:34:00Z'), kv: { exit: '1' },
    });
  });

  it('a line whose first word is not a UTC time is malformed', () => {
    // mutant: the ISO check dropped (Date.parse alone) → red on the offset form.
    for (const bad of ['', 'mode=backup', '2026-11-03 03:34:00 mode=backup', '2026-11-03T03:34:00+01:00 mode=backup', 'yesterday'])
      expect(parseBackupLine(bad), bad).toBeNull();
  });
});

describe('backupVerdict: one row per status', () => {
  it('not-configured: no alarm, nothing read', () => {
    // mutant: not-configured mapped to unreadable → red.
    expect(verdict({ state: 'not-configured' })).toMatchObject({ status: 'not-configured', lastSuccessAt: null, stale: null });
  });

  it('unreadable: the reader\'s why is carried', () => {
    // mutant: the why dropped → red.
    expect(verdict({ state: 'unreadable', why: 'denied' })).toMatchObject({ status: 'unreadable', unreadable: 'denied' });
  });

  it('unreadable: a present file in no known shape is malformed, never ok', () => {
    // mutant: a malformed file skipped → ok → red.
    expect(verdict(read({ 'last-success': iso(NOW - H), 'last-failure': 'garbage' })))
      .toMatchObject({ status: 'unreadable', unreadable: 'malformed' });
  });

  it('ok: a fresh success and nothing newer', () => {
    // mutant: the stale bound compared in minutes → red.
    const v = verdict(read({ 'last-success': `${iso(NOW - 5 * H)} mode=backup`, 'last-failure': `${iso(NOW - 30 * H)} exit=1 step-a` }));
    expect(v).toMatchObject({ status: 'ok', lastSuccessAt: NOW - 5 * H, stale: null });
    expect(v.lastFailure).toEqual({ at: NOW - 30 * H, exit: 1, note: 'step-a' });
  });

  it('warning: a last warning newer than the last success', () => {
    // mutant: warning compared with `<` → red.
    expect(verdict(read({ 'last-success': iso(NOW - 5 * H), 'last-warning': `${iso(NOW - 4 * H)} code=3 some files vanished` })))
      .toMatchObject({ status: 'warning', lastWarning: { at: NOW - 4 * H, exit: null, note: 'some files vanished' } });
  });

  it('failed: a last failure newer than the last success, with its exit and its step', () => {
    // mutant: the failure arm removed → ok → red.
    expect(verdict(read({ 'last-success': iso(NOW - 25 * H), 'last-failure': `${iso(NOW - H)} mode=backup exit=2 step-b` })))
      .toMatchObject({ status: 'failed', lastFailure: { at: NOW - H, exit: 2, note: 'step-b' } });
  });

  it('stale: the success older than the configured hours, with its age', () => {
    // mutant: staleHours ignored (default used) → red at 10 h.
    expect(verdict(read({ 'last-success': iso(NOW - 11 * H) }), 10))
      .toMatchObject({ status: 'stale', stale: { at: NOW, ageH: 11 } });
    expect(verdict(read({ 'last-success': iso(NOW - 11 * H) }), 12)).toMatchObject({ status: 'ok' });
  });

  it('stale: no success at all, whatever else is there', () => {
    // mutant: a missing success read as fresh → red.
    expect(verdict(read({}))).toMatchObject({ status: 'stale', stale: { at: NOW, ageH: null }, lastSuccessAt: null });
    expect(verdict(read({ 'last-skip': `${iso(NOW - H)} exit=75 lock-held` })))
      .toMatchObject({ status: 'stale', lastSkip: { at: NOW - H, exit: 75, note: 'lock-held' } });
  });

  it('stale: the box\'s own marker newer than the last success, at the marker\'s time', () => {
    // mutant: the marker ignored → ok → red.
    expect(verdict(read({ 'last-success': iso(NOW - 2 * H), stale: `${iso(NOW - H)} age_h=40 max_h=36` }), 36))
      .toMatchObject({ status: 'stale', stale: { at: NOW - H, ageH: 2 } });
  });
});

describe('backupVerdict: the precedence edges (stale > failed > warning > ok)', () => {
  it('a marker older than the last success is the marker job\'s lag, not stale', () => {
    // mutant: `newer` dropped for the marker → red.
    expect(verdict(read({ 'last-success': iso(NOW - H), stale: iso(NOW - 2 * H) }))).toMatchObject({ status: 'ok' });
  });

  it('stale wins over failed', () => {
    // mutant: failed checked before stale → red.
    expect(verdict(read({ 'last-success': iso(NOW - 40 * H), 'last-failure': `${iso(NOW - H)} exit=1` })))
      .toMatchObject({ status: 'stale', lastFailure: { exit: 1 } });
  });

  it('failed wins over warning', () => {
    // mutant: warning checked before failed → red.
    expect(verdict(read({ 'last-success': iso(NOW - 3 * H), 'last-warning': iso(NOW - 2 * H), 'last-failure': `${iso(NOW - H)} exit=1` })))
      .toMatchObject({ status: 'failed' });
  });

  it('a failure at the same instant as the success is not newer', () => {
    // mutant: `>` loosened to `>=` → red.
    expect(verdict(read({ 'last-success': iso(NOW - H), 'last-failure': `${iso(NOW - H)} exit=1` }))).toMatchObject({ status: 'ok' });
  });

  it('the stale bound is strict: exactly the configured hours is not yet stale', () => {
    // mutant: `>` loosened to `>=` → red.
    expect(verdict(read({ 'last-success': iso(NOW - 36 * H) }), 36)).toMatchObject({ status: 'ok' });
    expect(verdict(read({ 'last-success': iso(NOW - 36 * H - 1000) }), 36)).toMatchObject({ status: 'stale' });
  });

  it('a skip after the success changes nothing', () => {
    // mutant: a skip read as a failure → red.
    expect(verdict(read({ 'last-success': iso(NOW - 3 * H), 'last-skip': `${iso(NOW - H)} exit=75` }))).toMatchObject({ status: 'ok' });
  });
});

describe('the setting and the wire readers', () => {
  it('CCRC_BACKUP_STALE_HOURS: a whole number from 1 up, else the default', () => {
    // mutant: 0 accepted → red.
    expect(backupStaleHoursOf(undefined)).toBe(BACKUP_STALE_HOURS_DEFAULT);
    expect(backupStaleHoursOf('')).toBe(36);
    expect(backupStaleHoursOf(' 48 ')).toBe(48);
    for (const bad of ['0', '-1', '1.5', '12h', '99999']) expect(backupStaleHoursOf(bad), bad).toBe(36);
  });

  it('readBackupRead refuses an unknown file, a non-string text and an unknown why', () => {
    expect(readBackupRead({ state: 'read', files: { 'last-success': iso(NOW) } })).toEqual(read({ 'last-success': iso(NOW) }));
    expect(readBackupRead({ state: 'not-configured' })).toEqual({ state: 'not-configured' });
    expect(readBackupRead({ state: 'unreadable', why: 'denied' })).toEqual({ state: 'unreadable', why: 'denied' });
    expect(readBackupRead({ state: 'read', files: { other: 'x' } })).toBeNull();
    expect(readBackupRead({ state: 'read', files: { stale: 3 } })).toBeNull();
    expect(readBackupRead({ state: 'read', files: { stale: 'x'.repeat(4097) } })).toBeNull();
    expect(readBackupRead({ state: 'unreadable', why: 'tired' })).toBeNull();
    expect(readBackupRead(null)).toBeNull();
  });

  it('readBackupHealth round-trips every status the decider makes, and absence is null', () => {
    const made = [
      verdict({ state: 'not-configured' }), verdict({ state: 'unreadable', why: 'no-directory' }),
      verdict(read({ 'last-success': iso(NOW - H) })), verdict(read({ 'last-success': iso(NOW - 2 * H), 'last-warning': iso(NOW - H) })),
      verdict(read({ 'last-success': iso(NOW - 2 * H), 'last-failure': `${iso(NOW - H)} exit=4 step-c` })), verdict(read({})),
    ];
    expect(new Set(made.map((m) => m.status))).toEqual(new Set(BACKUP_STATUSES));
    for (const m of made) expect(readBackupHealth({ backup: JSON.parse(JSON.stringify(m)) })).toEqual(m);
    expect(readBackupHealth({})).toBeNull();
    expect(readBackupHealth({ backup: { ...made[2], status: 'fine' } })).toBeNull();
    expect(readBackupHealth({ backup: { ...made[5], stale: null } })).toBeNull();
  });
});
