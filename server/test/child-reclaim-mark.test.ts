// child-reclamation wave 2, Task 1 — `SessionRecord.child`, the registry's
// reading of `$REG/<id>.child` (spec §5.1). THREE answers, never a boolean:
// the bind gate REFUSES an unreadable marker and wave 3's reclaim will DEFER
// on one, so collapsing `unreadable` into either neighbour fails open in one
// of those two directions.
//
// Wave 1 (the ccd half that WRITES the marker) need not be deployed for this
// suite to mean anything: every case writes the marker file itself, into a
// fixture registry, exactly as `_reg_set` would (`printf '%s'`, no newline).
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { localIO, type FleetIO } from '../src/io.js';
import { readRegistry, readSessionRecord, type SessionRecord } from '../src/registry.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';
import { absentField, unreadableField } from './ioDoubles.js';
import { assembleFleet } from '../src/fleet.js';
import { Tmux, type Runner } from '../src/exec.js';
import { reviveFleetSession, type FleetSession } from '../../shared/api.js';

const ID = 'demo-child';
let home: string;
let reg: string;

beforeEach(() => {
  home = mkTmp('ccrc-child-mark-');
  seedRoster(home);
  reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  // A complete row — the identity triple a real ccd writes — so the record is
  // BUILT and the marker is the only variable.
  for (const [k, v] of Object.entries({
    wrapper: 'claude', project: 'demo', workdir: `/w/${ID}`, uuid: `u-${ID}`, started: '1',
    workspace: ID, branch: `ws/${ID}`, base: 'origin/main',
  })) writeFileSync(path.join(reg, `${ID}.${k}`), v);
});

const cfg = () => loadConfig({ CCRC_HOME: home });
const mark = (content: string): void => writeFileSync(path.join(reg, `${ID}.child`), content);
const record = async (io: FleetIO = localIO): Promise<SessionRecord> => {
  const r = await readSessionRecord(io, cfg(), ID);
  if (!r.found) throw new Error(`fixture row not found: ${r.reason}`);
  return r.record;
};

describe('SessionRecord.child — three answers, never a boolean', () => {
  it('no marker file → none: a workspace nothing declared a child', async () => {
    expect((await record()).child).toEqual({ kind: 'none' });
  });

  it('a marker naming a run → child, carrying the minting run id', async () => {
    mark('17');
    expect((await record()).child).toEqual({ kind: 'child', runId: 17 });
  });

  // THE SAME SET ccd ACCEPTS (child-reclamation spec §5.1). ccd reads the marker as
  // `$(_reg_get "$id" child)` and judges it with `_child_runid_valid`
  // (`^[1-9][0-9]{0,9}$` under `LC_ALL=C`). Command substitution strips
  // trailing newlines and drops NUL bytes — and trims NOTHING else — so the
  // server reads exactly those bytes, not `.trim()`'s.
  it('trailing newlines are stripped, as ccd\'s `$(…)` strips them', async () => {
    mark('17\n');
    expect((await record()).child).toEqual({ kind: 'child', runId: 17 });
    mark('17\n\n');
    expect((await record()).child).toEqual({ kind: 'child', runId: 17 });
  });

  it('a NUL byte is dropped, as bash drops it from `$(…)`', async () => {
    mark('1\u00007');
    expect((await record()).child).toEqual({ kind: 'child', runId: 17 });
  });

  it('the widest run id ccd writes — ten digits — is a child', async () => {
    mark('9999999999');
    expect((await record()).child).toEqual({ kind: 'child', runId: 9999999999 });
  });

  it.each([
    '', '   ', 'abc', '0', '017', '-3', '1.5', '17 18', '9007199254740993',
    // ELEVEN digits: a safe integer `parseCanonicalPositiveSafeInteger` would
    // accept, and one ccd's `_child_runid_valid` refuses (R2).
    '12345678901',
    // Whitespace ccd's `$(…)` keeps, so ccd would refuse it too.
    ' 17', '17 ', '\t17', '17\r',
    // Digits outside ASCII (wave 1 measured bash's bare `=~` accepting these
    // under a UTF-8 locale; `_child_runid_valid` shadows `LC_ALL=C`).
    '1²', '١٧', '１７',
  ])(
    'content outside ccd\'s run-id grammar (%j) → unreadable, never none', async (content) => {
      // Something wrote this file. A malformed marker is not "no marker".
      mark(content);
      expect((await record()).child).toEqual({ kind: 'unreadable' });
    });

  it('LISTED, and its bytes did not come back → unreadable, never none', async () => {
    mark('17');
    expect((await record(unreadableField(ID, 'child'))).child).toEqual({ kind: 'unreadable' });
  });

  it('a failed read of a file the listing does NOT name → none (the listing rung)', async () => {
    // What an agent older than the wire's `absent` marker answers for EVERY
    // missing file. Without the listing rung, every workspace on such a box
    // would read as an unreadable child and refuse every bind.
    expect((await record(unreadableField(ID, 'child'))).child).toEqual({ kind: 'none' });
  });

  it('a PROVEN ENOENT on a listed marker (a purge racing the read, or a ' +
     'dangling symlink) → unreadable, never none (F4, D-3348)', async () => {
    mark('17');
    expect((await record(absentField(ID, 'child'))).child).toEqual({ kind: 'unreadable' });
  });

  it('a REAL dangling symlink — the concrete shape the case above stands in ' +
     'for — reads absent, is listed, and answers unreadable', async () => {
    symlinkSync(path.join(reg, `${ID}.child-target-does-not-exist`), path.join(reg, `${ID}.child`));
    expect((await record()).child).toEqual({ kind: 'unreadable' });
  });

  it('the whole-fleet read carries the same field — one parser, two callers', async () => {
    mark('17');
    const rows = await readRegistry(localIO, cfg());
    expect(rows.find((r) => r.id === ID)?.child).toEqual({ kind: 'child', runId: 17 });
  });
});

