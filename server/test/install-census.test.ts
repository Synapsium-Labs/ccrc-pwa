// `ccd/ccrc`'s install census against its own uninstall census — DERIVED FROM
// THE SOURCE ON BOTH SIDES, never from a list typed here.
//
// WHY THIS FILE EXISTS. `_uninst_tree_bins` and `_uninst_units` are hand-kept
// `rm -f` lists describing what `_inst_bins` and `_inst_units` place. That pair
// of lists has been caught stale three separate times (D-1347, where the
// install grew `graphify` and the removal did not; D-2594, where `main` added
// `ccd-telemetry-keepalive`; and the routing slice, where the usage sweep's two
// names landed in one list and not the prose that counted them). Every one of
// those was found by a human reading two paragraphs side by side. A binary
// whose units an uninstall removes and whose file it leaves behind is an orphan
// on `$PATH` for ever — and a unit file left behind under a removed binary is a
// 203/EXEC failure every interval, for ever. This file is the machine that
// compares the two lists, in BOTH directions, so neither can grow without the
// other.
//
// THE SHAPE IS `gen-wrappers.test.ts:86-112`'s, deliberately — the same
// `_inst_atomic … "$bin/<name>"` idiom, so this repository has ONE way of
// reading a placement out of `ccd/ccrc` rather than two. Its doc comment
// explains why a second, independent derivation matters at all: deriving both
// sides of a comparison from ONE source makes the comparison tautological in
// the direction that matters, which is measured, not hypothetical. Here the two
// sides really are independent — `_inst_*` and `_uninst_*` are different
// functions with different text — so the comparison has content.
//
// WHAT IS NOT INHERITED FROM THAT PRECEDENT: its
// `.filter((n) => !n.includes('.'))`. That filter is correct THERE and would be
// a silent hole HERE. `gen-wrappers.mjs`'s `ID_RE` can never match a dotted
// name, so its orphan scan settles `ccd-usage-sweep.py` before the Set it
// checks is consulted; dropping dotted names costs that suite nothing. This
// file's whole subject is the uninstall census, and three of the names that
// census MUST carry are dotted — `ccd-usage-sweep.py`, `ccgpt-proxy.py` and
// `ccgpt-usage.py`. Inheriting the filter would drop all three from both sides
// at once, which is a VACUOUS pass on exactly the names the GPT-lane plan
// added. The filter is absent on purpose; do not add it back.
//
// NO NAME OF THE SUBJECT IS TYPED IN THIS FILE. A third hand-kept copy of the
// census is the defect this guard exists to delete, so every name compared
// below is read out of `ccd/ccrc`. The two `ccd`/`ccrc` anchors and the two
// `BOX_UNIT_NAMES` anchors are ANTI-VACUITY CONTROLS, not a census: the first
// pair is the tool and its launcher, the only two placements under no platform
// or role gate at all, and the second pair is read out of the array `ccd/ccrc`
// itself declares.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CCRC_PATH = path.resolve(here, '..', '..', 'ccd', 'ccrc');
const CCRC = readFileSync(CCRC_PATH, 'utf8');

/** The directory every name in the BIN census lives in, written the way
 *  `ccd/ccrc` writes it. Never expanded: `$HOME` is the fixture-independent
 *  root of the only path this census is scoped to, so it stays a literal and
 *  `resolveWord` below refuses to substitute it. */
const BIN_PREFIX = '$HOME/.local/bin/';
/** The unit directory, as `_inst_units` and `_uninst_units` both spell it.
 *  Both bind `dir="$BOX_UNIT_DIR"`, which `assertBindsUnitDir` proves — so
 *  `$dir/` is a sound scope token and needs no expansion either (expanding it
 *  would drag in the Darwin `~/Library/LaunchAgents` arm, which is not this
 *  census's subject). */
const UNIT_PREFIX = '$dir/';

// ── reading `ccd/ccrc` ────────────────────────────────────────────────────

