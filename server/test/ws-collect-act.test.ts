// The `collect` journal act (child reclamation spec 2026-09-22 §5.10, §8's wave 7): ws-collect's own act word, in every
// declaration — ccd's `_LC_ACTS`, L0's union and map, the PWA's word — and placed by the two readers that classify acts
// by name: the workspace-lifecycle instrument (NEUTRAL: it neither returns from an archive nor ends one) and the
// dead-coordinator clause (NOT a deliberate put-down). The collector acts only on an id no registry row and no child
// marker stands for, so whatever removed that workspace journaled its own act; `collect` removes a dead id's leftover
// temp root and says nothing about how the session ended. FIXTURE HOME ONLY.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIFECYCLE_ACTS, isLifecycleAct } from '../../shared/api.js';
import {
  DEAD_COORDINATOR_DELIBERATE_ACTS, DEAD_COORDINATOR_JOURNAL_ACTS, DEAD_COORDINATOR_JOURNAL_TRUSTED,
  deadCoordinatorJournal, type DeadCoordinatorJournalRow,
} from '../src/deadCoordinator.js';
import { makeCcdHarness } from './ccdWsHelpers.js';
import { NO_TMUX, readJournal } from './lifecycleHelpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INSTRUMENT = path.join(ROOT, 'deploy', 'measure-workspace-lifecycle.py');
/** One of the instrument's act tuples, read the way `measure-workspace-lifecycle.test.ts` reads them. */
const tuple = (name: string): string[] => {
  const m = new RegExp(`^${name} = \\(([^)]*)\\)`, 'm').exec(readFileSync(INSTRUMENT, 'utf8'));
  expect(m, name).not.toBeNull();
  return m![1]!.split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean);
};

const NOW = 1_790_000_000_000;
const GEN = '1790000000000000000';
const row = (act: string, over: Partial<DeadCoordinatorJournalRow> = {}): DeadCoordinatorJournalRow =>
  ({ act: act as DeadCoordinatorJournalRow['act'], outcome: 'done', at: NOW, gen: GEN, dec: null, meas: null, raw: '{}', ...over });
/** A successful start, as ccd writes it: `meas.rc` the STRING "0" on the line's own bytes. */
const started = row('spawn', { raw: JSON.stringify({ v: 1, act: 'spawn', outcome: 'done', meas: { rc: '0' } }) });

describe('the collect act — declared in L0 and in ccd', () => {
  it('L0 names it', () => {
    expect(isLifecycleAct('collect')).toBe(true);
    expect(LIFECYCLE_ACTS).toContain('collect');
  });

  it('ccd carries it in _LC_ACTS and journals `collect` as ITSELF — never the unknown degrade with a badact', () => {
    const h = makeCcdHarness('ccrc-ws-collect-act-');
    try {
      const acts = h.sh('printf "%s\\n" "${_LC_ACTS[@]}"').split('\n').map((l) => l.trim()).filter(Boolean);
      expect(acts.length, 'guards the guard: ccd answered its array').toBeGreaterThan(20);
      expect(acts).toContain('collect');
      h.sh(`${NO_TMUX} _lc_emit collect done demo-quiet-basin "" verb ws-collect`);
      const ev = readJournal(h.home).filter((e) => e['id'] === 'demo-quiet-basin');
      expect(ev.map((e) => e['act'])).toEqual(['collect']);
      expect(ev[0]!['badact']).toBeUndefined();
    } finally { h.cleanup(); }
  }, 60_000);
});

describe('collect removes no workspace and puts down no session — both act readers place it', () => {
  it('the workspace-lifecycle instrument classifies it NEUTRAL: no return from an archive, and no end of one', () => {
    expect(tuple('NEUTRAL_ACTS')).toContain('collect');
    expect(tuple('ENDS_THE_ARCHIVE'), 'it removes no workspace').not.toContain('collect');
    expect(tuple('RETURN_ACTS'), 'it brings nothing back').not.toContain('collect');
  });

  it('the dead-coordinator clause never reads it as a deliberate put-down, and its store read never fetches it', () => {
    expect(DEAD_COORDINATOR_DELIBERATE_ACTS).not.toContain('collect');
    expect(DEAD_COORDINATOR_JOURNAL_ACTS).not.toContain('collect');
    expect(deadCoordinatorJournal([started, row('collect', { at: NOW + 1 })], true, DEAD_COORDINATOR_JOURNAL_TRUSTED))
      .toEqual({ kind: 'quiet', started: true });
    // CONTROL: the same position holding a real put-down reads deliberate, so the row above was read, not skipped.
    expect(deadCoordinatorJournal([started, row('expire', { at: NOW + 1 })], true, DEAD_COORDINATOR_JOURNAL_TRUSTED))
      .toEqual({ kind: 'deliberate', act: 'expire', at: NOW + 1 });
  });
});
