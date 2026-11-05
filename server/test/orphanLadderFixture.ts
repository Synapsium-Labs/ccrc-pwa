// Delegation broker wave 5 PR4: the orphan ladder's six characterised trees (W5-O0), shared by the characterisation suite
// (`ccd-orphan-ladder-characterise.test.ts`) and the lease rung's inertness rows (`ccd-orphan-lease-rung.test.ts`, W5-O7 and
// the spool-only row). Moved out of the characterisation suite whole, in a commit that changed only that suite's imports.
// Every helper takes the harness: each runs on a FIXTURE HOME (`makeCcdHarness`), never the live `~/.cc-sessions`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CcdHarness } from './ccdWsHelpers.js';

export const LADDER_FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'orphan-ladder', 'characterise.json');

const real = (p: string): string => fs.realpathSync(p);
const hex = (p: string): string => Buffer.from(p).toString('hex');
const NOW = Math.floor(Date.now() / 1000);
export const LADDER_STUBS = '_ws_cwd_users() { return 0; };'
  + ' _ws_path_users_many() { local i; _WS_PATH_USERS_RCS=(); _WS_PATH_USERS_PIDS_OF=(); _WS_PATH_USERS_WHY_OF=();'
  + ' for i in "$@"; do _WS_PATH_USERS_RCS+=(0); _WS_PATH_USERS_PIDS_OF+=(""); _WS_PATH_USERS_WHY_OF+=(""); done; return 0; };'
  + ` _ws_collect_idle() { _WS_IDLE_NEWEST_NS="${NOW - 8 * 86400}000000000"; _WS_IDLE_COUNT=7; _WS_IDLE_WHY=''; _WS_IDLE_DETAIL=''; return 0; };`;
/** The token's encoder, redefined to print the NAME of each input line (the mode's value kept, so the two tokens differ). */
const NAMES = '_ws_reclaim_fingerprint() { local a out=""; for a in "$@"; do case "$a" in mode=*) out+="$a ";; *) out+="${a%%=*} ";; esac; done;'
  + ' printf "%s" "${out% }"; };';

const main = (h: CcdHarness): string => path.join(h.home, 'projects', 'demo');
const tree = (h: CcdHarness, at: string, branch: string): string => {
  fs.mkdirSync(path.dirname(at), { recursive: true });
  h.git(main(h), 'worktree', 'add', '-b', branch, at);
  return real(at);
};
const claudeTree = (h: CcdHarness, name = 'agent-a'): string => tree(h, path.join(main(h), '.claude', 'worktrees', name), `claude/${name}`);
const ccdRoot = (h: CcdHarness, slug = 'still-cove'): string => tree(h, path.join(h.home, 'worktrees', 'demo', slug), `ws/${slug}`);

export interface LadderDoc { verdict: string; refusal: string | null; tokenInputs: string[]; rescueInputs: string[] }
export const characterise = (h: CcdHarness, p: string): LadderDoc => {
  const a = JSON.parse(h.sh(`${LADDER_STUBS} _ws_orphan_audit ${hex(p)} || true`).trim().split('\n').pop()!) as
    { verdict: string; refusal: string | null };
  const out = h.sh(`${LADDER_STUBS} ${NAMES} _ws_orphan_ladder "$(_ws_orphan_unhex ${hex(p)})" >/dev/null 2>&1 || :;`
    + ' printf "T=%s\\nR=%s\\n" "$_WS_ORPHAN_TOKEN" "$_WS_ORPHAN_RESCUE"').trim().split('\n');
  const of = (k: string): string[] => (out.find((l) => l.startsWith(`${k}=`)) ?? `${k}=`).slice(2).split(' ').filter(Boolean);
  return { verdict: a.verdict, refusal: a.refusal, tokenInputs: of('T'), rescueInputs: of('R') };
};

/** The six trees, each built fresh in its own fixture HOME; `record` is the tree's admin record name (for a carrier's mark). */
export const LADDER_CASES: Record<string, { record: string; build: (h: CcdHarness) => string }> = {
  'clean-claude': { record: 'agent-a', build: (h) => claudeTree(h) },
  'clean-ccd-root': { record: 'still-cove', build: (h) => ccdRoot(h) },
  dirty: { record: 'agent-a', build: (h) => { const t = claudeTree(h); fs.writeFileSync(path.join(t, 'notes.md'), 'draft\n'); return t; } },
  locked: { record: 'agent-a', build: (h) => { const t = claudeTree(h); h.git(main(h), 'worktree', 'lock', t); return t; } },
  'registry-row-inside': {
    record: 'agent-a',
    build: (h) => {
      const t = claudeTree(h); const reg = path.join(h.home, '.cc-sessions');
      fs.mkdirSync(path.join(t, 'sub'));
      fs.writeFileSync(path.join(reg, 'plain-a.uuid'), 'u\n');
      fs.writeFileSync(path.join(reg, 'plain-a.workdir'), path.join(t, 'sub'));
      return t;
    },
  },
  'head-on-no-remote': {
    record: 'agent-a',
    build: (h) => {
      const t = claudeTree(h);
      fs.writeFileSync(path.join(t, 'work.txt'), 'w\n'); h.git(t, 'add', 'work.txt'); h.git(t, 'commit', '-m', 'wip');
      return t;
    },
  },
};

/** The committed fixture's six documents. */
export const ladderFixture = (): Record<string, LadderDoc> => JSON.parse(fs.readFileSync(LADDER_FIXTURE, 'utf8')) as Record<string, LadderDoc>;
