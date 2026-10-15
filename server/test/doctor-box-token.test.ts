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
// (armed) file, and a fresh box (no token, no history) is a PASS with its sentence, never a WARN or a FAIL (4553, D-139).
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
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { TOKEN_HOLDS, OWED_REASONS, TOKEN_ORIGINS, TOKEN_ROTATION_INTERVAL_MS, TOKEN_ROTATION_OVERDUE_SLACK_MS } from '../../shared/box-token.js';
import { GENERATION_ID_HEX, NODE_FILES, TOKEN_SYNC_OP_ERRORS, TOKEN_TRANSPORTS } from '../../shared/agent-protocol.js';
import { TOKEN_FILE_PROBLEMS } from '../../shared/box-token.js';
import { PLACEHOLDER_TOKEN } from '../src/coord/token.js';
import { DRIVER_TICK_MS, FAILURES_FOR_BANNER, PENDING_HARD_CAP, type BoxTokenState } from '../src/token/policy.js';
import { SET_ASIDE_MARK, tokenPaths } from '../src/token/files.js';

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
/** A `box-token-retired.json` in the writer's shape (`appendRetired`): never a bare `[]`. */
const RETIRED = '{"v":1,"retired":[]}\n';

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

function runCheck(b: Box, checks = CHECKS_SRC, locale = 'C'): Run {
  const bin = join(b.home, 'bt-bin');
  mkdirSync(bin, { recursive: true });
  for (const n of ['python3', 'stat']) {
    try { symlinkSync(realBin(n), join(bin, n)); } catch { /* already linked by an earlier run on this box */ }
  }
  const script = ['set -uo pipefail', `. ${shq(CCRC_SRC)}`, `. ${shq(checks)}`, '_check_box-token'].join('\n');
  const r = spawnSync(BASH, ['-c', script], {
    encoding: 'utf8', env: { HOME: b.home, PATH: bin, LC_ALL: locale, TMPDIR: join(b.home, 'tmp') },
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

  // Row 2c invariant: the live server's disk (mail.token, box-token.json at generation #3 with counters 0 and 0 and a
  // null stamp, and box-token-retired.json in the writer's shape) is PASS at every commit.
  const plantLiveServer = (b: Box, ageMs?: number): void => {
    editState(b, (s) => {
      s.current.seq = 3; s.nextSeq = 4;
      // Row 3a: the age is overridden only when a row passes one; row 2c's rows keep healthyState's own plant.
      if (ageMs !== undefined) { s.lastRotationAt = Date.now() - ageMs; s.current.since = Date.now() - ageMs; }
      s.counters = { previousPresented: 0, retiredPresented: 0, retiredPresentedAt: null };
    });
    writeFileSync(dot(b, 'box-token-retired.json'), '{"v":1,"retired":[]}\n', { mode: 0o600 });
  };
  it('the live server shape: generation #3, counters 0 and 0 with a null stamp, and box-token-retired.json beside it, is PASS (row 2c invariant)', () => {
    const b = box({ role: 'server' });
    plantLiveServer(b);
    for (const checks of [CHECKS_SRC, disarmed()]) {
      const r = runCheck(b, checks);
      expect(r.stdout).toBe('PASS box-token: server: generation #3, rotated 60 min ago, fleet confirmed, retired value refused\n');
      expect(r.code).toBe(0);
      expect(r.stderr).toBe('');
    }
  });

  it('the live shape on role both, local: the same server part, and the fleet part written by this box\'s server, is PASS (row 2c invariant)', () => {
    const b = box({ role: 'both' });
    rmSync(dot(b, 'token-sync.json'));
    plantLiveServer(b);
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toBe(`PASS box-token: server: generation #3, rotated 60 min ago, fleet confirmed, retired value refused; fleet: token file 0600, generation recorded, written by this box's server\n`);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
  });

  // Row 3a invariant: the live server is about two days past its last rotation, and the weekly schedule's overdue WARN
  // (4557) waits for the interval plus its slack, so both ages below read the plain PASS.
  it('the live server two days after its rotation reads the live line, PASS (row 3a invariant)', () => {
    const b = box({ role: 'server' });
    plantLiveServer(b, 2 * 24 * 60 * MIN + 5 * MIN);
    for (const checks of [CHECKS_SRC, disarmed()]) {
      const r = runCheck(b, checks);
      expect(r.stdout).toBe('PASS box-token: server: generation #3, rotated 2 d ago, fleet confirmed, retired value refused\n');
      expect(r.code).toBe(0);
      expect(r.stderr).toBe('');
    }
  });

  it('seven days and twenty-three hours after the last rotation is still PASS: the overdue WARN waits for the slack (row 3a invariant)', () => {
    const b = box({ role: 'server' });
    plantLiveServer(b, (7 * 24 + 23) * 60 * MIN);
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toBe('PASS box-token: server: generation #3, rotated 7 d ago, fleet confirmed, retired value refused\n');
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
  });
});

// ── every armed state: FAIL or WARN with its word (SKIP only in the disarmed copy) ──

interface Row { label?: string; word: string; arm: 'server' | 'fleet'; armedClass: 'FAIL' | 'WARN'; plant: (b: Box) => void }
const now = (): number => Date.now();
/** 4557: the age past which a standing schedule is overdue, the interval plus its slack (both L0's). */
const OVER = TOKEN_ROTATION_INTERVAL_MS + TOKEN_ROTATION_OVERDUE_SLACK_MS;
const ROWS: Row[] = [
  // 4553 (D-139 ruled over Decision 2 (a), 2026-10-12): the class of an absent token comes from the box's history, read
  // after the state read. A server that has a state file once held a value and lost it: FAIL. One with no state file has
  // never run the lifecycle: it is no finding at all, and reads PASS with its sentence (the `never handed` describe
  // below, not a row here, since a row is an armed FAIL or WARN with a remedy). A state it cannot read still says there
  // was one: FAIL (fail closed).
  { arm: 'server', word: 'token-absent', label: 'token-absent (with history: a state file)', armedClass: 'FAIL', plant: (b) => rmSync(dot(b, 'mail.token')) },
  { arm: 'server', word: 'token-absent', label: 'token-absent (with history: a state file it cannot read)', armedClass: 'FAIL',
    plant: (b) => { rmSync(dot(b, 'mail.token')); plantState(b, '{"v":1,'); } },
  // 4554 (review 391 F1): a sibling trace of a value this server once held is history too, by NAME only (never opened:
  // `mail-previous.token` holds a value). The state is absent and so is the token, and the line stays FAIL.
  { arm: 'server', word: 'token-absent', label: 'token-absent (with history: no state, but box-token-retired.json)', armedClass: 'FAIL',
    plant: (b) => { rmSync(dot(b, 'mail.token')); rmSync(dot(b, 'box-token.json')); writeFileSync(dot(b, 'box-token-retired.json'), RETIRED, { mode: 0o600 }); } },
  { arm: 'server', word: 'token-absent', label: 'token-absent (with history: no state, but mail-previous.token)', armedClass: 'FAIL',
    plant: (b) => { rmSync(dot(b, 'mail.token')); rmSync(dot(b, 'box-token.json')); writeFileSync(dot(b, 'mail-previous.token'), `${b.value}\n`, { mode: 0o600 }); } },
  { arm: 'server', word: 'token-absent', label: 'token-absent (with history: no state, but a set-aside box-token.json)', armedClass: 'FAIL',
    plant: (b) => { rmSync(dot(b, 'mail.token')); rmSync(dot(b, 'box-token.json')); writeFileSync(dot(b, 'box-token.json.unusable-1760000000000'), '{}', { mode: 0o600 }); } },
  { arm: 'server', word: 'token-absent', label: 'token-absent (with history: no state, but a set-aside box-token-retired.json)', armedClass: 'FAIL',
    plant: (b) => { rmSync(dot(b, 'mail.token')); rmSync(dot(b, 'box-token.json')); writeFileSync(dot(b, 'box-token-retired.json.unusable-1760000000000'), RETIRED, { mode: 0o600 }); } },
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
  // 4557: no rotation for longer than the interval plus its slack, with no hold and nothing pending. Computed, never persisted.
  { arm: 'server', word: 'rotation-overdue', armedClass: 'WARN', plant: (b) => editState(b, (s) => { s.lastRotationAt = now() - OVER - 60 * MIN; }) },
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
  // 4553: a fleet box that was never handed a value (no generation file and no sync report) reads PASS with its sentence
  // (the `never handed` describe below); any trace of a handed value (either file, readable or not) makes the lost token
  // a FAIL.
  { arm: 'fleet', word: 'fleet-token-absent', label: 'fleet-token-absent (with history: a generation file and a sync report)', armedClass: 'FAIL', plant: (b) => rmSync(fleetFile(b)) },
  // Review 383 F12: the history of holding a value is a generation file, or a report that records a value WRITTEN: a
  // `synced` result, a proof result (`proof-failed`, `proof-unmeasured`: the value was written, then not proved), or any
  // report carrying a generation (a refusal after the write, `ccrc-token-sync`'s `write-failed` at its last two sites). A
  // report that records only a refusal with no generation leaves the box never-handed (the `never handed` describe).
  { arm: 'fleet', word: 'fleet-token-absent', label: 'fleet-token-absent (with history: a synced report only)', armedClass: 'FAIL',
    plant: (b) => { rmSync(fleetFile(b)); rmSync(dot(b, NODE_FILES.tokenGeneration)); } },
  { arm: 'fleet', word: 'fleet-token-absent', label: 'fleet-token-absent (with history: a proof-unmeasured report only)', armedClass: 'FAIL',
    plant: (b) => { rmSync(fleetFile(b)); rmSync(dot(b, NODE_FILES.tokenGeneration)); plantReport(b, { result: 'proof-unmeasured', generation: null, proof: 'proof-unmeasured' }); } },
  { arm: 'fleet', word: 'fleet-token-absent', label: 'fleet-token-absent (with history: a proof-failed report only)', armedClass: 'FAIL',
    plant: (b) => { rmSync(fleetFile(b)); rmSync(dot(b, NODE_FILES.tokenGeneration)); plantReport(b, { result: 'proof-failed', generation: null, proof: 'proof-failed' }); } },
  { arm: 'fleet', word: 'fleet-token-absent', label: 'fleet-token-absent (with history: a refusal that carries a generation, written after the value)', armedClass: 'FAIL',
    plant: (b) => { rmSync(fleetFile(b)); rmSync(dot(b, NODE_FILES.tokenGeneration)); plantReport(b, { result: 'write-failed', generation: ID_CUR, transport: null, proof: null }); } },
  // Review 391 F2 (4555): `ccrc-token-sync` now writes `held` on a refusal that wrote nothing from a box that held a
  // generation, so a box that synced, was refused, then lost its token and generation files is history, not never-handed.
  { arm: 'fleet', word: 'fleet-token-absent', label: 'fleet-token-absent (with history: a refusal report carrying the generation it held, no generation file; review 391 F2, 4555)', armedClass: 'FAIL',
    plant: (b) => { rmSync(fleetFile(b)); rmSync(dot(b, NODE_FILES.tokenGeneration)); plantReport(b, { result: 'bad-code', generation: null, transport: null, proof: null, held: ID_CUR }); } },
  { arm: 'fleet', word: 'fleet-token-absent', label: 'fleet-token-absent (with history: a generation file only)', armedClass: 'FAIL',
    plant: (b) => { rmSync(fleetFile(b)); rmSync(dot(b, 'token-sync.json')); } },
  { arm: 'fleet', word: 'fleet-token-absent', label: 'fleet-token-absent (with history: a sync report it cannot read, no generation file)', armedClass: 'FAIL',
    plant: (b) => { rmSync(fleetFile(b)); rmSync(dot(b, NODE_FILES.tokenGeneration)); plantReport(b, '{"v":2}'); } },
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
  // Review 383 F6: the has-a-value pass strips the same set as the placeholder pass (`extractToken` strips FIRST, ASCII and
  // `_BT_UNI_WS`, and only then tells a blank or `#` line apart), so a file with no value line to `extractToken` is unusable
  // whatever its bytes: only a BOM, only a no-break space, a BOM then only a comment. Never PASS, on both arms.
  { arm: 'fleet', word: 'fleet-token-unusable', label: 'fleet-token-unusable (only a BOM)', armedClass: 'FAIL',
    plant: (b) => writeFileSync(fleetFile(b), Buffer.from('\uFEFF\n'), { mode: 0o600 }) },
  { arm: 'fleet', word: 'fleet-token-unusable', label: 'fleet-token-unusable (only a no-break space)', armedClass: 'FAIL',
    plant: (b) => writeFileSync(fleetFile(b), Buffer.from('\u00A0\n'), { mode: 0o600 }) },
  { arm: 'fleet', word: 'fleet-token-unusable', label: 'fleet-token-unusable (a BOM, then only a # comment)', armedClass: 'FAIL',
    plant: (b) => writeFileSync(fleetFile(b), Buffer.from('\uFEFF# comment only\n'), { mode: 0o600 }) },
  { arm: 'server', word: 'token-unusable', label: 'token-unusable (only a BOM)', armedClass: 'FAIL',
    plant: (b) => writeFileSync(dot(b, 'mail.token'), Buffer.from('\uFEFF\n'), { mode: 0o600 }) },
  { arm: 'server', word: 'token-unusable', label: 'token-unusable (only a no-break space)', armedClass: 'FAIL',
    plant: (b) => writeFileSync(dot(b, 'mail.token'), Buffer.from('\u00A0\n'), { mode: 0o600 }) },
  { arm: 'server', word: 'token-unusable', label: 'token-unusable (a BOM, then only a # comment)', armedClass: 'FAIL',
    plant: (b) => writeFileSync(dot(b, 'mail.token'), Buffer.from('\uFEFF# comment only\n'), { mode: 0o600 }) },
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

// ── the weekly schedule: overdue, and a stamp ahead of the clock (4557) ──

describe('doctor box-token: the weekly schedule, overdue and ahead (4557)', () => {
  const oldAnchor = (s: BoxTokenState): void => { s.lastRotationAt = now() - OVER - 60 * MIN; s.current.since = s.lastRotationAt; };
  const pendingEntry = (): BoxTokenState['pending'][number] =>
    ({ id: ID_OLD, seq: 3, stagedAt: now() - MIN, handedOutAt: null, confirmBy: null, write: { dev: 1, ino: 3, writtenAtMs: now() - MIN } });

  it('a null lastRotationAt counts from current.since: a minted value never rotated for eight days is overdue', () => {
    const b = box({ role: 'server' });
    editState(b, (s) => {
      s.origin = 'minted'; s.lastRotationAt = null; s.retiredRefusedAt = null; s.current.since = now() - OVER - 60 * MIN;
    });
    const r = runCheck(b, CHECKS_SRC);
    // The whole sentence, so a wrong constant in its words reds (the slack term spelled with the interval says 7 d, not 24 h).
    expect(r.stdout).toMatch(/^WARN box-token: server: rotation-overdue — no rotation has completed for 8 d, past the 7 d schedule and its 24 h slack, with no hold standing and nothing in flight\b/);
    expect(r.stdout).toMatch(/\n {2}remedy: \S/);
    expect(r.code).toBe(2);
  });

  it('a standing hold is the finding, not the schedule', () => {
    const b = box({ role: 'server' });
    editState(b, (s) => { oldAnchor(s); s.hold = 'link-down'; });
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toContain('server: held:link-down — ');
    expect(r.stdout).not.toContain('rotation-overdue');
  });

  // A rotation in flight is not overdue: a staged or handed-out value has its id pending, and a recorded promotion
  // counts whether or not its id is still pending (the crash-window row below).
  const inFlight = 'PASS box-token: server: generation #2, rotated 8 d ago, fleet confirmed, retired value refused, a rotation in progress\n';
  it('a rotation in flight is not overdue: a staged value', () => {
    const b = box({ role: 'server' });
    editState(b, (s) => { oldAnchor(s); s.pending = [pendingEntry()]; });
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toBe(inFlight);
    expect(r.code).toBe(0);
  });

  it('a rotation in flight is not overdue: a promotion recorded, its id still pending', () => {
    const b = box({ role: 'server' });
    editState(b, (s) => { oldAnchor(s); s.pending = [pendingEntry()]; s.promoting = { id: ID_OLD }; });
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toBe(inFlight);
    expect(r.code).toBe(0);
  });

  // A crash between promote's discard write and its commit leaves `promoting` set with `pending` empty. The PASS arm
  // reads that as a rotation in progress, so the overdue clause must read it the same way (not "nothing in flight").
  it('a rotation in flight is not overdue: a promotion recorded with nothing pending (the crash window)', () => {
    const b = box({ role: 'server' });
    editState(b, (s) => { oldAnchor(s); s.pending = []; s.promoting = { id: ID_OLD }; });
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toBe(inFlight);
    expect(r.code).toBe(0);
  });

  it('an owed rotation that is also overdue names both', () => {
    const b = box({ role: 'server' });
    editState(b, (s) => { oldAnchor(s); s.rotationOwed = true; s.owedWhy = 'recovered'; });
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toContain('server: rotation-owed:recovered — ');
    expect(r.stdout).toContain('server: rotation-overdue — ');
    expect(r.code).toBe(2);
  });

  it('a stamp ahead of the clock says so on the PASS line, and the schedule waits', () => {
    const b = box({ role: 'server' });
    // A margin off `_bt_age`'s 7200 s boundary: Python reads its clock a few ms after the test's `now()`.
    editState(b, (s) => { s.lastRotationAt = now() + 2 * 60 * MIN + 5 * MIN; });
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toBe('PASS box-token: server: generation #2, rotated 0 s ago, fleet confirmed, retired value refused, its schedule stamp 2 h ahead of this clock (the weekly schedule counts its interval from that stamp)\n');
    expect(r.code).toBe(0);
  });

  it('a stamp more than one interval ahead says the server rotates now', () => {
    const b = box({ role: 'server' });
    editState(b, (s) => { s.lastRotationAt = now() + TOKEN_ROTATION_INTERVAL_MS + 60 * MIN; });
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toContain('its schedule stamp 7 d ahead of this clock (more than the interval, so the server rotates now)');
    expect(r.code).toBe(0);
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
    // Review 383 F8: the remedy says what is true. A server that holds the placeholder never boots (it refuses with
    // `MailTokenPlaceholderUnedited`), so "Rotate now on the console's Box token card" is a remedy nobody can reach.
    const remedy = r.stdout.split('\n').find((l) => /^ {2}remedy: /.test(l)) ?? '';
    expect(remedy).toContain('refuses to boot on the placeholder');
    expect(remedy).toMatch(/replace the file with a value, or remove it, and the next boot mints one/);
    expect(remedy).not.toContain('Rotate now');
  });

  it('a real-looking value that merely starts like the placeholder is still ok', () => {
    const b = box({ role: 'fleet' });
    writeFileSync(fleetFile(b), `${PLACEHOLDER_TOKEN}-x\n`, { mode: 0o600 });
    expect(runCheck(b, CHECKS_SRC).stdout).toBe(`PASS box-token: ${FLEET_PASS}\n`);
  });
});

describe('doctor box-token: the has-a-value test reads the way extractToken reads (review 383 F6)', () => {
  // The answer must not depend on the locale `[[:space:]]` happens to run under: a lone U+3000 line used to FAIL under
  // C.UTF-8 and PASS under C. Every locale gives the same verdict.
  const LOCALES = ['C', 'C.UTF-8', 'en_US.UTF-8'];
  const unusable: Array<[string, string]> = [
    ['only a BOM', '\uFEFF\n'], ['only a no-break space', '\u00A0\n'], ['only an ideographic space', '\u3000\n'],
    ['a BOM, then only a # comment', '\uFEFF# comment only\n'], ['a no-break space, then a # comment, then blank', '\u00A0# c\n\uFEFF\n'],
  ];
  for (const locale of LOCALES) {
    for (const [name, text] of unusable) {
      it(`${locale}: a token file of ${name} is FAIL unusable on both arms, never PASS`, () => {
        const f = box({ role: 'fleet' });
        writeFileSync(fleetFile(f), Buffer.from(text), { mode: 0o600 });
        const rf = runCheck(f, CHECKS_SRC, locale);
        expect(rf.stdout).toMatch(/^FAIL box-token: fleet: fleet-token-unusable — .* carries no value line/);
        expect(rf.code).toBe(1);
        const s = box({ role: 'server' });
        writeFileSync(dot(s, 'mail.token'), Buffer.from(text), { mode: 0o600 });
        const rs = runCheck(s, CHECKS_SRC, locale);
        expect(rs.stdout).toMatch(/^FAIL box-token: server: token-unusable — .* carries no value line/);
        expect(rs.code).toBe(1);
      });
    }
    it(`${locale}: a real value behind a BOM (and a preamble comment) is still a value: PASS`, () => {
      const f = box({ role: 'fleet' });
      writeFileSync(fleetFile(f), Buffer.from(`\uFEFF# preamble\n\u00A0${f.fleetValue}\u3000\n`), { mode: 0o600 });
      expect(runCheck(f, CHECKS_SRC, locale).stdout).toBe(`PASS box-token: ${FLEET_PASS}\n`);
      const s = box({ role: 'server' });
      writeFileSync(dot(s, 'mail.token'), Buffer.from(`\uFEFF${s.value}\n`), { mode: 0o600 });
      expect(runCheck(s, CHECKS_SRC, locale).stdout).toBe(`PASS box-token: ${SERVER_PASS}\n`);
    });
  }
});

// Review 383 F4 (for `_BT_UNI_WS`): one GENERATED row per code point of `extractToken`'s trim set. The set is derived here,
// never listed by hand: every code point `String.prototype.trim` removes (`extractToken` trims with it), so a code point
// an engine adds, or one deleted from the shell's strip, reds its own row. The ASCII members are the `[[:space:]]` class's
// (the shell strips them first), the rest `_BT_UNI_WS`'s. Each row plants the code point (a) around the shipped
// placeholder: doctor must still read the placeholder (placeholder pass), (b) alone on the file's only line: doctor must
// read no value line (value pass), and (c) around a real value: doctor must read it and PASS. Fleet and server arms.
// U+00A0 and U+FEFF also have hand-written rows (ROWS, and the has-a-value describe above), so deleting either from
// `_BT_UNI_WS` reds its generated rows and those rows too (deleting U+FEFF: 26 tests red when measured, row 2c).
describe('doctor box-token: every code point of extractToken\'s trim set is stripped (review 383 F4)', () => {
  const TRIM_SET: number[] = [];
  for (let c = 0; c <= 0xffff; c++) if (String.fromCodePoint(c).trim() === '') TRIM_SET.push(c);
  const hex = (c: number): string => `U+${c.toString(16).toUpperCase().padStart(4, '0')}`;
  it('the generated trim set is the one the rows were written for (25 code points, the ASCII six and U+00A0, U+1680, U+2000-200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF)', () => {
    expect(TRIM_SET.length).toBe(25);
    expect(TRIM_SET).toContain(0x0b);
    expect(TRIM_SET).toContain(0xa0);
    expect(TRIM_SET).toContain(0x2000);
    expect(TRIM_SET).toContain(0xfeff);
  });
  it.each(TRIM_SET.map((c) => [hex(c), c] as const))('%s is stripped: the placeholder behind it is still the placeholder, a line of only it has no value, a real value inside it is the value', (h, c) => {
    const cp = String.fromCodePoint(c);
    const plant = (b: Box, arm: 'fleet' | 'server', text: string): void =>
      writeFileSync(arm === 'fleet' ? fleetFile(b) : dot(b, 'mail.token'), Buffer.from(text, 'utf8'), { mode: 0o600 });
    for (const arm of ['fleet', 'server'] as const) {
      const word = arm === 'fleet' ? 'fleet-token-unusable' : 'token-unusable';
      const b = box({ role: arm });
      plant(b, arm, `${cp}${PLACEHOLDER_TOKEN}${cp}\n`);
      const ph = runCheck(b, CHECKS_SRC);
      expect(ph.stdout, `${arm}: the placeholder around ${h} read as a value`).toMatch(new RegExp(`^FAIL box-token: ${arm}: ${word} — .* carries the placeholder value`));
      plant(b, arm, `${cp}\n`);
      const none = runCheck(b, CHECKS_SRC);
      expect(none.stdout, `${arm}: a line of only ${h} read as a value`).toMatch(new RegExp(`^FAIL box-token: ${arm}: ${word} — .* carries no value line`));
      plant(b, arm, `${cp}${arm === 'fleet' ? b.fleetValue : b.value}${cp}\n`);
      const ok = runCheck(b, CHECKS_SRC);
      expect(ok.stdout, `${arm}: a real value inside ${h} was not read as the value`).toBe(`PASS box-token: ${arm === 'fleet' ? FLEET_PASS : SERVER_PASS}\n`);
    }
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
    // The same override with the files left at the default place: both are absent where the check looks, so it is a
    // server that never ran (PASS with its sentence, D-139), and it names the path it looked at.
    const c = box({ role: 'server' });
    const elsewhere = join(c.home, 'elsewhere', 'custom.token');
    writeFileSync(dot(c, 'ccrc.env'), `CCRC_ROLE=server\nCCRC_FLEET=local\nCCRC_MAIL_TOKEN_PATH=${elsewhere}\n`, { mode: 0o600 });
    const out = runCheck(c).stdout;
    expect(out).toContain(`server: token-absent — ${elsewhere} does not exist`);
    expect(out).toMatch(/^PASS box-token: /);
  });
  it('both role, local, own-write: an override into a directory that does not exist yet is the fresh PASS on both arms (4554)', () => {
    const b = box({ role: 'both' });
    for (const f of ['mail.token', 'box-token.json', 'token-sync.json', NODE_FILES.tokenGeneration]) rmSync(dot(b, f));
    rmSync(fleetFile(b));
    writeFileSync(dot(b, 'ccrc.env'), `CCRC_ROLE=both\nCCRC_FLEET=local\nCCRC_MAIL_TOKEN_PATH=${join(b.home, 'elsewhere', 'custom.token')}\n`, { mode: 0o600 });
    const r = runCheck(b);
    expect(r.stdout).toMatch(new RegExp(`^PASS box-token: server: token-absent — .*; fleet: fleet-token-absent — .* ${FLEET_NEVER}\\n$`));
    expect(r.code).toBe(0);
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

// 4553, as D-139 rules it (operator, 2026-10-12): a box never handed a value is not unhealthy, it is new. The fact stays
// named in the detail (doctor's `auth` and `provenance` precedents: only the verdict moves) and the line is PASS with no
// `remedy:`. A box that once held a value and lost it stays FAIL. The history is read from the arm's own reads.
const SERVER_NEVER = 'no value has been minted here yet, and the server mints one at boot, or its log says why that mint failed';
const FLEET_NEVER = "no value has been handed to this box yet, and the server's next rotation hands one";
describe('doctor box-token: a box never handed a value reads PASS with its sentence, a box that lost its value FAILs (4553, D-139)', () => {
  const dropServer = (b: Box): void => { for (const f of ['mail.token', 'box-token.json']) rmSync(dot(b, f)); };
  const dropFleet = (b: Box): void => { for (const f of [fleetFile(b), dot(b, NODE_FILES.tokenGeneration), dot(b, 'token-sync.json')]) rmSync(f); };
  const never = (kind: 'server' | 'fleet'): string => `${kind}: ${kind === 'server' ? 'token-absent' : 'fleet-token-absent'} — .* ${kind === 'server' ? SERVER_NEVER : FLEET_NEVER}`;
  it('server role: no mail.token and no state is PASS rc 0, naming the fact, with no remedy; the kill switch prints the same PASS (it is no arm finding)', () => {
    const b = box({ role: 'server' });
    dropServer(b);
    for (const checks of [CHECKS_SRC, disarmed()]) {
      const r = runCheck(b, checks);
      expect(r.stdout).toMatch(new RegExp(`^PASS box-token: ${never('server')}\\n$`));
      expect(r.stdout).not.toMatch(/remedy:|WARN|FAIL|SKIP|state-absent/);
      expect(r.code).toBe(0);
      expect(r.stderr).toBe('');
    }
  });
  // Review 391 F1 (4554): the server arm's `absent` state read is history only when no sibling trace says a value was held
  // once. A trace is a NAME beside the state file (never opened: `mail-previous.token` holds a value).
  const TRACES: [string, (b: Box) => void][] = [
    ['box-token-retired.json', (b) => writeFileSync(dot(b, 'box-token-retired.json'), RETIRED, { mode: 0o600 })],
    ['mail-previous.token', (b) => writeFileSync(dot(b, 'mail-previous.token'), `${b.value}\n`, { mode: 0o600 })],
    ['box-token.json.unusable-1760000000000', (b) => writeFileSync(dot(b, 'box-token.json.unusable-1760000000000'), '{}', { mode: 0o600 })],
    ['box-token-retired.json.unusable-1760000000000', (b) => writeFileSync(dot(b, 'box-token-retired.json.unusable-1760000000000'), RETIRED, { mode: 0o600 })],
  ];
  const reEsc = (x: string): string => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  it('review 391 F1: a server with no token and no state but a sibling trace held a value once: FAIL naming the trace, never the never-minted sentence (4554)', () => {
    for (const [name, plant] of TRACES) {
      const b = box({ role: 'server' });
      dropServer(b);
      plant(b);
      const r = runCheck(b, CHECKS_SRC);
      expect(r.stdout, name).toMatch(new RegExp(`^FAIL box-token: server: token-absent — .* but .*${reEsc(name)} does: this server held a value once and lost it`));
      expect(r.stdout, name).not.toContain('no value has been minted here yet');
      expect(r.stdout, name).toMatch(/\n {2}remedy: \S/);
      expect(r.code, name).toBe(1);
      const d = runCheck(b, disarmed());
      expect(d.stdout, name).toMatch(/^SKIP box-token: server: token-absent — /);
      expect(d.stdout, name).not.toContain('no value has been minted here yet');
      expect(d.code, name).toBe(3);
    }
  });
  // A dangling symlink is a trace too: `_bt_server_trace` tests each name by `[ -e ] || [ -L ]`, and `-e` follows the link to
  // a target that is not there. These rows plant the link as the ONLY trace, so deleting either `|| [ -L … ]` half reds one
  // of them (ruled into Task 5 for review findings on Task 4; the rows pin behaviour that already held).
  for (const [name, half] of [['box-token-retired.json', 'the trace-name test'], ['box-token.json.unusable-1760000000000', 'the set-aside test']] as const) {
    it(`review 391 F1: a dangling symlink named ${name} is the only trace: FAIL, never the never-minted PASS (4554; ${half} reads \`-L\`)`, () => {
      const b = box({ role: 'server' });
      dropServer(b);
      symlinkSync(join(b.home, 'no-such-target'), dot(b, name));
      const r = runCheck(b, CHECKS_SRC);
      expect(r.stdout).toMatch(/^FAIL box-token: server: token-absent — /);
      expect(r.stdout).not.toContain(SERVER_NEVER);
      expect(r.code).toBe(1);
    });
  }
  it('names beside it that are not traces (box-token.json.bak, notes.txt) keep the fresh PASS (4554)', () => {
    const b = box({ role: 'server' });
    dropServer(b);
    writeFileSync(dot(b, 'box-token.json.bak'), '{}', { mode: 0o600 });
    writeFileSync(dot(b, 'notes.txt'), 'x\n', { mode: 0o600 });
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toMatch(new RegExp(`^PASS box-token: ${never('server')}\\n$`));
    expect(r.code).toBe(0);
  });
  // Row 3a, R19: a `~/.cc-secrets` that is MISSING is not unsearchable (ENOENT, not EACCES), so a fresh own-write box with
  // no such directory keeps the fresh PASS on both parts.
  it('both role, local, own-write, fresh, with no ~/.cc-secrets at all: the fresh PASS on both parts (row 3a, R19: a missing directory is not unsearchable)', () => {
    const b = box({ role: 'both' });
    dropServer(b); dropFleet(b);
    rmSync(join(b.home, '.cc-secrets'), { recursive: true });
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toMatch(new RegExp(`^PASS box-token: ${never('server')}; ${never('fleet')}\\n$`));
    expect(r.code).toBe(0);
  });
  it('fleet role: no token file, no generation file and no sync report is PASS rc 0, naming the fact, with no remedy; disarmed the same', () => {
    const b = box({ role: 'fleet' });
    dropFleet(b);
    for (const checks of [CHECKS_SRC, disarmed()]) {
      const r = runCheck(b, checks);
      expect(r.stdout).toMatch(new RegExp(`^PASS box-token: ${never('fleet')}\\n$`));
      expect(r.stdout).not.toMatch(/remedy:|WARN|FAIL|SKIP|no-generation|never-synced/);
      expect(r.code).toBe(0);
    }
  });
  // Review 383 F12: `ccrc-token-sync`'s `_ts_refuse` writes token-sync.json on refusals where nothing was claimed or
  // written, so a report is not by itself the history of a value. The refusal still shows as its own `sync:<word>`, at its
  // armed class (WARN: a fault a person can act on); only `fleet-token-absent` takes the never-handed PASS form.
  const REFUSALS = ['bad-code', 'stale-client', 'claim-refused', 'write-failed', 'code-used', 'busy', 'spawn-failed'];
  for (const word of REFUSALS) {
    it(`f-failed-first-sync: fleet role, no token file, no generation file, a first sync refused (${word}) is the refusal's WARN beside a never-handed fleet-token-absent, not a FAIL`, () => {
      const b = box({ role: 'fleet' });
      dropFleet(b);
      plantReport(b, { result: word, generation: null, transport: null, proof: null });
      const r = runCheck(b, CHECKS_SRC);
      expect(r.stdout).toMatch(new RegExp(`^WARN box-token: ${never('fleet')}; fleet: sync:${word} — `));
      expect(r.stdout).not.toMatch(/no-generation|never-synced/);
      expect(r.stdout).toMatch(/\n {2}remedy: \S/);
      expect(r.code).toBe(2);
      const d = runCheck(b, disarmed());
      expect(d.stdout).toMatch(new RegExp(`^SKIP box-token: ${never('fleet')}; fleet: sync:${word} — .*${SKIP_TAIL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\n$`));
      expect(d.code).toBe(3);
    });
  }
  // Review 391 F2 (4555): the refusal-only rule needs `held` absent. A refusal that wrote nothing carries `held` when the box
  // held a generation, and that is history: the lost token reads FAIL, never the never-handed PASS.
  const plantHeldRefusal = (b: Box): void => {
    dropFleet(b);
    plantReport(b, { result: 'bad-code', generation: null, transport: null, proof: null, held: ID_CUR });
  };
  it('review 391 F2: a box that synced, then refused, then lost its token and generation files is a FAIL, never never-handed (4555)', () => {
    const b = box({ role: 'fleet' });
    plantHeldRefusal(b);
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toMatch(/^FAIL box-token: fleet: fleet-token-absent — .* does not exist, so this box's calls to the server carry no box token/);
    expect(r.stdout.split('\n')[0]).toContain('fleet: sync:bad-code — ');
    expect(r.stdout).not.toContain(FLEET_NEVER);
    expect(r.stdout).toMatch(/\n {2}remedy: \S/);
    expect(r.code).toBe(1);
  });
  it('both role, remote: a healthy server and a fleet side that synced, refused and lost its files is a FAIL on the fleet part (4555)', () => {
    const b = box({ role: 'both', fleet: 'remote', agentEnv: true });
    plantHeldRefusal(b);
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toMatch(new RegExp(`^FAIL box-token: ${SERVER_PASS}; fleet: fleet-token-absent — .* does not exist, so this box's calls`));
    expect(r.stdout).not.toContain(FLEET_NEVER);
    expect(r.code).toBe(1);
  });
  for (const [label, held] of [['xyz', 'xyz'], ['null', null], ['7', 7]] as const) {
    it(`a held that is not one generation id is unreadable, and the lost token stays FAIL (4555): held ${label}`, () => {
      const b = box({ role: 'fleet' });
      dropFleet(b);
      plantReport(b, { result: 'bad-code', generation: null, transport: null, proof: null, held });
      const r = runCheck(b, CHECKS_SRC);
      expect(r.stdout).toContain('fleet: sync-unreadable — ');
      expect(r.stdout).toMatch(/^FAIL /);
      expect(r.stdout).not.toContain(FLEET_NEVER);
      expect(r.code).toBe(1);
    });
  }
  it('held changes nothing while the token file is there: a healthy fleet box with a refusal report reads the same with or without it (4555)', () => {
    const without = box({ role: 'fleet' });
    plantReport(without, { result: 'bad-code', generation: null, transport: null, proof: null });
    const withHeld = box({ role: 'fleet' });
    plantReport(withHeld, { result: 'bad-code', generation: null, transport: null, proof: null, held: ID_CUR });
    const a = runCheck(without, CHECKS_SRC);
    const h = runCheck(withHeld, CHECKS_SRC);
    expect(a.stdout).toMatch(/^WARN box-token: fleet: sync:bad-code — /);
    expect(h.stdout).toBe(a.stdout);
    expect(h.code).toBe(a.code);
  });
  it('both role, local: nothing of either side is two PASS parts on one line, rc 0', () => {
    const b = box({ role: 'both' });
    dropServer(b); dropFleet(b);
    for (const checks of [CHECKS_SRC, disarmed()]) {
      const r = runCheck(b, checks);
      expect(r.stdout).toMatch(new RegExp(`^PASS box-token: ${never('server')}; ${never('fleet')}\\n$`));
      expect(r.code).toBe(0);
    }
  });
  // 4554: the own-write fleet arm reads a server trace as "the state read was not `absent`", so it agrees with the server arm.
  const bothTrace = (name: string, plant: (b: Box) => void, serverWord: string): void => {
    const b = box({ role: 'both' });
    dropServer(b); dropFleet(b);
    plant(b);
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout, name).toMatch(new RegExp(`^FAIL box-token: server: token-absent — .*${serverWord}`));
    expect(r.stdout, name).toMatch(/; fleet: fleet-token-absent — .* does not exist, so this box's calls to the server carry no box token/);
    expect(r.stdout, name).not.toContain(FLEET_NEVER);
    expect(r.stdout, name).not.toContain(SERVER_NEVER);
    expect(r.code, name).toBe(1);
  };
  it('both role, local, own-write: a fresh-looking box with a server trace is FAIL on both arms: the fleet arm agrees (4554)', () => {
    bothTrace('box-token-retired.json', (b) => writeFileSync(dot(b, 'box-token-retired.json'), RETIRED, { mode: 0o600 }), 'box-token-retired\\.json does: ');
  });
  it('both role, local, own-write: the same with a set-aside trace in place of the retired file (4554)', () => {
    bothTrace('box-token.json.unusable-1760000000000', (b) => writeFileSync(dot(b, 'box-token.json.unusable-1760000000000'), '{}', { mode: 0o600 }),
      'box-token\\.json\\.unusable-1760000000000 does: ');
  });
  // Review 405 F1 (4554, amended): on an own-write box (role both, local, no agent.env marking the fleet) the SERVER wrote the fleet
  // token file and `box-token-generation`, so either one beside an absent token and an absent state shows this server held a
  // value once. They are traces of the server part, by existence only (`[ -e ] || [ -L ]`: the fleet file holds a value, and is
  // never opened for this). Everywhere else they are the fleet's own records, and the server part reads as it did.
  const loseServerOnly = (b: Box): void => { for (const f of ['mail.token', 'box-token.json']) rmSync(dot(b, f)); rmSync(dot(b, 'token-sync.json')); };
  const OWN_LOST = (word: string): RegExp => new RegExp(`^FAIL box-token: server: token-absent — .* but .*${word} does: this server held a value once and lost it`);
  const markFleet = (b: Box): void => writeFileSync(dot(b, 'agent.env'), `CCRC_SERVER_URL=ws://127.0.0.1:7788\nCCRC_AGENT_TOKEN=${randomBytes(16).toString('hex')}\n`, { mode: 0o600 });
  it('review 405 F1: both role, local, own-write: the server lost its token and state but the fleet file and the generation file stay: FAIL naming the fleet file, never the never-minted PASS (4554)', () => {
    const b = box({ role: 'both' });
    loseServerOnly(b);
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toMatch(OWN_LOST('ccrc-mail\\.token'));
    expect(r.stdout.split('\n')[0]).toContain(`but ${fleetFile(b)} does: `);
    expect(r.stdout).not.toContain(SERVER_NEVER);
    expect(r.stdout).toMatch(/\n {2}remedy: \S/);
    expect(r.code).toBe(1);
  });
  it('review 405 F1: both role, local, own-write: only the generation file stays (the fleet file gone too): the server part names the generation file, never the never-minted sentence (4554)', () => {
    const b = box({ role: 'both' });
    loseServerOnly(b);
    rmSync(fleetFile(b));
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toMatch(OWN_LOST('box-token-generation'));
    expect(r.stdout.split('\n')[0]).toContain(`but ${dot(b, NODE_FILES.tokenGeneration)} does: `);
    expect(r.stdout).not.toContain(SERVER_NEVER);
    expect(r.code).toBe(1);
  });
  it('review 405 F1: both role, local, own-write: only the fleet file stays (the generation file gone): the server part names the fleet file (4554)', () => {
    const b = box({ role: 'both' });
    loseServerOnly(b);
    rmSync(dot(b, NODE_FILES.tokenGeneration));
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toMatch(OWN_LOST('ccrc-mail\\.token'));
    expect(r.stdout).not.toContain(SERVER_NEVER);
    expect(r.stdout).toMatch(/\n {2}remedy: \S/);
    expect(r.code).toBe(1);
  });
  it('review 405 F1: the same input with the FAIL and WARN arms switched off prints SKIP rc 3, still the trace sentence, never the never-minted one (4554)', () => {
    const b = box({ role: 'both' });
    loseServerOnly(b);
    const d = runCheck(b, disarmed());
    expect(d.stdout).toMatch(/^SKIP box-token: server: token-absent — .* but .*ccrc-mail\.token does: this server held a value once and lost it/);
    expect(d.stdout).not.toContain(SERVER_NEVER);
    expect(d.code).toBe(3);
  });
  // Where it never applies: a both box whose agent.env marks the fleet (or whose fleet mode is remote) is not an own-write
  // box, the fleet files there are the fleet agent's, and the server part keeps reading never-minted (the live boxes are such).
  /** The reading measured at 6faca9bdf for these inputs (the server lost its token and state, the fleet side kept its files but no
   *  report): the server part is the never-minted PASS part, and the fleet part is the missing sync report's WARN. Pinned whole. */
  const TODAYS_READING = (b: Box): string =>
    `WARN box-token: server: token-absent — ${dot(b, 'mail.token')} does not exist, and neither does the server's state file: ${SERVER_NEVER}; `
    + `fleet: never-synced — ${dot(b, 'token-sync.json')} does not exist, so ccrc token sync has never run here\n`
    + `  remedy: Rotate now on the console's Box token card\n`;
  it('review 405 F1: a both box whose agent.env marks the fleet keeps today\'s reading, byte for byte: the fleet files are not a server trace (4554)', () => {
    const b = box({ role: 'both' });
    markFleet(b);
    loseServerOnly(b);
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toBe(TODAYS_READING(b));
    expect(r.code).toBe(2);
  });
  it('review 405 F1: a both box with CCRC_FLEET=remote keeps today\'s reading, byte for byte (4554)', () => {
    const b = box({ role: 'both', fleet: 'remote', agentEnv: true });
    loseServerOnly(b);
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toBe(TODAYS_READING(b));
    expect(r.code).toBe(2);
  });
  it('review 405 F1: a server-role box with a stray fleet file and generation file keeps the fresh PASS (4554: never applies off an own-write box)', () => {
    const b = box({ role: 'server' });
    dropServer(b);
    mkdirSync(join(b.home, '.cc-secrets'), { recursive: true, mode: 0o700 });
    writeFileSync(fleetFile(b), `# stray\n${b.fleetValue}\n`, { mode: 0o600 });
    writeFileSync(dot(b, NODE_FILES.tokenGeneration), `${ID_CUR}\n`, { mode: 0o600 });
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toMatch(new RegExp(`^PASS box-token: ${never('server')}\\n$`));
    expect(r.code).toBe(0);
  });
  // A dangling symlink is a trace too (`-e` follows the link to a target that is not there): the only own-write trace, per
  // name, so deleting either `|| [ -L … ]` half reds one of these rows.
  for (const [what, plant] of [
    ['the fleet token file', (b: Box): void => { rmSync(dot(b, NODE_FILES.tokenGeneration)); rmSync(fleetFile(b)); symlinkSync(join(b.home, 'no-such-target'), fleetFile(b)); }],
    ['the generation file', (b: Box): void => { rmSync(fleetFile(b)); rmSync(dot(b, NODE_FILES.tokenGeneration)); symlinkSync(join(b.home, 'no-such-target'), dot(b, NODE_FILES.tokenGeneration)); }],
  ] as const) {
    it(`review 405 F1: both role, local, own-write: a dangling symlink as ${what} is the only trace: FAIL on the server part (4554)`, () => {
      const b = box({ role: 'both' });
      loseServerOnly(b);
      plant(b);
      const r = runCheck(b, CHECKS_SRC);
      expect(r.stdout).toMatch(/^FAIL box-token: server: token-absent — .* but .* does: this server held a value once and lost it/);
      expect(r.stdout).not.toContain(SERVER_NEVER);
      expect(r.code).toBe(1);
    });
  }
  it('both role, local: the same box with a generation file left behind lost its value, a FAIL on the fleet arm', () => {
    const b = box({ role: 'both' });
    for (const f of [fleetFile(b), dot(b, 'token-sync.json'), dot(b, 'mail.token'), dot(b, 'box-token.json')]) rmSync(f);
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toMatch(/^FAIL box-token: server: token-absent — .*; fleet: fleet-token-absent — /);
    expect(r.code).toBe(1);
  });
  // Review 383 F1: on an own-write box the fleet file, the generation file and `fleetConfirmed` are written together by
  // the server, so a state that is PRESENT proves the hand-out whatever the generation file says. The generation file
  // alone is not the history; the server arm's state read outranks it (the narrowing reads never-handed only when that
  // read was itself `absent`).
  it('both role, local, own-write: a valid state at generation #2 (fleet confirmed, a rotation recorded) and the fleet and generation files gone is a FAIL, never never-handed', () => {
    const b = box({ role: 'both' });
    for (const f of [fleetFile(b), dot(b, NODE_FILES.tokenGeneration), dot(b, 'token-sync.json')]) rmSync(f);
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toMatch(/^FAIL box-token: server: generation #2.*; fleet: fleet-token-absent — .* does not exist, so this box's calls to the server carry no box token/);
    expect(r.stdout).not.toContain(FLEET_NEVER);
    expect(r.stdout).toMatch(/\n {2}remedy: \S/);
    expect(r.code).toBe(1);
  });
  it('both role, local, own-write: the same loss under a state that records no hand-out yet (minted, no rotation, nothing confirmed) is a FAIL too: any present state outranks the generation file', () => {
    const b = box({ role: 'both' });
    editState(b, (s) => { s.origin = 'minted'; s.lastRotationAt = null; s.fleetConfirmed = null; s.lastSync = null; s.retiredRefusedAt = null; });
    for (const f of [fleetFile(b), dot(b, NODE_FILES.tokenGeneration), dot(b, 'token-sync.json')]) rmSync(f);
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toMatch(/^FAIL box-token: /);
    expect(r.stdout).not.toContain(FLEET_NEVER);
    expect(r.code).toBe(1);
  });
  it('both role, local, own-write: a state it cannot read is no `absent` read either, so the lost fleet value stays FAIL', () => {
    const b = box({ role: 'both' });
    plantState(b, '{"v":1,');
    for (const f of [fleetFile(b), dot(b, NODE_FILES.tokenGeneration), dot(b, 'token-sync.json')]) rmSync(f);
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toMatch(/^FAIL box-token: /);
    expect(r.stdout).not.toContain(FLEET_NEVER);
    expect(r.code).toBe(1);
  });
  it('both role, remote: the worse arm wins, so a fresh server with a fleet that lost its value is a FAIL', () => {
    const b = box({ role: 'both', fleet: 'remote', agentEnv: true });
    for (const f of [fleetFile(b), dot(b, 'mail.token'), dot(b, 'box-token.json')]) rmSync(f);
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toMatch(/^FAIL box-token: /);
    expect(r.code).toBe(1);
  });
  it('a never-handed arm beside a WARN keeps the line WARN: the PASS part is not a finding, the WARN is (fresh server, healthy fleet with no proof)', () => {
    const b = box({ role: 'both', fleet: 'remote', agentEnv: true });
    dropServer(b);
    plantReport(b, { result: 'proof-unmeasured', proof: 'proof-unmeasured' });
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toMatch(new RegExp(`^WARN box-token: ${never('server')}; fleet: proof-unmeasured — `));
    expect(r.code).toBe(2);
  });
});

// Review 383 F5: `[ -e ]` is false for ENOENT and for EACCES alike, so a token file inside a directory this process cannot
// search (mode 0600: no search bit) read as ABSENT, which the never-handed lowering turned into a WARN, and whose
// sentence ("does not exist") was false. Absent is a measured ENOENT; a parent that exists and cannot be searched is
// UNMEASURED, the arm's existing unreadable word (FAIL). A root runner can search any directory, so these rows skip there
// (the suite's own idiom, as the agent.env case above).
describe('doctor box-token: an unsearchable parent directory is unreadable, never absent (review 383 F5)', () => {
  const itNonRoot = process.getuid && process.getuid() === 0 ? it.skip : it;
  const unsearchable = (dir: string, f: () => void): void => {
    chmodSync(dir, 0o600);
    try { f(); } finally { chmodSync(dir, 0o700); }
  };
  const noFleetHistory = (b: Box): void => { for (const f of [dot(b, NODE_FILES.tokenGeneration), dot(b, 'token-sync.json')]) rmSync(f); };
  itNonRoot('fleet: ~/.cc-secrets at mode 0600 holding the token file, with no generation file and no sync report, is FAIL fleet-token-unusable (cannot be read), not a never-handed box', () => {
    const b = box({ role: 'fleet' });
    noFleetHistory(b);
    unsearchable(join(b.home, '.cc-secrets'), () => {
      const r = runCheck(b, CHECKS_SRC);
      expect(r.stdout).toMatch(/^FAIL box-token: fleet: fleet-token-unusable — .* cannot be read/);
      expect(r.stdout).not.toMatch(/ccrc-mail\.token does not exist/);
      expect(r.stdout).not.toContain(FLEET_NEVER);
      expect(r.stdout).toMatch(/\n {2}remedy: \S/);
      expect(r.code).toBe(1);
      const d = runCheck(b, disarmed());
      expect(d.stdout).toMatch(/^SKIP box-token: fleet: fleet-token-unusable — /);
      expect(d.code).toBe(3);
    });
  });
  itNonRoot('fleet: the same directory with the generation file and the report present stays FAIL, and its sentence no longer says "does not exist"', () => {
    const b = box({ role: 'fleet' });
    unsearchable(join(b.home, '.cc-secrets'), () => {
      const r = runCheck(b, CHECKS_SRC);
      expect(r.stdout).toMatch(/^FAIL box-token: fleet: fleet-token-unusable — .* cannot be read/);
      expect(r.stdout).not.toMatch(/ccrc-mail\.token does not exist/);
      expect(r.code).toBe(1);
    });
  });
  itNonRoot('fleet: a directory that is only missing is still absent (ENOENT), so the never-handed PASS holds when ~/.cc-secrets does not exist at all', () => {
    const b = box({ role: 'fleet' });
    noFleetHistory(b);
    rmSync(join(b.home, '.cc-secrets'), { recursive: true });
    const r = runCheck(b, CHECKS_SRC);
    expect(r.stdout).toMatch(new RegExp(`^PASS box-token: fleet: fleet-token-absent — .* ${FLEET_NEVER}\\n$`));
    expect(r.code).toBe(0);
  });
  itNonRoot('server: a token path inside a directory that cannot be searched (CCRC_MAIL_TOKEN_PATH) is FAIL token-unusable (cannot be read), never absent, and its state beside it is unreadable too', () => {
    const b = box({ role: 'server' });
    const alt = join(b.home, 'alt-dir');
    mkdirSync(alt, { recursive: true, mode: 0o700 });
    renameSync(dot(b, 'mail.token'), join(alt, 'custom.token'));
    renameSync(dot(b, 'box-token.json'), join(alt, 'box-token.json'));
    writeFileSync(dot(b, 'ccrc.env'), `CCRC_ROLE=server\nCCRC_FLEET=local\nCCRC_MAIL_TOKEN_PATH=${join(alt, 'custom.token')}\n`, { mode: 0o600 });
    unsearchable(alt, () => {
      const r = runCheck(b, CHECKS_SRC);
      expect(r.stdout).toMatch(/^FAIL box-token: server: token-unusable — .* cannot be read/);
      expect(r.stdout).toContain('server: state-unreadable — ');
      expect(r.stdout).not.toMatch(/custom\.token does not exist/);
      expect(r.stdout).not.toContain(SERVER_NEVER);
      expect(r.code).toBe(1);
    });
  });
  // 4554: a directory with a search bit and no read bit opens its files but cannot list them, so a set-aside copy cannot be
  // ruled out, and boot refuses to start on it. Its state read is `absent` (`lstat` needs only search). An undecidable
  // history fails closed, with a sentence and remedy of its own: "restart the server" would be false there, whatever the
  // directory or the fleet side also holds (row 3a, R18).
  const unlistable = (b: Box, role: 'server' | 'both'): string => {
    const alt = join(b.home, 'alt-dir');
    mkdirSync(alt, { recursive: true, mode: 0o700 });
    for (const f of ['mail.token', 'box-token.json']) rmSync(dot(b, f));
    writeFileSync(dot(b, 'ccrc.env'), `CCRC_ROLE=${role}\nCCRC_FLEET=local\nCCRC_MAIL_TOKEN_PATH=${join(alt, 'custom.token')}\n`, { mode: 0o600 });
    return alt;
  };
  const listless = (dir: string, f: () => void): void => {
    chmodSync(dir, 0o300);
    try { f(); } finally { chmodSync(dir, 0o700); }
  };
  itNonRoot('server: a token directory that exists and cannot be listed (search, no read) cannot rule a trace out: FAIL with its own sentence and remedy, never the never-minted PASS (4554)', () => {
    const b = box({ role: 'server' });
    const alt = unlistable(b, 'server');
    listless(alt, () => {
      const r = runCheck(b, CHECKS_SRC);
      expect(r.stdout).toMatch(/^FAIL box-token: server: token-absent — .* cannot be listed/);
      expect(r.stdout.split('\n')[0]).toContain('refuses to boot until it can list it');
      expect(r.stdout).toMatch(/\n {2}remedy: .*chmod u\+r /);
      expect(r.stdout).not.toContain(SERVER_NEVER);
      expect(r.code).toBe(1);
    });
  });
  itNonRoot('both role, local, own-write: the same unlistable directory is FAIL on the fleet part too (4554)', () => {
    const b = box({ role: 'both' });
    const alt = unlistable(b, 'both');
    for (const f of [fleetFile(b), dot(b, NODE_FILES.tokenGeneration), dot(b, 'token-sync.json')]) rmSync(f);
    listless(alt, () => {
      const r = runCheck(b, CHECKS_SRC);
      expect(r.stdout).toMatch(/^FAIL box-token: server: token-absent — .* cannot be listed/);
      expect(r.stdout).toMatch(/; fleet: fleet-token-absent — .* does not exist, so this box's calls to the server carry no box token/);
      expect(r.stdout).not.toContain(FLEET_NEVER);
      expect(r.code).toBe(1);
    });
  });
  // Row 3a, R18 (4554 amended): the unlisted test runs FIRST, so a directory that cannot be listed always gets the
  // `chmod u+r` remedy, whatever it or the fleet side also holds. Boot refuses to start on such a directory, so "restart the
  // server" would be false there even when a named trace stands beside the state file.
  itNonRoot('server: an unlistable token directory that also holds a named trace gets the chmod u+r remedy, never the restart remedy (row 3a, R18; 4554 limit (a) closed)', () => {
    const b = box({ role: 'server' });
    const alt = unlistable(b, 'server');
    writeFileSync(join(alt, 'box-token-retired.json'), RETIRED, { mode: 0o600 });
    listless(alt, () => {
      const r = runCheck(b, CHECKS_SRC);
      expect(r.stdout).toMatch(/^FAIL box-token: server: token-absent — .* cannot be listed/);
      expect(r.stdout).toMatch(/\n {2}remedy: .*chmod u\+r /);
      expect(r.stdout).not.toContain('restart the server');
      expect(r.stdout).not.toContain(SERVER_NEVER);
      expect(r.code).toBe(1);
      const d = runCheck(b, disarmed());
      expect(d.stdout).toMatch(/^SKIP box-token: /);
      expect(d.code).toBe(3);
    });
  });
  itNonRoot('both role, local, own-write: an unlistable token directory with the fleet file and the generation file surviving gets the chmod u+r remedy (row 3a, R18)', () => {
    const b = box({ role: 'both' });
    const alt = unlistable(b, 'both');
    rmSync(dot(b, 'token-sync.json'));
    // The precondition: both own-write traces stand, so the old order would have named one of them.
    expect(existsSync(fleetFile(b)) && existsSync(dot(b, NODE_FILES.tokenGeneration))).toBe(true);
    listless(alt, () => {
      const r = runCheck(b, CHECKS_SRC);
      expect(r.stdout).toMatch(/^FAIL box-token: server: token-absent — .* cannot be listed/);
      expect(r.stdout).toMatch(/\n {2}remedy: .*chmod u\+r /);
      expect(r.stdout).not.toContain('restart the server (ccrc.service)');
      expect(r.code).toBe(1);
      const d = runCheck(b, disarmed());
      expect(d.stdout).toMatch(/^SKIP box-token: /);
      expect(d.code).toBe(3);
    });
  });
  // Row 3a, R19 (4554 amended): on an own-write box a `~/.cc-secrets` that exists and cannot be searched hides the fleet
  // token file from `-e`. With no generation file standing, that is its own trace word, never `unlisted` and never the
  // never-minted PASS: two conditions, two remedies (u+x, u+r). The verdict is FAIL either way, through the fleet part.
  const reEsc = (x: string): string => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lostServerAndFleetHistory = (b: Box): void => {
    for (const f of [dot(b, 'mail.token'), dot(b, 'box-token.json'), dot(b, NODE_FILES.tokenGeneration), dot(b, 'token-sync.json')]) rmSync(f);
  };
  itNonRoot('both role, local, own-write: ~/.cc-secrets that cannot be searched is its own word on the server part, unsearchable, with a chmod u+x remedy; the line stays FAIL rc 1 (row 3a, R19)', () => {
    const b = box({ role: 'both' });
    lostServerAndFleetHistory(b);
    const secrets = join(b.home, '.cc-secrets');
    unsearchable(secrets, () => {
      const r = runCheck(b, CHECKS_SRC);
      expect(r.stdout).toMatch(/^FAIL box-token: server: token-absent — .* cannot be searched, so whether this box's server wrote the fleet token file there cannot be told/);
      expect(r.stdout).toContain('fleet: fleet-token-unusable — ');
      expect(r.stdout).toMatch(new RegExp(`\\n {2}remedy: .*chmod u\\+x ${reEsc(secrets)}`));
      expect(r.stdout).not.toContain(SERVER_NEVER);
      expect(r.stdout).not.toContain('cannot be listed');
      expect(r.code).toBe(1);
      const d = runCheck(b, disarmed());
      expect(d.stdout).toMatch(/^SKIP box-token: /);
      expect(d.code).toBe(3);
    });
  });
  itNonRoot('both role, local, own-write: with ~/.cc-secrets unsearchable but the generation file present, the generation file is the named trace (row 3a, R19)', () => {
    const b = box({ role: 'both' });
    for (const f of [dot(b, 'mail.token'), dot(b, 'box-token.json'), dot(b, 'token-sync.json')]) rmSync(f);
    expect(existsSync(dot(b, NODE_FILES.tokenGeneration))).toBe(true);
    unsearchable(join(b.home, '.cc-secrets'), () => {
      const r = runCheck(b, CHECKS_SRC);
      expect(r.stdout).toMatch(new RegExp(`^FAIL box-token: server: token-absent — .* but .*${reEsc(NODE_FILES.tokenGeneration)} does: this server held a value once`));
      expect(r.stdout).not.toContain('cannot be searched');
      expect(r.code).toBe(1);
      const d = runCheck(b, disarmed());
      expect(d.stdout).toMatch(/^SKIP box-token: /);
      expect(d.code).toBe(3);
    });
  });
  // A set-aside copy beside the state file is a definite trace, so it is named even when ~/.cc-secrets cannot be searched:
  // the unsearchable word says only that the history cannot be told, and here a copy tells it.
  itNonRoot('both role, local, own-write: with ~/.cc-secrets unsearchable and a set-aside copy of the state file in the token directory, the copy is the named trace, not unsearchable (row 3a, R19)', () => {
    const b = box({ role: 'both' });
    lostServerAndFleetHistory(b);
    const aside = dot(b, 'box-token.json.unusable-1760000000000');
    writeFileSync(aside, '{}\n', { mode: 0o600 });
    unsearchable(join(b.home, '.cc-secrets'), () => {
      const r = runCheck(b, CHECKS_SRC);
      expect(r.stdout).toMatch(new RegExp(`^FAIL box-token: server: token-absent — .* but ${reEsc(aside)} does: this server held a value once`));
      expect(r.stdout).not.toContain('cannot be searched, so whether this box');
      expect(r.stdout).not.toContain('its search bit');
      expect(r.code).toBe(1);
      const d = runCheck(b, disarmed());
      expect(d.stdout).toMatch(/^SKIP box-token: /);
      expect(d.code).toBe(3);
    });
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
  it('the interval and its overdue slack are L0\'s (4557)', () => {
    expect(arr('_BT_INTERVAL_MS')).toEqual([String(TOKEN_ROTATION_INTERVAL_MS)]);
    expect(arr('_BT_OVERDUE_SLACK_MS')).toEqual([String(TOKEN_ROTATION_OVERDUE_SLACK_MS)]);
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
  it('the server trace names are the server writer\'s (tokenPaths, SET_ASIDE_MARK, and boot\'s own set-aside list) (4554)', () => {
    const p = tokenPaths('/x/mail.token', '/h');
    expect(arr('_BT_TRACES')).toEqual([path.basename(p.retired), path.basename(p.previous)]);
    expect(arr('_BT_ASIDE')).toEqual([path.basename(p.retired) + SET_ASIDE_MARK, path.basename(p.state) + SET_ASIDE_MARK]);
    const boot = readFileSync(join(REPO, 'server', 'src', 'token', 'boot.ts'), 'utf8');
    const hits = [...boot.matchAll(/const prefixes = \[([^\]]*)\]\.map/g)];
    expect(hits, 'boot.ts no longer lists its set-aside prefixes in this shape: re-point the pin').toHaveLength(1);
    const keys = hits[0]![1]!.split(',').map((x) => x.trim()).filter(Boolean).map((x) => /^paths\.(\w+)$/.exec(x)?.[1] ?? `?${x}`);
    expect(keys.length).toBeGreaterThan(0);
    const bootAside = keys.map((k) => {
      const v = (p as unknown as Record<string, unknown>)[k];
      if (typeof v !== 'string') throw new Error(`boot's set-aside list names paths.${k}, which tokenPaths does not carry as a path`);
      return path.basename(v) + SET_ASIDE_MARK;
    });
    expect(bootAside).toEqual(arr('_BT_ASIDE'));
  });
  it('the generation file and the fleet file are the names the writers use', () => {
    const src = readFileSync(CHECKS_SRC, 'utf8');
    expect(src.includes(`/.ccrc/${NODE_FILES.tokenGeneration}"`), 'the generation file').toBe(true);
    expect(src.includes('/.cc-secrets/ccrc-mail.token"'), 'the fleet token file').toBe(true);
  });
});
