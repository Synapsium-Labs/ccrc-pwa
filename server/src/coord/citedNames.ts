// Which names the operator's cited words name (Overlord spec C12; W2 relay plan
// `docs/superpowers/plans/2026-11-16-overlord-w2/w2-relay.md`, Task A2, RL8). Ring L1, context C5 (Coordination). Pure: no I/O,
// no clock. Its first caller is the relay door (Task A4), which hands it only the texts whose stored hash still matches (F3);
// nothing calls it at this tip (`relay-callers.test.ts`).
//
// ONE MATCHER. "Code checks this by a whole-token match against a project's name or a programme's slug" (C12). The tokens, the
// folding (NFKC, Unicode hyphens, default-ignorable characters, camelCase) and the whole-token rule are the private-name
// matcher's (`shared/private-names.mjs`): this file builds each name's entries with its `entryOf` and finds them with its
// `hitsAt` and `pairHits`, so a name is read here exactly as every other scan reads it. It holds no name list: the names are its
// argument, and it never logs or answers anything but the names it was given.
//
// THE ENTRIES. A name is matched `exact` (its tokens joined by the joiners it is written with: `programme-a`), and a name of two
// or more tokens also as `words` (its tokens joined by whitespace, a line break included: `programme a`). A name shorter than
// `CITED_NAME_MIN_CHARS` once folded, and the project `overlord`, never match (C12).
//
// ITS OWN KEY (slug `cited-names-under-their-own-key`). The plan builds the entries under the public salt. Under that salt the
// matcher caches, per process and without bound, the text of every window it hashes (`hashOf`), and here those windows are the
// operator's words. Under any other key it caches nothing, and the key does not change what matches. So the entries are built
// under `CITED_NAMES_KEY`, a committed constant like the salt, which keeps no text. The matcher's pair read also keeps the last
// line it read, which `citedNamesOf` clears before it returns.
import { entryOf, hitsAt, pairHits, tokens } from '../../../shared/private-names.mjs';

/** A name shorter than this many characters once folded never matches (C12). */
export const CITED_NAME_MIN_CHARS = 4;
/** The project the cited words never name (C12). */
const NEVER_NAMED = 'overlord';
/** The hash key of the entries built here: committed, so no secret, and not the public salt (see the header). */
const CITED_NAMES_KEY = 'ccrc-cited-names/v1';

type Entry = ReturnType<typeof entryOf>;

/** The entries of one name, or none when C12 says it never matches. */
function entriesOfName(name: string): readonly Entry[] {
  const folded = tokens(name).map((t) => t.t);
  if (folded.join('').length < CITED_NAME_MIN_CHARS) return [];
  if (folded.join('-') === NEVER_NAMED) return [];
  const exact = entryOf(name, 'exact', CITED_NAMES_KEY);
  return folded.length > 1 ? [exact, entryOf(name, 'words', CITED_NAMES_KEY)] : [exact];
}

/** RL8: the names, of those given, that the texts name by whole tokens, in the order given and each once. A name under four
 *  characters once folded and `overlord` never. An empty text names nothing. */
export function citedNamesOf(texts: readonly string[], names: readonly string[]): readonly string[] {
  const byId = new Map<string, Set<string>>();
  const entries: Entry[] = [];
  for (const name of names) {
    for (const en of entriesOfName(name)) {
      const id = en.h.slice(0, 8);
      const owners = byId.get(id) ?? new Set<string>();
      owners.add(name);
      byId.set(id, owners);
      entries.push(en);
    }
  }
  if (entries.length === 0) return [];
  const named = new Set<string>();
  const note = (id: string): void => { for (const n of byId.get(id) ?? []) named.add(n); };
  try {
    for (const text of texts) {
      for (const hit of hitsAt(text, entries, CITED_NAMES_KEY)) note(hit.h8);
      const lines = text.split('\n');
      for (let i = 1; i < lines.length; i++) for (const id of pairHits(lines[i - 1], lines[i], '', entries, CITED_NAMES_KEY)) note(id);
    }
  } finally {
    hitsAt('', entries, CITED_NAMES_KEY);   // the matcher's pair read keeps the last line it read: leave it empty, not a text
  }
  return names.filter((n, i) => named.has(n) && names.indexOf(n) === i);
}
