// Rung 8's `no-worktree-record` says WHY git has no record (cleanup un-wedge, Task R4; spec §6.2). A standing tree
// git does not record stays TERMINAL: nothing can pin what git cannot read, and the word does not change. What changes
// is the detail, which now carries one read-only sentence from `_ws_reclaim_norecord_why`, naming one of six causes:
//   - the tree has no `.git`;
//   - its `.git` names an admin directory that is absent;
//   - or one that is not among this repository's worktree records;
//   - or one of them that holds no `gitdir`;
//   - or one of them that stands and records another path (a copied or moved tree): check the recorded path first,
//     because if the original still stands there, `git -C <main> worktree repair <tree>`, the OPERATOR's act, moves
//     its record to this copy; after a move it re-links it;
//   - its `.git` (or what it names) could not be read.
// ccd never runs `git worktree repair` itself (spec D13): a git shim on PATH catches any repair, prune or remove.
// FIXTURE HOMEs ONLY: every ccd call runs through the harness, never against $HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CHILD_ID, CHILD_STUBS, evalOf, makeChild, type Child } from './childReclaimFixture.js';
import { eventsOf } from './lifecycleHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';

let h: PrHarness;
let restore: string[] = [];
beforeEach(() => { h = makePrHarness('ccrc-reclaim-norecord-why-'); restore = []; });
afterEach(() => {
  for (const p of restore) { try { fs.chmodSync(p, 0o644); } catch { /* gone */ } }
  h.cleanup();
});

const ROOT = process.getuid?.() === 0;
/** git's admin entry for the child: `<main>/.git/worktrees/<basename of its tree>`. */
const adminOf = (c: Child): string => path.join(c.main, '.git', 'worktrees', 'quiet-basin');

/** Four shapes of a standing tree git keeps no record of, run through the ladder and the audit. Each removes or rewrites what git reads, never the
 *  registry row. */
const SHAPES: { label: string; make: (c: Child) => void; says: (c: Child) => string[] }[] = [
  {
    label: 'a tree with no .git',
    make: (c) => {
      fs.rmSync(adminOf(c), { recursive: true, force: true });
      fs.rmSync(path.join(c.wt, '.git'));
    },
    says: () => ['the tree has no .git'],
  },
  {
    label: 'a .git naming an absent admin directory',
    make: (c) => { fs.rmSync(adminOf(c), { recursive: true, force: true }); },
    says: (c) => [`its .git names the admin directory ${adminOf(c)}`, 'which is absent'],
  },
  {
    label: 'an admin directory that records another path',
    make: (c) => { fs.writeFileSync(path.join(adminOf(c), 'gitdir'), `${path.join(h.home, 'elsewhere', 'quiet-basin')}/.git\n`); },
    says: () => [
      'its admin directory stands but records another path',
      'Check the recorded path first: if the original still stands there',
      'git -C <main> worktree repair <tree> (both named above) moves its record to this copy',
      'after a move it re-links it',
      'operator’s act, never ccd’s'.replace(/’/g, "'"),
    ],
  },
  {
    label: 'an unreadable .git',
    make: (c) => {
      fs.rmSync(adminOf(c), { recursive: true, force: true });
      const g = path.join(c.wt, '.git');
      fs.chmodSync(g, 0o000);
      restore.push(g);
    },
    says: () => ['its .git could not be read'],
  },
];

