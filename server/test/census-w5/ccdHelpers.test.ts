// W5's ccd-helper census, held two ways (`consolidation-census.test.ts`'s discipline; D-7071; ARCH-45, Task C5d; plan
// 2026-10-27-consolidation-w5-ccd-helpers.md): against a FIXTURE text or tree, so each query counts what it claims and
// passes over what it must not, and against the REAL tree, so it finds the sites the plan measured on its base.
//
// THE REAL ROWS. Pinned now are the facts already at target (spec §5.1 rule 3; D-7074): every tail-step helper has two
// or more callers; each one's callers among the five tail functions are exactly its measured set, holding a reap-side and
// a reclaim-side function; `_reg_purge` is called only from `_reg_retire`; and the four lock shapes that are not wrappers,
// which C5g does not touch. The refusal calls hold their base counts (158: 155 on code lines and 3 on comment lines) and
// "the two families agree on every call", which holds at every step of the series. The rows C5e, C5f and C5g move
// REPORT, as `accountMarkers.test.ts` (C5a) does (`reportRow.ts#expectReportRow`): helper definitions 2 at base (C5e
// takes them to 1), token minters 2 (C5f: 1), reap-lock wrappers 4 (C5g: 1). Each prints its sites and holds only that
// every name is a base site or the plan's target, that the count never grows past the base, and that the query still
// finds one; the exact may-only-shrink pin lands in that task's ratchet commit.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ccdLauncherIn } from '../consolidationCensus.js';
import {
  functionSpan, markedSpan, reapLockWrappers, refuseCalls, refuseHelperDefs, refuseWords, regPurgeCallLines, tailCallers,
  tailStepHelpers, TAIL_FNS, TAIL_REAP_SIDE, TAIL_STEP_HELPERS, tokenMinters,
} from './ccdHelpers.js';
import { expectReportRow } from './reportRow.js';

const SH = '#!/usr/bin/env bash\n';

/** A planted ccd text: a call in each region, a comment mention, a non-literal word, a call in a hole, and the names
 *  the census must pass over (a definition, a backtick mention, `_ws_collect_refused`, `_ws_orphan_refuse`). */
const PLANTED = [
  SH.trimEnd(),
  '_reap_refuse() { REAP_VERDICT="$1"; REAP_DETAIL="$2"; return 1; }',
  'a_eval() {',
  '  _reap_refuse alpha "the first word"',
  '  # a note: `… || _reap_refuse …` keeps its status',
  '  _reap_refuse "${row#!}" "a word python chose"',
  '  # the name in backticks with no argument is no call: `_reap_refuse`',
  '}',
  '# ── the collector ── COLLECT-BEGIN ──',
  '_ws_collect_refuse() { REAP_VERDICT="$1"; REAP_DETAIL="$2"; return 1; }   # word detail -> rc 1',
  'c_eval() { _ws_collect_refuse beta "inside"; _ws_collect_refused "$id" "" gamma "x"; _ws_orphan_refuse delta "y"; }',
  '# ── end ── COLLECT-END ──',
  '# ── loose ── LOOSE-BEGIN ──',
  'l_eval() { _ws_collect_refuse epsilon "loose"; }',
  '# ── end loose ── LOOSE-END ──',
  'hole() {',
  '  _reap_refuse zeta "in the hole"',
  '}',
  's_eval() { _ws_refuse eta "the shared helper"; }',
  '',
].join('\n');

