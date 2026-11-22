// Overlord W1, authority journal plan Tasks 8 and 9 (PR C): the fixture Confirm the restore's suites share. A fixture `coord.db`
// from the real migrations (one migrated template copied per rig), a fixture `~/.ccrc` stand-in holding the real journal file,
// the real guard booted over them, the real writers, and witness facts a test sets. Never the live HOME.
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { tx } from '../src/coord/tx.js';
import { OVERLORD_AUTHORITY_BASENAME } from '../src/coord/overlordAuthority.js';
import { OverlordAuthorityJournal, overlordAuthorityFileAt } from '../src/coord/overlordAuthorityJournal.js';
import { OverlordAuthorityGuard, runOverlordAuthorityBoot, type AuthorityBootPort } from '../src/coord/overlordAuthorityGuard.js';
import { OverlordRestoreState, preWitnessFacts, type RestoreWitnessFacts } from '../src/coord/overlordRestoreState.js';
import { bindPendingGeneration, designatePending, goLive } from '../src/coord/overlordDesignationStore.js';
import { setRungInTx } from '../src/coord/overlordLadderStore.js';
import { gateActorOf } from '../src/accounts/audit.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { fakeTime } from './fakeTime.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

export const OPERATOR = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) })
  .operator(gateActorOf('operator-a', '0123456789abcdef'));
export const NOW = 1_800_000_000_000;
export const S1 = 'overlord-quiet-otter';
export const S2 = 'overlord-brisk-heron';
export const GEN1 = '11111111-2222-3333-4444-555555555555';
export const GEN2 = '21111111-2222-3333-4444-555555555555';

let template = '';
const opened: DatabaseSync[] = [];
/** Registers the suite's hooks: one migrated template before all, every opened database closed after each case. */
export function restoreRigHooks(): void {
  beforeAll(() => {
    template = path.join(mkTmp('ccrc-overlord-restore-template-'), 'coord.db');
    openCoordDb(template).close();
  });
  afterEach(() => { for (const d of opened.splice(0)) { try { d.close(); } catch { /* closed */ } } });
  afterAll(() => removeTmpFixtures());
}

export interface Rig {
  dir: string; dbPath: string; db: DatabaseSync; journal: OverlordAuthorityJournal; guard: OverlordAuthorityGuard;
  state: OverlordRestoreState; held: { epoch: number; restoreGeneration: number }; offers: number;
  /** Close and open again (a restart): a new journal, guard and boot over the same files. */
  restart(): void;
  snapshot(withJournal: boolean): () => void;
  lines(): string[];
}

export function rig(): Rig {
  const dir = mkTmp('ccrc-overlord-restore-');
  const dbPath = path.join(dir, 'coord.db');
  copyFileSync(template, dbPath);
  const time = fakeTime({ wallMs: NOW });
  const r = { dir, dbPath, held: { epoch: 0, restoreGeneration: 0 }, offers: 0 } as Rig;
  const open = (): void => {
    const db = openCoordDb(dbPath);
    opened.push(db);
    const port: AuthorityBootPort = { healTornTail: () => journal.healTornTail(db), measure: () => journal.measure(db) };
    const guard = new OverlordAuthorityGuard(port);
    const journal = new OverlordAuthorityJournal(overlordAuthorityFileAt(dir), { clock: time.ports.clock }, guard);
    runOverlordAuthorityBoot(port, guard, () => { /* quiet */ });
    const pre = preWitnessFacts(journal);
    const witness: RestoreWitnessFacts = {
      ...pre, highest: () => ({ kind: 'measured', ...r.held }), offerNow: () => { r.offers += 1; },
    };
    Object.assign(r, { db, journal, guard, state: new OverlordRestoreState({ db, journal, guard, witness }) });
  };
  r.restart = () => { r.db.close(); open(); };
  r.snapshot = (withJournal) => {
    const snapDb = path.join(dir, `snap-${opened.length}.db`);
    r.db.exec(`VACUUM INTO '${snapDb}'`);
    const leaf = path.join(dir, OVERLORD_AUTHORITY_BASENAME);
    const snapLeaf = existsSync(leaf) ? readFileSync(leaf) : null;
    return () => {
      r.db.close();
      copyFileSync(snapDb, dbPath);
      if (withJournal && snapLeaf !== null) writeFileSync(leaf, snapLeaf);
      open();
    };
  };
  r.lines = () => {
    const leaf = path.join(dir, OVERLORD_AUTHORITY_BASENAME);
    return existsSync(leaf) ? readFileSync(leaf, 'utf8').split('\n').filter((l) => l !== '') : [];
  };
  open();
  return r;
}

export function designateLive(r: Rig, sessionId: string, generation: string): void {
  expect(designatePending(r.db, r.journal, {
    sessionId, deadlineAt: NOW + 600_000, model: 'fable', accountPools: { pools: ['pool-a', 'pool-b'], untagged: true }, actor: OPERATOR, at: NOW, opKey: `d-${sessionId}`,
  })).toEqual({ ok: true, changed: true });
  expect(bindPendingGeneration(r.db, sessionId, generation, NOW)).toMatchObject({ ok: true });
  expect(goLive(r.db, r.journal, sessionId, generation, NOW)).toMatchObject({ ok: true, changed: true });
}
export const rung = (r: Rig, from: 'off' | 'chat' | 'advise' | 'full', to: 'off' | 'chat' | 'advise' | 'full') =>
  tx(r.db, () => setRungInTx(r.db, r.journal, { from, to, actor: OPERATOR, at: NOW, opKey: `rung-${from}-${to}` }));
export const confirm = (r: Rig) => r.state.confirm(OPERATOR, `confirm-${r.lines().length}`, NOW + 1);
export const headRow = (r: Rig) => r.db.prepare('SELECT sequence FROM overlord_authority_head WHERE id = 1').get() as { sequence: number } | undefined;
export const lastEntry = (r: Rig) => JSON.parse(r.lines().at(-1)!).entry as Record<string, unknown>;
