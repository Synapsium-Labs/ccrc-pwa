// The disaster-recovery drill (spec §2).
//
// coord.db is the first artifact in this system whose loss is not free, and the
// stated mitigation is that it is not the only record: the program ledger
// (markdown, committed), the registry (on the fleet host) and `.prhistory`
// (append-only, on the fleet host) between them still say what happened. This
// test is the proof, and it is a test about the ARTIFACTS, not about any code:
//
//   * the reconstruction procedure below lives HERE and ships nowhere. The
//     ledger is "for humans and parsed by nothing" (spec §7), and
//     single-definition.test.ts enforces that no non-comment line under
//     server/src reads it off disk.
//   * what it CANNOT recover is asserted by name, against reconstruct()'s own
//     OUTPUT, so nobody can read this as a claim that the DB is redundant.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import type { RunSummary } from '../../shared/api.js';

const fx = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/reconstruct');

/** A copy of the fixture tree with one file removed — the shape a real
 *  disaster (or a released hold) actually leaves behind. `mkTmp` owns cleanup. */
function copyFixtureWithout(dir: string, relPath: string): string {
  const out = mkTmp('ccrc-reconstruct-');
  cpSync(dir, out, { recursive: true });
  rmSync(path.join(out, relPath), { force: true });
  return out;
}

/** A copy of the fixture tree with one file's content replaced — the shape a
 *  stale hold left behind (registry.ts:27: display-only, and PR I's own
 *  close path rewrites it under the NEXT wave's reason before the ledger
 *  catches up, so disagreement between hold and ledger is an ordinary,
 *  expected state, not a corrupted one). `mkTmp` owns cleanup. */
function copyFixtureWith(dir: string, relPath: string, content: string): string {
  const out = mkTmp('ccrc-reconstruct-');
  cpSync(dir, out, { recursive: true });
  writeFileSync(path.join(out, relPath), content);
  return out;
}

interface Reconstructed {
  program: string; sessionId: string; workspace: string; branch: string; project: string;
  currentWave: number; waves: number;
  perWave: { wave: number; prs: number[]; state: string }[];
  confidence: 'hold-corroborated' | 'ledger-only';
  // The registry's live PR (the one open right now) and its phase, once
  // corroborated against the ledger below — reconstruct()'s answer to
  // "which PR is open right now", the question finding 6's own fix round
  // said this step exists to check. `null` when the registry carries no
  // `.prnumber` at all (e.g. the workspace was already cleared).
  currentPr: { number: number; phase: string | null } | null;
}

/** The written procedure, executed. Read it as prose: this is what a human, or
 *  a fresh session, does with the three artifacts and no database. */
