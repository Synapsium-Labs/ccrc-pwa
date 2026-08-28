import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const SWEEP = path.resolve(__dirname, '../../ccd/ccd-graph-sweep');
let home: string;
const j = (...p: string[]) => path.join(home, ...p);

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
           GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
}
function makeRepo(name: string): string {
  const d = j('projects', name);
  fs.mkdirSync(d, { recursive: true });
  execFileSync('git', ['init', '-q', d]);
  fs.writeFileSync(path.join(d, 'a.py'), 'x = 1\n');
  git(d, 'add', '.'); git(d, 'commit', '-qm', 'init');
  // the exclude precondition, as D' leaves it:
  fs.appendFileSync(path.join(d, '.git', 'info', 'exclude'), 'graphify-out/\n.graphifyignore\n');
  return d;
}
function plantEngine(behavior = ''): void {
  const bin = j('.ccrc', 'graphify-venv', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'graphify'), `#!/bin/bash
echo "cwd=$PWD argv=$* NO_BACKUP=\${GRAPHIFY_NO_BACKUP:-} SEED=\${PYTHONHASHSEED:-} WORKERS=\${GRAPHIFY_MAX_WORKERS:-}" >> "$HOME/engine-calls"
${behavior}
mkdir -p graphify-out
printf '{"nodes":[],"links":[],"built_at_commit":"%s"}' "$(git rev-parse HEAD)" > graphify-out/graph.json
exit 0
`, { mode: 0o755 });
  fs.writeFileSync(j('.ccrc', 'graphify.pin'), '0.9.9\n');
}
function runSweep(env: NodeJS.ProcessEnv = {}) {
  return spawnSync('bash', [SWEEP], { encoding: 'utf8',
    env: { ...process.env, HOME: home, CCRC_GRAPH_BUILD_TIMEOUT: '5', ...env } });
}
const census = () => JSON.parse(fs.readFileSync(j('.ccrc', 'graph-sweep.json'), 'utf8'));
const lastPass = () => census().passes.at(-1);
const outcomeOf = (tree: string) =>
  lastPass().trees.find((t: { path: string }) => t.path === tree)?.outcome;

beforeEach(() => { home = mkTmp('ccrc-gfxsweep-'); fs.mkdirSync(j('.ccrc'), { recursive: true }); });
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe('graph-sweep: probe + census (Task 6)', () => {
  it('cold-builds a never-built tree, stamps the engine, and a second pass is fresh', () => {
    const repo = makeRepo('alpha'); plantEngine();
    expect(runSweep().status).toBe(0);
    expect(outcomeOf(repo)).toBe('never-built');
    expect(fs.readFileSync(path.join(repo, 'graphify-out', '.graphify_engine'), 'utf8')).toBe('0.9.9\n');
    expect(runSweep().status).toBe(0);
    expect(outcomeOf(repo)).toBe('fresh');
  });
  it('row 13 — a pin bump alone re-marks a fresh tree stale (engine dimension)', () => {
    const repo = makeRepo('alpha'); plantEngine();
    runSweep(); runSweep();
    expect(outcomeOf(repo)).toBe('fresh');
    fs.writeFileSync(j('.ccrc', 'graphify.pin'), '0.9.50\n');
    runSweep();
    expect(outcomeOf(repo)).toBe('stale-rebuilt');
  });
  it('row 1 — a tree without the exclude line is refused, not built', () => {
    const repo = makeRepo('alpha');
    fs.writeFileSync(path.join(repo, '.git', 'info', 'exclude'), '');   // strip D'
    plantEngine();
    runSweep();
    expect(outcomeOf(repo)).toBe('refused-no-exclude');
    expect(fs.existsSync(path.join(repo, 'graphify-out'))).toBe(false);
  });
  it('row 8 — zero trees probed on a box that HAS tree roots is an error', () => {
    fs.mkdirSync(j('projects'), { recursive: true });   // root exists, no git tree in it
    plantEngine();
    const r = runSweep();
    expect(r.status).not.toBe(0);
    expect(lastPass().status).toBe('probed-zero');
  });
  it('no tree roots at all is a distinct, non-error status', () => {
    plantEngine();
    const r = runSweep();
    expect(r.status).toBe(0);
    expect(lastPass().status).toBe('no-trees-configured');
  });
  it('row 6 — a second entrant exits pass-locked while a pass holds the flock', async () => {
    makeRepo('alpha'); plantEngine();
    const lock = j('.ccrc', 'graph-sweep.lock');
    fs.writeFileSync(lock, '');
    const holder = spawn('flock', [lock, 'sleep', '30']);
    await new Promise((r) => setTimeout(r, 300));          // let flock take it
    try {
      expect(runSweep().status).toBe(0);
      expect(lastPass().status).toBe('pass-locked');
      expect(fs.existsSync(j('engine-calls'))).toBe(false);
    } finally { holder.kill(); }
  });
  it('O4 — the pause file short-circuits the pass', () => {
    makeRepo('alpha'); plantEngine();
    fs.writeFileSync(j('.ccrc', 'graph-sweep-paused'), '');
    expect(runSweep().status).toBe(0);
    expect(lastPass().status).toBe('paused');
    expect(fs.existsSync(j('engine-calls'))).toBe(false);
  });
});
