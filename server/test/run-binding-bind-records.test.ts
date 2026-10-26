// ARCH-60 follow-up (#1407, part of #795): every bind records the incarnation it binds to. This file pins, by name, what
// `CoordStore.bindSession` writes for the bound incarnation, and the two gaps #1407 names. Written first as a
// characterization (green on the code before the fix); the gap cases carry a WRONG-ANSWER comment and flip with the fix.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { bindingOf, bornIncarnation, parentOf, unbornIncarnation } from '../src/coord/runBinding.js';
import { REPO_ROOT, callsIn, parsedFile, sqlStatementsInFile, symbolOf } from './scan/symbols.js';
import { mkTmp } from './tmpHelpers.js';

const STORE = 'server/src/coord/store.ts';
const OLD = 1_700_000_000_000;
const BORN = OLD + 5_000_000;
const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-bind-records-'), '.ccrc', 'coord.db')));
const open = (s: CoordStore, program: string, claimedBy: string, openedAt: number): number => {
  const id = (s.openRun({ program, title: program, project: 'p', wave: 1, waveOf: null, claimedBy }) as { id: number }).id;
  s.db.prepare('UPDATE runs SET openedAt = ? WHERE id = ?').run(openedAt, id);
  return id;
};
const born = (s: CoordStore, id: number) => s.db.prepare('SELECT sessionBornAt, sessionBornFor FROM runs WHERE id = ?').get(id);
const series = (s: CoordStore, session: string) => {
  const r = s.bindingRunsOf(session);
  if (!r.ok) throw new Error(r.detail);
  return r.runs;
};

describe('the bound incarnation has one writer (ARCH-60 follow-up, #1407)', () => {
  // The statements of the store that SET a non-null birth from a bind: the explicit stamp in bindSession and the
  // occupant stamp. `clearSession` and the backfill write NULL or seed it, and are not binds.
  const setsBirth = (set: string | null): boolean => /sessionBornAt\s*=\s*(\?|b\.at)/.test(set ?? '');
  it('exactly the bind and the occupant stamp write a birth, and bindSession reaches the occupant stamp', () => {
    const writers = sqlStatementsInFile(STORE).filter((st) => st.verb === 'UPDATE' && st.table === 'runs' && setsBirth(st.set));
    const holders = writers.map((st) => [symbolOf(STORE, 'CoordStore.bindSession'), symbolOf(STORE, 'CoordStore.stampOccupantBirth')]
      .find((sym) => st.start >= sym.start && st.end <= sym.end)?.name);
    expect(holders.sort()).toEqual(['CoordStore.bindSession', 'CoordStore.stampOccupantBirth']);
    expect(callsIn(symbolOf(STORE, 'CoordStore.bindSession')).map((c) => c.callee)).toContain('this.stampOccupantBirth');
  });
});

describe('a bind with no placeable birth still records an incarnation (the gaps of #1407)', () => {
  it('GAP 2: a wave bound to a live worker whose minting run cannot be placed records the recorded birth and is bound', () => {
    const s = store();
    const w1 = open(s, 'prog-a', 'coord-1', BORN - 1000);
    // The minting run recorded a birth but its dispatchStartedAt does not agree, so `childBirthOf` cannot place it.
    s.setSession(w1, 'demo-w', BORN);
    const w2 = open(s, 'prog-b', 'coord-1', BORN - 1000);
    s.setSession(w2, 'demo-w');
    expect(born(s, w2)).toEqual({ sessionBornAt: BORN, sessionBornFor: 'demo-w' });
    const binding = bindingOf(series(s, 'demo-w'), bornIncarnation('demo-w', BORN));
    expect(binding.undecided).toEqual([]);
    expect(binding.newest?.id).toBe(w2);
  });

  it('GAP 1 (unplaceable): an unborn session with recorded births is its newest recorded birth, so an earlier occupant\'s open run is no parent', () => {
    const s = store();
    const ghost = open(s, 'prog-old', 'coord-gone', OLD);
    s.setSession(ghost, 'demo-w', OLD);
    const live = open(s, 'prog-new', 'coord-live', BORN + 1000);
    s.setSession(live, 'demo-w', BORN);
    s.db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(live);
    const binding = bindingOf(series(s, 'demo-w'), unbornIncarnation('demo-w', 'unplaceable'));
    expect(binding.open).toBeNull();
    expect(parentOf(binding)).toBeNull();
    expect(binding.newest?.id).toBe(live);
  });

  it('GAP 1 (not-a-child), residual: a session that never had a recorded birth keeps the id-string rule (#1532)', () => {
    const s = store();
    const manual = open(s, 'prog-m', 'coord-1', OLD);
    s.setSession(manual, 'manual-ws');
    const binding = bindingOf(series(s, 'manual-ws'), unbornIncarnation('manual-ws', 'not-a-child'));
    expect(binding.open?.id).toBe(manual);
    expect(parentOf(binding)).toBe('coord-1');
  });
});

