#!/usr/bin/env node
// release-notes.mjs — what a release says it changed (D-5548).
//
//   node deploy/release-notes.mjs --tag vX.Y.Z [--repo <dir>] [--out <file>]
//
// Lists the FIRST-PARENT commits between the previous release tag and --tag
// (`git log --first-parent prev..tag`: on `main` each one is a squash-merged
// PR, so its subject is the PR title) and writes one plain-English line per
// change, grouped by its conventional prefix — feat → New, fix → Fixed,
// perf → Faster, anything else → Behind the scenes — under a header naming the
// previous tag. Deviation refs `(D-…)` are dropped from each sentence and the
// trailing `(#NNN)` becomes a separate `#NNN` token. The whole stays under
// NOTES_BUDGET_BYTES, the least important lines going first, so the server's
// catalogue (`capNotes`, NOTES_CAP_BYTES) never has to cut it. The PWA reads
// the result back with `shared/release-notes.ts` — the format is written down
// there, and `server/test/release-notes.test.ts` holds the two halves equal.
//
// Called by deploy/release-main.sh's publish arm and by release.yml, which
// hand the file to `gh release create --notes-file`; deploy/release-notes-
// backfill.mjs calls it for releases cut before it existed.
//
// COMMIT TEXT IS UNTRUSTED DATA. It is read through `execFileSync` with an
// argv — never a shell — and is only ever a string here: never interpolated
// into a command, never evaluated, never written anywhere but the notes file.
// Every git argument this file passes is a fixed word or a tag that matched
// the release-tag shape first.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The groups, most important first, and the prefixes that land in each;
 *  `types: null` is the catch-all. The NAMES are `shared/release-notes.ts`'s
 *  RELEASE_NOTE_GROUPS (pinned equal by the test). */
export const NOTE_GROUPS = [
  { name: 'New', types: ['feat'] },
  { name: 'Fixed', types: ['fix'] },
  { name: 'Faster', types: ['perf'] },
  { name: 'Behind the scenes', types: null },
];
/** Under the server's NOTES_CAP_BYTES (4096, `server/src/update/catalogue.ts`)
 *  with room to spare, so the catalogue stores a body whole (pinned by the test). */
