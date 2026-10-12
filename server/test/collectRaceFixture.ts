// The collector's race and crash suites — their shared fixture (child-workspace reclamation wave 7, spec 2026-09-22
// §5.10). `ws-collect` takes an ORPHANED temp root — a leaf `_child_tmpdir` handed to a child that is gone, still named
// by its witness — by moving it into a quarantine slot under the reap lock, re-proving that nothing has handed the slug
// out again, and only then removing the slot's leaf. These suites force every interleaving the design argues about, at
// the exact step boundary, and assert what stands on disk afterwards — never the verb's word alone.
//
// THE INTERLEAVING IS FORCED, NOT HOPED FOR. `_ws_collect_gap <point> <id>` is the seam the verb calls at each step
// boundary, a no-op on the box (`_ws_expire_return_gap`'s precedent, `ccd-ws-expire-return-race.test.ts`). A case
// redefines it to run a recycled spawn, a straggler, a swap or a SIGKILL at one named point.
//
// FIXTURE HOME ONLY. Every leaf, slot, record, witness and registry row lives under the harness's HOME
// (`makePrHarness`), and every path a shim or a gap matches is anchored THERE: a worker's own TMPDIR may itself lie
// under some `.cc-tmp`, so no pattern here may match `*/.cc-tmp/*` loosely.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect } from 'vitest';
import type { PrHarness } from './ccdPrHelpers.js';

export const LINUX = process.platform === 'linux';
/** Spec §5.10: the collector runs only where `mv` has `--no-copy`; anywhere else every collection answers unmeasured,
 *  so a race case there would measure nothing. Measured, never assumed. */
export const NO_COPY: boolean = (() => {
  try { return execFileSync('mv', ['--help'], { encoding: 'utf8' }).includes('--no-copy'); } catch { return false; }
})();
export const ROOT_USER = process.getuid?.() === 0;

export const COL_ID = 'demo-calm-mesa';
export const DEAD_RUN = '7';
export const G2_RUN = '9';
export const G2_UUID = '9e2e2e2e-0000-4000-8000-000000000009';
export const TOKEN = /^[0-9a-f]{64}$/;

/** The verb's step boundaries, in the order a fresh collection passes them (spec §5.10's quarantine order), spelled as
 *  Task 6 calls `_ws_collect_gap`: `locked` lock held, before the evaluation · `consented` the token matched ·
 *  `recorded` the record written · `slotted` the slot made, before the move · `moved` the move PROVEN ·
 *  `proven` step 5's re-proofs passed · `removed` the slot's leaf proven absent · `emptied` the slot rmdir'd ·
 *  `witnessed` the witness compared-and-dropped · `dropped` the record dropped, before the verb answers. Task 6's
 *  `restoring` (before a move back) is no fresh collection's, so it is not listed; a crash case can still aim
 *  `crashAt` at it (`KillPoint`). */
export const POINTS = ['locked', 'consented', 'recorded', 'slotted', 'moved', 'proven', 'removed', 'emptied',
  'witnessed', 'dropped'] as const;
export type Point = (typeof POINTS)[number];
/** Where `crashAt` can kill: any point a fresh collection passes, or the putback's `restoring`, before its rename. */
export type KillPoint = Point | 'restoring';

/** The idle floor at 0 s, so every leaf a case makes is past it at once. Ruling G4: `_ws_collect_floor_s` is the ONE
 *  floor definition, and redefining it in the sourced harness is the only test seam that lowers it, never the
 *  `WS_COLLECT_IDLE_FLOOR_S` knob, which only raises it. The one spelling of that seam in these suites. */
export const FLOOR0 = '_ws_collect_floor_s() { echo 0; };';
/** Nobody uses any leaf here: the in-use probe answers "nobody" without walking /proc (its own suite measures it). */
export const NOBODY = "_ws_path_users() { _WS_PATH_USERS_PIDS=''; _WS_PATH_USERS_WHY=''; return 0; };";
export const COLLECT_STUBS = `${FLOOR0} ${NOBODY}`;

