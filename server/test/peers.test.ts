// D9's ladder, pure: the STRUCTURAL rungs of sweepMail's own gate — registry
// measured -> tmux verdict -> pane pid -> lifecycle — with the transient
// rungs (cooldown, latch, ask, quiet) deliberately absent, because reporting
// lane state here would tell a caller a BUSY peer is unreachable, the exact
// lie R2 forbids. Task 10 drives this ladder and sweepMail's real one over a
// single fixture table; THIS file pins the rungs one fixture row cannot
// state coherently (a lifecycle verdict the earlier rungs would pre-empt).
import { describe, it, expect } from 'vitest';
import type { SessionLifecycle } from '../../shared/api.js';
import { archiveContradicted, peerDeliverable, type PeerProbe } from '../src/coord/peers.js';
import { DEAD_LIFECYCLES, lifecycleIsDead } from '../../shared/api.js';

const probe = (over: Partial<PeerProbe> = {}): PeerProbe => ({
  registry: 'measured', tmux: 'live', panePid: 4242, lifecycle: 'running', ...over,
});

describe('peerDeliverable: the ladder, rung by rung', () => {
  it('a measured, live, running peer is yes', () => {
    expect(peerDeliverable(probe())).toBe('yes');
  });

  it('rung 1 — no registry row is proven absence: no:not-in-registry', () => {
    expect(peerDeliverable(probe({ registry: 'absent' }))).toBe('no:not-in-registry');
  });

  it("rung 1 — an unmeasurable registry row is 'unknown', and 'unknown' is not 'no' (D9)", () => {
    expect(peerDeliverable(probe({ registry: 'unmeasurable' }))).toBe('unknown');
  });

  it('rung 2 — tmux proving the session gone is no:session-gone', () => {
    expect(peerDeliverable(probe({ tmux: 'gone' }))).toBe('no:session-gone');
  });

  it("rung 2 — tmux NOT ANSWERING is 'unknown', never 'no' — the substrate-unreachable stance", () => {
    expect(peerDeliverable(probe({ tmux: 'unknown' }))).toBe('unknown');
  });

  it('rung 3 — a live session with no pane pid is no:no-pane (nothing to inject into)', () => {
    expect(peerDeliverable(probe({ panePid: null }))).toBe('no:no-pane');
  });

  it('rung 4 — the three dead lifecycles answer no, each naming its own word', () => {
    expect(peerDeliverable(probe({ lifecycle: 'stopped' }))).toBe('no:stopped');
    expect(peerDeliverable(probe({ lifecycle: 'orphan' }))).toBe('no:orphan');
    expect(peerDeliverable(probe({ lifecycle: 'never-started' }))).toBe('no:never-started');
  });

  it("rung 4 — an unmeasurable lifecycle is 'unknown'", () => {
    expect(peerDeliverable(probe({ lifecycle: 'unmeasurable' }))).toBe('unknown');
  });

  it('rung 4 — unsupervised, unclaimed and restarting are all still deliverable: a mail lands in the pane, not in the supervisor', () => {
    for (const l of ['unsupervised', 'unclaimed', 'restarting'] as const) {
      expect(peerDeliverable(probe({ lifecycle: l }))).toBe('yes');
    }
  });

  it('the ladder answers IN ORDER — an earlier rung pre-empts a later one, matching sweepMail', () => {
    // registry beats tmux: sweepMail's identity===null branch continues
    // before sessionVerdict ever runs (watch.ts:1991-2054 vs :2069).
    expect(peerDeliverable(probe({ registry: 'absent', tmux: 'gone' }))).toBe('no:not-in-registry');
    // tmux beats pid and lifecycle.
    expect(peerDeliverable(probe({ tmux: 'gone', panePid: null, lifecycle: 'stopped' })))
      .toBe('no:session-gone');
  });
});

describe('archiveContradicted: the archived-but-live predicate (D9)', () => {
  it('an archived stamp on a row whose lifecycle says it is alive is the contradiction', () => {
    for (const l of ['running', 'unsupervised', 'unclaimed', 'restarting'] as const) {
      expect(archiveContradicted(1_755_000_000, l)).toBe(true);
    }
  });

  it('an archived stamp on a genuinely dead row is consistent', () => {
    for (const l of ['stopped', 'orphan', 'never-started'] as const) {
      expect(archiveContradicted(1_755_000_000, l)).toBe(false);
    }
  });

  it('an UNMEASURABLE row contradicts nothing — doubt is not evidence', () => {
    expect(archiveContradicted(1_755_000_000, 'unmeasurable')).toBe(false);
  });

  it('no stamp, no contradiction — whatever the lifecycle says', () => {
    const all: readonly SessionLifecycle[] = [
      'running', 'unsupervised', 'unclaimed', 'stopped', 'restarting',
      'orphan', 'never-started', 'unmeasurable',
    ];
    for (const l of all) expect(archiveContradicted(null, l)).toBe(false);
  });
});

// THE TWO TABLES MUST AGREE, and this is the mechanism rather than the comment
// that says so.
//
// `LIFECYCLE_RUNG` (peers.ts) maps a lifecycle to a PEER's deliverability, with
// three answers — `unmeasurable` is `unknown`, not `no`. `LIFECYCLE_DEAD`
// (shared/api.ts, added for D-309's refinement) asks a narrower yes/no about the
// WORD: does it ever resolve on its own? They are deliberately different
// questions on the same vocabulary, and exactly one relationship must hold —
// the words `LIFECYCLE_RUNG` answers `no` for are precisely the dead ones.
//
// Without this, a ninth SessionLifecycle member added to both tables with
// different verdicts would leave `GET /api/peers` calling a session unreachable
// while `sweepMail` kept its mail waiting for ever, or the reverse: parking mail
// for a session the peers route still calls deliverable. Both are silent.
describe('LIFECYCLE_DEAD and peerDeliverable agree on which words are dead', () => {
  const ALL: SessionLifecycle[] = [
    'running', 'unsupervised', 'unclaimed', 'restarting',
    'stopped', 'orphan', 'never-started', 'unmeasurable',
  ];

  it('every dead word is exactly a `no:` from the peers ladder, and no other word is', () => {
    // The rung is reached only once the structural gates above it pass, so the
    // probe is built live/measured/with-a-pid and lifecycle is the sole variable.
    for (const lc of ALL) {
      const verdict = peerDeliverable(probe({ lifecycle: lc }));
      const rungSaysNo = verdict.startsWith('no:');
      expect(rungSaysNo, `'${lc}': peers says ${verdict}, LIFECYCLE_DEAD says ${lifecycleIsDead(lc)}`)
        .toBe(lifecycleIsDead(lc));
    }
  });

  it('names the three, so a change to either table has to be typed here too', () => {
    expect([...DEAD_LIFECYCLES].sort()).toEqual(['never-started', 'orphan', 'stopped']);
  });

  it('does NOT call `unmeasurable` dead — doubt is not evidence', () => {
    // The rule the registry rung already draws one gate up: a read that failed
    // must never park a delivery. If this ever flips, an agent-WS round trip
    // dropping one lifecycle field would start parking live sessions' mail.
    expect(lifecycleIsDead('unmeasurable')).toBe(false);
    expect(peerDeliverable(probe({ lifecycle: 'unmeasurable' }))).toBe('unknown');
  });
});
