// `ws-audit --reclaim` (spec 2026-09-22 §5.5): the token's source for the
// reclaim ladder — the SAME document the plain audit prints, its verdict taken
// from `_ws_reclaim_eval`, plus `mode` and `childOf` — and the two pieces that
// make the verb reachable at all: `cmd_caps`' `reclaim-v1` and the dispatcher
// arm. The plain `ws-audit --session <id>` is pinned unchanged here too: the
// PWA's reap sheet reads it, and this wave does not touch that ceremony.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { GH_STUB, makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD, ghContainedEnv } from './ccdWsHelpers.js';
import { eventsOf, refusalsOf } from './lifecycleHelpers.js';
import {
  CHILD_ID, CHILD_RUN, CHILD_STUBS, TMUX_FAULTS, childReclaimVerb, evalOf, makeChild, plantTmux, type Child,
} from './childReclaimFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-audit-'); });
afterEach(() => { h.cleanup(); });

const AUDIT_STUBS = `${CHILD_STUBS} _session_verdict() { echo gone; }; ${GH_STUB}`;
const audit = (flags = ''): Record<string, unknown> =>
  JSON.parse(h.sh(`${AUDIT_STUBS} cmd_ws_audit --session ${CHILD_ID} ${flags}`)) as Record<string, unknown>;
/** The dispatcher, not the function: the agent invokes `ccd <verb> …`. */
const runCcd = (...args: string[]): { code: number; stdout: string; stderr: string } => {
  try {
    return { code: 0, stderr: '', stdout: execFileSync('bash', [CCD, ...args], { encoding: 'utf8', cwd: h.home,
      env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }) }).trim() };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? '').trim(), stderr: String(err.stderr ?? '') };
  }
};
const PLAIN_KEYS = ['id', 'branch', 'registryBranch', 'drift', 'base', 'workdir', 'project', 'repo', 'exists',
  'headMatchesRegistry', 'reaping', 'alive', 'started', 'unit', 'dirty', 'ignored', 'ignoredCount', 'ignoredBytes',
  'sensitive', 'sensitiveFiltered', 'clips', 'stashes', 'worktreeBytes', 'commitsAheadOfBase', 'pr', 'merge',
  'transcript', 'children', 'verdict', 'detail'];
const interrupted = (c: Child, phase: string): void => {
  h.sh(`${CHILD_STUBS} _ws_reclaim_eval ${CHILD_ID} 0 ${CHILD_RUN} >/dev/null`
    + ` && _ws_reclaim_pin ${CHILD_ID} "${c.wt}" "${c.main}" "$REAP_BRANCH" ${CHILD_RUN}`
    + ` && _ws_tombstone ${CHILD_ID} '[]' "$(_ws_reclaim_tomb_fields ${CHILD_RUN})" >/dev/null`
    + ` && _reg_set ${CHILD_ID} reaping reclaim:${phase}`);
};

describe('the plain audit is untouched', () => {
  it('prints exactly the keys it always printed — no mode, no childOf — and reap’s verdict', () => {
    makeChild(h);
    const a = audit();
    expect(Object.keys(a)).toEqual(PLAIN_KEYS);
    expect(a['verdict'], 'a child is never archived, so reap refuses it — and says why').toBe('not-archived');
  }, 60_000);
});

