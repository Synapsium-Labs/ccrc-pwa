// Path identity W3: what the spec and the programme's rulings file record about the wave as built (path-identity
// spec §4.12 and §7). What the records state is read from the code here, never restated:
// - the entry field's grammar, its cap and its reader's words, from `_ws_workdirid_read`;
// - the walk's bound, the cwd probe's bound and the collect audit's sum, from ccd's knobs and the runner's row;
// - the cwd probe's skip rule, physical resolve and Darwin arm, from `_ws_cwd_users`;
// - the refusals by identity, from the ladder, `_ws_reclaim_owned` and `_ws_reclaim_record`;
// - the remedies and the `unproc` clause, from the rows rung; the re-ask's sites and order, from the tail;
// - the refusal's sentence, from `SENTENCES` in `server/src/wsaudit.ts`.
// So a later change to any of them reds this suite until the record is corrected with it. The carries, and the two
// departures that exist only if the code lacks what they name, are decided from the code too. W1b's and W2's records
// belong to their own prose suites: this file reads §4.12 alone, counts only its own cells, and re-counts theirs
// unchanged.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SENTENCES } from '../src/wsaudit.js';

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
const HEADING = '\n### 4.12 As built (W3)\n';
const NEXT = '\n## 5. The collector switch in Settings\n';
const LAST_ROW_OF_4_11 = "\n  - A record that names the child's directory only through another spelling answers rc 1 or 2 at the "
  + 'ladder, never a hit.\n';

/** §4.12 alone, from its heading to the next `## ` heading; '' when the heading is missing. */
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

/** The prose of ccd's collector header, from its banner to its first state variable, `#` marks folded away; '' when
 *  either anchor is gone. */
