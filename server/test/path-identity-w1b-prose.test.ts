// Path identity W1b: what the spec and the programme's rulings file record about the wave as built (path-identity
// spec §2.9 and §7). The numbers these records state are read from the code here and never restated: the cap from
// `ccd/ccd`, the hook's gates from `ccd/session-hook.sh`, and the name census from `ccd-id-cap.test.ts`'s own tables.
// So a later change to any of them reds this suite until the record is corrected with it. The residuals that hold
// only while the code still shows them are decided from the code too.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f: string): string => readFileSync(path.join(root, f), 'utf8');
/** Flattened: the records wrap their sentences, so a phrase is matched across line breaks. */
const flat = (s: string): string => s.replace(/\s+/g, ' ');
const SPEC = 'docs/superpowers/specs/2026-10-12-path-identity-design.md';
const CONTRACT = 'docs/superpowers/programs/child-reclamation-contract.md';
const CAP_TEST = 'server/test/ccd-id-cap.test.ts';
const HOOK = 'ccd/session-hook.sh';
const DEVIATION_TOKEN = /\bD-\d/;
const FOUR_DIGIT_RANGE = /[0-9]{4} ?(–|\.\.|-) ?[0-9]{4}/;

/** §2.9 alone, from its heading to the next `## ` heading; '' when the heading is missing. */
function asBuilt(): string {
  const s = read(SPEC);
  const at = s.indexOf('\n### 2.9 As built (W1b)\n');
  if (at < 0) return '';
  const end = s.indexOf('\n## ', at + 1);
  return s.slice(at, end < 0 ? s.length : end);
}

/** The integer a shell file assigns to NAME at the start of a line, or NaN when it assigns none. */
function shellInt(file: string, name: string): number {
  const m = new RegExp(`^${name}=(\\d+)\\b`, 'm').exec(read(file));
  return m ? Number(m[1]) : Number.NaN;
}

/** The body of CAP_TEST's top-level `const NAME … = [ … ];`: '' when the array is empty, null when there is none. */
function capTestArray(name: string): string | null {
  const t = read(CAP_TEST);
  const at = t.indexOf(`const ${name}`);
  if (at < 0) return null;
  const open = t.indexOf('= [', at);
  if (open < 0) return null;
  const rest = t.slice(open + 3);
  if (/^\s*\]/.test(rest)) return '';
  const end = rest.search(/\n\s*\][^\n]*;/);
  return end < 0 ? null : rest.slice(0, end);
}

/** Every row's overhead in the census table. An overhead written as a sum of integer literals is summed. */
function censusOverheads(): number[] {
  return [...(capTestArray('ID_NAME_TEMPLATES') ?? '').matchAll(/overhead:\s*([0-9][0-9\s+]*)/g)]
    .map((m) => m[1].split('+').map((x) => Number(x.trim())).reduce((a, b) => a + b, 0));
}

