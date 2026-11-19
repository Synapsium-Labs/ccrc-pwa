// server/test/ccd-door-spawn.test.ts
//
// Overlord W1 door process A2, Task 4 (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-door-process.md`; spec §3.6 H1
// "The door process (H9)"): `_door_spawn`, ccd/lib/door.sh's second region, called by the surface branch of
// `_profile_spawn_compose`. A surfaced spawn writes `$REG/.door/<id>/mcp.json` (0600, its directories 0700) with a fresh launch
// nonce in the door server's environment, and the pane's command names only that file and the nonce's sha256. Any failure
// refuses the spawn: no pane, one journal line naming its fixed phrase, no `mcp.json`.
//
// FIXTURE HOMEs ONLY (`makeCcdHarness`): tmux is a recording stub, so no pane starts. The failure cases run a COPY of the ccd
// tree in the fixture HOME, so the door program beside it can be removed, linked or changed without touching the repository.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { makeCcdHarness, ghContainedEnv, CCD, type CcdHarness } from './ccdWsHelpers.js';
import { committedDigest } from './sim/launchProfileSets.js';
import { genExpectOf, type MintInput } from '../src/continuity/continuityStore.js';
import type { CoordStore } from '../src/coord/store.js';
import { FAKE_T0 } from './fakeTime.js';
import { ID_GATE_TOKEN, appFor, recorder, seedRow } from './idGateFixture.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const ID = 'lane-a-project-a';
const UUID = 'deadbeef-0000-4000-8000-000000000000';
const DIGEST = committedDigest('overlord');
const sha = (t: string | Buffer): string => createHash('sha256').update(t).digest('hex');
const RESUME_DIES = `sleep() { :; };
    tmux() {
      echo "tmux $*" >> "$HOME/ccd-calls"
      case "$1" in
        new-session)  case "$*" in *--session-id*) : > "$HOME/pane-up" ;; esac ;;
        has-session)  [[ -e "$HOME/pane-up" ]] ;;
        list-sessions) return 0 ;;
      esac
    };`;

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-door-spawn-'); });
afterEach(() => { h.cleanup(); removeTmpFixtures(); });

const REG = (): string => path.join(h.home, '.cc-sessions');
const doorDir = (): string => path.join(REG(), '.door', ID);
const mcp = (): string => path.join(doorDir(), 'mcp.json');
const wsDir = (): string => path.join(h.home, 'projects', 'overlord');
const client = (): string => path.join(h.home, '.local', 'bin', 'ccrc-api');
const seed = (surfaced = true): void => {
  fs.mkdirSync(wsDir(), { recursive: true });
  // The client the door process runs: a stub, since the spawn refuses without one (review 2735, departure 3).
  fs.mkdirSync(path.dirname(client()), { recursive: true });
  fs.writeFileSync(client(), '#!/bin/sh\nexit 3\n', { mode: 0o755 });
  execFileSync('git', ['-C', wsDir(), 'init', '-q']);
  h.sh(`_reg_set ${ID} wrapper claude
        _reg_set ${ID} workdir '${wsDir()}'
        _reg_set ${ID} uuid ${UUID}
        ${surfaced ? `_reg_set ${ID} profile overlord; _reg_set ${ID} profiledigest '${DIGEST}'` : ''}`);
};

/** A copy of the ccd tree (ccd/ccd, its libraries and the door program) in the fixture HOME, for the cases that change the
 *  program beside the body. */
const copyTree = (): string => {
  const dst = path.join(h.home, 'tree', 'ccd');
  fs.cpSync(path.dirname(CCD), dst, { recursive: true });
  return path.join(dst, 'ccd');
};

/** A recording jq first on PATH: it logs its own argv, then runs the real one. */
const jqRecorder = (): { dir: string; log: string } => {
  const dir = path.join(h.home, 'jqwrap');
  const log = path.join(h.home, 'jq-argv.log');
  fs.mkdirSync(dir, { recursive: true });
  // The real jq, found by walking PATH here (no shell spawned outside the contained environment).
  const real = (process.env.PATH ?? '').split(':').map((d) => path.join(d, 'jq')).find((f) => { try { fs.accessSync(f, fs.constants.X_OK); return true; } catch { return false; } }) ?? 'jq';
  fs.writeFileSync(path.join(dir, 'jq'), `#!/bin/bash\nprintf '%s\\n' "$*" >> '${log}'\nexec '${real}' "$@"\n`, { mode: 0o755 });
  return { dir, log };
};

