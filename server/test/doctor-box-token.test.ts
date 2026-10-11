// `ccrc doctor`'s `box-token` check (box-token lifecycle, wave 1, Task B5; spec 4.8; D-4391; armed by row 2a).
//
// THE ARMS ARE ON. Every state that is a FAIL or a WARN (held, failed, a pending value past its deadline, an owed
// rotation, proof-unmeasured, a failed boot mint, a boot recovery not yet followed by a rotation, a retired value
// presented, a broken file, an absent token) prints `FAIL box-token: …` or `WARN box-token: …` with its reason word and
// a `remedy:` line, and a FAIL counts in doctor's exit code. Wave 1 shipped them switched off (`_BT_ARMS_ON=0`, printing
// `SKIP` with its word, never PASS); row 2a flipped the constant. It stays in the file as a one-line kill switch, and
// this file keeps the SKIP branch pinned by running the same fixtures against a COPY of the checks file with the
// constant flipped back to 0 (`disarmed()`): the kill switch must print SKIP with its word, and never PASS.
// What must stay PASS is the healthy box, server, fleet and both, which the first describe measures on the shipped
// (armed) file, and a fresh box (no token, no history) is a WARN, never a FAIL (4553).
//
// HOW THE CHECK IS RUN. `ccd/ccrc` is sourced (it is source-able: its dispatch sits under the `BASH_SOURCE`
// guard), then the checks file, then `_check_box-token` alone, under a fixture HOME and a PATH holding only
// links to the real `python3` and `stat`. Nothing reaches the live `$HOME`, `gh` is unreachable by
// construction, and no network, tmux or unit is touched. The end-to-end census (the check in the table,
// counted as a skip by `cmd_doctor`) is `ccrc-doctor.test.ts`'s.
//
// NEVER A VALUE. Every fixture value is minted here at runtime (`randomBytes`), and every run's stdout and
// stderr is searched for it and for its sha256 hex.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { TOKEN_HOLDS, OWED_REASONS, TOKEN_ORIGINS } from '../../shared/box-token.js';
import { GENERATION_ID_HEX, NODE_FILES, TOKEN_SYNC_OP_ERRORS, TOKEN_TRANSPORTS } from '../../shared/agent-protocol.js';
import { TOKEN_FILE_PROBLEMS } from '../../shared/box-token.js';
import { PLACEHOLDER_TOKEN } from '../src/coord/token.js';
import { DRIVER_TICK_MS, FAILURES_FOR_BANNER, PENDING_HARD_CAP, type BoxTokenState } from '../src/token/policy.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const CCRC_SRC = join(REPO, 'ccd', 'ccrc');
const CHECKS_SRC = join(REPO, 'ccd', 'ccrc-doctor-checks');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const realBin = (name: string): string => {
  const p = spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  if (!p) throw new Error(`this box has no ${name} — the fixture needs it`);
  return p;
};

const SKIP_TAIL = '; the FAIL and WARN arms are switched off (_BT_ARMS_ON=0)';
const ID_OLD = 'a1b2c3d4e5f60718';
const ID_CUR = '0123456789abcdef';
const MIN = 60_000;

interface Box { home: string; value: string; fleetValue: string }
interface Run { code: number; stdout: string; stderr: string }

/** A copy of the shipped checks file with `_BT_ARMS_ON=1` flipped to 0 (exactly one line moves): the kill switch. */
function disarmedCopy(): string {
  const src = readFileSync(CHECKS_SRC, 'utf8');
  const flipped = src.replace(/^_BT_ARMS_ON=1$/m, '_BT_ARMS_ON=0');
  if (flipped === src) throw new Error('the checks file carries no `_BT_ARMS_ON=1` line to flip');
  const d = mkTmp('ccrc-bt-disarmed-');
  writeFileSync(join(d, 'ccrc-doctor-checks'), flipped);
  return join(d, 'ccrc-doctor-checks');
}
let DISARMED: string | null = null;
const disarmed = (): string => (DISARMED ??= disarmedCopy());

