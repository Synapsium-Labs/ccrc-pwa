// Path identity W2: what the spec and the programme's rulings file record about the wave as built (path-identity
// spec §3.10 and §7). What the records name is read from the code here, never restated:
// - the leaf words, from `shared/api.ts`'s table and the ccd lines that write them;
// - the mount helper `_ws_leaf_remove` calls, and its Darwin guard, from `ccd/ccd`;
// - the probe word's class, from `server/src/collectLane.ts`;
// - the found-nothing clause, from `childReclaimLeafFoundNothing`.
// So a later change to any of them reds this suite until the record is corrected with it. The four carries that close
// only once the code says so are decided from the code too. W1b's records belong to `path-identity-w1b-prose.test.ts`.
// This file reads §3.10 alone and counts only its own cells, so it never disturbs that suite's §2.9 slice or its count
// of eight `Built (W1b)` cells.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { childReclaimLeafFoundNothing } from '../src/childReclaimSweep.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f: string): string => readFileSync(path.join(root, f), 'utf8');
/** Flattened: the records wrap their sentences, so a phrase is matched across line breaks. */
const flat = (s: string): string => s.replace(/\s+/g, ' ');
const SPEC = 'docs/superpowers/specs/2026-10-12-path-identity-design.md';
const CONTRACT = 'docs/superpowers/programs/child-reclamation-contract.md';
const CCD = 'ccd/ccd';
const DEVIATION_TOKEN = /\bD-\d/;
const FOUR_DIGIT_RANGE = /[0-9]{4} ?(–|\.\.|-) ?[0-9]{4}/;
/** A slot the plan's draft left for a measured value, `<n:…>`. None may survive into a record. */
const UNFILLED = /<n:[^>]*>/;
const HEADING = '\n### 3.10 As built (W2)\n';

/** §3.10 alone, from its heading to the next `## ` heading; '' when the heading is missing. */
function asBuilt(): string {
  const s = read(SPEC);
  const at = s.indexOf(HEADING);
  if (at < 0) return '';
  const end = s.indexOf('\n## ', at + 1);
  return s.slice(at, end < 0 ? s.length : end);
}

/** TEXT from the line that starts with LEAD to the next line that starts with `**`, flattened; '' when LEAD is
 *  missing. The records' lists are bulleted, so only a bold lead starts a line with `**`. */
function block(text: string, lead: string): string {
  const at = text.indexOf(`\n${lead}`);
  if (at < 0) return '';
  const next = text.indexOf('\n**', at + 1);
  return flat(text.slice(at, next < 0 ? text.length : next));
}

/** A shell function's text, from `NAME() {` to the first line that is `}` alone; '' when there is none. */
function shFunction(src: string, name: string): string {
  const at = src.indexOf(`\n${name}() {`);
  if (at < 0) return '';
  const end = src.indexOf('\n}\n', at + 1);
  return end < 0 ? '' : src.slice(at + 1, end + 2);
}

/** A function's code. Its first line (the name and its header comment) is dropped, and so is every blank line and
 *  every whole-line `#` comment. Each remaining line's trailing ` #` comment is cut. */
function codeLines(fn: string): string[] {
  return fn.split('\n').slice(1).map((l) => l.split(' #')[0])
    .filter((l) => l.trim() !== '' && !l.trimStart().startsWith('#'));
}

/** The keys of `COLLECT_LEAF_END_TABLE`, in its order, read from `shared/api.ts` as text; [] when it is gone. */
function leafWords(): string[] {
  const m = /const COLLECT_LEAF_END_TABLE\b[^=]*=\s*\{([^}]*)\}/.exec(read('shared/api.ts'));
  return m ? [...m[1].matchAll(/([a-z][a-z-]*)\s*:\s*true\b/g)].map((x) => x[1]) : [];
}

