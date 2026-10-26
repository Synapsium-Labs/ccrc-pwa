// Single-definition scanners, one area of the guard that used to be one file (see ./helpers.ts for the doctrine and the shared walkers).
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { SWITCHES } from '../../../shared/switches.js';
import { ALL, ALL_MJS, BASH, HISTORY_DIR, HISTORY_MJS, bashRoots, ccrcRoot, codeLines, here, holdersOf, isBashComment, mjsUnder, prose, rel, stallCode } from './helpers.js';


// SESSION-CONTINUITY WAVE 4 (spec §5.6, the coordinator's safety ruling). APPENDED, for the reason the stall-watch
// blocks above state: `session-hook.test.ts`'s citation audit cites this file by line.
describe('the pane-scope sweep: its arming file has no writer in the tree', () => {
  // `scope-sweep-live` arms `ccd-scope-sweep`'s stop: without it every inert scope is only recorded `would-stop`.
  // Like `stall-watch-live` the operator touches and removes it by hand, so the ONE line of shell that may name
  // it is the sweep's own read, no TypeScript names it at all, and no other file under ccd/ or deploy/ does on a
  // code line. KNOWN WIDTH: a name assembled from pieces is not seen; the bar is the ordinary copy.
  it('scope-sweep-live: one shell holder, ccd/ccd-scope-sweep, whose one line is a read; no TS holder', () => {
    expect(holdersOf('scope-sweep-live'), 'a line of shell other than the sweep names it — a writer in waiting').toEqual(['ccd/ccd-scope-sweep']);
    expect(codeLines(path.join(ccrcRoot, 'ccd', 'ccd-scope-sweep')).filter((l) => l.includes('scope-sweep-live')))
      .toEqual(['[ -e "$REG/scope-sweep-live" ] && MODE=live']);
    expect(ALL.filter((f) => stallCode(f).includes('scope-sweep-live')).map(rel)).toEqual([]);
  });

  // A writer need not be shell: every OTHER file under ccd/ and deploy/ — Python, .mjs, a unit file's
  // `ExecStartPre=` — is read on its non-comment lines too (`#`, `//`, `*` and `/*` lines dropped; Markdown,
  // which is prose, skipped).
  const nonShell = (dir: string): string[] => readdirSync(dir).flatMap((e) => {
    const p = path.join(dir, e);
    return statSync(p).isDirectory() ? nonShell(p) : (BASH.includes(p) || p.endsWith('.md') ? [] : [p]);
  });
  it('scope-sweep-live: no other file under ccd/ or deploy/ names it on a code line — no Python, .mjs or unit-file writer', () => {
    const others = bashRoots.flatMap(nonShell);
    expect(others.length, 'the walk reached the non-shell files').toBeGreaterThan(40);
    expect(others.filter((f) => readFileSync(f, 'utf8').split('\n')
      .some((l) => !/^\s*(#|\/\/|\*|\/\*)/.test(l) && l.includes('scope-sweep-live'))).map(rel)).toEqual([]);
  });
});


// DISK RETENTION DR-20 (D-6632). APPENDED for the reason the stall-watch blocks above state. `nested-rescue-live` arms the
// nested-repository rescue; the operator touches it by hand, so the ONE shell line that names it is ccd/ccd's read and nothing
// else under ccd/ or deploy/ names it on a code line.
describe('the nested rescue: its arming file has no writer in the tree', () => {
  // DR-21 (D-6633) gives it its one TS holder, its switchboard row in `shared/switches.ts` (L0, no `node:` module, so it
  // cannot write the marker); the server only shows what the arm would do.
  it('nested-rescue-live: one shell holder, ccd/ccd, whose one line is a read; one TS holder, its definer, which reaches no write', () => {
    expect(holdersOf('nested-rescue-live'), 'a line of shell other than ccd/ccd names it — a writer in waiting').toEqual(['ccd/ccd']);
    expect(codeLines(BASH.find((f) => rel(f) === 'ccd/ccd') ?? '').filter((l) => l.includes('nested-rescue-live')))
      .toEqual(['_ws_nested_rescue_live() { [[ -e "$REG/nested-rescue-live" ]]; }']);
    expect(ALL.filter((f) => stallCode(f).includes('nested-rescue-live')).map(rel), 'spelled on a code line outside shared/switches.ts')
      .toEqual(['shared/switches.ts']);
    expect(stallCode(path.join(ccrcRoot, 'shared/switches.ts')), 'shared/switches.ts reaches a node: module or require, so it could write the marker')
      .not.toMatch(/from\s+['"]node:|import\s*\(\s*['"]node:|\brequire\s*\(/);
    // THE WIDER WRITER: a file that imports the constant and holds an io could write it without spelling the name.
    const WRITE = /\b(?:writeFile|appendFile|rename|symlink|copyFile|mkdir|truncate|unlink|rm)(?:Sync)?\s*\(|\.write\w*\s*\(/;
    expect(WRITE.test('await deps.io.writeFile(`${dir}/${m}`, "");'), 'CONTROL: the pattern sees a write').toBe(true);
    for (const f of ALL.filter((x) => stallCode(x).includes('NESTED_RESCUE_LIVE_MARKER'))) {
      expect(stallCode(f), `${rel(f)} names the constant and reaches a write`).not.toMatch(WRITE);
    }
  });
  it('nested-rescue-live: no other file under ccd/ or deploy/ names it on a code line', () => {
    const others = bashRoots.flatMap((dir) => {
      const walk = (d: string): string[] => readdirSync(d).flatMap((e) => {
        const p = path.join(d, e);
        return statSync(p).isDirectory() ? walk(p) : (BASH.includes(p) || p.endsWith('.md') ? [] : [p]);
      });
      return walk(dir);
    });
    expect(others.length, 'the walk reached the non-shell files').toBeGreaterThan(40);
    expect(others.filter((f) => readFileSync(f, 'utf8').split('\n')
      .some((l) => !/^\s*(#|\/\/|\*|\/\*)/.test(l) && l.includes('nested-rescue-live'))).map(rel)).toEqual([]);
  });
});


// WORKSPACE LIFECYCLE WAVE 3b (spec 2026-09-24 §5.3, the coordinator's safety ruling (E)). APPENDED, for the reason
// the stall-watch blocks above state: `session-hook.test.ts`'s citation audit cites this file by line. The expiry lane
// SHIPS SHADOWED: until `$REG/expire-lane-live` exists it audits and records "would expire" and never composes
// `ws-expire`. The file is the operator's to touch BY HAND on the fleet box, beside `stall-watch-live` above — so no
// line of shell names it (a writer, or a reader the design never had), and its one TS holder is its definer, an L1
// file that reaches no `node:` module and so cannot write it.
describe('workspace lifecycle wave 3b: the expiry lane’s live switch has no writer in the tree', () => {
  const NAME = 'expire-lane-live';
  const DEFINER = 'shared/switches.ts'; // its switchboard row since D-5855; archivedExpiry.ts re-exports it

  it('no shell line names it, and its one TS holder is its definer', () => {
    expect(holdersOf(NAME), 'a line of shell names it — a writer, or a reader this design never had').toEqual([]);
    expect(ALL.filter((f) => stallCode(f).includes(NAME)).map(rel).sort(), `spelled on a code line outside ${DEFINER}`)
      .toEqual([DEFINER]);
    expect(stallCode(path.join(ccrcRoot, DEFINER)), `${DEFINER} reaches a node: module or require — it could write the marker`)
      .not.toMatch(/from\s+['"]node:|import\s*\(\s*['"]node:|\brequire\s*\(/);
  });

  // THE WIDER WRITER: a file that imports the switch's ONE spelling, `EXPIRE_LANE_LIVE_MARKER`, and holds an `io` could
  // write it without ever spelling its name. So the files whose code names the constant are pinned, and none of them
  // may reach a write — the executor reads the registry listing and nothing else. KNOWN WIDTH, stated: a write through
  // a helper defined in another file is not seen; the bar is the ordinary call.
  it('the files that name its constant are the definer, its re-exporter and the executor, and none reaches a write', () => {
    const WRITE = /\b(?:writeFile|appendFile|rename|symlink|copyFile|mkdir|truncate|unlink|rm)(?:Sync)?\s*\(|\.write\w*\s*\(/;
    expect(WRITE.test('await deps.io.writeFile(`${dir}/${m}`, "");'), 'CONTROL: the pattern sees a write').toBe(true);
    const holders = ALL.filter((f) => stallCode(f).includes('EXPIRE_LANE_LIVE_MARKER')).map(rel).sort();
    expect(holders).toEqual(['server/src/archivedExpiry.ts', 'server/src/coord/expireArchived.ts', DEFINER]);
    for (const f of holders) expect(stallCode(path.join(ccrcRoot, f)), `${f} reaches a write`).not.toMatch(WRITE);
  });
});


// FLEET DISK RETENTION DR-29 (D-6641, spec 2026-10-23 section 2.7.4). The expiry lane's child arm SHIPS SHADOWED behind
// `$REG/expire-child-live`, which the operator touches by hand: no shell line names it, its one TS spelling is its
// definer, and the files naming its constant are the definer, its re-exporter, the lane's executor and the lane, none
// of which reaches a write.
describe('fleet disk retention DR-29: the expiry lane’s child switch has no writer in the tree', () => {
  const NAME = 'expire-child-live';
  const DEFINER = 'shared/switches.ts';
  it('no shell line names it, and its one TS holder is its definer', () => {
    expect(holdersOf(NAME), 'a line of shell names it — a writer, or a reader this design never had').toEqual([]);
    expect(ALL.filter((f) => stallCode(f).includes(NAME)).map(rel).sort(), `spelled on a code line outside ${DEFINER}`).toEqual([DEFINER]);
  });
  it('the files that name its constant are the definer, its re-exporter, the executor and the lane, and none reaches a write', () => {
    const WRITE = /\b(?:writeFile|appendFile|rename|symlink|copyFile|mkdir|truncate|unlink|rm)(?:Sync)?\s*\(|\.write\w*\s*\(/;
    expect(WRITE.test('await deps.io.writeFile(`${dir}/${m}`, "");'), 'CONTROL: the pattern sees a write').toBe(true);
    const holders = ALL.filter((f) => stallCode(f).includes('EXPIRE_CHILD_LIVE_MARKER')).map(rel).sort();
    expect(holders).toEqual(['server/src/archivedExpiry.ts', 'server/src/coord/expireArchived.ts', DEFINER, 'server/src/watch.ts'].sort());
    for (const f of holders.filter((h) => h !== 'server/src/watch.ts')) {
      expect(stallCode(path.join(ccrcRoot, f)), `${f} reaches a write`).not.toMatch(WRITE);
    }
  });
});


// FLEET DISK RETENTION DR-27 (D-6639; spec 2026-10-23 §2.7.3). APPENDED, for the reason the blocks above state. The
// child reclaim's stale arm SHIPS SHADOWED: until `$REG/child-stale-reclaim-live` exists the lane records "child would be
// reclaimed (stale)" and composes no `--stale` argv. The file is the operator's to touch BY HAND on the fleet box, so no
// line of shell names it, and its TS holders are its definer (an L0 file that reaches no `node:` module and so cannot
// write it) and the one arm that reads a listing the lane already took.
describe('fleet disk retention DR-27: the stale arm’s live switch has no writer in the tree', () => {
  const NAME = 'child-stale-reclaim-live';
  const DEFINER = 'shared/switches.ts';

  it('no shell line names it, and its one TS holder is its definer', () => {
    expect(holdersOf(NAME), 'a line of shell names it — a writer, or a reader this design never had').toEqual([]);
    expect(ALL.filter((f) => stallCode(f).includes(NAME)).map(rel).sort(), `spelled on a code line outside ${DEFINER}`)
      .toEqual([DEFINER]);
    expect(stallCode(path.join(ccrcRoot, DEFINER)), `${DEFINER} reaches a node: module or require — it could write the marker`)
      .not.toMatch(/from\s+['"]node:|import\s*\(\s*['"]node:|\brequire\s*\(/);
  });

  // THE WIDER WRITER, as the expiry lane's block states it: a file that imports the constant and holds an `io` could
  // write the marker without spelling its name. The files whose code names the constant are pinned, and none reaches a write.
  it('the files that name its constant are the definer and the arm, and none reaches a write', () => {
    const WRITE = /\b(?:writeFile|appendFile|rename|symlink|copyFile|mkdir|truncate|unlink|rm)(?:Sync)?\s*\(|\.write\w*\s*\(/;
    expect(WRITE.test('await deps.io.writeFile(`${dir}/${m}`, "");'), 'CONTROL: the pattern sees a write').toBe(true);
    const holders = ALL.filter((f) => stallCode(f).includes('CHILD_STALE_RECLAIM_LIVE_MARKER')).map(rel).sort();
    expect(holders).toEqual(['server/src/coord/childReclaimStale.ts', DEFINER]);
    for (const f of holders) expect(stallCode(path.join(ccrcRoot, f)), `${f} reaches a write`).not.toMatch(WRITE);
  });
});

// D-6922. The superseded-review release SHIPS SHADOWED behind
// `$REG/child-superseded-reclaim-live`, hand-touched on the fleet box like the stale arm's: no shell line names it, its one
// TS definer is the L0 switch table, and the one file that reads a listing the lane already took holds the constant.
describe('child reclaim: the superseded-review release’s live switch has no writer in the tree', () => {
  const NAME = 'child-superseded-reclaim-live';
  const DEFINER = 'shared/switches.ts';

  it('no shell line names it, and its one TS holder is its definer', () => {
    expect(holdersOf(NAME), 'a line of shell names it — a writer, or a reader this design never had').toEqual([]);
    expect(ALL.filter((f) => stallCode(f).includes(NAME)).map(rel).sort(), `spelled on a code line outside ${DEFINER}`)
      .toEqual([DEFINER]);
  });

  it('the files that name its constant are the definer and the arm, and none reaches a write', () => {
    const WRITE = /\b(?:writeFile|appendFile|rename|symlink|copyFile|mkdir|truncate|unlink|rm)(?:Sync)?\s*\(|\.write\w*\s*\(/;
    const holders = ALL.filter((f) => stallCode(f).includes('CHILD_SUPERSEDED_RECLAIM_LIVE_MARKER')).map(rel).sort();
    expect(holders).toEqual(['server/src/coord/childReclaimStale.ts', DEFINER]);
    for (const f of holders) expect(stallCode(path.join(ccrcRoot, f)), `${f} reaches a write`).not.toMatch(WRITE);
  });
});


// THE THRESHOLD IS NEVER TYPED BY THE SERVER (the coordinator's ruling (C), wave 3b): ccd's `ws-audit --expire`
// document carries `expiresAt` (`archivedAt + WS_EXPIRE_AFTER_S`), and the server reads it through ONE reader. Both
// halves pinned: no seven-day literal in the server or the PWA beside the one that is not an expiry (`limits.ts`'s
// usage window), and the audit document is parsed in one place and its `expiresAt` key read in one file. KNOWN WIDTH:
// a reader spelling `doc.expiresAt` on a raw document is not seen — the raw document reaches the server only through
// `parseExpireAudit`, whose one caller is pinned.
describe('workspace lifecycle wave 3b: the expiry threshold is ccd’s, read through one reader', () => {
  const SEVEN_DAYS = /\b604_?800\b|\b7\s*\*\s*86_?400\b|\b7\s*\*\s*24\s*\*\s*60\b/;
  const lane = ALL.filter((f) => /^(server|pwa)\/src\//.test(rel(f)));

  it('no seven-day literal in server/src or pwa/src, but the usage window’s', () => {
    expect(SEVEN_DAYS.test('const S = 7 * 86_400;'), 'CONTROL').toBe(true);
    expect(lane.filter((f) => SEVEN_DAYS.test(stallCode(f))).map(rel).sort()).toEqual(['server/src/limits.ts']);
  });

  it('the audit document is parsed in one place, and its `expiresAt` key is read in one file', () => {
    expect(ALL.filter((f) => /\bparseExpireAudit\s*\(/.test(stallCode(f))).map(rel).sort())
      .toEqual(['server/src/archivedExpiry.ts', 'server/src/coord/expireArchived.ts']);
    expect(ALL.filter((f) => /['"]expiresAt['"]/.test(stallCode(f))).map(rel).sort()).toEqual(['server/src/archivedExpiry.ts']);
  });
});


// WORKSPACE LIFECYCLE WAVE 4 (review 313, F3). APPENDED, for the reason the blocks above state. The seven-day pin above
// reads numeric spellings only, so the expiry lane's operator text typed "past its seven days" and nothing reddened.
// MEASURED before deciding how wide: a prose pin over every code line of `server/src` and `pwa/src` holds five files —
// `wsaudit.ts` (ccd's own `not-expired` and `child` sentences, rendered verbatim), `watch.ts` and `coord/schema.ts`
// (the deviation ledger's unrelated seven-day stale window, in a log line and a migration's SQL comment), and the PWA's
// two archive confirms, which are the operator's copy. So the pin is scoped to the lane's own two files, where a
// period in a sentence is the defect.
describe('workspace lifecycle wave 4: the expiry lane’s own words type no period (review 313, F3)', () => {
  const PROSE = /\b(?:seven|7)[ -]days?\b/i;
  it('no seven-day prose on a code line of archivedExpiry.ts or coord/expireArchived.ts', () => {
    expect(PROSE.test('`held (“x”) past its seven days`'), 'CONTROL').toBe(true);
    expect(['server/src/archivedExpiry.ts', 'server/src/coord/expireArchived.ts']
      .filter((f) => PROSE.test(stallCode(path.join(ccrcRoot, f))))).toEqual([]);
  });
});


// WORKSPACE LIFECYCLE WAVE 4 (spec 2026-09-24 §5.4, the coordinator's safety ruling (B)). APPENDED, for the reason the
// blocks above state. The dead-coordinator lane SHIPS SHADOWED: until `$REG/dead-coordinator-lane-live` exists it
// measures, anchors, trips its breaker and records "would end programme <slug> (<n> runs)", and never reaches
// `closeRun`'s abandon arm. The file is the operator's to touch BY HAND in the registry the server reads, beside
// `expire-lane-live`, `scope-sweep-live` and `stall-watch-live` above — so no line of shell names it, and its one TS
// holder on a code line is its definer, an L1 file that reaches no `node:` module and so cannot write it.
describe('workspace lifecycle wave 4: the dead-coordinator lane’s live switch has no writer in the tree', () => {
  const NAME = 'dead-coordinator-lane-live';
  const DEFINER = 'shared/switches.ts'; // its switchboard row since D-5855; deadCoordinator.ts re-exports it

  it('no shell line names it, and its one TS holder is its definer', () => {
    expect(holdersOf(NAME), 'a line of shell names it — a writer, or a reader this design never had').toEqual([]);
    expect(ALL.filter((f) => stallCode(f).includes(NAME)).map(rel).sort(), `spelled on a code line outside ${DEFINER}`)
      .toEqual([DEFINER]);
    expect(stallCode(path.join(ccrcRoot, DEFINER)), `${DEFINER} reaches a node: module or require — it could write the marker`)
      .not.toMatch(/from\s+['"]node:|import\s*\(\s*['"]node:|\brequire\s*\(/);
  });

  // THE WIDER WRITER, the expiry pin's argument: a file that imports the ONE spelling and holds an `io` could write it
  // without spelling its name. The files whose code names the constant are pinned, and none of them reaches a write.
  it('the files that name its constant are the definer, its re-exporter and the executor, and none reaches a write', () => {
    const WRITE = /\b(?:writeFile|appendFile|rename|symlink|copyFile|mkdir|truncate|unlink|rm)(?:Sync)?\s*\(|\.write\w*\s*\(/;
    expect(WRITE.test('await deps.io.writeFile(`${dir}/${m}`, "");'), 'CONTROL: the pattern sees a write').toBe(true);
    const holders = ALL.filter((f) => stallCode(f).includes('DEAD_COORDINATOR_LANE_LIVE_MARKER')).map(rel).sort();
    expect(holders).toEqual(['server/src/coord/endDeadCoordinator.ts', 'server/src/deadCoordinator.ts', DEFINER]);
    for (const f of holders) expect(stallCode(path.join(ccrcRoot, f)), `${f} reaches a write`).not.toMatch(WRITE);
  });
});


describe('ccrc history: the operator switches have readers only (spec 2026-10-05 §9.11 O13)', () => {
  // Each switch is touched and removed BY HAND (§9.7): no line of shell or .mjs may write one. `lib.mjs`'s
  // SWITCHES is the one sanctioned definer (the stall-watch MARKERS precedent above); the hook and the shim read
  // `history-off` with a bash test. `_uninst_purge` spells its kept set as the globs `history` and `history-*`
  // and doctor names the cap file from `status --json`, so neither is a holder. W1-B2 added the skill's text to
  // this corpus (SKILL_TEXT below). KNOWN WIDTH: a name assembled from pieces is not seen. ONE named allowance
  // (USAGE_PROSE below, FU5) lets `ccrc --help` spell the pause path as prose; it covers one function's lines
  // and nothing else, and a split spelling is pinned by the case that reads the literal back.
  // `recall-off/<id>` is O13's seventh name and is NOT in HOLDERS: spec O13 gives it exactly one writer, sweep.mjs's
  // `--op recall-off` (recallOffPass, W2-1), and it has readers in more files than the exact-holders form can list (the
  // read verbs and the drain through readBounded, the hook's bash read, the replay driver's lstat). W2-1
  // (W2-D29) replaced B1's half-case with the last case below: one writer, the hook the one bash file naming it, and the
  // writer's shape.
  const HOLDERS: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['history-off', ['ccd/ccd-history-sweep', 'ccd/history/lib.mjs', 'ccd/session-hook.sh']],
    ['history-steer-off', ['ccd/history/lib.mjs']],
    ['history-steer-live', ['ccd/history/lib.mjs']],
    ['history-max-gb', ['ccd/history/lib.mjs']],
    ['steer-on', ['ccd/history/lib.mjs']],
    ['headless-on', ['ccd/history/lib.mjs']],
  ];
  /** W1-B2: the skill's text joins the corpus with the skill (spec §9.11 O13 names "every bash, .mjs or skill
   *  line"). Every line of it is read, comment or not, as a line a model may run (`code` below reads it whole).
   *  It names a switch path on no line at all, so even a prose mention would be a holder the rows above do not
   *  list; it is never a listed holder, so the language the rows' write check picks for it never applies. */
  const SKILL_TEXT = [path.join(ccrcRoot, 'ccd', 'history-skill', 'SKILL.md')];
  const CORPUS = [...new Set([...BASH, ...ALL_MJS, ...SKILL_TEXT])];
  /** A switch is a PATH, so a line names one only as `/<name>`. The bare words are vocabulary, not files: the
   *  exit-2 reason `history-off` (REASONS, Task 3; decideOpGate's refusal, Task 6) names the CONDITION, and
   *  lib.mjs spells it as a reason word, never as the file. */
  const needle = (name: string): string => `/${name}`;
  /** The help text NAMES the pause path for the operator; it neither reads nor writes the switch. The allowance is
   *  line-scoped: only the lines of `fn`'s body (its `fn() {` line to the next line that is exactly `}`) that hold a
   *  needle in a single-quoted printf argument: a quoted line that belongs to the run of `\` continuations starting at
   *  a `printf` line of `fn` (FU9, B4M2), so a continuation of any other command inside `fn` is not covered. Every
   *  other `file` line naming the path still reds the scan. The allowance departs from spec O13: D-4550. */
  const USAGE_PROSE = { file: 'ccd/ccrc', fn: '_usage_history_paragraph', needles: ['/history-off'] } as const;
  /** The line numbers of `fn`'s body the allowance covers, and the body itself (null when `fn` is not found). */
  const usageProse = (text: string): { body: string[] | null; allowed: Set<number> } => {
    const lines = text.split('\n');
    const at = lines.indexOf(`${USAGE_PROSE.fn}() {`);
    if (at < 0) return { body: null, allowed: new Set() };
    let end = at + 1;
    while (end < lines.length && lines[end] !== '}') end += 1;
    const allowed = new Set<number>();
    let inPrintf = false;   // true while the previous line was a printf line, or a quoted argument line, that ends in `\`
    for (let i = at + 1; i < end; i += 1) {
      const l = lines[i]!;
      const continues = /\\\s*$/.test(l);
      if (/^\s*printf\b/.test(l)) { inPrintf = continues; continue; }
      const m = /^\s*'([^']*)'(?:\s*\\)?$/.exec(l);
      if (inPrintf && m && USAGE_PROSE.needles.some((n) => m[1]!.includes(n))) allowed.add(i);
      inPrintf = inPrintf && m !== null && continues;
    }
    return { body: lines.slice(at + 1, end), allowed };
  };
  /** A file's code lines, comment lines dropped in either language. The one allowance is applied here, so the
   *  holder count and the `writes()` classifier both skip it. */
  const code = (f: string): string[] => {
    if (SKILL_TEXT.includes(f)) return readFileSync(f, 'utf8').split('\n');
    if (!BASH.includes(f)) return stallCode(f).split('\n');
    const text = readFileSync(f, 'utf8');   // once per call: ccd/ccrc is about 24k lines
    const skip = rel(f) === USAGE_PROSE.file ? usageProse(text).allowed : new Set<number>();
    return text.split('\n').filter((l, i) => !skip.has(i) && !isBashComment(l));
  };
  /** A line READS a switch when it tests or reads the path. */
  const READ = /\[\[?\s+!?\s*-[efrs]\s|\b(?:existsSync|readFileSync|statSync|lstatSync)\s*\(/;
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** A line WRITES the switch when a redirection, a file-changing command or a writing fs call targets it. */
  const writes = (line: string, lang: 'bash' | 'mjs', name: string): boolean => {
    const n = esc(name);
    if (lang === 'mjs') {
      return new RegExp(`\\b(?:writeFile|appendFile|rename|unlink|rm|rmdir|mkdir|copyFile|cp|symlink|link|truncate|open)(?:Sync)?\\s*\\([^;]*${n}`).test(line);
    }
    const l = line.replace(/\d?>\s*\/dev\/null|>&\d/g, '');
    return new RegExp(`>{1,2}\\s*["']?[^\\s"'<>|;&]*${n}`).test(l)
      || new RegExp(`(?:^|[\\s;&|({])(?:touch|mv|cp|ln|rm|rmdir|mkdir|install|tee|truncate)\\s[^;&|]*${n}`).test(l);
  };
  /** lib.mjs's SWITCHES declaration: its first line through the line that closes it. */
  const switchesBlock = (): string[] => {
    const lines = stallCode(path.join(HISTORY_DIR, 'lib.mjs')).split('\n');
    const at = lines.findIndex((l) => /\bconst SWITCHES\s*=/.test(l));
    expect(at, 'ccd/history/lib.mjs declares no SWITCHES').toBeGreaterThan(-1);
    let end = at;
    while (end < lines.length - 1 && !/\}\s*\)\s*;?\s*$/.test(lines[end]!)) end += 1;
    return lines.slice(at, end + 1);
  };

  it('CONTROL: both corpora were walked, and the classifiers see a read, a write and neither', () => {
    expect(BASH.map(rel)).toEqual(expect.arrayContaining(['ccd/ccd-history-sweep', 'ccd/session-hook.sh']));
    expect(ALL_MJS.map(rel)).toContain('ccd/history/lib.mjs');
    expect(READ.test('[ -e "$HOME/.ccrc/history-off" ] && exit 0')).toBe(true);
    expect(READ.test('[[ ! -e "$HOME/.ccrc/history-off" ]] || _hs=x')).toBe(true);
    expect(READ.test('if (existsSync(p.off)) return 0;')).toBe(true);
    expect(writes('touch "$HOME/.ccrc/history-off"', 'bash', 'history-off')).toBe(true);
    expect(writes(': > "$HOME/.ccrc/history-off"', 'bash', 'history-off')).toBe(true);
    expect(writes('rm -f -- "$HOME/.ccrc/history-max-gb"', 'bash', 'history-max-gb')).toBe(true);
    expect(writes('[ -e "$HOME/.ccrc/history-off" ] 2>/dev/null', 'bash', 'history-off')).toBe(false);
    expect(writes('[[ -e "$HOME/.ccrc/history-off" ]] || { printf x >> "$spool"; }', 'bash', 'history-off')).toBe(false);
    expect(writes("writeFileSync(home + '/.ccrc/history-off', '')", 'mjs', 'history-off')).toBe(true);
    expect(writes("if (existsSync(home + '/.ccrc/history-off')) return;", 'mjs', 'history-off')).toBe(false);
    // The reason word is not the file: REASON_ROWS' `'history-off'` names no switch path.
    expect("'irreversible-in-pane', 'history-off', 'span-pruned',".includes(needle('history-off'))).toBe(false);
    expect('[ -e "$HOME/.ccrc/history-off" ] && exit 0'.includes(needle('history-off'))).toBe(true);
  });

  it('USAGE_PROSE: the allowance covers one real spelling, the literal path, and exactly one line (FU5)', () => {
    const text = readFileSync(path.join(ccrcRoot, USAGE_PROSE.file), 'utf8');
    const { body, allowed } = usageProse(text);
    expect(body, `${USAGE_PROSE.file} has no ${USAGE_PROSE.fn}`).not.toBeNull();
    // A split spelling (`local off=history-off`, `~/.ccrc/$off`) would hold no needle and so pass the scan blind:
    // the help text must carry the path whole, so a future split fails here.
    expect(body!.join('\n')).toContain('~/.ccrc/history-off');
    expect(allowed.size).toBe(1);
    // The classifier: a single-quoted prose line is allowed, a code line that reads or writes the path is not.
    const probe = (...l: string[]): number => usageProse(`${USAGE_PROSE.fn}() {\n${l.join('\n')}\n}\n`).allowed.size;
    const PROSE = "    '            a session printed included; touch ~/.ccrc/history-off to pause' \\";
    expect(probe("  printf '\\n%s' \\", PROSE)).toBe(1);
    expect(probe(PROSE), 'a quoted line outside a printf run is not prose').toBe(0);
    // FU9 (B4M2): a quoted line is covered only as the continuation of a printf line, never of another command.
    expect(probe('  touch \\', "    '/abs/.ccrc/history-off'")).toBe(0);
    expect(probe("  printf '\\n%s' \\", "    'one' \\", '  touch \\', "    '/abs/.ccrc/history-off'")).toBe(0);
    expect(probe("  printf '\\n%s' \\", "    'one'", "    '/abs/.ccrc/history-off'"), 'a quoted line with no `\\` ends the run').toBe(0);
    expect(probe('    touch "$HOME/.ccrc/history-off"')).toBe(0);
    expect(probe('    [ -e "$HOME/.ccrc/history-off" ] && return 0')).toBe(0);
  });

  it('SWITCHES names every switch, so the rows below compare against a real definer', () => {
    const block = switchesBlock().join('\n');
    for (const [name] of HOLDERS) expect(block, `SWITCHES does not name ${name}`).toContain(name);
  });

  it('CONTROL (W1-B2): the skill text is in the corpus, read whole, and a write in it would be seen', () => {
    expect(CORPUS.map(rel)).toContain('ccd/history-skill/SKILL.md');
    expect(code(SKILL_TEXT[0]!).length, 'the skill text read as nearly empty').toBeGreaterThan(40);
    expect(writes('touch ~/.ccrc/history-off', 'bash', 'history-off')).toBe(true);
    expect('touch ~/.ccrc/history-off'.includes(needle('history-off'))).toBe(true);
  });

  it.each(HOLDERS)('%s: named on a code line only by its declaration and its readers %j, and never written', (name, want) => {
    const holders = CORPUS.filter((f) => code(f).some((l) => l.includes(needle(name)))).map(rel).sort();
    expect(holders, `${name}: a new line names it — a writer, or a reader this design does not list`).toEqual([...want].sort());
    const block = switchesBlock();
    for (const f of CORPUS.filter((x) => want.includes(rel(x)))) {
      const naming = code(f).filter((l) => l.includes(needle(name)));
      if (rel(f) === 'ccd/history/lib.mjs') {
        expect(naming.filter((l) => !block.includes(l)), `${name}: lib.mjs names it outside SWITCHES`).toEqual([]);
        continue;
      }
      const lang = BASH.includes(f) ? 'bash' : 'mjs';
      for (const l of naming) {
        expect(READ.test(l), `${rel(f)}: \`${l.trim()}\` names ${name} and reads nothing`).toBe(true);
        expect(writes(l, lang, name), `${rel(f)}: \`${l.trim()}\` WRITES ${name}`).toBe(false);
      }
    }
  });

  // W2-1 (W2-D29): recall-off/<id> has exactly one writer, sweep.mjs's recallOffPass, and every content reader reads it
  // through store.mjs's readBounded, so no corpus line pairs a write verb (`open` included) with a recall-off needle but the
  // writer's own. KNOWN WIDTH: a recall-off path held in a variable and written on a later line (`const p = recallOffPath(
  // home, id);` then `unlinkSync(p)`) is invisible to the needle scan. Inside recallOffPass the writer-shape rule below
  // closes it (every mutation there names `recallOffPath(` or `.recallOffDir` on its own line); outside it, nothing does.
  it('recall-off/<id>: exactly one writer, sweep.mjs', () => {
    const WRITER = 'ccd/history/sweep.mjs';
    const NEEDLES = ['recall-off', 'recallOffPath', 'recallOffDir', 'RECALL_OFF_DIR'] as const;
    const langOf = (f: string): 'bash' | 'mjs' => (BASH.includes(f) ? 'bash' : 'mjs');
    const writesOff = (l: string, lang: 'bash' | 'mjs'): boolean => NEEDLES.some((n) => l.includes(n) && writes(l, lang, n));
    // CONTROL: the classifier sees the planted writer shapes.
    expect(writesOff('writeFileSync(recallOffPath(home, id), g);', 'mjs')).toBe(true);
    expect(writesOff('    unlinkSync(`${P.recallOffDir}/${n}`);', 'mjs')).toBe(true);
    expect(writesOff('touch "$H/recall-off/$id"', 'bash')).toBe(true);
    // CONTROL: and not the two reads W2-D29 keeps, each read from the real file it lives in.
    const SWEEP_MJS = path.join(HISTORY_DIR, 'sweep.mjs');
    const reader = code(SWEEP_MJS).filter((l) => l.includes('readBounded(recallOffPath('));
    expect(reader, 'sweep.mjs reads recall-off/<id> through readBounded on two lines, recallOffPresence and the tick scan (W2-D29, W2-D30)').toHaveLength(2);
    const driver = code(path.join(ccrcRoot, 'deploy', 'history-replay.mjs')).filter((l) => l.includes('lstatSync(recallOffPath('));
    expect(driver, 'the replay driver\'s one recall-off line (W2-D78 (ii))').toHaveLength(1);
    for (const l of [...reader, ...driver]) expect(writesOff(l, 'mjs'), l.trim()).toBe(false);
    const writers = CORPUS.filter((f) => code(f).some((l) => writesOff(l, langOf(f)))).map(rel).sort();
    expect(writers, 'recall-off/<id> has exactly one writer, sweep.mjs (spec O13)').toEqual([WRITER]);
    // W2-D29's CLI half: cli.mjs reaches recall-off/<id> only through the imported recallOffPresence, so it names no recallOffPath( at all
    // (a read of its own there would be a second reader, which the needle scan above cannot see).
    const cliNames = code(path.join(HISTORY_DIR, 'cli.mjs')).filter((l) => l.includes('recallOffPath('));
    expect(cliNames.map((l) => l.trim()), 'cli.mjs names recallOffPath( : its one reader is sweep.mjs recallOffPresence (W2-D29)').toEqual([]);
    expect(code(path.join(HISTORY_DIR, 'cli.mjs')).some((l) => l.includes('recallOffPresence(')), 'CONTROL: cli.mjs does call the one reader').toBe(true);
    // The bash half: the hook reads recall-off/<id> and is the one bash file naming it; none of its lines writes it.
    const bashNaming = BASH.filter((f) => code(f).some((l) => l.includes('/recall-off')));
    expect(bashNaming.map(rel).sort()).toEqual(['ccd/session-hook.sh']);
    for (const f of bashNaming) {
      for (const l of code(f).filter((x) => x.includes('/recall-off'))) expect(writes(l, 'bash', 'recall-off'), `${rel(f)}: \`${l.trim()}\``).toBe(false);
    }
    // The writer shape: recallOffPass's body, from its declaration to the next line that is exactly `}`.
    const lines = code(SWEEP_MJS);
    const at = lines.findIndex((l) => /^export function recallOffPass\(/.test(l));
    expect(at, 'sweep.mjs declares no recallOffPass').toBeGreaterThan(-1);
    let end = at + 1;
    while (end < lines.length && lines[end] !== '}') end += 1;
    const VERB = /\b(?:writeFile|appendFile|rename|unlink|rm|rmdir|mkdir|copyFile|cp|symlink|link|truncate|open)(?:Sync)?\s*\(|\b(?:removeEntry|writeFileAtomic|mkdirDurable)\s*\(/;
    const mutations = lines.slice(at + 1, end).filter((l) => VERB.test(l));
    for (const l of mutations) {
      expect(/recallOffPath\(|\.recallOffDir\b/.test(l), `recallOffPass: \`${l.trim()}\` names no recall-off path on its own line`).toBe(true);
    }
    for (const v of ['mkdirSync(', 'openSync(', 'renameSync(', 'unlinkSync(']) expect(mutations.some((l) => l.includes(v)), `recallOffPass makes no ${v}`).toBe(true);
    // Every recall-off write in sweep.mjs is the executor's.
    const outside = lines.filter((l, i) => (i <= at || i >= end) && writesOff(l, 'mjs')).map((l) => l.trim());
    expect(outside, 'a recall-off write in sweep.mjs outside recallOffPass').toEqual([]);
  });
});

describe('ccrc history: every vocabulary is declared once, in lib.mjs, and bound to its uses (spec 2026-10-05 §9.11 O14)', () => {
  const LIB = path.join(HISTORY_DIR, 'lib.mjs');
  const VOCABS = ['NODE_KINDS', 'PARSE_STATUS', 'PROVENANCE', 'SPOOL_EVENTS', 'EPOCH_CAUSES', 'REFUSALS', 'ERROR_CODES',
    'COVERAGE', 'SCOPE_SOURCES', 'VARIANT_CAUSES', 'BACKENDS', 'HARNESS_TABLE', 'HARNESSES', 'JOURNAL_KINDS',
    'JOURNAL_VERDICTS', 'BIND_KINDS', 'MIGRATION_VERDICTS', 'HEALTH_WORDS', 'REASONS', 'WRITING_FORMS', 'STORE_FILES',
    'PASS_WORDS', 'CARD_PREFIX', 'SWITCHES', 'EXIT',
    // W1-B2: the recall vocabularies more than one module reads (scope, search, parser, fan-in, recovery, verbs).
    'SCOPE_KINDS', 'GREP_SORTS', 'REF_KINDS', 'FAN_IN', 'RECOVER_PHASES', 'FTS_SHADOWS', 'READ_VERBS',
    'INDEXED_PROVENANCE', 'VERB_TABLES', 'EXPAND_LABEL',
    // W1-B2 Task 7A (spec rev 3.5): the belt's words more than one module reads or writes.
    'BELT_COUNTERS', 'BELT_META', 'BELT_NODES_STEP', 'REDACT_SOURCES_META',
    // W5h-2 Task 3 (D-5747): the operator relay's look-behind window, declared once in lib.mjs.
    'RELAY_LOOKBEHIND_BYTES',
    // W1-B3: every constant the card line adds to lib, declared there once (Task 11 binds the hook's spellings).
    'CARD_LINE_PATTERN', 'CARD_LINE_MAX', 'CARD_DIR', 'SCOPE_DIR', 'CARD_DESCRIBE_CMD',
    'CARD_MEASURE_ROWS', 'CARD_MEASURE_MAX_WAIT_MS', 'CARD_ATTACHMENT_MAX_BYTES', 'PURGED_FILES_GRACE_MS',
    'SCOPE_MARKER_MAX_AGE_MS', 'CARD_CONSUMED_SCOPES', 'CARD_WITHDRAW_REASONS', 'EXPORT_DIR', 'EXPORT_SEGMENT_MAX_BYTES', 'EXPORT_PASS_INTERVAL_MS', 'EXPORT_SEGMENT_FORMAT', 'EXPORT_ROW_META_BYTES', 'EXPORT_MARK_BACKOFF_MAX_MS', 'EXPORT_DUE_OLDEST_UNMEASURED',
    // W5h-1 Task 1 (D-5632 (history-export-bind-check-batched)): the check after a bind's bounds and stop words; EXPORT_BIND_BATCH moved here from sweep.mjs.
    'EXPORT_BIND_BYTES', 'EXPORT_BIND_WAL_CEILING', 'EXPORT_BIND_BATCH', 'EXPORT_MARKS_STALL_MS', 'MARK_CHECK_WORDS',
    // W5h-1 Task 3 (D-5634 (history-export-segment-whole-check)): SQLite's header length, which store.mjs segmentFileFacts reads and lib decideSegmentWhole compares.
    'SEGMENT_HEADER_BYTES',
    // W2-1 Task 2 (W2-D12, W2-D30): the presence record's meta prefix and its two bounds, read by lib's planner, sweep.mjs and (the prefix) the gate.
    'RECALL_OFF_META', 'RECALL_OFF_GAP_MS', 'RECALL_OFF_SCAN_MAX',
    // W2-1 Task 4 (W2-D30): the presence record's meta keys, each built from RECALL_OFF_META. W2-2b Task 1 (W2-D12): the arm words and the marker's bounds.
    'RECALL_OFF_KEYS', 'RECALL_ARMS', 'HEADLESS_LIST_MAX_BYTES', 'HEADLESS_LIST_MAX_PAIRS'] as const;
  /** The declaration scan's corpus: the history modules and every deploy/ and shared/ `.mjs`. NOT the rest of
   *  ccd/: `ccd/compact-card.mjs` declares an `EXIT` of its own (its exit codes, a different module's). */
  const DECL_CORPUS = [...new Set([...HISTORY_MJS, ...mjsUnder(path.join(ccrcRoot, 'deploy')), ...mjsUnder(path.join(ccrcRoot, 'shared'))])];
  const declares = (name: string): RegExp => new RegExp(`(?:^|[\\s;])(?:export\\s+)?(?:const|let|var)\\s+${name}\\b`);
  /** The `"ev":"…"` literals a bash file writes, and the `ev: '…'` keys a `.mjs` file builds. */
  const EV_BASH = /"ev":"([A-Za-z]+)"/g;
  const EV_MJS = /\bev\s*:\s*['"`]([A-Za-z]+)['"`]/g;
  /** SPOOL_EVENTS members whose emitter ships in a later PR. A member found emitted while listed here reds, so
   *  the PR that adds the emitter removes its line. */
  const PENDING_EMITTERS: Record<string, string> = { steer: 'W3 (the steering hook)' };
  type Lib = Record<string, unknown>;
  const lib = async (): Promise<Lib> => (await import('../../../ccd/history/lib.mjs')) as unknown as Lib;

  it('CONTROL: the corpus holds the four history modules, and the declaration pattern sees a declaration and nothing else', () => {
    expect(HISTORY_MJS.map(rel).sort()).toEqual(expect.arrayContaining(
      ['ccd/history/cli.mjs', 'ccd/history/lib.mjs', 'ccd/history/store.mjs', 'ccd/history/sweep.mjs']));
    expect(declares('BACKENDS').test("export const BACKENDS = Object.freeze(['anthropic', 'other', 'unknown']);")).toBe(true);
    expect(declares('BACKENDS').test('const BACKENDS = x;')).toBe(true);
    expect(declares('BACKENDS').test('if (BACKENDS.includes(b)) return b;')).toBe(false);
    expect(declares('BACKENDS').test("const { BACKENDS } = await import('./lib.mjs');")).toBe(false);
    expect(declares('EXIT').test('export const EXIT_CODES = 1;')).toBe(false);
  });

  it.each(VOCABS)('%s is declared in ccd/history/lib.mjs and in no other .mjs, exported, and frozen', async (name) => {
    expect(DECL_CORPUS.filter((f) => stallCode(f).split('\n').some((l) => declares(name).test(l))).map(rel).sort(),
      `${name}: a second declaration`).toEqual(['ccd/history/lib.mjs']);
    const v = (await lib())[name];
    expect(v, `${name} is not exported`).toBeDefined();
    if (typeof v === 'object' && v !== null) expect(Object.isFrozen(v), `${name} is not frozen`).toBe(true);
  });

  it('REFUSALS is REASONS\' exit-2 keys and HARNESSES is HARNESS_TABLE\'s keys, each derived, never declared apart', async () => {
    const l = await lib();
    const reasons = l['REASONS'] as Record<string, number>;
    const exits = Object.values(l['EXIT'] as Record<string, number>);
    for (const [w, x] of Object.entries(reasons)) expect(exits, `REASONS.${w} = ${x} is not an EXIT value`).toContain(x);
    expect([...(l['REFUSALS'] as readonly string[])].sort())
      .toEqual(Object.keys(reasons).filter((k) => reasons[k] === 2).sort());
    expect([...(l['HARNESSES'] as readonly string[])]).toEqual(Object.keys(l['HARNESS_TABLE'] as object));
    const src = stallCode(LIB).split('\n');
    expect(src.find((x) => declares('HARNESSES').test(x)), 'HARNESSES is spelled, not derived').toContain('Object.keys(HARNESS_TABLE)');
    expect(src.find((x) => declares('REFUSALS').test(x)), 'REFUSALS is spelled, not derived').toContain('Object.keys(REASONS)');
  });

  it('every "ev" the hook writes is a SPOOL_EVENTS member, and every member has an emitter or is named pending', async () => {
    const members = [...((await lib())['SPOOL_EVENTS'] as readonly string[])];
    const hook = codeLines(path.join(ccrcRoot, 'ccd', 'session-hook.sh')).join('\n');
    const fromHook = [...hook.matchAll(EV_BASH)].map((m) => m[1]!);
    const fromMjs = HISTORY_MJS.flatMap((f) => [...stallCode(f).matchAll(EV_MJS)].map((m) => m[1]!));
    expect(fromHook.length, 'the hook scan matched nothing — the spool block is gone or its spelling moved').toBeGreaterThan(0);
    for (const e of [...fromHook, ...fromMjs]) expect(members, `"${e}" is written but is not a SPOOL_EVENTS member`).toContain(e);
    const emitted = new Set([...fromHook, ...fromMjs]);
    for (const k of Object.keys(PENDING_EMITTERS)) expect(members, `PENDING_EMITTERS names ${k}, not a member`).toContain(k);
    for (const m of members) {
      if (m in PENDING_EMITTERS) expect(emitted.has(m), `${m} has an emitter now: remove it from PENDING_EMITTERS`).toBe(false);
      else expect(emitted.has(m), `${m} is a SPOOL_EVENTS member with no emitter`).toBe(true);
    }
  });

  it('every kind the sweep journals is a JOURNAL_KINDS member', async () => {
    const members = [...((await lib())['JOURNAL_KINDS'] as readonly string[])];
    const CALL = /\bjournalRecord\(\s*['"`]([a-z-]+)['"`]/g;
    const kinds = HISTORY_MJS.flatMap((f) => [...stallCode(f).matchAll(CALL)].map((m) => [rel(f), m[1]!] as const));
    expect(kinds.length, 'no journalRecord call names its kind as a literal — the scan saw nothing').toBeGreaterThan(0);
    expect(kinds.filter(([, k]) => !members.includes(k)).map(([f, k]) => `${f}: ${k}`)).toEqual([]);
  });

  it('every word _check_history spells is a HEALTH_WORDS member, every class is pass|warn|fail, and every remedy is keyed by a word', async () => {
    const l = await lib();
    const words = Object.keys(l['HEALTH_WORDS'] as object);
    for (const c of Object.values(l['HEALTH_WORDS'] as Record<string, string>)) expect(['pass', 'warn', 'fail']).toContain(c);
    for (const k of Object.keys(l['HEALTH_REMEDIES'] as object)) expect(words, `HEALTH_REMEDIES keys ${k}`).toContain(k);
    const lines = readFileSync(path.join(ccrcRoot, 'ccd', 'ccrc-doctor-checks'), 'utf8').split('\n');
    const at = lines.findIndex((x) => /^_check_history\(\) \{$/.test(x));
    expect(at, 'ccd/ccrc-doctor-checks has no _check_history').toBeGreaterThan(-1);
    const end = lines.findIndex((x, i) => i > at && x === '}');
    const body = lines.slice(at, end).filter((x) => !x.trim().startsWith('#')).join('\n');
    const spelled = [...body.matchAll(/_dr_(?:pass|warn|fail)\s+history\s+"([a-z][a-z0-9-]*):/g)].map((m) => m[1]!);
    expect(spelled.length, 'the scan matched no word in _check_history').toBeGreaterThan(0);
    expect(spelled.filter((w) => !words.includes(w))).toEqual([]);
  });

  it('the string vocabularies EXPAND_LABEL, BELT_META, BELT_NODES_STEP, REDACT_SOURCES_META and RECALL_OFF_META are quoted once, at their declaration (H-149)', async () => {
    // The declaration and export check above is vacuous for a primitive: a reader that spells the value (`.get('redact_sources')`)
    // instead of naming the constant would stay green. The scan reads code lines only, comments excluded.
    const l = await lib();
    const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const name of ['EXPAND_LABEL', 'BELT_META', 'BELT_NODES_STEP', 'REDACT_SOURCES_META', 'RECALL_OFF_META'] as const) {
      const value = l[name];
      expect(typeof value, `${name} is a string`).toBe('string');
      const quoted = new RegExp(`['"\`]${esc(String(value))}['"\`]`);
      const uses = HISTORY_MJS.flatMap((f) => stallCode(f).split('\n').filter((x) => quoted.test(x)).map((x) => `${rel(f)}: ${x.trim()}`));
      expect(uses, `${name}: the value is quoted outside its declaration`).toHaveLength(1);
      expect(uses[0], `${name}: the one quoted copy is not its declaration`).toMatch(new RegExp(`^ccd/history/lib\\.mjs: (?:export\\s+)?const\\s+${name}\\s*=`));
    }
  });

  it('the literal .ccrc/history/db is spelled in ccd/history/*.mjs once, as STORE_DB_REL', async () => {
    expect((await lib())['STORE_DB_REL']).toBe('.ccrc/history/db');
    expect(HISTORY_MJS.filter((f) => stallCode(f).includes('.ccrc/history/db')).map(rel)).toEqual(['ccd/history/lib.mjs']);
    const lines = stallCode(LIB).split('\n').filter((x) => x.includes('.ccrc/history/db'));
    expect(lines, 'lib.mjs spells the store directory more than once').toHaveLength(1);
    expect(lines[0]).toMatch(/\bSTORE_DB_REL\s*=\s*['"]\.ccrc\/history\/db['"]/);
  });

  it('COVERAGE is this-box, and the word is a literal in lib.mjs alone; CARD_PREFIX is declared (its hook half: the card line describe below)', async () => {
    const l = await lib();
    expect([...(l['COVERAGE'] as readonly string[])]).toEqual(['this-box']);
    expect(HISTORY_MJS.filter((f) => /['"`]this-box['"`]/.test(stallCode(f))).map(rel)).toEqual(['ccd/history/lib.mjs']);
    expect(l['CARD_PREFIX']).toBe('History: ');
  });

  it('NODE_KINDS is the schema-v1 CHECK list in store.mjs, member for member', async () => {
    const kinds = [...((await lib())['NODE_KINDS'] as readonly string[])];
    const { MIGRATIONS } = await import('../../../ccd/history/store.mjs');
    const m = /\bkind IN \(([^)]*)\)/.exec(MIGRATIONS[0] ?? '');
    expect(m, 'schema v1 declares no nodes.kind CHECK').not.toBeNull();
    expect(m![1]!.split(',').map((s) => s.trim().replace(/^'|'$/g, '')).sort()).toEqual(kinds.sort());
  });
});

describe('ccrc history: process.env is read by name, from an allow-list (spec 2026-10-05 §10.1 Seams)', () => {
  // D-4247: no env var arms a test seam in the shipped modules. A test's faults arrive through a NODE_OPTIONS
  // preload it writes itself, and `process.env` is read only for these names; W2-2a adds §8.2's three (W2-D39).
  const ALLOWED = ['CCRC_RECALL_ARM', 'CCRC_RECALL_ASOF', 'CCRC_RECALL_SESSION', 'CCRC_SESSION_GENERATION', 'CLAUDECODE', 'HOME', 'TMUX_PANE'];
  const READS = /process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\2\s*\])?/g;
  const envReads = (code: string): string[] => [...code.matchAll(READS)].map((m) => m[1] ?? m[3] ?? '<not by name>');

  it('CONTROL: the reader names dotted and bracketed reads, and flags a whole-env use and a computed name', () => {
    expect(envReads("const h = process.env.HOME; const g = process.env['CCRC_SESSION_GENERATION'];"))
      .toEqual(['HOME', 'CCRC_SESSION_GENERATION']);
    expect(envReads('spawnSync(bin, args, { env: process.env });')).toEqual(['<not by name>']);
    expect(envReads('const v = process.env[name];')).toEqual(['<not by name>']);
  });

  it('every process.env read in ccd/history/*.mjs names an allowed variable', () => {
    const seen = HISTORY_MJS.flatMap((f) => envReads(stallCode(f)).map((n) => [rel(f), n] as const));
    expect(seen.length, 'no history module reads process.env at all — the scan saw nothing').toBeGreaterThan(0);
    expect(seen.filter(([, n]) => !ALLOWED.includes(n)).map(([f, n]) => `${f}: ${n}`)).toEqual([]);
  });
});


// Task 36G item 2 (Task 34's O13): the `.mjs` arm above looks for a switch's PATH TEXT (`/history-off`), and
// the sanctioned spelling in `.mjs` is symbolic — `SWITCHES.off`, or the `off`/`cap` field of a `historyPaths(...)`
// result (`P.off`) — which carries no `/name` at all, so `writeFileSync(P.off, '')` is invisible to it. This arm
// reads the symbols instead. KNOWN WIDTH: an alias of an alias (`const x = P.off; unlinkSync(x)`) is not seen.
describe('ccrc history: no .mjs writes a switch through its symbolic spelling (spec 2026-10-05 §9.11 O13)', () => {
  /** The verb list of the O13 describe's `writes()` for `.mjs`, restated (that one is closed over its describe). */
  const VERB = /\b(?:writeFile|appendFile|rename|unlink|rm|rmdir|mkdir|copyFile|cp|symlink|link|truncate|open)(?:Sync)?\s*\(/;
  /** `historyPaths` has two switch fields, `off` and `cap`; every other SWITCHES key is named alongside. */
  const symbolic = (keys: readonly string[]): RegExp =>
    new RegExp(`SWITCHES\\.|\\.(?:off|cap|${keys.join('|')})\\b`);
  const writesSymbolically = (line: string, keys: readonly string[]): boolean => {
    const m = VERB.exec(line);
    return m !== null && symbolic(keys).test(line.slice(m.index + m[0].length));
  };
  const KEYS = ['maxGb', 'steerOff', 'steerLivePrefix', 'steerOnDir', 'headlessOn'] as const;

  it('CONTROL: the classifier sees a write through P.off, a historyPaths(...) field and SWITCHES., and not a read', () => {
    expect(writesSymbolically("writeFileSync(P.off, '')", KEYS)).toBe(true);
    expect(writesSymbolically("existsSync(P.off)", KEYS)).toBe(false);
    expect(writesSymbolically("unlinkSync(historyPaths(home).cap);", KEYS)).toBe(true);
    expect(writesSymbolically("fs.writeFileSync(join(home, SWITCHES.maxGb), '9')", KEYS)).toBe(true);
    expect(writesSymbolically("mkdirSync(`${home}/${SWITCHES.steerOnDir}`, { recursive: true })", KEYS)).toBe(true);
    expect(writesSymbolically("rmSync(c.paths.headlessOn)", KEYS)).toBe(true);
    expect(writesSymbolically("if (existsSync(P.off)) return 0;", KEYS)).toBe(false);
    expect(writesSymbolically("const cap = capOf(capText(P.cap));", KEYS)).toBe(false);
  });

  it('SWITCHES keys named here are exactly lib.mjs\'s, so a key added there is not unwatched', async () => {
    const lib = (await import('../../../ccd/history/lib.mjs')) as unknown as { SWITCHES: Record<string, string> };
    expect(Object.keys(lib.SWITCHES).sort()).toEqual(['off', ...KEYS].sort());
  });

  it('no line of any .mjs under ccd/, deploy/ or shared/ pairs a write verb with a switch symbol', () => {
    expect(ALL_MJS.map(rel)).toContain('ccd/history/sweep.mjs');
    const hits = ALL_MJS.flatMap((f) => stallCode(f).split('\n')
      .filter((l) => writesSymbolically(l, KEYS)).map((l) => `${rel(f)}: ${l.trim()}`));
    expect(hits, 'a switch is touched and removed by hand (§9.7): a .mjs write through SWITCHES or historyPaths is a writer').toEqual([]);
  });
});