describe('refuseCalls / refuseWords: the verdict-setting refusal helpers (D-7071)', () => {
  it('FIXTURE: one site per call, families by region and by name; definitions, backtick mentions and other names are not calls', () => {
    const calls = refuseCalls(PLANTED);
    expect(calls.map((c) => [c.name, c.word, c.comment, c.regionFamily, c.nameFamily, c.fn])).toEqual([
      ['_reap_refuse', 'alpha', false, 'reap', 'reap', 'a_eval'],
      ['_reap_refuse', null, true, 'reap', 'reap', 'a_eval'],
      ['_reap_refuse', null, false, 'reap', 'reap', 'a_eval'],
      ['_ws_collect_refuse', 'beta', false, 'collect', 'collect', 'c_eval'],
      ['_ws_collect_refuse', 'epsilon', false, 'collect', 'collect', 'l_eval'],
      ['_reap_refuse', 'zeta', false, 'reap', 'reap', 'hole'],
      ['_ws_refuse', 'eta', false, 'reap', null, 's_eval'],
    ]);
    for (const c of calls) expect(PLANTED.slice(c.offset).startsWith(c.name), `offset of ${c.name}`).toBe(true);
  });

  it('FIXTURE: a call moved across a region marker changes its region family, so the two families disagree on it', () => {
    const moved = PLANTED.replace('c_eval() { _ws_collect_refuse beta "inside";', 'c_eval() { :;')
      .replace('a_eval() {\n', 'a_eval() {\n  _ws_collect_refuse beta "moved out"\n');
    const disagree = refuseCalls(moved).filter((c) => c.nameFamily !== null && c.nameFamily !== c.regionFamily);
    expect(disagree.map((c) => [c.name, c.word, c.regionFamily])).toEqual([['_ws_collect_refuse', 'beta', 'reap']]);
  });

  it('FIXTURE: a marker without its pair throws rather than moving a region\'s calls to the other family', () => {
    expect(() => refuseCalls(PLANTED.replace('COLLECT-END', 'COLLECT-GONE'))).toThrow(/COLLECT-BEGIN\/COLLECT-END/);
  });

  it('FIXTURE: refuseWords reads one family, within a span, with holes excluded and comment lines on request', () => {
    expect(refuseWords('reap', { src: PLANTED })).toEqual(['alpha', 'eta', 'zeta']);
    expect(refuseWords('collect', { src: PLANTED })).toEqual(['beta', 'epsilon']);
    const hole = functionSpan(PLANTED, 'hole');
    expect(refuseWords('reap', { src: PLANTED, exclude: [hole] })).toEqual(['alpha', 'eta']);
    const collect = markedSpan(PLANTED, 'COLLECT-BEGIN', 'COLLECT-END')!;
    expect(refuseWords('collect', { src: PLANTED, from: collect[0], to: collect[1] })).toEqual(['beta']);
    // A comment-line call adds a word when it has one, unless code only is asked.
    const noted = PLANTED.replace('  # a note:', '  # _reap_refuse noted "in a comment"\n  # a note:');
    expect(refuseWords('reap', { src: noted })).toEqual(['alpha', 'eta', 'noted', 'zeta']);
    expect(refuseWords('reap', { src: noted, codeOnly: true })).toEqual(['alpha', 'eta', 'zeta']);
  });

  it('REAL: 158 calls, 155 on code lines and 3 on comment lines; 117 reap and 41 collect; the two families agree on every call', () => {
    const calls = refuseCalls();
    const byFn = new Map<string, number>();
    for (const c of calls) byFn.set(`${c.name} in ${c.fn ?? '<top-level>'}${c.comment ? ' (comment)' : ''}`, (byFn.get(`${c.name} in ${c.fn ?? '<top-level>'}${c.comment ? ' (comment)' : ''}`) ?? 0) + 1);
    console.log(`census refuseCalls: ${calls.length} (${calls.filter((c) => !c.comment).length} code, ${calls.filter((c) => c.comment).length} comment)\n`
      + [...byFn].map(([k, n]) => `  ${n}  ${k}`).join('\n'));
    const disagree = calls.filter((c) => c.nameFamily !== null && c.nameFamily !== c.regionFamily);
    expect(disagree.map((c) => `${c.line}: ${c.text.trim()}`), 'the two families agree on every call').toEqual([]);
    expect([calls.length, calls.filter((c) => !c.comment).length, calls.filter((c) => c.comment).length]).toEqual([158, 155, 3]);
    expect(calls.filter((c) => c.comment).every((c) => c.word === null), 'no comment mention has a literal word').toBe(true);
    expect([calls.filter((c) => c.regionFamily === 'reap').length, calls.filter((c) => c.regionFamily === 'collect').length]).toEqual([117, 41]);
  });
});

describe('refuseHelperDefs: the helpers\' definitions (D-7071)', () => {
  it('FIXTURE: each definition with its body, a trailing comment cut', () => {
    expect(refuseHelperDefs(PLANTED)).toEqual([
      { name: '_reap_refuse', line: 2, body: 'REAP_VERDICT="$1"; REAP_DETAIL="$2"; return 1;' },
      { name: '_ws_collect_refuse', line: 10, body: 'REAP_VERDICT="$1"; REAP_DETAIL="$2"; return 1;' },
    ]);
  });

  it('REAL: definitions, reported by name (2 at base, `_reap_refuse` and `_ws_collect_refuse`; C5e takes it to 1, `_ws_refuse`)', () => {
    const defs = refuseHelperDefs();
    console.log(`census refuseHelperDefs: ${defs.length}\n${defs.map((d) => `  ${d.name}  (line ${d.line})  ${d.body}`).join('\n')}`);
    expectReportRow('refuseHelperDefs', defs.map((d) => d.name), ['_reap_refuse', '_ws_collect_refuse'], ['_ws_refuse'], 1);
  });
});

