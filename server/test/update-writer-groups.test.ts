// Design 2026-09-20 §6 "Writer groups, as a scan over store.ts's SQL" and §18
// "one writer per column group" — with D-3183,
// D-3180 and D-3186, which each
// lean on this scan.
//
// Every prepared statement in server/src/coord/store.ts that WRITES one of the
// five update tables is sliced from `this.db.prepare(` to the call that runs it
// and attributed to the method it lives in by `mail-hardening.test.ts`'s
// single-line SIG walk-back (re-implemented here — a test file does not import
// another test file's internals). Every column the statement writes must
// belong to a group whose writers include that method.
//
// It scans TEXT, and says what that costs. A column list built at runtime
// (`${COLS.join(', ')}`) is unreadable to it and reds as an unowned column —
// the remedy is to spell the list in the statement, which is also what keeps
// "no SELECT *" true in this file. A write whose literal SQL text sits
// outside any `this.db.prepare(` window (a plain-literal `const`, an `exec`)
// reds as a stray line only when its verb and its table sit on ONE line —
// TABLE_WRITE_LINE is tested per LINE, so the same write with its verb and
// table split across lines is invisible to it (fix round 1, I-1b — the
// fourth shape below). A trailing `// …` comment on a
// CODE line that names a write (`UPDATE nodes …`) also reds as a stray: move
// that prose onto a comment line of its own. WRITE_VERB and TABLE_WRITE_LINE
// are both case-sensitive and require a bare table name, so on their own a
// lowercase verb, a quoted table name or a schema-qualified one
// (`update nodes …`, `UPDATE "nodes" …`, `UPDATE main.nodes …`) would pass
// with no statement, no problem and no violation (review fix round 1,
// finding 1) — `nonCanonicalWrites`, below, closes that gap by requiring
// every write-shaped mention of the five tables to be spelled in exactly
// this scan's canonical form. And `ROW_KEYS` excludes a row's key from an
// INSERT's column list — naming it is the row's creation, not a write to any
// group — so an INSERT naming ONLY the key left nothing for `violations` to
// iterate and passed for any method silently (finding 2); `violations` now
// attributes that shape too.
//
// WHAT STILL GETS PAST BOTH FIXES (fix round 1, F15 — the claim above is
// narrowed, not widened into a check, because store.ts already has
// legitimate non-literal `prepare(` calls elsewhere, e.g. `${OUTSTANDING_STATES_SQL}`,
// `${placeholders(…)}`, `${RUN_ROW_COLUMNS}`, `${TERMINAL_RUN_STATES_SQL}` —
// a blanket "every prepare( argument is a literal with no `${…}`" rule would
// red on those, so it is not added here). This scan reads a
// `this.db.prepare(` window's LITERAL text, and TABLE_WRITE_LINE reads one
// line at a time; it never evaluates JS, so FOUR shapes are invisible to it,
// measured directly against this file's own `scan`/`writeOf`/
// `nonCanonicalWrites`: a table name reached through a `${…}` interpolation
// inside the `prepare(` literal itself (`` `UPDATE ${T} SET yanked = 1 …` ``);
// the same SQL built the same way but assigned to a `const` first and passed
// as `prepare(q)` (no literal argument is left in the window for anything to
// read); a verb or table token split MID-WORD across concatenated literal
// fragments (`'UPD' + 'ATE …'`) — `sqlOf` joins fragments with a single
// space, which cannot repair a split inside a keyword; and a plain-literal
// `const`/`exec` OUTSIDE any `prepare(` window whose verb and table sit on
// DIFFERENT lines (fix round 1, I-1b, measured M-B) — the SAME text on one
// line still reds (M-C), and the same multi-line text INSIDE a `prepare(`
// window still reds too (M-D); only the outside-window, multi-line
// combination escapes. Each of the first three reproduces a rewritten
// `releases.yanked` write with zero statements, zero problems and zero
// violations; the fourth reproduces it with zero problems and, because no
// statement is attributed, zero violations either. Nothing in this file
// closes any of the four; what closes them today is a reviewer reading the
// diff, not a mechanism.
//
// None of the four also defeats "finds every W2 and W3 writer writing" (the test
// below) for a writer with more than one statement in this scan — six of
// the eleven W2_WRITERS do (`applyReleaseListing`, `upsertNodeMeasurement`,
// `markUnreachable`, `rekeyNode`, `ackNode`, `setIntent`): `found` is
// per-method, so rewriting only ONE of a multi-statement method's writes
// (measured, M-A: `applyReleaseListing`'s `releases.yanked` UPDATE, the
// exact example above) leaves that method "found" through its OTHER
// statement, and the check still passes — correctly, since the method is
// still visibly writing. The check is defeated only for a writer whose scan
// entry is a SINGLE statement, when that one statement is rewritten into one
// of the four shapes above.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openCoordDb } from '../src/coord/db.js';
import { mkTmp } from './tmpHelpers.js';

const ccrcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STORE_SRC = readFileSync(path.join(ccrcRoot, 'server/src/coord/store.ts'), 'utf8');

/** The column groups of spec §6's DDL comments, and the ONE method family that
 *  writes each. W4 adds `dispatchNode`/`requestNode` and W3
 *  `markReleaseNotified` to groups already named here — the contract those
 *  waves extend, not a list they re-derive. `'*'` = every column of the table. */
const WRITER_GROUPS: readonly { table: 'releases' | 'node_release_refusals' | 'nodes' | 'update_intent' | 'update_epoch';
  group: string; columns: readonly string[]; writers: readonly string[] }[] = [
  { table: 'releases', group: 'catalogue', columns: ['tag', 'version', 'channel', 'publishedAt', 'commitSha', 'tarballUrl',
      'bundleListed', 'notes', 'yanked', 'observedAt'], writers: ['applyReleaseListing'] },
  { table: 'releases', group: 'notification', columns: ['notifiedAt'], writers: ['markReleaseNotified'] },
  { table: 'node_release_refusals', group: 'refusal', columns: ['*'], writers: ['refuseRelease', 'clearRefusals', 'ackNode', 'rekeyNode'] },
  { table: 'nodes', group: 'measurement', columns: ['role', 'label', 'currentVersion', 'currentSha', 'currentRef',
      'currentBuiltAt', 'currentDirty', 'stampRead', 'installState', 'provenance', 'caps', 'agentOps', 'highestVersion',
      'previousVersion', 'floorRead', 'previousRead',
      'os', 'measuredAt', 'reachable', 'unreachableSince'], writers: ['upsertNodeMeasurement', 'markUnreachable'] },
  { table: 'nodes', group: 'report', columns: ['reportedPhase', 'reportedTarget', 'reportedStartedAt', 'reportedUpdatedAt',
      'reportedDetail'], writers: ['upsertNodeMeasurement'] },
  { table: 'nodes', group: 'lease', columns: ['updateState', 'updateTarget', 'updateStartedAt', 'updateDetail'],
      writers: ['dispatchNode', 'releaseLease', 'settleNode', 'ackNode'] },
  { table: 'nodes', group: 'resolved', columns: ['channel', 'desiredTag', 'resolveDetail'], writers: ['resolveNode'] },
  { table: 'nodes', group: 'request', columns: ['requestedTag', 'requestedKind', 'requestedAt'],
      writers: ['requestNode', 'settleNode', 'ackNode'] },
  { table: 'nodes', group: 'identity', columns: ['supersededBy', 'nodeId'], writers: ['rekeyNode'] },
  { table: 'update_intent', group: 'intent', columns: ['*'], writers: ['setIntent'] },
  { table: 'update_epoch', group: 'epoch', columns: ['*'], writers: ['setIntent'] },
];
type Table = (typeof WRITER_GROUPS)[number]['table'];
const TABLES: readonly Table[] = ['releases', 'node_release_refusals', 'nodes', 'update_intent', 'update_epoch'];
const isTable = (t: string): t is Table => (TABLES as readonly string[]).includes(t);

/** The key a row is created UNDER. Naming it in an INSERT's column list is the
 *  row's creation, not a write to the identity group — an INSERT of a node row
 *  must name `nodeId` — so it is excluded from INSERT column lists ONLY. A SET
 *  of the key (`UPDATE nodes SET nodeId = ?`, an upsert's `DO UPDATE SET`) is
 *  still the identity write it is. */
const ROW_KEYS: Readonly<Record<Table, readonly string[]>> = {
  releases: ['tag'], node_release_refusals: ['nodeId', 'tag'], nodes: ['nodeId'], update_intent: ['scope'], update_epoch: ['id'],
};