/** One top-level bash function's body: `name() {` to the `}` in column 0. */
function fnBody(name: string): string {
  const sig = `\n${name}() {`;
  const count = CCRC.split(sig).length - 1;
  if (count !== 1) {
    throw new Error(
      `install-census.test.ts: expected exactly one \`${name}() {\` in ${CCRC_PATH}, found ${count}. `
      + 'This extractor has gone stale — re-point it at wherever that function now lives. Do NOT '
      + 'retype the census here.',
    );
  }
  const i = CCRC.indexOf(sig);
  const j = CCRC.indexOf('\n}\n', i + sig.length);
  if (j < 0) throw new Error(`install-census.test.ts: \`${name}\` has no closing brace in column 0 — extractor stale`);
  return CCRC.slice(i + sig.length, j);
}

/** Continuation lines joined, so a `rm -f … \` spanning six lines is one
 *  command to every scan below. */
function logicalLines(body: string): string[] {
  return body.replace(/\\\n\s*/g, ' ').split('\n');
}

/**
 * Every value a bash name is assigned in a stretch of text. A MULTIMAP, not a
 * map: `role_unit` is assigned twice in `_inst_units` (`ccrc.service`, then
 * `ccrc-agent.service` under the fleet gate) and BOTH are placements, so a
 * resolver that kept only the last one would lose whichever unit this box is
 * not. Quoted and bare forms both, because `role_unit=ccrc.service` is bare.
 */
function assignments(text: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const m of text.matchAll(/(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)=(?:"([^"]*)"|([^\s;"'|&()]+))/g)) {
    const name = m[1]!;
    const value = m[2] !== undefined ? m[2] : m[3];
    if (value === undefined) continue;
    let set = out.get(name);
    if (set === undefined) { set = new Set(); out.set(name, set); }
    set.add(value);
  }
  return out;
}

/** File-scope assignments, the fallback for a name a function body does not
 *  bind itself (`$BOX_INSTALLED_FILE` and friends). Anything that resolves
 *  outside the two prefixes above is discarded by the prefix filters, so a
 *  spurious binding costs nothing. */
const FILE_ASSIGNS = (() => assignments(CCRC))();

/** One `NAME=(a b c)` array declaration, read out of `ccd/ccrc`. */
function arrayElements(name: string): string[] {
  const all = [...CCRC.matchAll(new RegExp(`^${name}=\\(([^)]*)\\)`, 'gm'))];
  if (all.length !== 1) {
    throw new Error(
      `install-census.test.ts: expected exactly one \`${name}=(…)\` declaration in ${CCRC_PATH}, `
      + `found ${all.length} — this extractor has gone stale.`,
    );
  }
  return all[0]![1]!.trim().split(/\s+/);
}

/**
 * Every concrete string a quoted bash word may denote, substituting `$var` and
 * `${ARR[n]}` through the enclosing function's own assignments (then file
 * scope). `$HOME` is never substituted — see `BIN_PREFIX`.
 *
 * THIS IS THE ROW WHERE NEITHER SIDE IS A LITERAL. `_inst_units` writes
 * `"$dir/$role_unit"` and `_uninst_units` writes `"$dir/${BOX_UNIT_NAMES[0]}"`
 * and `[1]`; they are the same two units spelled two different ways, and both
 * spellings are resolvable from `ccd/ccrc`'s own text. Resolving them is what
 * lets this file compare them WITHOUT typing `ccrc.service` anywhere.
 */
function resolveWord(word: string, local: Map<string, Set<string>>, depth = 0): Set<string> {
  if (depth > 4) return new Set([word]);
  const arr = /\$\{([A-Za-z_][A-Za-z0-9_]*)\[([0-9]+)\]\}/.exec(word);
  if (arr !== null) {
    const el = arrayElements(arr[1]!)[Number(arr[2]!)];
    if (el === undefined) return new Set([word]);
    return resolveWord(word.slice(0, arr.index) + el + word.slice(arr.index + arr[0].length), local, depth + 1);
  }
  const v = /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/.exec(word);
  if (v === null) return new Set([word]);
  const name = v[1]!;
  const head = word.slice(0, v.index);
  const tail = word.slice(v.index + v[0].length);
  if (name === 'HOME') {
    // Left standing, and the rest of the word resolved around it.
    return new Set([...resolveWord(tail, local, depth + 1)].map((r) => `${head}$HOME${r}`));
  }
  const values = local.get(name) ?? FILE_ASSIGNS.get(name);
  if (values === undefined) return new Set([word]); // unresolved: the prefix filters drop it
  const out = new Set<string>();
  for (const value of values) {
    for (const r of resolveWord(head + value + tail, local, depth + 1)) out.add(r);
  }
  return out;
}

