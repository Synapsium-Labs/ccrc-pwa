// Overlord W1, authority journal plan Tasks 8 and 9 (PR C): the fixture Confirm the restore's suites share. A fixture `coord.db`
// from the real migrations (one migrated template copied per rig), a fixture `~/.ccrc` stand-in holding the real journal file,
// the real guard booted over them, the real writers, and witness facts a test sets. A test may fail the journal's next appends
// (`failAppends`: the port's write to the journal file throws) and override the witness facts. Never the live HOME.
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { tx } from '../src/coord/tx.js';
import { OVERLORD_AUTHORITY_BASENAME } from '../src/coord/overlordAuthority.js';
import { OverlordAuthorityJournal, overlordAuthorityFileAt } from '../src/coord/overlordAuthorityJournal.js';
import { NODE_APPEND_ONLY_FS, type AppendOnlyFsOps } from '../src/appendOnlyFile.js';
import { OverlordAuthorityGuard, runOverlordAuthorityBoot, type AuthorityBootPort } from '../src/coord/overlordAuthorityGuard.js';
import { OverlordRestoreState, type RestoreWitnessFacts } from '../src/coord/overlordRestoreState.js';
import { OverlordAuthorityExchange } from '../src/coord/overlordAuthorityExchange.js';
import { PRIVACY_HEAD_UNWIRED } from '../src/coord/privacyJournalHead.js';
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
  state: OverlordRestoreState; exchange: OverlordAuthorityExchange; held: { epoch: number; restoreGeneration: number } | null; offers: number;
  /** Whether the fixture carrier refuses to open, without changing its bytes. */
  unreadable: boolean;
  /** How many of the next writes to the journal file throw (the append's own write; a cut writes elsewhere). */
  failAppends: number;
  /** How many of the next truncations of the journal file throw (a cut's last step, after its bytes are kept aside). */
  failTruncates: number;
  /** Optional unit-fixture overrides over the exchange (`held` and `offers` stay the rig's). */
  witness: Partial<RestoreWitnessFacts>;
  /** Close and open again (a restart): a new journal, guard and boot over the same files. */
  restart(): void;
  snapshot(withJournal: boolean): () => void;
  lines(): string[];
}

/** Bind the real exchange methods for unit fixtures that override one of the reads. */
export function exchangeFacts(exchange: OverlordAuthorityExchange): RestoreWitnessFacts {
  return {
    epoch: (file) => exchange.epoch(file), privacy: () => exchange.privacy(), highest: () => exchange.highest(),
    told: () => exchange.told(), offerNow: () => exchange.offerNow(),
  };
}

export function rig(witnessOver: Partial<RestoreWitnessFacts> = {}): Rig {
  const dir = mkTmp('ccrc-overlord-restore-');
  const dbPath = path.join(dir, 'coord.db');
  copyFileSync(template, dbPath);
  const time = fakeTime({ wallMs: NOW });
  const r = { dir, dbPath, held: null, offers: 0, unreadable: false, failAppends: 0, failTruncates: 0, witness: witnessOver } as Rig;
  const leafPath = path.join(dir, OVERLORD_AUTHORITY_BASENAME);
  const leafFds = new Set<number>();
  const ops: AppendOnlyFsOps = {
    ...NODE_APPEND_ONLY_FS,
    openSync: (p, flags, mode) => {
      if (p === leafPath && r.unreadable) throw Object.assign(new Error('a fixture read failure'), { code: 'EACCES' });
      const fd = NODE_APPEND_ONLY_FS.openSync(p, flags, mode);
      if (p === leafPath) leafFds.add(fd); else leafFds.delete(fd);
      return fd;
    },
    closeSync: (fd) => { leafFds.delete(fd); NODE_APPEND_ONLY_FS.closeSync(fd); },
    ftruncateSync: (fd, len) => {
      if (leafFds.has(fd) && r.failTruncates > 0) { r.failTruncates -= 1; throw Object.assign(new Error('a fixture truncate failure'), { code: 'EIO' }); }
      NODE_APPEND_ONLY_FS.ftruncateSync(fd, len);
    },
    writeSync: (fd, b, o, l) => {
      if (leafFds.has(fd) && r.failAppends > 0) { r.failAppends -= 1; throw Object.assign(new Error('a fixture write failure'), { code: 'EIO' }); }
      return NODE_APPEND_ONLY_FS.writeSync(fd, b, o, l);
    },
  };
  const open = (): void => {
    const db = openCoordDb(dbPath);
    opened.push(db);
    const port: AuthorityBootPort = { healTornTail: () => journal.healTornTail(db), measure: () => journal.measure(db) };
    const guard = new OverlordAuthorityGuard(port);
    const journal = new OverlordAuthorityJournal(overlordAuthorityFileAt(dir, ops), { clock: time.ports.clock }, guard);
    runOverlordAuthorityBoot(port, guard, () => { /* quiet */ });
    const exchange = new OverlordAuthorityExchange({
      journal, guard, privacy: PRIVACY_HEAD_UNWIRED, boot: `fixture-boot-${opened.length}`,
      committedRows: () => db.isTransaction ? { kind: 'unmeasured' } : journal.readRows(db),
      agent: null, relationOf: () => 'unmeasured', warn: () => {},
    });
    const witness: RestoreWitnessFacts = {
      ...exchangeFacts(exchange),
      highest: () => r.held === null ? exchange.highest() : { kind: 'measured', ...r.held },
      offerNow: () => { r.offers += 1; exchange.offerNow(); },
      ...r.witness,
    };
    Object.assign(r, { db, journal, guard, exchange, state: new OverlordRestoreState({ db, journal, guard, witness }) });
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
