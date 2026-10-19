// Path-identity W1b, Task 11 (path-identity spec §7, items 29 to 31): three comments in the temp-root collector's
// region of `ccd/ccd` said what the code no longer does, and each is carried in place, line-neutrally. Each case reads
// ccd's own text at test time, so restoring a sentence turns its case red:
// - item 29: the witness-only arm of `_ws_collect_eval` reads the cleanup pause before it mints its token, so the
//   header's witness-only paragraph names the pause, and the case checks the arm's code as well as its words;
// - item 30: a probe that reaches its bound ends the audit, so ONE `_plat_timeout` grace is paid. The header's sum is
//   checked against the knobs it names, read from ccd and the runner, as `collect-audit-budget.test.ts` reads the sum;
// - item 31: the COLLECT-V1 note says how the lane is armed, in words that hold whether or not the Settings switch has
//   shipped, and never says the verb ships inert. `# COLLECT-V1.` stays first on its line, because
//   `collect-readers.test.ts` slices the collector's region up to it.
// Text only: no ccd runs here, so there is no fixture HOME and no bash is spawned.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readRel = (r: string): string => readFileSync(path.join(ROOT, r), 'utf8');
const ccdSrc = readRel('ccd/ccd');

/** `text` from `from` to the first `to` after it. Both anchors are asserted, so a lost one reds rather than widening
 *  the slice. */
const between = (text: string, from: string, to: string): string => {
  const a = text.indexOf(from);
  expect(a, `${JSON.stringify(from)} is gone`).toBeGreaterThan(-1);
  const b = text.indexOf(to, a + from.length);
  expect(b, `${JSON.stringify(to)} does not follow ${JSON.stringify(from)}`).toBeGreaterThan(a);
  return text.slice(a, b);
};

/** A comment block's prose. Every non-empty line must be a whole-line `#` comment, so a code line inside the block
 *  reds. The `#` marks and line breaks fold to single spaces, so a sentence reads the same however it is wrapped. */
