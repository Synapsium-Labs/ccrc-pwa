// Delegation broker wave 5 PR4, Task 5.4.1: today's orphan ladder, pinned before the lease rung lands (W5-O0). Six trees, each
// on a FIXTURE HOME with the probe stubs of `ccd-ws-orphan-verb.test.ts`: for each, `_ws_orphan_audit`'s `verdict` and
// `refusal`, and the NAMES of the token's input lines (and of the rescue token's), read by running `_ws_orphan_ladder` with
// `_ws_reclaim_fingerprint` redefined to print its arguments' names. The six documents equal the committed fixture
// `fixtures/orphan-ladder/characterise.json`, written on `main` (CHARACTERISE_WRITE=1 rewrites it; a run never does by default).
// It pins, it does not drive: a change to the ladder's words or inputs reds here, and the lease rung's PR changes the fixture
// for its three new input names only, in a commit of its own.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'orphan-ladder', 'characterise.json');

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-orphan-char-'); h.makeRepo('demo'); });
afterEach(() => { h.cleanup(); });

const real = (p: string): string => fs.realpathSync(p);
const hex = (p: string): string => Buffer.from(p).toString('hex');
const NOW = Math.floor(Date.now() / 1000);
const STUBS = '_ws_cwd_users() { return 0; };'
  + ' _ws_path_users_many() { local i; _WS_PATH_USERS_RCS=(); _WS_PATH_USERS_PIDS_OF=(); _WS_PATH_USERS_WHY_OF=();'
  + ' for i in "$@"; do _WS_PATH_USERS_RCS+=(0); _WS_PATH_USERS_PIDS_OF+=(""); _WS_PATH_USERS_WHY_OF+=(""); done; return 0; };'
  + ` _ws_collect_idle() { _WS_IDLE_NEWEST_NS="${NOW - 8 * 86400}000000000"; _WS_IDLE_COUNT=7; _WS_IDLE_WHY=''; _WS_IDLE_DETAIL=''; return 0; };`;
/** The token's encoder, redefined to print the NAME of each input line (the mode's value kept, so the two tokens differ). */
const NAMES = '_ws_reclaim_fingerprint() { local a out=""; for a in "$@"; do case "$a" in mode=*) out+="$a ";; *) out+="${a%%=*} ";; esac; done;'
  + ' printf "%s" "${out% }"; };';

const main = (): string => path.join(h.home, 'projects', 'demo');
const tree = (at: string, branch: string): string => {
  fs.mkdirSync(path.dirname(at), { recursive: true });
  h.git(main(), 'worktree', 'add', '-b', branch, at);
  return real(at);
};
const claudeTree = (name = 'agent-a'): string => tree(path.join(main(), '.claude', 'worktrees', name), `claude/${name}`);
const ccdRoot = (slug = 'still-cove'): string => tree(path.join(h.home, 'worktrees', 'demo', slug), `ws/${slug}`);

interface Doc { verdict: string; refusal: string | null; tokenInputs: string[]; rescueInputs: string[] }
const characterise = (p: string): Doc => {
  const a = JSON.parse(h.sh(`${STUBS} _ws_orphan_audit ${hex(p)} || true`).trim().split('\n').pop()!) as
    { verdict: string; refusal: string | null };
  const out = h.sh(`${STUBS} ${NAMES} _ws_orphan_ladder "$(_ws_orphan_unhex ${hex(p)})" >/dev/null 2>&1 || :;`
    + ' printf "T=%s\\nR=%s\\n" "$_WS_ORPHAN_TOKEN" "$_WS_ORPHAN_RESCUE"').trim().split('\n');
  const of = (k: string): string[] => (out.find((l) => l.startsWith(`${k}=`)) ?? `${k}=`).slice(2).split(' ').filter(Boolean);
  return { verdict: a.verdict, refusal: a.refusal, tokenInputs: of('T'), rescueInputs: of('R') };
};

/** The six trees, each built fresh in its own fixture HOME. */
const CASES: Record<string, () => string> = {
  'clean-claude': () => claudeTree(),
  'clean-ccd-root': () => ccdRoot(),
  dirty: () => { const t = claudeTree(); fs.writeFileSync(path.join(t, 'notes.md'), 'draft\n'); return t; },
  locked: () => { const t = claudeTree(); h.git(main(), 'worktree', 'lock', t); return t; },
  'registry-row-inside': () => {
    const t = claudeTree(); const reg = path.join(h.home, '.cc-sessions');
    fs.mkdirSync(path.join(t, 'sub'));
    fs.writeFileSync(path.join(reg, 'plain-a.uuid'), 'u\n');
    fs.writeFileSync(path.join(reg, 'plain-a.workdir'), path.join(t, 'sub'));
    return t;
  },
  'head-on-no-remote': () => {
    const t = claudeTree();
    fs.writeFileSync(path.join(t, 'work.txt'), 'w\n'); h.git(t, 'add', 'work.txt'); h.git(t, 'commit', '-m', 'wip');
    return t;
  },
};

const docs: Record<string, Doc> = {};

describe('W5-O0: the orphan ladder before the lease rung', () => {
  for (const [name, build] of Object.entries(CASES)) {
    it(`${name}: verdict, refusal and token input names`, () => {
      docs[name] = characterise(build());
      expect(docs[name]!.verdict).toMatch(/^(token|refused|unmeasured)$/);
    }, 60_000);
  }

  it('the six documents equal the committed fixture', () => {
    expect(Object.keys(docs).sort()).toEqual(Object.keys(CASES).sort());
    const ordered = Object.fromEntries(Object.keys(CASES).map((k) => [k, docs[k]]));
    if (process.env['CHARACTERISE_WRITE'] === '1') {
      fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
      fs.writeFileSync(FIXTURE, `${JSON.stringify(ordered, null, 2)}\n`);
    }
    expect(ordered).toEqual(JSON.parse(fs.readFileSync(FIXTURE, 'utf8')));
  });
});