/**
 * The leaf name of a path under `prefix`, or `null`.
 *
 * REJECTS A REMAINDER CONTAINING `/`, which is the whole of the "and to file
 * names" scoping rule: `_inst_units` places
 * `"$dir/claude-session@.service.d/limits.conf"`, a drop-in FILE inside a
 * drop-in DIRECTORY that `_uninst_units` removes with `rm -rf`, not by name.
 * Comparing it against the `rm -f` census would be comparing two different
 * kinds of thing. Rejects a remainder containing `$` for the same reason in the
 * other direction: an unresolved variable is not a name, and silently treating
 * one as a name would put a nonsense entry on one side of a set comparison.
 */
function leafUnder(p: string, prefix: string): string | null {
  if (!p.startsWith(prefix)) return null;
  const rest = p.slice(prefix.length);
  if (rest === '' || rest.includes('/') || rest.includes('$')) return null;
  return rest;
}

/**
 * Every path an `rm -f` in this body names, resolved.
 *
 * SCOPED TO `rm -f`, NOT `rm -rf`, and that is a decision with two subjects.
 * `_uninst_tree_bins` removes `$BOX_TREE_DIR` and `_uninst_units` removes
 * `claude-session@.service.d` and `$slice` with `rm -rf` — directories, which
 * no install step PLACES as a file, so a blunt scan would put three phantom
 * entries in the removal census and red the `removed ⊆ placed` direction
 * against rows that were never wrong.
 */
function rmFPaths(body: string, local: Map<string, Set<string>>): Set<string> {
  const out = new Set<string>();
  for (const line of logicalLines(body)) {
    if (!/\brm\s+-f\s/.test(line)) continue;
    // Everything after `||` is the `_ccrc_die` message, which quotes paths it
    // does not remove.
    for (const w of line.split('||')[0]!.matchAll(/"([^"]*)"/g)) {
      for (const c of resolveWord(w[1]!, local)) out.add(c);
    }
  }
  return out;
}

// ── the four censuses ─────────────────────────────────────────────────────

/**
 * Every `$bin/<name>` `_inst_atomic` places, read out of `_inst_bins`' body —
 * `gen-wrappers.test.ts`'s regex, unchanged, WITHOUT its dotted-name filter
 * (this file's header says why).
 *
 * SCOPED BY `$bin/`, and the binding is proved rather than assumed: the
 * assertion below fails loudly if `_inst_bins` ever points `bin` somewhere
 * else, because then the names this returns would no longer be the names
 * `_uninst_tree_bins`' `$HOME/.local/bin/…` list is about.
 */
function placedBins(): Set<string> {
  const body = fnBody('_inst_bins');
  const bound = assignments(body).get('bin');
  if (bound === undefined || !bound.has(BIN_PREFIX.replace(/\/$/, ''))) {
    throw new Error(
      `install-census.test.ts: _inst_bins no longer binds \`bin="${BIN_PREFIX.replace(/\/$/, '')}"\` `
      + `(it binds ${bound === undefined ? 'nothing this scan can see' : [...bound].join(', ')}). `
      + 'The `$bin/` scoping below is therefore unproven — re-derive it before trusting this suite.',
    );
  }
  return new Set(
    [...body.matchAll(/_inst_atomic\s+"[^"]*"\s+"\$bin\/([^"]+)"/g)].map((m) => m[1]!),
  );
}

/**
 * The one name in `$HOME/.local/bin` that arrives as a SYMLINK rather than an
 * `_inst_atomic` copy: `_inst_graphify_engine`'s link into the pinned venv.
 *
 * WHY A SECOND PLACEMENT SOURCE RATHER THAN AN EXEMPTION. `_uninst_tree_bins`
 * removes that link, so a removal census that sees it and a placement census
 * that does not would red the `removed ⊆ placed` direction on a row that is
 * entirely correct. The brief allowed either a named exemption or this; this is
 * strictly stronger and costs three lines. An exemption protects one direction
 * only — it would still have to assert separately that the exempted name IS
 * removed, and it would be BLIND to a second symlinked placement arriving
 * later. Deriving gives both for free: `graphify` is an ordinary member of the
 * placed set, so direction 1 already asserts the uninstall removes it, and a
 * second `ln -s` into that directory joins the census the day it is written.
 *
 * Scoped to `ln -s` commands and to the `$HOME/.local/bin/` prefix — which is
 * what keeps `$HOME/.local/bin/.graphify.tmp.$$`, the staging name that
 * function also spells, out of a census of installed executables (it is an
 * `rm`'d temp file, and its `$$` leaves it unresolved anyway).
 */
function placedLinkBins(): Set<string> {
  const body = fnBody('_inst_graphify_engine');
  const local = assignments(body);
  const out = new Set<string>();
  for (const line of logicalLines(body)) {
    if (!/\bln\s+-s/.test(line)) continue;
    for (const w of line.matchAll(/"([^"]*)"/g)) {
      for (const c of resolveWord(w[1]!, local)) {
        const n = leafUnder(c, BIN_PREFIX);
        if (n !== null) out.add(n);
      }
    }
  }
  return out;
}