/** The W2 writers the scan must FIND writing — the floor. Without it, every
 *  assertion below is satisfied by an extractor that found nothing. */
const W2_WRITERS = ['applyReleaseListing', 'refuseRelease', 'clearRefusals', 'upsertNodeMeasurement', 'markUnreachable',
  'rekeyNode', 'releaseLease', 'settleNode', 'resolveNode', 'ackNode', 'setIntent'] as const;

/** The W3 writers the same floor requires (programme wave 3, Task 1): the
 *  notification group's writer — named in `WRITER_GROUPS` by W2, written by
 *  W3. A list of its own rather than an edit to W2's, so each floor entry
 *  says which wave put it there. Programme wave 5 (spec W4's dispatcher)
 *  appends `dispatchNode`/`requestNode` the same way. */
const W3_WRITERS = ['markReleaseNotified'] as const;

// ── the analyser ─────────────────────────────────────────────────────────────

/** Comment LINES blanked, not removed, so a line index still names the real
 *  line — `mail-hardening.test.ts`'s `blankComments`, for its reason. */
const blankComments = (src: string): string[] =>
  src.split('\n').map((l) => (/^\s*(\*|\/\*|\/\/)/.test(l) ? '' : l));
/** A single-line method signature at class-member indent. Single-line ON
 *  PURPOSE: a signature split across lines would attribute a statement to the
 *  PREVIOUS method; the `^  }` check below turns that into a named red. */
