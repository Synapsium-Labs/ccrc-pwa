// Red cases for guards review 335 found shipped without one (child
// reclamation wave 6). Each guard below was already in the tree; what was
// missing is the case that goes red when the guard is deleted.
// - The breadcrumb arm's tombstone checks in `_ws_reclaim_recorded_crumb`
//   (spec §5.5): a tombstone that is a LINK is no tombstone of this row, even
//   when the file it reaches is byte-identical; and an EMPTY uuid on both the
//   row and the tombstone proves nothing.
// - The reason cap (`_ws_leaf_why_line`) at the two kept-leaf sites no case
//   reached: the clips leaf's unmeasured arm and the temp root's unmeasured
//   arm after the removal helper ran (spec §5.6). An `rm` that fails names the
//   entry it could not remove, a name the session chose, so the journaled
//   reason must be one short line of printable ASCII.
// - The consent check between the verb's in-lock recompute and its pin, on the
//   VANISHED arm (spec §5.5): a branch deleted in that window stops the act
//   `state-changed` there too, with nothing destroyed.
// FIXTURE HOMES ONLY (`makePrHarness`): the unit and the pane are stubbed
// (`CHILD_STUBS`); every repository, row, tombstone and leaf is under the HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { WS_ADD } from './ccdWsHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';
import { eventsOf, measOf } from './lifecycleHelpers.js';
import {
  CHILD_BRANCH, CHILD_ENV, CHILD_ID, CHILD_RUN, CHILD_STUBS, childReclaimVerb, evalOf, makeChild, type LadderAnswer,
} from './childReclaimFixture.js';
import { verbHelpers } from './childReclaimVerbHelpers.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-review-335-pins-'); });
afterEach(() => { h.cleanup(); });
const { unsupervised, failedPairAgrees } = verbHelpers(() => h);

const GIT_VERSION = /git version (\d+)\.(\d+)/.exec(
  execFileSync('git', ['--version'], { encoding: 'utf8', env: inheritedEnv() }));
const MODERN_GIT = GIT_VERSION !== null
  && (Number(GIT_VERSION[1]) > 2 || (Number(GIT_VERSION[1]) === 2 && Number(GIT_VERSION[2]) >= 43));

// ── F8: the breadcrumb arm's tombstone checks (the recovery suite's setup) ──
const HELD = 'name a workdir that cannot be resolved completely';
const SIB = 'demo-still-harbor';
const held = (r: LadderAnswer, label: string): void => {
  expect(r.verdict, `${label}: ${r.detail}`).toBe('unmeasured');
  expect(r.detail, label).toContain(`registry row(s) ${SIB} ${HELD}`);
  expect(r.token, label).toBe('');
};
const placed = (r: LadderAnswer, label: string): void => {
  expect(r.verdict, `${label}: ${r.detail}`).toBe('reclaimable');
  expect(r.token, label).toMatch(/^[0-9a-f]{64}$/);
};
const stanza = (main: string, wt: string): string =>
  h.git(main, 'worktree', 'list', '--porcelain').split('\n\n').find((s) => s.startsWith(`worktree ${wt}\n`)) ?? '';
const tombFile = (id: string): string => path.join(h.home, '.cc-sessions', '.reaped', `${id}.json`);
/** A second child of the child's repository, interrupted by its own reclaim after the tail's step 4: pinned,
 *  tombstoned (`worktree: present`), breadcrumb `reclaim:branch`, its tree removed by git — so only the
 *  breadcrumb arm can place its gone row. */
const interruptedSibling = (main: string): string => {
  h.sh(`${WS_ADD} CCD_WS_SLUG=still-harbor cmd_ws_add --child ${CHILD_RUN} demo`);
  const wt = path.join(h.home, 'worktrees', 'demo', 'still-harbor');
  h.sh(`${CHILD_STUBS} export ${CHILD_ENV}; _ws_reclaim_eval ${SIB} 0 ${CHILD_RUN} >/dev/null`
    + ` && _ws_reclaim_pin ${SIB} "${wt}" "${main}" "$REAP_BRANCH" ${CHILD_RUN}`
    + ` && _ws_tombstone ${SIB} '[]' "$(_ws_reclaim_tomb_fields ${CHILD_RUN} present)" >/dev/null`
    + ` && _reg_set ${SIB} reaping reclaim:branch`);
  expect(h.reg(SIB, 'reaping'), 'the CONTROL: the sibling carries the breadcrumb').toBe('reclaim:branch');
  h.git(main, 'worktree', 'remove', '--force', wt);
  expect(stanza(main, wt), 'the CONTROL: git keeps no record — only the breadcrumb can place it').toBe('');
  return wt;
};

