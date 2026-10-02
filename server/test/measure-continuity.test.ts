/**
 * `deploy/measure-continuity.py` — the session-continuity programme's
 * read-only instrument (spec §9), stage 1's two sections: the carry counter
 * over `swap.log` and the journal-missing resume refusals in the transcripts.
 *
 * The carry section is pinned against what ccd ACTUALLY writes: the first case
 * runs the real `_swap_carry_sidecars` in a fixture HOME (`makeCcdHarness`)
 * and then the instrument over that same HOME, so a change to either side of
 * the `(merged +N ~R !D)` line format reds here rather than in a report a
 * week after rollout. Fixture HOMEs only: `--home` points the instrument at
 * one; nothing here reads the live `$HOME`. Every window in this file is
 * written in the same zone the instrument reads it in (local), so the cases
 * hold under any TZ.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-measure-continuity-'); });
afterEach(() => { h.cleanup(); });

const REPO = path.resolve(import.meta.dirname, '..', '..');
const TOOL = path.join(REPO, 'deploy', 'measure-continuity.py');
const UUID = 'b7001948-4444-4bcc-b60b-0cfc0dc3d199';
const PDIR = '-w-quiet-mesa';
const T0 = 1_780_000_000;

/** Stage 1's sections, from the instrument pointed at the fixture HOME. */
const measure = (...args: string[]): Record<string, any> =>
  JSON.parse(execFileSync('python3', [TOOL, '--stage', '1', '--home', h.home, '--json', ...args],
    { encoding: 'utf8' })).stage1;

