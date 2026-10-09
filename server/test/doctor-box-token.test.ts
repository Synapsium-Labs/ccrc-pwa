// `ccrc doctor`'s `box-token` check (box-token lifecycle, wave 1, Task B5; spec 4.8; D-4391).
//
// WAVE 1 PRINTS PASS OR SKIP ONLY. Every state that will be a FAIL or a WARN once the arms ship (held, failed,
// a pending value past its deadline, an owed rotation, proof-unmeasured, a failed boot mint, a boot recovery not
// yet followed by a rotation, a retired value presented, a broken file) prints `SKIP box-token: …` with its
// reason word, never PASS: a PASS there is the one way an operator reads a stalled first retirement as healthy
// (Review Focus 4). The FAIL and WARN arms are compiled in behind the file-level constant `_BT_ARMS_ON=0`; this
// file proves they are reachable by running the same fixtures against a COPY of the checks file with the
// constant flipped, so the follow-up PR that flips it ships arms that already ran.
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
import { chmodSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { TOKEN_HOLDS, OWED_REASONS, TOKEN_ORIGINS } from '../../shared/box-token.js';
import { NODE_FILES, TOKEN_SYNC_OP_ERRORS, TOKEN_TRANSPORTS } from '../../shared/agent-protocol.js';
import { TOKEN_FILE_PROBLEMS } from '../../shared/box-token.js';
import { FAILURES_FOR_BANNER, type BoxTokenState } from '../src/token/policy.js';

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

const SKIP_TAIL = '; reported as SKIP until the FAIL and WARN arms ship';
const ID_OLD = 'a1b2c3d4e5f60718';
const ID_CUR = '0123456789abcdef';
const MIN = 60_000;

interface Box { home: string; value: string; fleetValue: string }
interface Run { code: number; stdout: string; stderr: string }

/** The shipped checks file, or a copy of it with `_BT_ARMS_ON=0` flipped to 1 (exactly one line moves). */
function armedCopy(): string {
  const src = readFileSync(CHECKS_SRC, 'utf8');
  const flipped = src.replace(/^_BT_ARMS_ON=0$/m, '_BT_ARMS_ON=1');
  if (flipped === src) throw new Error('the checks file carries no `_BT_ARMS_ON=0` line to flip');
  const d = mkTmp('ccrc-bt-armed-');
  writeFileSync(join(d, 'ccrc-doctor-checks'), flipped);
  return join(d, 'ccrc-doctor-checks');
}
let ARMED: string | null = null;
const armed = (): string => (ARMED ??= armedCopy());

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

  it('transport http is printed on the PASS line and never changes the verdict, armed or not', () => {
    const b = box({ role: 'fleet' });
    plantReport(b, { transport: 'http' });
    const want = 'PASS box-token: fleet: token file 0600, generation recorded, last sync proved, transport http\n';
    for (const checks of [CHECKS_SRC, armed()]) {
      const r = runCheck(b, checks);
      expect(r.stdout).toBe(want);
      expect(r.code).toBe(0);
    }
  });
});

// ── every armed-later state: SKIP now, FAIL or WARN once armed ─────────────