export const regOf = (h: PrHarness): string => path.join(h.home, '.cc-sessions');
export const tmpRootOf = (h: PrHarness): string => path.join(h.home, '.cc-tmp');
export const leafOf = (h: PrHarness, id = COL_ID): string => path.join(tmpRootOf(h), id);
export const quarantineOf = (h: PrHarness): string => path.join(tmpRootOf(h), '.ccd-quarantine');
export const recordDirOf = (h: PrHarness): string => path.join(regOf(h), 'tmpquarantine');
export const witnessOf = (h: PrHarness, id = COL_ID): string => path.join(regOf(h), 'tmproots', id);

/** `dev:ino` of the path ITSELF (a link is not followed), or null when nothing stands there. */
export const devinoOf = (p: string): string | null => {
  try { const s = fs.lstatSync(p, { bigint: true }); return `${s.dev}:${s.ino}`; } catch { return null; }
};

const SUFFIX = /^(.+)\.([0-9]+)\.([0-9]+)$/;
/** The record files of EXACTLY `id`: the name with its two trailing all-digit dot-fields stripped equals `id`. Never an
 *  `<id>.*` prefix match — ids admit dots, so `p-calm-mesa.v2-quiet-river.<ns>.<pid>` is not `p-calm-mesa`'s. */
export const recordsOf = (h: PrHarness, id = COL_ID): string[] => {
  const d = recordDirOf(h);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((n) => SUFFIX.exec(n)?.[1] === id).sort();
};
/** The slots of exactly `id` (`slot.<id>.<ns>.<pid>`), parsed the same way. */
export const slotsOf = (h: PrHarness, id = COL_ID): string[] => {
  const q = quarantineOf(h);
  if (!fs.existsSync(q)) return [];
  return fs.readdirSync(q).filter((n) => n.startsWith('slot.') && SUFFIX.exec(n.slice('slot.'.length))?.[1] === id).sort();
};
/** NO SLOT IS EVER ORPHANED (spec §5.10): every slot of `id` is named by a standing record of `id`, `slot.<x>` by
 *  `<x>`. `except` names a planted decoy that no record is meant to name. */
export const custodyHolds = (h: PrHarness, id = COL_ID, except: readonly string[] = []): void => {
  const recs = new Set(recordsOf(h, id));
  for (const s of slotsOf(h, id).filter((x) => !except.includes(x))) {
    expect(recs.has(s.slice('slot.'.length)), `${s} is named by a standing record`).toBe(true);
  }
};
/** One field of the witness line (` <key>=<value>`), or null. */
export const witnessField = (h: PrHarness, key: string, id = COL_ID): string | null => {
  try {
    return new RegExp(` ${key}=(\\S+)`).exec(fs.readFileSync(witnessOf(h, id), 'utf8'))?.[1] ?? null;
  } catch { return null; }
};

/** `birthtimeNs` is the leaf's NANOSECOND birth time (statx), so a case can tell a new directory from the orphan even
 *  when the kernel hands the freed inode straight back: ccd's whole-second btime cannot. */
export interface Orphan { id: string; leaf: string; devino: string; birthtimeNs: bigint }
/** A WITNESSED ORPHAN, the collector's whole population: a child minted for run 7 asked `_child_tmpdir` for its temp
 *  root (which wrote the witness), left scratch in it, and is gone — its marker removed, the leaf and the witness left
 *  behind, as a tail that KEPT the leaf leaves them (spec §5.2). */
export function orphanLeaf(h: PrHarness, id = COL_ID): Orphan {
  const leaf = h.sh(`_reg_set ${id} child ${DEAD_RUN} && d=$(_child_tmpdir ${id}) && mkdir -p "$d/scratch" "$d/cdk.out"`
    + ` && printf 'old work\\n' > "$d/scratch/a.txt" && printf '{}' > "$d/cdk.out/manifest.json" && printf '%s' "$d"`);
  fs.rmSync(path.join(regOf(h), `${id}.child`));
  expect(leaf, 'the CONTROL: _child_tmpdir handed out the id-derived leaf').toBe(leafOf(h, id));
  expect(witnessField(h, 'run', id), 'the CONTROL: and witnessed it for the dead run').toBe(DEAD_RUN);
  const devino = devinoOf(leaf);
  expect(devino, 'the CONTROL: the leaf stands').not.toBeNull();
  return { id, leaf, devino: devino!, birthtimeNs: fs.lstatSync(leaf, { bigint: true }).birthtimeNs };
}

