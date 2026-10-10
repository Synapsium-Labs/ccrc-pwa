// THE 34th COPY, REFUSED.
//
// `test/fleetFixture.ts` folded 33 hand-rolled `FleetSession` literals into
// one (386 lines out, 119 back). A comment asking the next person not to write
// a 34th is a request; this is the mechanism — and the repo's own doctrine says
// which of the two survives a wave (`single-definition.test.ts`, whose
// text-scan over four roots this is the pwa-test-tree sibling of).
//
// WHAT IT MEASURES, and why a FIELD COUNT rather than a name. A test that
// needs a row with three fields set is writing a fixture, not a copy; a test
// that spells out forty is restating the type. So the scan counts the fields
// of every object literal that carries the two keys only a full `FleetSession`
// has, and refuses one past the threshold. That lets a local literal exist for
// a genuinely different shape (a `RunSummary`, a partial row for a reducer)
// while making the restatement impossible to land by accident.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const DIR = path.join(import.meta.dirname);
const OWNER = 'fleetFixture.ts';
/** A literal with both of these is a `FleetSession`: nothing else in the wire
 *  carries `graphGateDenials`, and `releasedFrom` arrived with child
 *  reclamation. Two keys rather than one so a partial row cannot trip it. */
const MARKERS = ['graphGateDenials', 'releasedFrom'] as const;
/** The widest honest fixture: an id, a project, a workdir, a workspace, a
 *  status, a bucket and two facts the case is about. Past that it is the type
 *  being restated, which is what `fleetFixture` is for. */
const MAX_FIELDS = 12;

/** Top-level `key:` names of the object literal that opens at `src[open]`. */
const fieldsOf = (src: string, open: number): string[] => {
  let depth = 0;
  let end = open;
  for (let k = open; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) { end = k; break; } }
  }
  const body = src.slice(open + 1, end).replace(/\/\/[^\n]*/g, '');
  const names: string[] = [];
  let d = 0;
  let cur = '';
  const take = (): void => {
    const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(cur.trim());
    if (m) names.push(m[1]!);
  };
  for (const ch of body) {
    if ('{[('.includes(ch)) d++;
    if ('}])'.includes(ch)) d--;
    if (ch === ',' && d === 0) { take(); cur = ''; continue; }
    cur += ch;
  }
  take();
  return names;
};

describe('one FleetSession fixture, and the census that keeps it one', () => {
  const files = readdirSync(DIR).filter((f) => /\.tsx?$/.test(f) && f !== OWNER);

  it('no test file restates the wire type it could import', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(path.join(DIR, f), 'utf8');
      let from = 0;
      for (;;) {
        const hit = src.indexOf(MARKERS[0], from);
        if (hit < 0) break;
        from = hit + 1;
        // the literal that ENCLOSES this key
        let depth = 0;
        let open = -1;
        for (let k = hit; k >= 0; k--) {
          if (src[k] === '}') depth++;
          else if (src[k] === '{') { if (depth === 0) { open = k; break; } depth--; }
        }
        if (open < 0) continue;
        const names = fieldsOf(src, open);
        if (!MARKERS.every((m) => names.includes(m))) continue;
        if (names.length > MAX_FIELDS) offenders.push(`${f}: ${names.length} fields`);
      }
    }
    expect(offenders,
      `import { fleetSession } from './fleetFixture' and pass only the fields the case is about`)
      .toEqual([]);
  });

  it('and the owner really is the one that holds them all', () => {
    // NON-VACUITY. Without this the scan above passes on a tree where the
    // fixture was deleted and every caller rewritten to something else —
    // which is the same tree it is meant to forbid, reached from the far side.
    const src = readFileSync(path.join(DIR, OWNER), 'utf8');
    // The `({` that opens the RETURNED literal, not the `{}` of the
    // parameter default two tokens earlier.
    const open = src.indexOf('({', src.indexOf('fleetSession =')) + 1;
    const names = fieldsOf(src, open);
    for (const m of MARKERS) expect(names, `${OWNER} lost ${m}`).toContain(m);
    expect(names.length, 'the shared fixture stopped being the full literal')
      .toBeGreaterThan(MAX_FIELDS * 2);
  });

  it('every file that builds a session row uses it', () => {
    // The other direction: a file that imports the fixture is the shape this
    // census wants, and the COUNT is what says the fold actually happened
    // rather than that one file was tidied.
    const users = files.filter((f) =>
      /from '\.\/fleetFixture'/.test(readFileSync(path.join(DIR, f), 'utf8')));
    expect(users.length, 'the fold was reverted or the fixture renamed').toBeGreaterThanOrEqual(30);
  });
});
