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
 * one; nothing here reads the live `$HOME`. The instrument runs under a
 * fixed non-UTC zone (`TZ`, below), because both clocks it reads are
 * zone-sensitive and the suite and the fleet box run in UTC, where a swapped
 * conversion changes nothing: swap.log stamps and the --since/--until/
 * --deployed flags are LOCAL time, a session transcript's stamps are UTC, and a
 * case under UTC cannot tell either from the other.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { bindFixture, plantFakeKernel } from './fixtures/fakeMountKernel.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-measure-continuity-'); });
afterEach(() => { h.cleanup(); });

const REPO = path.resolve(import.meta.dirname, '..', '..');
const TOOL = path.join(REPO, 'deploy', 'measure-continuity.py');
const UUID = 'b7001948-4444-4bcc-b60b-0cfc0dc3d199';
const PDIR = '-w-quiet-mesa';
const T0 = 1_780_000_000;

/** A zone eight hours behind UTC with no daylight saving: the same offset on every
 *  date, and a POSIX spelling, so it needs no zoneinfo database on the box. */
const TZ = 'PST8';

/** Stage 1's sections, from the instrument pointed at the fixture HOME. */
const measure = (...args: string[]): Record<string, any> =>
  JSON.parse(execFileSync('python3', [TOOL, '--stage', '1', '--home', h.home, '--json', ...args],
    { encoding: 'utf8', env: { ...process.env, TZ } })).stage1;

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

describe('the carry section reads why a carry copied, and how much (D-4500, D-4501)', () => {
  it('counts what the real carry writes through the route: a link via the mount, a copy by cause, and a merge\'s copy', () => {
    // The fleet's geometry, faked (`fixtures/fakeMountKernel.ts`): the first
    // uuid's first carry links through the whole mount; then, under a table
    // with no second mount, its return visit copies one new file and a second
    // uuid's first carry copies its tree — both `exdev-no-root`.
    const W = 'c0ffee00-6666-4bcc-b60b-0cfc0dc3d199';
    put('.claude', 'tool-results/r.json', 'RESULT\n');
    const k = plantFakeKernel(h.home);
    const env = { ...bindFixture(h.home), ...k.env };
    const bare = path.join(h.home, 'no-common-mountinfo');
    fs.writeFileSync(bare, fs.readFileSync(env.CCD_MOUNTINFO!, 'utf8').split('\n')
      .filter((l) => !l.includes(' 0:99 / ')).join('\n'));
    const carry = (u: string, e: Record<string, string>): void => {
      h.sh(`${k.cpStub} _swap_carry_sidecars "$HOME/.claude" "$HOME/.claude-d" ${u} 2>/dev/null`, e);
    };
    carry(UUID, env);
    put('.claude', 'tool-results/new.txt', 'NEW\n');
    const p = path.join(h.home, '.claude', 'projects', PDIR, W, 'tool-results', 'w.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'W-RESULT\n');
    carry(UUID, { ...env, CCD_MOUNTINFO: bare });
    carry(W, { ...env, CCD_MOUNTINFO: bare });
    const c = measure().carry;
    expect(c.carries).toBe(3);
    expect(c.by_mode.other, 'every new form is read').toBe(0);
    expect([c.by_mode.link, c.by_mode.copy, c.by_mode.merged]).toEqual([1, 1, 1]);
    expect(c.link_via_mount).toBe(1);
    expect(c.merged_via_mount).toBe(0);
    const cause = c.copy_by_cause['exdev-no-root'];
    expect([cause.first_carries, cause.merged_files]).toEqual([1, 1]);
    expect(c.copied_bytes.merge).toBe(4);
    expect(c.copied_bytes.first_carry).toBeGreaterThanOrEqual('W-RESULT\n'.length);
    expect(cause.bytes).toBe(c.copied_bytes.first_carry + c.copied_bytes.merge);
    expect([c.copy_legacy, c.copy_unsized]).toEqual([0, 0]);
  });

  it('reads every form ccd has written: the legacy bare (copy), a copy it could not size, and a merge with links and two causes', () => {
    const row = (n: number, mode: string): string => `2026-10-08 10:00:0${n} sidecar ${UUID} -> /d/${n} (${mode})`;
    writeLog([
      row(0, 'link'),
      row(1, 'link: via-mount'),
      row(2, 'copy'),
      row(3, 'copy: exdev-no-root 100 bytes'),
      row(4, 'copy: root-mismatch ? bytes'),
      row(5, 'merged +3 ~1 !0, via-mount 2'),
      row(6, 'merged +2 ~0 !1, deferred 4, via-mount 1, copy: exdev-no-root 1 files 50 bytes, copy: link-failed 1 files 7 bytes'),
      row(7, 'kept: busy'),
    ]);
    const c = measure().carry;
    expect(c.carries).toBe(8);
    expect(c.by_mode).toMatchObject({ link: 2, copy: 3, merged: 2, 'kept: busy': 1, other: 0 });
    expect([c.link_via_mount, c.merged_via_mount]).toEqual([1, 3]);
    expect([c.copy_legacy, c.copy_unsized]).toEqual([1, 1]);
    expect(c.copy_by_cause).toEqual({
      'exdev-no-root': { first_carries: 1, merged_files: 1, bytes: 150 },
      'root-mismatch': { first_carries: 1, merged_files: 0, bytes: 0 },
      'link-failed': { first_carries: 0, merged_files: 1, bytes: 7 },
    });
    expect(c.copied_bytes).toEqual({ first_carry: 100, merge: 57 });
    expect([c.merged_added, c.merged_replaced, c.merged_diverged]).toEqual([5, 1, 1]);
    expect([c.deferred_carries, c.deferred_actions]).toEqual([1, 4]);
  });
});

describe('the resume section', () => {
  // Claude Code's own refusal text, as a session transcript records it: a
  // Workflow tool_use carrying resumeFromRunId, then its tool_result. Both
  // stamps are UTC ('Z'), as a transcript writes them.
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
  const plant = (cfg: string, text: string): void => {
    const p = path.join(h.home, cfg, 'projects', PDIR, `${UUID}.jsonl`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  };

  it('counts resume refusals by tool-use id, once across the account-root copies a swap leaves', () => {
    // The same session on two roots: the one it left holds a PREFIX copy.
    plant('.claude', body.split('\n').slice(0, 2).join('\n') + '\n');
    plant('.claude-d', body);
    for (const flags of [[], ['--all-copies']]) {
      const r = measure(...flags).resume;
      expect(r.resume_calls, flags.join(' ') || 'largest copy').toBe(2);
      expect(r.by_outcome).toEqual({ ok: 1, 'journal-missing': 1, 'script-path': 0, 'other-error': 0, 'no-result': 0 });
    }
  });

  it('reads a transcript\'s stamps as UTC, and the window flags as local time', () => {
    // Both calls are stamped 2026-09-20T10:00:00Z, which is 02:00:00 on a clock
    // eight hours behind UTC. A window written in that local time around them
    // holds both; read as local, the stamp would be 10:00 and sit outside it.
    plant('.claude-d', body);
    const inWin = measure('--since', '2026-09-20 02:00:00', '--until', '2026-09-20 02:00:01').resume;
    expect(inWin.resume_calls, 'the window around the UTC stamp').toBe(2);
    const early = measure('--until', '2026-09-20 02:00:00').resume;
    expect(early.resume_calls, '--until is exclusive').toBe(0);
    const late = measure('--since', '2026-09-20 02:00:01').resume;
    expect(late.resume_calls, 'a window after the stamp').toBe(0);
  });
});