/** A RECYCLED-SLUG SPAWN's registry half, as `ws-add` writes it: the row, then the `.child` marker (its one writer). */
export const g2Row = (id = COL_ID): string =>
  `mkdir -p "$HOME/worktrees/g2-${id}" && _reg_set ${id} uuid ${G2_UUID} && _reg_set ${id} project demo`
  + ` && _reg_set ${id} workdir "$HOME/worktrees/g2-${id}" && _reg_set ${id} child ${G2_RUN}`;
/** Its spawn half: `_child_tmpdir`, the one composer — `mkdir -p`, so it ADOPTS a directory standing at the id and makes
 *  a new one otherwise, and it rewrites the witness for its own run — then the new child's first scratch file (none
 *  when `scratch` is ''). The path it was handed is left in `$HOME/g2-dir`. */
export const g2Spawn = (id = COL_ID, scratch = 'g2.txt'): string =>
  `d=$(_child_tmpdir ${id}) && printf '%s' "$d" > "$HOME/g2-dir"`
  + (scratch === '' ? '' : ` && printf 'g2 scratch\\n' > "$d/${scratch}"`);
/** The recycled child LEAVES, as its own reclaim leaves: its tail removes its temp root and drops the witness
 *  (`_ws_tmproot_remove`, wave 6), and its row goes. */
export function g2Departs(h: PrHarness, id = COL_ID): void {
  h.sh(`_ws_tmproot_remove ${id} >/dev/null 2>&1; :`);
  for (const f of ['uuid', 'project', 'workdir', 'child']) fs.rmSync(path.join(regOf(h), `${id}.${f}`), { force: true });
  expect(fs.existsSync(leafOf(h, id)), 'the CONTROL: its own tail removed its leaf').toBe(false);
}

const linesOf = (p: string): string[] => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : []);
/** `_ws_collect_gap`, redefined: every point the verb passes is appended to `$HOME/gaps`, and a point named in `acts`
 *  runs its snippet in a SUBSHELL — nothing it sets leaks into the verb's own variables — and a snippet that fails is
 *  recorded in `$HOME/gap-errors`, so a case can prove its injection ran. */
const armsOf = (acts: Partial<Record<Point, string>>): string => Object.entries(acts)
  .map(([p, s]) => `${p}) ( ${s} ) || echo "${p}" >> "$HOME/gap-errors" ;;`).join(' ');
export const gapAt = (acts: Partial<Record<Point, string>>): string =>
  `_ws_collect_gap() { echo "$1" >> "$HOME/gaps"; case "$1" in ${armsOf(acts)} esac; };`;
export const gapsOf = (h: PrHarness): string[] => linesOf(path.join(h.home, 'gaps'));
export const gapErrorsOf = (h: PrHarness): string[] => linesOf(path.join(h.home, 'gap-errors'));

/** `_ws_collect_gap`, redefined to DIE at `point`: SIGKILL to every shell from this one up to the top `bash -c`,
 *  ancestors first and itself last, so no shell between them returns into the verb and carries on. A kill, not an exit:
 *  no trap runs, nothing is cleaned up. `$HOME/crashed-at` says it fired. Linux (`/proc/<pid>/stat`). `acts` run at
 *  EARLIER points exactly as `gapAt`'s do, so a race and a crash can meet in one run. */
export const crashAt = (point: KillPoint, acts: Partial<Record<Point, string>> = {}): string =>
  `_ws_collect_gap() { echo "$1" >> "$HOME/gaps"; case "$1" in ${armsOf(acts)} esac; [[ "$1" == ${point} ]] || return 0;`
  + ' printf \'%s\' "$1" > "$HOME/crashed-at"; local p=$BASHPID pp; local -a chain=();'
  + ' while [[ "$p" != "$$" ]]; do chain=("$p" ${chain[@]+"${chain[@]}"});'
  + ' read -r _ _ _ pp _ < "/proc/$p/stat" || break; p=$pp; done;'
  + ' kill -KILL "$$" ${chain[@]+"${chain[@]}"}; };';
export const crashedAt = (h: PrHarness): string => {
  try { return fs.readFileSync(path.join(h.home, 'crashed-at'), 'utf8'); } catch { return ''; }
};

/** `_ws_collect_gap`, redefined to photograph the disk at every point: the HOME's `.cc-tmp`, `tmproots/` and
 *  `tmpquarantine/`, three levels deep, sorted, under a `== <point>` header in `$HOME/facts`. */