// THE CENSUS (ARCH-60 follow-up, #1407, counted exit). Every call of `bindSession`/`setSession`/`markDispatched` in the
// server, keyed on symbols, classified by what the bind records for the bound incarnation:
//   explicit-birth  the call names the birth (the fresh-spawn arm of dispatch);
//   occupant-stamp  the call names none, so `bindSession` stamps the occupant's recorded birth (`stampOccupantBirth`);
//   records-nothing the call binds with an explicit `null`, so nothing is recorded.
// `setSession` is a pass-through to `bindSession` (it forwards `bornAt` as given) and is not itself a site.
// The records-nothing list is a NAMED allow-list, not a count to drift: the adopted arm (child-reclamation spec §5.1: the
// workspace may be an earlier attempt's, so no birth is dated), and the residual that an occupant-stamp site stamps
// nothing for a session that never had a recorded birth (a coordinator or manual workspace: #1532, the id-string rule).
describe('every bind site records an incarnation, or is named (ARCH-60 follow-up, #1407)', () => {
  type Kind = 'explicit-birth' | 'occupant-stamp' | 'records-nothing' | 'pass-through';
  const SRC = 'server/src';
  const walk = (dir: string): string[] => readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith('.ts') ? [`${dir}/${e.name}`] : []));
  const innermost = (file: string, at: number): string => {
    const spans = parsedFile(file).symbols.filter((s) => s.start <= at && at < s.end).sort((a, b) => (a.end - a.start) - (b.end - b.start));
    return spans[0]?.name ?? '(top level)';
  };
  const sites = (): Array<{ where: string; call: string; kind: Kind[] }> => walk(SRC).flatMap((file) =>
    parsedFile(file).calls.filter((c) => c.name !== null && ['bindSession', 'setSession', 'markDispatched'].includes(c.name))
      .map((c) => {
        const where = `${file.slice(SRC.length + 1)}#${innermost(file, c.start)}`;
        // A bind that names a birth in a ternary with `null` is two arms: the fresh spawn dates it, the adoption does not.
        const third = c.args[2]?.text;
        const kind: Kind[] = c.name === 'markDispatched' ? ['occupant-stamp']
          : where.endsWith('CoordStore.setSession') ? ['pass-through']
          : third === undefined ? ['occupant-stamp']
          : /\bnull\b/.test(third) ? ['explicit-birth', 'records-nothing'] : ['explicit-birth'];
        return { where, call: `${c.name}`, kind };
      }));

  it('classifies each caller, and the records-nothing list is exactly the named allow-list', () => {
    const found = sites().map((s) => `${s.where} ${s.call} -> ${s.kind.join('+')}`).sort();
    expect(found).toEqual([
      'coord/dispatch.ts#spawnFresh setSession -> explicit-birth+records-nothing',
      'coord/routes.ts#registerCoordRoutes.holdAndBindSession setSession -> occupant-stamp',
      'coord/store.ts#CoordStore.dispatchRun markDispatched -> occupant-stamp',
      'coord/store.ts#CoordStore.markDispatched bindSession -> occupant-stamp',
      'coord/store.ts#CoordStore.setSession bindSession -> pass-through',
    ].sort());
    const nothing = sites().filter((s) => s.kind.includes('records-nothing')).map((s) => s.where);
    // Measured: before this change 3 sites recorded nothing (routes, markDispatched, and the adopted arm); after, 1: the
    // adopted arm. The not-a-child residual (#1532) is a property of the SESSION, not a call site, and is pinned above.
    expect(nothing).toEqual(['coord/dispatch.ts#spawnFresh']);
  });
});