/** `_spawn_start <id> new` through `ccd` at `src` (the repository's by default), with `pre` run first. */
const spawnOnce = (pre = '', src = CCD, pathPrefix = ''): { lines: string[]; status: number | null; err: string; journal: string[] } => {
  h.sh(`rm -f "$HOME/ccd-calls" "$HOME/pane-up" "$HOME/.cc-sessions/swap.log"`);
  const base = h.env();
  const env = ghContainedEnv(h.home, { ...base, A_SRC: src, A_SNIP: `${RESUME_DIES} ${pre} _spawn_start ${ID} new` }, { systemd: true, tmux: true, net: true });
  if (pathPrefix !== '') env.PATH = `${pathPrefix}:${env.PATH ?? ''}`;
  const r = spawnSync('bash', ['-c', 'a_src=$A_SRC a_snip=$A_SNIP; unset A_SRC A_SNIP; source "$a_src"; eval "$a_snip"'], { env, cwd: h.home, encoding: 'utf8' });
  const log = path.join(REG(), 'swap.log');
  const journal = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter((l) => l.includes('launch-profile-refused')) : [];
  return { lines: h.calls().filter((c) => c.startsWith('tmux new-session')), status: r.status, err: r.stderr, journal };
};
const configOf = (): { nonce: string; server: { type: string; command: string; args: string[]; env: Record<string, string> } } => {
  const j = JSON.parse(fs.readFileSync(mcp(), 'utf8')) as { mcpServers: { door: { type: string; command: string; args: string[]; env: Record<string, string> } } };
  return { nonce: j.mcpServers.door.env.CCRC_DOOR_NONCE!, server: j.mcpServers.door };
};
const hashOn = (line: string): string => /(?:^| )CCRC_DOOR_NONCE_SHA256=([0-9a-f]{64})(?: |$)/.exec(line)?.[1] ?? '';
const mode = (p: string): number => fs.statSync(p).mode & 0o777;

describe('a surfaced spawn writes the tool-server config and puts only its path and the nonce\'s hash on the pane', () => {
  it('mcp.json is 0600 in a 0700 directory, its nonce 64 hex, hashing (as hex text, no newline) to the pane\'s CCRC_DOOR_NONCE_SHA256', () => {
    seed();
    const { lines, status, err } = spawnOnce();
    expect(status, err).toBe(0);
    expect(lines).toHaveLength(1);
    expect(mode(mcp())).toBe(0o600);
    expect(mode(doorDir())).toBe(0o700);
    expect(mode(path.dirname(doorDir()))).toBe(0o700);
    const { nonce, server } = configOf();
    expect(nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOn(lines[0]!)).toBe(createHash('sha256').update(nonce, 'utf8').digest('hex'));
    expect(lines[0]).toContain(` --mcp-config '${mcp()}' `);
    expect(server.type).toBe('stdio');
    expect(path.isAbsolute(server.command)).toBe(true);
    expect(server.args).toEqual([path.join(path.dirname(CCD), 'door-process.mjs')]);
    expect(server.env).toEqual({ CCRC_DOOR_NONCE: nonce, CCRC_SESSION_ID: ID, CCRC_DOOR_DIR: doorDir(), CCRC_API: path.join(h.home, '.local', 'bin', 'ccrc-api') });
  });

  it('the pane\'s command never holds the nonce, and no jq argv does', () => {
    seed();
    const jq = jqRecorder();
    const { lines, status, err } = spawnOnce('', CCD, jq.dir);
    expect(status, err).toBe(0);
    const { nonce } = configOf();
    expect(h.calls().join('\n')).not.toContain(nonce);
    expect(lines[0]).not.toContain(nonce);
    expect(fs.readFileSync(jq.log, 'utf8')).toContain('mcpServers');   // the recorder did see the config's jq
    expect(fs.readFileSync(jq.log, 'utf8')).not.toContain(nonce);
    const log = path.join(REG(), 'swap.log');
    expect(fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '').not.toContain(nonce);
  });

  it('two spawns write two different nonces, each hashed on its own pane line', () => {
    seed();
    const a = spawnOnce();
    const n1 = configOf().nonce;
    const b = spawnOnce();
    const n2 = configOf().nonce;
    expect(n1).not.toBe(n2);
    expect(hashOn(a.lines[0]!)).toBe(sha(n1));
    expect(hashOn(b.lines[0]!)).toBe(sha(n2));
  });

  it('a spawn removes the last process\'s delta and its temp, so a respawn\'s first prompt never reads the old lease (review 2735 F2)', () => {
    seed();
    fs.mkdirSync(doorDir(), { recursive: true, mode: 0o700 });
    for (const n of ['delta', 'delta.tmp']) fs.writeFileSync(path.join(doorDir(), n), 'v=1 at=1 until=99999999999999\nold\n', { mode: 0o600 });
    const r = spawnOnce();
    expect(r.status, r.err).toBe(0);
    expect(fs.readdirSync(doorDir()).sort()).toEqual(['mcp.json']);
  });

  it('under an inherited xtrace the nonce reaches no stderr (review 2735 F7)', () => {
    seed();
    const r = spawnOnce('set -x;');
    expect(r.status, r.err).toBe(0);
    expect(r.err).toContain('_door_spawn');            // the trace really ran
    expect(r.err).not.toContain(configOf().nonce);
  });

  it('a spawn with no surface writes nothing under $REG/.door/ and puts no door on the pane', () => {
    seed(false);
    const { lines, status, err } = spawnOnce();
    expect(status, err).toBe(0);
    expect(fs.existsSync(path.join(REG(), '.door'))).toBe(false);
    expect(lines[0]).not.toContain('--mcp-config');
    expect(lines[0]).not.toContain('CCRC_DOOR_NONCE_SHA256');
  });
});