const put = (cfg: string, rel: string, body: string, mtime = T0): string => {
  const p = path.join(h.home, cfg, 'projects', PDIR, UUID, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  fs.utimesSync(p, mtime, mtime);
  return p;
};
const writeLog = (rows: string[]): void => {
  fs.writeFileSync(path.join(h.home, '.cc-sessions', 'swap.log'), rows.join('\n') + '\n');
};

describe('the carry section', () => {
  it('counts what the real carry writes: a merge the budget cut short, a whole merge, their diverged rows, and a (kept: busy)', () => {
    // The diverged log is compared first (8 bytes) and fits a 10-byte budget;
    // the new tool result (4 more) does not: `(merged +0 ~0 !1, deferred 1)`.
    // The next carry, at the default budget, places it: `(merged +1 ~0 !1)`.
    put('.claude', 'subagents/agent-a1.jsonl', 'A\nB\n', T0 + 60);
    put('.claude-d', 'subagents/agent-a1.jsonl', 'A\nX\nY\n');
    put('.claude', 'tool-results/new.txt', 'NEW\n');
    const CARRY = `_swap_carry_sidecars "$HOME/.claude" "$HOME/.claude-d" ${UUID} 2>/dev/null`;
    h.sh(`CARRY_MERGE_BUDGET=10; ${CARRY}`);
    h.sh(CARRY);
    h.sh(`exec 7>>"$REG/.carry.lock"; flock -n 7; ${CARRY}`);
    const c = measure().carry;
    expect(c.carries).toBe(3);
    expect(c.by_mode.merged).toBe(2);
    expect(c.by_mode['kept: busy']).toBe(1);
    expect([c.merged_added, c.merged_replaced, c.merged_diverged]).toEqual([1, 0, 2]);
    expect(c.diverged_rows).toBe(2);
    expect([c.deferred_carries, c.deferred_actions]).toEqual([1, 1]);
    expect(c.kept_other_than_busy_budget).toBe(0);
  });

  it('keeps the legacy `(kept)` apart from the three new reasons, and honours the window', () => {
    // Rows in the exact shapes ccd has written: the pre-merge rule's bare
    // `(kept)`, a first carry's `(link)`/`(copy)`, and the merge's fallbacks.
    writeLog([
      `2026-09-10 10:00:00 sidecar ${UUID} -> /d/1 (kept)`,
      `2026-09-10 10:00:01 sidecar ${UUID} -> /d/2 (copy)`,
      `2026-09-24 10:00:00 sidecar ${UUID} -> /d/3 (kept: budget)`,
      `2026-09-24 10:00:01 sidecar ${UUID} -> /d/4 (kept: error)`,
      `2026-09-24 10:00:02 sidecar ${UUID} -> /d/5 (link)`,
      `2026-09-24 10:00:03 swap demo-x: a -> b (uuid ${UUID})`,
    ]);
    const all = measure().carry;
    expect(all.carries).toBe(5);
    expect(all.by_mode.kept).toBe(1);
    expect(all.kept_total).toBe(3);
    expect(all.kept_other_than_busy_budget, 'legacy kept + error, never budget').toBe(2);
    const late = measure('--since', '2026-09-24').carry;
    expect(late.carries).toBe(3);
    expect(late.by_mode.kept).toBe(0);
    const early = measure('--until', '2026-09-24 10:00:01').carry;
    expect(early.carries, '--until is exclusive, to the second').toBe(3);
  });

  it('reports every carry and, with --deployed, the carries whose pair was not stranded before the deploy', () => {
    const A = '/h/.claude', D = '/h/.claude-d', E = '/h/.claude-e';
    const U = UUID, W = 'c0ffee00-5555-4bcc-b60b-0cfc0dc3d199';
    const sc = (ts: string, u: string, root: string, mode: string): string =>
      `${ts} sidecar ${u} -> ${root}/projects/${PDIR}/${u} (${mode})`;
    const sw = (ts: string, u: string, from: string, to: string): string =>
      `${ts} swap demo-${u.slice(0, 4)}: ${from} -> ${to} (uuid ${u})`;
    writeLog([
      // Before the deploy: U, BORN on claude, is carried to claude-d.
      sc('2026-09-10 10:00:00', U, D, 'copy'), sw('2026-09-10 10:00:01', U, 'claude', 'claude-d'),
      // After: U goes home to the root it was born on — stranded, though no
      // sidecar line before the deploy names it (only the swap's `from` does) —
      // and its backlog drains in part: 40 actions deferred to the next visit.
      sc('2026-09-24 10:00:00', U, A, 'merged +3 ~1 !0, deferred 40'), sw('2026-09-24 10:00:01', U, 'claude-d', 'claude'),
      // And back to claude-d, which a sidecar line before the deploy names;
      // its first action alone is over budget.
      sc('2026-09-24 11:00:00', U, D, 'kept: budget'), sw('2026-09-24 11:00:01', U, 'claude', 'claude-d'),
      // W starts after the deploy: out to claude-e and home again — nothing stranded.
      sc('2026-09-24 12:00:00', W, E, 'copy'), sw('2026-09-24 12:00:01', W, 'claude', 'claude-e'),
      sc('2026-09-24 13:00:00', W, A, 'merged +2 ~0 !0, deferred 5'), sw('2026-09-24 13:00:01', W, 'claude-e', 'claude'),
    ]);
    const c = measure('--since', '2026-09-20', '--deployed', '2026-09-20').carry;
    expect(c.carries).toBe(4);
    expect(c.kept_share).toBe(0.25);
    expect(c.by_mode['kept: budget'], 'kept: budget is its own count').toBe(1);
    expect([c.deferred_carries, c.deferred_actions]).toEqual([2, 45]);
    expect(c.excluding_stranded.carries, 'U\'s two return visits are the stranded backlog').toBe(2);
    expect(c.excluding_stranded.kept_share).toBe(0);
    expect(c.excluding_stranded.by_mode['kept: budget']).toBe(0);
    expect([c.excluding_stranded.deferred_carries, c.excluding_stranded.deferred_actions]).toEqual([1, 5]);
    const plain = measure('--since', '2026-09-20').carry;
    expect(plain.excluding_stranded, 'no --deployed, no split').toBeNull();
    expect(plain.carries).toBe(4);
  });
});

describe('the resume section', () => {
  it('counts resume refusals by tool-use id, once across the account-root copies a swap leaves', () => {
    // Claude Code's own refusal text, as a session transcript records it: a
    // Workflow tool_use carrying resumeFromRunId, then its tool_result.
    const use = (id: string, run: string): string => JSON.stringify({ type: 'assistant', timestamp: '2026-09-20T10:00:00.000Z',
      message: { content: [{ type: 'tool_use', id, name: 'Workflow', input: { scriptPath: '/x/s.js', resumeFromRunId: run } }] } });
    const res = (id: string, text: string, isError: boolean): string => JSON.stringify({ type: 'user', timestamp: '2026-09-20T10:00:01.000Z',
      message: { content: [{ type: 'tool_result', tool_use_id: id, content: text, ...(isError ? { is_error: true } : {}) }] } });
    const body = [
      use('toolu_A', 'wf_aaaaaaaa-111'),
      res('toolu_A', '<tool_use_error>The journal for workflow run wf_aaaaaaaa-111 is not on disk, and this session cannot fetch a remote copy, so there is nothing to resume.</tool_use_error>', true),
      use('toolu_B', 'wf_bbbbbbbb-222'),
      res('toolu_B', 'Workflow resumed', false),
    ].join('\n') + '\n';
    // The same session on two roots: the one it left holds a PREFIX copy.
    const t1 = path.join(h.home, '.claude', 'projects', PDIR, `${UUID}.jsonl`);
    const t2 = path.join(h.home, '.claude-d', 'projects', PDIR, `${UUID}.jsonl`);
    fs.mkdirSync(path.dirname(t1), { recursive: true });
    fs.mkdirSync(path.dirname(t2), { recursive: true });
    fs.writeFileSync(t1, body.split('\n').slice(0, 2).join('\n') + '\n');
    fs.writeFileSync(t2, body);
    for (const flags of [[], ['--all-copies']]) {
      const r = measure(...flags).resume;
      expect(r.resume_calls, flags.join(' ') || 'largest copy').toBe(2);
      expect(r.by_outcome).toEqual({ ok: 1, 'journal-missing': 1, 'script-path': 0, 'other-error': 0, 'no-result': 0 });
    }
  });
});