describe('tokenMinters: the functions whose stdout is the hash (D-7071)', () => {
  const MINTERS = [
    SH.trimEnd(),
    'mint_named() {   # a b',
    '  printf \'%s\\n\' "a=$1" "b=$2" \\',
    '    | _plat_sha256 | cut -d\' \' -f1',
    '}',
    'mint_args() {',
    '  printf \'%s\\n\' "$@" | _plat_sha256 | cut -d\' \' -f1',
    '}',
    'digest_only() {',
    '  REAP_SENSDIGEST=$(printf \'%s\\n\' "${REAP_SENSITIVE[@]-}" | sort | _plat_sha256 | cut -d\' \' -f1)',
    '  local h; h=$(printf \'%s\\n\' "$1" | _plat_sha256 | cut -d\' \' -f1)',
    '}',
    'last_command() { local x=1; printf \'%s\\n\' "$@" | _plat_sha256 | cut -d\' \' -f1; }',
    '',
  ].join('\n');

  it('FIXTURE: both minter shapes and a minter as a last command count; the same pipe inside $( ) does not', () => {
    expect(tokenMinters(MINTERS)).toEqual(['mint_named', 'mint_args', 'last_command']);
    expect(tokenMinters(MINTERS.replace(/^last_command.*\n/m, ''))).toEqual(['mint_named', 'mint_args']);
  });

  it('REAL: minters, reported by name (2 at base, `_ws_fingerprint` and `_ws_reclaim_fingerprint`; C5f takes it to 1); the digests are not counted', () => {
    const m = tokenMinters();
    console.log(`census tokenMinters: ${m.length}\n${m.map((n) => `  ${n}`).join('\n')}`);
    expectReportRow('tokenMinters', m, ['_ws_fingerprint', '_ws_reclaim_fingerprint'], ['_ws_reclaim_fingerprint'], 1);
  });
});

describe('reapLockWrappers: the shared reap lock\'s wrappers (D-7071)', () => {
  const LOCKS = [
    SH.trimEnd(),
    'cmd_wrap() {',
    '  local lock="$REG/.reap-$id.lock" lfd rc=0',
    '  exec {lfd}>>"$lock" || _lc_refuse wrap "$id" lock-unopenable "cannot open the reap lock at $lock"',
    '  flock -n "$lfd" || {',
    '    printf \'{"refused":"in-progress","detail":%s,"paths":[]}\\n\' "$(_json_str "busy")"',
    '    return 0',
    '  }',
    '  _locked "$id"; rc=$?',
    '  exec {lfd}>&-',
    '  return "$rc"',
    '}',
    'cmd_restoreish() {',
    '  local lock="$REG/.reap-$id.lock" lfd',
    '  exec {lfd}>>"$lock" || _lc_refuse restore "$id" lock-unopenable "x"',
    '  flock -n "$lfd" || { exec {lfd}>&-; _lc_refuse restore "$id" in-progress "busy"; }',
    '}',
    'probe_listing() { local ctl; ctl=("$REG/.reap-$id".lo[c]k); }',
    'other_lock() { exec {fd}>>"$REG/.collect-loose.lock"; flock -n "$fd"; printf \'{"refused":"in-progress"}\\n\'; return 0; }',
    '',
  ].join('\n');

  it('FIXTURE: a wrapper answers contention with the in-progress document at rc 0; a restore-shaped lock and a listing are other shapes; another lock file is neither', () => {
    expect(reapLockWrappers(LOCKS)).toEqual({ wrappers: ['cmd_wrap'], others: ['cmd_restoreish', 'probe_listing'] });
  });

  it('REAL: wrappers, reported by name (4 at base; C5g takes it to 1, `_ws_reap_lock_run`), and the four other shapes pinned by name', () => {
    const r = reapLockWrappers();
    console.log(`census reapLockWrappers: ${r.wrappers.length}\n${r.wrappers.map((n) => `  ${n}`).join('\n')}\n  other shapes, not counted:\n${r.others.map((n) => `    ${n}`).join('\n')}`);
    expectReportRow('reapLockWrappers', r.wrappers, ['cmd_ws_reap', 'cmd_ws_reclaim', 'cmd_ws_expire', 'cmd_ws_collect'], ['_ws_reap_lock_run'], 1);
    expect([...r.others].sort()).toEqual(['_ws_collect_audit_contained', '_ws_collect_registered', '_ws_expire_spawn_gate', 'cmd_ws_restore']);
  });
});

