// Release notes, read (D-5548, D-5549). L0: imports NOTHING.
//
// deploy/release-notes.mjs WRITES a release's body at release time; this file
// READS it back for the PWA's What's-new sheet and the Settings release rows.
// The format, line by line:
//
//     Changes since v0.0.287        (or "First release")
//
//     New                           (a group heading: one of RELEASE_NOTE_GROUPS)
//     - The command palette and shortcuts #626
//
//     …and 3 more changes           (only when the budget cut the list)
//
// or, for an empty range, the header then "No changes.". The two halves cannot
// import each other (the script runs on a bare Node with no TypeScript), so
// `server/test/release-notes.test.ts` pins the group list equal on both sides
// and round-trips a body through both.
//
// A BODY IS UNTRUSTED TEXT — whatever a release says, hand-edited ones
// included. Nothing here produces markup: a body that does not parse as the
// format above reads as `plain`, and the PWA renders either as text nodes.
// `pullUrl` builds a link from a NUMBER and the server's release source alone;
// no URL is ever taken from the text.

/** The groups, most important first — the order the generator spends its
 *  byte budget in, and the order the PWA shows them. */
export const RELEASE_NOTE_GROUPS = ['New', 'Fixed', 'Faster', 'Behind the scenes'] as const;
export type ReleaseNoteGroup = (typeof RELEASE_NOTE_GROUPS)[number];
/** The group the PWA folds by default: the changes nobody using ccrc sees. */
export const FOLDED_NOTE_GROUP: ReleaseNoteGroup = 'Behind the scenes';

export type ReleaseNotesRead =
  /** No body, or an empty one. */
  | { kind: 'none' }
  /** A body in some other shape (hand-written, or from before D-5548). */
  | { kind: 'plain'; text: string }
  | {
    kind: 'grouped';
    /** The tag the range starts after; `null` for a first release. */
    since: string | null;
    groups: Array<{ name: ReleaseNoteGroup; items: string[] }>;
    /** How many changes the budget left out; `null` when none were. */
    more: number | null;
    /** The range held no commits ("No changes."). */
    empty: boolean;
  };

const HEADER = /^Changes since (v\d{1,9}\.\d{1,9}\.\d{1,9})$/;
const FIRST = 'First release';
const MORE = /^…and (\d{1,6}) more changes?$/;
const EMPTY = 'No changes.';

function isGroup(line: string): line is ReleaseNoteGroup {
  return (RELEASE_NOTE_GROUPS as readonly string[]).includes(line);
}

const SPOOF = /[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

export function parseReleaseNotes(body: string | null | undefined): ReleaseNotesRead {
  if (typeof body !== 'string' || body.trim() === '') return { kind: 'none' };
  // Bidi overrides/isolates/marks and zero-width characters go before
  // anything else: a body (hand-written, or older than the generator's own
  // strip) must not reorder or hide text in the rendered notes.
  const text = body.replace(SPOOF, '');
  const plain = { kind: 'plain', text } as const;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const head = lines[0] ?? '';
  const m = HEADER.exec(head);
  if (m === null && head !== FIRST) return plain;
  const groups: Array<{ name: ReleaseNoteGroup; items: string[] }> = [];
  let current: { name: ReleaseNoteGroup; items: string[] } | null = null;
  let more: number | null = null;
  let empty = false;
  for (const line of lines.slice(1)) {
    if (line === '') { current = null; continue; }
    if (more !== null) return plain;             // nothing follows the trailer
    if (isGroup(line)) {
      if (groups.some((g) => g.name === line)) return plain;
      current = { name: line, items: [] };
      groups.push(current);
      continue;
    }
    if (line.startsWith('- ') && current !== null) { current.items.push(line.slice(2)); continue; }
    const mm = MORE.exec(line);
    if (mm !== null && current === null) { more = Number(mm[1]); continue; }
    if (line === EMPTY && groups.length === 0 && !empty) { empty = true; continue; }
    return plain;
  }
  if (groups.some((g) => g.items.length === 0)) return plain;
  return { kind: 'grouped', since: m === null ? null : m[1]!, groups, more, empty };
}

/** A line of notes split around its `#NNN` references, so a renderer can make
 *  each number a link and every other piece a text node. A `#` glued to a word
 *  (`page#3`) or to another `#` is not a reference. */
export type NotePiece = { text: string } | { pr: number };
const PR_REF = /(^|[^\w#&/])#(\d{1,7})(?![\w])/g;

export function splitPrRefs(line: string): NotePiece[] {
  const out: NotePiece[] = [];
  let at = 0;
  for (const m of line.matchAll(PR_REF)) {
    const start = (m.index ?? 0) + (m[1] ?? '').length;
    if (start > at) out.push({ text: line.slice(at, start) });
    out.push({ pr: Number(m[2]) });
    at = start + 1 + (m[2] ?? '').length;
  }
  if (at < line.length) out.push({ text: line.slice(at) });
  return out;
}

/** One GitHub owner or repo name: GitHub's own character set, at most 100, and
 *  never a name made only of dots (`..` would walk a URL up a segment, D-3196).
 *  The server's release-source reader (`server/src/config.ts`) and `pullUrl`
 *  below both ask this. */
export function isReleaseSourceName(v: unknown): v is string {
  return typeof v === 'string' && /^(?!\.+$)[A-Za-z0-9._-]{1,100}$/.test(v);
}

/** The pull-request page for `pr` in the release source the server reports
 *  (`UpdatesView.source`), or `null` when there is no usable source — an
 *  older server sends none — or `pr` is not a positive integer. Built from
 *  the number alone: nothing from a release body reaches the URL. */
export function pullUrl(source: { owner?: unknown; repo?: unknown } | null | undefined, pr: number): string | null {
  if (source == null || !isReleaseSourceName(source.owner) || !isReleaseSourceName(source.repo)) return null;
  if (!Number.isSafeInteger(pr) || pr <= 0) return null;
  return `https://github.com/${source.owner}/${source.repo}/pull/${pr}`;
}