const SIG = /^ {2}(?:private |public |static |readonly )*([A-Za-z_$][\w$]*)\(.*\)\s*:\s*(.+?)\s*\{\s*$/;
const EXEC = /\.(?:run|get|all|iterate)\(/;
const LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
const WRITE_VERB = String.raw`(INSERT(?:\s+OR\s+[A-Z]+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+[A-Z]+)?|DELETE\s+FROM)\s+([A-Za-z_]\w*)`;
const TABLE_WRITE_LINE = new RegExp(
  String.raw`\b(?:INSERT(?:\s+OR\s+[A-Z]+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+[A-Z]+)?|DELETE\s+FROM)\s+(?:${TABLES.join('|')})\b`);

type Verb = 'INSERT' | 'UPDATE' | 'DELETE';
interface Write { table: Table; verb: Verb; columns: string[] }
interface Stmt extends Write { line: number; method: string }
interface Scan { stmts: Stmt[]; problems: string[] }

/** The SQL a window builds: every string literal's content, in order, a
 *  template's `${…}` read as a placeholder. */
const sqlOf = (code: string): string =>
  [...code.matchAll(LITERAL)]
    .map((m) => m[1] ?? m[2] ?? (m[3] ?? '').replace(/\$\{[^}]*\}/g, '?'))
    .join(' ');

/** Commas at paren depth 0 and outside a quoted SQL literal. */
const splitTopLevel = (s: string): string[] => {
  const out: string[] = [];
  let depth = 0; let quoted = false; let cur = '';
  for (const ch of s) {
    if (ch === "'") quoted = !quoted;
    if (!quoted && ch === '(') depth += 1;
    if (!quoted && ch === ')') depth -= 1;
    if (!quoted && depth === 0 && ch === ',') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
};

/** The columns a SET clause assigns (the text after `SET`, up to `WHERE`/
 *  `RETURNING`/the end). An item that is not `<ident> = …` is reported as an
 *  unparsed pseudo-column, which no group owns — a loud red, never a pass. */
const setColumns = (afterSet: string): string[] => {
  const body = /^([\s\S]*?)(?:\bWHERE\b|\bRETURNING\b|$)/.exec(afterSet)![1]!;
  return splitTopLevel(body).map((item) => /^\s*([A-Za-z_]\w*)\s*=/.exec(item)?.[1] ?? `<unparsed: ${item.trim()}>`);
};

/** What one statement writes, or null when it writes none of the five tables. */
const writeOf = (sql: string): Write | null => {
  for (const m of sql.matchAll(new RegExp(String.raw`\b${WRITE_VERB}`, 'g'))) {
    const table = m[2]!;
    if (!isTable(table)) continue;                        // `DO UPDATE SET` reads its "table" as SET
    const verbText = m[1]!;
    const after = sql.slice(m.index! + m[0].length);
    if (verbText.startsWith('DELETE')) return { table, verb: 'DELETE', columns: ['*'] };
    if (verbText.includes('REPLACE')) return { table, verb: 'INSERT', columns: ['*'] };   // a REPLACE deletes the row
    if (verbText.startsWith('UPDATE')) {
      const set = /^\s*SET\b/.exec(after);
      return { table, verb: 'UPDATE', columns: set === null ? ['<no SET clause>'] : setColumns(after.slice(set[0].length)) };
    }
    const list = /^\s*\(([^)]*)\)/.exec(after);
    const inserted = list === null ? ['*']
      : list[1]!.split(',').map((c) => c.trim()).filter((c) => !ROW_KEYS[table].includes(c));
    const upsert = /\bDO\s+UPDATE\s+SET\b/.exec(after);
    const updated = upsert === null ? [] : setColumns(after.slice(upsert.index + upsert[0].length));
    return { table, verb: 'INSERT', columns: [...inserted, ...updated] };
  }
  return null;
};

/** Review fix round 1, finding 1. `WRITE_VERB` and `TABLE_WRITE_LINE` above
 *  are both case-sensitive and require a bare, unqualified table name — a
 *  DELIBERATE choice, kept as-is: they parse the canonical form the scan
 *  attributes. This companion parses the same five verbs against the same
 *  five tables CASE-INSENSITIVELY, with an optional quote (`"`, a backtick or
 *  `[…]`) and an optional `main.` qualifier around the table name, and
 *  reports every match that is not spelled in EXACTLY the canonical form
 *  (an uppercase verb, a bare unquoted unqualified table name) — so a write
 *  the scan above cannot see is still not silent. It does not attempt to
 *  attribute a non-canonical write to a method or a column: that would
 *  duplicate the scan's own machinery for a shape store.ts is proven (below)
 *  never to contain. */
const CANONICAL_VERB_RE = /^(?:INSERT(?:\s+OR\s+[A-Z]+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+[A-Z]+)?|DELETE\s+FROM)$/;
// D4 (final fix wave): the qualifier's OWN quote is now inside the qualifier
// group (`(?:"|\x60|\[)?main(?:"|\x60|\])?\.`), so `main."nodes"` and
// `"main".nodes` — a table quoted AND qualified, either side quoted — are
// caught, not just an unquoted `main.nodes` or a quoted-unqualified
// `"nodes"`. The quote characters inside the qualifier are non-capturing:
// this scan is a loose net (it never required the open/close quote to
// match), and "was there a qualifier at all" is the only thing `qualifier`
// needs to answer for the canonical check below.
const NONCANONICAL_WRITE_RE = new RegExp(
  String.raw`\b(INSERT(?:\s+OR\s+[A-Za-z]+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+[A-Za-z]+)?|DELETE\s+FROM)\s+` +
  String.raw`((?:"|\x60|\[)?main(?:"|\x60|\])?\.)?("|\x60|\[)?(${TABLES.join('|')})("|\x60|\])?\b`,
  'gi',
);
/** D4: comments blanked FIRST, the same `blankComments` the main scan uses —
 *  so a docstring naming a non-canonical shape as an EXAMPLE (this very
 *  function's own comment, above, does) cannot false-red this analyser. */
const nonCanonicalWrites = (src: string): string[] => {
  const out: string[] = [];
  const code = blankComments(src).join('\n');
  for (const m of code.matchAll(NONCANONICAL_WRITE_RE)) {
    const [whole, verb, qualifier, openQ, table, closeQ] = m;
    const canonical = CANONICAL_VERB_RE.test(verb!) && !qualifier && !openQ && !closeQ && isTable(table!);
    if (!canonical) {
      const line = code.slice(0, m.index!).split('\n').length;
      out.push(`store.ts:${line}: non-canonical write shape ${JSON.stringify(whole)} — spell it as the scan requires (uppercase verb, bare table name)`);
    }
  }
  return out;
};

/** Every write to the five tables in `src`, attributed; plus every shape the
 *  attribution cannot vouch for. */
const scan = (src: string): Scan => {
  const rawLines = src.split('\n');
  const lines = blankComments(src);
  const code = lines.join('\n');
  const stmts: Stmt[] = [];
  const problems: string[] = [];
  const covered = new Set<number>();
  for (const m of code.matchAll(/this\.db\.prepare\(/g)) {
    const at = m.index!;
    const line = code.slice(0, at).split('\n').length;
    const e = EXEC.exec(code.slice(at));
    if (e === null) { problems.push(`store.ts:${line}: a prepare( never reaches an execution call`); continue; }
    const text = code.slice(at, at + e.index);
    const endLine = line + (text.match(/\n/g) ?? []).length;
    for (let l = line; l <= endLine; l += 1) covered.add(l);
    const w = writeOf(sqlOf(text));
    if (w === null) continue;
    if (rawLines.slice(line - 1, endLine).join('\n').includes('*/')) {
      problems.push(`store.ts:${line}: the ${w.table} window swallowed a docstring`);
    }
    let sigLine = 0;
    for (let i = line - 1; i > 0; i -= 1) { if (SIG.test(lines[i - 1]!)) { sigLine = i; break; } }
    if (sigLine === 0) { problems.push(`store.ts:${line}: no method signature above this ${w.table} write`); continue; }
    if (/^ {2}\}/m.test(lines.slice(sigLine, line - 1).join('\n'))) {
      problems.push(`store.ts:${line}: the walk-back crossed a method close — the signature of the method writing ${w.table} is not single-line`);
      continue;
    }
    stmts.push({ ...w, line, method: SIG.exec(lines[sigLine - 1]!)![1]! });
  }
  lines.forEach((l, i) => {
    if (TABLE_WRITE_LINE.test(l) && !covered.has(i + 1)) {
      problems.push(`store.ts:${i + 1}: writes an update table outside a this.db.prepare( window — spell the statement inline in the method that owns it`);
    }
  });
  return { stmts, problems };
};

/** Every column `s` writes that no group its method writes owns. */
const violations = (s: Stmt): string[] => {
  const groups = WRITER_GROUPS.filter((g) => g.table === s.table);
  const out: string[] = [];
  if (s.columns.includes('*')) {
    for (const g of groups) {
      if (!g.writers.includes(s.method)) {
        out.push(`${s.method} (store.ts:${s.line}) writes every column of ${s.table} (a ${s.verb} with no column list) — the ${g.group} group's writers are ${g.writers.join(', ')}`);
      }
    }
    return out;
  }
  // Review fix round 1, finding 2: `ROW_KEYS` excludes a row's key from an
  // INSERT's column list ONLY (naming it there is the row's creation, not a
  // write to any group), so an INSERT that names NOTHING ELSE — a
  // `INSERT OR IGNORE INTO releases (tag) VALUES (?)` shape — left `columns`
  // empty and this function had nothing to iterate below, passing for ANY
  // method silently. It still creates a row, so the method making it must
  // still be a writer of at least one of this table's groups.
  if (s.verb === 'INSERT' && s.columns.length === 0 && !groups.some((g) => g.writers.includes(s.method))) {
    out.push(`${s.method} (store.ts:${s.line}) inserts ${s.table} naming only its row key — no writer group of ${s.table} names ${s.method}`);
    return out;
  }
  for (const c of s.columns) {
    const owners = groups.filter((g) => g.columns.includes(c) || g.columns.includes('*'));
    if (owners.length === 0) {
      out.push(`${s.method} (store.ts:${s.line}) writes ${s.table}.${c}, which no writer group owns`);
    } else if (!owners.some((g) => g.writers.includes(s.method))) {
      out.push(`${s.method} (store.ts:${s.line}) writes ${s.table}.${c} — the ${owners.map((g) => g.group).join('/')} group's writers are ${owners.flatMap((g) => g.writers).join(', ')}`);
    }
  }
  return out;
};

const groupColumns = (table: Table, group: string): readonly string[] =>
  WRITER_GROUPS.find((g) => g.table === table && g.group === group)!.columns;

// ── the real store ───────────────────────────────────────────────────────────

describe('update writer groups — one writer per column group (design 2026-09-20 §6, §18)', () => {
  const { stmts, problems } = scan(STORE_SRC);
  const written = (method: string, table: Table): Set<string> =>
    new Set(stmts.filter((s) => s.method === method && s.table === table).flatMap((s) => s.columns));

  it('the groups partition every column of the five tables — a new column needs a group before it gets a writer', () => {
    const db = openCoordDb(path.join(mkTmp('ccrc-writer-groups-'), 'coord.db'));
    for (const t of TABLES) {
      const onDisk = (db.prepare(`PRAGMA table_info(${t})`).all() as unknown as { name: string }[])
        .map((r) => r.name).sort();
      expect(onDisk.length, `${t} is not in the migrated schema`).toBeGreaterThan(0);
      const groups = WRITER_GROUPS.filter((g) => g.table === t);
      if (groups.some((g) => g.columns.includes('*'))) {
        expect(groups, `${t}: a '*' group must be the table's only group`).toHaveLength(1);
        continue;
      }
      const named = groups.flatMap((g) => g.columns);
      expect(new Set(named).size, `${t}: a column sits in two groups`).toBe(named.length);
      expect([...named].sort(), `${t}: the writer groups and MIGRATIONS[13] disagree`).toEqual(onDisk);
    }
    db.close();
  });

  it('finds every W2 and W3 writer writing — a renamed table reds this, and so does rewriting a required writer\'s ONLY write into one of the header\'s four invisible shapes (a writer with more than one statement in the scan is unaffected, and a NEW illegitimate write built the same way would not red either — see header)', () => {
    const found = new Set(stmts.map((s) => s.method));
    for (const w of [...W2_WRITERS, ...W3_WRITERS]) {
      expect(WRITER_GROUPS.some((g) => g.writers.includes(w)), `${w} is in no writer group`).toBe(true);
      expect(found.has(w), `the scan found no statement of ${w} writing an update table`).toBe(true);
    }
  });

  it('store.ts carries no write the scan cannot attribute', () => {
    expect(problems).toEqual([]);
  });

  it('every column a statement writes is owned by a group its method writes', () => {
    expect(stmts.flatMap(violations)).toEqual([]);
  });

  it('upsertNodeMeasurement names no column outside the measurement and report groups (spec §6 Pins, verbatim)', () => {
    const allowed = new Set([...groupColumns('nodes', 'measurement'), ...groupColumns('nodes', 'report')]);
    const mine = stmts.filter((s) => s.method === 'upsertNodeMeasurement');
    expect(mine.length).toBeGreaterThan(0);
    for (const s of mine) {
      expect(s.table, `store.ts:${s.line}`).toBe('nodes');
      expect(s.columns.filter((c) => !allowed.has(c)), `store.ts:${s.line}`).toEqual([]);
    }
  });

  it('the ack path writes all three of its groups; settleNode clears the request; releaseLease never touches it (D-3183, spec §6 Pins)', () => {
    const request = groupColumns('nodes', 'request');
    const ack = written('ackNode', 'nodes');
    expect(ack.has('updateState'), 'ackNode never returns the lease to idle').toBe(true);
    expect(request.filter((c) => !ack.has(c)), 'ackNode leaves a request column standing').toEqual([]);
    expect(stmts.some((s) => s.method === 'ackNode' && s.table === 'node_release_refusals'),
      "ackNode never clears this node's refusals").toBe(true);
    const settle = written('settleNode', 'nodes');
    expect(settle.has('updateState'), 'settleNode never writes the lease').toBe(true);
    expect(request.filter((c) => !settle.has(c)), 'settleNode leaves a request column standing').toEqual([]);
    expect(request.filter((c) => written('releaseLease', 'nodes').has(c)),
      'releaseLease clears the request — a refusal or a drop must leave it standing (decision 7)').toEqual([]);
  });
});

// ── the analyser's CONTROL — each planted shape reds, and a clean one does not ─

// A fixture class in the store's own shape. Each method but `resolveNode` plants
// exactly one mutation-table shape; `resolveNode` is the clean control.
const FIXTURE = `export class CoordStore {
  constructor(readonly db: DatabaseSync) {}

  resolveNode(nodeId: string, r: NodeResolvedColumns): ResolveNodeResult {
    const res = this.db.prepare('UPDATE nodes SET channel = ?, desiredTag = ?, resolveDetail = ? WHERE nodeId = ?')
      .run(r.channel, r.desiredTag, r.resolveDetail, nodeId);
    return { ok: true, changed: Number(res.changes) > 0 };
  }

  upsertNodeMeasurement(m: NodeMeasurement): UpsertNodeResult {
    this.db.prepare(
      'INSERT INTO nodes (nodeId, role, label, stampRead) VALUES (?, ?, ?, ?) ' +
      "ON CONFLICT (nodeId) DO UPDATE SET role = excluded.role, updateState = 'idle'",
    ).run(m.nodeId, m.role, m.label, m.stampRead);
    return { ok: true, created: true };
  }

  refuseRelease(nodeId: string, tag: string, at: number, detail: string): RefuseReleaseResult {
    this.db.prepare('UPDATE releases SET yanked = 0 WHERE tag = ?').run(tag);
    return { ok: true, inserted: true };
  }

  settleNode(nodeId: string, detail: string, reportStartedAt: number | null): SettleNodeResult {
    this.db.prepare('UPDATE nodes SET updateState = ?, requestedTag = NULL, resolveDetail = NULL WHERE nodeId = ?')
      .run('idle', nodeId);
    return { ok: true, clearedRequest: true };
  }

  clearRefusals(nodeId: string): ClearRefusalsResult {
    this.db.prepare('DELETE FROM releases WHERE tag = ?').run(nodeId);
    return { ok: true, cleared: 0 };
  }

  ackNode(
    nodeId: string,
  ): AckNodeResult {
    this.db.prepare('UPDATE nodes SET requestedTag = NULL WHERE nodeId = ?').run(nodeId);
    return { ok: true, clearedRequest: true, clearedRefusals: 0 };
  }

  private stray(): void {
    const sql = 'UPDATE nodes SET desiredTag = NULL';
    this.db.exec(sql);
  }
}
`;

describe('CONTROL: the analyser reports each planted shape (the mutation table, measured in-suite)', () => {
  const { stmts, problems } = scan(FIXTURE);
  const v = stmts.flatMap(violations);

  it('a clean resolveNode statement is attributed and passes — the analyser is not red on everything', () => {
    const mine = stmts.filter((s) => s.method === 'resolveNode');
    expect(mine.map((s) => s.columns)).toEqual([['channel', 'desiredTag', 'resolveDetail']]);
    expect(mine.flatMap(violations)).toEqual([]);
  });

  it('a lease column in upsertNodeMeasurement reds (§18 "one writer per column group")', () => {
    expect(stmts.find((s) => s.method === 'upsertNodeMeasurement')?.columns)
      .toEqual(['role', 'label', 'stampRead', 'role', 'updateState']);            // nodeId excluded: the row's key
    expect(v).toContainEqual(expect.stringMatching(/^upsertNodeMeasurement \(store\.ts:\d+\) writes nodes\.updateState — the lease group's writers are /));
  });

  it('a catalogue column in an UPDATE releases outside applyReleaseListing reds', () => {
    expect(v).toContainEqual(expect.stringMatching(/^refuseRelease \(store\.ts:\d+\) writes releases\.yanked — the catalogue group's writers are applyReleaseListing$/));
  });

  it('resolveDetail written outside resolveNode reds', () => {
    expect(v).toContainEqual(expect.stringMatching(/^settleNode \(store\.ts:\d+\) writes nodes\.resolveDetail — the resolved group's writers are resolveNode$/));
  });

  it('a DELETE FROM releases reds against both release groups (D-3180: a yank is a mark, never a delete)', () => {
    expect(v).toContainEqual(expect.stringMatching(/^clearRefusals .* writes every column of releases \(a DELETE with no column list\) — the catalogue group's/));
    expect(v).toContainEqual(expect.stringMatching(/^clearRefusals .* writes every column of releases \(a DELETE with no column list\) — the notification group's/));
  });

  it('nothing else in the fixture is a violation — exactly the five above', () => {
    expect(v).toHaveLength(5);
  });

  it("a signature split across lines reds as 'not single-line', never as a silent misattribution", () => {
    expect(stmts.some((s) => s.method === 'ackNode')).toBe(false);
    expect(problems).toContainEqual(expect.stringMatching(/crossed a method close — the signature of the method writing nodes is not single-line/));
  });

  it('a write outside any this.db.prepare( window reds as a stray line', () => {
    expect(problems).toContainEqual(expect.stringMatching(/writes an update table outside a this\.db\.prepare\( window/));
    expect(problems).toHaveLength(2);
  });
});

// ── review fix round 1 — two silent-pass holes the review found ────────────
// Finding 1: a lowercase verb, a quoted table name or a schema-qualified one
// passed WRITE_VERB/TABLE_WRITE_LINE with no statement, no problem and no
// violation — `nonCanonicalWrites`, above, closes it without touching either.
// Finding 2: an INSERT naming only its row key left `violations` nothing to
// iterate and passed for any method silently — `violations` above now
// attributes that shape too. No D- number: this tightens a test, not a spec
// departure.
describe('CONTROL: two shapes the review found the scan silently passing (fix round 1)', () => {
  it('store.ts has zero non-canonical write spellings (finding 1)', () => {
    expect(nonCanonicalWrites(STORE_SRC)).toEqual([]);
  });

  it('CONTROL: a lowercase verb, a quoted table name and a schema-qualified one are each caught (finding 1)', () => {
    const fixture = [
      'update nodes set updateState = ?',
      'UPDATE "nodes" SET desiredTag = NULL',
      'UPDATE main.nodes SET requestedTag = NULL',
    ].join('\n');
    expect(nonCanonicalWrites(fixture)).toEqual([
      'store.ts:1: non-canonical write shape "update nodes" — spell it as the scan requires (uppercase verb, bare table name)',
      'store.ts:2: non-canonical write shape "UPDATE \\"nodes" — spell it as the scan requires (uppercase verb, bare table name)',
      'store.ts:3: non-canonical write shape "UPDATE main.nodes" — spell it as the scan requires (uppercase verb, bare table name)',
    ]);
  });

  // D4 (final fix wave): a table both QUOTED and QUALIFIED, either side (or
  // both) quoted — `main."nodes"`, `"main".nodes`, `"main"."nodes"` — none of
  // which the un-widened regex could see (it only combined a leading quote OR
  // a bare `main.`, never both).
  it('CONTROL: a table quoted AND qualified is caught, quote and main. combined (D4)', () => {
    const fixture = [
      'UPDATE main."nodes" SET requestedTag = NULL',
      'UPDATE "main".nodes SET requestedTag = NULL',
      'UPDATE "main"."nodes" SET requestedTag = NULL',
    ].join('\n');
    expect(nonCanonicalWrites(fixture)).toEqual([
      'store.ts:1: non-canonical write shape "UPDATE main.\\"nodes" — spell it as the scan requires (uppercase verb, bare table name)',
      'store.ts:2: non-canonical write shape "UPDATE \\"main\\".nodes" — spell it as the scan requires (uppercase verb, bare table name)',
      'store.ts:3: non-canonical write shape "UPDATE \\"main\\".\\"nodes" — spell it as the scan requires (uppercase verb, bare table name)',
    ]);
  });

  // D4: a comment naming one of these shapes as PROSE must not false-red —
  // `nonCanonicalWrites` now blanks comment lines first, the same
  // `blankComments` the main scan uses.
  it('CONTROL: a comment-line EXAMPLE of a non-canonical shape does not false-red (D4)', () => {
    const fixture = [
      '  // e.g. UPDATE main."nodes" SET x = NULL — a shape this scan catches',
      '  UPDATE nodes SET updateState = ?',
    ].join('\n');
    expect(nonCanonicalWrites(fixture)).toEqual([]);
  });

  it('store.ts names no INSERT against any of the five tables that names only its row key (finding 2)', () => {
    const { stmts: realStmts } = scan(STORE_SRC);
    expect(realStmts.filter((s) => s.verb === 'INSERT' && s.columns.length === 0)).toEqual([]);
  });

  it('CONTROL: a planted INSERT naming only its row key is attributed and reds against a method that owns no group of that table (finding 2)', () => {
    const fixture = `export class CoordStore {
  constructor(readonly db: DatabaseSync) {}

  refuseRelease(nodeId: string, tag: string): RefuseReleaseResult {
    this.db.prepare('INSERT OR IGNORE INTO releases (tag) VALUES (?)').run(tag);
    return { ok: true, inserted: true };
  }
}
`;
    const { stmts: mine, problems: mineProblems } = scan(fixture);
    expect(mineProblems).toEqual([]);
    expect(mine.map((s) => ({ method: s.method, table: s.table, verb: s.verb, columns: s.columns })))
      .toEqual([{ method: 'refuseRelease', table: 'releases', verb: 'INSERT', columns: [] }]);
    expect(mine.flatMap(violations)).toEqual([
      'refuseRelease (store.ts:5) inserts releases naming only its row key — no writer group of releases names refuseRelease',
    ]);
  });
});