interface Row { word: string; arm: 'server' | 'fleet'; armedClass: 'FAIL' | 'WARN'; plant: (b: Box) => void }
const now = (): number => Date.now();
const ROWS: Row[] = [
  { arm: 'server', word: 'token-absent', armedClass: 'FAIL', plant: (b) => rmSync(dot(b, 'mail.token')) },
  { arm: 'server', word: 'token-mode', armedClass: 'FAIL', plant: (b) => chmodSync(dot(b, 'mail.token'), 0o644) },
  { arm: 'server', word: 'token-unusable', armedClass: 'FAIL', plant: (b) => writeFileSync(dot(b, 'mail.token'), '# no value line\n\n', { mode: 0o600 }) },
  { arm: 'server', word: 'state-absent', armedClass: 'WARN', plant: (b) => rmSync(dot(b, 'box-token.json')) },
  { arm: 'server', word: 'state-unreadable', armedClass: 'FAIL', plant: (b) => plantState(b, '{"v":1,') },
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
  { arm: 'server', word: 'recovered', armedClass: 'WARN', plant: (b) => editState(b, (s) => { s.lastBootRecovery = { at: now() - MIN, source: 'previous' }; }) },
  { arm: 'server', word: 'retired-presented', armedClass: 'FAIL', plant: (b) => editState(b, (s) => { s.counters.retiredPresented = 2; }) },
  { arm: 'server', word: 'fleet-behind', armedClass: 'WARN', plant: (b) => editState(b, (s) => { s.fleetConfirmed = ID_OLD; }) },
  // Added at plan assembly (review findings):
  { arm: 'server', word: 'fleet-unconfirmed', armedClass: 'WARN', plant: (b) => editState(b, (s) => { s.current.id = null; s.fleetConfirmed = null; }) },
  { arm: 'server', word: 'file:changed', armedClass: 'FAIL', plant: (b) => editState(b, (s) => { s.fileProblem = { at: now() - MIN, file: 'current', word: 'changed' }; }) },
  { arm: 'server', word: 'file:retired', armedClass: 'FAIL', plant: (b) => editState(b, (s) => { s.fileProblem = { at: now() - MIN, file: 'current', word: 'retired' }; }) },
  { arm: 'fleet', word: 'fleet-token-absent', armedClass: 'FAIL', plant: (b) => rmSync(fleetFile(b)) },
  { arm: 'fleet', word: 'fleet-token-mode', armedClass: 'FAIL', plant: (b) => chmodSync(fleetFile(b), 0o640) },
  { arm: 'fleet', word: 'fleet-token-unusable', armedClass: 'FAIL', plant: (b) => writeFileSync(fleetFile(b), '# comment only\n', { mode: 0o600 }) },
  { arm: 'fleet', word: 'no-generation', armedClass: 'WARN', plant: (b) => rmSync(dot(b, NODE_FILES.tokenGeneration)) },
  { arm: 'fleet', word: 'generation-malformed', armedClass: 'WARN', plant: (b) => writeFileSync(dot(b, NODE_FILES.tokenGeneration), 'not-an-id\n') },
  { arm: 'fleet', word: 'never-synced', armedClass: 'WARN', plant: (b) => rmSync(dot(b, 'token-sync.json')) },
  { arm: 'fleet', word: 'sync:claim-refused', armedClass: 'WARN', plant: (b) => plantReport(b, { result: 'claim-refused', generation: null, transport: 'https', proof: null }) },
  { arm: 'fleet', word: 'sync:stale-client', armedClass: 'WARN', plant: (b) => plantReport(b, { result: 'stale-client', generation: null, transport: null, proof: null }) },
  { arm: 'fleet', word: 'proof-unmeasured', armedClass: 'WARN', plant: (b) => plantReport(b, { result: 'proof-unmeasured', proof: 'proof-unmeasured' }) },
  { arm: 'fleet', word: 'sync-unreadable', armedClass: 'WARN', plant: (b) => plantReport(b, '{"v":2}') },
];