/** `COLLECT_PROBE_CLASS_TABLE`'s body, read from `server/src/collectLane.ts` as text; '' when it is gone. */
function probeClassTable(): string {
  const s = read('server/src/collectLane.ts');
  const at = s.indexOf('const COLLECT_PROBE_CLASS_TABLE = {');
  if (at < 0) return '';
  const end = s.indexOf('} as const', at);
  return end < 0 ? '' : s.slice(at, end);
}

const q = (w: string): string => `\`${w}\``;
const andList = (xs: readonly string[]): string =>
  xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
const COUNT_WORD: Readonly<Record<number, string>> = { 1: 'one', 2: 'two', 3: 'three', 4: 'four' };

/** Which ccd function writes each leaf word on its collect `done` line. */
const LEAF_WRITERS = [['removed', '_ws_collect_finish'], ['absent', '_ws_collect_witness_only']] as const;

/** The server names §3.10 cites, each with the file that defines it. */
const SERVER_NAMES = [
  ['childReclaimLeafEndRead', 'server/src/childReclaimSweep.ts'],
  ['lifecycleLeafEndsFor', 'server/src/coord/store.ts'],
  ['COLLECT_LEAF_END_TABLE', 'shared/api.ts'],
  ['COLLECT_ASIDE_NAME_RE', 'server/src/collectLane.ts'],
  ['parseCollectAsideName', 'server/src/collectLane.ts'],
  ['isTmpRootId', 'shared/api.ts'],
  ['learnCollect', 'server/src/coord/collectTempRoot.ts'],
] as const;

/** The substantive departures this wave made, by slug. */
const DEPARTURES = ['drop-helper-reproves-the-absence', 'kept-witness-reason-in-the-row-not-on-stderr',
  'leaf-mount-ask-before-the-owner-bits', 'aside-joins-the-population', 'aside-probe-word',
  'aside-restore-by-link-not-rename', 'tail-aside-warns-without-keeping', 'present-null-leaf-reads-as-legacy'];

/** The residuals that stand whatever the code says next. */
const BASE_RESIDUALS = ['tail-drop-not-noreplace-without-mv-no-copy', 'stale-aside-beside-a-new-leaf-is-a-mismatch',
  'git-mount-crossing-unmeasured', 'audit-normalise-has-no-mount-ask', 'mount-found-after-the-kill-repeats',
  'human-gated-removals-ask-no-mounts', 'no-whole-child-mount-ask-before-step-3', 'vanished-checkout-arms-ask-no-mounts',
  'absent-clause-names-a-drop-the-compare-kept', 'found-nothing-clause-yields-to-a-collector-item',
  'found-nothing-clause-yields-to-a-reclaim-item',
  'non-object-meas-reads-as-keyless', 'ccrc-timeout-knob-strip-is-quadratic', 'rec-eq-f-recycled-admin',
  'device-test-cannot-see-a-same-device-bind-mount', 'permanent-device-change-holds-every-absence',
  'cc-tmp-deleted-whole-holds-its-witnesses', 'source-parent-without-owner-write-loops',
  'tmproot-probe-misses-the-whole-volume-spelling', 'registry-id-l0-comments-say-ccd-scans-the-session-value',
  'worktree-ask-to-force-window', 'drop-device-asked-once', 'truncated-docstring-predates-meas-leaf',
  'store-reclaim-to-prose-predates-the-heir-gate', 'read-small-second-read-can-fail', 'item36-window-68-to-78-unmeasured'];

/** The carries this wave closes whatever the code says next. */
const CLOSED_CARRIES = ['tail-drop-believes-an-absent-leaf', 'tail-drop-ignores-a-recordless-slot',
  'collector-learning-audit-relies-on-the-population-gate', 'session-shape-prose-predates-the-id-gate',
  'leaf-end-acts-spelled-twice', 'review-335-f9-needle-outgrows-the-cap-under-this-tmpdir'];