function runCheck(b: Box, checks = CHECKS_SRC): Run {
  const bin = join(b.home, 'bt-bin');
  mkdirSync(bin, { recursive: true });
  for (const n of ['python3', 'stat']) {
    try { symlinkSync(realBin(n), join(bin, n)); } catch { /* already linked by an earlier run on this box */ }
  }
  const script = ['set -uo pipefail', `. ${shq(CCRC_SRC)}`, `. ${shq(checks)}`, '_check_box-token'].join('\n');
  const r = spawnSync(BASH, ['-c', script], {
    encoding: 'utf8', env: { HOME: b.home, PATH: bin, LC_ALL: 'C', TMPDIR: join(b.home, 'tmp') },
  });
  const out = { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  // Never a value, nor its sha256 — on any path, armed or not.
  for (const v of [b.value, b.fleetValue]) {
    const hash = createHash('sha256').update(v).digest('hex');
    for (const s of [out.stdout, out.stderr]) {
      expect(s.includes(v), 'a token value reached doctor output').toBe(false);
      expect(s.includes(hash), 'a token value\'s sha256 reached doctor output').toBe(false);
    }
  }
  return out;
}

const dot = (b: Box, ...p: string[]): string => join(b.home, '.ccrc', ...p);
const fleetFile = (b: Box): string => join(b.home, '.cc-secrets', 'ccrc-mail.token');

function healthyState(now = Date.now()): BoxTokenState {
  const w = { dev: 1, ino: 2, writtenAtMs: now - 60 * MIN };
  return {
    v: 1, origin: 'rotated', rotationOwed: false, owedWhy: null,
    current: { id: ID_CUR, seq: 2, since: now - 60 * MIN, write: w },
    pending: [], previous: null, promoting: null, recovering: null,
    fleetConfirmed: ID_CUR, nextSeq: 3, lastRotationAt: now - 60 * MIN,
    failures: 0, lastFailure: null, hold: null, holdNode: null,
    lastSync: { at: now - 60 * MIN, word: 'synced', transport: 'https' },
    counters: { previousPresented: 0, retiredPresented: 0 },
    retiredRefusedAt: now - 50 * MIN, mintFailedAt: null, lastBootRecovery: null,
  };
}

/** `role` null writes no ccrc.env. The server side is mail.token (0600, one bare value line) and box-token.json;
 *  the fleet side is the fleet file (comment line, then the value), the generation file and token-sync.json. */
function box(o: { role: 'server' | 'fleet' | 'both' | null; fleet?: 'local' | 'remote'; server?: boolean; fleetSide?: boolean; agentEnv?: boolean }): Box {
  const home = mkTmp('ccrc-bt-');
  mkdirSync(join(home, '.ccrc'), { recursive: true, mode: 0o700 });
  mkdirSync(join(home, 'tmp'), { recursive: true });
  const b: Box = { home, value: randomBytes(32).toString('hex'), fleetValue: randomBytes(32).toString('hex') };
  if (o.role !== null || o.fleet !== undefined) {
    const lines = [o.role === null ? '' : `CCRC_ROLE=${o.role}`, `CCRC_FLEET=${o.fleet ?? 'local'}`, ''];
    writeFileSync(dot(b, 'ccrc.env'), lines.join('\n'), { mode: 0o600 });
  }
  const server = o.server ?? (o.role === 'server' || o.role === 'both');
  const fleetSide = o.fleetSide ?? (o.role === 'fleet' || o.role === 'both');
  if (server) {
    writeFileSync(dot(b, 'mail.token'), `${b.value}\n`, { mode: 0o600 });
    plantState(b, healthyState());
  }
  if (fleetSide) {
    mkdirSync(join(home, '.cc-secrets'), { recursive: true, mode: 0o700 });
    writeFileSync(fleetFile(b), `# ccrc box token: written by ccrc and rotated by the server; do not edit or copy it\n${b.fleetValue}\n`, { mode: 0o600 });
    writeFileSync(dot(b, NODE_FILES.tokenGeneration), `${ID_CUR}\n`, { mode: 0o600 });
    plantReport(b, {});
  }
  if (o.agentEnv ?? o.role === 'fleet') {
    writeFileSync(dot(b, 'agent.env'), 'CCRC_SERVER_URL=ws://127.0.0.1:7788\n', { mode: 0o600 });
  }
  return b;
}
function plantState(b: Box, s: BoxTokenState | string): void {
  writeFileSync(dot(b, 'box-token.json'), typeof s === 'string' ? s : JSON.stringify(s), { mode: 0o600 });
}
const editState = (b: Box, f: (s: BoxTokenState) => void): void => {
  const s = healthyState(); f(s); plantState(b, s);
};
function plantReport(b: Box, over: Record<string, unknown> | string): void {
  const base = { v: 1, at: Math.floor(Date.now() / 1000) - 3600, result: 'synced', generation: ID_CUR, transport: 'https', proof: 'proved' };
  writeFileSync(dot(b, 'token-sync.json'), typeof over === 'string' ? over : JSON.stringify({ ...base, ...over }), { mode: 0o600 });
}

const SERVER_PASS = 'server: generation #2, rotated 60 min ago, fleet confirmed, retired value refused';
const FLEET_PASS = 'fleet: token file 0600, generation recorded, last sync proved, transport https';

// ── PASS ──────────────────────────────────────────────────────────────────

describe('doctor box-token: PASS, and only on a measured healthy box', () => {
  it('server role: the generation, the age of the last rotation, and the fleet\'s confirmation', () => {
    const r = runCheck(box({ role: 'server' }));
    expect(r.stdout).toBe(`PASS box-token: ${SERVER_PASS}\n`);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('fleet role: the file, the generation, the proof and the transport', () => {
    const r = runCheck(box({ role: 'fleet' }));
    expect(r.stdout).toBe(`PASS box-token: ${FLEET_PASS}\n`);
    expect(r.code).toBe(0);
  });

  it('both role, remote: both arms on one line, joined by "; "', () => {
    const r = runCheck(box({ role: 'both', fleet: 'remote', agentEnv: true }));
    expect(r.stdout).toBe(`PASS box-token: ${SERVER_PASS}; ${FLEET_PASS}\n`);
    expect(r.code).toBe(0);
  });

  it('both role, local, no agent.env: the fleet file is the server\'s own write and needs no sync report', () => {
    const b = box({ role: 'both' });
    rmSync(dot(b, 'token-sync.json'));
    const r = runCheck(b);
    expect(r.stdout).toBe(`PASS box-token: ${SERVER_PASS}; fleet: token file 0600, generation recorded, written by this box's server\n`);
  });

  // D-4399 (plan assembly): the README's single-box agent.env (CCRC_SERVER_URL only) does not
  // make a fleet box; a CCRC_AGENT_TOKEN key does, and then the fleet arm reads the sync report.
  it("both role, local, the README's agent.env (CCRC_SERVER_URL only): still the server's own write", () => {
    const b = box({ role: 'both', agentEnv: true });
    rmSync(dot(b, 'token-sync.json'));
    expect(runCheck(b).stdout).toBe(`PASS box-token: ${SERVER_PASS}; fleet: token file 0600, generation recorded, written by this box's server\n`);
  });

  it('both role, local, an agent.env carrying CCRC_AGENT_TOKEN: the fleet arm reads the sync report, and the key\'s value is never printed', () => {
    const b = box({ role: 'both' });
    const agentTok = randomBytes(32).toString('hex');
    writeFileSync(dot(b, 'agent.env'), `CCRC_SERVER_URL=ws://127.0.0.1:7788\n${['CCRC', 'AGENT', 'TOKEN'].join('_')}=${agentTok}\n`, { mode: 0o600 });
    const r = runCheck(b);
    expect(r.stdout).toBe(`PASS box-token: ${SERVER_PASS}; ${FLEET_PASS}\n`);
    expect(r.stdout.includes(agentTok) || r.stderr.includes(agentTok)).toBe(false);
  });

  it('a minted value that has not rotated yet says so rather than naming a rotation', () => {
    const b = box({ role: 'server' });
    editState(b, (s) => { s.origin = 'minted'; s.lastRotationAt = null; s.current.seq = 1; s.retiredRefusedAt = null; });
    // No `, retired value refused` tail before the first retirement (spec 10.3; plan assembly).
    expect(runCheck(b).stdout).toBe('PASS box-token: server: generation #1, minted 60 min ago (no rotation yet), fleet confirmed\n');
  });

  it('transport http is printed on the PASS line and never changes the verdict, armed or disarmed', () => {
    const b = box({ role: 'fleet' });
    plantReport(b, { transport: 'http' });
    const want = 'PASS box-token: fleet: token file 0600, generation recorded, last sync proved, transport http\n';
    for (const checks of [CHECKS_SRC, disarmed()]) {
      const r = runCheck(b, checks);
      expect(r.stdout).toBe(want);
      expect(r.code).toBe(0);
    }
  });
});

// ── every armed state: FAIL or WARN with its word (SKIP only in the disarmed copy) ──

interface Row { label?: string; word: string; arm: 'server' | 'fleet'; armedClass: 'FAIL' | 'WARN'; plant: (b: Box) => void }
const now = (): number => Date.now();
const ROWS: Row[] = [
  // 4553 (Decision 2 (a)): the armed class of an absent token comes from the box's history, read after the state read.
  // A server that has a state file once held a value and lost it: FAIL. One with no state file has never run the
  // lifecycle: WARN. A state it cannot read still says there was one: FAIL (fail closed).
  { arm: 'server', word: 'token-absent', label: 'token-absent (with history: a state file)', armedClass: 'FAIL', plant: (b) => rmSync(dot(b, 'mail.token')) },
  { arm: 'server', word: 'token-absent', label: 'token-absent (with history: a state file it cannot read)', armedClass: 'FAIL',
    plant: (b) => { rmSync(dot(b, 'mail.token')); plantState(b, '{"v":1,'); } },
  { arm: 'server', word: 'token-absent', label: 'token-absent (fresh: no state file either)', armedClass: 'WARN',
    plant: (b) => { rmSync(dot(b, 'mail.token')); rmSync(dot(b, 'box-token.json')); } },
  { arm: 'server', word: 'token-mode', armedClass: 'FAIL', plant: (b) => chmodSync(dot(b, 'mail.token'), 0o644) },
  { arm: 'server', word: 'token-unusable', armedClass: 'FAIL', plant: (b) => writeFileSync(dot(b, 'mail.token'), '# no value line\n\n', { mode: 0o600 }) },
  { arm: 'server', word: 'token-unusable', label: 'token-unusable (the shipped placeholder)', armedClass: 'FAIL',
    plant: (b) => writeFileSync(dot(b, 'mail.token'), `# comment first\n${PLACEHOLDER_TOKEN}\n`, { mode: 0o600 }) },
  { arm: 'server', word: 'state-absent', armedClass: 'WARN', plant: (b) => rmSync(dot(b, 'box-token.json')) },
  { arm: 'server', word: 'state-unreadable', armedClass: 'FAIL', plant: (b) => plantState(b, '{"v":1,') },
  // Fix round 1 (minor 4): `v` must be the integer 1, and a `retiring` entry must be {sha256: 64 hex, at: number}.
  { arm: 'server', word: 'state-unreadable', label: 'state-unreadable (v is true)', armedClass: 'FAIL', plant: (b) => plantState(b, JSON.stringify({ ...healthyState(), v: true })) },
  { arm: 'server', word: 'state-unreadable', label: 'state-unreadable (a malformed retiring entry)', armedClass: 'FAIL',
    plant: (b) => editState(b, (s) => { s.retiring = [{ sha256: 'zz', at: now() }]; }) },
  { arm: 'server', word: 'mint-failed', armedClass: 'FAIL', plant: (b) => editState(b, (s) => { s.mintFailedAt = now(); s.hold = 'mint-failed'; }) },
  { arm: 'server', word: 'held:update-in-flight', armedClass: 'WARN', plant: (b) => editState(b, (s) => { s.hold = 'update-in-flight'; s.holdNode = 'node-fleet-1'; }) },
  { arm: 'server', word: 'held:verb-missing', armedClass: 'WARN', plant: (b) => editState(b, (s) => { s.hold = 'verb-missing'; }) },
  { arm: 'server', word: 'failed:claim-refused', armedClass: 'WARN', plant: (b) => editState(b, (s) => { s.failures = FAILURES_FOR_BANNER - 1; s.lastFailure = 'claim-refused'; }) },
  { arm: 'server', word: 'failed:timeout', armedClass: 'FAIL', plant: (b) => editState(b, (s) => { s.failures = FAILURES_FOR_BANNER; s.lastFailure = 'timeout'; }) },
  { arm: 'server', word: 'pending-overdue', armedClass: 'WARN', plant: (b) => editState(b, (s) => {
    s.pending = [{ id: ID_OLD, seq: 3, stagedAt: now() - 12 * MIN, handedOutAt: now() - 10 * MIN, confirmBy: now() - 5 * MIN, write: { dev: 1, ino: 3, writtenAtMs: now() - 12 * MIN } }];
  }) },
  // The leaked value's own state after Part A boots: adopted, owed, never rotated.
  { arm: 'server', word: 'rotation-owed:adopted', armedClass: 'WARN', plant: (b) => editState(b, (s) => {
    s.origin = 'adopted'; s.rotationOwed = true; s.owedWhy = 'adopted'; s.current = { id: null, seq: 1, since: now() - 60 * MIN, write: null };
    s.lastRotationAt = null; s.fleetConfirmed = null; s.lastSync = null; s.retiredRefusedAt = null;
  }) },
  { arm: 'server', word: 'rotation-owed:retired-written-back', armedClass: 'WARN', plant: (b) => editState(b, (s) => { s.rotationOwed = true; s.owedWhy = 'retired-written-back'; }) },
  // D-4412 (Part A, merged after the brief): a retired value presented owes one bounded forward rotation.
  { arm: 'server', word: 'rotation-owed:retired-presented', armedClass: 'WARN', plant: (b) => editState(b, (s) => { s.rotationOwed = true; s.owedWhy = 'retired-presented'; }) },
  { arm: 'server', word: 'proof-unmeasured', armedClass: 'WARN', plant: (b) => editState(b, (s) => { s.lastSync = { at: now() - MIN, word: 'proof-unmeasured', transport: 'https' }; }) },
  // D-4551 (fix round 1): the two stalled retirements merged Part A can reach. Minutes are floored, so 30 and 45 exactly.
  { arm: 'server', word: 'retire-overdue:30', armedClass: 'FAIL', plant: (b) => editState(b, (s) => {
    s.previous = { id: ID_OLD, seq: 1, graceUntil: now() - 90 * MIN, hardUntil: now() - 30 * MIN, currentPresented: false, write: { dev: 1, ino: 4, writtenAtMs: now() - 90 * MIN } };
  }) },
  { arm: 'server', word: 'retiring-unlanded:45', armedClass: 'FAIL', plant: (b) => editState(b, (s) => { s.retiring = [{ sha256: 'ab'.repeat(32), at: now() - 45 * MIN }]; }) },
  { arm: 'server', word: 'recovered', armedClass: 'WARN', plant: (b) => editState(b, (s) => { s.lastBootRecovery = { at: now() - MIN, source: 'previous' }; }) },
  // 4552 (Option A): a retired presentation is a finding only while it is unanswered, newer than the last rotation.
  { arm: 'server', word: 'retired-presented', label: 'retired-presented (unanswered: newer than the last rotation)', armedClass: 'FAIL',
    plant: (b) => editState(b, (s) => { s.counters = { previousPresented: 0, retiredPresented: 2, retiredPresentedAt: s.lastRotationAt! + MIN }; }) },
  { arm: 'server', word: 'retired-presented', label: 'retired-presented (a state from before 4552: a count, no stamp)', armedClass: 'FAIL',
    plant: (b) => editState(b, (s) => { s.counters = { previousPresented: 0, retiredPresented: 2 }; }) },
  { arm: 'server', word: 'retired-presented', label: 'retired-presented (after a restart: count 0, the stamp unanswered)', armedClass: 'FAIL',
    plant: (b) => editState(b, (s) => { s.counters = { previousPresented: 0, retiredPresented: 0, retiredPresentedAt: s.lastRotationAt! + MIN }; }) },
  { arm: 'server', word: 'retired-presented', label: 'retired-presented (a count with a null stamp)', armedClass: 'FAIL',
    plant: (b) => editState(b, (s) => { s.counters = { previousPresented: 0, retiredPresented: 1, retiredPresentedAt: null }; }) },
  // `lr is None or rp > lr`: a server that has never completed a rotation has no answer to a stamped presentation.
  { arm: 'server', word: 'retired-presented', label: 'retired-presented (no rotation has completed: a stamp, lastRotationAt null)', armedClass: 'FAIL',
    plant: (b) => editState(b, (s) => { s.lastRotationAt = null; s.counters = { previousPresented: 0, retiredPresented: 0, retiredPresentedAt: now() - MIN }; }) },
  { arm: 'server', word: 'fleet-behind', armedClass: 'WARN', plant: (b) => editState(b, (s) => { s.fleetConfirmed = ID_OLD; }) },
  // Added at plan assembly (review findings):
  { arm: 'server', word: 'fleet-unconfirmed', armedClass: 'WARN', plant: (b) => editState(b, (s) => { s.current.id = null; s.fleetConfirmed = null; }) },
  { arm: 'server', word: 'file:changed', armedClass: 'FAIL', plant: (b) => editState(b, (s) => { s.fileProblem = { at: now() - MIN, file: 'current', word: 'changed' }; }) },
  { arm: 'server', word: 'file:retired', armedClass: 'FAIL', plant: (b) => editState(b, (s) => { s.fileProblem = { at: now() - MIN, file: 'current', word: 'retired' }; }) },
  // 4553: a fleet box that was never handed a value (no generation file and no sync report) WARNs; any trace of a
  // handed value (either file, readable or not) makes the lost token a FAIL.
  { arm: 'fleet', word: 'fleet-token-absent', label: 'fleet-token-absent (with history: a generation file and a sync report)', armedClass: 'FAIL', plant: (b) => rmSync(fleetFile(b)) },
  { arm: 'fleet', word: 'fleet-token-absent', label: 'fleet-token-absent (with history: a sync report only)', armedClass: 'FAIL',
    plant: (b) => { rmSync(fleetFile(b)); rmSync(dot(b, NODE_FILES.tokenGeneration)); } },
  { arm: 'fleet', word: 'fleet-token-absent', label: 'fleet-token-absent (with history: a generation file only)', armedClass: 'FAIL',
    plant: (b) => { rmSync(fleetFile(b)); rmSync(dot(b, 'token-sync.json')); } },
  { arm: 'fleet', word: 'fleet-token-absent', label: 'fleet-token-absent (with history: a sync report it cannot read, no generation file)', armedClass: 'FAIL',
    plant: (b) => { rmSync(fleetFile(b)); rmSync(dot(b, NODE_FILES.tokenGeneration)); plantReport(b, '{"v":2}'); } },
  { arm: 'fleet', word: 'fleet-token-absent', label: 'fleet-token-absent (fresh: no generation file and no sync report)', armedClass: 'WARN',
    plant: (b) => { rmSync(fleetFile(b)); rmSync(dot(b, NODE_FILES.tokenGeneration)); rmSync(dot(b, 'token-sync.json')); } },
  { arm: 'fleet', word: 'fleet-token-mode', armedClass: 'FAIL', plant: (b) => chmodSync(fleetFile(b), 0o640) },
  { arm: 'fleet', word: 'fleet-token-unusable', armedClass: 'FAIL', plant: (b) => writeFileSync(fleetFile(b), '# comment only\n', { mode: 0o600 }) },
  // R.1 (run 377, Task R): the file `deploy/ccrc-mail.token.example` ships, copied and never edited, is no token.
  // The comparison is on the trimmed value, the way `extractToken` trims (a BOM or a no-break space in front still
  // reads as the placeholder, since the server's reader would call it the placeholder too).
  { arm: 'fleet', word: 'fleet-token-unusable', label: 'fleet-token-unusable (the shipped placeholder)', armedClass: 'FAIL',
    plant: (b) => writeFileSync(fleetFile(b), `# comment first\n${PLACEHOLDER_TOKEN}\n`, { mode: 0o600 }) },
  { arm: 'fleet', word: 'fleet-token-unusable', label: 'fleet-token-unusable (the placeholder behind a BOM)', armedClass: 'FAIL',
    plant: (b) => writeFileSync(fleetFile(b), Buffer.from(`\uFEFF${PLACEHOLDER_TOKEN}\n`), { mode: 0o600 }) },
  { arm: 'fleet', word: 'fleet-token-unusable', label: 'fleet-token-unusable (the placeholder behind a no-break space)', armedClass: 'FAIL',
    plant: (b) => writeFileSync(fleetFile(b), Buffer.from(`\u00A0${PLACEHOLDER_TOKEN}\u00A0\n`), { mode: 0o600 }) },
  // Review I1 (Task R): extractToken trims FIRST and only then tells a blank or `#` line apart, so a BOM ahead of the
  // preamble (or of a blank line) still leaves the placeholder as the value line it picks. The first row reads the
  // actual shipped example, so the shipped bytes themselves are under test.
  { arm: 'fleet', word: 'fleet-token-unusable', label: 'fleet-token-unusable (a BOM, then the actual shipped example file)', armedClass: 'FAIL',
    plant: (b) => writeFileSync(fleetFile(b), Buffer.concat([Buffer.from('\uFEFF'), readFileSync(join(REPO, 'deploy', 'ccrc-mail.token.example'))]), { mode: 0o600 }) },
  { arm: 'fleet', word: 'fleet-token-unusable', label: 'fleet-token-unusable (a BOM before the # comment line)', armedClass: 'FAIL',
    plant: (b) => writeFileSync(fleetFile(b), Buffer.from(`\uFEFF# comment\n${PLACEHOLDER_TOKEN}\n`), { mode: 0o600 }) },
  { arm: 'fleet', word: 'fleet-token-unusable', label: 'fleet-token-unusable (a BOM-only line before the placeholder)', armedClass: 'FAIL',
    plant: (b) => writeFileSync(fleetFile(b), Buffer.from(`\uFEFF\n${PLACEHOLDER_TOKEN}\n`), { mode: 0o600 }) },
  { arm: 'fleet', word: 'no-generation', armedClass: 'WARN', plant: (b) => rmSync(dot(b, NODE_FILES.tokenGeneration)) },
  { arm: 'fleet', word: 'generation-malformed', armedClass: 'WARN', plant: (b) => writeFileSync(dot(b, NODE_FILES.tokenGeneration), 'not-an-id\n') },
  { arm: 'fleet', word: 'never-synced', armedClass: 'WARN', plant: (b) => rmSync(dot(b, 'token-sync.json')) },
  { arm: 'fleet', word: 'sync:claim-refused', armedClass: 'WARN', plant: (b) => plantReport(b, { result: 'claim-refused', generation: null, transport: 'https', proof: null }) },
  { arm: 'fleet', word: 'sync:stale-client', armedClass: 'WARN', plant: (b) => plantReport(b, { result: 'stale-client', generation: null, transport: null, proof: null }) },
  { arm: 'fleet', word: 'proof-unmeasured', armedClass: 'WARN', plant: (b) => plantReport(b, { result: 'proof-unmeasured', proof: 'proof-unmeasured' }) },
  { arm: 'fleet', word: 'sync-unreadable', armedClass: 'WARN', plant: (b) => plantReport(b, '{"v":2}') },
];

describe('doctor box-token: disarmed in a copy, every armed state is SKIP with its word (the kill switch)', () => {
  for (const row of ROWS) {
    it(`${row.arm}: ${row.label ?? row.word}`, () => {
      const b = box({ role: row.arm });
      row.plant(b);
      const r = runCheck(b, disarmed());
      const lines = r.stdout.split('\n').filter(Boolean);
      expect(lines, r.stdout).toHaveLength(1);
      expect(lines[0]).toMatch(/^SKIP box-token: /);
      expect(lines[0]).toContain(`${row.arm}: ${row.word} — `);
      expect(lines[0]!.endsWith(SKIP_TAIL), lines[0]).toBe(true);
      expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) /m);
      expect(r.stdout).not.toMatch(/remedy:/);
      expect(r.code).toBe(3);
      expect(r.stderr).toBe('');
    });
  }
});

// ── a rotation answers a retired presentation (4552, Decision 1 Option A) ──

describe('doctor box-token: a rotation answers a retired presentation (4552)', () => {
  const plantCounters = (b: Box, f: (lr: number) => { retiredPresented: number; retiredPresentedAt?: number | null }): void =>
    editState(b, (s) => { s.counters = { previousPresented: 0, ...f(s.lastRotationAt!) }; });
  const finding = (b: Box, checks: string): string => {
    const r = runCheck(b, checks);
    const lines = r.stdout.split('\n').filter(Boolean);
    return lines[0] ?? '';
  };

  for (const name of ['shipped (armed)', 'disarmed'] as const) {
    describe(name, () => {
      // Resolved per case, so a checks file with no `_BT_ARMS_ON=1` line reds the cases instead of the whole collection.
      const checksFile = (): string => (name === 'disarmed' ? disarmed() : CHECKS_SRC);
      const wantFinding = (line: string): void => {
        if (name !== 'disarmed') expect(line).toMatch(/^FAIL box-token: /);
        else expect(line).toMatch(/^SKIP box-token: /);
        expect(line).toContain('server: retired-presented — ');
      };
      const wantPass = (b: Box): void => {
        const r = runCheck(b, checksFile());
        expect(r.stdout).toBe(`PASS box-token: ${SERVER_PASS}\n`);
        expect(r.code).toBe(0);
      };

      it('a stamp older than the last rotation, with a count, is answered: PASS', () => {
        const b = box({ role: 'server' });
        plantCounters(b, (lr) => ({ retiredPresented: 2, retiredPresentedAt: lr - 10 * MIN }));
        wantPass(b);
      });

      it('a null stamp with count 0 is PASS, and so is an absent key with count 0', () => {
        const b = box({ role: 'server' });
        plantCounters(b, () => ({ retiredPresented: 0, retiredPresentedAt: null }));
        wantPass(b);
        plantCounters(b, () => ({ retiredPresented: 0 }));
        wantPass(b);
      });

      it('edge: a stamp 30 s before the last rotation is PASS, 30 s after it is a finding', () => {
        const b = box({ role: 'server' });
        plantCounters(b, (lr) => ({ retiredPresented: 0, retiredPresentedAt: lr - 30_000 }));
        wantPass(b);
        plantCounters(b, (lr) => ({ retiredPresented: 0, retiredPresentedAt: lr + 30_000 }));
        wantFinding(finding(b, checksFile()));
      });

      // 'x' alone would also red with the validator gone (a str-int comparison crashes the reader into the same
      // word), so the values that compare quietly are the pin: true, a negative, a float.
      it("a stamp that is not a non-negative integer or null is 'server: state-unreadable'", () => {
        for (const bad of ['x', true, -5, 1.5]) {
          const b = box({ role: 'server' });
          editState(b, (s) => { (s.counters as unknown as Record<string, unknown>).retiredPresentedAt = bad; });
          const line = finding(b, checksFile());
          expect(line, String(bad)).toContain('server: state-unreadable — ');
          expect(line, String(bad)).not.toContain('retired-presented');
        }
      });
    });
  }

  it('the sentence: a stamped finding says how long ago and that no rotation has completed; a stampless one says it records no time', () => {
    const stamped = box({ role: 'server' });
    plantCounters(stamped, (lr) => ({ retiredPresented: 2, retiredPresentedAt: lr + MIN }));
    const a = runCheck(stamped, CHECKS_SRC);
    expect(a.stdout).toContain('ago and no rotation has completed since');
    expect(a.stdout).toContain('(2 since the server started)');
    const legacy = box({ role: 'server' });
    plantCounters(legacy, () => ({ retiredPresented: 2 }));
    expect(runCheck(legacy, CHECKS_SRC).stdout).toContain('records no time for it');
    const nul = box({ role: 'server' });
    plantCounters(nul, () => ({ retiredPresented: 1, retiredPresentedAt: null }));
    expect(runCheck(nul, CHECKS_SRC).stdout).toContain('records no time for it');
  });

  it('the remedy names no hand rotation and says what clears the line', () => {
    const b = box({ role: 'server' });
    plantCounters(b, (lr) => ({ retiredPresented: 2, retiredPresentedAt: lr + MIN }));
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toMatch(/remedy: .*this line clears when that rotation completes/);
    expect(r.stdout).not.toMatch(/resync that box/);
    expect(r.stdout).not.toMatch(/Rotate now/);
  });
});

describe('doctor box-token: the placeholder fleet file (R.1)', () => {
  it('the sentence names the placeholder, not a missing value line; a fleet-role box runs no server arm', () => {
    const b = box({ role: 'fleet' });
    writeFileSync(fleetFile(b), `# comment first\n${PLACEHOLDER_TOKEN}\n`, { mode: 0o600 });
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toContain('fleet: fleet-token-unusable — ');
    expect(r.stdout).toContain('placeholder');
    expect(r.stdout).not.toContain('carries no value line');
    expect(r.stdout).not.toContain(PLACEHOLDER_TOKEN);
  });

  it('a server-role mail.token holding the placeholder is FAIL token-unusable, never PASS: the server refuses to boot on it (final review, Minor 2)', () => {
    const b = box({ role: 'server' });
    writeFileSync(dot(b, 'mail.token'), `${PLACEHOLDER_TOKEN}\n`, { mode: 0o600 });
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toMatch(/^FAIL box-token: server: token-unusable — /);
    expect(r.stdout).toContain('placeholder');
    expect(r.stdout).not.toMatch(/^PASS /m);
    expect(r.stdout).not.toContain(PLACEHOLDER_TOKEN);
    expect(r.code).toBe(1);
  });

  it('a real-looking value that merely starts like the placeholder is still ok', () => {
    const b = box({ role: 'fleet' });
    writeFileSync(fleetFile(b), `${PLACEHOLDER_TOKEN}-x\n`, { mode: 0o600 });
    expect(runCheck(b, CHECKS_SRC).stdout).toBe(`PASS box-token: ${FLEET_PASS}\n`);
  });
});

describe('doctor box-token: the FAIL and WARN arms are on in the shipped file', () => {
  for (const row of ROWS) {
    it(`${row.arm}: ${row.label ?? row.word} -> ${row.armedClass}`, () => {
      const b = box({ role: row.arm });
      row.plant(b);
      const r = runCheck(b, CHECKS_SRC);
      const lines = r.stdout.split('\n').filter(Boolean);
      expect(lines, r.stdout).toHaveLength(2);
      expect(lines[0]).toMatch(new RegExp(`^${row.armedClass} box-token: `));
      expect(lines[0]).toContain(`${row.arm}: ${row.word} — `);
      expect(lines[0]).not.toContain(SKIP_TAIL);
      expect(lines[1]).toMatch(/^ {2}remedy: \S/);
      expect(r.code).toBe(row.armedClass === 'FAIL' ? 1 : 2);
    });
  }

  it('the shipped file carries the constant once, on', () => {
    const src = readFileSync(CHECKS_SRC, 'utf8');
    expect(src.match(/^_BT_ARMS_ON=.*$/gm)).toEqual(['_BT_ARMS_ON=1']);
  });
});

// ── arms by role ──────────────────────────────────────────────────────────

describe('doctor box-token: which arm runs', () => {
  it('a CCRC_ROLE=server box runs the server arm: D-3111\'s server-role skip never covers this check', () => {
    const r = runCheck(box({ role: 'server' }));
    expect(r.stdout).toMatch(/^PASS box-token: server: /);
    expect(r.stdout).not.toMatch(/hosts no sessions/);
  });

  it('both arms on one line, the worse verdict wins: a healthy server and a never-synced fleet is WARN, rc 2 and no SKIP tail; disarmed it is SKIP, rc 3', () => {
    const b = box({ role: 'both', fleet: 'remote', agentEnv: true });
    rmSync(dot(b, 'token-sync.json'));
    const r = runCheck(b);
    expect(r.stdout).toMatch(/^WARN box-token: server: generation #2.*; fleet: never-synced — /);
    expect(r.stdout).not.toContain(SKIP_TAIL);
    expect(r.stdout).toMatch(/\n {2}remedy: \S/);
    expect(r.code).toBe(2);
    const d = runCheck(b, disarmed());
    expect(d.stdout).toMatch(new RegExp(`^SKIP box-token: ${SERVER_PASS}; fleet: never-synced — .*${SKIP_TAIL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n$`));
    expect(d.code).toBe(3);
  });

  it('no role recorded: the server arm when a server-side file exists, the fleet arm when agent.env does', () => {
    const s = box({ role: null, server: true });
    expect(runCheck(s).stdout).toBe(`PASS box-token: ${SERVER_PASS}\n`);
    const f = box({ role: null, fleetSide: true, agentEnv: true });
    expect(runCheck(f).stdout).toBe(`PASS box-token: ${FLEET_PASS}\n`);
  });

  it('no role recorded and nothing of either side: SKIP no-role, armed or disarmed', () => {
    for (const checks of [CHECKS_SRC, disarmed()]) {
      const r = runCheck(box({ role: null }), checks);
      expect(r.stdout).toMatch(/^SKIP box-token: no-role — /);
      expect(r.stdout).not.toContain(SKIP_TAIL);
      expect(r.code).toBe(3);
    }
  });
});

// ── the shell's words are L0's ─────────────────────────────────────────────

// The state record's shape is `isBoxTokenState`'s as merged (D-4413: three pending slots; D-4414: `retiring`).
describe('doctor box-token: the state shape is the merged one', () => {
  it('three pending entries (the cap exit) and a retiring record are readable, not state-unreadable', () => {
    const b = box({ role: 'server' });
    editState(b, (s) => {
      const t = now() - 20 * MIN;
      s.pending = Array.from({ length: PENDING_HARD_CAP }, (_, k) => k + 1).map((i) => ({ id: `${i}`.repeat(16), seq: 2 + i, stagedAt: t, handedOutAt: t, confirmBy: t + 5 * MIN, write: { dev: 1, ino: 10 + i, writtenAtMs: t } }));
      s.retiring = [{ sha256: 'ab'.repeat(32), at: now() }];   // fresh: the append is about to land
    });
    const r = runCheck(b);
    expect(r.stdout).toMatch(/^WARN box-token: server: pending-overdue — /);
    expect(r.stdout).not.toContain('state-unreadable');
  });

  it('one more than PENDING_HARD_CAP pending entries are refused as the server refuses them', () => {
    const b = box({ role: 'server' });
    editState(b, (s) => {
      const t = now() - 20 * MIN;
      s.pending = Array.from({ length: PENDING_HARD_CAP + 1 }, (_, k) => k + 1).map((i) => ({ id: `${i}`.repeat(16), seq: 2 + i, stagedAt: t, handedOutAt: t, confirmBy: t + 5 * MIN, write: { dev: 1, ino: 10 + i, writtenAtMs: t } }));
    });
    expect(runCheck(b).stdout).toMatch(/^FAIL box-token: server: state-unreadable — /);
  });
});

describe('doctor box-token: a retirement in grace is not a retirement past its hard bound (D-4551)', () => {
  const prev = (graceUntil: number, hardUntil: number): BoxTokenState['previous'] =>
    ({ id: ID_OLD, seq: 1, graceUntil, hardUntil, currentPresented: false, write: { dev: 1, ino: 4, writtenAtMs: now() - 90 * MIN } });

  it('a previous value inside its hard bound still says "in grace" on the PASS line', () => {
    const b = box({ role: 'server' });
    editState(b, (s) => { s.previous = prev(now() + 2 * MIN, now() + 20 * MIN); });
    expect(runCheck(b).stdout).toBe(`PASS box-token: ${SERVER_PASS}, the previous value in grace\n`);
  });

  it('a previous value past hardUntil but inside one driver tick of slack prints neither "in grace" nor a finding', () => {
    const b = box({ role: 'server' });
    editState(b, (s) => { s.previous = prev(now() - 20 * MIN, now() - Math.floor(DRIVER_TICK_MS / 2)); });
    const out = runCheck(b).stdout;
    expect(out).not.toContain('in grace');
    expect(out).not.toContain('retire-overdue');
  });

  it('a retiring digest younger than two ticks is the append about to land: no finding, and no "retired value refused" lie either', () => {
    const b = box({ role: 'server' });
    editState(b, (s) => { s.retiring = [{ sha256: 'cd'.repeat(32), at: now() - DRIVER_TICK_MS }]; });
    expect(runCheck(b).stdout).toBe(`PASS box-token: ${SERVER_PASS}\n`);
  });

  it('retire-overdue wins over a PASS tail and is never "in grace": the FAIL line names it and has no PASS part', () => {
    const b = box({ role: 'server' });
    editState(b, (s) => { s.previous = prev(now() - 90 * MIN, now() - 30 * MIN); });
    const out = runCheck(b).stdout;
    expect(out).toMatch(/^FAIL box-token: server: retire-overdue:30 — /);
    expect(out).not.toContain('in grace');
    expect(out).not.toContain('retired value refused');
  });
});

describe('doctor box-token: where the files are, and what marks a fleet box (D-4399)', () => {
  it('CCRC_MAIL_TOKEN_PATH places mail.token and box-token.json beside a non-default path', () => {
    const b = box({ role: 'server' });
    const alt = join(b.home, 'alt-dir');
    mkdirSync(alt, { recursive: true });
    renameSync(dot(b, 'mail.token'), join(alt, 'custom.token'));
    renameSync(dot(b, 'box-token.json'), join(alt, 'box-token.json'));
    writeFileSync(dot(b, 'ccrc.env'), `CCRC_ROLE=server\nCCRC_FLEET=local\nCCRC_MAIL_TOKEN_PATH=${join(alt, 'custom.token')}\n`, { mode: 0o600 });
    expect(runCheck(b).stdout).toBe(`PASS box-token: ${SERVER_PASS}\n`);
    // The same override with the files left at the default place: both are absent where the check looks.
    const c = box({ role: 'server' });
    writeFileSync(dot(c, 'ccrc.env'), `CCRC_ROLE=server\nCCRC_FLEET=local\nCCRC_MAIL_TOKEN_PATH=${join(c.home, 'elsewhere', 'custom.token')}\n`, { mode: 0o600 });
    const out = runCheck(c).stdout;
    expect(out).toContain('server: token-absent — ');
    expect(out).toContain('server: state-absent — ');
  });

  const bothLocal = (): Box => { const b = box({ role: 'both' }); rmSync(dot(b, 'token-sync.json')); return b; };
  it('an `export CCRC_AGENT_TOKEN=` line marks a fleet box: the sync report is read, so its absence is never-synced', () => {
    const b = bothLocal();
    writeFileSync(dot(b, 'agent.env'), `export ${['CCRC', 'AGENT', 'TOKEN'].join('_')}=${randomBytes(8).toString('hex')}\n`, { mode: 0o600 });
    const out = runCheck(b).stdout;
    expect(out).toContain('fleet: never-synced — ');
  });
  it('a key that only ends in CCRC_AGENT_TOKEN, or a value that names it, does not mark a fleet box', () => {
    const b = bothLocal();
    writeFileSync(dot(b, 'agent.env'), 'XCCRC_AGENT_TOKEN=x\nCCRC_SERVER_URL=ws://127.0.0.1:7788 # CCRC_AGENT_TOKEN=y\n', { mode: 0o600 });
    expect(runCheck(b).stdout).toContain("written by this box's server");
  });
  it('an agent.env that cannot be read as a regular file marks a fleet box (unknown is the safe answer)', () => {
    const b = bothLocal();
    mkdirSync(dot(b, 'agent.env'));   // present, not a regular file
    expect(runCheck(b).stdout).toContain('fleet: never-synced — ');
    if (process.getuid && process.getuid() !== 0) {
      const c = bothLocal();
      writeFileSync(dot(c, 'agent.env'), 'CCRC_SERVER_URL=ws://127.0.0.1:7788\n', { mode: 0o000 });
      expect(runCheck(c).stdout).toContain('fleet: never-synced — ');
    }
  });
});

// 4553: the history is read from the arm's own reads, so it holds on the both-role box whose fleet file is its server's own write.
describe('doctor box-token: a fresh box WARNs, a box that lost its value FAILs (4553)', () => {
  it('both role, local: no fleet file, no generation file, no state and no mail.token is two WARN findings, rc 2', () => {
    const b = box({ role: 'both' });
    for (const f of [fleetFile(b), dot(b, NODE_FILES.tokenGeneration), dot(b, 'token-sync.json'), dot(b, 'mail.token'), dot(b, 'box-token.json')]) rmSync(f);
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toMatch(/^WARN box-token: server: token-absent — .*; server: state-absent — .*; fleet: fleet-token-absent — /);
    expect(r.stdout).not.toMatch(/^FAIL /m);
    expect(r.code).toBe(2);
  });
  it('both role, local: the same box with a generation file left behind is a FAIL on the fleet arm', () => {
    const b = box({ role: 'both' });
    for (const f of [fleetFile(b), dot(b, 'token-sync.json'), dot(b, 'mail.token'), dot(b, 'box-token.json')]) rmSync(f);
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toMatch(/^FAIL box-token: server: token-absent — .*; fleet: fleet-token-absent — /);
    expect(r.code).toBe(1);
  });
  it('both role, remote: the worse arm wins, so a fresh server with a fleet that lost its value is a FAIL', () => {
    const b = box({ role: 'both', fleet: 'remote', agentEnv: true });
    for (const f of [fleetFile(b), dot(b, 'mail.token'), dot(b, 'box-token.json')]) rmSync(f);
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toMatch(/^FAIL box-token: /);
    expect(r.code).toBe(1);
  });
});

describe('doctor box-token: every python this check runs is isolated (security)', () => {
  it('each `python3 … -c` in the box-token block is `python3 -I -c`, and there are at least two', () => {
    const src = readFileSync(CHECKS_SRC, 'utf8');
    const block = src.slice(src.indexOf('# ── box-token: the box token'));
    expect(block.length).toBeGreaterThan(1000);
    const code = block.split('\n').filter((l) => !/^\s*#/.test(l));
    const calls = code.filter((l) => /python3\s+-/.test(l));
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const l of calls) expect(l, 'python3 without -I').toMatch(/python3 -I -c "\$_BT_PY_/);
  });
});

describe('doctor box-token: the shell spellings are pinned to L0', () => {
  const arr = (name: string): string[] => {
    const r = spawnSync(BASH, ['-c', `set -uo pipefail; . ${shq(CHECKS_SRC)}; printf '%s\\n' "\${${name}[@]}"`], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const words = r.stdout.split('\n').filter(Boolean);
    expect(words.length, `${name} is empty: a scan over an empty list passes everything`).toBeGreaterThan(0);
    return words;
  };
  it('holds, owed reasons, origins, sync errors and transports', () => {
    expect(arr('_BT_HOLDS')).toEqual([...TOKEN_HOLDS]);
    expect(arr('_BT_OWED')).toEqual([...OWED_REASONS]);
    expect(arr('_BT_ORIGINS')).toEqual([...TOKEN_ORIGINS]);
    expect(arr('_BT_SYNC_ERRORS')).toEqual([...TOKEN_SYNC_OP_ERRORS]);
    expect(arr('_BT_TRANSPORTS')).toEqual([...TOKEN_TRANSPORTS]);
    expect(arr('_BT_FILE_PROBLEMS')).toEqual([...TOKEN_FILE_PROBLEMS]);
  });
  it('the failure words are link.ts\'s LOST_WORDS (read from its text) plus the doctor\'s own `mint-failed`', () => {
    const link = readFileSync(join(REPO, 'server', 'src', 'token', 'link.ts'), 'utf8');
    const m = /const LOST_WORDS = \[([^\]]*)\] as const;/.exec(link);
    expect(m, 'link.ts no longer declares LOST_WORDS in this shape: re-point the pin').not.toBeNull();
    const theirs = [...m![1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
    expect(theirs.length).toBeGreaterThan(0);
    // The one extra is last, and is the only word the shell has that link.ts has not.
    expect(arr('_BT_LOST_WORDS')).toEqual([...theirs, 'mint-failed']);
  });
  it('the pending cap and the driver tick are the policy\'s', () => {
    expect(arr('_BT_PENDING_CAP')).toEqual([String(PENDING_HARD_CAP)]);
    expect(arr('_BT_TICK_MS')).toEqual([String(DRIVER_TICK_MS)]);
  });
  it('the failure count that turns failed:* FAIL is the banner threshold', () => {
    expect(arr('_BT_FAIL_AT')).toEqual([String(FAILURES_FOR_BANNER)]);
  });
  // Review 362 F4 (bar class 10; the plan's Global Constraint): the python in this check spells the generation id's shape
  // three times and the sync-proof tuple by hand. L0 owns the shape (`GENERATION_ID_HEX`) and the two `proof-*` words
  // (`TOKEN_SYNC_OP_ERRORS`); `proved` is the verb's own success word (`R_PROOF=proved`), pinned from the verb's text.
  const checkBlock = (src: string): string => {
    const at = src.indexOf('# ── box-token: the box token');
    expect(at, 'the box-token block marker moved: re-point the pin').toBeGreaterThanOrEqual(0);
    return src.slice(at);
  };
  /** Every QUANTIFIED bracket class (one followed by `{n}` or `{n,m}`; a class with no such quantifier is not seen, and
   *  neither is a hex shape spelled some other way, such as a `\x` escape or a literal alternation) whose admitted set is
   *  hex digits (and `-`) and holds at least one hex letter, however the class spells that set:
   *  ranges, listed letters, `\d`, `[:digit:]`, `[:xdigit:]`, a `\-` literal, bare or inside `(?:…)`, in the block's code
   *  lines, less the exact `[0-9a-f]{64}` digest spelling (a different thing); a 4th spelling in another class reds (review
   *  of fix 1; review 365 R3). The class body admits `[` only as a `[:name:]`, so the bash `[[ "$g" =~ ^[0-9a-f]{16}$ ]]`
   *  yields its inner class rather than a body that swallowed the outer `[`. */
  const HEX_SET = new Set('0123456789abcdefABCDEF-');
  const expandClass = (body: string): Set<string> => {
    const out = new Set<string>();
    for (let i = 0; i < body.length; i++) {
      if (body.startsWith('[:xdigit:]', i)) { for (const c of '0123456789abcdefABCDEF') out.add(c); i += 9; continue; }
      if (body.startsWith('[:digit:]', i)) { for (const c of '0123456789') out.add(c); i += 8; continue; }
      const named = /^\[:[a-z]+:\]/.exec(body.slice(i)); // any other POSIX class admits more than hex
      if (named) { out.add(named[0]); i += named[0].length - 1; continue; }
      if (body[i] === '\\') { // `\d` is 0-9 and `\-` is a literal `-`; any other escape is a character no hex set admits
        if (body[i + 1] === 'd') for (const c of '0123456789') out.add(c);
        else if (body[i + 1] === '-') out.add('-');
        else out.add(body.slice(i, i + 2));
        i += 1; continue;
      }
      if (body[i + 1] === '-' && i + 2 < body.length && body[i + 2] !== '\\' && body[i + 2] !== '[') {
        for (let c = body.charCodeAt(i); c <= body.charCodeAt(i + 2); c++) out.add(String.fromCharCode(c));
        i += 2; continue;
      }
      out.add(body[i]!);
    }
    return out;
  };
  const genShapes = (src: string): string[] =>
    checkBlock(src).split('\n').filter((l) => !/^\s*#/.test(l))
      .flatMap((l) => [...l.matchAll(/(?:\(\?:)?\[((?:\[:[a-z]+:\]|\\.|[^\]\\[])*)\]\)?\{\d+(?:,\d*)?\}/g)]
        .filter((m) => { const set = expandClass(m[1]!); return [...set].every((c) => HEX_SET.has(c)) && [...set].some((c) => /[a-fA-F]/.test(c)); })
        .map((m) => m[0]))
      .filter((w) => w !== '[0-9a-f]{64}');
  const proofTuple = (src: string): unknown[] | null => {
    const hits = [...checkBlock(src).matchAll(/\bpf in \(([^)]*)\)/g)];
    if (hits.length !== 1) return null;
    return hits[0]![1]!.split(',').map((x) => x.trim()).filter(Boolean)
      .map((x) => (x === 'None' ? null : /^"([^"]*)"$/.exec(x)?.[1] ?? `?${x}`));
  };
  const verbProofWords = (): string[] => {
    const verb = readFileSync(join(REPO, 'ccd', 'ccrc-token-sync'), 'utf8');
    return [...new Set([...verb.matchAll(/^\s+R_PROOF=([a-z-]+)$/gm)].map((m) => m[1]!))];
  };
  const l0Proof = (): string[] => TOKEN_SYNC_OP_ERRORS.filter((w) => w.startsWith('proof-'));
  it('the generation id shape is spelled exactly three times in the check and each is GENERATION_ID_HEX', () => {
    const src = readFileSync(CHECKS_SRC, 'utf8');
    expect(genShapes(src)).toEqual([GENERATION_ID_HEX, GENERATION_ID_HEX, GENERATION_ID_HEX]);
  });
  it('the sync-proof tuple is (None, the verb\'s success word, then L0\'s proof-* sync words), exactly', () => {
    const src = readFileSync(CHECKS_SRC, 'utf8');
    expect(l0Proof().length, 'L0 has no proof-* sync words: the filter is empty').toBeGreaterThan(0);
    expect(proofTuple(src)).toEqual([null, 'proved', ...l0Proof()]);
    expect([...verbProofWords()].sort(), 'the verb\'s R_PROOF words').toEqual(['proved', ...l0Proof()].sort());
  });
  it('CONTROL: the scanners see a narrowed shape, a fourth spelling, a dropped word and a renamed word', () => {
    const src = readFileSync(CHECKS_SRC, 'utf8');
    const want = [GENERATION_ID_HEX, GENERATION_ID_HEX, GENERATION_ID_HEX];
    expect(genShapes(src.replace('[0-9a-f]{16}', '[0-9a-f]{15}'))).not.toEqual(want);
    expect(genShapes(src.replace(/\[0-9a-f\]\{16\}(?![\s\S]*\[0-9a-f\]\{16\})/, '[0-9a-f]{15}'))).not.toEqual(want);
    expect(genShapes(`${src}\n    x = re.compile(r"[0-9a-f]{16}")\n`)).not.toEqual(want);
    expect(genShapes(`${src}\n    x = re.compile(r"[a-f0-9]{16}\\Z")\n`)).not.toEqual(want);
    expect(genShapes(`${src}\n    x = re.compile(r"[0-9a-fA-F]{16}")\n`)).not.toEqual(want);
    expect(genShapes(`${src}\n    x = re.compile(r"[[:xdigit:]]{16}")\n`)).not.toEqual(want);
    expect(genShapes(`${src}\n    x = re.compile(r"[0-9]{2}")\n`), 'a digit-only class is not a hex shape').toEqual(want);
    // Review 365 R3: a class is judged by the set it admits, so every spelling of hex is a hex shape. `String.raw` keeps the
    // backslash (an untagged template turns `\d` into a bare `d`, a spelling the old scanner already found). Each row
    // names a pattern its own element must match, so an element edited to lose its backslash (or any other spelling) fails
    // that assertion instead of passing as a different shape.
    const spellings: [string, RegExp][] = [
      [String.raw`[\da-f]`, /\\d/], [String.raw`[a-f\d]`, /\\d/], ['[0-9abcdef]', /^\[0-9abcdef\]$/], ['(?:[0-9a-f])', /^\(\?:\[/],
      ['[[:digit:]a-f]', /\[:digit:\]/], [String.raw`[0-9a-f\-]`, /\\-/],
    ];
    for (const [spelled, has] of spellings) {
      expect(spelled, `the planted element ${spelled} lost the spelling it names`).toMatch(has);
      expect.soft(genShapes(`${src}\n    x = re.compile(r"${spelled}{16}")\n`), `${spelled} is a hex shape`).not.toEqual(want);
    }
    // The natural bash spelling: a class body that admits `[` would swallow it and miss the shape.
    expect.soft(genShapes(`${src}\n    [[ "$x" =~ ^[0-9a-f]{16}$ ]]\n`), 'a hex class inside a bash [[ ]] test').not.toEqual(want);
    expect.soft(genShapes(`${src}\n    x = re.compile(r"[A-Za-z0-9._:-]{8}")\n`), 'a class wider than hex is not a hex shape').toEqual(want);
    expect.soft(genShapes(`${src}\n    x = re.compile(r"[0-9a-g]{16}")\n`), 'a near-miss class (g is not hex) is not a hex shape').toEqual(want);
    expect(proofTuple(src.replace(', "proof-unmeasured")', ')'))).not.toEqual([null, 'proved', ...l0Proof()]);
    expect(proofTuple(src.replace('"proved"', '"proven"'))).not.toEqual([null, 'proved', ...l0Proof()]);
    expect(proofTuple(src.replace('(None, ', '('))).not.toEqual([null, 'proved', ...l0Proof()]);
  });
  it('the generation file and the fleet file are the names the writers use', () => {
    const src = readFileSync(CHECKS_SRC, 'utf8');
    expect(src.includes(`/.ccrc/${NODE_FILES.tokenGeneration}"`), 'the generation file').toBe(true);
    expect(src.includes('/.cc-secrets/ccrc-mail.token"'), 'the fleet token file').toBe(true);
  });
});
