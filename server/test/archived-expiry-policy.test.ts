// The expiry lane's DECISIONS, table-driven (workspace lifecycle spec 2026-09-24 §5.3 "The lane", wave 3b).
// `archivedExpiry.ts` is L1: every verdict, parser and memory step is a pure function, so every fail direction is a row
// here. The words are held to ccd's own text in both directions, as `CHILD_RECLAIM_TOKEN_KIND` is held to the RECLAIM
// region; the box words and the composition dies are read off `cmd_ws_expire` itself, and lock-unopenable's shape is
// MEASURED by running the real verb in a fixture HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CCD } from './ccdWsHelpers.js';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { EXP_ID, expireVerb, makeArchived } from './wsExpireFixture.js';
import {
  EXPIRE_FAILURE_CEILING_MS, EXPIRE_IN_USE_ATTENTION_PASSES, EXPIRE_LANE_LIVE_MARKER, EXPIRE_NO_EVIDENCE_RETRY_MS,
  EXPIRE_SHADOW_REAUDIT_MS, EXPIRE_TOKEN_KIND, archivedExpiryDue, archivedExpiryEntry, archivedExpiryEntryFor,
  archivedExpiryLearned, archivedExpiryNextEntry, archivedExpirySighted, archivedExpiryVerdict, expireAuditExpiresAt,
  EXPIRE_PRE_CRUMB_FAILED, expireTokenKind, expiryAttention, expiryInUseSentence, expiryReportSentence, keptLeafWord, parseExpireAudit, parseExpireResult, reviewKeeps,
  type ArchivedExpiryEntry, type ArchivedExpiryInput,
} from '../src/archivedExpiry.js';

const ID = 'demo-quiet-dune';
const TOK = 'a'.repeat(64);
const PASS = 60_000;
const NOW = 1_790_000_000_000;
const ccd = readFileSync(CCD, 'utf8');
const nonComment = (t: string): string => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const words = (t: string): Set<string> => new Set([
  ...[...t.matchAll(/_reap_refuse ([a-z][a-z-]*)/g)].map((m) => m[1]!),
  ...[...t.matchAll(/"refused":"([a-z][a-z-]*)"/g)].map((m) => m[1]!),
]);
const bodyOf = (name: string): string => {
  const from = ccd.indexOf(`\n${name}() {`);
  expect(from, `${name} is in ccd`).toBeGreaterThan(-1);
  return ccd.slice(from, ccd.indexOf('\n}\n', from));
};

describe('the nineteen words', () => {
  it('are exactly what ccd’s EXPIRE region and the shared ladder refuse with — harvested, both directions', () => {
    const begin = ccd.indexOf('EXPIRE-BEGIN');
    const end = ccd.indexOf('EXPIRE-END');
    expect(begin, 'the EXPIRE region is missing its BEGIN marker').toBeGreaterThan(0);
    expect(end).toBeGreaterThan(begin);
    const harvested = new Set([...words(nonComment(ccd.slice(begin, end))), ...words(nonComment(bodyOf('_ws_reclaim_ladder')))]);
    expect(harvested.size, 'guards the guard: an empty harvest would equal an empty map').toBeGreaterThan(10);
    expect([...harvested].sort()).toEqual(Object.keys(EXPIRE_TOKEN_KIND).sort());
  });

  it('the audit journals exactly the TERMINAL words — ccd’s case list equals the kind map’s terminal arm', () => {
    const matches = [...ccd.matchAll(
      /case "\$REAP_VERDICT" in\n\s+([a-z|-]+)\)\n\s+_lc_emit expire refused "\$id" "" verb ws-audit/g,
    )];
    expect(matches, 'the expiry audit no longer journals a terminal refusal, or a second site appeared').toHaveLength(1);
    const terminal = Object.entries(EXPIRE_TOKEN_KIND).filter(([, k]) => k === 'terminal').map(([t]) => t).sort();
    expect(terminal.length).toBeGreaterThan(0);
    expect(matches[0]![1]!.split('|').sort()).toEqual(terminal);
  });

  it('GONE is the row leaving the population, and nothing else', () => {
    expect(Object.entries(EXPIRE_TOKEN_KIND).filter(([, k]) => k === 'gone').map(([t]) => t).sort())
      .toEqual(['no-such-session', 'not-archived']);
  });

  it('a word this build was never compiled to know has no kind — never terminal, never gone', () => {
    expect(expireTokenKind('toString')).toBeNull();
    expect(expireTokenKind('expire-in-progress'), 'ws-reap’s word, not the expiry’s').toBeNull();
    expect(expireTokenKind('in-use')).toBe('retry');
  });

  it('the live switch is spelled once, as the file the operator touches', () => {
    expect(EXPIRE_LANE_LIVE_MARKER).toBe('expire-lane-live');
  });
});

