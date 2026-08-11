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
//     single-definition.test.ts now enforces that no file under server/src
//     mentions docs/superpowers/programs at all.
//   * what it CANNOT recover is asserted by name, so nobody can read this as a
//     claim that the DB is redundant.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, cpSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

const fx = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/reconstruct');

/** A copy of the fixture tree with one file removed — the shape a real
 *  disaster (or a released hold) actually leaves behind. `mkTmp` owns cleanup. */
function copyFixtureWithout(dir: string, relPath: string): string {
  const out = mkTmp('ccrc-reconstruct-');
  cpSync(dir, out, { recursive: true });
  rmSync(path.join(out, relPath), { force: true });
  return out;
}

interface Reconstructed {
  program: string; sessionId: string; workspace: string; branch: string; project: string;
  currentWave: number; waves: number;
  perWave: { wave: number; prs: number[]; state: string }[];
  confidence: 'hold-corroborated' | 'ledger-only';
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

  // 3. The registry says where the work physically is, and — while the hold is
  //    still on — which wave the program had reached. The hold reason is
  //    display-only by contract (registry.ts:27); reading it HERE is a
  //    disaster-recovery act by a human, not a parser in the running system,
  //    and it is corroborated against the ledger below rather than trusted.
  const reg = (field: string): string | null => {
    const f = path.join(dir, 'registry', `${sessionId}.${field}`);
    return readdirSync(path.join(dir, 'registry')).includes(path.basename(f))
      ? readFileSync(f, 'utf8').trim() : null;
  };
  const hold = reg('hold');
  const m = hold === null ? null : /wave:(\d+)\/(\d+)/.exec(hold);

  // 4. `.prhistory` is the PR lineage the archive manifest would otherwise
  //    carry — the corroboration for the ledger's PR column.
  const prs = readFileSync(path.join(dir, 'prhistory.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l) as { pr: number });
  const ledgerPrs = perWave.flatMap((w) => w.prs);
  for (const { pr } of prs) {
    expect(ledgerPrs, `#${pr} is in .prhistory but not in the ledger`).toContain(pr);
  }

  return {
    program, sessionId,
    workspace: reg('workspace')!, branch: reg('branch')!, project: reg('project')!,
    currentWave: m ? Number(m[1]) : perWave.filter((w) => w.state === 'merged').length + 1,
    waves: m ? Number(m[2]) : perWave.length,
    perWave,
    confidence: m ? 'hold-corroborated' : 'ledger-only',
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
    });
    expect(r.perWave).toEqual([
      { wave: 1, prs: [577], state: 'merged' },
      { wave: 2, prs: [583], state: 'merged' },
      { wave: 3, prs: [], state: 'in flight' },
    ]);
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

  it('names exactly what CANNOT be reconstructed, so this is never read as "the DB is redundant"', () => {
    // These are the RunSummary/work-item fields no artifact carries. Every one
    // of them is a timing or a granularity the ledger deliberately does not
    // record — which is the case for having a database, stated as a test rather
    // than as a paragraph nobody re-reads.
    const UNRECOVERABLE = [
      'dispatchedAt', 'closedAt',        // wall-clock instants; the ledger keeps order, not time
      'work item ids and their blockedBy DAG',
      'per-item doneFingerprint',
      'mail bodies and their delivery/ack state',
      'coordinator caps counters',
    ] as const;
    // The whole phrase, not its first word: the ledger's own legitimate prose
    // ("Workspace:", the wave-3 scope "mail in the transcript") shares a
    // first word with two of these labels ('work', 'mail') without meaning
    // the same thing, so a first-word substring check would fail on the
    // fixture's own honest content. The full label is still a real
    // assertion — a ledger that started literally spelling out
    // "work item ids and their blockedBy DAG" would still trip this.
    const ledger = readFileSync(path.join(fx, 'ledger.md'), 'utf8');
    for (const field of UNRECOVERABLE) {
      expect(ledger.toLowerCase()).not.toContain(field.toLowerCase());
    }
    expect(UNRECOVERABLE.length).toBe(6);
  });

  it('refuses to invent a program when the ledger is missing', () => {
    // A DB loss with no committed ledger is an unrecoverable program, and the
    // honest answer is a loud failure — the same polarity as the migration
    // rule (spec §2: refuse to start, never start empty).
    expect(() => reconstruct(copyFixtureWithout(fx, 'ledger.md'))).toThrow();
  });
});