export const NOTES_BUDGET_BYTES = 3800;
const LINE_MAX = 240;
const RELEASE_TAG = /^v(\d{1,9})\.(\d{1,9})\.(\d{1,9})$/;
const PREFIX = /^([A-Za-z]+)(?:\([^()]*\))?!?:\s+/;
const TRAILING_PR = /\s*\(#(\d{1,7})\)\s*$/;
/** One deviation ref (`D-5523`, `D-B4-9`) or a range of them (`D-5466..D-5479`, `D-1–D-4`). */
const DREF = 'D-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*';
const DEVIATION = new RegExp(`^${DREF}(?:\\s*(?:\\.\\.|–|—)\\s*${DREF})?$`);

/** Control characters, bidi overrides/isolates/marks and zero-width
 *  characters out (a title must not reorder or hide text), runs of
 *  whitespace to one space. */
function clean(s) {
  return s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Each parenthetical loses its deviation refs; one left empty goes entirely. */
function stripDeviations(s) {
  return s.replace(/\s*\(([^()]*)\)/g, (whole, inner) => {
    const parts = inner.split(/[,;]\s*/).map((p) => p.trim()).filter((p) => p !== '');
    const kept = parts.filter((p) => !DEVIATION.test(p));
    if (kept.length === parts.length) return whole;
    return kept.length === 0 ? '' : ` (${kept.join(', ')})`;
  }).trim();
}

function capitalise(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function capLine(s) {
  const cps = Array.from(s);
  return cps.length <= LINE_MAX ? s : `${cps.slice(0, LINE_MAX - 1).join('').trimEnd()}…`;
}

/** One subject → `{ group, text, pr }`. */
export function noteFor(subject) {
  let s = clean(String(subject));
  let pr = null;
  const prm = TRAILING_PR.exec(s);
  if (prm !== null) {
    pr = Number(prm[1]);
    s = s.slice(0, prm.index);
  }
  const fallback = capLine(s);
  let group = NOTE_GROUPS[NOTE_GROUPS.length - 1].name;
  const pm = PREFIX.exec(s);
  if (pm !== null) {
    const type = pm[1].toLowerCase();
    group = (NOTE_GROUPS.find((g) => g.types !== null && g.types.includes(type)) ?? NOTE_GROUPS[NOTE_GROUPS.length - 1]).name;
    s = s.slice(pm[0].length);
  }
  const text = stripDeviations(s);
  return { group, text: text === '' ? fallback : capLine(capitalise(text)), pr };
}

const bytes = (lines) => Buffer.byteLength(`${lines.join('\n')}\n`, 'utf8');

/** The body for a range: `prev` the previous release tag (`null` for the
 *  first release), `subjects` its first-parent subjects, newest first. */
export function renderReleaseNotes({ prev, subjects }) {
  const lines = [prev === null ? 'First release' : `Changes since ${prev}`];
  if (subjects.length === 0) return `${[...lines, '', 'No changes.'].join('\n')}\n`;
  const notes = subjects.map(noteFor);
  const reserve = Buffer.byteLength('\n…and 999999 more changes', 'utf8');
  let omitted = 0;
  for (const g of NOTE_GROUPS) {
    const items = notes.filter((n) => n.group === g.name);
    let opened = false;
    for (const n of items) {
      if (omitted > 0) { omitted += 1; continue; }
      const line = `- ${n.text}${n.pr === null ? '' : ` #${n.pr}`}`;
      const next = opened ? [...lines, line] : [...lines, '', g.name, line];
      if (bytes(next) + reserve > NOTES_BUDGET_BYTES) { omitted += 1; continue; }
      lines.splice(0, lines.length, ...next);
      opened = true;
    }
  }
  if (omitted > 0) lines.push('', `…and ${omitted} more ${omitted === 1 ? 'change' : 'changes'}`);
  return `${lines.join('\n')}\n`;
}

/** Compare two release-shaped tags numerically: <0, 0, >0. */
function compareTags(a, b) {
  const x = RELEASE_TAG.exec(a).slice(1).map(Number);
  const y = RELEASE_TAG.exec(b).slice(1).map(Number);
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** The highest release-shaped tag strictly below `tag`, or `null`. */
export function previousReleaseTag(tags, tag) {
  let best = null;
  for (const t of tags) {
    if (!RELEASE_TAG.test(t) || compareTags(t, tag) >= 0) continue;
    if (best === null || compareTags(t, best) > 0) best = t;
  }
  return best;
}

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** The tags of `repo`, release-shaped ones only. */
export function releaseTags(repo) {
  return git(repo, ['tag', '--list', 'v*']).split('\n').filter((t) => RELEASE_TAG.test(t));
}

/** The notes body for `tag` in `repo`. Throws when `tag` is not a release tag
 *  of that repo — a caller decides whether a release ships without notes. */
export function releaseNotesFor({ repo, tag }) {
  if (!RELEASE_TAG.test(tag)) throw new Error(`not a release tag: ${tag}`);
  const tags = releaseTags(repo);
  if (!tags.includes(tag)) throw new Error(`${tag} is not a tag of ${repo}`);
  const prev = previousReleaseTag(tags, tag);
  const range = prev === null ? [`refs/tags/${tag}`] : [`refs/tags/${prev}..refs/tags/${tag}`];
  // `-z` with `%s`: one NUL-terminated subject per commit — a subject carries
  // no newline, and NUL is the one byte it cannot carry either.
  const out = git(repo, ['log', '--first-parent', '-z', '--format=%s', ...range, '--']);
  const subjects = out.split('\0').filter((s) => s !== '');
  return renderReleaseNotes({ prev, subjects });
}

function usage() {
  return 'usage: node deploy/release-notes.mjs --tag vX.Y.Z [--repo <dir>] [--out <file>] — the release notes for a tag: the first-parent commits since the previous release tag, grouped New / Fixed / Faster / Behind the scenes; written to --out, or stdout';
}

function main(argv) {
  let tag = null;
  let repo = process.cwd();
  let out = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { process.stdout.write(`${usage()}\n`); return 0; }
    if ((a === '--tag' || a === '--repo' || a === '--out') && i + 1 < argv.length) {
      const v = argv[i += 1];
      if (a === '--tag') tag = v; else if (a === '--repo') repo = resolve(v); else out = resolve(v);
      continue;
    }
    process.stderr.write(`release-notes: unknown or incomplete argument: ${a}\n${usage()}\n`);
    return 2;
  }
  if (tag === null || !RELEASE_TAG.test(tag)) {
    process.stderr.write(`release-notes: --tag must be a release tag (vX.Y.Z)\n${usage()}\n`);
    return 2;
  }
  let body;
  try {
    body = releaseNotesFor({ repo, tag });
  } catch (err) {
    process.stderr.write(`release-notes: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
  if (out === null) process.stdout.write(body); else writeFileSync(out, body);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
