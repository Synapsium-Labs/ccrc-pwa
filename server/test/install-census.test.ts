// `ccd/ccrc`'s install censuses against its own uninstall censuses, and
// against the fallback installer's placement census in `deploy/deploy.sh` —
// DERIVED FROM THE SOURCE ON EVERY SIDE, never from a list typed here.
//
// WHY THIS FILE EXISTS. `_uninst_tree_bins` and `_uninst_units` are hand-kept
// `rm -f` lists describing what `_inst_bins`, `_inst_graphify_engine` and
// `_inst_units` place. D-1347 is the shape this file closes: the install grew a
// name (`graphify`) and the removal list did not, and nothing noticed. Two later
// incidents usually counted with it are a DIFFERENT shape — D-2594 and the
// routing slice were the PROSE paragraph that counts the list going stale while
// the `rm -f` itself was right. This file reads commands, not prose, and does
// not catch that shape.
//
// It is not the first guard in server/test/ to compare two source-derived
// lists: `gen-wrappers.test.ts`'s D-93 case compares `_inst_bins`' placements
// against `TOOLCHAIN_EXECUTABLES`. It is the first over the UNINSTALL censuses.
//
// AND AGAINST `deploy/deploy.sh`, THE FALLBACK. `ccrc rollout` is the deploy
// path and `deploy.sh` the fallback, and it keeps a THIRD hand-kept placement
// census: `install_atomic … .local/bin/<name>` for binaries, and a
// `_unit_atomic … ~/.config/systemd/user/<unit>` chain for unit files. It
// ships by whole-directory `rsync`, so a name `ccrc install` grew still reached
// the box's `~/ccrc` tree, was never PLACED, and the fallback deploy exited 0
// — the four GPT-lane names, until Plan 2b-1 Task 7. The last describe below
// compares ONE WAY, install ⊆ deploy, and that is a decision, not an
// oversight: `deploy.sh` also places `ccrc-api` and `ccrc-models-probe`, which
// `ccrc install` places nowhere — a PRE-EXISTING divergence between the two
// installers, known and outside this guard, which the reverse would red on.
//
// THE RULE IS NO SILENT DROPS. Every word this file reads that lands in a census
// directory either resolves to a name or FAILS THE SUITE, naming the word and the
// function. A name the extractor cannot read would otherwise vanish from BOTH
// sides at once, and a comparison of two sets missing the same name is green.
// So a placement or removal whose NAME comes from a `for` loop variable
// (`"$bin/$n"`, `"$dir/$u"`) THROWS rather than being evaluated: this file is
// not a bash interpreter, and a loud refusal ("spell it literally, or teach
// this extractor") is the right trade against growing one. Two exclusions are
// rules rather than accidents, stated where they apply in `census` below: a
// name spelled with `$$` is a per-process staging name, and a path with a `/`
// below the census directory is a drop-in inside a subdirectory. They are not
// the only drops: every bullet under STATED SCOPE below (and under READING
// `deploy/deploy.sh`) is a further one this file makes on purpose — a verb,
// body, quoting or spelling it does not read — named there rather than hidden.
//
// HOW A WORD IS READ. Comments are cut first, by one quote-aware pass per line
// (`scanLine`): an unquoted trailing comment goes, and a whole-line comment
// becomes a BLANK line — commenting a line out is the commonest way to
// disable it, and a commented-out removal must not count as a removal. A
// comment opens where bash opens one, at a WORD-INITIAL `#`: at line start, or
// after UNESCAPED whitespace or one of `;&|(<>` (measured, bash 5: `true;# x`
// and `a|# x` are comments; `$(echo a)#b` and `{#` are not, so `)` and `{` stay
// out; `\;#x`, `\ #x` and `\\#x` are not either — a backslash-escaped
// character is part of a word, so the `#` after it is too).
// Backslash continuations are then joined, and a join never crosses a second
// newline, so a continuation into a comment or a blank line ends the command
// exactly where bash ends it. A command is recognised by its name standing as a
// word outside quotes (start of line, whitespace, or one of `;&|{(!` before
// it), and its operands are read as shell words (double-quoted, bare, or
// concatenated), up to the first unquoted operator or redirection. A variable
// resolves through THE ENCLOSING FUNCTION'S OWN assignments only — the union of
// every value that function gives it, counting a `name=` only where it stands
// outside quotes — and `${ARR[n]}` through the single file-scope `ARR=(…)`
// declaration. `${ARR[@]}` is read as N names only when it IS the whole word
// (or `${ARR[@]/#/prefix}`); inside a larger word, or in an assignment value,
// it THROWS, because bash prefixes only the first element there and an
// assignment joins them into one string. `$HOME` is never substituted: it is
// the literal root of the bin census's directory. The unit census's directory
// has two spellings, both read: `$BOX_UNIT_DIR` and its non-Darwin value, taken
// from that global's own assignment in `ccd/ccrc`. There is deliberately no file-scope scalar fallback. Measured
// before it was deleted: it changed no result on the tree as it stands; it let
// one function's locals resolve inside another, which turned three real defects
// green; and it caught one spelling — a unit named through a file-scope global —
// which the no-silent-drops rule now refuses loudly instead.
//
// THE SHAPE IS `gen-wrappers.test.ts:86-112`'s, EXTENDED, AND NO LONGER
// BYTE-IDENTICAL. That precedent reads `_inst_bins` with one regex over literal
// `"$bin/<name>"` spellings, which is right for it: it needs only the names
// spelled that way today. This file must RESOLVE — a destination written
// `"${bin}/x"`, `"$dst"`, bare, or across a line continuation is still a
// placement — so it takes the destination argument of each `_inst_atomic` call
// and resolves it. What is deliberately NOT inherited is that precedent's
// `.filter((n) => !n.includes('.'))`: correct THERE (`gen-wrappers.mjs`'s
// `ID_RE` never matches a dotted name), a blind spot HERE. Three of the names
// this census must carry are dotted (`ccd-usage-sweep.py`, `ccgpt-proxy.py`,
// `ccgpt-usage.py`), and the filter would drop all three from both sides at
// once — a green that says nothing about exactly the names the GPT-lane plan
// added. Do not add it back.
//
// NO NAME OF THE SUBJECT IS TYPED IN THIS FILE'S CODE AS A CENSUS. Comments
// name some, to explain. The code types two, `ccd` and `ccrc`, as anti-vacuity
// anchors — the tool and its launcher, which the install places on every
// platform and every role — and reads the `BOX_UNIT_NAMES` anchors out of the
// array `ccd/ccrc` declares. A third hand-kept copy of the census is the defect
// this guard exists to delete.
//
// AND THE SOURCES. The last describe reads the other argument of the same
// calls: every file `_inst_bins`, `_inst_units`, `_inst_files` and
// `_inst_units_darwin` copy OUT OF the placed tree (`"$tree/<path>"`, with
// `$role_unit` resolving to both its values), and every file `deploy.sh`'s
// `install_atomic` and `_unit_atomic` copy, must be TRACKED in this
// repository. `_inst_atomic` dies on a missing source by design, so a
// placement whose source no commit carries is an install that dies on every
// real tree — a release, `ccrc update`, a fresh checkout — while a fixture
// that stubs the file stays green. That is how D-3165's shape hid: two
// placements of files Plan 2b-2 has not written, green here and in the
// install suite, because the fixture tree stubbed both.
//
// STATED SCOPE — what this file does NOT read. Each is a declared limit, not a
// hidden one:
//   - Bodies. Placements are read from `_inst_bins` and `_inst_graphify_engine`
//     (bins) and `_inst_units` (units); removals from `_uninst_tree_bins` and
//     the systemd arm of `_uninst_units`. A placement made in any other function
//     — another install step, or a helper these call — is not read, and a
//     placement into any directory but the two census directories is not this
//     census's subject.
//   - Verbs. A placement is an `_inst_atomic` destination, or an `ln -s`
//     destination inside `_inst_graphify_engine` (and nowhere else). A removal
//     is an operand of `rm -f`, that exact flag word: `rm -rf` and `rm -fv` are
//     not read. `cp`, `install -m`, `mv`, `printf >` and redirection are not
//     read — so a link that reaches its final name by `mv` is not either.
//   - Quoting. Single quotes are read as if they were double quotes. Measured
//     when this was written: every one of the 69 `rm -f` lines in `ccd/ccrc`
//     double-quotes its operands, and none spells `rm -fv`.
//   - File-scope globals. With no scalar fallback, a word that STARTS with an
//     unresolved variable cannot be placed in a directory. On the placement
//     side that THROWS, because every placement those bodies make lands in a
//     census directory. On the removal side it is read as outside the census,
//     because `_uninst_tree_bins` legitimately removes four such words
//     (`$BOX_INSTALLED_FILE` and the node's three files) under `~/.ccrc`: so a
//     STALE removal spelled through a global is invisible to direction 2, and
//     a real placement whose only removal is spelled that way reds direction 1.
//   - Gates. Platform and role conditions are ignored on both sides: each
//     census is the union over every platform and role, as uninstall is.
//   - Directories. Drop-in directories (removed by `rm -rf`) and the files
//     inside them are excluded by the `/` rule, so a new drop-in directory that
//     is placed and never removed is not caught.
//   - Slicing. A function body ends at the first line after its signature that
//     is exactly `}` — not at a `}` that merely starts a longer line. Such a
//     line inside a function is already forbidden in writing, for this same
//     reason, by the paragraph above `_inst_shim` in `ccd/ccrc`.
//   - Darwin. `_inst_units_darwin`'s plist and `_uninst_units`' Darwin arm are
//     out of scope (that arm's names are computed by `_svc_label` at run time),
//     and so is the literal target `_uninst_tree_bins` checks the graphify link
//     against before removing it.
//   - The disable census reads literal `systemctl --user … disable --now` calls
//     only. `ccd/ccrc`'s `_svc_disable_now` helper and a separate stop-then-
//     disable are not read, and a system-manager `systemctl disable` (no
//     `--user`) is not a user-unit disable, so it does not count.
//   - Paths are normalised (`/./` and repeated `/` collapse, on both sides, so
//     `$bin/./x` is `x`), but `~/…` and a destination whose variable is bound
//     to the empty string are not read as names.
//   - `ln` is read in one form: its flags as one leading word containing `s`
//     (`-sfn`). `ln -f -s` and `ln --symbolic` are not read.
//   - A variable's values are a union over the whole function, not the value
//     it holds at the line that uses it: a removal through a variable that is
//     reassigned counts every value it was ever given.
//   - Brace expansion (`name.{timer,service}`) is read literally, and a loop
//     over a word-split variable (`for u in $list`) is read as one word.
//   - The disable loop is tracked as a flat stack of `for … do` / `done`
//     lines: a multi-line `while` nested inside it ends it early for this
//     reader.
//   - `arrayElements` reads the raw text between the parentheses: quoted
//     elements, comments and multi-line declarations are not understood.
//   - Every placed non-template unit is required in the `disable --now` loop. A
//     unit that must deliberately NOT be stopped (a slice) would red that case
//     — none exists; it would need its own rule when one does.
//   - Commands inside `echo` arguments and heredoc bodies are read as commands,
//     and a string or heredoc spanning lines is not modelled.
//   - `#` contexts the comment cut does not model, in both directions (measured,
//     bash 5). CUT here, not a comment to bash: a word-initial-looking `#`
//     inside `${…}` (`${v%%;#*}`), inside a `[[ … =~ … ]]` regex (`=~ (#)`),
//     or inside `(( … ))` — the rest of that line is invisible to this reader,
//     so a call hidden there is an escape. NOT cut, a comment to bash: a `#`
//     right after a subshell's or a case pattern's closing `)` (`(cd x)# …`,
//     `a)# …`) — `)` stays out of the opening set so that `$(…)#` is not cut —
//     so a call written in such a comment is read as made (a phantom `rm -f`
//     there would mask an orphan). Measured when written: none of the four
//     occurs in `ccd/ccrc` or `deploy/deploy.sh`.
//
// READING `deploy/deploy.sh`. The same machinery — `scanLine`, `calls`,
// `argAt`, `census` and its normalisation — and where that file's shape makes
// a rule above inapplicable, the rule it gets instead:
//   - Read lazily. The deploy.sh cases read the file on first use
//     (`deployText`), never at import, so a tree without it reds those cases
//     alone and the ccd/ccrc describe still reports its own verdicts.
//   - Remote scripts. Its unit chain and its enables live inside single-quoted
//     assignments (`AGENT_BUILD_CMD='…'` and its siblings) that span lines and
//     are run on the box by ssh. Read a line at a time, as above, such a string
//     is code on every line but its first — and on NONE of them when that first
//     line ends in `\`, because the join carries the open quote along. So an
//     assignment whose single quote is still open at the end of its line is
//     UNWRAPPED: its `NAME='` goes, and its lines up to the next `'` are read as
//     code, which on the box they are. The rest of the closing line is the
//     assignment's local tail (the server lane's health URL) and is not read.
//     Unwrapping is for those `NAME='…'` assignments only: an INLINE ssh
//     argument — double-quoted, or single-quoted on one line
//     (`"${SSH[@]}" "$BOX" '…'`) — is read under the per-line model, where its
//     commands sit inside quotes and are not read as calls.
//   - No silent drops, AT THE VERB. Those limits could lose a call without a
//     word, so every mention of `install_atomic` and `_unit_atomic` (their
//     definitions aside) and of the words `enable` and `reenable` in the file's
//     code, comments cut, must be one this reader reads as a call, or the suite
//     fails naming each line where the two disagree. So a verb in an inline ssh
//     argument reds BY DESIGN — a declared FALSE red for a legitimate call
//     there (move it into a remote-script assignment), the intended red for a
//     hidden one — and so does the bare word in prose inside a quoted string
//     (an echo message, a remedy). The count is compared line group by line
//     group, not only in total, and mentions are counted on each line's
//     DEQUOTED form (quotes and backslash escapes removed, as bash removes
//     them), so `en""able` and `en\able` count as `enable`: an unread mention
//     cannot be balanced by a read call spelled so the count misses it, within
//     a group or across groups. Measured when written: every `enable` in the
//     file's code is a `systemctl` operand, and no `reenable` appears.
//   - Known FALSE reds, each loud and each by design rather than modelled: a
//     `systemctl` spelled by absolute path (`/usr/bin/systemctl`) is not read
//     as the command; a remote-script assignment spelled `export NAME='…'` is
//     not unwrapped; a placement or enable through a loop variable or any
//     other `$` throws (Resolution, below).
//   - Resolution: NONE. Its placements sit at the top level of its two lanes,
//     not in functions (the launcher's, inside the helper both lanes call, is
//     spelled literally), so the enclosing-function rule has no function to
//     read, and the no-scalar-fallback rule above forbids reading file scope.
//     Every destination is taken as spelled: a `$` in one under a census
//     directory throws through `census`, and an array reference throws before
//     `resolveWord` could look it up in `ccd/ccrc`, the one file it reads
//     arrays from.
//   - Directories, typed as `BIN_DIR` is. `install_atomic`'s destination is
//     HOME-relative by its own contract (`.local/bin`, and `~/.local/bin`, the
//     same directory as the box's shell would spell it); `_unit_atomic`'s is
//     expanded on the box (`~/.config/systemd/user`, and
//     `$HOME/.config/systemd/user`, the spelling its `\x2d` drop-ins use).
//     Only `.local/bin`, `~/.config/…` and `$HOME/.config/…` are in use.
//   - Lanes. The file is read WHOLE — both lanes and every helper, called or
//     not — which is the Gates rule above: its two lanes ARE its role gate, and
//     each side of the comparison is the union over roles. Measured: the
//     launcher is placed only inside that helper and `ccrc.service` only in the
//     server lane, so a reading of the agent lane alone reds on both. The union
//     cannot see a ROLE mismatch: a unit `ccrc install` places only on the fleet
//     role and `deploy.sh` only in its server lane would pass.
//   - Destinations only, and text rather than execution. A placement's SOURCE
//     and MODE are not read (`install_atomic ccd/<other> .local/bin/<name> 644`
//     passes), and the STATED SCOPE rules above hold here too: a call behind a
//     gate that never fires, after an `exit` or a `return`, in a helper nothing
//     calls, or inside a heredoc used as a block comment still counts as made.
//   - graphify. `_inst_graphify_engine` is not on the install side of this
//     comparison, by function rather than by name: `deploy.sh` never builds the
//     venv that function's link points into — it leaves the whole engine step
//     to `ccrc install`, and runs its graphify skill installer only where
//     `~/.ccrc/graphify.pin` already exists — so a fallback that placed the
//     link would place a dangling one.
//   - Enables: every operand after `enable` or `reenable` (the same effect) in
//     a `systemctl` call, `--user` or not; one carrying a `$` throws. NOT read,
//     and so not refused: operands fed through `xargs`, `systemctl add-wants`,
//     a hand-made `*.wants/` symlink, `systemctl start` (which runs an instance
//     for this boot without enabling it), an operand after a mid-command
//     redirect (`enable --now 2>/dev/null x@y.timer`: argument reading stops at
//     the redirect), and an escaped `@` (`x\@y.timer`, read with its backslash).
//
// READING THE SOURCES (the last describe). The same machinery again, and:
//   - Bodies. In `ccd/ccrc`, the SOURCE argument of each `_inst_atomic` call in
//     the four functions named above. Other install steps copy out of the tree
//     too (`_inst_skills` through a loop variable, `_inst_graph_noise`,
//     `_inst_graphify_skill`, `_inst_stamp_shipped`, `_exp_ddns_units`) and are
//     not read. In `deploy.sh`, the first argument of every `install_atomic`
//     and `_unit_atomic` call, under the same no-silent-drops rule at the verb.
//   - What a source must be. In `ccd/ccrc`, it resolves under `$BOX_TREE_DIR/`
//     (the function binds `tree` to exactly that, or binds no `tree` at all), or
//     it carries `$$` — a per-process staging file the function generated in
//     that run (the launcher, the Darwin plist). In `deploy.sh`, it is a path
//     relative to the checkout (`install_atomic`, which runs from the repository
//     root) or under `~/ccrc/` (`_unit_atomic`, on the box, out of the tree the
//     rsync landed), or it is ONE variable the file assigns `"$(mktemp)"` — a
//     file the script generates (the stamp, the launcher, `accounts.sh`).
//     Anything else THROWS, naming the word: no silent drops.
//   - Tracked means listed by `git ls-files`: the index, which is HEAD on a
//     clean checkout (CI). On a working box a file `git add`ed but not yet
//     committed counts too. The case refuses to run, rather than pass, when
//     `git ls-files` fails.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const CCRC_PATH = path.resolve(here, '..', '..', 'ccd', 'ccrc');
const CCRC = readFileSync(CCRC_PATH, 'utf8');
const DEPLOY_PATH = path.resolve(here, '..', '..', 'deploy', 'deploy.sh');
let deployCache: string | undefined;
/** deploy.sh's text, read on FIRST USE and then kept — never at import, so a
 *  tree without the file reds the deploy.sh cases alone, by their own ENOENT,
 *  and the ccd/ccrc describe above them still reports its own verdicts. */