/**
 * Every name `_uninst_tree_bins` removes from `$HOME/.local/bin`.
 *
 * SCOPED TO THAT PREFIX, which is what keeps `$BOX_INSTALLED_FILE` and the
 * `$BOX_NODE_ID_FILE`/`$BOX_CAPS_FILE`/`$BOX_FLOOR_FILE` triple out: they are
 * `~/.ccrc` install-state, removed by the same function and placed by nothing
 * in `_inst_bins`, so a blunt scan would red the `removed ⊆ placed` direction
 * on four rows that are not defects. They resolve (file scope) to paths under
 * `~/.ccrc` and fall outside the prefix.
 *
 * Variables are resolved, so `rm -f -- "$glink"` counts: the graphify link is
 * removed through a local, and a census that only read literals would miss it
 * and then red direction 1 against `placedLinkBins` above.
 */
function removedBins(): Set<string> {
  const body = fnBody('_uninst_tree_bins');
  const out = new Set<string>();
  for (const p of rmFPaths(body, assignments(body))) {
    const n = leafUnder(p, BIN_PREFIX);
    if (n !== null) out.add(n);
  }
  return out;
}

/** Both functions must bind `dir="$BOX_UNIT_DIR"` for `$dir/` to be a sound
 *  scope token on either side. */
function assertBindsUnitDir(fn: string, body: string): void {
  const bound = assignments(body).get('dir');
  if (bound === undefined || !bound.has('$BOX_UNIT_DIR')) {
    throw new Error(
      `install-census.test.ts: ${fn} no longer binds \`dir="$BOX_UNIT_DIR"\` — the \`$dir/\` scoping `
      + 'in this file is therefore unproven. Re-derive it; do NOT retype the unit census here.',
    );
  }
}

/**
 * Every unit file `_inst_units` places — THE SYSTEMD ARM, which is the whole of
 * that function's body: its first line delegates Darwin away
 * (`if [ "$CCD_OS" = darwin ]; then _inst_units_darwin; return $?; fi`) to a
 * separate function this census does not read. Asserted, not assumed, because
 * an inline Darwin arm appearing here later would put launchd plist labels into
 * a systemd unit census.
 *
 * The Darwin side is out of scope on both sides deliberately: `_uninst_units`'
 * Darwin arm removes `$(_svc_label "$u").plist`, a name computed by a shell
 * function at runtime, which no text scan can resolve and which is not what
 * `_inst_units` writes anyway.
 */