describe('each failure refuses the spawn: no pane, its phrase in swap.log, no mcp.json', () => {
  const refused = (r: ReturnType<typeof spawnOnce>, phrase: string): void => {
    expect(r.status).not.toBe(0);
    expect(r.lines).toHaveLength(0);
    expect(r.journal).toHaveLength(1);
    expect(r.journal[0]).toContain(`${ID}: door process: ${phrase} — no pane started`);
    expect(fs.existsSync(mcp())).toBe(false);
  };
  /** The installed layout over the copied tree: the loader's published words and the program's pin. */
  const installedPre = (pin: string): string => `__CCD_LAYOUT=installed; __CCD_HASH_CMD=(sha256sum); __CCD_DOOR_SHA256='${pin}';`;

  it('a changed program (installed layout, its pin no longer the file\'s digest)', () => {
    seed();
    const src = copyTree();
    const prog = path.join(path.dirname(src), 'door-process.mjs');
    const pin = sha(fs.readFileSync(prog));
    expect(spawnOnce(installedPre(pin), src).status, 'the pinned copy spawns').toBe(0);
    fs.rmSync(mcp());
    fs.appendFileSync(prog, '// changed after the pin was taken\n');
    refused(spawnOnce(installedPre(pin), src), 'the door program is missing, linked or not the pinned one');
  });

  it('a missing program', () => {
    seed();
    const src = copyTree();
    fs.rmSync(path.join(path.dirname(src), 'door-process.mjs'));
    refused(spawnOnce('', src), 'the door program is missing, linked or not the pinned one');
  });

  it('a symlinked program, even to the pinned bytes', () => {
    seed();
    const src = copyTree();
    const prog = path.join(path.dirname(src), 'door-process.mjs');
    const real = path.join(h.home, 'real-door-process.mjs');
    fs.renameSync(prog, real);
    fs.symlinkSync(real, prog);
    refused(spawnOnce(installedPre(sha(fs.readFileSync(real))), src), 'the door program is missing, linked or not the pinned one');
  });

  it('a symlinked .door directory, and a symlinked <id> directory', () => {
    seed();
    const elsewhere = path.join(h.home, 'elsewhere');
    fs.mkdirSync(elsewhere, { recursive: true });
    fs.symlinkSync(elsewhere, path.join(REG(), '.door'));
    refused(spawnOnce(), 'the door directory is a link');
    expect(fs.readdirSync(elsewhere)).toEqual([]);
    fs.rmSync(path.join(REG(), '.door'));
    fs.mkdirSync(path.join(REG(), '.door'), { mode: 0o700 });
    fs.symlinkSync(elsewhere, doorDir());
    refused(spawnOnce(), 'the door directory is a link');
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });

  it.each([
    ['missing', (): void => fs.rmSync(client())],
    ['a link, even to an executable', (): void => { const real = path.join(h.home, 'real-client'); fs.renameSync(client(), real); fs.symlinkSync(real, client()); }],
    ['not executable', (): void => fs.chmodSync(client(), 0o644)],
    ['a directory', (): void => { fs.rmSync(client()); fs.mkdirSync(client()); }],
  ])('a client that is %s (review 2735, departure 3)', (_w, make) => {
    seed();
    make();
    refused(spawnOnce(), 'the client is missing, linked or not executable');
  });

  it('a directory at mcp.json: refused, and nothing is written inside it (review 2735 F7)', () => {
    seed();
    fs.mkdirSync(mcp(), { recursive: true });
    const r = spawnOnce();
    expect(r.status).not.toBe(0);
    expect(r.lines).toHaveLength(0);
    expect(r.journal[0]).toContain(`${ID}: door process: the tool-server config could not be written — no pane started`);
    expect(fs.readdirSync(mcp())).toEqual([]);
  });

  it('no node on PATH', () => {
    seed();
    refused(spawnOnce('command() { if [[ "${1-}" == -v && "${2-}" == node ]]; then return 1; fi; builtin command "$@"; };'), 'no node on PATH');
  });

  it('a temp file planted as a link is never written through', () => {
    seed();
    fs.mkdirSync(doorDir(), { recursive: true, mode: 0o700 });
    const target = path.join(h.home, 'planted-target');
    fs.writeFileSync(target, 'untouched\n');
    fs.symlinkSync(target, path.join(doorDir(), 'mcp.json.tmp'));
    const r = spawnOnce();
    expect(r.status, r.err).toBe(0);
    expect(fs.readFileSync(target, 'utf8')).toBe('untouched\n');
    expect(fs.lstatSync(mcp()).isFile()).toBe(true);
  });
});