export const SNAPSHOT_GAP = '_ws_collect_gap() { { echo "== $1"; ( cd "$HOME" && find .cc-tmp .cc-sessions/tmproots'
  + ' .cc-sessions/tmpquarantine -mindepth 1 -maxdepth 3 2>/dev/null | LC_ALL=C sort ); } >> "$HOME/facts"; };';
/** Each photographed point as five flags: the leaf at the id · a record · a slot · the slot's leaf · the witness. */
export const factsOf = (h: PrHarness, id = COL_ID): Array<[string, string]> => {
  const f = path.join(h.home, 'facts');
  const raw = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  const e = id.replace(/[.]/g, '\\.');
  const res = [
    new RegExp(`^\\.cc-tmp/${e}$`),
    new RegExp(`^\\.cc-sessions/tmpquarantine/${e}\\.[0-9]+\\.[0-9]+$`),
    new RegExp(`^\\.cc-tmp/\\.ccd-quarantine/slot\\.${e}\\.[0-9]+\\.[0-9]+$`),
    new RegExp(`^\\.cc-tmp/\\.ccd-quarantine/slot\\.${e}\\.[0-9]+\\.[0-9]+/leaf$`),
    new RegExp(`^\\.cc-sessions/tmproots/${e}$`),
  ];
  return raw.split(/^== /m).filter(Boolean).map((block): [string, string] => {
    const [point = '', ...entries] = block.split('\n').filter(Boolean);
    return [point, res.map((re) => (entries.some((x) => re.test(x)) ? '1' : '0')).join('')];
  });
};

export interface Run { code: number; stdout: string; stderr: string }
/** The ONE JSON line a verb or an audit prints (its last line), or `{}` when it printed none. */
export const docOf = (stdout: string): Record<string, unknown> => {
  const line = stdout.trim().split('\n').filter(Boolean).pop();
  if (line === undefined) return {};
  try { return JSON.parse(line) as Record<string, unknown>; } catch { return { unparsed: stdout }; }
};
/** `ccd ws-audit --session <id> --collect` through the sourced function, answering instead of throwing. */
export const collectAudit = (h: PrHarness, id = COL_ID, pre = ''): Run =>
  h.run(`${COLLECT_STUBS} ${pre} cmd_ws_audit --session ${id} --collect`);
/** `ccd ws-collect --expect <token> --session <id>` through the sourced function, answering instead of throwing. */
export const collectVerb = (h: PrHarness, token: string, id = COL_ID, pre = ''): Run =>
  h.run(`${COLLECT_STUBS} ${pre} cmd_ws_collect --expect ${token} --session ${id}`);
/** The token the audit mints now — asserted to BE one, so a case never spends an empty string by accident. */
export function tokenOf(h: PrHarness, id = COL_ID, pre = ''): string {
  const r = collectAudit(h, id, pre);
  const t = String(docOf(r.stdout)['token'] ?? '');
  expect(r.code, `the CONTROL: the audit answered: ${r.stdout}${r.stderr}`).toBe(0);
  expect(t, `the CONTROL: the audit minted a token: ${r.stdout}`).toMatch(TOKEN);
  return t;
}

export interface Round { audit: Run; doc: Record<string, unknown>; verb?: Run; answer?: Record<string, unknown> }
/** "The next audit and verb", run to quiescence: audit, spend the token it offers, again — at most `max` rounds,
 *  stopping at the first audit that offers none. Every round is returned, for the case to read. */
export function settle(h: PrHarness, id = COL_ID, pre = '', max = 4): Round[] {
  const rounds: Round[] = [];
  for (let i = 0; i < max; i += 1) {
    const audit = collectAudit(h, id, pre);
    const doc = docOf(audit.stdout);
    const round: Round = { audit, doc };
    rounds.push(round);
    const t = doc['token'];
    if (audit.code !== 0 || typeof t !== 'string' || !TOKEN.test(t)) break;
    round.verb = collectVerb(h, t, id, pre);
    round.answer = docOf(round.verb.stdout);
  }
  return rounds;
}
export const verdictOf = (r: Round | undefined): string => String(r?.doc['verdict']);
export const lastVerdict = (rounds: readonly Round[]): string => verdictOf(rounds[rounds.length - 1]);
export const shownRounds = (rounds: readonly Round[]): string => JSON.stringify(rounds.map((x) => [x.doc, x.answer ?? null]));
