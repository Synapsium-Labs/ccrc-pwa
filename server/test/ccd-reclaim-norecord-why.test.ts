// Rung 8's `no-worktree-record` says WHY git has no record (cleanup un-wedge, Task R4; spec §6.2). A standing tree
// git does not record stays TERMINAL: nothing can pin what git cannot read, and the word does not change. What changes
// is the detail, which now carries one read-only sentence from `_ws_reclaim_norecord_why`:
//   - the tree has no `.git`;
//   - its `.git` names an admin directory that is absent;
//   - that admin directory stands and records another path (a copied or moved tree), and
//     `git -C <main> worktree repair <tree>`, the OPERATOR's act, re-links it;
//   - its `.git` could not be read.
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

/** The four shapes of a standing tree git keeps no record of. Each removes or rewrites what git reads, never the
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
      'git -C <main> worktree repair <tree>',
      'the operator’s act, never ccd’s'.replace(/’/g, "'"),
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

  it('the diagnosis is one capped line: a tree path holding a newline reaches the detail as one line', () => {
    const c = makeChild(h);
    SHAPES[1]!.make(c);
    const out = h.sh(`_ws_reclaim_norecord_why '${c.wt}'; printf '%s' "$_WS_NOREC_DIAG"`);
    expect(out).toContain('which is absent');
    const odd = h.sh(`_ws_reclaim_norecord_why $'${h.home}/no\\nsuch'; printf '%s' "$_WS_NOREC_DIAG"`);
    expect(odd).not.toContain('\n');
    expect(odd).toContain('the tree has no .git');
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
