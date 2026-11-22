// D-8289 (plan docs/superpowers/plans/2026-11-11-new-build-capture.md): the trusted set of Claude Code builds is a record of
// capture verdicts, read through ONE decider (`buildTrustOf`). A reader on a build the record does not trust refuses with a
// typed reason, never a guess. The same L0 file holds the queue's two pure choices and the capture result's one reader.
import { describe, expect, it } from 'vitest';
import {
  BUILD_CAPTURE_FAIL_CEILING, BUILD_CAPTURE_OUTPUT_MAX, BUILD_CAPTURE_RETRY_MS, BUILD_UNTRUSTED_REASONS, buildTrustOf, buildUntrustedSentence,
  captureBlockedBy, captureGivenUp, captureRetryAfterMs, captureStandingOf, capturesToRetry, nextCaptureJob, readBuildCaptureResult, readClaudeBuildRecords,
  unrecordedBuilds, type ClaudeBuildRecord,
} from '../../shared/claudeBuildTrust.js';

const rec = (build: string, over: Partial<ClaudeBuildRecord> = {}): ClaudeBuildRecord => ({
  build, source: 'fleet', capture: 'queued', cwd: false, seenAt: 1, attempts: 0, lastAttemptAt: null, notSent: null, verdictAt: null, output: null, fails: 0, ...over,
});

describe('buildTrustOf: a build is trusted only when its capture passed (D-8289)', () => {
  const records = [
    rec('2.1.302', { source: 'rig', capture: 'pass', cwd: true, verdictAt: 0 }),
    rec('2.1.310', { capture: 'pass', cwd: false, verdictAt: 5 }),
    rec('2.1.320', { capture: 'queued' }),
    rec('2.1.321', { capture: 'fail', verdictAt: 9, output: 'replay: 1 failed' }),
  ];

  it('a passed capture is trusted, carrying whether it proved the cwd', () => {
    expect(buildTrustOf(records, '2.1.302')).toEqual({ kind: 'trusted', cwd: true });
    expect(buildTrustOf(records, '2.1.310')).toEqual({ kind: 'trusted', cwd: false });
  });

  it('every other build refuses with its own reason', () => {
    expect(buildTrustOf(records, null)).toEqual({ kind: 'untrusted', reason: 'unread' });
    expect(buildTrustOf(records, 'not-a-build')).toEqual({ kind: 'untrusted', reason: 'unread' });
    expect(buildTrustOf(null, '2.1.302')).toEqual({ kind: 'untrusted', reason: 'record-unreadable' });
    expect(buildTrustOf(records, '2.1.299')).toEqual({ kind: 'untrusted', reason: 'not-captured' });
    expect(buildTrustOf(records, '2.1.320')).toEqual({ kind: 'untrusted', reason: 'capture-queued' });
    expect(buildTrustOf(records, '2.1.321')).toEqual({ kind: 'untrusted', reason: 'capture-failed' });
  });

  it('no floor and no range: a build above every passed one is not trusted for it', () => {
    expect(buildTrustOf([rec('2.1.302', { capture: 'pass', cwd: true })], '2.1.303')).toEqual({ kind: 'untrusted', reason: 'not-captured' });
    expect(buildTrustOf([rec('2.1.302', { capture: 'pass', cwd: true })], '2.1.301')).toEqual({ kind: 'untrusted', reason: 'not-captured' });
  });

  it('every reason has a sentence that names the build, or says it could not be read', () => {
    for (const r of BUILD_UNTRUSTED_REASONS) expect(buildUntrustedSentence(r, '2.1.320').length).toBeGreaterThan(10);
    expect(buildUntrustedSentence('capture-failed', '2.1.321')).toContain('2.1.321');
    expect(buildUntrustedSentence('unread', null)).not.toContain('null');
  });
});