function reconstruct(dir: string): Reconstructed {
  const ledger = readFileSync(path.join(dir, 'ledger.md'), 'utf8');

  // 1. The program's identity and its workspace come off the ledger's header —
  //    the two facts the file exists to carry across sessions.
  const program = /^# Program: (\S+)/m.exec(ledger)![1]!;
  const sessionId = /Workspace: (\S+)/.exec(ledger)![1]!;

  // 2. The wave table gives scope, PRs and state per wave. `—` means no PR was
  //    opened for that wave yet; it is not zero and it is not unknown.
  const perWave = [...ledger.matchAll(/^\| (\d+) \| [^|]+\| ([^|]+)\| ([^|]+)\|/gm)].map((m) => ({
    wave: Number(m[1]),
    prs: [...m[2]!.matchAll(/#(\d+)/g)].map((p) => Number(p[1])),
    state: m[3]!.trim(),
  }));
  // The ledger's own answer for "where are we" — computed unconditionally, so
  // it is available both as the ledger-only result AND as the value the hold
  // (below) is corroborated against, never trusted in place of it.
  const ledgerCurrentWave = perWave.filter((w) => w.state === 'merged').length + 1;
  const ledgerWaves = perWave.length;

  // 3. The registry says where the work physically is, and — while the hold is
  //    still on — which wave the program had reached. The hold reason is
  //    display-only by contract (registry.ts:27); reading it HERE is a
  //    disaster-recovery act by a human, not a parser in the running system.
  //    It is corroborated against the ledger rather than trusted: PR I's own
  //    close path re-holds a workspace under the NEXT wave's reason before
  //    the ledger for that wave necessarily exists, so a hold that disagrees
  //    with the ledger is an ordinary state at a wave boundary, not proof of
  //    corruption — and 'hold-corroborated' must not be the label for it.
  const reg = (field: string): string | null => {
    const f = path.join(dir, 'registry', `${sessionId}.${field}`);
    return readdirSync(path.join(dir, 'registry')).includes(path.basename(f))
      ? readFileSync(f, 'utf8').trim() : null;
  };
  const hold = reg('hold');
  const m = hold === null ? null : /wave:(\d+)\/(\d+)/.exec(hold);
  const holdAgrees = m !== null && Number(m[1]) === ledgerCurrentWave && Number(m[2]) === ledgerWaves;

  // 4. `.prhistory` is append-only, and ccd writes to it only when a NEW pr
  //    number SUPERSEDES an old one for this workspace (ccd:865-866),
  //    recording the OUTGOING pr and its phase — so the CURRENT pr for a
  //    workspace is never in `.prhistory`; it lives in the registry's
  //    `.prnumber`/`.prphase` instead. Both are corroborated against the
  //    ledger's PR column: `.prhistory`'s entries (the pr lineage) and the
  //    registry's live pr (the one open right now, which is the thing an
  //    operator actually needs to know after a DB loss).
  const prs = readFileSync(path.join(dir, 'prhistory.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l) as { pr: number });
  const ledgerPrs = perWave.flatMap((w) => w.prs);
  for (const { pr } of prs) {
    expect(ledgerPrs, `#${pr} is in .prhistory but not in the ledger`).toContain(pr);
  }
  const currentPrField = reg('prnumber');
  let currentPr: { number: number; phase: string | null } | null = null;
  if (currentPrField !== null) {
    const num = Number(currentPrField);
    expect(ledgerPrs, `the registry's current PR #${num} is not in the ledger`).toContain(num);
    const currentPhase = reg('prphase');
    // `.prphase` (shared/api.ts's PrPhase: 'unchecked'|'none'|'no-commits'|
    // 'open'|'draft'|'merged'|'closed'|'unknown') and the ledger's own
    // `state` column (TEMPLATE.md prescribes no vocabulary for it — this
    // fixture's own wave 3 reads 'in flight') are NOT the same vocabulary,
    // so they cannot be compared for equality — only 'merged' is a word
    // both sides can say, and it is the one direction that matters for a
    // disaster-recovery drill: if the registry says the current PR already
    // merged, the committed ledger for that PR must agree, or the ledger
    // is the stale artifact. Any other `.prphase` (open, draft, ...) is the
    // ordinary mid-flight state the drill exists to be run during, and is
    // corroborated only by the unconditional "PR appears in the ledger"
    // check above.
    if (currentPhase === 'merged') {
      const row = perWave.find((w) => w.prs.includes(num));
      expect(
        row?.state,
        `#${num}'s ledger row says '${row?.state}', but the registry's .prphase says merged`,
      ).toBe('merged');
    }
    currentPr = { number: num, phase: currentPhase };
  }

  return {
    program, sessionId,
    workspace: reg('workspace')!, branch: reg('branch')!, project: reg('project')!,
    currentWave: ledgerCurrentWave,
    waves: ledgerWaves,
    perWave,
    confidence: holdAgrees ? 'hold-corroborated' : 'ledger-only',
    currentPr,
  };
}

describe('the reconstruction drill', () => {
  it('recovers the program a lost coord.db was holding', () => {
    const r = reconstruct(fx);
    expect(r).toMatchObject({
      program: 'build4-transcript-surface',
      sessionId: 'ccrc-pwa-clear-cove',
      workspace: 'clear-cove',
      branch: 'ws/clear-cove',
      project: 'ccrc-pwa',
      currentWave: 3,
      waves: 3,
      confidence: 'hold-corroborated',
      currentPr: { number: 583, phase: 'merged' },
    });
    expect(r.perWave).toEqual([
      { wave: 1, prs: [577], state: 'merged' },
      { wave: 2, prs: [583], state: 'merged' },
      { wave: 3, prs: [], state: 'in flight' },
    ]);
  });

  // The ledger's `state` column and the registry's `.prphase` are not the
  // same vocabulary (see reconstruct()'s own comment); 'merged' is the one
  // word both sides can say, and it is the direction that must be checked —
  // a registry claiming a PR already merged while the committed ledger
  // still shows it in flight is a real, catchable disagreement, not a wave-
  // boundary artifact. MEASURED: with the corroboration block deleted
  // entirely (or downgraded to "any disagreement, not just merged"), this
  // case does NOT throw — a stale/false 'merged' registry would read as an
  // ordinary reconstruction.
  it('throws when the registry says the current PR already merged but the committed ledger still shows it in flight', () => {
    const ledger = readFileSync(path.join(fx, 'ledger.md'), 'utf8').replace(
      '| 3 | mail in the transcript, and the jump-to-latest pill | — | in flight |',
      '| 3 | mail in the transcript, and the jump-to-latest pill | #590 | in flight |',
    );
    const withLedger = copyFixtureWith(fx, 'ledger.md', ledger);
    // .prphase is already 'merged' in the base fixture — only .prnumber
    // needs to move onto the newly in-flight PR to produce the disagreement.
    const dir = copyFixtureWith(withLedger, 'registry/ccrc-pwa-clear-cove.prnumber', '590');
    expect(() => reconstruct(dir)).toThrow(/disagrees|says.*merged/);
  });

  // Same edited ledger, but the registry's phase is the ordinary mid-flight
  // value ('open') rather than 'merged' — the case finding 25's fix round
  // regressed on: comparing the two vocabularies for bare equality made
  // this throw on the state a disaster-recovery drill exists to be run
  // during. It must reconstruct cleanly and report the live PR honestly.
  it('does not throw on an ordinary mid-flight .prphase that has no matching word in the ledger\'s vocabulary', () => {
    const ledger = readFileSync(path.join(fx, 'ledger.md'), 'utf8').replace(
      '| 3 | mail in the transcript, and the jump-to-latest pill | — | in flight |',
      '| 3 | mail in the transcript, and the jump-to-latest pill | #590 | in flight |',
    );
    const withLedger = copyFixtureWith(fx, 'ledger.md', ledger);
    const withPr = copyFixtureWith(withLedger, 'registry/ccrc-pwa-clear-cove.prnumber', '590');
    const dir = copyFixtureWith(withPr, 'registry/ccrc-pwa-clear-cove.prphase', 'open');
    const r = reconstruct(dir);
    expect(r.currentPr).toEqual({ number: 590, phase: 'open' });
    expect(r.perWave[2]).toEqual({ wave: 3, prs: [590], state: 'in flight' });
  });

  it('still recovers the program with the hold released, and SAYS the confidence dropped', () => {
    // The final-merge state: the coordinator released, the sweep archived, the
    // DB is gone. The ledger alone still answers, and the drill must not
    // pretend the corroboration it lost was never there.
    const dir = copyFixtureWithout(fx, 'registry/ccrc-pwa-clear-cove.hold');
    const r = reconstruct(dir);
    expect(r.currentWave).toBe(3);
    expect(r.confidence).toBe('ledger-only');
  });

  it('downgrades to ledger-only when the hold disagrees with the ledger, rather than trusting a stale display string', () => {
    // MEASURED against the unpatched drill in fix-round review: this exact
    // hold against this exact (unchanged) 3-wave ledger returned
    // {currentWave: 9, waves: 12, confidence: 'hold-corroborated'} — no
    // throw, no downgrade. The hold is display-only (registry.ts:27) and PR
    // I's close path rewrites it under the NEXT wave's reason as part of an
    // ordinary close, so disagreement is the expected shape at a wave
    // boundary — the committed ledger must win, and the label must say so.
    const dir = copyFixtureWith(
      fx,
      'registry/ccrc-pwa-clear-cove.hold',
      'program:build4-transcript-surface wave:9/12',
    );
    const r = reconstruct(dir);
    expect(r.currentWave).toBe(3);
    expect(r.waves).toBe(3);
    expect(r.confidence).toBe('ledger-only');
  });

  it('names exactly what CANNOT be reconstructed, so this is never read as "the DB is redundant"', () => {
    // Every named-field entry below is a `RunSummary` (shared/api.ts) field
    // no artifact carries, and the assertion is against reconstruct()'s own
    // OUTPUT, not the ledger's prose: "cannot be reconstructed" is a property
    // of what the procedure actually produces, so this goes red the day
    // someone quietly starts deriving e.g. closedAt from .prhistory's
    // recordedAt (which the drill already reads) rather than staying green
    // forever by construction. The last four entries are finer-grained than
    // any single RunSummary field (per-work-item and per-mail-row detail)
    // and are named for the record, not checked against a key that could
    // never literally appear.
    const UNRECOVERABLE = [
      'dispatchedAt', 'closedAt',        // wall-clock instants; the ledger keeps order, not time
      'dispatchStartedAt',               // the same class, and MORE so: it measures a window that
                                         // ended before any artifact was written — a dispatch that
                                         // never completed leaves no ledger line at all
      'resumed', 'clearedAt',            // the /clear proof (D-1); no artifact stamps it
      'openedAt',                        // same class of wall-clock instant as dispatchedAt/closedAt
      'handoffCommit',                   // the worker's claimed commit sha; nothing persists it outside the DB
      'claimedBy',                       // the COORDINATOR's session id. The ledger header names the
                                         // programme's WORKSPACE and the hold names its wave — neither
                                         // names the session that opened the run, and the registry has no
                                         // field for it at all. So a DB loss forgets who owned the
                                         // programme, and the recovery is a human saying so, not a parse.
      'programTitle',                    // TEMPLATE.md's header carries a slug only, no title line
      'unreadMail',                      // a live count over acked/queued mail; the DB alone tracks delivery state
      'work item ids and their blockedBy DAG',
      'per-item doneFingerprint',
      'mail bodies and their delivery/ack state',
      'coordinator caps counters',
    ] as const;
    // Compile-time half of the same claim: if PR I adds or removes a
    // RunSummary field, this object satisfies-fails before any test runs —
    // the mapping below has to be revisited, not silently stale. (Type-only
    // import — no runtime module, no parser: D-4's "the drill imports no
    // production module" survives this, since `import type` is erased.)
    const RUN_SUMMARY_KEYS: Record<keyof RunSummary, true> = {
      id: true, program: true, programTitle: true, wave: true, waveOf: true,
      project: true, sessionId: true, workspace: true, branch: true, state: true,
      claimedBy: true,
      resumed: true, clearedAt: true, openedAt: true, dispatchStartedAt: true,
      dispatchedAt: true,
      closedAt: true, handoffCommit: true, items: true, unreadMail: true,
    };
    expect(Object.keys(RUN_SUMMARY_KEYS).length).toBe(20);

    const r = reconstruct(fx);
    for (const field of UNRECOVERABLE) {
      expect(Object.keys(r), `${field} was reconstructed after all`).not.toContain(field);
    }
    expect(UNRECOVERABLE.length).toBe(14);
  });

  it('refuses to invent a program when the ledger is missing', () => {
    // A DB loss with no committed ledger is an unrecoverable program, and the
    // honest answer is a loud failure — the same polarity as the migration
    // rule (spec §2: refuse to start, never start empty).
    expect(() => reconstruct(copyFixtureWithout(fx, 'ledger.md'))).toThrow();
  });
});