describe('ws-audit --reclaim', () => {
  it('prints mode, childOf and the SAME token the ladder mints', () => {
    makeChild(h);
    const a = audit('--reclaim');
    expect(Object.keys(a)).toEqual([...PLAIN_KEYS.slice(0, -2), 'mode', 'childOf', 'verdict', 'detail', 'token']);
    expect(a['mode']).toBe('reclaim');
    expect(a['childOf']).toBe(CHILD_RUN);
    expect(a['verdict']).toBe('reclaimable');
    expect(a['token']).toBe(evalOf(h).token);
  }, 60_000);

  it('a probe that could not RUN EXITS 1 — a reclaim document saying unmeasured, no token, no terminal word, nothing journaled', () => {
    // `_ws_reclaim_unmeasured` (Task 2): the server reads ANY audit exit 1 as
    // `failed` and retries; a terminal word here would never be retried.
    makeChild(h);
    const r = h.run(`${AUDIT_STUBS} _ws_reclaim_stash_shas() { return 1; }; cmd_ws_audit --session ${CHILD_ID} --reclaim`);
    expect(r.code, r.stdout).toBe(1);
    expect(r.stderr).toContain('ws-audit --reclaim measured nothing');
    const a = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(a['mode'], 'still the RECLAIM document').toBe('reclaim');
    expect(a['token'], 'no token for a ladder that did not finish').toBeUndefined();
    expect(a['verdict']).toBe('unmeasured');
    expect(eventsOf(h.home, 'reclaim'), 'an unmeasured answer is journaled nowhere').toEqual([]);
  }, 60_000);

  it.each(Object.entries(TMUX_FAULTS))('rung 5: tmux answering %s EXITS 1 unmeasured — never "no session", never a token', (_what, fault) => {
    // Rung 5 reads presence through `_session_probe`; only `can't find session`
    // is gone. The server reads this exit 1 as `failed`, not resumable.
    const c = makeChild(h);
    plantTmux(h, { fault });
    const r = h.run(`${AUDIT_STUBS} cmd_ws_audit --session ${CHILD_ID} --reclaim`);
    expect(fs.existsSync(c.wt), 'the audit touched nothing').toBe(true);
    expect(r.code, r.stdout).toBe(1);
    const a = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(a['mode']).toBe('reclaim');
    expect(a['verdict']).toBe('unmeasured');
    expect(a['token']).toBeUndefined();
    expect(String(a['detail'])).toContain(fault);
  }, 60_000);

  it('a breadcrumb that STANDS but cannot be read is unmeasured too — never a fresh ladder over a half-torn-down child', () => {
    // Forward from Task 4: `_ws_reclaim_locked` guards this rung first — a
    // directory, a link, or a mode-000 file at `$REG/<id>.reaping` answers
    // `_reg_get` empty, exactly as an ABSENT breadcrumb does. The audit must
    // not read that emptiness as "no breadcrumb, run the fresh ladder": the
    // audit never pins — its own hazard is rung 8's permission pass (owner
    // bits added to the tree and the clips directory) running over a child
    // another verb already started tearing down, and a token minted for an
    // arm the verb, re-measuring the same breadcrumb, will not take.
    makeChild(h);
    fs.mkdirSync(path.join(h.home, '.cc-sessions', `${CHILD_ID}.reaping`));
    const r = h.run(`${AUDIT_STUBS} cmd_ws_audit --session ${CHILD_ID} --reclaim`);
    expect(r.code, r.stdout).toBe(1);
    const a = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(a['mode']).toBe('reclaim');
    expect(a['verdict']).toBe('unmeasured');
    expect(a['token']).toBeUndefined();
    expect(eventsOf(h.home, 'reclaim'), 'unmeasured is journaled nowhere').toEqual([]);
  }, 60_000);

  it('a child whose worktree has VANISHED is reclaimable — exists:false, and the token the verb spends (spec §5.5)', () => {
    const c = makeChild(h);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const a = audit('--reclaim');
    expect(a['verdict'], String(a['detail'])).toBe('reclaimable');
    expect(a['exists']).toBe(false);
    expect(a['token']).toBe(evalOf(h).token);
    expect(JSON.parse(childReclaimVerb(h, String(a['token'])).stdout).reclaimed).toBe(CHILD_ID);
  }, 90_000);

  it('journals no-worktree-record — the terminal answer for a directory git does not record', () => {
    const c = makeChild(h);
    fs.rmSync(path.join(c.main, '.git', 'worktrees', 'quiet-basin'), { recursive: true, force: true });
    expect(audit('--reclaim')['verdict']).toBe('no-worktree-record');
    expect(refusalsOf(h.home)).toContainEqual({ act: 'reclaim', token: 'no-worktree-record' });
    expect(fs.existsSync(c.wt), 'the audit deleted nothing').toBe(true);
  }, 60_000);

  it('--defer-expired mints the deferred token, and only the deferred verb accepts it', () => {
    const c = makeChild(h);
    const d = audit('--reclaim --defer-expired');
    expect(d['token']).toBe(evalOf(h, { defer: 1 }).token);
    expect(d['token']).not.toBe(audit('--reclaim')['token']);
    expect(JSON.parse(childReclaimVerb(h, String(d['token'])).stdout).refused).toBe('state-changed');
    expect(JSON.parse(childReclaimVerb(h, String(d['token']), { extra: '--defer-expired' }).stdout).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt)).toBe(false);
  }, 90_000);

  it('carries NO token on a refusal, and childOf is null when there is no marker to read', () => {
    makeChild(h);
    fs.writeFileSync(path.join(h.home, '.cc-sessions', `${CHILD_ID}.hold`), 'program:x wave:2/3');
    const held = audit('--reclaim');
    expect(held['verdict']).toBe('held');
    expect(held['token']).toBeUndefined();
    expect(held['childOf']).toBe(CHILD_RUN);
    fs.rmSync(path.join(h.home, '.cc-sessions', `${CHILD_ID}.hold`));
    fs.rmSync(path.join(h.home, '.cc-sessions', `${CHILD_ID}.child`));
    const orphan = audit('--reclaim');
    expect(orphan['verdict']).toBe('not-a-child');
    expect(orphan['childOf']).toBeNull();
    expect(orphan['token']).toBeUndefined();
  }, 60_000);

  it('answers the RESUME token on a reclaim breadcrumb, and names the phase — the verb accepts it', () => {
    const c = makeChild(h);
    interrupted(c, 'worktree');
    const a = audit('--reclaim');
    expect(a['resume']).toBe('worktree');
    expect(a['verdict']).toBe('reclaimable');
    expect(a['token']).toBe(h.sh(`_ws_reclaim_resume_eval ${CHILD_ID} 0 '' worktree >/dev/null; printf '%s' "$REAP_TOKEN"`));
    expect(JSON.parse(childReclaimVerb(h, String(a['token'])).stdout).reclaimed).toBe(CHILD_ID);
  }, 90_000);

  it('journals a TERMINAL audit refusal — the mirror sees it — and a retryable one or the plain audit not at all', () => {
    makeChild(h);
    fs.writeFileSync(path.join(h.home, '.cc-sessions', `${CHILD_ID}.hold`), 'program:x wave:2/3');
    expect(audit('--reclaim')['verdict']).toBe('held');
    expect(audit()['verdict'], 'the plain audit').toBeTypeOf('string');
    expect(eventsOf(h.home, 'reclaim'), 'a retryable verdict and the plain audit write NOTHING').toEqual([]);
    fs.rmSync(path.join(h.home, '.cc-sessions', `${CHILD_ID}.hold`));
    // The child's own workdir is a worktree of ANOTHER repository: rung 9's
    // question asked of the child itself — terminal, and found at audit time.
    const other = h.makeRepo('other');
    const alien = path.join(h.home, 'alien');
    h.git(other, 'worktree', 'add', '-b', 'ws/alien', alien);
    fs.writeFileSync(path.join(h.home, '.cc-sessions', `${CHILD_ID}.workdir`), alien);
    expect(audit('--reclaim')['verdict']).toBe('containment-unproven');
    expect(refusalsOf(h.home)).toContainEqual({ act: 'reclaim', token: 'containment-unproven' });
    const line = eventsOf(h.home, 'reclaim').find((e) => e['outcome'] === 'refused')!;
    expect(line['verb'], 'the audit, not the verb, found it').toBe('ws-audit');
    expect(line['id']).toBe(CHILD_ID);
  }, 60_000);

  it('answers reap-in-progress, and no token, on a ws-reap breadcrumb', () => {
    makeChild(h);
    h.sh(`_reg_set ${CHILD_ID} reaping branch`);
    const a = audit('--reclaim');
    expect(a['verdict']).toBe('reap-in-progress');
    expect(a['token']).toBeUndefined();
  }, 60_000);

  it('the audit’s token IS the verb’s consent — end to end', () => {
    const c = makeChild(h);
    const r = childReclaimVerb(h, String(audit('--reclaim')['token']));
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt)).toBe(false);
  }, 90_000);

  it('asserts its argv: --reclaim only third, --defer-expired only after it', () => {
    for (const argv of [['--defer-expired'], ['--reclaim', 'extra'], ['--reclaim', '--defer-expired', 'extra'],
      ['--defer-expired', '--reclaim']]) {
      const r = runCcd('ws-audit', '--session', CHILD_ID, ...argv);
      expect(r.code, argv.join(' ')).toBe(1);
      expect(r.stderr, argv.join(' ')).toContain('usage: ccd ws-audit --session <id> [--reclaim [--defer-expired]]');
    }
  });
});

describe('reachable: the capability token and the dispatcher arm', () => {
  it('ccd caps advertises the verb AND its capability token', () => {
    const advertised = h.sh('cmd_caps').split('\n');
    expect(advertised).toContain('ws-reclaim');
    expect(advertised).toContain('reclaim-v1');
  });

  it('the dispatcher routes ws-reclaim (its own usage, not the unknown-verb line) and the usage line names it', () => {
    const r = runCcd('ws-reclaim');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('usage: ccd ws-reclaim');
    expect(r.stderr).not.toContain('usage: ccd {start|');
    expect(runCcd('no-such-verb').stderr).toContain('|ws-reclaim|');
  });
});