function deployText(): string {
  deployCache ??= readFileSync(DEPLOY_PATH, 'utf8');
  return deployCache;
}

/** The bin census's directory, as `ccd/ccrc` spells it. `$HOME` is never
 *  substituted, so this stays a literal root. */
const BIN_DIR = '$HOME/.local/bin';
/** The unit census's directory as `_inst_units` and `_uninst_units` bind `dir`
 *  to it (`bindsExactlyOnce` proves it): a file-scope global, and file-scope
 *  scalars are not resolved, so it stays a literal root. `unitDirs` adds its
 *  second spelling. */
const UNIT_DIR = '$BOX_UNIT_DIR';

/**
 * The unit census's directory in BOTH spellings `ccd/ccrc` can use: the global,
 * and that global's non-Darwin value, READ from its own assignment — never
 * typed here. A unit placed or removed at the expanded path is the same file,
 * and a census keyed on one spelling would neither count nor refuse it. The
 * Darwin value stays out, as the Darwin arms do (header).
 */
function unitDirs(): string[] {
  const m = [...CCRC.matchAll(/^if \[ "\$CCD_OS" = darwin \]; then\n  BOX_UNIT_DIR="[^"]*"\nelse\n  BOX_UNIT_DIR="([^"]*)"\nfi$/gm)];
  if (m.length !== 1) {
    throw new Error(
      'install-census.test.ts: expected exactly one `if [ "$CCD_OS" = darwin ]; then BOX_UNIT_DIR=… else '
      + `BOX_UNIT_DIR="…" fi\` block in ${CCRC_PATH}, found ${m.length} — this extractor has gone stale.`,
    );
  }
  return [UNIT_DIR, m[0]![1]!];
}

type Local = Map<string, Set<string>>;

// ── reading `ccd/ccrc` ────────────────────────────────────────────────────

/** One top-level function's body: `name() {` to the first line that is exactly `}`,
 *  with COMMENTS CUT before anything reads it — each line through `scanLine`,
 *  so an unquoted trailing comment goes, and a whole-line comment becomes a
 *  BLANK line rather than vanishing: removing the line would let a backslash
 *  continuation above it run on into the lines below, where bash ends it. */
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
  return CCRC.slice(i + sig.length, j).split('\n').map((l) => scanLine(l).code).join('\n');
}

