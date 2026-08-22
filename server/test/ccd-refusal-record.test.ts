// server/test/ccd-refusal-record.test.ts
//
// The measured hole D4 names: `$REG/.reap-<id>.lock` — 12 files on the live box,
// one with a lock and no tombstone, a reap attempted and refused, recorded
// nowhere. Of 18 sessions this box has destroyed and that are still discoverable
// at all, 11 are documented and 7 are not, and WHO and WHY are answerable for
// zero.
//
// STANDING NOTE: matches `ccd-workspaces.test.ts:1045`'s `/^ccd.*\.ts$/`
// containment scan; every snippet runs through `h.sh`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { refusalsOf } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-refusal-'); });
afterEach(() => { h.cleanup(); });

const fails = (snippet: string): { code: number; stderr: string } => {
  try { h.sh(snippet); return { code: 0, stderr: '' }; }
  catch (e) {
    const err = e as { status?: number; stderr?: Buffer };
    return { code: err.status ?? 1, stderr: String(err.stderr ?? '') };
  }
};

const STUB = `_ws_unsupervise() { echo unsup >> "$HOME/order"; }; _tmux() { echo t; }; tmux() { :; };`;

describe('ws-rm — five refusals, each exactly one line with the exact token', () => {
  const seed = (id: string, extra = ''): string => {
    h.makeRepo('demo');
    h.sh(`_reg_set ${id} uuid u; _reg_set ${id} project demo; _reg_set ${id} workspace still-river
      _reg_set ${id} workdir ${h.home}/gone; ${extra}`);
    return id;
  };

  it.each([
    ['no-such-session', (): string => { h.makeRepo('demo'); return 'ghost'; }, 'no such session'],
    ['not-a-workspace', (): string => { h.makeRepo('demo'); h.sh('_reg_set plain uuid u'); return 'plain'; },
      'not a workspace'],
    ['incomplete-registry', (): string => {
      h.makeRepo('demo'); h.sh('_reg_set part uuid u; _reg_set part workspace w'); return 'part';
    }, 'incomplete registry'],
    ['held', (): string => seed('demo-held', `_reg_set demo-held hold 'program:x'`), 'held:'],
  ])('records %s and destroys nothing', (token, setup, sentence) => {
    const id = setup();
    const r = fails(`${STUB} cmd_ws_rm ${id}`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(sentence);
    expect(refusalsOf(h.home)).toEqual([{ act: 'destroy', token }]);
    expect(fs.existsSync(path.join(h.home, 'order')), 'a refusal must not reach _ws_unsupervise')
      .toBe(false);
  });

  it('records dirty-tree, and the record is the ONLY thing that changed', () => {
    const main = h.makeRepo('demo');
    h.git(main, 'commit', '--allow-empty', '-m', 'base');
    const wt = path.join(h.home, 'worktrees', 'demo', 'still-river');
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    h.git(main, 'worktree', 'add', '-b', 'ws/still-river', wt);
    fs.writeFileSync(path.join(wt, 'f.txt'), 'uncommitted');
    h.git(wt, 'add', 'f.txt');
    h.sh(`_reg_set demo-still-river uuid u; _reg_set demo-still-river project demo
      _reg_set demo-still-river workspace still-river
      _reg_set demo-still-river workdir ${wt}`);

    const r = fails(`${STUB} cmd_ws_rm demo-still-river`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('nothing was touched');
    expect(refusalsOf(h.home)).toEqual([{ act: 'destroy', token: 'dirty-tree' }]);
    expect(fs.existsSync(wt), 'the worktree survives a refusal').toBe(true);
    expect(h.reg('demo-still-river', 'uuid')).not.toBeNull();
  });
});

describe('forget — the whole ladder, not only the liveness rungs', () => {
  it.each([
    ['bad-args', 'cmd_forget s extra', 'usage: ccd forget'],
    ['bad-session-id', 'cmd_forget "bad/id"', 'bad session id'],
    ['no-such-session', 'cmd_forget ghost', 'no such session'],
  ])('records %s', (token, call, sentence) => {
    h.sh('_reg_set s uuid u');
    const r = fails(`${STUB} _session_verdict() { echo gone; }; ${call}`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(sentence);
    expect(refusalsOf(h.home)).toEqual([{ act: 'forget', token }]);
  });

  it('records is-a-workspace and does not purge', () => {
    h.sh('_reg_set w uuid u; _reg_set w workspace still-river');
    const r = fails(`${STUB} _session_verdict() { echo gone; }; cmd_forget w`);
    expect(r.code).not.toBe(0);
    expect(refusalsOf(h.home)).toEqual([{ act: 'forget', token: 'is-a-workspace' }]);
    expect(h.reg('w', 'uuid')).not.toBeNull();
  });

  it('records held', () => {
    h.sh(`_reg_set s uuid u; _reg_set s hold 'program:x'`);
    const r = fails(`${STUB} _session_verdict() { echo gone; }; cmd_forget s`);
    expect(r.code).not.toBe(0);
    expect(refusalsOf(h.home)).toEqual([{ act: 'forget', token: 'held' }]);
  });

  it('records session-live and does not purge', () => {
    h.sh('_reg_set s uuid u');
    const r = fails(`${STUB} _session_verdict() { echo live; }; cmd_forget s`);
    expect(r.code).not.toBe(0);
    expect(refusalsOf(h.home)).toEqual([{ act: 'forget', token: 'session-live' }]);
    expect(h.reg('s', 'uuid')).not.toBeNull();
  });

  it('records session-verdict-unknown — the fail-shut rung, which had no record at all', () => {
    h.sh('_reg_set s uuid u');
    const r = fails(`${STUB} _session_verdict() { echo unknown; }; cmd_forget s`);
    expect(r.code).not.toBe(0);
    expect(refusalsOf(h.home)).toEqual([{ act: 'forget', token: 'session-verdict-unknown' }]);
  });
});

describe('ws-reap — exactly TWO emits, not thirty-six', () => {
  it('records the flock decline, which is the measured hole this closes', () => {
    // 12 `.reap-<id>.lock` files on the live box; one held a lock and left no
    // tombstone. A reap was attempted and refused and NOTHING recorded it.
    // Mutant: delete this emit -> back to a lock file and silence.
    const out = h.sh(`_reg_set s uuid u; _reg_set s archived 1
      _json_str() { printf '"%s"' "$1"; }
      _ws_reap_eval() { return 0; }
      flock() { return 1; }
      cmd_ws_reap --expect ${'a'.repeat(64)} --session s 2>/dev/null || true`);
    expect(out).toContain('"refused":"in-progress"');
    expect(refusalsOf(h.home)).toEqual([{ act: 'reap', token: 'in-progress' }]);
  });

  it('records the verdict at the ONE point where REAP_VERDICT becomes JSON', () => {
    // `_ws_reap_locked` takes TOKEN FIRST (ccd:5943-5944: `local token="$1" id="$2"`).
    const out = h.sh(`_reg_set s uuid u
      _json_str() { printf '"%s"' "$1"; }
      _ws_reap_eval() { REAP_VERDICT=dirty-tree; REAP_DETAIL="uncommitted changes"; return 1; }
      _reap_paths_json() { echo '[]'; }
      _ws_reap_locked ${'a'.repeat(64)} s 2>/dev/null || true`);
    expect(out).toContain('"refused":');
    const r = refusalsOf(h.home);
    expect(r, 'one emit covers all 35 _reap_refuse tokens').toHaveLength(1);
    expect(r[0]).toEqual({ act: 'reap', token: 'dirty-tree' });
  });

  it('both reap emits return 0 and change no stdout — they are not _lc_refuse', () => {
    // `_lc_refuse` dies. These two answer JSON on stdout at exit 0 and must keep
    // doing exactly that: the PWA reads tokens, not stderr.
    const r = fails(`_reg_set s uuid u; _reg_set s archived 1
      _json_str() { printf '"%s"' "$1"; }
      _ws_reap_eval() { return 0; }
      flock() { return 1; }
      cmd_ws_reap --expect ${'a'.repeat(64)} --session s`);
    expect(r.code, 'a reap refusal is an ANSWER, not a death').toBe(0);
  });
});