/** What each task found while building, by slug. The rulings file's "Found while building" list names every one. */
const FOUND_WHILE_BUILDING = ['read-small-partial-read-cleared', 'nul-why-leads-with-the-admin-path',
  'step-4-unresolvable-workdir-fails-before-keep-of', 'worktree-remove-failed-sentence-covers-a-mount',
  'aside-half-not-in-the-id-argv-census', 'prelock-resets-a-pre-peek-aside-answer',
  'aside-lister-mirrors-the-records-lister', 'aside-detail-texts-beyond-p11', 'resolve-reason-leads-with-the-path',
  'fuse-mount-skipped-not-crossed', 's3-later-rung-refuses-containment-unproven', 's6-applied-count-includes-moved-arm',
  't6-2-second-needle-on-two-lines', 'aside-settle-link-spy-reads-tmproots-only', 'satisfies-after-a-line-break-is-asi',
  'learn-gate-refusal-leaves-no-trace'];

/** The four carries that close only once the code says so: the two W1b carries, `_ws_collect_witness_cad`'s header
 *  (R41's slug) and the two test comments that said the learning audit asks no id predicate (R42's slug). Each is open
 *  while the code still shows it, and closed once it does not. W1b's `dotOnly` is copied here, never imported. */
function conditionalCarries(): { open: string[]; closed: string[] } {
  const open: string[] = [];
  const closed: string[] = [];
  const dotOnly = /`_ws_tmproot_id_ok`[\s\S]{0,80}?no leading[\s*]*`\.`(?![\s*]*(?:or|and)[\s*]+(?:a[\s*]+)?(?:leading[\s*]+)?`-`)/;
  (dotOnly.test(read('shared/api.ts')) || dotOnly.test(read('server/src/childReclaimSweep.ts')) ? open : closed)
    .push('server-docstrings-call-ccds-predicate-dot-only');
  const scans = /ccd's (?:destructive )?verbs read their decision flags from any[\s*/]+position/;
  (scans.test(read('shared/api.ts')) || scans.test(read('server/test/collect-l0.test.ts')) ? open : closed)
    .push('comments-say-ccd-scans-the-session-value');
  (/tail's plain unlink/.test(read(CCD)) ? open : closed).push('cad-header-calls-the-tail-drop-a-plain-unlink');
  const noLearnGate = /\(`learnCollect`, which[\s/]+asks no predicate of its own\)|with the record half below, the learning audit's only id check/;
  (noLearnGate.test(read('server/test/collect-id-pins.test.ts')) || noLearnGate.test(read('server/test/id-argv-census.test.ts')) ? open : closed)
    .push('learning-audit-gate-prose-in-two-test-comments');
  return { open, closed };
}
const residualsAtTheTip = (): string[] => [...BASE_RESIDUALS, ...conditionalCarries().open];
const closedAtTheTip = (): string[] => [...CLOSED_CARRIES, ...conditionalCarries().closed];

describe('the path-identity spec records W2 as built (path-identity spec §3.10, §7)', () => {
  const spec = read(SPEC);
  const raw = asBuilt();
  const s = flat(raw);
  const ccd = read(CCD);

  it('§3.10 stands after §3.9 and its closing note, and before §4', () => {
    const p39 = spec.indexOf('\n### 3.9 Proof\n');
    const note = p39 < 0 ? -1 : spec.indexOf('\n> [!NOTE]\n', p39);
    const p310 = spec.indexOf(HEADING);
    const p4 = spec.indexOf('\n## 4. Worktree path identity\n');
    expect(p39, '§3.9 is missing').toBeGreaterThan(-1);
    expect(note, "§3.9's closing note is missing").toBeGreaterThan(p39);
    expect(p310, "§3.10 is missing, or stands above §3.9's note").toBeGreaterThan(note);
    expect(p4, '§4 must follow §3.10').toBeGreaterThan(p310);
  });

  it('states the leaf words L0 declares, and the collect line each is written on', () => {
    const words = leafWords();
    expect(words.length, '`COLLECT_LEAF_END_TABLE` not found in shared/api.ts').toBeGreaterThan(0);
    expect([...words].sort()).toEqual(LEAF_WRITERS.map(([w]) => w).sort());
    expect(s).toContain(`\`meas.leaf\` takes ${COUNT_WORD[words.length] ?? String(words.length)} words, ${andList(words.map(q))}`);
    for (const [word, fn] of LEAF_WRITERS) {
      expect(shFunction(ccd, fn), `${fn} writes no \`meas.leaf ${word}\``).toMatch(new RegExp(`\\bmeas\\.leaf ${word}\\b`));
      expect(s).toContain(`${q(word)} on ${q(fn)}'s \`done\` line`);
    }
  });

  it('names the mount helper `_ws_leaf_remove` asks twice, and quotes its Darwin guard', () => {
    const leafCode = codeLines(shFunction(ccd, '_ws_leaf_remove'));
    expect(leafCode.length, '`_ws_leaf_remove` not found in ccd/ccd').toBeGreaterThan(0);
    const asked = [...new Set(leafCode.flatMap((l) => [...l.matchAll(/\b(_ws_[a-z_]*mounts_clear)\b/g)].map((m) => m[1])))];
    expect(asked).toEqual(['_ws_removal_mounts_clear']);
    expect(leafCode.filter((l) => /\b_ws_removal_mounts_clear\b/.test(l))).toHaveLength(2);
    const guard = (codeLines(shFunction(ccd, '_ws_removal_mounts_clear'))[0] ?? '').trim();
    expect(guard, "the helper's first line of code is not its Darwin guard").toMatch(/\bCCD_OS\b.*\bdarwin\b/);
    expect(s).toContain(q('_ws_removal_mounts_clear'));
    expect(s).toContain(q(guard));
  });

  it('names the probe word `aside`, which the lane classes per-leaf', () => {
    expect(probeClassTable(), '`aside` is not classed per-leaf in collectLane.ts').toMatch(/(?:^|[\s,{])aside:\s*'per-leaf'/);
    expect(s).toContain('the probe word `aside`, which the lane classes `per-leaf`');
  });

  it('quotes the clause a found-nothing line carries, as the server composes it', () => {
    expect(s).toContain(childReclaimLeafFoundNothing('<id>'));
  });

  it('carries the entry counts as numbers only, and names what was judged instead', () => {
    const lead = 'Measured on the fleet box before the first edit, counts only:';
    const judged = 'Not measured, and judged instead:';
    const at = s.indexOf(lead);
    const to = s.indexOf(judged, at + 1);
    expect(at, 'the entry-counts bullet is missing').toBeGreaterThan(-1);
    expect(to, 'the judged bullet must follow the counts').toBeGreaterThan(at);
    const counts = s.slice(at + lead.length, to);
    expect(counts).toMatch(/\d/);
    for (const bad of ['/', '~', 'demo-']) expect(counts, bad).not.toContain(bad);
    expect(counts).not.toMatch(UNFILLED);
    for (const cls of ['an inner-NUL back-link', 'an unresolvable standing workdir',
      'cut keyless collect rows beyond the recorded count']) expect(s.slice(to), cls).toContain(cls);
  });

  it('names every departure, residual and closed carry by slug', () => {
    for (const d of DEPARTURES) expect(s, d).toContain(q(d));
    const residuals = block(raw, '**Stated residuals');
    const closed = block(raw, '**Closed carries');
    expect(residuals, 'the stated-residuals list is missing').not.toBe('');
    expect(closed, 'the closed-carries list is missing').not.toBe('');
    for (const r of residualsAtTheTip()) expect(residuals, r).toContain(q(r));
    for (const c of closedAtTheTip()) {
      expect(closed, c).toContain(q(c));
      expect(residuals, `${c} is closed, so it is no residual`).not.toContain(q(c));
    }
    expect(s).not.toMatch(DEVIATION_TOKEN);
    expect(s).not.toMatch(FOUR_DIGIT_RANGE);
    expect(s).not.toMatch(UNFILLED);
  });

  it('every ccd name it cites exists in ccd/ccd, and every server name in its file', () => {
    const names = [...new Set([...s.matchAll(/`(_(?:ws|WS|lc)_[A-Za-z_]+)`/g)].map((m) => m[1]))];
    expect(names.length, 'no ccd name read from §3.10').toBeGreaterThan(0);
    for (const n of names) expect(new RegExp(`(?<![A-Za-z0-9_])${n}(?![A-Za-z0-9_])`).test(ccd), n).toBe(true);
    for (const [name, file] of SERVER_NAMES) {
      expect(s, name).toContain(q(name));
      expect(read(file), `${name} in ${file}`).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it('marks items 11, 12, 14, 16 to 19 and 32 to 36 built in W2, and items 38 and 40 built by child-reclamation wave 10', () => {
    const w2 = [11, 12, 14, 16, 17, 18, 19, 32, 33, 34, 35, 36];
    for (const n of w2) expect(spec, `item ${n}`).toMatch(new RegExp(`^\\| ${n} \\|[^\\n]*\\| Built \\(W2\\) \\|`, 'm'));
    for (const n of [38, 40]) {
      expect(spec, `item ${n}`).toMatch(new RegExp(`^\\| ${n} \\|[^\\n]*\\| Built \\(child-reclamation wave 10\\) \\|`, 'm'));
    }
    expect(spec.split('| Built (W2) |').length - 1).toBe(w2.length);
    expect(spec.split('| Built (child-reclamation wave 10) |').length - 1).toBe(2);
  });
});

describe('the programme’s rulings file carries the W2 as-built note (path-identity spec §3.10)', () => {
  const c = read(CONTRACT);
  const head = /^### §17 as built \(path-identity W2, run \d+\)$/m.exec(c);
  const at = head ? head.index : -1;
  const next = at < 0 ? -1 : c.slice(at + 1).search(/\n#{2,3} /);
  const raw = at < 0 ? '' : c.slice(at, next < 0 ? c.length : at + 1 + next);
  const note = flat(raw);

  it('stands in §17, after the W1b note, and before any §18', () => {
    expect(at, 'the as-built note is missing, or its heading names no run number').toBeGreaterThan(-1);
    const w1b = c.search(/^### §17 as built \(path-identity W1b, run \d+\)$/m);
    expect(w1b, "W1b's note is missing").toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(w1b);
    const s18 = c.search(/^## 18\. /m);
    if (s18 > -1) expect(at).toBeLessThan(s18);
  });

  it('records R93, R95, R89 and R83 as the wave left them', () => {
    for (const lead of ["**R93 (the programme's shape).**", '**R95 as built (the mount question).**',
      "**R89's kept-leaf residual, cured.**", '**R83 changed (`aside-joins-the-population`).**']) {
      expect(note, lead).toContain(lead);
    }
  });

  it('the note names every departure, residual and closed carry by slug, and no number', () => {
    for (const d of DEPARTURES) expect(note, d).toContain(q(d));
    const residuals = block(raw, '**Stated residuals');
    const closed = block(raw, '**Closed carries');
    for (const r of residualsAtTheTip()) expect(residuals, r).toContain(q(r));
    for (const k of closedAtTheTip()) {
      expect(closed, k).toContain(q(k));
      expect(residuals, `${k} is closed, so it is no residual`).not.toContain(q(k));
    }
    expect(note).not.toMatch(DEVIATION_TOKEN);
    expect(note).not.toMatch(FOUR_DIGIT_RANGE);
    expect(note).not.toMatch(UNFILLED);
  });

  it('lists what each task found while building, by slug', () => {
    const found = block(raw, '**Found while building');
    expect(found, 'the found-while-building list is missing').not.toBe('');
    for (const slug of FOUND_WHILE_BUILDING) expect(found, slug).toContain(q(slug));
  });
});