/** Continuation lines joined, so a `rm -f … \` spanning six lines is one line.
 *  A join eats only the indentation after the newline, never a second newline:
 *  a continuation into a blank line (a blank one, or a comment `fnBody` cut to
 *  its indentation) ends the command there, exactly as bash ends it. */
function logicalLines(body: string): string[] {
  return body.replace(/\\\n[ \t]*/g, ' ').split('\n');
}

/**
 * THE ONE QUOTE-AWARE PASS over a line. It tracks single- and double-quote
 * state and returns (a) the line with an UNQUOTED trailing comment cut — a `#`
 * that starts a word (line start, or after an UNESCAPED, unquoted whitespace or
 * one of `;&|(<>`), outside quotes, as bash has it (header) — and (b) for each
 * offset of what is left, whether it sits outside quotes. `fnBody` uses (a);
 * command recognition and `assignments` use (b), so a diagnostic
 * `echo "dir=$dir"` is not a second binding. One line at a time: a string
 * spanning lines, a heredoc body and an `echo`'s arguments are not modelled,
 * and neither are the `#` contexts STATED SCOPE lists (header).
 *
 * `opens` is whether the NEXT character starts a word. A backslash-escaped
 * character never opens one: `\;` is a literal `;` inside a word, so the `#`
 * after it is inside that word too (`echo \;#x` prints `;#x`).
 */
function scanLine(line: string): { code: string; outside: boolean[] } {
  const outside: boolean[] = [];
  let dq = false;
  let sq = false;
  let opens = true;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    const top = !dq && !sq;
    if (top && c === '#' && opens) return { code: line.slice(0, i), outside };
    outside.push(top);
    if (sq) { if (c === "'") sq = false; opens = false; continue; }
    if (c === '\\') { outside.push(top); i++; opens = false; continue; }
    if (c === '"') dq = !dq; else if (c === "'" && !dq) sq = true;
    opens = top && /[\s;&|(<>]/.test(c);
  }
  return { code: line, outside };
}

/**
 * Every value each name is assigned in a function body. A MULTIMAP — the union
 * of every value, whatever gate it sits under — because `role_unit` is assigned
 * twice in `_inst_units` (`ccrc.service`, then `ccrc-agent.service` under the
 * fleet gate) and BOTH are placements. Quoted and bare forms both.
 *
 * A TEXT SCAN, NOT A PARSE, with one guard: a `name=` counts only where it
 * stands OUTSIDE quotes (`scanLine`), so `echo "dir=$dir"` is no binding. A
 * `name=value` inside a `$(…)` still counts, and a quoted value is cut at its
 * first inner quote — harmless for the names this file resolves, and `bin` and
 * `dir`, whose extra values would matter, must be bound exactly once.
 */
function assignments(body: string): Local {
  const out: Local = new Map();
  for (const line of logicalLines(body)) {
    const { outside } = scanLine(line);
    for (const m of line.matchAll(/(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)=(?:"([^"]*)"|([^\s;"'|&()]+))/g)) {
      const name = m[1]!;
      const value = m[2] !== undefined ? m[2] : m[3];
      if (value === undefined || !outside[m.index! + m[0].indexOf(name)]) continue;
      let set = out.get(name);
      if (set === undefined) { set = new Set(); out.set(name, set); }
      set.add(value);
    }
  }
  return out;
}

/** The elements of the one file-scope `NAME=(a b c)` declaration. */
function arrayElements(name: string): string[] {
  const all = [...CCRC.matchAll(new RegExp(`^${name}=\\(([^)]*)\\)`, 'gm'))];
  if (all.length === 0) {
    throw new Error(
      `install-census.test.ts: \${${name}[…]} names no file-scope \`${name}=(…)\` array in ${CCRC_PATH}. `
      + 'One of two: it is a FUNCTION-LOCAL array, which this census does not resolve (it reads only '
      + 'file-scope `NAME=(…)` arrays) — spell the elements literally; or the file-scope array it names '
      + 'was RENAMED or REMOVED — re-point the reference (or this extractor) at wherever it now lives.',
    );
  }
  if (all.length !== 1) {
    throw new Error(
      `install-census.test.ts: expected exactly one \`${name}=(…)\` declaration in ${CCRC_PATH}, `
      + `found ${all.length} — this extractor has gone stale.`,
    );
  }
  return all[0]![1]!.trim().split(/\s+/);
}

/**
 * A binding this file scopes a census by must have EXACTLY ONE value. `.has()`
 * alone would pass a function that also rebinds `bin` or `dir` under some gate
 * — which sends every placement under that gate to a directory the uninstall
 * never touches, while the census still reads them as the one it does.
 */
function bindsExactlyOnce(fn: string, local: Local, name: string, value: string): void {
  const bound = local.get(name);
  if (bound === undefined || bound.size !== 1 || !bound.has(value)) {
    throw new Error(
      `install-census.test.ts: ${fn} must bind \`${name}="${value}"\` and nothing else, and it binds `
      + `${bound === undefined ? 'nothing this scan can see' : [...bound].map((v) => `"${v}"`).join(', ')}. `
      + `The census this file reads out of ${fn} is scoped by that binding, so it is unproven — `
      + 're-derive it before trusting this suite.',
    );
  }
}