function collectorHeader(ccd: string): string {
  const at = ccd.indexOf('\n# ── ws-audit --collect: ');
  const end = at < 0 ? -1 : ccd.indexOf("\n_WS_COLLECT_PROBE=''", at + 1);
  if (end < 0) return '';
  return flat(ccd.slice(at, end).split('\n').filter((l) => l.startsWith('#')).map((l) => l.replace(/^#\s?/, '')).join(' '));
}

/** The one integer that `re` (a `g` regex with one group) captures in `text`; throws on zero matches or on two. */
function one(text: string, re: RegExp, what: string): number {
  const hits = [...text.matchAll(re)];
  if (hits.length !== 1) throw new Error(`${what}: ${hits.length} matches; exactly one is expected`);
  return Number(hits[0]![1]!.replace(/_/g, ''));
}

interface Budget {
  readonly walkS: number; readonly cwdS: number; readonly highS: number; readonly rowS: number; readonly sentence: string;
}

/** The collect audit's sum, read as `collect-audit-budget.test.ts` reads it: the idle walk, the in-use probe, the
 *  checkout scan and the rows rung's identity walk, plus ONE `_plat_timeout` grace, against ws-audit's runner row. */
function budget(ccd: string): Budget {
  const idle = one(ccd, /^WS_COLLECT_IDLE_SCAN_S=(\d+)\b/gm, 'WS_COLLECT_IDLE_SCAN_S');
  const users = one(ccd, /^WS_PATH_USERS_SCAN_S=(\d+)\b/gm, 'WS_PATH_USERS_SCAN_S');
  const scan = one(ccd, /^REAP_SCAN_SECONDS=(\d+)\b/gm, 'REAP_SCAN_SECONDS');
  const walkS = one(ccd, /^WS_RECLAIM_WALK_S=(\d+)\b/gm, 'WS_RECLAIM_WALK_S');
  const cwdS = one(ccd, /^WS_CWD_USERS_SCAN_S=(\d+)\b/gm, 'WS_CWD_USERS_SCAN_S');
  const grace = one(ccd, /grace="\$\{CCD_TIMEOUT_KILL_AFTER:-(\d+)\}"/g, "_plat_timeout's default grace");
  const graceMax = one(ccd, /\[ "\$grace" -gt (\d+) \] && grace=\1\b/g, "_plat_timeout's grace ceiling");
  const rowS = one(read('server/src/remote/runner.ts'), /^[ \t]*'ws-audit':[ \t]*([\d_]+),/gm,
    "CCD_VERB_TIMEOUT_MS['ws-audit']") / 1000;
  const probes = idle + users + scan + walkS;
  return {
    walkS, cwdS, highS: probes + graceMax, rowS,
    sentence: `about ${probes + grace} s, or ${probes + graceMax} s at the widest grace, against ws-audit's ${rowS} s runner row`,
  };
}

/** R49's branch, read from ccd's collector header: the rows rung's git reads stand unbounded. */
const gitReadsStand = (ccd: string): boolean =>
  collectorHeader(ccd).includes("The row pass's git reads of a gone row's repository have no bound of their own");

const q = (w: string): string => `\`${w}\``;
const count = (text: string, cell: string): number => text.split(cell).length - 1;
const COUNT_WORD: Readonly<Record<number, string>> = { 1: 'one', 2: 'two', 3: 'three', 4: 'four' };
/** Every `R<n>` a text cites, once each. */
const ruleNumbers = (t: string): string[] => [...new Set([...t.matchAll(/\bR(\d+)\b/g)].map((m) => `R${m[1]}`))];

/** The entry field reader's words (no overloaded answer). */
const STATES = ['valid', 'pending', 'legacy-absent', 'legacy-stale', 'legacy-unparseable', 'legacy-link', 'unmeasured'] as const;

/** This wave's new ccd test files. Each one CLAUDE.md lists as a load flake is named in §4.12. */
const W3_FILES = ['ccd-worktree-identity-fence', 'ccd-reclaim-idwalk', 'ccd-rows-rung-identity', 'ccd-workdirid',
  'ccd-workdirid-spawn', 'ccd-rows-rung-entry', 'ccd-reclaim-moved-identity', 'ccd-reclaim-main-identity',
  'ccd-cwd-users', 'ccd-reclaim-tail-cwd', 'ccd-reclaim-tail-window', 'ccd-worktree-identity-wordings'] as const;

/** §7 rows this wave leaves to the programme's closing records, with the Status each keeps. */
const UNTOUCHED: ReadonlyArray<readonly [number, string]> = [[10, 'Proposed'], [13, 'Proposed'], [15, 'Proposed'],
  [21, 'Proposed'], [37, 'Deferred'], [39, 'Proposed'], [41, 'Ruled in principle']];

/** The contract rules each record may cite. Plan rulings share the `R<n>` spelling, so any other number is one. */
const SPEC_RULES = ['R31', 'R54', 'R94', 'R97'];
const NOTE_RULES = ['R31', 'R54', 'R56', 'R83', 'R89', 'R93', 'R94', 'R95', 'R97'];

/** The substantive departures this wave made, by slug. */
const DEPARTURES = ['workdirid-pending-form', 'workdirid-unreadable-holds', 'rows-walk-second-mountinfo-reader',
  'unproc-also-by-walked-position', 'ladder-main-checkout-ef', 'record-main-hit-keeps-the-terminal-refusal',
  'record-by-another-spelling-reads-unmeasured', 'record-two-spellings-reads-unmeasured', 'reappeared-tree-refuses',
  'cwd-wait-only-waits',
  'cwd-refusal-reuses-worktree-remove-failed', 'reask-words-follow-the-owned-call', 'cwd-probe-adopts-the-path-users-walk',
  'darwin-prefixes-take-the-identity-shims', 'w2-mount-asks-shadowed-by-the-reask', 'collect-reprove-table-moves-to-the-gap',
  'audit-document-key-pins-outside-the-boundary', 'double-slash-rows-placed-by-identity-pins-move',
  'moved-check-identity-failure-preempted-a-proof', 'cwd-probe-holds-a-double-slash-physical-root',
  'cwd-probe-confirms-a-vanished-link-by-a-second-read', 'cwd-probe-read-once-more-answers-eacces-for-a-reaped-pid',
  'r77-cases-time-their-race-through-a-python3-shim'];

/** The residuals that stand whatever the code says next. */
const BASE_RESIDUALS = ['reg-purge-inventory-omits-workdirid', 'legacy-row-count-has-no-doctor-line',
  'human-gated-removals-ask-no-cwd', 'cwd-probe-sees-no-open-fds', 'cwd-probe-sees-a-session-only-while-it-runs',
  'surviving-background-job-holds-the-reclaim', 'reask-identity-is-per-attempt', 'reask-to-opendir-window',
  'tail-reasks-can-outrun-the-act-row', 'identity-found-after-the-kill-repeats', 'worktree-ask-to-force-window',
  'git-mount-crossing-unmeasured', 'exdev-class-moot-under-pi5-a', 'repointed-alias-for-legacy-rows-until-respawn',
  'other-mount-namespaces-fuse-views-and-overlay', 'ancestry-stands-alone-on-darwin',
  'moved-check-misses-a-subdirectory-of-a-moved-tree', 'workdirid-temp-leaks-on-sigkill',
  'cwd-probe-can-wait-on-a-hung-network-cwd', 'workdirid-pending-unwritable-keeps-the-old-field',
  'failed-pending-write-reads-legacy', 'workdirid-fifo-swap-after-type-check', 'darwin-cwd-parse-unbounded-as-today',
  'fish-spawn-cd-reads-backslash-escapes', 'workdirid-physical-control-byte-stays-pending',
  'relative-workdir-second-cd-does-not-enter', 'human-gated-removals-ask-no-mounts', 'vanished-checkout-arms-ask-no-mounts',
  'record-ef-has-no-deadline', 'cwd-probe-pure-bash-watcher-sleep-reads-as-a-user', 'cwd-probe-per-thread-cwd-unasked',
  'cwd-probe-pid-handoff-between-reads', 'cwd-probe-task-listing-can-skip-a-tid', 'cwd-ask-to-opendir-window',
  'record-ef-unstattable-stanza-reads-as-another-tree', 'entry-field-identity-does-not-survive-a-device-renumbering',
  'gone-row-with-pending-field-holds-despite-its-release-arms'];

/** §7 items 1 to 3 and 5 to 8, by slug: closed whatever the code says next. Item 4, `owned-to-worktree-remove-window`,
 *  is narrowed, not closed (its row: "closing is a later wave"), so `carriesAtTheTip` decides it from the re-asks. */
const CLOSED_CARRIES = ['r31-repointed-alias-resolves-complete', 'r31-bind-mount-spelling-resolves-complete',
  'r54-recorded-basis-dev-ino-ancestry', 'proc-symlink-row-places-at-ccds-cwd',
  'unres-false-detail-for-row-that-is-the-child', 'double-slash-remedy-wordings', 'owned-main-checkout-ambient-realpath'];

/** What each task found while building, by slug. The rulings file's "Found while building" list names every one.
 *  Filled at Step 1 from the ledger (Step 0's (e30)). */
const FOUND_WHILE_BUILDING: readonly string[] = [
  'growth-check-armed-reds-w3s-ccd-growth', 'fixture-volume-at-the-ws-add-disk-floor',
  'gate-chunk-8-outruns-the-foreground-bound',
];

/** Two departures exist only if the code lacks what they name: the expire document's count (R45) and the ws-add
 *  seed (R5). */
function conditionalDepartures(ccd: string): string[] {
  const out: string[] = [];
  if (!/"legacyRows":/.test(shFunction(ccd, '_ws_expire_audit_contained'))) out.push('legacy-count-expire-half-fenced');
  if (!codeLines(shFunction(ccd, 'cmd_ws_add')).some((l) => l.includes('_plat_workdirid_pane "$REG" "$id" "$wt"'))) {
    out.push('ws-add-seed-subsumed-by-spawn-pending');
  }
  return out;
}
const departuresAtTheTip = (ccd: string): string[] => [...DEPARTURES, ...conditionalDepartures(ccd)];

/** The carries whose state the code decides. A carry is closed or narrowed only while the code shows what closes or
 *  narrows it; otherwise it is a residual. */
function carriesAtTheTip(ccd: string): { residuals: string[]; closed: string[]; narrowed: string[] } {
  const residuals = [...BASE_RESIDUALS];
  const closed = [...CLOSED_CARRIES];
  const narrowed: string[] = [];
  const rung = codeLines(shFunction(ccd, '_ws_reclaim_workdir_shared')).join('\n');
  const tail = codeLines(shFunction(ccd, '_ws_reclaim_tail'));
  const mountHold = /\b_ws_collect_mountinfo\b/.test(rung);
  const reasks = tail.filter((l) => /\b_ws_reclaim_reask "\$id"/.test(l)).length;
  const ownedAtStart = tail.some((l) => l.includes('_ws_reclaim_owned "$id" "$workdir" "$main"; orc=$?'));
  (mountHold && ownedAtStart && reasks === 4 ? closed : residuals).push('no-whole-child-mount-ask-before-step-3');
  (mountHold ? narrowed : residuals).push('audit-normalise-has-no-mount-ask');
  if (reasks === 4) narrowed.push('worktree-ask-to-force-window');
  (reasks === 4 ? narrowed : residuals).push('owned-to-worktree-remove-window');
  if (gitReadsStand(ccd)) {
    residuals.push('rows-rung-git-reads-unbounded');
    narrowed.push('registry-row-pass-carries-no-bound');
  } else closed.push('registry-row-pass-carries-no-bound');
  (shFunction(ccd, '_ws_cwd_users') !== '' ? narrowed : residuals).push('in-use-probe-misses-another-mount');
  return { residuals, closed, narrowed };
}

describe('the path-identity spec records W3 as built (path-identity spec §4.12, §7)', () => {
  const spec = read(SPEC);
  const raw = asBuilt();
  const s = flat(raw);
  const ccd = read(CCD);

  it("§4.12 stands after §4.11's last row, and directly above §5", () => {
    const p411 = spec.indexOf('\n### 4.11 Proof\n');
    const last = p411 < 0 ? -1 : spec.indexOf(LAST_ROW_OF_4_11, p411);
    const p412 = spec.indexOf(HEADING);
    const p5 = spec.indexOf(NEXT);
    expect(p411, '§4.11 is missing').toBeGreaterThan(-1);
    expect(last, "§4.11's last row is missing").toBeGreaterThan(p411);
    expect(p412, "§4.12 is missing, or stands above §4.11's last row").toBeGreaterThan(last);
    expect(p5, '§5 must follow §4.12').toBeGreaterThan(p412);
    expect(spec).toContain(`${LAST_ROW_OF_4_11}${HEADING}`);
    expect(spec.slice(p5 - 2, p5 + 1), 'one blank line above §5').toMatch(/^[^\n]\n\n$/);
  });

  it("states the field grammar its one reader holds, the reader's cap and its seven words", () => {
    const reader = codeLines(shFunction(ccd, '_ws_workdirid_read')).join('\n');
    expect(reader, '`_ws_workdirid_read` not found in ccd/ccd').not.toBe('');
    expect(reader, 'the reader holds no 13-digit time').toContain('{13}');
    expect(reader, 'the reader holds no pending form').toMatch(/\bpending\b/);
    const n = /\bhead -c ?(\d+)/.exec(reader);
    expect(n, 'the reader reads no bounded count (head -c)').not.toBeNull();
    const cap = Number(n![1]) - 1;
    for (const w of STATES) {
      expect(reader, `the reader never answers ${w}`).toMatch(new RegExp(`(?<![A-Za-z0-9-])${w}(?![A-Za-z0-9-])`));
    }
    const field = block(raw, '**The entry field');
    expect(field, 'the entry-field block is missing').not.toBe('');
    expect(field).toContain('`v1<TAB><dev>:<ino>:<btime or -><TAB><at_ms><TAB><physical pwd -P><TAB><logical spelling>`');
    expect(field).toContain('`v1<TAB>pending<TAB><at_ms><TAB>-<TAB><logical>`');
    expect(field).toContain(`A body over ${cap} bytes is unparseable`);
    for (const w of STATES) expect(field, w).toContain(q(w));
  });

  it("states the walk's bound and the collect audit's sum, from ccd's knobs and the runner's row", () => {
    const b = budget(ccd);
    expect(b.highS, 'the sum at the widest grace no longer fits the row').toBeLessThan(b.rowS);
    expect(collectorHeader(ccd), "ccd's collector header states another sum").toContain(b.sentence);
    expect(s).toContain(`\`WS_RECLAIM_WALK_S\` (${b.walkS} s)`);
    expect(s).toContain(b.sentence);
  });

  it("states the cwd probe's bound, skip rule, physical resolve and Darwin arm, each as the code has it", () => {
    const probe = shFunction(ccd, '_ws_cwd_users');
    const code = codeLines(probe).join('\n');
    expect(code, '`_ws_cwd_users` not found in ccd/ccd').not.toBe('');
    expect(code, 'the probe resolves no parent').toMatch(/\b_ws_dir_physical\b/);
    expect(code, 'the probe has no Darwin arm').toMatch(/\b_ws_expire_lsof\b/);
    expect(code, 'the probe names no bound of its own').toMatch(/\bWS_CWD_USERS_SCAN_S\b/);
    for (const e of ['ENOENT', 'ESRCH', 'EACCES']) expect(probe, `the probe has no ${e} rule`).toContain(e);
    expect(codeLines(shFunction(ccd, '_ws_expire_cwd_users')).some((l) => /\b_ws_cwd_users\b/.test(l)),
      'ws-expire does not ask the shared probe').toBe(true);
    expect(s).toContain(`\`WS_CWD_USERS_SCAN_S\` (${budget(ccd).cwdS} s)`);
    expect(s).toContain("skips a process only on ENOENT or ESRCH of that process's own cwd link or stat file, or on the "
      + 'ruled EACCES exception');
    expect(s).toContain(q('_ws_dir_physical'));
    expect(s).toContain(q('_ws_expire_lsof'));
  });

  it('names the refusals by identity at the ladder, at owned and in the record reader, as the code makes them', () => {
    const ladder = codeLines(shFunction(ccd, '_ws_reclaim_ladder'));
    expect(ladder.filter((l) => l.includes('-ef "$main"')), "the ladder's main-checkout compare has no -ef").toHaveLength(1);
    const owned = shFunction(ccd, '_ws_reclaim_owned');
    expect(codeLines(owned).some((l) => l.includes('_ws_path_ident "$main" follow')), 'owned measures no main checkout').toBe(true);
    expect(owned, "owned's refusal is not the other-spelling why").toContain('under another spelling');
    const rec = codeLines(shFunction(ccd, '_ws_reclaim_record'));
    expect(rec.some((l) => /\s-ef\s/.test(l)), 'the record reader compares no identity').toBe(true);
    expect(rec.join('\n'), "the record reader's two-records why is gone").toContain('worktree records name the tree at');
    for (const p of [q('ladder-main-checkout-ef'), 'under another spelling', q('RECLAIM_REC_MAIN'),
      'Identity never makes a hit', q('_WS_REC_WHY')]) expect(s, p).toContain(p);
  });

  it("quotes the restore remedies and the unproc clause, and the rows rung's code says re-point nowhere", () => {
    const rung = codeLines(shFunction(ccd, '_ws_reclaim_workdir_shared')).join('\n');
    expect(rung, '`_ws_reclaim_workdir_shared` not found in ccd/ccd').not.toBe('');
    expect(rung).not.toContain('re-point');
    expect(rung).toContain('restore the link whose target opens with //');
    expect(rung).toContain('never replace a link to clear this');
    expect(rung).toContain('under /proc, or one reached through a link into /proc');
    const words = block(raw, '**The wordings');
    expect(words, 'the wordings block is missing').not.toBe('');
    expect(words).toContain('restore the link whose target opens with // to its original target, or stop the session and '
      + 'purge its row; never replace a link to clear this');
    expect(words).toContain('under /proc, or one reached through a link into /proc');
    expect(s).not.toContain('re-point the link');
  });

  it("states the new clause of the worktree-remove-failed sentence, as the server spells it", () => {
    expect(SENTENCES['worktree-remove-failed'] ?? '', "the server's sentence lost its clause")
      .toContain('or a process still works inside it');
    expect(s).toContain(q('worktree-remove-failed'));
    expect(s).toContain('or a process still works inside it');
  });

  it("states the re-ask at each of the tail's four sites, in the order the code asks", () => {
    const tail = codeLines(shFunction(ccd, '_ws_reclaim_tail'));
    expect(tail.length, '`_ws_reclaim_tail` not found in ccd/ccd').toBeGreaterThan(0);
    const seq = tail.map((l) => (/\b_ws_reclaim_reask "\$id"/.test(l) ? 'R'
      : /\b_ws_cwd_users "\$workdir"/.test(l) ? 'C'
        : /\b_ws_removal_mounts_clear "\$(?:cpath|workdir)"/.test(l) ? 'M' : '')).join('');
    const sites = (seq.match(/R/g) ?? []).length;
    expect(seq, 'each site asks the cwd probe, then the re-ask, then the mount question').toBe('CRM'.repeat(4));
    expect(s).toContain(q('_ws_reclaim_reask'));
    expect(s).toContain(`at each of the ${COUNT_WORD[sites] ?? String(sites)} sites`);
    expect(s).toContain("the cwd ask, then the re-ask, then W2's mount ask, then `keep_of` or the forced removal");
  });

  it("states the legacy count's keys, and the expire half and the ws-add seed as the code has them", () => {
    expect(shFunction(ccd, 'cmd_ws_audit'), 'the reclaim document carries no count').toContain('"legacyRows":%s,"pendingRows":%s,');
    expect(codeLines(shFunction(ccd, 'cmd_start')).some((l) => l.includes('_plat_workdirid_pane "$REG" "$id" "$workdir"')),
      'start writes no seed').toBe(true);
    for (const k of ['`"legacyRows"`', '`"pendingRows"`']) expect(s, k).toContain(k);
    const dep = conditionalDepartures(ccd);
    const expire = 'The expiry audit document carries the same two keys.';
    if (dep.includes('legacy-count-expire-half-fenced')) expect(s).not.toContain(expire);
    else expect(s).toContain(expire);
    const seed = 'ws-add appends the same statement to its `.workdir` line in place';
    if (dep.includes('ws-add-seed-subsumed-by-spawn-pending')) expect(s).not.toContain(seed);
    else expect(s).toContain(seed);
  });

  it("names every file of this wave that joined CLAUDE.md's load-flake list", () => {
    const md = read('CLAUDE.md');
    const at = md.indexOf('- **Known load flakes**');
    expect(at, "CLAUDE.md's load-flake bullet is missing").toBeGreaterThan(-1);
    const end = md.indexOf('\n- **', at + 1);
    const bullet = md.slice(at, end < 0 ? md.length : end);
    expect(s).toContain("CLAUDE.md's load-flake list");
    for (const f of W3_FILES) {
      if (new RegExp(`(?<![A-Za-z0-9-])${f}(?![A-Za-z0-9-])`).test(bullet)) expect(s, f).toContain(q(`${f}.test.ts`));
    }
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
    expect(counts).toContain('legacy rows');
    for (const cls of ['leaf ancestry', "the agent's mount namespace"]) expect(s.slice(to), cls).toContain(cls);
  });

  it('names every departure, residual and carry by slug, decided at the tip, and no number', () => {
    for (const d of departuresAtTheTip(ccd)) expect(s, d).toContain(q(d));
    const residuals = block(raw, '**Stated residuals');
    const carries = block(raw, '**Closed and narrowed carries');
    expect(residuals, 'the stated-residuals list is missing').not.toBe('');
    expect(carries, 'the carries list is missing').not.toBe('');
    const cut = carries.indexOf('- Narrowed, not closed:');
    expect(cut, 'the narrowed list is missing').toBeGreaterThan(-1);
    const closed = carries.slice(0, cut);
    const narrowed = carries.slice(cut);
    const k = carriesAtTheTip(ccd);
    for (const r of k.residuals) expect(residuals, r).toContain(q(r));
    for (const c of k.closed) {
      expect(closed, c).toContain(q(c));
      expect(residuals, `${c} is closed, so it is no residual`).not.toContain(q(c));
    }
    for (const n of k.narrowed) {
      expect(narrowed, n).toContain(q(n));
      expect(closed, `${n} is narrowed, not closed`).not.toContain(q(n));
    }
    expect(s).not.toMatch(DEVIATION_TOKEN);
    expect(s).not.toMatch(FOUR_DIGIT_RANGE);
    expect(s).not.toMatch(UNFILLED);
    expect(s, 'a task number').not.toMatch(/\bTask \d/);
    expect(ruleNumbers(s).filter((r) => !SPEC_RULES.includes(r)), 'a rule number the spec does not cite').toEqual([]);
  });

  it('every ccd name it cites exists in ccd/ccd', () => {
    const names = [...new Set([...s.matchAll(/`(_(?:ws|WS|lc|plat|spawn|reg)_[A-Za-z_]+)`/g)].map((m) => m[1]!))];
    expect(names.length, 'no ccd name read from §4.12').toBeGreaterThan(0);
    for (const n of names) expect(new RegExp(`(?<![A-Za-z0-9_])${n}(?![A-Za-z0-9_])`).test(ccd), n).toBe(true);
  });

  it('marks items 1 to 8 built in W3, item 9 with its git reads standing, and item 20 with its temp-root half standing', () => {
    for (let n = 1; n <= 8; n += 1) {
      expect(spec, `item ${n}`).toMatch(new RegExp(`^\\| ${n} \\|[^\\n]*\\| Built \\(W3\\) \\|`, 'm'));
    }
    const standing = gitReadsStand(ccd);
    const nine = standing ? 'Built \\(W3\\), git reads standing' : 'Built \\(W3\\)';
    expect(spec, 'item 9').toMatch(new RegExp(`^\\| 9 \\|[^\\n]*\\| ${nine} \\|`, 'm'));
    expect(spec, 'item 20').toMatch(/^\| 20 \|[^\n]*\| Built \(W3\), temp-root half standing \|/m);
    expect(count(spec, '| Built (W3) |')).toBe(standing ? 8 : 9);
    expect(count(spec, '| Built (W3), git reads standing |')).toBe(standing ? 1 : 0);
    expect(count(spec, '| Built (W3), temp-root half standing |')).toBe(1);
  });

  it("CONTROL: leaves every other wave's cells as they were", () => {
    expect(count(spec, '| Built (W2) |')).toBe(12);
    expect(count(spec, '| Built (child-reclamation wave 10) |')).toBe(2);
    expect(count(spec, '| Built (W1b) |')).toBe(8);
    for (const [n, cell] of UNTOUCHED) {
      expect(spec, `item ${n}`).toMatch(new RegExp(`^\\| ${n} \\|[^|\\n]*\\|[^|\\n]*\\|[^|\\n]*\\| ${cell} \\|`, 'm'));
    }
  });
});

describe('the programme’s rulings file carries the W3 as-built note (path-identity spec §4.12)', () => {
  const c = read(CONTRACT);
  const ccd = read(CCD);
  const head = /^### §17 as built \(path-identity W3, run \d+\)$/m.exec(c);
  const at = head ? head.index : -1;
  const next = at < 0 ? -1 : c.slice(at + 1).search(/\n#{2,3} /);
  const raw = at < 0 ? '' : c.slice(at, next < 0 ? c.length : at + 1 + next);
  const note = flat(raw);

  it('stands in §17, after the W2 note, and before any §18', () => {
    expect(at, 'the as-built note is missing, or its heading names no run number').toBeGreaterThan(-1);
    const w2 = c.search(/^### §17 as built \(path-identity W2, run \d+\)$/m);
    expect(w2, "W2's note is missing").toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(w2);
    const s18 = c.search(/^## 18\. /m);
    if (s18 > -1) expect(at).toBeLessThan(s18);
  });

  it("records R94 as built, naming R31's bullet by its own words, and R31 and R94 stand unedited", () => {
    expect(note).toContain('**R94 as built (process state may only refuse).**');
    expect(note).toContain('"Process state never grants deletion consent. A pane\'s cwd');
    expect(note).toContain('"Process state never grants deletion consent; it may only refuse"');
    const r31At = c.indexOf('\n- **R31 —');
    const r32At = c.indexOf('\n- **R32 —', r31At + 1);
    expect(r31At, 'R31 is missing').toBeGreaterThan(-1);
    expect(r32At, 'R32 must follow R31').toBeGreaterThan(r31At);
    expect(flat(c.slice(r31At, r32At))).toContain("Process state never grants deletion consent. A pane's cwd, or a modelled "
      + 'session that is up, gone or unaskable, is not an input.');
    expect(flat(c)).toContain('R31\'s last bullet now reads: "Process state never grants deletion consent; it may only refuse."');
  });

  it("records R93, R54, R97, R95's backstop and the collect audit's sum", () => {
    for (const lead of ["**R93 (the programme's shape).**", '**R54 as W3 leaves it (the identity moved-check).**',
      "**R97's reach, unchanged (PI9 K1).**", "**R95's asks, now a backstop (`w2-mount-asks-shadowed-by-the-reask`).**",
      "**The collect audit's budget.**"]) {
      expect(note, lead).toContain(lead);
    }
    const b = budget(ccd);
    expect(note).toContain(`\`WS_RECLAIM_WALK_S\` (${b.walkS} s)`);
    expect(note).toContain(b.sentence);
  });

  it('names every departure, residual and carry by slug, and no number but the contract’s own rules', () => {
    expect(raw, 'the as-built note is missing').not.toBe('');
    for (const d of departuresAtTheTip(ccd)) expect(note, d).toContain(q(d));
    const residuals = block(raw, '**Stated residuals');
    const carries = block(raw, '**Closed and narrowed carries');
    const cut = carries.indexOf('- Narrowed, not closed:');
    expect(cut, 'the narrowed list is missing').toBeGreaterThan(-1);
    const closed = carries.slice(0, cut);
    const narrowed = carries.slice(cut);
    const k = carriesAtTheTip(ccd);
    for (const r of k.residuals) expect(residuals, r).toContain(q(r));
    for (const x of k.closed) {
      expect(closed, x).toContain(q(x));
      expect(residuals, `${x} is closed, so it is no residual`).not.toContain(q(x));
    }
    for (const n of k.narrowed) {
      expect(narrowed, n).toContain(q(n));
      expect(closed, `${n} is narrowed, not closed`).not.toContain(q(n));
    }
    expect(note).not.toMatch(DEVIATION_TOKEN);
    expect(note).not.toMatch(FOUR_DIGIT_RANGE);
    expect(note).not.toMatch(UNFILLED);
    expect(ruleNumbers(note).filter((r) => !NOTE_RULES.includes(r)), 'a rule number that is not the contract’s own').toEqual([]);
  });

  it('lists what each task found while building, by slug', () => {
    const found = block(raw, '**Found while building');
    expect(found, 'the found-while-building list is missing').not.toBe('');
    for (const slug of FOUND_WHILE_BUILDING) expect(found, slug).toContain(q(slug));
  });
});
