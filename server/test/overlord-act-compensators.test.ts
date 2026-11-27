// The act catalogue's compensators (Overlord W2, plan `docs/superpowers/plans/2026-11-16-overlord-w2/w2-act-catalogue.md`
// Task A3; spec §7.1 "Each compensable kind names its compensator"): every compensable row allowed at some rung names one, a
// row refused at every rung is skipped and names none, a row that is not compensable names none, and each compensator's door
// is registered by a routes file of the server today, found by the repo's one parser wrapper, or is on the shrink-only
// `LATER_DOORS` with the piece that registers it. The coordinator's ruling on the team link (call 1816, condition 2): a
// compensator naming a door that does not exist reds a case.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSource } from './scan/parse.js';
import { COMPENSATORS, OVERLORD_ACT_KINDS, compensatorDoor, type Compensator, type OverlordActRow } from '../../shared/overlord.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(REPO, 'server/src');

/** Doors a later piece registers, each with that piece. Shrink-only: a door that becomes registered leaves this list. */
const LATER_DOORS: Readonly<Record<string, string>> = {
  'POST /api/overlord/requests': 'request record B (the W2 index, Table W2)',
};

const VERBS = new Set(['get', 'post', 'put', 'delete']);
function sourcesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? sourcesUnder(p) : p.endsWith('.ts') ? [p] : [];
  });
}
/** Every literal `app.<verb>('<path>'` registration under `server/src`, as `METHOD path`. */
const REGISTERED: ReadonlySet<string> = new Set(sourcesUnder(SRC).flatMap((f) =>
  parseSource(readFileSync(f, 'utf8'), f).calls
    .filter((c) => /^app\.(get|post|put|delete)$/.test(c.callee) && c.args[0]?.kind === 'string' && VERBS.has(c.name ?? ''))
    .map((c) => `${(c.name as string).toUpperCase()} ${c.args[0]!.text}`)));

type Table = Readonly<Record<string, OverlordActRow>>;
const allowedSomewhere = (r: OverlordActRow): boolean => Object.values(r.rungs).some((c) => c !== 'refuse');

function compensatorViolations(t: Table, doorOf: (c: Compensator) => string = compensatorDoor): string[] {
  const out: string[] = [];
  for (const [k, r] of Object.entries(t)) {
    const needs = r.reversibility === 'compensable' && allowedSomewhere(r);
    if (needs && r.compensator === null) out.push(`${k}: compensable and allowed at some rung, with no compensator`);
    if (!needs && r.compensator !== null) out.push(`${k}: names a compensator it does not need`);
  }
  for (const c of COMPENSATORS) {
    const door = doorOf(c);
    if (!REGISTERED.has(door) && !Object.prototype.hasOwnProperty.call(LATER_DOORS, door)) out.push(`${c}: its door ${door} is not registered`);
  }
  return out;
}
const edit = (kind: string, over: Partial<OverlordActRow>): Table => ({ ...OVERLORD_ACT_KINDS, [kind]: { ...OVERLORD_ACT_KINDS[kind as never] as OverlordActRow, ...over } });

describe('the compensators', () => {
  it('CONTROL: the registration scan sees the server\'s doors', () => {
    expect(REGISTERED.size).toBeGreaterThan(100);
    expect(REGISTERED.has('POST /api/digest/correct')).toBe(true);
  });
  it('every compensable row allowed at some rung names one, no other row names one, and each door is registered or later', () => {
    expect(compensatorViolations(OVERLORD_ACT_KINDS)).toEqual([]);
  });
  it('LATER_DOORS holds only doors not yet registered, each with the piece that registers it (shrink-only)', () => {
    for (const [door, piece] of Object.entries(LATER_DOORS)) {
      expect(REGISTERED.has(door), `${door} is registered now: remove it from LATER_DOORS`).toBe(false);
      expect(piece.length).toBeGreaterThan(0);
    }
  });
  it('the team link\'s compensator is the operator\'s relink, registered today (call 1816)', () => {
    expect(OVERLORD_ACT_KINDS['link-team'].compensator).toBe('operator-relink');
    expect(REGISTERED.has(compensatorDoor('operator-relink'))).toBe(true);
  });
  it('CONTROL: relay without one is red', () => {
    expect(compensatorViolations(edit('relay', { compensator: null }))).toEqual(['relay: compensable and allowed at some rung, with no compensator']);
  });
  it('CONTROL: drop-request without one is red', () => {
    expect(compensatorViolations(edit('drop-request', { compensator: null }))).toEqual(['drop-request: compensable and allowed at some rung, with no compensator']);
  });
  it('CONTROL: a reversible row, or one refused at every rung, naming one is red', () => {
    expect(compensatorViolations(edit('close-request', { compensator: 'correction-mail' }))).toEqual(['close-request: names a compensator it does not need']);
    expect(compensatorViolations(edit('deploy', { compensator: 'correction-mail' }))).toEqual(['deploy: names a compensator it does not need']);
  });
  it('CONTROL: a compensator naming a door that does not exist is red', () => {
    const doorOf = (c: Compensator) => (c === 'operator-relink' ? 'POST /api/projects/:project/relink' : compensatorDoor(c));
    expect(compensatorViolations(OVERLORD_ACT_KINDS, doorOf)).toEqual(['operator-relink: its door POST /api/projects/:project/relink is not registered']);
  });
});