describe('F8: the breadcrumb arm’s tombstone must be this row’s own file (spec §5.5)', () => {
  it('a tombstone replaced by a LINK to a byte-identical copy keeps the hold; restored, it places the row', () => {
    const c = makeChild(h);
    interruptedSibling(c.main);
    placed(evalOf(h), 'the CONTROL: the breadcrumb and its tombstone place the sibling');
    const tomb = tombFile(SIB);
    const copy = path.join(h.home, 'tomb-copy.json');
    const bytes = fs.readFileSync(tomb);
    fs.writeFileSync(copy, bytes);
    fs.rmSync(tomb);
    fs.symlinkSync(copy, tomb);
    expect(fs.readFileSync(tomb).equals(bytes), 'the CONTROL: the link reaches the same bytes').toBe(true);
    held(evalOf(h), 'a linked tombstone');
    fs.rmSync(tomb);
    fs.writeFileSync(tomb, bytes);
    placed(evalOf(h), 'the CONTROL: a regular file again, the breadcrumb places it');
  }, 120_000);

  it('an EMPTY uuid on both the row and its tombstone proves nothing — the hold stays', () => {
    const c = makeChild(h);
    interruptedSibling(c.main);
    placed(evalOf(h), 'the CONTROL: the breadcrumb and its tombstone place the sibling');
    const uuid = h.reg(SIB, 'uuid')!;
    h.sh(`_ws_tombstone_patch ${SIB} '{"uuid":""}'`);
    fs.writeFileSync(path.join(h.home, '.cc-sessions', `${SIB}.uuid`), '');
    expect(h.sh(`_ws_tomb_str "${tombFile(SIB)}" uuid; printf '|%s' "$?"`), 'the CONTROL: the tombstone’s uuid reads empty').toBe('|0');
    expect(h.sh(`_reg_read ${SIB} uuid; printf '|%s' "$?"`), 'the CONTROL: the row’s uuid reads empty, rc 0').toBe('|0');
    held(evalOf(h), 'an empty uuid on both sides');
    h.sh(`_ws_tombstone_patch ${SIB} '{"uuid":"${uuid}"}'`);
    fs.writeFileSync(path.join(h.home, '.cc-sessions', `${SIB}.uuid`), uuid);
    placed(evalOf(h), 'the CONTROL: the uuids restored, the breadcrumb places it');
  }, 120_000);
});

// ── F9: the reason cap at the two kept-leaf sites no case reached ──
/** A name the SESSION chose: long, with control bytes and bytes 0x80-0xFF that are no UTF-8 — but no newline,
 *  so `rm`'s first stderr line carries all of it. */
const EVIL = Buffer.concat([Buffer.from('evil\t\x1b\x7f\x01'), Buffer.alloc(120, 0x80), Buffer.alloc(120, 0xff)]);
const plantEvil = (leaf: string): void => {
  fs.mkdirSync(Buffer.concat([Buffer.from(`${leaf}/`), EVIL]), { recursive: true });
};
/** `rm` fails on ONE leaf (matched by its last two components — the harness HOME itself may sit under a
 *  `.cc-tmp`), naming the entry it could not remove as GNU rm does; every other `rm` is the real one. */
const RM_FAILS_AT = (root: string, id: string): string =>
  `rm() { if [[ "$1" == -rf* && "\${@: -1}" == */${root}/${id} ]]; then`
  + ' printf "rm: cannot remove \'%s\': Device or resource busy\\n" "$(find -P "${@: -1}" -mindepth 1 -print -quit)" >&2; return 1; fi;'
  + ' command rm "$@"; };';
const NOBODY = '_ws_path_users() { _WS_PATH_USERS_PIDS=""; _WS_PATH_USERS_WHY=""; return 0; };';
/** The kept reason on the done row: ONE short clean line, and the row keeps its `meas`. */
const cleanReason = (done: Record<string, unknown>, head: string): string => {
  expect(done['truncated'], 'the row was never cut down to fit').toBeUndefined();
  expect(measOf(done)['childOf'], 'the row keeps its meas').toBe(String(CHILD_RUN));
  expect(measOf(done)['branch'], 'the row keeps its meas').toBe(CHILD_BRANCH);
  const detail = String(done['detail']);
  expect(detail).not.toMatch(/[\x00-\x1f\x7f]/);
  const at = detail.indexOf(head);
  expect(at, detail).toBeGreaterThanOrEqual(0);
  const why = detail.slice(at + head.length).split('; ')[0]!;
  expect(why.endsWith('…'), 'a cut is marked').toBe(true);
  expect(why.slice(0, -1), 'printable ASCII only').toMatch(/^[\x20-\x7e]*$/);
  expect(Buffer.byteLength(why.slice(0, -1), 'utf8'), 'cut at 300 bytes').toBeLessThanOrEqual(300);
  return why;
};
const doneOf = (): Record<string, unknown> => eventsOf(h.home, 'reclaim').find((e) => e['outcome'] === 'done')!;