function placedUnits(): Set<string> {
  const body = fnBody('_inst_units');
  assertBindsUnitDir('_inst_units', body);
  if (!/if \[ "\$CCD_OS" = darwin \]; then _inst_units_darwin; return \$\?; fi/.test(body)) {
    throw new Error(
      'install-census.test.ts: _inst_units no longer delegates its Darwin arm to _inst_units_darwin '
      + 'on one line. This scan reads the whole body as the systemd arm on the strength of that '
      + 'delegation — re-scope it before trusting the unit census.',
    );
  }
  const local = assignments(body);
  const out = new Set<string>();
  for (const line of logicalLines(body)) {
    for (const m of line.matchAll(/_inst_atomic\s+"[^"]*"\s+"\$dir\/([^"]+)"/g)) {
      for (const c of resolveWord(m[1]!, local)) {
        const n = leafUnder(`${UNIT_PREFIX}${c}`, UNIT_PREFIX);
        if (n !== null) out.add(n);
      }
    }
  }
  return out;
}

/** `_uninst_units`' body with its Darwin arm cut out — see `placedUnits` for
 *  why that arm is out of scope on both sides. */
function uninstUnitsSystemdArm(): string {
  const body = fnBody('_uninst_units');
  const gate = '\n  if [ "$CCD_OS" = darwin ]; then\n';
  const i = body.indexOf(gate);
  if (i < 0 || body.indexOf(gate, i + 1) >= 0) {
    throw new Error(
      'install-census.test.ts: _uninst_units no longer opens exactly one Darwin arm with '
      + '`if [ "$CCD_OS" = darwin ]; then` at two-space indent — this slice has gone stale.',
    );
  }
  // The arm's own `fi` is the first line that is exactly two-space-indented
  // `fi`; its inner `if _have_systemctl` closes at four.
  const end = body.indexOf('\n  fi\n', i);
  if (end < 0) throw new Error('install-census.test.ts: _uninst_units\' Darwin arm has no two-space `fi` — slice stale');
  return body.slice(0, i) + body.slice(end);
}

/**
 * Every unit file `_uninst_units` removes by name.
 *
 * SCOPED TO `rm -f` — `rm -rf -- "$dir/claude-session@.service.d" "$slice"`
 * removes the two drop-in DIRECTORIES, which `_inst_units` creates with `mkdir`
 * and fills with `limits.conf`; neither directory is a unit file and neither is
 * this census's subject.
 */
function removedUnits(): Set<string> {
  const body = uninstUnitsSystemdArm();
  assertBindsUnitDir('_uninst_units', body);
  const local = assignments(body);
  const out = new Set<string>();
  for (const line of logicalLines(body)) {
    if (!/\brm\s+-f\s/.test(line)) continue;
    for (const w of line.split('||')[0]!.matchAll(/"\$dir\/([^"]*)"/g)) {
      for (const c of resolveWord(w[1]!, local)) {
        const n = leafUnder(`${UNIT_PREFIX}${c}`, UNIT_PREFIX);
        if (n !== null) out.add(n);
      }
    }
  }
  return out;
}

// ── the floors ────────────────────────────────────────────────────────────
//
// EVERY EXTRACTOR GETS ONE, and they are the point rather than decoration. A
// set comparison's characteristic failure is an extractor that silently matches
// nothing: `[...placed].filter((n) => !removed.has(n))` over an empty `placed`
// is `[]`, so BOTH directions pass and the suite reports green while measuring
// nothing at all. Each message below names the EXTRACTOR as the suspect, not
// the subject — a floor that reds is a statement about this file, not about
// `ccd/ccrc`.
//
// THE NUMBERS ARE DELIBERATELY BELOW TODAY'S COUNTS. A floor pinned AT the
// current count is a ratchet that reds the day a binary or a unit is
// legitimately retired — a false red, which this repository rates worse than an
// unpinned claim. Each is instead set just under the smallest count a
// STRUCTURALLY INTACT extractor could produce:
//
//   BIN_FLOOR = 5   `_inst_bins` places two names under no gate at all and at
//                   least six more inside its `[ "$CCD_OS" != darwin ]` arm.
//                   An extractor that stopped seeing inside that arm — the
//                   likeliest scoping mistake, and where most of the census
//                   lives — drops to 3, well under this. The brief's number.
//   UNIT_FLOOR = 8  `_inst_units` places five unit files outside any role gate
//                   (the role unit, the session template and the cap-scopes
//                   pair) and the rest inside `[ "$INST_ROLE" != server ]` /
//                   `= fleet` arms. An extractor blind to those arms reports 5,
//                   under this floor; one that also lost the `$role_unit`
//                   resolution reports 3.
const BIN_FLOOR = 5;
const UNIT_FLOOR = 8;