const prose = (block: string): string => {
  const lines = block.split('\n').filter((l) => l.length > 0);
  expect(lines.filter((l) => !l.startsWith('#')), 'a line that is not a whole-line comment sits inside the block').toEqual([]);
  return lines.map((l) => l.replace(/^#\s?/, '')).join(' ').replace(/\s+/g, ' ').trim();
};

/** The one integer that `re` (a `g` regex with one group) captures in `text`; reds on zero matches or on two. */
const one = (text: string, re: RegExp, what: string): number => {
  const hits = [...text.matchAll(re)];
  expect(hits.length, `${what}: exactly one binding`).toBe(1);
  return Number(hits[0]![1]!.replace(/_/g, ''));
};

/** The WS-AUDIT-COLLECT header, from its banner to the first state variable it documents. */
const header = (): string => prose(between(ccdSrc, '\n# ── ws-audit --collect: ', "\n_WS_COLLECT_PROBE=''"));
/** The COLLECT-V1 note, from its marker to the region's closing banner. */
const collectV1 = (): string => prose(between(ccdSrc, '\n# COLLECT-V1. ', '\n# ── end temp-root collection'));

describe("the collector's header says what the code does (path-identity spec §7, items 29 to 31)", () => {
  it('the witness-only paragraph names the pause', () => {
    const para = between(header(), 'A witness whose leaf is PROVEN absent', 'THE DOCUMENT mirrors');
    expect(para).toContain('Past those, and unless the cleanup pause stands, it is collectable with a token of its own,');
    expect(para).not.toContain('collectable at once with a token');
    // The comment is a request; this is the code it describes. The witness-only arm of `_ws_collect_eval` (after
    // `_WS_COLLECT_LEAF=absent`) reads the pause before it mints the `collect-absent` token.
    const ev = between(ccdSrc, '\n_ws_collect_eval() {', '\n_ws_collect_resume_eval() {');
    const arm = ev.indexOf('_WS_COLLECT_LEAF=absent');
    const mint = ev.indexOf('mode=collect-absent');
    expect(arm, 'the witness-only arm').toBeGreaterThan(-1);
    expect(mint, "the witness-only arm's token").toBeGreaterThan(arm);
    const pause = ev.lastIndexOf('_ws_collect_paused || return 1', mint);
    expect(pause, 'the witness-only arm reads the pause before its token').toBeGreaterThan(arm);
  });

  it('the budget sums one grace: "about 73 s", with no "79 s" and no wave-9 clause', () => {
    const h = header();
    const at = h.indexOf('BOUNDED, AND');
    expect(at, 'the budget paragraph').toBeGreaterThan(-1);
    const budget = h.slice(at);
    // The knobs the paragraph names, read as text from ccd and the runner, each exactly once.
    const idle = one(ccdSrc, /^WS_COLLECT_IDLE_SCAN_S=(\d+)\b/gm, 'WS_COLLECT_IDLE_SCAN_S');
    const users = one(ccdSrc, /^WS_PATH_USERS_SCAN_S=(\d+)\b/gm, 'WS_PATH_USERS_SCAN_S');
    const scan = one(ccdSrc, /^REAP_SCAN_SECONDS=(\d+)\b/gm, 'REAP_SCAN_SECONDS');
    const grace = one(ccdSrc, /grace="\$\{CCD_TIMEOUT_KILL_AFTER:-(\d+)\}"/g, "_plat_timeout's default grace");
    const graceMax = one(ccdSrc, /\[ "\$grace" -gt (\d+) \] && grace=\1\b/g, "_plat_timeout's grace ceiling");
    const rowS = one(readRel('server/src/remote/runner.ts'), /^[ \t]*'ws-audit':[ \t]*([\d_]+),/gm,
      "CCD_VERB_TIMEOUT_MS['ws-audit']") / 1000;
    const probes = idle + users + scan;
    expect(budget).toContain(`\`WS_COLLECT_IDLE_SCAN_S\` (${idle} s)`);
    expect(budget).toContain(`\`WS_PATH_USERS_SCAN_S\` (${users} s)`);
    expect(budget).toContain(`\`REAP_SCAN_SECONDS\` (${scan} s)`);
    expect(budget).toContain('A probe that reaches its bound ends the audit, so ONE `_plat_timeout` TERM-to-KILL grace is paid');
    expect(budget).toContain(`${grace} s by default, at most ${graceMax} s`);
    expect(budget).toContain(
      `about ${probes + grace} s, or ${probes + graceMax} s at the widest grace, against ws-audit's ${rowS} s runner row`);
    expect(budget).toContain('about 73 s');
    expect(budget).toContain('(`collect-audit-budget.test.ts` holds the sum)');
    expect(budget).toContain('The row pass has no bound of its own;');
    expect(budget).toContain('it fails closed.');
    for (const gone of ['79 s', '94 s', 'A budget keyed on the mode is wave 9', 'NOT ALWAYS INSIDE', 'each `_plat_timeout` adds']) {
      expect(budget, gone).not.toContain(gone);
    }
  });

  it('COLLECT-V1 names how the lane is armed and never says "inert"', () => {
    const note = collectV1();
    expect(note).toContain("the collector's lane composes it, and acts only once the operator arms the lane "
      + "(the fleet box's legacy marker, or the Settings switch where it has shipped)");
    expect(note).not.toMatch(/\binert\b/);
    // Kept as they stood: the capability gate and the two protected shapes.
    expect(note).toContain("ONLY behind `capSupported(state, 'collect-v1')`, which refuses on no evidence;");
    expect(note).toContain('Both protected shapes cross the direct-entry boundary at the top of this file and in `ccd/ccd-entry.py`.');
    // The note names the marker by its role, never by its file name: path-identity spec §1.1 measured that
    // ccd/ccd spells no such name.
    expect(note).not.toContain('collect-lane-live');
  });

  it('# COLLECT-V1. still opens its line', () => {
    expect([...ccdSrc.matchAll(/^# COLLECT-V1\. /gm)].length).toBe(1);
    // collect-readers.test.ts slices the collector's region up to this anchor, so the region must still end on it.
    expect(between(ccdSrc, '\n_ws_collect_enc() {', '\n# COLLECT-V1.').length).toBeGreaterThan(0);
  });
});
