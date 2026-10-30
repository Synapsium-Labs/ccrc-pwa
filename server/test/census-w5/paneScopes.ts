// The pane scope's census (D-7303; ARCH-72, Task C5l; plan 2026-10-29-consolidation-k16-panescope-reader.md; spec
// K16, last bullet and Verdict). This plan's own module, as the W5 plans keep theirs: no task appends to
// `consolidationCensus.ts`, and this file is never re-exported. It imports that file's helpers and
// `census-w5/accountMarkers.ts`'s body splitter, never a copy. Its FIXTURE and REAL rows live in the sibling
// `paneScopes.test.ts`.
//
// FOUR QUERIES, all over ccd's shipped bash programs (`shippedBashPrograms`: `ccd/ccd` read with its library as one
// program, then `ccd/ccd-cap-scopes`, `ccd/ccd-scope-sweep`, `ccd/ccrc`, `ccd/ccrc-doctor-checks` and every sibling):
//   - `panescopeReaders`: the bodies that read `$REG/<id>.panescope` (the field through `_reg_get`/`_reg_get_to`/
//     `_reg_read`/`_reg_read_to`, or the path as a whole shell word on a line that is not a write);
//   - `panescopeWriters`: the bodies that write or remove it (`_reg_set … panescope`, or `rm`/`mv`/`mktemp`/`touch`/
//     `_plat_mv_notdir`/a redirection naming the path); `panescopeSuffixPurgers` reports apart the bodies that remove
//     every `$REG/<id>.<field>` through a suffix glob, which name no field and are not counted;
//   - `paneScopeListers`: the code lines that run `systemctl … list-units` with a `tmux-spawn-*.scope` pattern word,
//     each with its flags and whether its body acts;
//   - `paneScopeActs`: the `systemctl --user set-property` and `systemctl --user stop` lines of a body that lists.
//
// KNOWN WIDTH. A line is read one command segment at a time (split at `;`, `&&`, `||`, `|`, `$(`, `(`, `)` and
// backticks, quoted text masked first), and a segment's words are shell words with their quotes removed. The field
// token is the whole word `panescope` (so `_panescope_record` and `_panescope_proc_root` are names, not the field); a
// path is a word that is exactly `$REG/<anything>.panescope`, so a quoted sentence naming the marker is one word with
// spaces and never a path. Comments are code-stripped (`bashCodeOf`). A read or write assembled across lines, through
// a variable, an alias or `eval` is not seen. A function inside a `# ccrc:generated` region whose text equals
// `ccd/ccd`'s function of the same name is that function's copy and counts no site.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO, type CensusSite } from '../consolidationCensus.js';
import { bashBodies, ccdProgramBodies, maskQuoted, MARKER_WRITE_VERBS, shippedBashPrograms, type ProgramBody } from './accountMarkers.js';

/** One census site: `name` is `<file>#<function>`, or `<file>#<top-level>`; `line` and `text` are its first matching
 *  line. */
export interface PaneScopeSite extends CensusSite { readonly name: string }

/** One lister line: its body's name, whether it passes `--plain`, and whether its body acts on a listed unit. */
export interface PaneScopeLister extends PaneScopeSite { readonly plain: boolean; readonly acts: boolean }

/** The four registry readers the field query names. */
export const PANESCOPE_READ_VERBS: readonly string[] = ['_reg_get', '_reg_get_to', '_reg_read', '_reg_read_to'];

/** The pattern word a pane-scope lister passes to `list-units`. */
export const PANE_SCOPE_PATTERN = 'tmux-spawn-*.scope';

/** The marker's field token: not preceded or followed by a word character. */
const FIELD_TOKEN = /(?<![A-Za-z0-9_])panescope(?![A-Za-z0-9_])/;
/** The marker's path as a whole word, quotes removed: `$REG/…​.panescope` (or `${REG}/…`). */
const MARKER_PATH = /^\$\{?REG\}?\/\S*\.panescope$/;
/** A whole-registry suffix glob, quotes removed: `$REG/$id.*` (a leading-dot private family is another shape). */
const SUFFIX_GLOB = /^\$\{?REG\}?\/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?\.\*$/;

/** The leading words a segment may carry before its command, dropped: keywords, `!`, `{`, `}`, `[[`-free wrappers and
 *  assignments. */
const LEAD = /^(?:\s*(?:then|do|else|elif|if|while|until|!|\{|\}|command|builtin|exec|local|declare|readonly|export|[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)))+\s*/;