describe('the queue\'s two choices (D-8289)', () => {
  it('unrecordedBuilds: each well-formed build a session runs that has no row, once, newest first', () => {
    const records = [rec('2.1.302', { capture: 'pass' })];
    expect(unrecordedBuilds(records, ['2.1.320', null, '2.1.302', 'junk', '2.1.320', '2.1.318'])).toEqual(['2.1.320', '2.1.318']);
    expect(unrecordedBuilds(records, ['2.1.302'])).toEqual([]);
  });

  it('nextCaptureJob: the newest queued build that has not been sent within the retry spacing', () => {
    const now = 10 * BUILD_CAPTURE_RETRY_MS;
    const records = [
      rec('2.1.302', { capture: 'pass' }),
      rec('2.1.318'),
      rec('2.1.320', { attempts: 1, lastAttemptAt: now - BUILD_CAPTURE_RETRY_MS + 1 }),
      rec('2.1.321', { capture: 'fail' }),
    ];
    expect(nextCaptureJob(records, now)).toBe('2.1.318');
    expect(nextCaptureJob(records, now + 1)).toBe('2.1.320');
    expect(nextCaptureJob([rec('2.1.302', { capture: 'pass' })], now)).toBeNull();
  });
});

describe('captureBlockedBy: why the queue cannot send anything, from the record alone (D-8289)', () => {
  it('the queued build tried last says it: not sent for want of a box or a runner, or null once a job went out', () => {
    expect(captureBlockedBy([rec('2.1.320')]), 'never tried').toBeNull();
    expect(captureBlockedBy([rec('2.1.320', { lastAttemptAt: 5, notSent: 'no-runner' })])).toBe('no-runner');
    expect(captureBlockedBy([
      rec('2.1.320', { lastAttemptAt: 5, notSent: 'no-runner' }),
      rec('2.1.318', { lastAttemptAt: 9, notSent: 'no-test-box' }),
    ]), 'the latest try wins').toBe('no-test-box');
    expect(captureBlockedBy([
      rec('2.1.320', { lastAttemptAt: 5, notSent: 'no-runner' }),
      rec('2.1.318', { lastAttemptAt: 9, attempts: 1 }),
    ]), 'a later job that went out clears it').toBeNull();
    expect(captureBlockedBy([
      rec('2.1.302', { capture: 'pass', lastAttemptAt: 99 }),
      rec('2.1.320', { lastAttemptAt: 5, notSent: 'no-runner' }),
    ]), 'a verdict row is not a try').toBe('no-runner');
  });
});

describe('readBuildCaptureResult: the capture answer\'s one reader (D-8289)', () => {
  const good = { build: '2.1.320', pass: true, cwd: true, output: 'replay: 12 passed' };

  it('reads a well-formed answer for the job it was sent for', () => {
    expect(readBuildCaptureResult(good, '2.1.320')).toEqual(good);
  });

  it('refuses another build, a missing or mistyped field, and any field it does not name', () => {
    expect(readBuildCaptureResult(good, '2.1.321')).toBeNull();
    expect(readBuildCaptureResult({ ...good, pass: 'yes' }, '2.1.320')).toBeNull();
    expect(readBuildCaptureResult({ ...good, cwd: undefined }, '2.1.320')).toBeNull();
    expect(readBuildCaptureResult({ ...good, output: 7 }, '2.1.320')).toBeNull();
    expect(readBuildCaptureResult({ ...good, extra: 1 }, '2.1.320')).toBeNull();
    expect(readBuildCaptureResult(null, '2.1.320')).toBeNull();
    expect(readBuildCaptureResult([good], '2.1.320')).toBeNull();
  });

  it('a failed capture never claims the cwd, and the output keeps its tail under the cap', () => {
    expect(readBuildCaptureResult({ ...good, pass: false }, '2.1.320')).toEqual({ ...good, pass: false, cwd: false });
    const long = `${'a'.repeat(BUILD_CAPTURE_OUTPUT_MAX)}TAIL`;
    const read = readBuildCaptureResult({ ...good, output: long }, '2.1.320');
    expect(read?.output.length).toBe(BUILD_CAPTURE_OUTPUT_MAX);
    expect(read?.output.endsWith('TAIL')).toBe(true);
  });
});

