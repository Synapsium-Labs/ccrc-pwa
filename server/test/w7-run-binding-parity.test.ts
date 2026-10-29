// The PWA's fixture binding rule, held to the server's (D-7182; Task C7d; plan
// docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md, §Task C7d; ARCH-61's PWA half, GitHub #796).
//
// `pwa/test/runBindingFixture.ts` gives a fixture session the `run` and `openRun` the current server sends for it, so a
// test written before the wire carried the binding keeps its meaning once the PWA reads the binding alone. It is
// imported by path (the `w7-presence-parity.test.ts` and `ask-pairing-table.test.ts` precedent: the server does not
// depend on the PWA, so the module is loaded dynamically and typed here) and held equal to
// `server/src/coord/runBinding.ts#bindingOf` over every shape a PWA fixture can state: a session with no mark, an
// unreadable mark or a child mark; runs naming it, another session or none; ids below, at and above the minting run;
// every run state; and the two histories a run opened before the occupant's birth has on the server (stamped with an
// earlier occupant's birth, or unstamped and so undecidable). Run ids only increase with `openedAt`, which is what lets
// the fixture read "opened before the minting run" as "a lower id".
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUN_STATES, type RunState } from '../../shared/api.js';
import { bindingOf, bornIncarnation, unbornIncarnation, type BindingRun, type Incarnation } from '../src/coord/runBinding.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

interface FixtureRun { id: number; sessionId: string | null; state: RunState; claimedBy: string | null }
type Mark = { kind: 'child'; runId: number } | { kind: 'none' } | { kind: 'unreadable' };
interface FixtureModule {
  serverBinding: (s: { id: string; child?: Mark }, runs: readonly FixtureRun[]) => {
    run: { id: number; state: RunState; claimedBy: string | null } | null;
    openRun: { id: number; state: RunState; claimedBy: string | null } | null;
  };
}
const fixture = async (): Promise<FixtureModule> => await import(path.join(ROOT, 'pwa/test/runBindingFixture.ts')) as FixtureModule;

const ID = 'session-a';
const OTHER = 'session-b';
const MINT = 10;
const openedAt = (id: number): number => 1_800_000_000_000 + id * 60_000;

/** The server's view of a fixture run: its `openedAt` from its id, and the birth stamp its history gives it. */
function serverRun(r: FixtureRun, mark: Mark, earlier: 'stamped' | 'unstamped'): BindingRun {
  const minted = mark.kind === 'child' && r.sessionId === ID && r.id === mark.runId;
  const before = mark.kind === 'child' && r.sessionId === ID && r.id < mark.runId;
  return {
    id: r.id, sessionId: r.sessionId, claimedBy: r.claimedBy, state: r.state, openedAt: openedAt(r.id),
    // The minting run carries this occupant's birth; a run opened for an earlier occupant carries that one's, or none.
    sessionBornAt: minted ? openedAt(r.id) : before && earlier === 'stamped' ? openedAt(r.id) : null,
    sessionBornFor: minted || (before && earlier === 'stamped') ? ID : null,
  };
}

const incarnation = (mark: Mark): Incarnation =>
  mark.kind === 'child' ? bornIncarnation(ID, openedAt(mark.runId))
    : unbornIncarnation(ID, mark.kind === 'none' ? 'not-a-child' : 'unplaceable');

const MARKS: readonly Mark[] = [{ kind: 'none' }, { kind: 'unreadable' }, { kind: 'child', runId: MINT }];
const IDS = [MINT - 2, MINT, MINT + 3];

describe('the PWA fixture binding equals bindingOf', () => {
  it('every mark × every pair of runs (ids below, at and above the minting run; every state; this session, another, none) × both earlier-occupant histories', async () => {
    const f = await fixture();
    let rows = 0;
    const runsFor = (): FixtureRun[][] => {
      const singles: FixtureRun[] = [];
      for (const id of IDS) for (const state of RUN_STATES) for (const sessionId of [ID, OTHER, null]) singles.push({ id, sessionId, state, claimedBy: 'coord-a' });
      const out: FixtureRun[][] = [[]];
      for (const a of singles) {
        out.push([a]);
        for (const b of singles) if (b.id > a.id) out.push([a, b]);
      }
      return out;
    };
    for (const mark of MARKS) {
      for (const runs of runsFor()) {
        for (const earlier of ['stamped', 'unstamped'] as const) {
          const server = bindingOf(runs.map((r) => serverRun(r, mark, earlier)), incarnation(mark));
          const pwa = f.serverBinding({ id: ID, child: mark }, runs);
          expect({ run: pwa.run?.id ?? null, openRun: pwa.openRun?.id ?? null },
            `${JSON.stringify(mark)} ${earlier} ${JSON.stringify(runs.map((r) => [r.id, r.sessionId, r.state]))}`)
            .toEqual({ run: server.newest?.id ?? null, openRun: server.open?.id ?? null });
          rows += 1;
        }
      }
    }
    console.log(`w7-run-binding-parity: ${rows} rows equal`);
    expect(rows).toBeGreaterThan(1000);
  });

  it('a session with no binding key at all is the older server (the skew row): the fixture never writes one for it', async () => {
    const f = await fixture();
    // The fixture computes a binding; only a case that means an older server leaves the keys off, and the PWA reads
    // that as no worker for an open run (`fleet/runWords.ts#workerOf`).
    expect(f.serverBinding({ id: ID, child: { kind: 'none' } }, [])).toEqual({ run: null, openRun: null });
  });
});
