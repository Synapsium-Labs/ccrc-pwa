// Remove, v2 (accounts plan Task A16; spec §11; N3 = D-7733, D-7735): the pre-check (`--dry-run`), Discard, the
// sleeping-session rule, `auth-in-progress`, the UI path's deletes and sign-out, the `auth-scratch` sweep and the
// `atProvider` ledger. The fixture is `laneStateFixture.ts`: HOME is a throwaway directory, tmux and every launcher
// are stubs, and nothing reaches a real session, tmux server or `claude`.
import { describe, it, expect, beforeEach } from 'vitest';
import { spawn } from 'node:child_process';
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  HAVE_FLOCK, NODE_ID, addLane, answer, ccrcRun, exited, laneBox, laneState, markReady, waitFor,
} from './laneStateFixture.js';
import { buildAccountArgv } from '../../shared/account-argv.js';

beforeEach((ctx) => { if (!HAVE_FLOCK) ctx.skip(); });

const REG = (home: string): string => join(home, '.cc-sessions');

/** tmux, answering `list-sessions` with the panes the case says are live. */
function plantTmux(home: string, live: string[]): void {
  writeFileSync(join(home, '.local', 'bin', 'tmux'),
    `#!/bin/sh\n[ "$1" = list-sessions ] || exit 90\nprintf '%s\\n' ${live.map((s) => `'cc-${s}'`).join(' ')}\nexit 0\n`,
    { mode: 0o755 });
}

/** One registry row on `lane`: `.uuid` and `.wrapper`, and the file that makes it asleep or archived. */
function plantRow(home: string, sid: string, lane: string, kind: 'live' | 'sleeping' | 'archived' | 'stopped'): void {
  writeFileSync(join(REG(home), `${sid}.uuid`), '00000000-0000-4000-8000-000000000001');
  writeFileSync(join(REG(home), `${sid}.wrapper`), lane);
  if (kind === 'sleeping') writeFileSync(join(REG(home), `${sid}.hibernated`), '1767225600 24');
  if (kind === 'archived') writeFileSync(join(REG(home), `${sid}.archived`), 'by the operator');
}

/** `ccd-account-auth`'s status file, in a state and at a time. */
function plantAttempt(home: string, id: string, state: string, ageMs = 0): void {
  mkdirSync(join(REG(home), '.auth'), { recursive: true, mode: 0o700 });
  const updatedAt = new Date(Date.now() - ageMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
  writeFileSync(join(REG(home), '.auth', `${id}.json`), JSON.stringify({ state, updatedAt }));
}

/** Every path under `home` (links not followed) with its bytes, its link target or `dir`, for a byte-identical
 *  before and after. */
function snapshot(dir: string, out: Record<string, string> = {}): Record<string, string> {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) out[p] = `-> ${readlinkSync(p)}`;
    else if (st.isDirectory()) { out[p] = 'dir'; snapshot(p, out); } else out[p] = readFileSync(p, 'latin1');
  }
  return out;
}