describe('readClaudeBuildRecords: the wire list\'s one reader (D-8289)', () => {
  it('reads every well-formed row and refuses a list with any row off its shape', () => {
    const rows = [rec('2.1.302', { source: 'rig', capture: 'pass', cwd: true, verdictAt: 0 }), rec('2.1.320')];
    expect(readClaudeBuildRecords(rows)).toEqual(rows);
    expect(readClaudeBuildRecords([...rows, { ...rec('2.1.321'), capture: 'maybe' }])).toBeNull();
    expect(readClaudeBuildRecords([{ ...rec('2.1.321'), source: 'elsewhere' }])).toBeNull();
    expect(readClaudeBuildRecords([rec('2.1.321', { lastAttemptAt: 5, notSent: 'no-runner' })])?.[0]?.notSent).toBe('no-runner');
    expect(readClaudeBuildRecords([{ ...rec('2.1.321'), notSent: 'unanswered' }]), 'a job that went out is not a not-sent').toBeNull();
    expect(readClaudeBuildRecords([{ ...rec('2.1.321'), notSent: undefined }])).toBeNull();
    expect(readClaudeBuildRecords('x')).toBeNull();
  });

  it('fails is additive: absent (an older server) reads as 0, and a value that is no count refuses the list', () => {
    const { fails: _absent, ...older } = rec('2.1.321', { capture: 'fail', verdictAt: 9 });
    expect(readClaudeBuildRecords([older])?.[0]?.fails).toBe(0);
    expect(readClaudeBuildRecords([rec('2.1.321', { capture: 'fail', fails: 2 })])?.[0]?.fails).toBe(2);
    for (const bad of [-1, 1.5, '2', null]) expect(readClaudeBuildRecords([{ ...rec('2.1.321'), fails: bad }]), String(bad)).toBeNull();
  });
});

describe('a failed capture is captured again before anyone is told (slug capture-retry-ceiling)', () => {
  const V = 100 * BUILD_CAPTURE_RETRY_MS;
  const failed = (build: string, fails: number, verdictAt = V): ClaudeBuildRecord => rec(build, { capture: 'fail', verdictAt, fails, attempts: fails });

  it('the spacing: an hour after the first failure, two after the second; the ceiling is three', () => {
    expect(BUILD_CAPTURE_FAIL_CEILING).toBe(3);
    expect(captureRetryAfterMs(1)).toBe(BUILD_CAPTURE_RETRY_MS);
    expect(captureRetryAfterMs(2)).toBe(2 * BUILD_CAPTURE_RETRY_MS);
  });

  it('captureStandingOf: trusted, queued, retrying with its time, or given up at the ceiling', () => {
    expect(captureStandingOf(rec('2.1.302', { capture: 'pass', cwd: true }))).toEqual({ kind: 'trusted' });
    expect(captureStandingOf(rec('2.1.320'))).toEqual({ kind: 'queued' });
    expect(captureStandingOf(failed('2.1.321', 1))).toEqual({ kind: 'retrying', fails: 1, at: V + BUILD_CAPTURE_RETRY_MS });
    expect(captureStandingOf(failed('2.1.321', 2))).toEqual({ kind: 'retrying', fails: 2, at: V + 2 * BUILD_CAPTURE_RETRY_MS });
    expect(captureStandingOf(failed('2.1.321', 3))).toEqual({ kind: 'given-up', fails: 3 });
    expect(captureStandingOf(failed('2.1.321', 4)), 'a Capture again past the ceiling that failed again').toEqual({ kind: 'given-up', fails: 4 });
    expect(captureStandingOf(failed('2.1.321', 0)), 'an older server, which retries nothing').toEqual({ kind: 'given-up', fails: 0 });
  });

  it('captureGivenUp: true exactly when the standing is given up', () => {
    expect([rec('2.1.302', { capture: 'pass' }), rec('2.1.320'), failed('2.1.321', 2), failed('2.1.321', 3), failed('2.1.321', 0)].map(captureGivenUp))
      .toEqual([false, false, false, true, true]);
  });

  it('capturesToRetry: each retrying build whose time has come, newest first; never a given-up, queued or trusted one', () => {
    const records = [
      failed('2.1.318', 1), failed('2.1.319', 2), failed('2.1.320', 3), failed('2.1.317', 1, V + 5),
      rec('2.1.322'), rec('2.1.302', { capture: 'pass' }),
    ];
    expect(capturesToRetry(records, V + BUILD_CAPTURE_RETRY_MS - 1)).toEqual([]);
    expect(capturesToRetry(records, V + BUILD_CAPTURE_RETRY_MS)).toEqual(['2.1.318']);
    expect(capturesToRetry(records, V + BUILD_CAPTURE_RETRY_MS + 5)).toEqual(['2.1.318', '2.1.317']);
    expect(capturesToRetry(records, V + 100 * BUILD_CAPTURE_RETRY_MS)).toEqual(['2.1.319', '2.1.318', '2.1.317']);
  });
});