describe('the audit document — `expiresAt` through ONE reader', () => {
  const doc = (verdict: string, extra: Record<string, unknown> = {}): string => JSON.stringify({
    session: ID, mode: 'expire', archivedAt: 1_789_000_000, expiresAt: 1_789_604_800, alive: false, exists: true,
    reaping: null, sensitive: ['.env'], verdict, detail: '', ...extra,
  });

  it('three answers, never folded: the instant, ccd saying none, and an older ccd that said nothing', () => {
    expect(expireAuditExpiresAt({ expiresAt: 1_789_604_800 })).toEqual({ kind: 'at', at: 1_789_604_800 });
    expect(expireAuditExpiresAt({ expiresAt: null })).toEqual({ kind: 'none' });
    expect(expireAuditExpiresAt({ archivedAt: 1 })).toEqual({ kind: 'absent' });
    expect(expireAuditExpiresAt({ expiresAt: '1789604800' }), 'a string is not ccd’s arithmetic').toEqual({ kind: 'none' });
    expect(expireAuditExpiresAt({ expiresAt: 1.5 })).toEqual({ kind: 'none' });
  });

  it('reads a token, the archive, the instant and how many secret-shaped paths would be dropped', () => {
    expect(parseExpireAudit(ID, true, doc('expirable', { token: TOK }))).toEqual({
      kind: 'document', archivedAt: 1_789_000_000, expiresAt: { kind: 'at', at: 1_789_604_800 }, sensitive: 1, inUse: [],
      verdict: { kind: 'expirable', token: TOK } });
  });

  it('reads a refusal by its word, and an in-use refusal’s processes', () => {
    const inUse = [{ pid: 42, comm: 'tmux: server', cwd: '/w/demo/quiet-dune' }];
    expect(parseExpireAudit(ID, true, doc('in-use', { detail: 'process 42 …', inUse }))).toMatchObject({
      kind: 'document', inUse, verdict: { kind: 'refused', token: 'in-use', detail: 'process 42 …' } });
  });

  it('an exit-1 document is never spent, whatever it says — nor another session’s, another mode’s, or an unknown word', () => {
    expect(parseExpireAudit(ID, false, doc('expirable', { token: TOK })).kind).toBe('unreadable');
    expect(parseExpireAudit('other', true, doc('expirable', { token: TOK })).kind).toBe('unreadable');
    expect(parseExpireAudit(ID, true, doc('expirable', { token: TOK, mode: 'reclaim' })).kind).toBe('unreadable');
    expect(parseExpireAudit(ID, true, doc('expirable', { token: 'short' })).kind).toBe('unreadable');
    expect(parseExpireAudit(ID, true, doc('newer-word')).kind).toBe('unreadable');
    expect(parseExpireAudit(ID, true, 'ccd: usage').kind).toBe('unreadable');
  });

  it('a document from a ccd that predates `expiresAt` reads as no evidence', () => {
    const old = JSON.parse(doc('expirable', { token: TOK })) as Record<string, unknown>;
    delete old['expiresAt'];
    const r = parseExpireAudit(ID, true, JSON.stringify(old));
    expect(r.kind === 'document' && r.expiresAt).toEqual({ kind: 'absent' });
  });
});