/** A complete fleet row — `fleet-wire-route.test.ts`'s `session()` shape. */
const fleetRow = (id: string): FleetSession => ({
  id, wrapper: 'claude', home: '/home/rc', project: id, workdir: `/data/projects/${id}`,
  workspace: null, name: null, status: 'idle', statusUpdatedAt: null, limits: null,
  dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: null, ctxPct: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, graphQueries: null, graphGateDenials: null, held: null, bucket: 'idle', bucketSince: null,
  unmeasured: [], statusUnmeasured: false, lifecycle: null, stoppedBy: null, swapBlocked: null, stranded: null, substrate: null,
  started: true, spawnState: null, ask: null, usage: null, boardProject: null, route: null, child: { kind: 'none' },
});

describe('reviveFleetSession — child (ADDITIVE, absence-permits)', () => {
  it('a snapshot from before markers existed (no key at all) revives none — it describes no children', () => {
    const raw = JSON.parse(JSON.stringify(fleetRow(ID))) as Record<string, unknown>;
    delete raw['child'];
    expect(reviveFleetSession(raw)?.child).toEqual({ kind: 'none' });
  });

  it('an explicit null revives none', () => {
    expect(reviveFleetSession({ ...fleetRow(ID), child: null })?.child).toEqual({ kind: 'none' });
  });

  it.each([{ kind: 'none' }, { kind: 'child', runId: 17 }, { kind: 'unreadable' }] as const)(
    'round-trips %j exactly', (child) => {
      expect(reviveFleetSession(JSON.parse(JSON.stringify({ ...fleetRow(ID), child })))?.child).toEqual(child);
    });

  it.each([
    ['a bare string', '17'],
    ['an array', []],
    ['an unknown kind', { kind: 'maybe' }],
    ['a child with no runId', { kind: 'child' }],
    ['a child whose runId is a string', { kind: 'child', runId: '17' }],
    ['a child whose runId is zero', { kind: 'child', runId: 0 }],
    ['a child whose runId is fractional', { kind: 'child', runId: 1.5 }],
    // A safe integer no marker can carry: ccd writes at most ten digits and
    // the registry reader refuses more (spec §5.1), so a persisted eleven-digit
    // run id is a value this build did not write.
    ['a child whose runId has eleven digits', { kind: 'child', runId: 12345678901 }],
  ])('rejects the WHOLE session on %s — never laundered into "not a child"', (_what, child) => {
    expect(reviveFleetSession({ ...fleetRow(ID), child })).toBeNull();
  });
});

describe('assembleFleet — child rides the fleet frame', () => {
  const noopRun: Runner = async () => ({ code: 1, stdout: '', stderr: '' });
  const fleet = (io: FleetIO = localIO) => assembleFleet(io, cfg(), new Tmux(noopRun), 1784600000);

  it('carries a marker naming a run', async () => {
    mark('42');
    expect((await fleet()).find((s) => s.id === ID)?.child).toEqual({ kind: 'child', runId: 42 });
  });

  it('carries an unreadable marker as unreadable — the wire does not narrow it', async () => {
    mark('42');
    expect((await fleet(unreadableField(ID, 'child'))).find((s) => s.id === ID)?.child)
      .toEqual({ kind: 'unreadable' });
  });

  it('carries none for a workspace with no marker', async () => {
    expect((await fleet()).find((s) => s.id === ID)?.child).toEqual({ kind: 'none' });
  });
});