describe('doctor box-token: every armed-later state is SKIP with its reason word, never PASS (D-4391)', () => {
  for (const row of ROWS) {
    it(`${row.arm}: ${row.word}`, () => {
      const b = box({ role: row.arm });
      row.plant(b);
      const r = runCheck(b);
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

describe('doctor box-token: the FAIL and WARN arms are compiled in (the constant flipped in a copy)', () => {
  for (const row of ROWS) {
    it(`${row.arm}: ${row.word} -> ${row.armedClass}`, () => {
      const b = box({ role: row.arm });
      row.plant(b);
      const r = runCheck(b, armed());
      const lines = r.stdout.split('\n').filter(Boolean);
      expect(lines, r.stdout).toHaveLength(2);
      expect(lines[0]).toMatch(new RegExp(`^${row.armedClass} box-token: `));
      expect(lines[0]).toContain(`${row.arm}: ${row.word} — `);
      expect(lines[0]).not.toContain(SKIP_TAIL);
      expect(lines[1]).toMatch(/^ {2}remedy: \S/);
      expect(r.code).toBe(row.armedClass === 'FAIL' ? 1 : 2);
    });
  }

  it('the shipped file carries the constant once, off', () => {
    const src = readFileSync(CHECKS_SRC, 'utf8');
    expect(src.match(/^_BT_ARMS_ON=.*$/gm)).toEqual(['_BT_ARMS_ON=0']);
  });
});

// ── arms by role ──────────────────────────────────────────────────────────

describe('doctor box-token: which arm runs', () => {
  it('a CCRC_ROLE=server box runs the server arm: D-3111\'s server-role skip never covers this check', () => {
    const r = runCheck(box({ role: 'server' }));
    expect(r.stdout).toMatch(/^PASS box-token: server: /);
    expect(r.stdout).not.toMatch(/hosts no sessions/);
  });

  it('both arms on one line, the worse verdict wins: a healthy server and a never-synced fleet is SKIP, armed WARN', () => {
    const b = box({ role: 'both', fleet: 'remote', agentEnv: true });
    rmSync(dot(b, 'token-sync.json'));
    const r = runCheck(b);
    expect(r.stdout).toMatch(new RegExp(`^SKIP box-token: ${SERVER_PASS}; fleet: never-synced — .*${SKIP_TAIL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n$`));
    expect(r.code).toBe(3);
    const a = runCheck(b, armed());
    expect(a.stdout).toMatch(/^WARN box-token: server: generation #2.*; fleet: never-synced — /);
    expect(a.code).toBe(2);
  });

  it('no role recorded: the server arm when a server-side file exists, the fleet arm when agent.env does', () => {
    const s = box({ role: null, server: true });
    expect(runCheck(s).stdout).toBe(`PASS box-token: ${SERVER_PASS}\n`);
    const f = box({ role: null, fleetSide: true, agentEnv: true });
    expect(runCheck(f).stdout).toBe(`PASS box-token: ${FLEET_PASS}\n`);
  });

  it('no role recorded and nothing of either side: SKIP no-role, and it stays SKIP when armed', () => {
    for (const checks of [CHECKS_SRC, armed()]) {
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
      s.pending = [1, 2, 3].map((i) => ({ id: `${i}`.repeat(16), seq: 2 + i, stagedAt: t, handedOutAt: t, confirmBy: t + 5 * MIN, write: { dev: 1, ino: 10 + i, writtenAtMs: t } }));
      s.retiring = [{ sha256: 'ab'.repeat(32), at: t }];
    });
    const r = runCheck(b);
    expect(r.stdout).toMatch(/^SKIP box-token: server: pending-overdue — /);
    expect(r.stdout).not.toContain('state-unreadable');
  });

  it('four pending entries are refused as the server refuses them', () => {
    const b = box({ role: 'server' });
    editState(b, (s) => {
      const t = now() - 20 * MIN;
      s.pending = [1, 2, 3, 4].map((i) => ({ id: `${i}`.repeat(16), seq: 2 + i, stagedAt: t, handedOutAt: t, confirmBy: t + 5 * MIN, write: { dev: 1, ino: 10 + i, writtenAtMs: t } }));
    });
    expect(runCheck(b).stdout).toMatch(/^SKIP box-token: server: state-unreadable — /);
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
  it('the failure count that turns failed:* FAIL is the banner threshold', () => {
    expect(arr('_BT_FAIL_AT')).toEqual([String(FAILURES_FOR_BANNER)]);
  });
  it('the generation file and the fleet file are the names the writers use', () => {
    const src = readFileSync(CHECKS_SRC, 'utf8');
    expect(src.includes(`/.ccrc/${NODE_FILES.tokenGeneration}"`), 'the generation file').toBe(true);
    expect(src.includes('/.cc-secrets/ccrc-mail.token"'), 'the fleet token file').toBe(true);
  });
});
