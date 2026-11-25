// Draft review's L0 vocabulary and limits (native Docs reader X3, plan Task R1.1).
import { describe, it, expect } from 'vitest';
import { DOCS_EXPORT_MAX_BYTES } from '../../shared/docs.js';
import {
  REVIEW_IDLE_MS, REVIEW_MAX_LIVE, REVIEW_MAX_STORE_BYTES, REVIEW_OPEN_BODY_BYTES, REVIEW_OPEN_STREAMS,
  REVIEW_CREATE_REFUSALS, REVIEW_OPEN_STREAMS_PER_SHARE, REVIEW_PENDING_RETRY_MS, REVIEW_REMOVALS, REVIEW_RETENTION_MS, REVIEW_SEND_IDLE_MS,
  REVIEW_SWEEP_MS, REVIEW_TOKEN_RE, REVIEW_TOMBSTONE_MS, REVIEW_VIEW_COARSEN_MS, isReviewSource, isReviewToken,
  replacedExpiredOf, reviewDate, type ReviewCreateAnswer, type ReviewSource,
} from '../../shared/docsReview.js';

const H40 = 'a'.repeat(40);
const H64 = 'b'.repeat(64);
const source = (over: Partial<Record<keyof ReviewSource, unknown>> = {}): unknown => ({
  project: 'project-a', section: 'specs', path: 'x/y.md', branch: 'main', head: H40, servedRef: 'refs/remotes/origin/main',
  baseCommit: H40, fp: H64, committedBlob: H40, ...over,
});

describe('review L0 vocabulary (X3 R1.1)', () => {
  it('each limit equals its plan value', () => {
    expect(DOCS_EXPORT_MAX_BYTES).toBe(10485760);
    expect(REVIEW_MAX_LIVE).toBe(64);
    expect(REVIEW_MAX_STORE_BYTES).toBe(268435456);
    expect(REVIEW_IDLE_MS).toBe(604800000);
    expect(REVIEW_RETENTION_MS).toBe(2592000000);
    expect(REVIEW_TOMBSTONE_MS).toBe(604800000);
    expect(REVIEW_VIEW_COARSEN_MS).toBe(60000);
    expect(REVIEW_SWEEP_MS).toBe(600000);
    expect(REVIEW_PENDING_RETRY_MS).toBe(10000);
    expect(REVIEW_OPEN_STREAMS_PER_SHARE).toBe(2);
    expect(REVIEW_OPEN_STREAMS).toBe(16);
    expect(REVIEW_SEND_IDLE_MS).toBe(30000);
    expect(REVIEW_OPEN_BODY_BYTES).toBe(256);
    expect(REVIEW_TOKEN_RE.source).toBe('^[A-Za-z0-9_-]{43}$');
  });

  it('isReviewToken takes exactly 43 base64url characters', () => {
    expect(isReviewToken('A'.repeat(43))).toBe(true);
    expect(isReviewToken('a-_Z0'.repeat(8) + 'abc')).toBe(true);
    expect(isReviewToken('A'.repeat(42))).toBe(false);
    expect(isReviewToken('A'.repeat(44))).toBe(false);
    for (const c of ['+', '/', '=']) expect(isReviewToken('A'.repeat(42) + c)).toBe(false);
    expect(isReviewToken('')).toBe(false);
  });

  it('REVIEW_REMOVALS is the five causes in order', () => {
    expect(REVIEW_REMOVALS).toEqual(['revoked', 'expired', 'committed', 'retention', 'lost']);
  });

  it('REVIEW_CREATE_REFUSALS is the five refusals, with no auth-off', () => {
    expect(REVIEW_CREATE_REFUSALS).toEqual(['too-large', 'store-full', 'store-unreadable', 'not-durable', 'bad-source']);
  });

  it('isReviewSource builds on the docs grammars', () => {
    expect(isReviewSource(source())).toBe(true);
    expect(isReviewSource(source({ committedBlob: null }))).toBe(true);
    expect(isReviewSource(source({ head: H64, baseCommit: H64, committedBlob: H64 }))).toBe(true);
    expect(isReviewSource(source({ section: 'programs' }))).toBe(false);
    expect(isReviewSource(source({ path: '../x.md' }))).toBe(false);
    expect(isReviewSource(source({ head: 'a'.repeat(39) }))).toBe(false);
    expect(isReviewSource(source({ fp: 'b'.repeat(63) }))).toBe(false);
    expect(isReviewSource(source({ baseCommit: 'a'.repeat(39) }))).toBe(false);
    expect(isReviewSource(source({ committedBlob: 'a'.repeat(39) }))).toBe(false);
    expect(isReviewSource(source({ servedRef: 'refs/heads/main' }))).toBe(true);
    expect(isReviewSource(source({ branch: 'HEAD' }))).toBe(false);
    // D-8835: one spelling each, the docs reader's pin parser's, so one file on one branch is one live share.
    expect(isReviewSource(source({ branch: 'refs/heads/main' }))).toBe(false);
    expect(isReviewSource(source({ servedRef: 'main' }))).toBe(false);
    expect(isReviewSource(source({ head: 123 }))).toBe(false);
    expect(isReviewSource(source({ project: '../x' }))).toBe(false);
    const { committedBlob: _omitted, ...noBlob } = source() as Record<string, unknown>;
    expect(isReviewSource(noBlob)).toBe(false);
    expect(isReviewSource(null)).toBe(false);
    expect(isReviewSource('x')).toBe(false);
  });

  it('reviewDate reads day, short month and year in local time', () => {
    expect(reviewDate(new Date(2026, 10, 26, 12).getTime())).toBe('26 Nov 2026');
    expect(reviewDate(new Date(2026, 0, 5, 12).getTime())).toBe('5 Jan 2026');
  });

  it('replacedExpiredOf reads absent as false', () => {
    const share = {} as ReviewCreateAnswer['share'];
    expect(replacedExpiredOf({ ok: true, share })).toBe(false);
    expect(replacedExpiredOf({ ok: true, share, replacedExpired: true })).toBe(true);
  });
});
