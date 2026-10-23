// ARCH-36 (#559): the archive door's guard chain in front of the first measurement is an L1 decider
// (`coord/archiveAdmission.ts`), asked with probes the route supplies. This is its gate-order table: every row is one
// world, the gate that must refuse it and the word it refuses with, and the probes asked on the way. The order is the
// contract, so each reorder mutant (recorded in the PR) must turn a row red.
import { describe, it, expect } from 'vitest';
import { parsedFile } from './scan/symbols.js';
import { ARCHIVE_REFUSALS } from '../../shared/api.js';
import { decideArchive, refusedAtStop, archiveOutcome } from '../src/coord/archiveDoor.js';
import { ARCHIVE_GATES, admitArchive, type ArchiveAdmissionProbes, type AdmissionRecordRead } from '../src/coord/archiveAdmission.js';
import { REFUSAL_STATUS } from '../../shared/refusal.js';

interface World {
  idSafe: boolean; listed: boolean; known: boolean; record: AdmissionRecordRead<string>;
  identity: 'measured' | 'unmeasured'; pairRefused: boolean; body: unknown;
}
const OPEN: World = {
  idSafe: true, listed: true, known: true, record: { kind: 'found', record: 'row' }, identity: 'measured',
  pairRefused: false, body: undefined,
};

const probes = (w: World, asked: string[]): ArchiveAdmissionProbes<string, string> => ({
  idSafe: () => { asked.push('idSafe'); return w.idSafe; },
  registryListed: async () => { asked.push('registryListed'); return w.listed; },
  known: async () => { asked.push('known'); return w.known; },
  readRecord: async () => { asked.push('readRecord'); return w.record; },
  identityOf: () => { asked.push('identityOf'); return w.identity === 'measured' ? 'who' : null; },
  pairRefused: () => { asked.push('pairRefused'); return w.pairRefused; },
});

const BAD_BODY = [] as unknown;
const ROWS: readonly { name: string; world: World; gate: (typeof ARCHIVE_GATES)[number]; word: string; asked: string[] }[] = [
  { name: 'an unsafe id refuses first, though everything after it is also wrong',
    world: { ...OPEN, idSafe: false, listed: false, known: false, body: BAD_BODY, record: { kind: 'absent' } },
    gate: 'id-shape', word: 'bad-session-id', asked: ['idSafe'] },
  { name: 'an unlistable registry refuses before the id is looked up and before the body is read',
    world: { ...OPEN, listed: false, known: false, body: BAD_BODY },
    gate: 'registry-listing', word: 'registry-unmeasurable', asked: ['idSafe', 'registryListed'] },
  { name: 'an unknown id refuses before the body is read',
    world: { ...OPEN, known: false, body: BAD_BODY },
    gate: 'known-id', word: 'unknown-session', asked: ['idSafe', 'registryListed', 'known'] },
  { name: 'a body that is not the consents refuses before the row is read',
    world: { ...OPEN, body: BAD_BODY, record: { kind: 'absent' } },
    gate: 'body', word: 'bad-request', asked: ['idSafe', 'registryListed', 'known'] },
  { name: 'a row the registry cannot list refuses 502',
    world: { ...OPEN, record: { kind: 'unlistable' } },
    gate: 'registry-row', word: 'registry-unmeasurable', asked: ['idSafe', 'registryListed', 'known', 'readRecord'] },
  { name: 'a row that is absent refuses unknown-session',
    world: { ...OPEN, record: { kind: 'absent' } },
    gate: 'registry-row', word: 'unknown-session', asked: ['idSafe', 'registryListed', 'known', 'readRecord'] },
  { name: 'a row id the registry refuses refuses bad-session-id',
    world: { ...OPEN, record: { kind: 'bad-id' } },
    gate: 'registry-row', word: 'bad-session-id', asked: ['idSafe', 'registryListed', 'known', 'readRecord'] },
  { name: 'an unmeasured identity refuses before the pair is vetted',
    world: { ...OPEN, identity: 'unmeasured', pairRefused: true },
    gate: 'identity', word: 'registry-unmeasurable', asked: ['idSafe', 'registryListed', 'known', 'readRecord', 'identityOf'] },
  { name: 'a pair that is not the id refuses last',
    world: { ...OPEN, pairRefused: true },
    gate: 'identity', word: 'registry-unmeasurable', asked: ['idSafe', 'registryListed', 'known', 'readRecord', 'identityOf', 'pairRefused'] },
];