/** The files the census left out, as `CENSUS_EXCLUDED` names them; null when the table cannot be found. */
function censusExcluded(): string[] | null {
  const body = capTestArray('CENSUS_EXCLUDED');
  return body === null ? null : [...body.matchAll(/file:\s*(['"`])([^'"`]+)\1/g)].map((m) => m[2]);
}

/** The departures this wave made, by slug: the plan's expected list, and the ones the task reviews added. */
const DEPARTURES = ['surface-dash-rule-at-stop-and-ws-add-only', 'dot-rule-extends-to-the-two-audits',
  'reg-id-ok-under-lc-all-c', 'stop-checks-its-residue-and-composed-id', 'ws-add-refuses-a-second-actor',
  'ws-hold-reason-stays-unbounded', 'id-cap-from-the-name-census', 'enable-validates-its-project',
  'collect-registry-peek-before-the-lock', 'section-2-2-verdicts-measured-at-task-10', 'dash-parity-in-its-own-file',
  'collect-verb-prelock-refusal-precedes-the-pause',
  'flag-spelled-token-answers-a-malformed-value', 'hold-reason-spelling-a-flag-is-held-verbatim',
  'rename-branch-value-taken-whole', 'valueless-session-key-takes-the-next-flag-as-its-id',
  'ws-add-lock-precedes-the-cap', 'prelock-answer-precedes-in-progress',
  'dash-free-id-answers-unmeasured-registry-before-its-record',
  'dot-leading-audit-now-exits-1-and-the-server-retries', 'census-blind-below-line-5818',
  'prelock-no-lock-clause-follows-the-detail'];

/** What each task found while building, by slug: plan-text corrections, extra pins and measured notes. The rulings
 *  file's "Found while building" list names every one. */
const FOUND_WHILE_BUILDING = ['token-verb-controls-use-a-wrong-token', 'collect-control-runs-on-linux-only',
  'review-335-f9-needle-outgrows-the-cap-under-this-tmpdir', 'stop-residue-red-is-the-pair-form',
  'stop-pair-project-surface-redirected', 'stop-extra-pins', 'start-line-gate-split-at-task-1s-insert',
  'hold-and-rename-flag-ids-answer-bad-session-id', 'strip-reason-mutant-measured',
  'ws-add-dash-test-imports-ccdargv', 'id-cap-census-table-measured-at-the-export',
  'census-compares-normalised-shapes', 'census-excludes-the-token-generation-file',
  'reg-id-cap-under-lc-all-c-pinned', 'enable-cap-written-as-an-if',
  'child-uuid-peek-pinned-by-an-unmeasurable-child', 'other-id-record-reached-only-through-a-stubbed-reader',
  'prelock-second-look-sound-is-unmeasured', 'prelock-reads-the-witness-for-the-document',
  'hold-and-rename-arms-are-matrix-blind', 'expire-v1-note-already-rewritten',
  'merge-moves-a-stale-citation-under-a-rewritten-comment', 'prelock-prefix-cuts-the-rc3-detail',
  'archived-expiry-census-fourth-collect-failed-site', 'superpowers-tracked-file-count-is-one'];

/** The residuals that stand whatever the code says next. */
const BASE_RESIDUALS = ['dot-rule-only-at-the-token-verbs', 'verbs-outside-sec1-keep-the-inline-regex',
  'enable-one-arg-journals-an-unchecked-id', 'hand-planted-ids-over-the-cap', 'files-outside-the-name-census',
  'projects-over-64-get-no-hook-card', 'btime-less-witness-takes-the-lock',
  'history-spool-names-outside-the-census-patterns', 'quarantine-record-names-outside-the-census-patterns',
  'random-slug-decides-the-cap-near-the-boundary', 'hold-card-workdir-quote-silent-near-the-cap',
  'dash-leading-pool-tag-unclearable-on-an-upgraded-box', 'stripped-flag-positional-collapses-to-the-id-form',
  'comments-say-ccd-scans-the-session-value'];

/** The residuals the records must name at this tip: the fixed list, plus each conditional one while the code still
 *  shows it. These are a server docstring that calls ccd's predicate dot-only, the EXPIRE-V1 note that says it ships
 *  inert, and a cap above the hook's id gate. */
function residualsAtTheTip(): string[] {
  const out = [...BASE_RESIDUALS];
  const dotOnly = /`_ws_tmproot_id_ok`[\s\S]{0,80}?no leading[\s*]*`\.`(?![\s*]*(?:or|and)[\s*]+(?:a[\s*]+)?(?:leading[\s*]+)?`-`)/;
  if (dotOnly.test(read('shared/api.ts')) || dotOnly.test(read('server/src/childReclaimSweep.ts'))) {
    out.push('server-docstrings-call-ccds-predicate-dot-only');
  }
  const ccd = read('ccd/ccd');
  const expireNote = ccd.indexOf('\n# EXPIRE-V1.');
  if (expireNote > -1 && ccd.slice(expireNote, expireNote + 700).includes('ships it inert')) {
    out.push('expire-v1-note-ships-it-inert');
  }
  if (shellInt('ccd/ccd', '_REG_ID_MAX') > shellInt(HOOK, 'CCRC_ID_MAX')) {
    out.push('ids-over-128-invisible-to-the-hook-peer-census');
  }
  return out;
}

describe('the path-identity spec records W1b as built (path-identity spec §2.9, §7)', () => {
  const spec = read(SPEC);
  const s = flat(asBuilt());

  it('§2.9 stands after §2.8 and before §3', () => {
    const p28 = spec.indexOf('\n### 2.8 Proof\n');
    const p29 = spec.indexOf('\n### 2.9 As built (W1b)\n');
    const p3 = spec.indexOf('\n## 3. The temp-root tail and the collector\n');
    expect(p28, '§2.8 is missing').toBeGreaterThan(-1);
    expect(p29, '§2.9 is missing').toBeGreaterThan(p28);
    expect(p3, '§3 must follow §2.9').toBeGreaterThan(p29);
  });

  it('states the cap the code carries, the census it came from and the hook gate it meets', () => {
    const cap = shellInt('ccd/ccd', '_REG_ID_MAX');
    const hookId = shellInt(HOOK, 'CCRC_ID_MAX');
    const hookProj = shellInt(HOOK, 'CCRC_PROJ_MAX');
    const overheads = censusOverheads();
    expect(Number.isInteger(cap), '`_REG_ID_MAX=` not found in ccd/ccd').toBe(true);
    expect(Number.isInteger(hookId) && Number.isInteger(hookProj), "the hook's gates not found").toBe(true);
    expect(overheads.length, 'no overhead read from ID_NAME_TEMPLATES').toBeGreaterThan(0);
    // The `<id>` row itself adds no byte, so an overhead of 0 is a row, not a misread.
    for (const o of overheads) expect(Number.isInteger(o) && o >= 0, `overhead ${o}`).toBe(true);
    const w = Math.max(...overheads);
    expect(s).toContain(`The widest overhead is ${w} bytes`);
    expect(s).toContain(`255 minus ${w} is ${255 - w}`);
    expect(s).toContain(`\`_REG_ID_MAX\` is ${cap}`);
    expect(s).toContain(`\`CCRC_ID_MAX\` is ${hookId}`);
    expect(s).toContain(`\`CCRC_PROJ_MAX\` is ${hookProj}`);
    expect(s).toContain("in place of §2.6's 222");
    // A cap above the hook's id gate mints ids the hook's peer census skips: the record must then say so, and only then.
    if (cap > hookId) expect(s).toContain('ids-over-128-invisible-to-the-hook-peer-census');
    else expect(s).not.toContain('ids-over-128-invisible-to-the-hook-peer-census');
  });

  it('names every file the name census left out', () => {
    const files = censusExcluded();
    expect(files, '`CENSUS_EXCLUDED` not found in ccd-id-cap.test.ts').not.toBeNull();
    if (files!.length === 0) expect(s).toContain('The census left no file out.');
    for (const f of files!) expect(s, f).toContain(`\`${f}\``);
  });

  it('states the corrections to §2.4, §2.6 and §2.8, and the precedence the reap lock keeps', () => {
    for (const phrase of [
      'holds everywhere except at stop and ws-add',
      "`stop --surface pwa --surface` is refused by the loop's arity check, not by the post-loop id check",
      'bounded holds for the `--actor` and `--reason` decision fields only',
      '`enable <wrapper> <project>` checks its project with `_ws_project_valid` before it journals anything',
      'a live row of any kind still answers `registered` ahead of `witness-mismatch`',
      'ahead of the cleanup pause',
      '`ccdargv-dash-id-parity.test.ts`',
      'measured by that matrix, run once against the pre-wave binary',
      'one pin per mint site at `_REG_ID_MAX` and at one byte more',
    ]) expect(s, phrase).toContain(phrase);
    expect(s).not.toMatch(DEVIATION_TOKEN);
    expect(s).not.toMatch(FOUR_DIGIT_RANGE);
  });

  it('names every stated residual', () => {
    for (const r of residualsAtTheTip()) expect(s, r).toContain(`\`${r}\``);
  });

  it('marks items 24 to 31 of §7 built, and no other row', () => {
    for (let n = 24; n <= 31; n++) {
      expect(spec, `item ${n}`).toMatch(new RegExp(`^\\| ${n} \\|[^\\n]*\\| Built \\(W1b\\) \\|`, 'm'));
    }
    expect(spec.split('| Built (W1b) |').length - 1).toBe(8);
  });
});

describe('the programme’s rulings file carries the W1b as-built note (path-identity spec §2.9)', () => {
  const c = read(CONTRACT);
  const head = /^### §17 as built \(path-identity W1b, run \d+\)$/m.exec(c);
  const at = head ? head.index : -1;
  const next = at < 0 ? -1 : c.slice(at + 1).search(/\n#{2,3} /);
  const note = at < 0 ? '' : flat(c.slice(at, next < 0 ? c.length : at + 1 + next));

  it('stands in §17, after R98', () => {
    expect(at, 'the as-built note is missing, or its heading names no run number').toBeGreaterThan(-1);
    const r98 = c.indexOf('- **R98 — corrections.**');
    expect(r98, 'R98 is missing').toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(r98);
    const s18 = c.search(/^## 18\. /m);
    if (s18 > -1) expect(at).toBeLessThan(s18);
  });

  it('names every departure and residual by slug, and no number', () => {
    for (const slug of [...DEPARTURES, ...residualsAtTheTip()]) expect(note, slug).toContain(`\`${slug}\``);
    expect(note).not.toMatch(DEVIATION_TOKEN);
    expect(note).not.toMatch(FOUR_DIGIT_RANGE);
  });

  it('lists what each task found while building, by slug', () => {
    for (const slug of FOUND_WHILE_BUILDING) expect(note, slug).toContain(`\`${slug}\``);
    expect(note).not.toContain('No task recorded a departure beyond those above.');
  });
});