describe('the verb’s answer — box words told apart from composition errors (wave 3’s hand-over)', () => {
  const region = bodyOf('cmd_ws_expire');
  /** The message a ccd `die "…"` or `_lc_refuse expire "$id" <word> "…"` prints, anchored to the call. */
  const calls = (): { word: string | null; text: string }[] => {
    const re = /\bdie "((?:[^"\\]|\\.)*)"|_lc_refuse\s+expire\s+"\$id"\s+(\S+)[\s\\]*"((?:[^"\\]|\\.)*)"/g;
    return [...region.matchAll(re)].map((m) => (m[1] !== undefined ? { word: null, text: m[1] } : { word: m[2]!, text: m[3]! }));
  };

  it('every `die` before the lock is a COMPOSITION error — the server’s — save python3 missing, which is the BOX’s', () => {
    const all = calls().filter((c) => c.word === null).map((c) => c.text);
    expect(all.length, 'the usage, the token, the session id, python3, the dec flags').toBeGreaterThanOrEqual(5);
    const python = all.filter((t) => t.startsWith('python3 unavailable'));
    expect(python, 'the one die that is a fact about the box').toHaveLength(1);
    // No python3 on the box is no argv the server got wrong: a FAILURE, retried with backoff and reported past the
    // ceiling — never "the server composed a call ccd rejected", which is never asked again.
    expect(parseExpireResult(ID, '', `ccd: ${python[0]!}`)).toMatchObject({ kind: 'failed', resumable: true });
    const dies = all.filter((t) => !python.includes(t));
    for (const text of dies) {
      // A `$` in a die is `_LC_DEC_MAX`'s byte cap; render it as the box would.
      const msg = text.replace('$_LC_DEC_MAX', '1024');
      expect(parseExpireResult(ID, '', `ccd: ${msg}`), msg).toEqual({ kind: 'composition', detail: msg });
    }
  });

  it('the two `_lc_refuse` words are the two BOX words, and flock-unavailable reads as itself', () => {
    const refusals = calls().filter((c) => c.word !== null);
    expect(refusals.map((c) => c.word).sort()).toEqual(['flock-unavailable', 'lock-unopenable']);
    const flock = refusals.find((c) => c.word === 'flock-unavailable')!.text;
    expect(parseExpireResult(ID, '', `ccd: ${flock}`)).toEqual({ kind: 'box', word: 'flock-unavailable', detail: flock });
  });

  describe('lock-unopenable, measured for real', () => {
    let h: PrHarness;
    beforeEach(() => { h = makePrHarness('ccrc-expiry-policy-lockdie-'); });
    afterEach(() => { h.cleanup(); });

    it('the real verb’s stdout, stderr and exit read as the RETRYABLE box word', () => {
      makeArchived(h);
      const lock = path.join(h.home, '.cc-sessions', `.reap-${EXP_ID}.lock`);
      mkdirSync(lock, { recursive: true });
      const r = expireVerb(h, TOK);
      expect(r.code, r.stderr).toBe(1);
      expect(r.stdout, 'nothing on stdout — the shape an empty-stdout rule would misread').toBe('');
      expect(parseExpireResult(EXP_ID, r.stdout, r.stderr))
        .toEqual({ kind: 'box', word: 'lock-unopenable', detail: `cannot open the reap lock at ${lock}` });
    }, 60_000);
  });

  it('a bash line naming ANOTHER path, or trailing content, is not the box word', () => {
    expect(parseExpireResult(ID, '', '/x/ccd: line 9: /other.lock: Is a directory\nccd: cannot open the reap lock at /real.lock').kind)
      .toBe('failed');
    expect(parseExpireResult(ID, '', 'ccd: cannot open the reap lock at /real.lock\nmore').kind).toBe('failed');
  });

  it('the three documents, and an empty answer that is no die is a call cut short — resumable', () => {
    expect(parseExpireResult(ID, JSON.stringify({ expired: ID, archivedAt: 1_789_000_000, wip: null, attic: 3,
      residueBytes: 0, secretsDropped: 0 }), '')).toEqual({ kind: 'expired', archivedAt: 1_789_000_000, wip: null, secretsDropped: 0,
      kept: { clips: 'unreported', tmpRoot: 'unreported' } });
    expect(parseExpireResult(ID, JSON.stringify({ refused: 'in-use', detail: 'p', paths: [] }), ''))
      .toEqual({ kind: 'refused', token: 'in-use', detail: 'p' });
    expect(parseExpireResult(ID, JSON.stringify({ failed: 'pin-failed', detail: 'x' }), ''))
      .toEqual({ kind: 'failed', resumable: true, detail: 'pin-failed: x' });
    expect(parseExpireResult(ID, JSON.stringify({ failed: 'probe-unmeasured', detail: 'x' }), ''))
      .toEqual({ kind: 'failed', resumable: false, detail: 'probe-unmeasured: x' });
    expect(parseExpireResult(ID, '', '')).toMatchObject({ kind: 'failed', resumable: true });
    expect(parseExpireResult(ID, JSON.stringify({ expired: 'other' }), '').kind, 'another row’s expiry').toBe('failed');
  });

  it('a `failed` state-changed is printed before the breadcrumb: read `restart` (audit afresh), never final — probe-unmeasured stays final, pin-failed and tombstone-unwritable resumable (wave 5)', () => {
    expect(parseExpireResult(ID, JSON.stringify({ failed: 'state-changed', detail: 'x' }), ''))
      .toEqual({ kind: 'restart', detail: 'state-changed: x' });
    expect(parseExpireResult(ID, JSON.stringify({ failed: 'probe-unmeasured', detail: 'x' }), ''))
      .toEqual({ kind: 'failed', resumable: false, detail: 'probe-unmeasured: x' });
    expect(parseExpireResult(ID, JSON.stringify({ failed: 'tombstone-unwritable', detail: 'x' }), ''))
      .toEqual({ kind: 'failed', resumable: true, detail: 'tombstone-unwritable: x' });
    expect([...EXPIRE_PRE_CRUMB_FAILED].sort()).toEqual(['probe-unmeasured', 'state-changed']);
  });

  it('THE CENSUS: every site of either word in ccd/ccd is placed, and the expiry’s failed state-changed is on its FRESH arm, before the breadcrumb (wave 5)', () => {
    // A STOPPING LINE, not a spelling. EVERY non-comment occurrence of either word anywhere in ccd/ccd is placed: by the
    // function that holds it, and by what the line does with it — `failed` (`_ws_reclaim_fail "<id>" "<lctx>" <word>`
    // or `_ws_reclaim_failed_json <word>`), `refused` (`_reap_refuse <word>`, or a `{"refused":"<word>"` printf) or
    // `journal` (ws-audit's `_lc_fail reclaim … <word>` row). The whole list is held exactly, so a producer spelled any
    // other way — a quoted word, the word on a continuation line, a raw printf, a variable that carries it — still
    // carries the bare token, reads `unplaced`, and reds; so does a new site of a placed shape anywhere else (the
    // shared tail, a pin, a helper an expiry calls). The one shape no text scan sees is a word assembled at run time
    // from parts; ccd has none. `_ws_reclaim_locked` is ws-reclaim's own verb, which an expiry never reaches.
    //   `_ws_expire_locked`'s failed `state-changed` must lie on its FRESH arm — after `if [[ -z "$phase" ]]` and
    // before the `expire:` breadcrumb write — so nothing this verb started stands when it prints. Its
    // `probe-unmeasured` prints at the verdict point, on EVERY arm: on a fresh expiry before anything, and on a
    // RESUMED one after an earlier attempt's breadcrumb (`_ws_expire_resume_eval`'s unmeasured exits). That is main's
    // reading, a known gap routed to this programme's wave 6 (an arming blocker until then), and this census records it
    // rather than hides it.
    const fnStarts = [...ccd.matchAll(/\n([A-Za-z_][A-Za-z0-9_]*)\(\) \{/g)].map((m) => ({ name: m[1]!, at: m.index! }));
    const holder = (at: number): string => fnStarts.filter((f) => f.at < at).at(-1)?.name ?? '';
    const lockedAt = ccd.indexOf('\n_ws_expire_locked() {');
    const freshAt = ccd.indexOf('\n  if [[ -z "$phase" ]]; then', lockedAt);
    const crumbAt = ccd.indexOf('_reg_set "$id" reaping "expire:$start"', lockedAt);
    expect(lockedAt, 'the expiry\'s locked body').toBeGreaterThan(-1);
    expect(freshAt, 'its fresh arm').toBeGreaterThan(lockedAt);
    expect(crumbAt, 'its breadcrumb write, on that arm').toBeGreaterThan(freshAt);
    const shape = (w: string, pre: string): string =>
      new RegExp(`(?:_ws_reclaim_fail "[^"\\n]*" "[^"\\n]*" |_ws_reclaim_failed_json )${w}$`).test(pre) ? 'failed'
        : new RegExp(`(?:_reap_refuse |\\{"refused":")${w}$`).test(pre) ? 'refused'
          : new RegExp(`_lc_fail reclaim "[^"\\n]*" "[^"\\n]*" ${w}$`).test(pre) ? 'journal' : 'unplaced';
    const word = new RegExp(`(?<![\\w-])(${EXPIRE_PRE_CRUMB_FAILED.join('|')})(?![\\w-])`, 'g');
    const placed: string[] = [];
    let at = 0;
    for (const l of ccd.split('\n')) {
      if (!/^\s*#/.test(l)) {
        for (const m of l.matchAll(word)) {
          const w = m[1]!;
          const where = at + m.index!;
          const fn = holder(where);
          const kind = shape(w, l.slice(0, m.index! + w.length));
          if (fn === '_ws_expire_locked' && kind === 'failed' && w === 'state-changed') {
            expect(where, 'state-changed in _ws_expire_locked is not on its fresh arm').toBeGreaterThan(freshAt);
            expect(where, 'state-changed in _ws_expire_locked prints after the breadcrumb').toBeLessThan(crumbAt);
          }
          placed.push(`${fn} ${kind} ${w}`);
        }
      }
      at += l.length + 1;
    }
    expect(placed).toEqual([
      'cmd_ws_audit journal probe-unmeasured',
      '_ws_reap_locked refused state-changed',
      '_ws_reap_locked refused state-changed',
      '_ws_reap_tail refused state-changed',
      '_ws_reclaim_locked refused state-changed',
      '_ws_reclaim_locked failed probe-unmeasured',
      '_ws_reclaim_locked failed state-changed',
      '_ws_expire_resume_eval refused state-changed',
      '_ws_expire_locked refused state-changed',
      '_ws_expire_locked failed probe-unmeasured',
    ]);
  });
});

describe('archivedExpiryVerdict — every conjunct, every doubt ineligible', () => {
  const base: ArchivedExpiryInput = {
    sessionId: ID, workspace: 'ws/quiet-dune', archivedAt: 1_789_000_000, child: { kind: 'none' }, identityMeasured: true,
    held: null, store: { ok: true, openWorker: false, openClaimant: false, reviewing: false },
    expiresAt: 1_789_604_800, nowMs: 1_789_604_800_000,
  };
  it.each([
    ['a main checkout', { workspace: null }, 'not-a-workspace'],
    ['no archive', { archivedAt: null }, 'not-archived'],
    ['a marked child', { child: { kind: 'child', runId: 7 } }, 'child'],
    ['an unreadable marker', { child: { kind: 'unreadable' } }, 'child'],
    ['an unmeasured identity', { identityMeasured: false }, 'identity-unmeasured'],
    ['an unreadable store', { store: { ok: false, detail: 'x' } }, 'store-unreadable'],
    ['an open run naming it as worker', { store: { ok: true, openWorker: true, openClaimant: false, reviewing: false } }, 'open-run'],
    ['an open run naming it as claimant', { store: { ok: true, openWorker: false, openClaimant: true, reviewing: false } }, 'coordinating'],
    ['a review whose reviewed run is open', { store: { ok: true, openWorker: false, openClaimant: false, reviewing: true } }, 'review-open'],
    ['an instant nobody has read yet', { expiresAt: null }, 'expiry-unknown'],
    ['one second short of the instant', { nowMs: 1_789_604_799_999 }, 'not-yet'],
    ['held, past the instant', { held: 'program:x wave:1/2' }, 'held'],
  ] as const)('%s → %s', (_why, over, why) => {
    expect(archivedExpiryVerdict({ ...base, ...over } as ArchivedExpiryInput)).toEqual({ eligible: false, why });
  });
  it('AT the instant, with every conjunct clear, it is eligible', () => {
    expect(archivedExpiryVerdict(base)).toEqual({ eligible: true });
  });
  it('a review run keeps its row while the run it reviewed is open, unreadable or absent', () => {
    expect(reviewKeeps({ kind: 'run', state: 'working' })).toBe(true);
    expect(reviewKeeps({ kind: 'unreadable' })).toBe(true);
    expect(reviewKeeps({ kind: 'absent' })).toBe(true);
    expect(reviewKeeps({ kind: 'run', state: 'done' })).toBe(false);
    expect(reviewKeeps({ kind: 'run', state: 'failed' })).toBe(false);
  });
});

describe('the lane’s memory of one row', () => {
  const learnedDoc = (expiresAt: unknown, archivedAt = 1_789_000_000) => parseExpireAudit(ID, true, JSON.stringify({
    session: ID, mode: 'expire', archivedAt, ...(expiresAt === undefined ? {} : { expiresAt }), sensitive: [],
    verdict: 'not-expired', detail: '' }));

  it('a row returned and archived again starts a fresh entry — nothing learned about one archive applies to another', () => {
    const e = { ...archivedExpiryEntry(1_789_000_000), expiresAt: 1_789_604_800 };
    expect(archivedExpiryEntryFor(e, 1_789_000_000)).toBe(e);
    expect(archivedExpiryEntryFor(e, 1_789_500_000)).toEqual(archivedExpiryEntry(1_789_500_000));
  });

  it('learns ccd’s instant; an older ccd is no evidence, reported and asked again only after an hour', () => {
    const e = archivedExpiryEntry(1_789_000_000);
    expect(archivedExpiryLearned(e, learnedDoc(1_789_604_800), NOW, PASS))
      .toMatchObject({ expiresAt: 1_789_604_800, nextAskAt: 0 });
    expect(archivedExpiryLearned(e, learnedDoc(undefined), NOW, PASS))
      .toMatchObject({ expiresAt: null, nextAskAt: NOW + EXPIRE_NO_EVIDENCE_RETRY_MS, report: { kind: 'no-evidence' } });
    expect(archivedExpiryLearned(e, learnedDoc(null), NOW, PASS)).toMatchObject({ expiresAt: null, report: null });
    expect(archivedExpiryLearned(e, learnedDoc(1_789_604_800, 1_789_500_000), NOW, PASS),
      'an audit of a DIFFERENT archive teaches nothing').toMatchObject({ expiresAt: null, nextAskAt: NOW + PASS });
  });

  it('an older ccd’s not-expired audit of a young archive (archivedAt null, no expiresAt key) is no evidence, not a failure', () => {
    // That ccd prints archivedAt only after its seven-day age check, and prints no expiresAt at all: the document is
    // told apart from the reap-in-progress breadcrumb (expiresAt: null) by the ABSENT key, and only an upgrade fixes it.
    const e = archivedExpiryEntry(1_789_000_000);
    const young = parseExpireAudit(ID, true, JSON.stringify({ session: ID, mode: 'expire', archivedAt: null, sensitive: [],
      verdict: 'not-expired', detail: 'archived 3600 seconds ago; 7 days are required' }));
    const r = archivedExpiryLearned(e, young, NOW, PASS);
    expect(r).toMatchObject({ expiresAt: null, failures: 0, failingSince: null, nextAskAt: NOW + EXPIRE_NO_EVIDENCE_RETRY_MS,
      report: { kind: 'no-evidence', at: NOW } });
    const failing = archivedExpiryLearned(e, { kind: 'unreadable', detail: 'x' }, NOW, PASS);
    expect(archivedExpiryLearned(failing, young, NOW + 2 * PASS, PASS), 'a failure run before it is cleared')
      .toMatchObject({ failures: 0, failingSince: null, report: { kind: 'no-evidence' } });
  });

  it('a learn audit that cannot be read, or that read NO archive, backs off and is REPORTED (review 313, parked item 1)', () => {
    // Such a row was asked again every pass, with no backoff and no attention entry — invisible in the shadow record,
    // which is the operator's arming evidence. It now climbs the failure ladder, and the list says why.
    const e = archivedExpiryEntry(1_789_000_000);
    const unread = archivedExpiryLearned(e, { kind: 'unreadable', detail: 'ws-audit --expire printed no JSON document' }, NOW, PASS);
    expect(unread).toMatchObject({ expiresAt: null, failures: 1, failingSince: NOW, nextAskAt: NOW + 2 * PASS });
    expect(unread.report).toEqual({ kind: 'failing', at: NOW,
      detail: 'its expiry could not be learned — ws-audit --expire printed no JSON document' });
    const again = archivedExpiryLearned(unread, { kind: 'unreadable', detail: 'x' }, NOW + 2 * PASS, PASS);
    expect(again).toMatchObject({ failures: 2, failingSince: NOW, nextAskAt: NOW + 2 * PASS + 4 * PASS });
    expect(again.report?.at, 'since when, kept').toBe(NOW);
    // A refusal ccd answered before it read the stamp — an interrupted ws-reap's breadcrumb — names no archive.
    const crumb = parseExpireAudit(ID, true, JSON.stringify({ session: ID, mode: 'expire', archivedAt: null, expiresAt: null,
      sensitive: [], verdict: 'reap-in-progress', detail: 'an interrupted ws-reap stands' }));
    const r = archivedExpiryLearned(e, crumb, NOW, PASS);
    expect(r).toMatchObject({ failures: 1, nextAskAt: NOW + 2 * PASS });
    expect(r.report).toEqual({ kind: 'failing', at: NOW,
      detail: 'its expiry could not be learned — ws-audit --expire read no archive (reap-in-progress: an interrupted ws-reap stands)' });
  });

  it('a learn that succeeds after failing clears the run and its report; a row that left the archive is not reported', () => {
    const failing = archivedExpiryLearned(archivedExpiryEntry(1_789_000_000), { kind: 'unreadable', detail: 'x' }, NOW, PASS);
    expect(archivedExpiryLearned(failing, learnedDoc(1_789_604_800), NOW + 2 * PASS, PASS))
      .toMatchObject({ expiresAt: 1_789_604_800, failures: 0, failingSince: null, report: null });
    const returned = parseExpireAudit(ID, true, JSON.stringify({ session: ID, mode: 'expire', archivedAt: null, expiresAt: null,
      sensitive: [], verdict: 'not-archived', detail: '' }));
    expect(archivedExpiryLearned(archivedExpiryEntry(1_789_000_000), returned, NOW, PASS),
      'a return: the next pass drops the row').toMatchObject({ failures: 0, report: null, nextAskAt: NOW + PASS });
  });

  it('twice observed: an eligible pass seeds, a later one makes it due, and any other verdict ends the run', () => {
    const e0 = { ...archivedExpiryEntry(1_789_000_000), expiresAt: 1_789_604_800 };
    const e1 = archivedExpirySighted(e0, { eligible: true }, null, NOW);
    expect(archivedExpiryDue(e1, NOW), 'not on the first sighting').toBe(false);
    const e2 = archivedExpirySighted(e1, { eligible: true }, null, NOW + PASS);
    expect(archivedExpiryDue(e2, NOW + PASS)).toBe(true);
    const e3 = archivedExpirySighted(e2, { eligible: false, why: 'open-run' }, null, NOW + 2 * PASS);
    expect(archivedExpiryDue(e3, NOW + 2 * PASS)).toBe(false);
    expect(e3.eligibleSince).toBeNull();
  });

  it('an ineligible sighting clears a would-expire or in-use report as well as a held one (review 313, F1)', () => {
    // The shadow record is the operator's arming evidence: a row that stopped being eligible (a run bound it, a review
    // opened, its identity went unmeasured) is never due again, so a report it kept would never be revisited.
    const inUse = [{ pid: 7, comm: 'sleep', cwd: '/w' }];
    const reports = [{ kind: 'would-expire', at: NOW, sensitive: 0 }, { kind: 'in-use', at: NOW, inUse, passes: 3 }] as const;
    for (const report of reports) {
      const x = { ...archivedExpiryEntry(1_789_000_000), expiresAt: 1_789_604_800, eligibleSince: NOW, inUseRun: 3, inUse, report };
      const y = archivedExpirySighted(x, { eligible: false, why: 'open-run' }, null, NOW + PASS);
      expect(y.report, report.kind).toBeNull();
      expect(y.inUseRun, `${report.kind}: the run of in-use answers ends with it`).toBe(0);
      expect(archivedExpirySighted(x, { eligible: true }, null, NOW + PASS).report, `${report.kind}, still eligible`).toEqual(report);
    }
    const refused = { ...archivedExpiryEntry(1), report: { kind: 'refused', at: NOW, token: 'containment-unproven', detail: '' } } as const;
    expect(archivedExpirySighted(refused, { eligible: false, why: 'open-run' }, null, NOW).report, 'the box’s own verdict stands')
      .toEqual(refused.report);
  });

  it('the held sentence names the instant, never a period — the threshold is ccd’s (review 313, F3)', () => {
    const s = expiryReportSentence({ kind: 'held', at: NOW, reason: 'program:x wave:1/2' }, 1_789_604_800);
    expect(s).toBe('held (“program:x wave:1/2”) past its expiry (due 2026-09-17 00:26 UTC), so it is not cleaned up — '
      + 'release the hold or restore it.');
  });

  it('held past its instant is REPORTED with its reason, and the report goes with the hold', () => {
    const e0 = archivedExpiryEntry(1_789_000_000);
    const held = archivedExpirySighted(e0, { eligible: false, why: 'held' }, 'program:x wave:1/2', NOW);
    expect(held.report).toEqual({ kind: 'held', at: NOW, reason: 'program:x wave:1/2' });
    expect(archivedExpirySighted(held, { eligible: false, why: 'held' }, 'program:x wave:1/2', NOW + PASS).report?.at,
      'since when, kept').toBe(NOW);
    expect(archivedExpirySighted(held, { eligible: true }, null, NOW + PASS).report).toBeNull();
  });

  it('a hold never hides a row the lane has stopped asking: its report survives the hold and the release after it', () => {
    // The report is such a row's only trace on the attention list — it is never asked again, so nothing would put it
    // back once a hold replaced it and the release cleared that.
    const base = { ...archivedExpiryEntry(1_789_000_000), expiresAt: 1_789_604_800, eligibleSince: NOW - PASS };
    const stopped = [
      ['a non-resumable failure', { kind: 'failed', resumable: false, detail: 'ws-expire reported expiring demo-other' }],
      ['a composition error', { kind: 'composition', detail: 'bad token' }],
      ['a terminal refusal', { kind: 'refused', token: 'containment-unproven', detail: 'x', inUse: [] }],
    ] as const;
    for (const [what, outcome] of stopped) {
      const x = archivedExpiryNextEntry(base, outcome, NOW, PASS)!;
      expect(x.nextAskAt, `${what}: never asked again`).toBe(Number.POSITIVE_INFINITY);
      const held = archivedExpirySighted(x, { eligible: false, why: 'held' }, 'program:x wave:1/2', NOW + PASS);
      expect(held.report, `${what}: kept while held`).toEqual(x.report);
      const released = archivedExpirySighted(held, { eligible: true }, null, NOW + 2 * PASS);
      expect(released.report, `${what}: kept after the release`).toEqual(x.report);
      expect(released.nextAskAt, `${what}: still never asked`).toBe(Number.POSITIVE_INFINITY);
      expect(archivedExpirySighted(held, { eligible: false, why: 'open-run' }, null, NOW + 2 * PASS).report,
        `${what}: kept through an ineligible sighting too`).toEqual(x.report);
    }
    // Unchanged: a resumable failing report is still replaced by a hold, and goes with it.
    const failing = { ...base, report: { kind: 'failing', at: NOW, detail: 'pin-failed' } } as const;
    const heldFailing = archivedExpirySighted(failing, { eligible: false, why: 'held' }, 'program:x wave:1/2', NOW);
    expect(heldFailing.report).toMatchObject({ kind: 'held' });
    expect(archivedExpirySighted(heldFailing, { eligible: true }, null, NOW + PASS).report).toBeNull();
  });

  it('a hold that REPLACES a would-expire, in-use or retryable failing report resets nextAskAt, so the row is re-audited as soon as it is due after the release', () => {
    // The hold ends the report the shadow list showed, and the release clears the hold's own: left at the old shadow
    // wait (or the failure's backoff) the row would be unlisted and not due for up to an hour — absent from the list
    // the operator arms on.
    const inUse = [{ pid: 7, comm: 'sleep', cwd: '/w' }];
    const WAIT = NOW + 15 * 60_000;
    const replaced = [
      ['would-expire', { kind: 'would-expire', at: NOW, sensitive: 0 }],
      ['in-use', { kind: 'in-use', at: NOW, inUse, passes: 2 }],
      ['a retryable failing', { kind: 'failing', at: NOW, detail: 'pin-failed' }],
    ] as const;
    for (const [what, report] of replaced) {
      const x = { ...archivedExpiryEntry(1_789_000_000), expiresAt: 1_789_604_800, eligibleSince: NOW - PASS, nextAskAt: WAIT, inUseRun: 2, inUse, report };
      const held = archivedExpirySighted(x, { eligible: false, why: 'held' }, 'program:x wave:1/2', NOW + PASS);
      expect(held.report, what).toMatchObject({ kind: 'held' });
      expect(held.nextAskAt, `${what}: the wait goes with the report it ended`).toBe(0);
      const e1 = archivedExpirySighted(held, { eligible: true }, null, NOW + 2 * PASS);
      expect(e1.report, `${what}: the release clears the hold`).toBeNull();
      expect(archivedExpiryDue(e1, NOW + 2 * PASS), `${what}: sighted once, not yet due`).toBe(false);
      const e2 = archivedExpirySighted(e1, { eligible: true }, null, NOW + 3 * PASS);
      expect(archivedExpiryDue(e2, NOW + 3 * PASS), `${what}: due on the second eligible pass after the release`).toBe(true);
    }
    // Held again and again, or never replacing anything, changes no wait; a final report keeps its infinite one.
    const plain = { ...archivedExpiryEntry(1), nextAskAt: WAIT };
    expect(archivedExpirySighted(plain, { eligible: false, why: 'held' }, 'r', NOW).nextAskAt, 'nothing replaced: the wait stands').toBe(WAIT);
    const final = { ...archivedExpiryEntry(1), nextAskAt: Number.POSITIVE_INFINITY, report: { kind: 'failing', at: NOW, detail: 'x', final: true } } as const;
    expect(archivedExpirySighted(final, { eligible: false, why: 'held' }, 'r', NOW).nextAskAt, 'a final report is kept, wait and all').toBe(Number.POSITIVE_INFINITY);
  });

  const e = (over: Partial<ArchivedExpiryEntry> = {}): ArchivedExpiryEntry =>
    ({ ...archivedExpiryEntry(1_789_000_000), expiresAt: 1_789_604_800, eligibleSince: NOW - PASS, ...over });

  it('keptLeafWord is the ONE word reader of a kept leaf: ccd’s three words are themselves, any other value is a leaf that stood (wave 5)', () => {
    for (const w of ['refused', 'unmeasured', 'in-use'] as const) expect(keptLeafWord(w)).toBe(w);
    for (const v of ['gone-sideways', '', 'IN-USE', ' in-use', 7, true, null, {}, []]) expect(keptLeafWord(v), JSON.stringify(v)).toBe('unmeasured');
  });

  it('THE KEPT-LEAF READER: clipsKept and tmpRootKept are read by name — a word, null, or ABSENT (an older ccd: unreported, never null) (wave 5)', () => {
    const doc = (over: Record<string, unknown>): string => JSON.stringify({ expired: ID, archivedAt: 1_789_000_000, wip: null, secretsDropped: 0, ...over });
    const kept = (over: Record<string, unknown>) => (parseExpireResult(ID, doc(over), '') as { kept?: unknown }).kept;
    expect(kept({ clipsKept: null, tmpRootKept: null })).toEqual({ clips: null, tmpRoot: null });
    expect(kept({ clipsKept: 'in-use', tmpRootKept: 'refused' })).toEqual({ clips: 'in-use', tmpRoot: 'refused' });
    expect(kept({ clipsKept: 'unmeasured', tmpRootKept: null })).toEqual({ clips: 'unmeasured', tmpRoot: null });
    expect(kept({}), 'an older ccd says nothing — never "removed"').toEqual({ clips: 'unreported', tmpRoot: 'unreported' });
    expect(kept({ clipsKept: 'gone-sideways', tmpRootKept: 7 }), 'a value this build does not know is a KEPT leaf').toEqual({ clips: 'unmeasured', tmpRoot: 'unmeasured' });
    // A kept word is reported, and never asked again; an older ccd's silence finishes the row like a clean expiry.
    const k = archivedExpiryNextEntry(e(), { kind: 'expired', kept: { clips: 'in-use', tmpRoot: null } }, NOW, PASS)!;
    expect(k).toMatchObject({ nextAskAt: Number.POSITIVE_INFINITY, report: { kind: 'kept', at: NOW, clips: 'in-use', tmpRoot: null } });
    expect(expiryReportSentence(k.report!, null)).toBe('cleaned up, but ccd kept its clips directory (in-use: a process still used it after '
      + 'the bounded wait). The worktree, the branch and the registry row are gone and its commits are in the attic; what was kept '
      + 'stays on disk, and the lane deletes nothing more of it. Find out what holds it before removing it by hand.');
    expect(archivedExpiryNextEntry(e(), { kind: 'expired', kept: { clips: null, tmpRoot: 'in-use' } }, NOW, PASS),
      'a temp root kept on its own is listed too').toMatchObject({ nextAskAt: Number.POSITIVE_INFINITY,
      report: { kind: 'kept', clips: null, tmpRoot: 'in-use' } });
    expect(archivedExpiryNextEntry(e(), { kind: 'expired', kept: { clips: 'unreported', tmpRoot: 'unreported' } }, NOW, PASS),
      'the rollout skew raises no alarm').toBeNull();
    expect(archivedExpirySighted(k, { eligible: false, why: 'held' }, 'x', NOW + PASS).report, 'a hold never takes its place').toEqual(k.report);
  });

  it('expired and gone finish the row; a terminal refusal and a composition error are never asked again, and reported', () => {
    expect(archivedExpiryNextEntry(e(), { kind: 'expired', kept: { clips: null, tmpRoot: null } }, NOW, PASS)).toBeNull();
    expect(archivedExpiryNextEntry(e(), { kind: 'gone' }, NOW, PASS)).toBeNull();
    expect(archivedExpiryNextEntry(e(), { kind: 'refused', token: 'not-archived', detail: '', inUse: [] }, NOW, PASS)).toBeNull();
    const t = archivedExpiryNextEntry(e(), { kind: 'refused', token: 'containment-unproven', detail: 'd', inUse: [] }, NOW, PASS)!;
    expect(t.nextAskAt).toBe(Number.POSITIVE_INFINITY);
    expect(t.report).toMatchObject({ kind: 'refused', token: 'containment-unproven' });
    const c = archivedExpiryNextEntry(e(), { kind: 'composition', detail: 'bad token' }, NOW, PASS)!;
    expect(c.nextAskAt).toBe(Number.POSITIVE_INFINITY);
    expect(c.report).toMatchObject({ kind: 'failing' });
  });

  it('a failed state-changed (`restart`) starts over: the instant and the sightings are forgotten and learned afresh — no report, never final (wave 5)', () => {
    // The coordinator's ruling on the wave-5 plan's question (h): the reclaim side's "not resumable" means start over.
    // Nothing was deleted, so nothing is listed; a run of failures before it is about a state that no longer stands.
    const failing = archivedExpiryNextEntry(e(), { kind: 'failed', resumable: true, detail: 'pin-failed' }, NOW - EXPIRE_FAILURE_CEILING_MS, PASS)!;
    const x = archivedExpiryNextEntry({ ...failing, report: { kind: 'failing', at: NOW - EXPIRE_FAILURE_CEILING_MS, detail: 'pin-failed' } },
      { kind: 'restart', detail: 'state-changed: moved' }, NOW, PASS)!;
    expect(x).toMatchObject({ expiresAt: null, eligibleSince: null, nextAskAt: NOW + PASS, report: null, failures: 0,
      failingSince: null, lastOutcome: 'restart' });
    expect(archivedExpiryDue(x, NOW + PASS), 'not due: it is learned again first').toBe(false);
  });

  it('a `not-expired` at the act learns the AUDIT’s instant and starts the twice-observed rule again', () => {
    // The threshold was raised after the lane learned the old instant (§9's lever): the row is not asked every pass
    // on the stale one — it waits for the new instant, and is seen eligible twice again from there.
    const raised = 1_789_000_000 + 2 * 604_800;
    const x = archivedExpiryNextEntry(e(), { kind: 'refused', token: 'not-expired', detail: '', inUse: [], auditExpiresAt: raised }, NOW, PASS)!;
    expect(x).toMatchObject({ expiresAt: raised, eligibleSince: null, report: null });
    const unknown = archivedExpiryNextEntry(e(), { kind: 'refused', token: 'not-expired', detail: '', inUse: [] }, NOW, PASS)!;
    expect(unknown.expiresAt, 'no instant given: learned afresh').toBeNull();
  });

  it('a pause or a missing verb only the EXECUTOR saw forgets the sighting; any other deferral keeps it', () => {
    // The tick's listing forgets sightings when it shows `reclaim-paused`; a switch raised and lowered inside one
    // cadence window is seen by the executor alone, and must forget them too — a lowered switch needs two FRESH passes.
    for (const why of ['paused-at-server', 'unsupported'] as const) {
      const x = archivedExpiryNextEntry(e(), { kind: 'deferred', why, detail: 'd' }, NOW, PASS)!;
      expect(x.eligibleSince, why).toBeNull();
      expect(x.nextAskAt, why).toBe(NOW + PASS);
    }
    expect(archivedExpiryNextEntry(e(), { kind: 'deferred', why: 'open-run', detail: 'd' }, NOW, PASS)!.eligibleSince,
      'a deferral the box did not raise keeps its sighting').toBe(NOW - PASS);
  });

  it('in-use is asked again every pass, and REPORTED once it has stood the bounded number of passes', () => {
    const inUse = [{ pid: 7, comm: 'tmux: server', cwd: '/w' }];
    let x = e();
    for (let k = 1; k < EXPIRE_IN_USE_ATTENTION_PASSES; k += 1) {
      x = archivedExpiryNextEntry(x, { kind: 'refused', token: 'in-use', detail: '', inUse }, NOW + k * PASS, PASS)!;
      expect(x.report, `not after ${k}`).toBeNull();
      expect(x.nextAskAt).toBe(NOW + (k + 1) * PASS);
    }
    x = archivedExpiryNextEntry(x, { kind: 'refused', token: 'in-use', detail: '', inUse }, NOW + 9 * PASS, PASS)!;
    expect(x.report).toMatchObject({ kind: 'in-use', inUse, passes: EXPIRE_IN_USE_ATTENTION_PASSES });
    expect(archivedExpiryNextEntry(x, { kind: 'refused', token: 'held', detail: '', inUse: [] }, NOW + 10 * PASS, PASS)!.inUseRun,
      'any other answer ends the run').toBe(0);
  });

  it('a failure backs off, and is reported once the run of failures has lasted the ceiling', () => {
    let x = e();
    x = archivedExpiryNextEntry(x, { kind: 'failed', resumable: true, detail: 'pin-failed' }, NOW, PASS)!;
    expect(x.nextAskAt).toBe(NOW + 2 * PASS);
    expect(x.report).toBeNull();
    x = archivedExpiryNextEntry(x, { kind: 'failed', resumable: true, detail: 'pin-failed' }, NOW + EXPIRE_FAILURE_CEILING_MS, PASS)!;
    expect(x.report).toMatchObject({ kind: 'failing', at: NOW });
  });

  it('a failure the box says will NOT resume stops at once: reported, never asked again for this archive (review 313, parked item 4)', () => {
    // `ExpireVerbRead.failed.resumable` is carried through the outcome, never narrowed: a wrong-row `expired`, a word
    // this build does not know, or `probe-unmeasured` is not something waiting cures — no hour of retries first.
    const detail = 'ws-expire reported expiring demo-other, not demo-quiet-dune';
    const x = archivedExpiryNextEntry(e(), { kind: 'failed', resumable: false, detail }, NOW, PASS)!;
    expect(x.nextAskAt).toBe(Number.POSITIVE_INFINITY);
    expect(x.report).toEqual({ kind: 'failing', at: NOW, detail, final: true });
    expect(expiryReportSentence(x.report!, null)).toBe(`cleanup stopped: ${detail}. It is not asked again for this archive.`);
    const c = archivedExpiryNextEntry(e(), { kind: 'composition', detail: 'bad token' }, NOW, PASS)!;
    expect(expiryReportSentence(c.report!, null), 'a composition error is never retried either, and says so')
      .toBe('cleanup stopped: the server composed a call ccd rejected: bad token. It is not asked again for this archive.');
  });

  it('a box word is reported at once — flock-unavailable will not pass by waiting', () => {
    const x = archivedExpiryNextEntry(e(), { kind: 'box', word: 'flock-unavailable', detail: 'flock …' }, NOW, PASS)!;
    expect(x.report).toMatchObject({ kind: 'failing' });
  });

  it('in shadow, "would expire" is recorded — and the row is audited again only after the shadow interval', () => {
    const x = archivedExpiryNextEntry(e(), { kind: 'would-expire', sensitive: 2 }, NOW, PASS)!;
    expect(x.report).toEqual({ kind: 'would-expire', at: NOW, sensitive: 2 });
    expect(x.nextAskAt).toBe(NOW + EXPIRE_SHADOW_REAUDIT_MS);
  });
});

describe('the attention list, and the words that never tell an operator to end a pid they cannot name', () => {
  it('names the pid, its command and the path — and warns that the fleet’s own tmux server is a `tmux: server` too', () => {
    const s = expiryInUseSentence([{ pid: 3453108, comm: 'tmux: server', cwd: '/home/u/worktrees/p/brisk-mesa' }], 3);
    expect(s).toContain('process 3453108 (“tmux: server”) in /home/u/worktrees/p/brisk-mesa');
    expect(s).toContain('Find out what it is before ending it');
    expect(s).toContain('the fleet’s own tmux server is also a “tmux: server”');
    expect(s).not.toMatch(/\bkill\b/i);
  });

  it('a command the box could not read is said so — never a bare pid', () => {
    expect(expiryInUseSentence([{ pid: 9, comm: '', cwd: '/w' }], 3)).toContain('process 9 (its command could not be read) in /w');
  });

  it('lists every reported row, newest first, and nothing for a row with no report', () => {
    const m = new Map<string, ArchivedExpiryEntry>([
      ['a', { ...archivedExpiryEntry(1), report: { kind: 'would-expire', at: 10, sensitive: 0 } }],
      ['b', { ...archivedExpiryEntry(2), report: { kind: 'held', at: 20, reason: 'r' } }],
      ['c', archivedExpiryEntry(3)],
    ]);
    expect(expiryAttention(m).map((a) => [a.sessionId, a.kind])).toEqual([['b', 'held'], ['a', 'would-expire']]);
  });
});

describe('L1', () => {
  it('imports L0 alone — no node:, no fs, no fastify', () => {
    const src = readFileSync(path.join(path.dirname(CCD), '..', 'server', 'src', 'archivedExpiry.ts'), 'utf8');
    const froms = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(froms).toEqual(['../../shared/api.js']);
  });
});