describe('rung 8 says why git has no record, and the word stays no-worktree-record', () => {
  it('the CONTROL: git records the child, so it is reclaimable and no diagnosis is asked', () => {
    makeChild(h);
    expect(evalOf(h).verdict).toBe('reclaimable');
  }, 60_000);

  it('a tree with no .git says so', () => {
    const c = makeChild(h);
    SHAPES[0]!.make(c);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('no-worktree-record');
    for (const s of SHAPES[0]!.says(c)) expect(r.detail).toContain(s);
  }, 60_000);

  it('a .git naming an absent admin directory says so', () => {
    const c = makeChild(h);
    SHAPES[1]!.make(c);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('no-worktree-record');
    for (const s of SHAPES[1]!.says(c)) expect(r.detail).toContain(s);
  }, 60_000);

  it('an admin directory that records another path names git worktree repair as the operator’s remedy', () => {
    const c = makeChild(h);
    SHAPES[2]!.make(c);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('no-worktree-record');
    for (const s of SHAPES[2]!.says(c)) expect(r.detail).toContain(s);
  }, 60_000);

  it.skipIf(ROOT)('an unreadable .git says it could not be read', () => {
    const c = makeChild(h);
    SHAPES[3]!.make(c);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('no-worktree-record');
    for (const s of SHAPES[3]!.says(c)) expect(r.detail).toContain(s);
  }, 60_000);

  it.each(SHAPES.map((s, i) => [s.label, i] as const))('the refusal word is no-worktree-record: %s, at the ladder and in the audit’s journal', (_label, i) => {
    if (i === 3 && ROOT) return;
    const c = makeChild(h);
    SHAPES[i]!.make(c);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('no-worktree-record');
    expect(r.detail).toContain(`has no worktree record for ${c.wt}`);
    const a = h.run(`${CHILD_STUBS} _session_verdict() { echo gone; }; cmd_ws_audit --session ${CHILD_ID} --reclaim`);
    const doc = JSON.parse(a.stdout) as Record<string, unknown>;
    expect(doc['verdict']).toBe('no-worktree-record');
    expect(String(doc['detail'])).toContain(SHAPES[i]!.says(c)[0]!);
    expect(eventsOf(h.home, 'reclaim').map((e) => e['refusal'])).toContain('no-worktree-record');
  }, 60_000);

  it('the diagnosis is one capped line: an absent admin directory named through a path over 300 bytes holding a newline', () => {
    // The cut is `_ws_leaf_why_line`'s: 300 bytes, then its own "…" (3 bytes), every control byte read as "?". Two
    // components of 200 bytes, so no name passes NAME_MAX (255) and the absence is MEASURED (shape 1), never the
    // ENAMETOOLONG a single 320-byte name reads as "could not be read".
    const c = makeChild(h);
    const common = h.sh(`_ws_common_dir '${c.main}'`);
    const odd = path.join(h.home, 'odd\nname');
    fs.mkdirSync(odd);
    const rel = `${'a'.repeat(200)}/${'b'.repeat(200)}/worktrees/quiet-basin`;
    fs.writeFileSync(path.join(odd, '.git'), `gitdir: ${rel}\n`);
    const out = h.sh(`_ws_reclaim_norecord_why $'${h.home}/odd\\nname' '${common}'; printf '%s' "$_WS_NOREC_DIAG"`);
    expect(out).toContain('its .git names the admin directory');
    expect(out).not.toContain('could not be read');
    // The whole sentence passes the cap, so "which is absent" is asked of the uncut text: the long path cut short
    // still names the admin directory, and the cap cut it before its verdict.
    const whole = h.sh(`_ws_leaf_why_line() { printf '%s' "$1"; }; _ws_reclaim_norecord_why $'${h.home}/odd\\nname' '${common}'; printf '%s' "$_WS_NOREC_DIAG"`);
    expect(whole).toContain('which is absent: git keeps no record of the tree');
    expect(out).not.toContain('\n');
    expect(out).toContain('odd?name');
    expect(out.endsWith('…')).toBe(true);
    expect(Buffer.byteLength(out.slice(0, -1))).toBeLessThanOrEqual(300);
  }, 60_000);

  it('an admin directory with no gitdir says it holds none, never that it records another path', () => {
    const c = makeChild(h);
    const common = h.sh(`_ws_common_dir '${c.main}'`);
    fs.rmSync(path.join(adminOf(c), 'gitdir'));
    const out = h.sh(`_ws_reclaim_norecord_why '${c.wt}' '${common}'; printf '%s' "$_WS_NOREC_DIAG"`);
    expect(out).toContain(`its .git names the admin directory ${adminOf(c)}, which holds no gitdir`);
    expect(out).not.toContain('records another path');
    expect(out).not.toContain('worktree repair');
    // And at rung 8 itself, the word unchanged.
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('no-worktree-record');
    expect(r.detail).toContain('which holds no gitdir');
  }, 60_000);

  it('an admin directory outside this repository’s worktree records is named so, never the repair', () => {
    const c = makeChild(h);
    const common = h.sh(`_ws_common_dir '${c.main}'`);
    const stray = path.join(h.home, 'stray-admin');
    fs.mkdirSync(stray);
    fs.writeFileSync(path.join(stray, 'gitdir'), `${path.join(h.home, 'elsewhere')}/.git\n`);
    fs.writeFileSync(path.join(c.wt, '.git'), `gitdir: ${stray}\n`);
    const out = h.sh(`_ws_reclaim_norecord_why '${c.wt}' '${common}'; printf '%s' "$_WS_NOREC_DIAG"`);
    expect(out).toContain('which is not one of this repository');
    expect(out).not.toContain('worktree repair');
  }, 60_000);
});

describe('the diagnosis never runs git worktree repair, prune or remove (spec D13)', () => {
  it.each(SHAPES.map((s, i) => [s.label, i] as const))('a git shim that fails and logs on repair, prune and remove sees no call: %s', (_label, i) => {
    if (i === 3 && ROOT) return;
    const shimDir = path.join(h.home, 'repair-shim');
    fs.mkdirSync(shimDir);
    const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8', env: inheritedEnv() }).trim();
    fs.writeFileSync(path.join(shimDir, 'git'), [
      '#!/bin/sh',
      'prev=',
      'for a in "$@"; do',
      '  if [ "$prev" = worktree ]; then case "$a" in repair|prune|remove) printf \'%s\\n\' "$*" >> "$HOME/repair-calls"; exit 97 ;; esac; fi',
      '  prev=$a',
      'done',
      `exec '${realGit}' "$@"`,
      '',
    ].join('\n'), { mode: 0o755 });
    const SHIM = `PATH="${shimDir}:$PATH";`;
    const calls = path.join(h.home, 'repair-calls');
    // The CONTROL: the shim is the git ccd finds, and it catches what it claims to, running nothing.
    expect(h.sh(`${SHIM} command -v git`)).toBe(path.join(shimDir, 'git'));
    expect(h.run(`${SHIM} git -C "${h.home}" worktree repair x`).code).toBe(97);
    expect(fs.readFileSync(calls, 'utf8')).toContain('worktree repair');
    fs.rmSync(calls);
    const c = makeChild(h);
    SHAPES[i]!.make(c);
    const r = evalOf(h, { pre: SHIM });
    expect(r.verdict, r.detail).toBe('no-worktree-record');
    expect(r.detail).toContain(SHAPES[i]!.says(c)[0]!);
    expect(fs.existsSync(calls), fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '').toBe(false);
  }, 60_000);
});