describe('F9: an rm that fails on a long, non-ASCII name reaches the row as ONE short clean line (spec §5.6)', () => {
  it('the clips leaf’s unmeasured arm (`clipswhy`)', () => {
    makeChild(h);
    const clips = path.join(h.home, '.cc-clips', CHILD_ID);
    plantEvil(clips);
    const r = childReclaimVerb(h, evalOf(h).token, { pre: `${NOBODY} ${RM_FAILS_AT('.cc-clips', CHILD_ID)}` });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(clips), 'the CONTROL: the clips leaf is kept').toBe(true);
    const done = doneOf();
    expect(measOf(done)['clipsKept']).toBe('unmeasured');
    const why = cleanReason(done, `clips ${clips} kept (unmeasured): `);
    expect(why).toContain(`removing ${fs.realpathSync(clips)} failed (rm exit 1): rm: cannot remove '${fs.realpathSync(clips)}/evil????`);
  }, 90_000);

  it('the temp root’s unmeasured arm after the removal helper ran (`tmpwhy`)', () => {
    makeChild(h);
    const tmp = path.join(h.home, '.cc-tmp', CHILD_ID);
    plantEvil(tmp);
    const r = childReclaimVerb(h, evalOf(h).token, { pre: `${NOBODY} ${RM_FAILS_AT('.cc-tmp', CHILD_ID)}` });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(tmp), 'the CONTROL: the temp root is kept').toBe(true);
    const done = doneOf();
    expect(measOf(done)['tmpRootKept']).toBe('unmeasured');
    const why = cleanReason(done, `temp root ${tmp} kept (unmeasured): `);
    expect(why).toContain(`removing ${fs.realpathSync(tmp)} failed (rm exit 1): rm: cannot remove '${fs.realpathSync(tmp)}/evil????`);
  }, 90_000);
});

// ── F10: the consent window on the vanished arm ──
/** The SECOND `_ws_reclaim_branch_state` of a process (the pin's; the in-lock recompute reads first) runs `act`
 *  before it reads; every read answers for real (the gone-branch suite's hook). */
const IN_THE_WINDOW = (act: string): string => [
  `eval "$(declare -f _ws_reclaim_branch_state | sed '1s/^_ws_reclaim_branch_state /_ws_real_branch_state /')";`,
  `_ws_reclaim_branch_state() { local n; n=$(cat "$HOME/bs-reads" 2>/dev/null || echo 0); echo $(( n + 1 )) > "$HOME/bs-reads";`,
  ` if (( n == 1 )); then ${act}; fi; _ws_real_branch_state "$@"; };`,
].join(' ');

describe.skipIf(!MODERN_GIT)('F10: the consent binds the branch on the VANISHED arm too (spec §5.5)', () => {
  it('a vanished worktree, its branch deleted between the in-lock recompute and the pin: state-changed, nothing destroyed', () => {
    const c = makeChild(h);
    h.git(c.wt, 'checkout', '-q', '--detach');
    fs.rmSync(c.wt, { recursive: true, force: true });
    expect(stanza(c.main, c.wt), 'the CONTROL: git still records the vanished tree').toMatch(/\nprunable /);
    const a = evalOf(h);
    expect(a.verdict, a.detail).toBe('reclaimable');      // minted over the vanished arm, branchState=present
    const r = childReclaimVerb(h, a.token, { pre: IN_THE_WINDOW(`git -C "$1" update-ref -d "refs/heads/$2" >/dev/null 2>&1`) });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('state-changed');
    expect(fs.readFileSync(path.join(h.home, 'bs-reads'), 'utf8').trim(), 'the recompute read, then the pin, and nothing after').toBe('2');
    expect(o.detail).toMatch(new RegExp(`${CHILD_BRANCH} read present when the token was checked inside the lock, but absent when the pin read it again`));
    failedPairAgrees(r);
    expect(eventsOf(h.home, 'reclaim').map((e) => e['outcome']), 'one act: its intent, then its failure').toEqual(['intent', 'failed']);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the CONTROL: the other actor did delete the branch').toBe('');
    expect(stanza(c.main, c.wt), 'git’s record of the vanished tree stands').toMatch(/\nprunable /);
    expect(h.reg(CHILD_ID, 'uuid'), 'the row stands').not.toBeNull();
    expect(h.reg(CHILD_ID, 'reaping'), 'no breadcrumb').toBeNull();
    expect(fs.existsSync(tombFile(CHILD_ID)), 'no tombstone').toBe(false);
    expect(unsupervised(), 'the unit was not touched').toEqual([]);
  }, 90_000);
});