const REF = /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)(?:\[([0-9]+)\])?\}|([A-Za-z_][A-Za-z0-9_]*))/g;
const MAX_DEPTH = 4;

/**
 * Every concrete string a shell word may denote. `$name` and `${name}` resolve
 * through `local` (the enclosing function's own assignments); `${ARR[n]}` and
 * `${ARR[@]}` through `arrayElements` — `${ARR[@]}` ONLY when it is the whole
 * word (or `${ARR[@]/#/prefix}`): inside a larger word bash prefixes only the
 * first element, and in an assignment it joins them into one string, so
 * either THROWS rather than being read as a set.
 *
 * `$HOME`, an unbound name, and anything
 * past `MAX_DEPTH` are KEPT AS WRITTEN — so `census` sees the `$` and refuses —
 * with `${name}` normalised to `$name` where that means the same thing, so a
 * brace spelling cannot step outside a prefix match.
 *
 * THIS IS HOW THE ROW WHERE NEITHER SIDE IS A LITERAL IS READ. `_inst_units`
 * writes `"$dir/$role_unit"` and `_uninst_units` writes
 * `"$dir/${BOX_UNIT_NAMES[0]}"` and `[1]`: the same two units, spelled two ways,
 * both resolvable from `ccd/ccrc`'s own text.
 */