describe('ccd/ccrc: the install census and the uninstall census cannot drift apart', () => {
  it('every binary the install spine places is removed by the uninstall census', () => {
    const placed = new Set([...placedBins(), ...placedLinkBins()]);
    const removed = removedBins();
    expect(placedBins().size,
      'the _inst_bins extractor found too few placed binaries — it has gone stale, and a set '
      + 'comparison over an empty set passes vacuously')
      .toBeGreaterThan(BIN_FLOOR);
    expect(placedLinkBins().size,
      'the _inst_graphify_engine link extractor found no symlinked placement — it has gone stale; '
      + 'without it the removal census carries a name the placement census cannot explain')
      .toBeGreaterThanOrEqual(1);
    // The two names under no platform and no role gate: a count floor can be
    // met by garbage, and these two cannot be absent from any intact reading.
    expect(placed, 'the placement census lost `ccd` — the extractor is stale').toContain('ccd');
    expect(placed, 'the placement census lost the `ccrc` launcher — the extractor is stale').toContain('ccrc');
    expect(removed.size,
      'the _uninst_tree_bins extractor found too few removed binaries — it has gone stale')
      .toBeGreaterThan(BIN_FLOOR);

    expect([...placed].filter((n) => !removed.has(n)).sort(),
      'ccd/ccrc places these in $HOME/.local/bin and `ccrc uninstall` leaves them there — each is '
      + 'an orphan on every session\'s PATH for ever. Add them to `_uninst_tree_bins`\' `rm -f`.')
      .toEqual([]);
  });

  it('the uninstall census removes nothing the install spine does not place', () => {
    const placed = new Set([...placedBins(), ...placedLinkBins()]);
    const removed = removedBins();
    expect(removed.size,
      'the _uninst_tree_bins extractor found too few removed binaries — it has gone stale')
      .toBeGreaterThan(BIN_FLOOR);

    expect([...removed].filter((n) => !placed.has(n)).sort(),
      '`_uninst_tree_bins` removes these from $HOME/.local/bin and nothing in ccd/ccrc places them '
      + 'there — either the install spine lost a placement, or the uninstall names a file that was '
      + 'never ccrc\'s to remove.')
      .toEqual([]);
  });

  it('every unit file the install spine places is removed by the uninstall census', () => {
    const placed = placedUnits();
    const removed = removedUnits();
    expect(placed.size,
      'the _inst_units extractor found too few placed unit files — it has gone stale, and a set '
      + 'comparison over an empty set passes vacuously')
      .toBeGreaterThan(UNIT_FLOOR);
    expect(removed.size,
      'the _uninst_units extractor found too few removed unit files — it has gone stale')
      .toBeGreaterThan(UNIT_FLOOR);
    // The row where NEITHER side is a literal, asserted from `ccd/ccrc`'s own
    // array: `_inst_units` spells these two `$role_unit` and `_uninst_units`
    // spells them `${BOX_UNIT_NAMES[0]}`/`[1]`. If the resolver lost either
    // spelling the two sets would still compare equal — both would simply be
    // missing the pair — so the sets alone cannot pin this and these two
    // assertions do.
    for (const u of arrayElements('BOX_UNIT_NAMES')) {
      expect(placed, `the placement census lost ${u} — $role_unit no longer resolves`).toContain(u);
      expect(removed, `the removal census lost ${u} — \${BOX_UNIT_NAMES[n]} no longer resolves`).toContain(u);
    }

    expect([...placed].filter((n) => !removed.has(n)).sort(),
      '`_inst_units` writes these unit files and `_uninst_units` leaves them behind — an enabled '
      + 'timer whose binary the same uninstall removed fails 203/EXEC every interval, for ever. '
      + 'Add them to `_uninst_units`\' `rm -f` (and, unless they are template units, to its '
      + '`disable --now` loop).')
      .toEqual([]);
  });

  it('the uninstall census removes no unit file the install spine does not place', () => {
    const placed = placedUnits();
    const removed = removedUnits();
    expect(removed.size,
      'the _uninst_units extractor found too few removed unit files — it has gone stale')
      .toBeGreaterThan(UNIT_FLOOR);

    expect([...removed].filter((n) => !placed.has(n)).sort(),
      '`_uninst_units` removes these unit files and nothing in `_inst_units` writes them — either '
      + 'the install spine lost a placement, or the uninstall names a unit that was never ccrc\'s.')
      .toEqual([]);
  });
});
