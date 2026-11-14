// L3, context C3: what the store says about a note's key, read for one caller, kept as read (`KeyReading`): a row's fields,
// `absent`, or `unmeasured` for a read that failed or threw. It decides nothing: `noteKeyFact` (L1, `notes.ts`) does. The
// note door and the card's gatherer both read through it, so a key is measured one way wherever it is shown.
import type { CoordStore } from '../coord/store.js';
import type { NoteKey } from '../../../shared/continuity.js';
import type { KeyReading } from './notes.js';

/** The store reads a key needs, declared by this consumer. */
export type NoteKeysCoord = Pick<CoordStore, 'claimsProgramme' | 'itemById' | 'run' | 'bindingsOf'>;

/** A reader for one caller. `claimsProgramme` is asked once per slug, and the caller's open claimed runs once, through the
 *  binding's own reader (`bindingsOf(caller).claimant()`, ARCH-62), each remembered for the reader's life (one request), so
 *  a card of 200 notes reads the caller's runs once. */
export function noteKeyReader(coord: NoteKeysCoord, caller: string): (key: NoteKey) => KeyReading {
  const claims = new Map<string, boolean | 'unmeasured'>();
  const claimsOf = (slug: string): boolean | 'unmeasured' => {
    let v = claims.get(slug);
    if (v === undefined) {
      try { v = coord.claimsProgramme(caller, slug); } catch { v = 'unmeasured'; }
      claims.set(slug, v);
    }
    return v;
  };
  let claimed: ReadonlySet<number> | 'unmeasured' | undefined;
  const claimedRuns = (): ReadonlySet<number> | 'unmeasured' => {
    if (claimed === undefined) {
      try {
        const r = coord.bindingsOf(caller).claimant();
        claimed = r.ok ? new Set(r.siblings.map((s) => s.id)) : 'unmeasured';
      } catch { claimed = 'unmeasured'; }
    }
    return claimed;
  };
  return (key) => {
    switch (key.kind) {
      case 'programme':
        return { kind: 'programme', claims: claimsOf(key.slug) };
      case 'item': {
        let row: ReturnType<NoteKeysCoord['itemById']>;
        try { row = coord.itemById(key.id); } catch { return { kind: 'item', item: 'unmeasured' }; }
        if (row === null) return { kind: 'item', item: 'absent' };
        const item = { state: row.state, raisedBy: row.raisedBy, program: row.program, claimsProgramme: claimsOf(row.program) };
        return { kind: 'item', item };
      }
      case 'run': {
        let r: ReturnType<NoteKeysCoord['run']>;
        try { r = coord.run(key.id); } catch { return { kind: 'run', run: 'unmeasured' }; }
        if (!r.ok) return { kind: 'run', run: 'unmeasured' };
        if (r.run === null) return { kind: 'run', run: 'absent' };
        const mine = claimedRuns();
        return { kind: 'run', run: { state: r.run.state, claimedByCaller: mine === 'unmeasured' ? 'unmeasured' : mine.has(key.id) } };
      }
    }
  };
}