/** The command segments of one code line, cut where the masked line has a separator, so each keeps its quotes. */
function segmentsOf(code: string): string[] {
  const masked = maskQuoted(code);
  const out: string[] = [];
  const cut = /;|&&|\|\||\||\$\(|\(|\)|`/g;
  let at = 0;
  for (const m of masked.matchAll(cut)) { out.push(code.slice(at, m.index)); at = m.index! + m[0].length; }
  out.push(code.slice(at));
  return out.map((s) => s.trim()).filter((s) => s !== '');
}

/** A segment's shell words, quotes removed (an unbalanced quote keeps the rest of the segment as one word). */
function wordsOf(seg: string): string[] {
  const words = seg.replace(LEAD, '').match(/(?:"(?:\\.|[^"\\])*"?|'[^']*'?|[^\s"'])+/g) ?? [];
  return words.map((w) => w.replace(/^(['"])(.*)\1$/s, '$2').replace(/"|'/g, ''));
}

/** The words a segment WRITES: a write verb's operands, and each `>`/`>>` redirection's target. */
function writtenWords(seg: string): string[] {
  const w = wordsOf(seg);
  const out: string[] = [];
  if (w.length > 0 && MARKER_WRITE_VERBS.includes(w[0]!)) out.push(...w.slice(1));
  w.forEach((word, i) => {
    const r = /^\d?>>?(.*)$/.exec(word);
    if (!r || word.startsWith('>&') || /^\d?>>?&/.test(word)) return;
    const target = r[1] !== '' ? r[1]! : (w[i + 1] ?? '');
    out.push(target);
  });
  return out;
}

/** True when a segment is `_reg_set <id> panescope …`. */
const setsField = (seg: string): boolean => { const w = wordsOf(seg); return w[0] === '_reg_set' && w[2] === 'panescope'; };
/** True when a segment reads the field through one of the four readers (the field is the id's next word, or the
 *  word after the variable for a `_to` form). */
const readsField = (seg: string): boolean => {
  const w = wordsOf(seg);
  if (!PANESCOPE_READ_VERBS.includes(w[0] ?? '')) return false;
  const fieldAt = w[0]!.endsWith('_to') ? 3 : 2;
  return w[fieldAt] === 'panescope';
};
/** True when a segment names the marker's path as a whole word. */
const namesPath = (seg: string): boolean => wordsOf(seg).some((w) => MARKER_PATH.test(w));
/** True when a segment writes or removes the marker. */
const writesMarker = (seg: string): boolean => setsField(seg) || writtenWords(seg).some((w) => MARKER_PATH.test(w));

/** Every body of every shipped bash program under `root`, generated copies of `ccd/ccd`'s functions passed over. A
 *  site is named `<program>#<function>`, or `<file>#<top-level>` (ccd's library has a top level beside `ccd/ccd`'s). */
function programBodies(root: string): Array<{ program: string; body: ProgramBody }> {
  const ccd = ccdProgramBodies(root);
  const ccdFns = new Map<string, string>();
  for (const b of ccd) if (b.fn && !ccdFns.has(b.name)) ccdFns.set(b.name, b.text);
  return shippedBashPrograms(root).flatMap((program) => {
    const bodies: ProgramBody[] = program === 'ccd/ccd'
      ? ccd
      : bashBodies(readFileSync(path.join(root, program), 'utf8')).map((b) => ({ ...b, file: program }));
    return bodies
      .filter((b) => program === 'ccd/ccd' || !(b.generated && ccdFns.get(b.name) === b.text))
      .map((body) => ({ program, body }));
  });
}

const siteName = (program: string, body: ProgramBody): string => `${body.fn ? program : body.file}#${body.name}`;

/** One site per body: the body's first line for which `hit` holds. */
function bodySites(root: string, hit: (code: string) => boolean): PaneScopeSite[] {
  const out: PaneScopeSite[] = [];
  for (const { program, body } of programBodies(root)) {
    const row = body.lines.find((r) => hit(r.code));
    if (row) out.push({ name: siteName(program, body), file: body.file, line: row.line, text: row.raw });
  }
  return out;
}

/** The marker's readers (D-7303): a field read through the four registry readers, or the marker's path on a line that
 *  writes no marker. One site per body. At base: 1, `ccd/ccd#_end_cause`. */
export function panescopeReaders(root: string = REPO): PaneScopeSite[] {
  return bodySites(root, (code) => {
    if (!FIELD_TOKEN.test(code)) return false;
    const segs = segmentsOf(code);
    if (segs.some(readsField)) return true;
    return !segs.some(writesMarker) && segs.some(namesPath);
  });
}

/** The marker's writers (D-7303): `_reg_set … panescope`, or a write verb or redirection naming the marker's path. One
 *  site per body. At base: 1, `ccd/ccd#_panescope_record` (two writing lines; `panescopeWriterLines` lists both). */
export function panescopeWriters(root: string = REPO): PaneScopeSite[] {
  return bodySites(root, (code) => FIELD_TOKEN.test(code) && segmentsOf(code).some(writesMarker));
}

/** Every writing line of the writer bodies, `<site name>` per line, so a body's second write is visible. */
export function panescopeWriterLines(root: string = REPO): PaneScopeSite[] {
  const out: PaneScopeSite[] = [];
  for (const { program, body } of programBodies(root)) {
    for (const r of body.lines) {
      if (FIELD_TOKEN.test(r.code) && segmentsOf(r.code).some(writesMarker)) out.push({ name: siteName(program, body), file: body.file, line: r.line, text: r.raw });
    }
  }
  return out;
}

/** The bodies that remove every `$REG/<id>.<field>` through a suffix glob (`for f in "$REG/$id".*` and an `rm` of the
 *  loop's variable): they name no field, so they are reported apart from `panescopeWriters` and never counted there.
 *  At base: 1, `ccd/ccd#_reg_purge`. */
export function panescopeSuffixPurgers(root: string = REPO): PaneScopeSite[] {
  const out: PaneScopeSite[] = [];
  for (const { program, body } of programBodies(root)) {
    const loops = new Map<string, { line: number; raw: string }>();
    for (const r of body.lines) {
      for (const m of r.code.matchAll(/\bfor\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([^;]*)/g)) {
        const words = wordsOf(m[2]!);
        if (words.some((w) => SUFFIX_GLOB.test(w))) loops.set(m[1]!, { line: r.line, raw: r.raw });
      }
    }
    if (loops.size === 0) continue;
    const removes = body.lines.some((r) => segmentsOf(r.code).some((seg) => {
      const w = wordsOf(seg);
      return w[0] === 'rm' && w.slice(1).some((op) => [...loops.keys()].some((v) => op === `$${v}` || op === `\${${v}}`));
    }));
    if (removes) {
      const first = [...loops.values()][0]!;
      out.push({ name: siteName(program, body), file: body.file, line: first.line, text: first.raw });
    }
  }
  return out;
}

/** True when a segment is `systemctl … list-units … tmux-spawn-*.scope …`. */
const listsPaneScopes = (seg: string): boolean => {
  const w = wordsOf(seg);
  return w[0] === 'systemctl' && w.includes('list-units') && w.includes(PANE_SCOPE_PATTERN);
};
/** The act a segment issues on a unit: `set-property` or `stop` under `systemctl --user`, else null. */
const actOf = (seg: string): 'set-property' | 'stop' | null => {
  const w = wordsOf(seg);
  if (w[0] !== 'systemctl' || w[1] !== '--user') return null;
  return w[2] === 'set-property' || w[2] === 'stop' ? w[2] : null;
};

/** The pane-scope listers (D-7303): every code line that runs `systemctl … list-units` with the `tmux-spawn-*.scope`
 *  pattern word, with its flags and whether its body also issues `set-property` or `stop`. At base: 4, two acting
 *  (`ccd/ccd-cap-scopes#<top-level>`, no `--plain`; `ccd/ccd-scope-sweep#<top-level>`, `--plain`) and two read-only
 *  (`ccd/ccrc-doctor-checks#_check_scopes` and `#_check_oom-policy`, no `--plain`). */
export function paneScopeListers(root: string = REPO): PaneScopeLister[] {
  const out: PaneScopeLister[] = [];
  for (const { program, body } of programBodies(root)) {
    const acts = body.lines.some((r) => segmentsOf(r.code).some((s) => actOf(s) !== null));
    for (const r of body.lines) {
      const seg = segmentsOf(r.code).find(listsPaneScopes);
      if (seg === undefined) continue;
      out.push({ name: siteName(program, body), file: body.file, line: r.line, text: r.raw, plain: wordsOf(seg).includes('--plain'), acts });
    }
  }
  return out;
}

/** The pane-scope acts (D-7303): each `systemctl --user set-property` or `systemctl --user stop` line in a body that
 *  lists pane scopes, named `<site>:<verb>`. At base: 2, `ccd/ccd-cap-scopes#<top-level>:set-property` (`--runtime`)
 *  and `ccd/ccd-scope-sweep#<top-level>:stop` (`--no-block`). */
export function paneScopeActs(root: string = REPO): PaneScopeSite[] {
  const out: PaneScopeSite[] = [];
  for (const { program, body } of programBodies(root)) {
    if (!body.lines.some((r) => segmentsOf(r.code).some(listsPaneScopes))) continue;
    for (const r of body.lines) {
      for (const seg of segmentsOf(r.code)) {
        const verb = actOf(seg);
        if (verb) out.push({ name: `${siteName(program, body)}:${verb}`, file: body.file, line: r.line, text: r.raw });
      }
    }
  }
  return out;
}