function resolveWord(word: string, local: Local, depth = 0): Set<string> {
  if (/\$\{[A-Za-z_][A-Za-z0-9_]*\[@\]/.test(word)) {
    const whole = depth === 0 ? /^\$\{([A-Za-z_][A-Za-z0-9_]*)\[@\](?:\/#\/([^}]*))?\}$/.exec(word) : null;
    if (whole === null) {
      throw new Error(`install-census.test.ts: "${word}" expands \${…[@]} ${depth === 0
        ? 'inside a larger word: bash prefixes only the first element; index each element or use ${ARR[@]/#/prefix}'
        : 'in an assignment value: bash joins the elements into one string there; index each element'}`);
    }
    return new Set(arrayElements(whole[1]!).flatMap((el) => [...resolveWord((whole[2] ?? '') + el, local, depth + 1)]));
  }
  let outs = [''];
  let last = 0;
  for (const m of word.matchAll(REF)) {
    const lit = word.slice(last, m.index!);
    last = m.index! + m[0].length;
    const name = (m[1] ?? m[3])!;
    const index = m[2];
    let alts: string[];
    if (index !== undefined) {
      const el = arrayElements(name)[Number(index)];
      alts = el === undefined ? [m[0]] : [el];
    } else {
      const values = name === 'HOME' || depth >= MAX_DEPTH ? undefined : local.get(name);
      if (values === undefined) {
        alts = [/[A-Za-z0-9_]/.test(word.charAt(last)) ? m[0] : `$${name}`];
      } else {
        alts = [...values].flatMap((v) => [...resolveWord(v, local, depth + 1)]);
      }
    }
    outs = outs.flatMap((o) => alts.map((a) => o + lit + a));
  }
  const tail = word.slice(last);
  return new Set(outs.map((o) => o + tail));
}

/** The argument text of a simple command starting at `from`: up to its first
 *  unquoted operator or redirection (comments are already cut, by `fnBody`).
 *  A redirection's fd digit (`2>/dev/null`) is dropped with it. */
function argText(line: string, from: number): string {
  let dq = false;
  let sq = false;
  let i = from;
  for (; i < line.length; i++) {
    const c = line[i]!;
    if (sq) { if (c === "'") sq = false; continue; }
    if (c === '\\') { i++; continue; }
    if (dq) { if (c === '"') dq = false; continue; }
    if (c === '"') { dq = true; continue; }
    if (c === "'") { sq = true; continue; }
    if (';&|<>)'.includes(c)) break;
  }
  return line.slice(from, i).replace(/\s\d+$/, '');
}

/** Shell words, quotes removed: double-quoted, single-quoted and bare runs,
 *  concatenated where nothing separates them. */
function shellWords(text: string): string[] {
  return [...text.matchAll(/(?:"[^"]*"|'[^']*'|[^\s"'])+/g)].map((m) => m[0].replace(/["']/g, ''));
}

/** The argument words of every call of `cmd` in `body` made at command
 *  position, outside quotes. */
function calls(body: string, cmd: string): string[][] {
  const re = new RegExp(`(?:^|[\\s;&|{(!])${cmd}(?=\\s|$)`, 'g');
  const out: string[][] = [];
  for (const line of logicalLines(body)) {
    const { outside } = scanLine(line);
    for (const m of line.matchAll(re)) {
      const end = m.index! + m[0].length;
      if (!outside[end - cmd.length]) continue;
      out.push(shellWords(argText(line, end)));
    }
  }
  return out;
}

/** Operands after the options, `--` ending them. */
function operands(args: string[]): string[] {
  let i = 0;
  while (i < args.length && args[i]!.startsWith('-')) {
    i++;
    if (args[i - 1] === '--') break;
  }
  return args.slice(i);
}

/**
 * The names under any of `dirs` that `words` denote (`dir` below is whichever
 * of them the resolution starts with).
 *
 * Every word is resolved, and every resolution is either a name or a decision
 * stated here — never a silent drop:
 *   - under `dir/` with a leaf that still carries a `$`: THROWS. The leaf did
 *     not resolve from the function's own text — a loop variable, an unbound
 *     local, a command substitution.
 *   - under `dir/` with a leaf spelled with `$$`: a PER-PROCESS STAGING NAME.
 *     `$$` is the shell's PID, so the name cannot outlive the run that made it;
 *     `_inst_graphify_engine` stages its link swap at
 *     `$HOME/.local/bin/.graphify.tmp.$$` and `mv`s it onto the real name.
 *     Excluded by THIS rule, and only this one.
 *   - under `dir/` with a `/` left in the leaf: a file inside a subdirectory —
 *     a drop-in, such as `claude-session@.service.d/limits.conf`, whose
 *     directory the uninstall removes with `rm -rf`. Directories are out of
 *     scope (header), and so are the files in them.
 *   - not under `dir/`, but starting with an unresolved variable: nobody can
 *     say where it lands. A PLACEMENT throws (every placement these bodies make
 *     lands in a census directory); a REMOVAL is outside the census (header).
 *   - otherwise, not under `dir/`: somewhere else, and not this census's
 *     subject — `_uninst_tree_bins`' `~/.ccrc` files, the graphify link's
 *     target inside the venv.
 */
function census(fn: string, kind: 'placement' | 'removal', words: string[], dirs: string[], local: Local): Set<string> {
  const out = new Set<string>();
  const refuse = (word: string, why: string): never => {
    throw new Error(
      `install-census.test.ts: unresolvable ${kind} "${word}" in ${fn}: ${why}. Spell it literally, or `
      + 'teach this extractor — a name it cannot read would vanish from both sides of the comparison.',
    );
  };
  for (const word of words) {
    for (const raw of resolveWord(word, local)) {
      const p = path.posix.normalize(raw); // `$bin/./x`, `$bin//x`: the same file, on both sides
      const prefix = dirs.map((d) => `${d}/`).find((pre) => p.startsWith(pre));
      if (prefix === undefined) {
        if (kind === 'placement' && p.startsWith('$') && !p.startsWith('$HOME/')) {
          refuse(word, `it resolves to "${p}", which starts with a variable ${fn} does not bind, so where it lands is unknown`);
        }
        continue;
      }
      const leaf = p.slice(prefix.length);
      const unstaged = leaf.replaceAll('$$', '');
      if (leaf === '' || unstaged.includes('$')) {
        refuse(word, `it lands under ${prefix} but its name ("${leaf}") does not resolve from the assignments in ${fn}`);
      }
      if (unstaged !== leaf) continue; // `$$`: a per-process staging name
      if (leaf.includes('/')) continue; // inside a subdirectory: a drop-in
      out.add(leaf);
    }
  }
  return out;
}

/** The argument at `index` of each call — a destination, which must exist. */
function argAt(fn: string, cmd: string, all: string[][], index: number): string[] {
  return all.map((args) => {
    const w = args[index];
    if (w === undefined) {
      throw new Error(
        `install-census.test.ts: a \`${cmd}\` call in ${fn} has no argument ${index + 1} this extractor `
        + `can read (it read: ${JSON.stringify(args)})`,
      );
    }
    return w;
  });
}

/** The operands of every `rm -f` in a body. */
function rmFOperands(body: string): string[] {
  return calls(body, 'rm').filter((args) => args[0] === '-f').flatMap(operands);
}

// ── the censuses ──────────────────────────────────────────────────────────

/** Every name the destination argument of an `_inst_atomic` call in
 *  `_inst_bins` places in `$HOME/.local/bin`. */
function placedBins(): Set<string> {
  const fn = '_inst_bins';
  const body = fnBody(fn);
  const local = assignments(body);
  bindsExactlyOnce(fn, local, 'bin', BIN_DIR);
  return census(fn, 'placement', argAt(fn, '_inst_atomic', calls(body, '_inst_atomic'), 1), [BIN_DIR], local);
}

/**
 * The names `_inst_graphify_engine` places in `$HOME/.local/bin` as SYMLINKS —
 * the destination of each of its `ln -s` calls.
 *
 * WHY A SECOND PLACEMENT SOURCE RATHER THAN AN EXEMPTION. `_uninst_tree_bins`
 * removes the graphify link, so a removal census that sees it and a placement
 * census that does not would red the `removed ⊆ placed` direction on a row
 * that is correct. An exemption would protect one direction only, and would
 * need its own assertion that the exempted name is removed. Read as a
 * placement, `graphify` is an ordinary member of the placed set, so direction 1
 * asserts its removal like any other name, and a second `ln -s` added INSIDE
 * this function joins the census by itself. One added anywhere else is outside
 * the bodies this file reads (header).
 *
 * Its other `ln -s` stages the swap at `.graphify.tmp.$$`, which `census`
 * excludes by the `$$` rule — not by this function's scoping.
 */
function placedLinkBins(): Set<string> {
  const fn = '_inst_graphify_engine';
  const body = fnBody(fn);
  const links = calls(body, 'ln').filter((args) => /^-[A-Za-z]*s/.test(args[0] ?? '')).map((args) => {
    const ops = operands(args);
    if (ops.length !== 2) {
      throw new Error(
        `install-census.test.ts: an \`ln -s\` in ${fn} has ${ops.length} operands, not TARGET and LINK — `
        + `this extractor reads only that form (it read: ${JSON.stringify(args)})`,
      );
    }
    return ops[1]!;
  });
  return census(fn, 'placement', links, [BIN_DIR], assignments(body));
}

/** Every name an `rm -f` operand in `_uninst_tree_bins` removes from
 *  `$HOME/.local/bin`. Variables resolve, so `rm -f -- "$glink"` counts. */
function removedBins(): Set<string> {
  const fn = '_uninst_tree_bins';
  const body = fnBody(fn);
  return census(fn, 'removal', rmFOperands(body), [BIN_DIR], assignments(body));
}

/**
 * Every unit file an `_inst_atomic` destination in `_inst_units` places — the
 * systemd arm, which is the whole body: its first line delegates Darwin to
 * `_inst_units_darwin` and returns. Asserted, not assumed: an inline Darwin arm
 * appearing here later would put launchd names into a systemd census.
 */
function placedUnits(): Set<string> {
  const fn = '_inst_units';
  const body = fnBody(fn);
  if (!/if \[ "\$CCD_OS" = darwin \]; then _inst_units_darwin; return \$\?; fi/.test(body)) {
    throw new Error(
      'install-census.test.ts: _inst_units no longer delegates its Darwin arm to _inst_units_darwin '
      + 'on one line. This scan reads the whole body as the systemd arm on the strength of that '
      + 'delegation — re-scope it before trusting the unit census.',
    );
  }
  const local = assignments(body);
  bindsExactlyOnce(fn, local, 'dir', UNIT_DIR);
  return census(fn, 'placement', argAt(fn, '_inst_atomic', calls(body, '_inst_atomic'), 1), unitDirs(), local);
}

/** `_uninst_units`' body with its Darwin arm cut out (header: Darwin). */
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

/** Every unit file an `rm -f` operand in `_uninst_units`' systemd arm removes. */
function removedUnits(): Set<string> {
  const fn = '_uninst_units';
  const body = uninstUnitsSystemdArm();
  const local = assignments(body);
  bindsExactlyOnce(fn, local, 'dir', UNIT_DIR);
  return census(fn, 'removal', rmFOperands(body), unitDirs(), local);
}

/**
 * Every unit `_uninst_units`' systemd arm stops and disables — each operand of
 * a `systemctl … disable --now` call. An operand that is the variable of an
 * enclosing multi-line `for … in …; do` loop stands for that loop's words;
 * anything else resolves through the function's assignments. Every word must
 * resolve to a literal unit name, or this throws (no silent drops).
 */
function disabledUnits(): Set<string> {
  const fn = '_uninst_units';
  const body = uninstUnitsSystemdArm();
  const local = assignments(body);
  const loops: { name: string; list: string }[] = [];
  const out = new Set<string>();
  const resolveAll = (word: string, from: string): void => {
    for (const r of resolveWord(word, local)) {
      if (r.includes('$') || r.includes('/') || r === '') {
        throw new Error(
          `install-census.test.ts: unresolvable disable operand "${word}" (${from}) in ${fn} resolves to `
          + `"${r}". Spell it literally, or teach this extractor.`,
        );
      }
      // A resolved value with whitespace in it is SEVERAL units to bash, which
      // word-splits an unquoted `$x` — and one opaque name to this reader,
      // which would hide a template among them from the case that forbids one.
      if (/\s/.test(r)) {
        throw new Error(
          `install-census.test.ts: disable operand "${word}" (${from}) in ${fn} resolves to "${r}", which `
          + 'bash word-splits into several units and this reader would read as one. Spell each unit '
          + 'literally in the loop.',
        );
      }
      out.add(r);
    }
  };
  for (const line of logicalLines(body)) {
    const head = /^\s*for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+(.*?)\s*;\s*do\s*$/.exec(line);
    if (head !== null) { loops.push({ name: head[1]!, list: head[2]! }); continue; }
    if (/^\s*done\b/.test(line)) { loops.pop(); continue; }
    const { outside } = scanLine(line);
    for (const m of line.matchAll(/(?:^|[\s;&|{(!])systemctl(?=\s)/g)) {
      const end = m.index! + m[0].length;
      if (!outside[end - 'systemctl'.length]) continue;
      const args = shellWords(argText(line, end));
      const at = args.indexOf('disable');
      // `--user`: a system-manager disable is not a user-unit disable.
      if (at < 0 || !args.includes('--now') || !args.includes('--user')) continue;
      for (const op of args.slice(at + 1).filter((a) => !a.startsWith('-'))) {
        const v = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(op);
        const loop = v === null ? undefined : [...loops].reverse().find((l) => l.name === v[1]);
        if (loop !== undefined) {
          for (const w of shellWords(loop.list)) resolveAll(w, `a word of the loop over $${loop.name}`);
        } else {
          resolveAll(op, 'a direct operand');
        }
      }
    }
  }
  return out;
}

/** systemd's template spelling, `name@.suffix` — a rule of the unit naming
 *  scheme, not a list. */
const isTemplate = (unit: string): boolean => /@\.[A-Za-z]+$/.test(unit);

// ── reading `deploy/deploy.sh` (header: READING deploy.sh) ───────────────

/** How a refusal names deploy.sh. */
const DEPLOY_WHERE = 'deploy/deploy.sh';
/** Where `install_atomic` and `_unit_atomic` land a name, in every spelling
 *  each accepts (header: Directories). */
const DEPLOY_BIN_DIRS = ['.local/bin', '~/.local/bin'];
const DEPLOY_UNIT_DIRS = ['~/.config/systemd/user', '$HOME/.config/systemd/user'];

/**
 * deploy.sh's code as one script: every line through `scanLine`, which cuts
 * comments as `fnBody` does, and every single-quoted assignment still open at
 * the end of its line UNWRAPPED — its `NAME='` removed and its lines, up to
 * the next `'`, read as the code the box runs. A single-quoted string cannot
 * contain `'`, so the next one is its close, however many lines on.
 */
function deployCode(): string {
  const out: string[] = [];
  let open = false;
  for (const raw of deployText().split('\n')) {
    if (open) {
      const close = raw.indexOf("'");
      if (close >= 0) open = false;
      out.push(scanLine(close < 0 ? raw : raw.slice(0, close)).code);
      continue;
    }
    const { code } = scanLine(raw);
    const m = /^(\s*)[A-Za-z_][A-Za-z0-9_]*='([^']*)$/.exec(code);
    if (m === null) { out.push(code); continue; }
    open = true;
    out.push(scanLine(m[1]! + m[2]!).code);
  }
  if (open) {
    throw new Error(`install-census.test.ts: a single-quoted assignment in ${DEPLOY_PATH} never closes — this reader has gone stale`);
  }
  return out.join('\n');
}

/**
 * `deployCode`'s lines grouped the way `logicalLines` joins them — a line that
 * ends in `\` runs on into the next — each group with its first line's number
 * (1-based; `deployCode` keeps one line per line of the file), so a count taken
 * per group can be traced back to the lines it came from.
 */
function deployGroups(): { first: number; lines: number; text: string }[] {
  const out: { first: number; lines: number; text: string }[] = [];
  let buf: string[] = [];
  let first = 0;
  deployCode().split('\n').forEach((l, i) => {
    if (buf.length === 0) first = i + 1;
    buf.push(l);
    if (!l.endsWith('\\')) { out.push({ first, lines: buf.length, text: buf.join('\n') }); buf = []; }
  });
  if (buf.length > 0) out.push({ first, lines: buf.length, text: buf.join('\n') });
  return out;
}

/**
 * THE NO-SILENT-DROPS RULE, AT THE VERB (header). The mentions of `word` in
 * deploy.sh's code — comments cut a line at a time, nothing unwrapped and
 * nothing dropped, `word()` definitions aside — must be exactly what `readIn`
 * says this reader takes out of the same lines of `deployCode`, group by
 * group. Where they differ, the refusal NAMES each line carrying an unread
 * mention: a call inside a string this reader does not unwrap, a call past a
 * remote script's closing quote, or the word in prose inside a quoted string.
 */
function everyMentionRead(word: string, readIn: (group: string) => number, as: string): void {
  const raw = deployText().split('\n').map((l) => scanLine(l).code);
  const re = new RegExp(`(?<![A-Za-z0-9_-])${word}(?![A-Za-z0-9_(-])`, 'g');
  // Counted on the DEQUOTED line — backslash escapes and quote characters
  // removed, as bash removes them from a word — so `en""able` is a mention of
  // `enable` here exactly as it is a call to bash (header). Removing them can
  // only ADD mentions, never lose one.
  const dequote = (l: string): string => l.replace(/\\(.)/g, '$1').replace(/["']/g, '');
  const said = raw.map((l) => [...dequote(l).matchAll(re)].length);
  const groups = deployGroups();
  // The per-group comparison below covers every line only while `deployCode`
  // keeps one line per line of the file; a reader that lost lines would leave
  // the mentions on them compared against nothing.
  const covered = groups.reduce((n, g) => n + g.lines, 0);
  if (covered !== raw.length) {
    throw new Error(
      `install-census.test.ts: deployCode() yields ${covered} line(s) for the ${raw.length} of ${DEPLOY_PATH} — `
      + 'it must keep one line per line, or this count cannot say where a mention went. This reader has gone stale.',
    );
  }
  let total = 0;
  let read = 0;
  const unread: number[] = [];
  for (const g of groups) {
    const at = Array.from({ length: g.lines }, (_, k) => g.first + k);
    const here = at.reduce((n, ln) => n + said[ln - 1]!, 0);
    const took = readIn(g.text);
    total += here;
    read += took;
    if (here !== took) {
      const carrying = at.filter((ln) => said[ln - 1]! > 0);
      unread.push(...(carrying.length > 0 ? carrying : [g.first]));
    }
  }
  if (unread.length > 0) {
    throw new Error(
      `install-census.test.ts: ${DEPLOY_PATH} names \`${word}\` ${total} time(s) outside comments and definitions, `
      + `and this reader reads ${read} ${as} — and line by line the two disagree at: `
      + unread.map((ln) => `line ${ln} ${JSON.stringify(raw[ln - 1]!.trim().slice(0, 120))}`).join('; ')
      + '. (The count is taken on each line\'s dequoted form, so `en""able` is a mention; equal totals '
      + 'across the file can still disagree group by group.) A CALL there sits inside a '
      + 'string this reader does not unwrap, or past a remote script\'s closing '
      + 'quote, and would lose what it places or enables without a word: teach this reader, or move the call '
      + 'into a remote-script assignment where it reads. PROSE there (the word in an echo message or a remedy, '
      + `inside a quoted string) is read as a mention too: reword it so the bare word \`${word}\` does not appear.`,
    );
  }
}

/** Every name the destination argument of a `cmd` call in deploy.sh lands in
 *  one of `dirs` — through `census`, resolving nothing (header: Resolution). */
function deployPlaced(cmd: 'install_atomic' | '_unit_atomic', dirs: string[]): Set<string> {
  const all = calls(deployCode(), cmd);
  everyMentionRead(cmd, (g) => calls(g, cmd).length, 'call(s) of it');
  const dests = argAt(DEPLOY_WHERE, cmd, all, 1);
  const array = dests.find((d) => /\$\{[A-Za-z_][A-Za-z0-9_]*\[/.test(d));
  if (array !== undefined) {
    throw new Error(
      `install-census.test.ts: unresolvable placement "${array}" in ${DEPLOY_WHERE}: an array reference, and `
      + 'this reader resolves nothing in that file (`resolveWord` would read the array out of ccd/ccrc). '
      + 'Spell it literally.',
    );
  }
  return census(DEPLOY_WHERE, 'placement', dests, dirs, new Map());
}

/** The `systemctl` verbs that enable a unit: `reenable` is disable-then-enable,
 *  the same effect. The ones that arm a unit another way are declared, not read
 *  (header: Enables). */
const ENABLE_VERBS = ['enable', 'reenable'];

/** Every operand after an `ENABLE_VERBS` verb in a `systemctl` call in
 *  deploy.sh, `--user` or not. Each must be a literal unit name, or this
 *  throws: an operand it cannot read could be a template. */
function deployEnabled(): Set<string> {
  const verbAt = (args: string[]): number => args.findIndex((a) => ENABLE_VERBS.includes(a));
  const all = calls(deployCode(), 'systemctl').filter((args) => verbAt(args) >= 0);
  for (const verb of ENABLE_VERBS) {
    everyMentionRead(verb,
      (g) => calls(g, 'systemctl').reduce((n, args) => n + args.filter((a) => a === verb).length, 0),
      `\`systemctl … ${verb}\` call(s)`);
  }
  const out = new Set<string>();
  for (const args of all) {
    for (const op of args.slice(verbAt(args) + 1).filter((a) => !a.startsWith('-'))) {
      if (op === '' || op.includes('$')) {
        throw new Error(
          `install-census.test.ts: unresolvable enable operand "${op}" in ${DEPLOY_WHERE}: this reader resolves `
          + 'nothing there, and an operand it cannot read could be a template. Spell it literally.',
        );
      }
      out.add(op);
    }
  }
  return out;
}

// ── reading the sources (header: AND THE SOURCES) ────────────────────────

/** The placed tree's root, as `ccd/ccrc` spells it: a file-scope global, so it
 *  stays a literal root exactly as `UNIT_DIR` does. */
const TREE_DIR = '$BOX_TREE_DIR';
/** The four bodies whose `_inst_atomic` sources are read (header: READING THE SOURCES). */
const SOURCE_FNS = ['_inst_bins', '_inst_units', '_inst_files', '_inst_units_darwin'];

/**
 * Every repository path the `_inst_atomic` SOURCE argument in `SOURCE_FNS`
 * reads out of the placed tree — `"$tree/<path>"` resolved through the
 * function's own assignments, so `$role_unit` counts as both its values. A
 * source with `$$` in it is a per-process staging file the function wrote in
 * that run, excluded by that rule alone; any other source that does not land
 * under the tree THROWS.
 */
function ccrcTreeSources(): Set<string> {
  const out = new Set<string>();
  for (const fn of SOURCE_FNS) {
    const body = fnBody(fn);
    const local = assignments(body);
    if (local.has('tree')) bindsExactlyOnce(fn, local, 'tree', TREE_DIR);
    for (const word of argAt(fn, '_inst_atomic', calls(body, '_inst_atomic'), 0)) {
      for (const raw of resolveWord(word, local)) {
        const p = path.posix.normalize(raw);
        if (p.startsWith(`${TREE_DIR}/`)) {
          const rel = p.slice(TREE_DIR.length + 1);
          if (rel === '' || rel.includes('$') || rel.startsWith('../')) {
            throw new Error(
              `install-census.test.ts: unresolvable source "${word}" in ${fn}: it resolves to "${p}", whose path in `
              + 'the tree does not resolve from that function\'s assignments. Spell it literally, or teach this '
              + 'extractor — a source it cannot read is a placement nobody checks ships.',
            );
          }
          out.add(rel);
        } else if (!p.includes('$$')) {
          throw new Error(
            `install-census.test.ts: source "${word}" in ${fn} resolves to "${p}", which is neither under `
            + `${TREE_DIR}/ (\`tree\`) nor a per-process \`$$\` staging file that function generates. Spell it `
            + 'as a path in the placed tree, or teach this extractor.',
          );
        }
      }
    }
  }
  return out;
}

/** The two roots a deploy.sh source may be read from (header: READING THE
 *  SOURCES): `install_atomic` runs on this machine from the repository root,
 *  `_unit_atomic` on the box, out of the tree the rsync landed at `~/ccrc`. */
const DEPLOY_SOURCE_ROOTS: Array<['install_atomic' | '_unit_atomic', string]> = [
  ['install_atomic', ''],
  ['_unit_atomic', '~/ccrc/'],
];

/**
 * Every repository path deploy.sh's `install_atomic` and `_unit_atomic` read
 * as a SOURCE. Resolution is NONE, as for its destinations: a source that is
 * ONE variable the file assigns `"$(mktemp)"` is a file the script generates
 * and is excluded by that rule alone; any other `$`, and any path outside its
 * root, THROWS.
 */
function deployTreeSources(): Set<string> {
  const code = deployCode();
  const out = new Set<string>();
  for (const [cmd, root] of DEPLOY_SOURCE_ROOTS) {
    everyMentionRead(cmd, (g) => calls(g, cmd).length, 'call(s) of it');
    for (const word of argAt(DEPLOY_WHERE, cmd, calls(code, cmd), 0)) {
      const v = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(word);
      if (v !== null && new RegExp(`(?:^|\\s)${v[1]!}="\\$\\(mktemp\\)"`, 'm').test(code)) continue;
      const p = path.posix.normalize(word);
      if (word.includes('$') || !p.startsWith(root) || /^(?:\/|~|\.\.\/|\.$)/.test(p.slice(root.length))) {
        throw new Error(
          `install-census.test.ts: unresolvable source "${word}" of a \`${cmd}\` call in ${DEPLOY_WHERE}: it is `
          + `neither a literal path ${root === '' ? 'relative to the repository root' : `under ${root}`} nor ONE `
          + 'variable this file assigns `"$(mktemp)"`. Spell it literally, or teach this reader.',
        );
      }
      out.add(p.slice(root.length));
    }
  }
  return out;
}

/** Every path `git ls-files` lists in this repository. It refuses to answer —
 *  never answers "nothing is tracked" — when git cannot read the index. */
function trackedFiles(): Set<string> {
  const r = spawnSync('git', ['-C', REPO, 'ls-files', '-z'], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(
      `install-census.test.ts: \`git -C ${REPO} ls-files\` exited ${String(r.status)} (${(r.stderr || '').trim()}). `
      + 'The tracked-source case needs this repository\'s index; it will not read a tree it cannot measure as tracked.',
    );
  }
  return new Set(r.stdout.split('\0').filter(Boolean));
}

// ── the floors ────────────────────────────────────────────────────────────
//
// A FLOOR GUARDS AGAINST AN EXTRACTOR THAT MATCHES NOTHING, or next to nothing
// — the characteristic failure of a set comparison, where an empty side makes
// both directions pass. It does NOT guard against a PARTIAL drop: an extractor
// that lost a class of names from both sides at once would still clear it.
// That is what the no-silent-drops rule is for, and the anchors, for the rows
// where a resolver could lose a name from both sides.
//
// The numbers are set well below the counts measured when they were chosen
// (2026-09-22: 12 placed and 13 removed bins, 19 placed and 19 removed units,
// 16 disabled) — 5 against 12, 8 against 16 and 19 — so retiring a few names is
// not a false red. They are not derived from the functions' gate structure. Each
// message names the EXTRACTOR as the first suspect — a floor that reds is far
// more likely a statement about this file than about `ccd/ccrc` — and names the
// other cause too, because it is the only other one a count can detect.
const BIN_FLOOR = 5;
const UNIT_FLOOR = 8;
// deploy.sh's placement extractors reuse those two (measured after Plan 2b-1
// Task 7: 14 binaries under `.local/bin`, 19 unit files), and its enables take
// a third, 4 against the 9 it makes.
const ENABLE_FLOOR = 4;
// The source readers (measured 2026-09-23, after the final review's fixes:
// 39 tree sources in `ccd/ccrc`'s four bodies, 48 in deploy.sh; `git ls-files`
// lists 1153 paths) take a fourth, and the tracked set a fifth, so an index
// git answered from the wrong directory cannot pass as one that tracks nothing.
const SOURCE_FLOOR = 15;
const TRACKED_FLOOR = 200;

const PLACED_BINS_READ = "_inst_bins' `_inst_atomic` destinations and _inst_graphify_engine's `ln -s` destinations";

describe('ccd/ccrc: the install census and the uninstall census cannot drift apart', () => {
  it('every binary the install spine places is removed by the uninstall census', () => {
    expect(placedBins().size,
      'the _inst_bins extractor found too few placed binaries — it has gone stale, unless the function it reads really lost most of them')
      .toBeGreaterThan(BIN_FLOOR);
    expect(placedLinkBins().size,
      'the _inst_graphify_engine link extractor found no symlinked placement — it has gone stale, unless that function really stopped placing one')
      .toBeGreaterThanOrEqual(1);
    const placed = new Set([...placedBins(), ...placedLinkBins()]);
    const removed = removedBins();
    expect(removed.size,
      'the _uninst_tree_bins extractor found too few removed binaries — it has gone stale, unless the function it reads really lost most of them')
      .toBeGreaterThan(BIN_FLOOR);

    expect([...placed].filter((n) => !removed.has(n)).sort(),
      `these are placed into ${BIN_DIR} (by ${PLACED_BINS_READ}) and no \`rm -f\` operand in `
      + '_uninst_tree_bins that this census can RESOLVE names them — an operand it cannot resolve '
      + '(a file-scope global, a `${x:?}` modifier) is not read as a removal. Add them to its '
      + '`rm -f`, spelled literally.')
      .toEqual([]);

    // Anchors, after the comparison: a count floor can be met by names that
    // are not the census, and the tool and its launcher cannot be absent from
    // any intact reading of an install that places both on every box.
    for (const anchor of ['ccd', 'ccrc']) {
      expect(placed,
        `the placement census does not contain \`${anchor}\`: either this extractor no longer reads `
        + `_inst_bins' placement of it, or _inst_bins no longer places it`)
        .toContain(anchor);
    }
  });

  it('the uninstall census removes nothing the install spine does not place', () => {
    const placed = new Set([...placedBins(), ...placedLinkBins()]);
    const removed = removedBins();
    expect(removed.size,
      'the _uninst_tree_bins extractor found too few removed binaries — it has gone stale, unless the function it reads really lost most of them')
      .toBeGreaterThan(BIN_FLOOR);

    expect([...removed].filter((n) => !placed.has(n)).sort(),
      `these are \`rm -f\` operands in _uninst_tree_bins under ${BIN_DIR} and no placement this file `
      + `reads (${PLACED_BINS_READ}) names them. One of three: a placement was deleted from those `
      + 'bodies, it moved somewhere this file does not read (header: STATED SCOPE), or the removal '
      + 'is stale.')
      .toEqual([]);
  });

  it('every systemd unit file the install spine places is removed by the uninstall census', () => {
    const placed = placedUnits();
    const removed = removedUnits();
    expect(placed.size,
      'the _inst_units extractor found too few placed unit files — it has gone stale, unless the function it reads really lost most of them')
      .toBeGreaterThan(UNIT_FLOOR);
    expect(removed.size,
      'the _uninst_units extractor found too few removed unit files — it has gone stale, unless the function it reads really lost most of them')
      .toBeGreaterThan(UNIT_FLOOR);

    expect([...placed].filter((n) => !removed.has(n)).sort(),
      'these are `_inst_atomic` destinations in _inst_units\' systemd arm and no `rm -f` operand in '
      + '_uninst_units\' systemd arm that this census can RESOLVE names them — an operand it cannot '
      + 'resolve (a file-scope global, a `${x:?}` modifier) is not read as a removal. Add them to '
      + 'that `rm -f`, spelled literally.')
      .toEqual([]);

    // THE ROW WHERE NEITHER SIDE IS A LITERAL, anchored to the array
    // `ccd/ccrc` declares. The comparison above cannot pin it alone: if the
    // resolver lost BOTH spellings (`$role_unit` here, `${BOX_UNIT_NAMES[n]}`
    // in the removal) the two sets would compare equal, both simply missing
    // the pair. After the comparison, so that a real orphan is reported as an
    // orphan rather than as a resolver fault.
    for (const u of arrayElements('BOX_UNIT_NAMES')) {
      expect(placed,
        `the placement census does not contain ${u} (a BOX_UNIT_NAMES element): either \`$role_unit\` `
        + 'no longer resolves to it, or _inst_units no longer places it')
        .toContain(u);
    }
  });

  it('the uninstall census removes no systemd unit file the install spine does not place', () => {
    const placed = placedUnits();
    const removed = removedUnits();
    expect(removed.size,
      'the _uninst_units extractor found too few removed unit files — it has gone stale, unless the function it reads really lost most of them')
      .toBeGreaterThan(UNIT_FLOOR);

    expect([...removed].filter((n) => !placed.has(n)).sort(),
      'these are `rm -f` operands in _uninst_units\' systemd arm and no `_inst_atomic` destination in '
      + '_inst_units names them. One of three: a placement was deleted from _inst_units, it moved '
      + 'somewhere this file does not read (header: STATED SCOPE), or the removal is stale.')
      .toEqual([]);

    for (const u of arrayElements('BOX_UNIT_NAMES')) {
      expect(removed,
        `the removal census does not contain ${u} (a BOX_UNIT_NAMES element): either `
        + '`${BOX_UNIT_NAMES[n]}` no longer resolves to it, or _uninst_units no longer removes it')
        .toContain(u);
    }
  });

  it('every non-template systemd unit the install spine places is stopped and disabled by the uninstall', () => {
    const placed = placedUnits();
    const disabled = disabledUnits();
    // Both floors: this case filters the PLACED set, so an empty one would
    // make it pass on its own however the disable census reads.
    expect(placed.size,
      'the _inst_units extractor found too few placed unit files — it has gone stale, unless the function it reads really lost most of them')
      .toBeGreaterThan(UNIT_FLOOR);
    expect(disabled.size,
      'the `disable --now` extractor over _uninst_units found too few units — it has gone stale, unless the function it reads really lost most of them')
      .toBeGreaterThan(UNIT_FLOOR);

    expect([...placed].filter((u) => !isTemplate(u) && !disabled.has(u)).sort(),
      'these are non-template `_inst_atomic` destinations in _inst_units and no `systemctl … disable '
      + '--now` operand in _uninst_units\' systemd arm names them. Add them to its `disable --now` loop.')
      .toEqual([]);
  });

  it('no template unit is a `disable --now` operand in the uninstall', () => {
    // A bare template name is never enabled, only its instances are, and
    // systemd refuses it for any runtime operation — so `disable --now` on one
    // fails at the `--now` stop, on every uninstall, for ever. `_uninst_units`
    // removes its template pair by `rm -f` only, and says so; this is that
    // ruling as a derived rule rather than one test's argv assertion.
    const disabled = disabledUnits();
    expect(disabled.size,
      'the `disable --now` extractor over _uninst_units found too few units — it has gone stale, unless the function it reads really lost most of them')
      .toBeGreaterThan(UNIT_FLOOR);

    expect([...disabled].filter(isTemplate).sort(),
      'these template units (`name@.suffix`) are `systemctl … disable --now` operands in '
      + '_uninst_units\' systemd arm. Remove them from that call: a template is removed by `rm -f` only.')
      .toEqual([]);
  });
});

describe('deploy/deploy.sh, the fallback installer, places everything `ccrc install` places', () => {
  // ONE WAY, install ⊆ deploy (header: AND AGAINST deploy.sh). Both floors in
  // each case: it filters the PLACED set, so an empty one would pass on its
  // own however deploy.sh reads, and an empty deploy side would red every name
  // for a reason that is this file's, not deploy.sh's.
  it('every binary _inst_bins places, deploy.sh places too', () => {
    const placed = placedBins();
    const deployed = deployPlaced('install_atomic', DEPLOY_BIN_DIRS);
    expect(placed.size,
      'the _inst_bins extractor found too few placed binaries — it has gone stale, unless the function it reads really lost most of them')
      .toBeGreaterThan(BIN_FLOOR);
    expect(deployed.size,
      'the deploy.sh `install_atomic` extractor found too few binaries under .local/bin — it has gone stale, unless deploy.sh really lost most of them')
      .toBeGreaterThan(BIN_FLOOR);

    expect([...placed].filter((n) => !deployed.has(n)).sort(),
      `these are placed into ${BIN_DIR} by _inst_bins' \`_inst_atomic\` destinations and no \`install_atomic\` `
      + `destination in ${DEPLOY_WHERE} places them under .local/bin, so a fallback deploy ships them into ~/ccrc `
      + 'and never onto PATH. Add `install_atomic ccd/<name> .local/bin/<name> 755` to its agent lane. '
      + '(_inst_graphify_engine\'s link is not compared — header: READING deploy.sh.)')
      .toEqual([]);
  });

  it('every systemd unit file _inst_units places, deploy.sh places too', () => {
    const placed = placedUnits();
    const deployed = deployPlaced('_unit_atomic', DEPLOY_UNIT_DIRS);
    expect(placed.size,
      'the _inst_units extractor found too few placed unit files — it has gone stale, unless the function it reads really lost most of them')
      .toBeGreaterThan(UNIT_FLOOR);
    expect(deployed.size,
      'the deploy.sh `_unit_atomic` extractor found too few unit files — it has gone stale, unless deploy.sh really lost most of them')
      .toBeGreaterThan(UNIT_FLOOR);

    expect([...placed].filter((u) => !deployed.has(u)).sort(),
      'these are `_inst_atomic` destinations in _inst_units\' systemd arm and no `_unit_atomic` destination in '
      + `${DEPLOY_WHERE} places them, in either lane's remote build command, so a fallback deploy ships them into `
      + '~/ccrc and systemd never sees them. Add `_unit_atomic ~/ccrc/deploy/systemd/<unit> '
      + '~/.config/systemd/user/<unit>` to the chain of the lane that runs the unit.')
      .toEqual([]);
  });

  it('deploy.sh enables no template unit, and no instance of a template either installer places', () => {
    // A bare template cannot be enabled, and an INSTANCE is not a deploy's to
    // arm: a session's is `ccd`'s, and a GPT lane's is the step that adopts the
    // lane (Plan 3). `ccrc install`'s `_inst_enable` arms neither. The families
    // are DERIVED from the templates the two installers place, not typed, so
    // this binds `claude-session@` today and any template either installer
    // places later. (`ccgpt-usage@` is placed by neither — `_inst_units` says
    // why — so it is no family here.)
    const enabled = deployEnabled();
    expect(enabled.size,
      'the `systemctl … enable` extractor over deploy.sh found too few units — it has gone stale, unless deploy.sh really stopped enabling most of them')
      .toBeGreaterThan(ENABLE_FLOOR);
    const templates = [...placedUnits(), ...deployPlaced('_unit_atomic', DEPLOY_UNIT_DIRS)].filter(isTemplate);
    expect(templates.length,
      'neither installer places a template unit, so the instance half of this case would check nothing — an extractor has gone stale')
      .toBeGreaterThan(0);
    const families = [...new Set(templates.map((t) => t.slice(0, t.indexOf('@') + 1)))];

    expect([...enabled].filter((u) => isTemplate(u) || families.some((f) => u.startsWith(f))).sort(),
      `these \`systemctl … enable\` operands in ${DEPLOY_WHERE} are a template unit (\`name@.suffix\`) or an `
      + `instance of one an installer places (${families.join(', ')}). Remove them from the enable chain: a template `
      + 'is placed and never enabled, and its instances are armed per session or per lane, not by a deploy.')
      .toEqual([]);
  });
});

describe('every file either installer copies out of the tree is tracked in this repository', () => {
  // Header: AND THE SOURCES. A placement whose source no commit carries dies
  // on every real tree; a fixture that stubs the file hides that (D-3165).
  const tracked = (): Set<string> => {
    const t = trackedFiles();
    expect(t.size, `\`git ls-files\` in ${REPO} listed too few paths — this is not the repository's index`)
      .toBeGreaterThan(TRACKED_FLOOR);
    return t;
  };

  it('every `$tree/<path>` source _inst_bins, _inst_units, _inst_files and _inst_units_darwin read is tracked', () => {
    const t = tracked();
    const sources = ccrcTreeSources();
    expect(sources.size,
      `the source extractor over ${SOURCE_FNS.join(', ')} found too few tree sources — it has gone stale, unless those functions really stopped placing most of them`)
      .toBeGreaterThan(SOURCE_FLOOR);

    expect([...sources].filter((p) => !t.has(p)).sort(),
      `these are \`_inst_atomic\` sources in ${SOURCE_FNS.join(', ')} under the placed tree, and \`git ls-files\` `
      + 'does not list them. `_inst_atomic` dies on a missing source, so every real tree — a release, `ccrc update`, '
      + 'a fresh checkout — fails the install there, while a fixture that stubs the file stays green. Commit the file '
      + 'in the same change that places it, or remove the placement.')
      .toEqual([]);

    // Anchors, after the comparison: the tool itself, and `$role_unit`'s two
    // values — the row where the source is not a literal, so a resolver that
    // lost it would lose it silently.
    expect(sources, 'the source census does not contain `ccd/ccd`: this extractor no longer reads _inst_bins\' placement of it')
      .toContain('ccd/ccd');
    for (const u of arrayElements('BOX_UNIT_NAMES')) {
      expect(sources, `the source census does not contain deploy/${u} (a BOX_UNIT_NAMES element): \`$role_unit\` no longer resolves to it in _inst_units' source`)
        .toContain(`deploy/${u}`);
    }
  });

  it('every source deploy.sh\'s `install_atomic` and `_unit_atomic` read is tracked', () => {
    const t = tracked();
    const sources = deployTreeSources();
    expect(sources.size,
      'the deploy.sh source extractor found too few sources — it has gone stale, unless deploy.sh really stopped placing most of them')
      .toBeGreaterThan(SOURCE_FLOOR);

    expect([...sources].filter((p) => !t.has(p)).sort(),
      `these are sources of \`install_atomic\` (repository-relative) or \`_unit_atomic\` (under ~/ccrc/) in ${DEPLOY_WHERE}, `
      + 'and `git ls-files` does not list them. Either helper aborts the lane on a missing source, so a fallback deploy '
      + 'from any clean checkout dies there. Commit the file in the same change that places it, or remove the placement.')
      .toEqual([]);

    expect(sources, 'the deploy.sh source census does not contain `ccd/ccd`: this reader no longer reads its placement')
      .toContain('ccd/ccd');
  });
});