describe('admitArchive — the gate-order table', () => {
  for (const r of ROWS) {
    it(r.name, async () => {
      const asked: string[] = [];
      const out = await admitArchive('demo-a', r.world.body, probes(r.world, asked));
      expect(out).toEqual({ ok: false, gate: r.gate, word: r.word });
      expect(asked).toEqual(r.asked);
    });
  }

  it('every gate the decider names has a row above, in the decider\'s own order', () => {
    expect(ROWS.map((r) => r.gate).filter((g, i, a) => a.indexOf(g) === i)).toEqual([...ARCHIVE_GATES]);
  });

  it('admits an open world with the consents read once, and the row and identity it asked for', async () => {
    const asked: string[] = [];
    const out = await admitArchive('demo-a', { force: true, programme: 'end' }, probes(OPEN, asked));
    expect(out).toEqual({
      ok: true, flags: { force: true, interrupt: false, programmeEnd: true }, record: 'row', identity: 'who',
    });
    expect(asked).toEqual(['idSafe', 'registryListed', 'known', 'readRecord', 'identityOf', 'pairRefused']);
  });

  it('every word it refuses with has a status in the one table (REFUSAL_STATUS)', () => {
    for (const w of new Set(ROWS.map((r) => r.word))) expect(REFUSAL_STATUS).toHaveProperty([w]);
  });
});

const ARCHIVE_ROUTE = '/api/sessions/:id/archive';

describe('the archive door is a wiring (ARCH-36 acceptance)', () => {
  it('the handler holds at most five ifs: every gate is a row of admitArchive, every act is archiveAct\'s', () => {
    // The handler is the `app.post` call whose path is the archive route, found in the parsed file (no source slicing).
    const route = parsedFile('server/src/server.ts').calls
      .filter((c) => c.callee === 'app.post' && c.args[0]?.kind === 'string' && c.args[0].text === ARCHIVE_ROUTE);
    expect(route).toHaveLength(1);
    const code = parsedFile('server/src/server.ts').text.slice(route[0]!.start, route[0]!.end)
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect([...code.matchAll(/\bif\s*\(/g)].length).toBeLessThanOrEqual(5);
  });

  it('every refusal the planner can answer carries the status the one table gives its word', async () => {
    const m = { workspace: true, turn: 'idle', worktree: 'present', verbSupported: true } as const;
    const none = { force: false, interrupt: false, programmeEnd: false };
    const worlds = [
      await decideArchive(null, 'a', none, { ...m, turn: 'unmeasured' }),
      await decideArchive(null, 'a', none, { ...m, turn: 'busy' }),
      await decideArchive(null, 'a', none, { ...m, worktree: 'absent' }),
      await decideArchive(null, 'a', none, { ...m, verbSupported: false }),
    ];
    for (const w of worlds) {
      if (w.ok) throw new Error('fixture should refuse');
      expect(w.reply.status).toBe(REFUSAL_STATUS[w.reply.body.error as keyof typeof REFUSAL_STATUS]);
    }
    for (const word of Object.values(ARCHIVE_REFUSALS)) expect(REFUSAL_STATUS).toHaveProperty([word], 409);
  });
});

describe('the act-time refusals take the table status (ARCH-36 criterion 3)', () => {
  it('refusedAtStop and the 409 arm of archiveOutcome carry REFUSAL_STATUS[error]', () => {
    for (const v of ['busy', 'unmeasured'] as const) {
      const r = refusedAtStop(v, []);
      expect(r.status).toBe(REFUSAL_STATUS[(r.body as { error: keyof typeof REFUSAL_STATUS }).error]);
    }
    const o = archiveOutcome(false, [], { ok: false, stderr: 'ccd: session-busy\n' });
    expect(o.status).toBe(409);
    expect(o.status).toBe(REFUSAL_STATUS[(o.body as { error: keyof typeof REFUSAL_STATUS }).error]);
  });
});