const roster = (home: string): { id: string }[] =>
  (JSON.parse(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')) as { accounts: { id: string }[] }).accounts;

/** The argv the UI's Remove sends: the agent's builder, which has no field that keeps a credential. */
const uiRemove = (id: string): string[] => {
  const b = buildAccountArgv('remove', id, { mode: 'remove' }, false);
  if (!b.ok) throw new Error('the builder refused the UI remove');
  return [...b.argv];
};

describe('Remove\'s pre-check, measured on the box (spec §11.1)', () => {
  it('`--dry-run` answers live, sleeping, archived, upstream, the other home-able lanes and an attempt in progress, and leaves the roster, the lane state and every file byte-identical', async () => {
    const home = laneBox('ccrc-remove-dry-');
    expect(addLane(home, 'lane-c').code).toBe(0);
    plantRow(home, 'lane-c-p1', 'lane-c', 'live');
    plantRow(home, 'lane-c-p2', 'lane-c', 'sleeping');
    plantRow(home, 'lane-c-p3', 'lane-c', 'archived');
    plantRow(home, 'other-p4', 'claude', 'live');
    plantTmux(home, ['lane-c-p1', 'other-p4']);
    plantAttempt(home, 'lane-c', 'waiting-code');
    // The lane's lock is held the whole time: the pre-check takes none, so it answers anyway.
    const lock = join(home, '.ccrc', 'locks', 'lane-c.lock');
    const holder = spawn('flock', [lock, 'sh', '-c', 'touch "$0"; sleep 30', join(home, 'held')], { stdio: 'ignore' });
    try {
      await waitFor(join(home, 'held'));
      const before = snapshot(home);
      const r = ccrcRun(home, ['account', 'remove', '--id', 'lane-c', '--dry-run']);
      expect(r.code, r.stderr).toBe(0);
      const a = answer(r);
      expect(a).toEqual({
        ok: true, id: 'lane-c', dryRun: true, live: 1, sleeping: ['lane-c-p2'], archived: 1, upstream: false,
        // The upstream lane, and lane-b, whose wrapper the add's converge wrote and which no marker holds off.
        otherHomeAble: 2, authInProgress: true, discardable: false, at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
        fleetIdentity: NODE_ID,
      });
      expect(snapshot(home)).toEqual(before);
    } finally {
      holder.kill('SIGKILL');
      await exited(holder);
    }
    expect(roster(home).map((x) => x.id)).toContain('lane-c');
  });

  it('a fresh lane with nothing on it reads discardable, and the upstream lane reads upstream', () => {
    const home = laneBox('ccrc-remove-dry-fresh-');
    expect(addLane(home, 'lane-c').code).toBe(0);
    const a = answer(ccrcRun(home, ['account', 'remove', '--id', 'lane-c', '--dry-run']));
    expect(a).toMatchObject({ live: 0, sleeping: [], archived: 0, upstream: false, authInProgress: false, discardable: true });
    const up = answer(ccrcRun(home, ['account', 'remove', '--id', 'claude', '--dry-run']));
    expect(up).toMatchObject({ upstream: true, discardable: false });
  });

  it('the agent\'s `mode: check` is the pre-check', () => {
    const home = laneBox('ccrc-remove-dry-ui-');
    expect(addLane(home, 'lane-c').code).toBe(0);
    const b = buildAccountArgv('remove', 'lane-c', { mode: 'check' }, false);
    expect(b.ok).toBe(true);
    const r = ccrcRun(home, [...(b as { argv: readonly string[] }).argv]);
    expect(r.code, r.stderr).toBe(0);
    expect(answer(r)['dryRun']).toBe(true);
    expect(roster(home).map((x) => x.id)).toContain('lane-c');
  });
});

describe('Discard (spec §11.5)', () => {
  it('discards a never-enabled lane with no session', () => {
    const home = laneBox('ccrc-discard-ok-');
    expect(addLane(home, 'lane-c').code).toBe(0);
    const r = ccrcRun(home, ['account', 'remove', '--id', 'lane-c', '--mode', 'discard']);
    expect(r.code, r.stderr).toBe(0);
    expect(roster(home).map((x) => x.id)).not.toContain('lane-c');
  });

  it('discard refuses a lane that was ever enabled, or that has a live, sleeping or archived session', () => {
    const enabled = laneBox('ccrc-discard-enabled-');
    expect(addLane(enabled, 'lane-c').code).toBe(0);
    markReady(enabled, 'lane-c');
    expect(ccrcRun(enabled, ['account', 'enable', '--id', 'lane-c']).code).toBe(0);
    expect(ccrcRun(enabled, ['account', 'disable', '--id', 'lane-c']).code).toBe(0);
    const e = ccrcRun(enabled, ['account', 'remove', '--id', 'lane-c', '--mode=discard']);
    expect(e.code, e.stderr).toBe(1);
    expect(answer(e)['error']).toBe('not-discardable');
    expect(roster(enabled).map((x) => x.id)).toContain('lane-c');

    for (const [kind, error] of [['live', 'live-sessions'], ['sleeping', 'sleeping-sessions'], ['archived', 'not-discardable']] as const) {
      const home = laneBox(`ccrc-discard-${kind}-`);
      expect(addLane(home, 'lane-c').code).toBe(0);
      plantRow(home, 'lane-c-p1', 'lane-c', kind);
      plantTmux(home, kind === 'live' ? ['lane-c-p1'] : []);
      const r = ccrcRun(home, ['account', 'remove', '--id', 'lane-c', '--mode', 'discard']);
      expect(r.code, `${kind}: ${r.stderr}`).toBe(1);
      expect(answer(r)['error'], kind).toBe(error);
      expect(roster(home).map((x) => x.id), kind).toContain('lane-c');
      expect(readFileSync(join(REG(home), 'lane-c-p1.wrapper'), 'utf8'), kind).toBe('lane-c');
    }
  });
});

describe('sleeping sessions (N3)', () => {
  it('a hibernated row on the lane refuses `sleeping-sessions` with its id, and nothing is rehomed', () => {
    const home = laneBox('ccrc-remove-sleeping-');
    expect(addLane(home, 'lane-c').code).toBe(0);
    plantRow(home, 'lane-c-p2', 'lane-c', 'sleeping');
    plantTmux(home, []);
    const r = ccrcRun(home, ['account', 'remove', '--id', 'lane-c']);
    expect(r.code, r.stderr).toBe(1);
    const a = answer(r);
    expect(a['error']).toBe('sleeping-sessions');
    expect(a['sleeping']).toEqual(['lane-c-p2']);
    expect(readFileSync(join(REG(home), 'lane-c-p2.wrapper'), 'utf8')).toBe('lane-c');
    expect(roster(home).map((x) => x.id)).toContain('lane-c');
  });

  it('`--rehome-sleeping` rehomes it as today', () => {
    const home = laneBox('ccrc-remove-rehome-sleeping-');
    expect(addLane(home, 'lane-c').code).toBe(0);
    plantRow(home, 'lane-c-p2', 'lane-c', 'sleeping');
    plantTmux(home, []);
    const r = ccrcRun(home, ['account', 'remove', '--id', 'lane-c', '--rehome-sleeping']);
    expect(r.code, r.stderr).toBe(0);
    expect(answer(r)['rehomed']).toEqual(['lane-c-p2']);
    expect(readFileSync(join(REG(home), 'lane-c-p2.wrapper'), 'utf8')).toBe('claude');
  });

  it('an archived row is rehomed onto upstream by a removal, as before', () => {
    const home = laneBox('ccrc-remove-archived-');
    expect(addLane(home, 'lane-c').code).toBe(0);
    plantRow(home, 'lane-c-p3', 'lane-c', 'archived');
    plantTmux(home, []);
    const r = ccrcRun(home, ['account', 'remove', '--id', 'lane-c']);
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(join(REG(home), 'lane-c-p3.wrapper'), 'utf8')).toBe('claude');
  });
});

describe('a removal and a sign-in never overlap (spec §3.9)', () => {
  it('remove during an attempt refuses `auth-in-progress`', () => {
    const home = laneBox('ccrc-remove-auth-');
    expect(addLane(home, 'lane-c').code).toBe(0);
    for (const state of ['starting', 'url', 'waiting-code', 'exchanging']) {
      plantAttempt(home, 'lane-c', state);
      const r = ccrcRun(home, ['account', 'remove', '--id', 'lane-c']);
      expect(r.code, `${state}: ${r.stderr}`).toBe(1);
      expect(answer(r)['error'], state).toBe('auth-in-progress');
      expect(roster(home).map((x) => x.id), state).toContain('lane-c');
    }
  });

  it('a finished attempt, or one a killed helper left standing past its bound, does not refuse', () => {
    for (const [state, age] of [['done', 0], ['cancelled', 0], ['waiting-code', 2 * 60 * 60 * 1000]] as const) {
      const home = laneBox('ccrc-remove-auth-over-');
      expect(addLane(home, 'lane-c').code).toBe(0);
      plantAttempt(home, 'lane-c', state, age);
      const r = ccrcRun(home, ['account', 'remove', '--id', 'lane-c']);
      expect(r.code, `${state}: ${r.stderr}`).toBe(0);
    }
  });
});

describe('the UI\'s removal (spec §11.3, §11.4)', () => {
  it('the UI path deletes the key file and signs a sign-in lane out', () => {
    const home = laneBox('ccrc-remove-ui-');
    expect(addLane(home, 'lane-c').code).toBe(0);
    const key = join(home, '.cc-secrets', 'lane-c-compatible.env');
    expect(existsSync(key)).toBe(true);
    const r = ccrcRun(home, uiRemove('lane-c'));
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(key)).toBe(false);
    expect(answer(r)['removed']).toContain(key);
    expect(answer(r)['atProvider']).toEqual([{ kind: 'api-key', state: 'still-valid', revokeAt: null }]);

    // A sign-in lane: `claude auth logout` in its config dir, and its `.credentials.json` gone.
    const add = ccrcRun(home, ['account', 'add', '--id', 'lane-s', '--provider', 'anthropic', '--method', 'login',
      '--label', 'lane·s', '--hue', 'green']);
    expect(add.code, add.stderr).toBe(0);
    const cfg = join(home, '.claude-lane-s');
    writeFileSync(join(cfg, '.credentials.json'), '{"fixture":"not a credential"}', { mode: 0o600 });
    writeFileSync(join(home, '.local', 'bin', 'claude'),
      '#!/bin/sh\nprintf \'%s %s\\n\' "$CLAUDE_CONFIG_DIR" "$*" >> "$HOME/upstream-calls"\nexit 0\n', { mode: 0o755 });
    const s = ccrcRun(home, uiRemove('lane-s'));
    expect(s.code, s.stderr).toBe(0);
    expect(readFileSync(join(home, 'upstream-calls'), 'utf8')).toBe(`${cfg} auth logout\n`);
    expect(existsSync(join(cfg, '.credentials.json'))).toBe(false);
    expect(existsSync(cfg), 'the config dir is kept for its transcripts').toBe(true);
    // G23 was not measured (OA1, 2026-11-01): the sign-in's row says so, and says neither "ended" nor "still valid".
    expect(answer(s)['atProvider']).toEqual([{ kind: 'anthropic-sign-in', state: 'unmeasured', revokeAt: 'claude-account-settings' }]);
  });

  it('`atProvider` names the token as still valid with its revoke link kind', () => {
    const home = laneBox('ccrc-remove-token-');
    mkdirSync(join(home, '.cc-secrets'), { recursive: true, mode: 0o700 });
    writeFileSync(join(home, '.cc-secrets', 'lane-b-oauth.env'), 'export CLAUDE_CODE_OAUTH_TOKEN=fixture-not-a-token-a16\n',
      { mode: 0o600 });
    plantTmux(home, []);
    const r = ccrcRun(home, uiRemove('lane-b'));
    expect(r.code, r.stderr).toBe(0);
    expect(answer(r)['atProvider']).toEqual([{ kind: 'anthropic-token', state: 'still-valid', revokeAt: 'claude-code-settings' }]);
    expect(existsSync(join(home, '.cc-secrets', 'lane-b-oauth.env'))).toBe(false);
    expect(answer(r)['fleetIdentity']).toBe(NODE_ID);
  });

  it('every removal deletes `auth-scratch/<id>` and reports it', () => {
    const home = laneBox('ccrc-remove-scratch-');
    expect(addLane(home, 'lane-c').code).toBe(0);
    const scratch = join(home, '.ccrc', 'auth-scratch', 'lane-c');
    mkdirSync(join(scratch, 'config'), { recursive: true, mode: 0o700 });
    writeFileSync(join(scratch, 'config', '.credentials.json'), '{}', { mode: 0o600 });
    const other = join(home, '.ccrc', 'auth-scratch', 'lane-cx');
    mkdirSync(other, { recursive: true, mode: 0o700 });
    const r = ccrcRun(home, ['account', 'remove', '--id', 'lane-c']);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(scratch)).toBe(false);
    expect(answer(r)['removed']).toContain(scratch);
    expect(existsSync(other), 'another lane\'s scratch stands').toBe(true);
    expect(laneState(home, 'lane-c')).toBeNull();
  });
});