describe('the spawn\'s hash is the claim door\'s: the nonce it wrote claims a key at A1\'s real route (A1 note F3)', () => {
  let app: FastifyInstance | undefined;
  let coord: CoordStore | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; coord?.db.close(); coord = undefined; });

  it('a start bound to the pane\'s hash, minted, issues the key to the nonce in mcp.json', async () => {
    seed();
    const { lines, status, err } = spawnOnce();
    expect(status, err).toBe(0);
    const paneHash = hashOn(lines[0]!);
    const { nonce } = configOf();

    const home = mkTmp('ccrc-door-spawn-claim-');
    seedRow(home, ID, { uuid: UUID, project: 'project-a' });
    const r = await appFor(home, recorder().run);
    app = r.app; coord = r.coord;
    await app.ready();
    const start = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/start`, headers: { 'x-ccrc-mail-token': ID_GATE_TOKEN },
      payload: { fromId: ID, fromUuid: UUID, reportId: 'r-spawn-abcd', source: 'startup', model: null, rowIncarnation: null, reportedAt: FAKE_T0,
        doorNonceSha256: paneHash } });
    expect(start.statusCode, start.body).toBe(202);
    const startId = (start.json() as { id: number }).id;
    const mintIn: MintInput = { identity: ID, sessionId: ID, role: 'coordinator', term: 1, rowIncarnation: null, startId, startReportedAt: FAKE_T0,
      resumed: false, model: null, lane: 'lane-a', host: null, outcome: 'crashed', mono: 1_000, proc: 'p1', now: FAKE_T0 };
    const live = coord.liveGenerations();
    if (!live.ok) throw new Error(live.detail);
    const old = live.rows.find((g) => g.identity === ID);
    expect(coord.mintGeneration(mintIn, old === undefined ? null : genExpectOf(old), true).ok).toBe(true);
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/act-key`, headers: { 'x-ccrc-mail-token': ID_GATE_TOKEN },
      payload: { fromId: ID, fromUuid: UUID, nonce } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, generation: 1 });
  });
});
