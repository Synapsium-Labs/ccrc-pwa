// The claimant's mailed rule commands run as written, and the reason the coordinator types into them is DATA, never
// shell (coordinator-first routing plan Task 16, spec §6.1 and §6.7, D-5489). The coordinator is a top-level session
// outside the children's PreToolUse deny, and a reason naturally restates the child's untrusted command
// ("denied: `rm -rf build` is outside the worktree"), so a backtick or `$(…)` in it must not run in the coordinator's
// shell, and a double quote must not break the JSON. Each case runs the brief's own block, the placeholder filled in,
// under every POSIX shell this box has, against a stub client that records what it was given.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { renderApprovalBrief } from '../src/coord/approvalbrief.js';
import { mkTmp } from './tmpHelpers.js';

const PLACEHOLDER = '<one line, in plain words>';
const HOSTILE = 'denied: `touch pwned-tick` and $(touch pwned-dollar) say "no" — it\'s a \\ path; ${HOME}';

const brief = (cls: 'ordinary' | 'escalate'): string => renderApprovalBrief({
  id: 7, childId: 'project-a-quiet-basin', tool: 'Bash', agentId: '', inputRedacted: 'rm -rf build',
  class: cls, digest: 'a'.repeat(64), notifyAt: Date.UTC(2026, 9, 18, 12, 0, 0),
});

/** The text between two of the brief's fixed headings: the command block, whatever its form. */
function section(body: string, from: string, to: string): string {
  const a = body.indexOf(from);
  const b = body.indexOf(to, a + from.length);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  return body.slice(a + from.length, b);
}

const SHELLS = ['sh', 'bash', 'zsh'].filter((s) => spawnSync('sh', ['-c', `command -v ${s}`]).status === 0);

function runBlock(shell: string, block: string): { dir: string; argv: string; stdin: string } {
  const dir = mkTmp('ccrc-apr-brief-');
  writeFileSync(path.join(dir, 'api'), '#!/bin/sh\nprintf \'%s\\n\' "$*" > "$OUT/argv"\ncat > "$OUT/stdin"\n', { mode: 0o755 });
  const script = `cd '${dir}' || exit 9\nid=project-a-wide-meadow\nuuid=00000000-0000-4000-8000-000000000001\nAPI=./api\n${block}`;
  const r = spawnSync(shell, ['-c', script], { encoding: 'utf8', env: { ...process.env, OUT: dir } });
  expect(r.status, `${shell}: ${r.stderr}`).toBe(0);
  return { dir, argv: readFileSync(path.join(dir, 'argv'), 'utf8'), stdin: readFileSync(path.join(dir, 'stdin'), 'utf8') };
}

describe('the claimant\'s rule commands keep the reason out of the shell (D-5489)', () => {
  it('has at least sh to run under', () => { expect(SHELLS).toContain('sh'); });

  for (const shell of SHELLS) {
    for (const verdict of ['allow', 'deny'] as const) {
      it(`${shell}: a reason holding backticks, $(…), a double quote and a backslash runs nothing and arrives verbatim (${verdict})`, () => {
        const body = brief('ordinary');
        const block = verdict === 'allow'
          ? section(body, 'Allow it once:\n', 'Deny it, with the reason')
          : section(body, 'Deny it, with the reason the child will read:\n', 'Hand it over');
        expect(block).toContain(PLACEHOLDER);
        const { dir, argv, stdin } = runBlock(shell, block.replace(PLACEHOLDER, HOSTILE));
        expect(existsSync(path.join(dir, 'pwned-tick'))).toBe(false);
        expect(existsSync(path.join(dir, 'pwned-dollar'))).toBe(false);
        expect(argv.trim()).toBe('approvals rule 7 --json -');
        expect(JSON.parse(stdin)).toEqual({
          fromId: 'project-a-wide-meadow', fromUuid: '00000000-0000-4000-8000-000000000001', verdict, reason: HOSTILE,
        });
      });
    }
  }

  it('the hand-over block carries the attribution pair and nothing the coordinator types', () => {
    const block = section(brief('escalate'), 'Hand it over (not yours to rule: the operator is notified at once, and it is final):\n', 'Run the ccrc-coordinator skill.');
    const { argv, stdin } = runBlock('sh', block);
    expect(argv.trim()).toBe('approvals release 7 --json -');
    expect(JSON.parse(stdin)).toEqual({ fromId: 'project-a-wide-meadow', fromUuid: '00000000-0000-4000-8000-000000000001' });
  });

  it('an escalate row offers no allow command', () => {
    const body = brief('escalate');
    expect(body).not.toContain('Allow it once');
    expect(body).not.toContain('verdict:"allow"');
    expect(body).toContain('verdict:"deny"');
  });
});