describe('the tail steps: named helpers the reap and reclaim tails share (D-7074)', () => {
  let root = '';
  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'w5-tail-'));
    mkdirSync(path.join(root, 'ccd'), { recursive: true });
    writeFileSync(ccdLauncherIn(root), [
      SH.trimEnd(),
      '_reg_purge() { rm -f "$REG/$1".*; }',
      '_reg_retire() {',
      '  _reg_purge "$1"',
      '}',
      '_ws_tomb_children() { :; }',
      '_ws_reap_tail() {',
      '  _reg_retire "$1"; _ws_tomb_children "$1"',
      '}',
      '_ws_reclaim_tail() {',
      '  _reg_retire "$1"',
      '  # _ws_tomb_children in a comment is no call',
      '}',
      'cmd_forget() {',
      '  _reg_retire "$1"',
      '  echo "_reg_purge_unremoved is another name"',
      '}',
      '',
    ].join('\n'));
  });
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  it('FIXTURE: callers by function, the tail set among them, and _reg_purge call lines outside _reg_retire', () => {
    expect(tailStepHelpers(root)['_reg_retire']).toEqual(['_ws_reap_tail', '_ws_reclaim_tail', 'cmd_forget']);
    expect(tailCallers('_reg_retire', root)).toEqual(['_ws_reap_tail', '_ws_reclaim_tail']);
    expect(tailCallers('_ws_tomb_children', root)).toEqual(['_ws_reap_tail']);
    expect(regPurgeCallLines(root)).toEqual([]);
    writeFileSync(ccdLauncherIn(root), `${'#!/usr/bin/env bash'}\ncmd_more() {\n  _reg_purge "$1"\n}\n`, { flag: 'a' });
    expect(regPurgeCallLines(root)).toEqual(['ccd/ccd:20  _reg_purge "$1"']);
  });

  it('REAL: every named tail-step helper has two or more callers', () => {
    const t = tailStepHelpers();
    console.log(`census tailStepHelpers:\n${TAIL_STEP_HELPERS.map((h) => `  ${h}: ${t[h]!.length} callers; tail: ${tailCallers(h).join(', ')}`).join('\n')}`);
    for (const h of TAIL_STEP_HELPERS) expect(t[h]!.length, `${h}'s callers: ${t[h]!.join(', ')}`).toBeGreaterThanOrEqual(2);
  });

  it('REAL: each tail-step helper\'s callers among the tail functions are exactly its listed set, and hold a reap-side and a reclaim-side function', () => {
    const MEASURED: Record<string, string[]> = {
      _reg_retire: ['_ws_reap_tail', '_ws_reclaim_tail'],
      _ws_unsupervise: ['_ws_reap_tail', '_ws_reclaim_tail'],
      _ws_tombstone: ['_ws_reap_tail', '_ws_reclaim_locked'],
      _ws_tomb_str: ['_ws_reap_locked', '_ws_reap_tail', '_ws_reclaim_locked', '_ws_reclaim_tail'],
      _ws_tomb_children: ['_ws_reap_locked', '_ws_reap_tail', '_ws_reclaim_tail'],
      _lc_intent: ['_ws_reap_tail', '_ws_reclaim_locked'],
      _lc_done: ['_ws_reap_tail', '_ws_reclaim_tail'],
      _lc_fail: ['_ws_reap_tail', '_ws_reclaim_fail'],
    };
    expect(Object.keys(MEASURED)).toEqual([...TAIL_STEP_HELPERS]);
    for (const h of TAIL_STEP_HELPERS) {
      const got = tailCallers(h);
      expect(got, `${h}'s callers among ${TAIL_FNS.join(', ')}`).toEqual(MEASURED[h]);
      expect(got.some((c) => TAIL_REAP_SIDE.includes(c)) && got.some((c) => !TAIL_REAP_SIDE.includes(c)), `${h} is shared by both tails`).toBe(true);
    }
  });

  it('REAL: `_reg_purge` is called only from `_reg_retire`', () => {
    expect(regPurgeCallLines()).toEqual([]);
  });
});
