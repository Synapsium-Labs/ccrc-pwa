// The resolver behind `anchors.test.ts` (D-TBD-named-anchors): pure functions over a map of
// repo-relative path -> text, so the census and its own rows read the same code.

/** A definition: a comment line that is only `@anchor name`. Line-anchored, so a string literal or
 *  prose that mentions the marker defines nothing. */
const DEF = /^\s*(?:\/\/|#|\*|<!--)\s*@anchor\s+([A-Za-z0-9_-]+)\s*(?:-->)?\s*$/;
/** A citation: a path with an extension (or the extensionless `ccd/…` executables), `#@`, a name. */
const CITE = /((?:[A-Za-z0-9_.-]+\/)*(?:[A-Za-z0-9_-]+\.[A-Za-z0-9]+|ccd\/[A-Za-z0-9_-]+))#@([A-Za-z0-9_-]+)/g;

/** The anchor names a text defines, in order, duplicates kept. */
export const anchorDefs = (text: string): string[] => {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const m = DEF.exec(line);
    if (m) out.push(m[1]!);
  }
  return out;
};

/** The `file#@name` citations a text makes. */
export const anchorCites = (text: string): Array<{ file: string; name: string }> =>
  [...text.matchAll(CITE)].map((m) => ({ file: m[1]!, name: m[2]! }));

/** Every way the corpus breaks the anchor rules; empty when it holds. */
export const anchorProblems = (files: ReadonlyMap<string, string>): string[] => {
  const problems: string[] = [];
  const defs = new Map<string, Set<string>>();
  for (const [f, text] of files) {
    const names = anchorDefs(text);
    const seen = new Set<string>();
    for (const n of names) {
      if (seen.has(n)) problems.push(`${f}: anchor "${n}" is defined twice`);
      seen.add(n);
    }
    defs.set(f, seen);
  }
  for (const [f, text] of files) {
    for (const c of anchorCites(text)) {
      if (!defs.get(c.file)?.has(c.name)) problems.push(`${f}: dangling citation ${c.file}#@${c.name}`);
    }
  }
  return problems;
};
