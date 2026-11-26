// Overlord W1 door process A2 (plan w1-door-process.md Task 5 Step 1): the tool table, DOOR_TOOLS, against what it is held to:
// ccrc-api's ROUTES, the ccrc-overlord skill's door table, the fence's rules and shared/continuity-door.ts.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  DOOR_TOOLS, DOOR_TOOL_PREFIX as PROGRAM_PREFIX, DOOR_ONLY_TOOLS, ATTRIBUTION_FIELDS, CLAIM_RETRY_MIN_MS, CLAIM_RETRY_MAX_MS, DELTA_REFRESH_MS, DELTA_LEASE_MS, TEAM_KEY_SHAPE,
  SEQUENCE_PAGE_MAX as PROGRAM_PAGE_MAX, HISTORY_VERBS as PROGRAM_HISTORY_VERBS, readToolOver, readableDoorRow,
} from '../../ccd/door-process.mjs';
import { HISTORY_VERBS } from '../../shared/overlordHistory.js';
import { OVERLORD_DOORS } from '../src/coord/overlordDoors.js';
import { SEQUENCE_PAGE_MAX } from '../../shared/overlord-sequence.js';
import * as shared from '../../shared/continuity-door.js';
import { DOOR_TOOL_PREFIX, DOOR_TOOL_NAME_RE } from '../../shared/continuity-reports.js';
import { LINEAR_TEAM_KEY_SHAPE } from '../../shared/linear.js';

type Row = { name: string; verb: string | null; class: 'view' | 'operate'; fenced: boolean; reader: boolean; input: unknown };
const ROWS = DOOR_TOOLS as unknown as Row[];
const ROOT = path.resolve(__dirname, '../..');

/** The keys of ccrc-api's ROUTES array, read from the file's text. */
function routeKeys(): string[] {
  const text = fs.readFileSync(path.join(ROOT, 'ccd/ccrc-api'), 'utf8');
  const start = text.indexOf('declare -A ROUTES=(');
  expect(start).toBeGreaterThan(-1);
  const block = text.slice(start, text.indexOf('\n)\n', start));
  return [...block.matchAll(/^\s+\[([A-Za-z0-9_.-]+)\]='/gm)].map((m) => m[1]!);
}

/** The door names of the ccrc-overlord skill's door table (starting.md), as tool names: spaces become `_`. */
function skillDoorNames(): string[] {
  const lines = fs.readFileSync(path.join(ROOT, 'ccd/overlord-skill/references/starting.md'), 'utf8').split('\n');
  const head = lines.findIndex((l) => l.startsWith('| Door |'));
  expect(head).toBeGreaterThan(-1);
  const names: string[] = [];
  for (let i = head + 2; i < lines.length && lines[i]!.startsWith('|'); i += 1) {
    const first = lines[i]!.split('|')[1]!;
    for (const m of first.matchAll(/`([^`]+)`/g)) names.push(m[1]!.replace(/ /g, '_'));
  }
  return names;
}

const keysOf = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.flatMap(keysOf);
  if (v !== null && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]);
  if (typeof v === 'string') return [v];   // a `required` entry names a field too
  return [];
};

describe('DOOR_TOOLS', () => {
  it('has eighteen uniquely named rows, the readers\' `read` last', () => {
    // D-8809: `link_team`, the Overlord's confirm of a team candidate. The inbox piece (Overlord W1): `inbox`, `messages`
    // and `acknowledge`. Sequence C (Overlord W1): `sequence`, the cursor read. Board B2: `board` and `history`.
    expect(ROWS.map((r) => r.name)).toEqual(['card', 'probe', 'probe_answer', 'note_add', 'note_close', 'note_list', 'note_handover', 'timer_set', 'timer_list', 'timer_cancel', 'inbox', 'messages', 'acknowledge', 'sequence', 'board', 'history', 'link_team', 'read']);
  });

  it('every name is a legal tool name after the hook\'s prefix, and the prefix is the L0 constant', () => {
    expect(DOOR_TOOL_PREFIX).toBe('mcp__door__');
    expect(PROGRAM_PREFIX, 'the door process\'s copy').toBe(DOOR_TOOL_PREFIX);
    for (const r of ROWS) expect(DOOR_TOOL_NAME_RE.test(r.name), r.name).toBe(true);
  });

  it('every row\'s verb is a key of ccrc-api\'s ROUTES', () => {
    const routes = routeKeys();
    expect(routes.length).toBeGreaterThan(50);
    // `read` has no verb of its own: it runs the argv builder of the row it names (a row marked `reader`), and none is marked yet.
    for (const r of ROWS.filter((x) => x.name !== 'read')) expect(routes, `${r.name} -> ${r.verb}`).toContain(r.verb);
    expect(ROWS.find((r) => r.name === 'read')!.verb).toBeNull();
  });

  it('every name is a door of the ccrc-overlord skill (spaces as _), or is in DOOR_ONLY_TOOLS with a reason', () => {
    const skill = skillDoorNames();
    expect(skill).toContain('card');
    expect(skill).toContain('probe_answer');
    for (const r of ROWS) {
      if (skill.includes(r.name)) continue;
      const why = (DOOR_ONLY_TOOLS as Record<string, string>)[r.name];
      expect(typeof why === 'string' && why.length > 10, `${r.name} is on neither list`).toBe(true);
    }
    // The named list is not stale: each entry is a real tool the skill really lacks.
    for (const n of Object.keys(DOOR_ONLY_TOOLS)) {
      expect(ROWS.map((r) => r.name), n).toContain(n);
      expect(skill, `${n} is now in the skill's table; drop it from DOOR_ONLY_TOOLS`).not.toContain(n);
    }
  });

  it('the link_team row\'s team grammar is shared/linear.ts\'s LINEAR_TEAM_KEY_SHAPE (D-8809)', () => {
    expect(TEAM_KEY_SHAPE.source).toBe(LINEAR_TEAM_KEY_SHAPE.source);
    expect(TEAM_KEY_SHAPE.flags).toBe(LINEAR_TEAM_KEY_SHAPE.flags);
  });

  it('the readers\' doors are board and history (question 9, call 1590), and the read tool\'s enum names exactly them', () => {
    expect(ROWS.filter((r) => r.reader).map((r) => r.name)).toEqual([...READABLE_DOORS]);
    const read = ROWS.find((r) => r.name === 'read')!;
    expect([read.class, read.fenced, read.reader]).toEqual(['view', false, false]);
    expect(read.input).toMatchObject({ properties: { door: { type: 'string', enum: [...READABLE_DOORS] } } });
  });

  // The fenced view rows are those whose Overlord door row is a write (`door-tools-argv.test.ts` derives it from the door
  // table): the card, whose recording page records a read, and the inbox piece's two fenced reads (its plan's question 15).
  it('card, inbox and messages are the view rows that are fenced, and every operate row is fenced', () => {
    expect(ROWS.filter((r) => r.class === 'view' && r.fenced).map((r) => r.name)).toEqual(['card', 'inbox', 'messages']);
    expect(ROWS.filter((r) => r.class === 'operate' && !r.fenced).map((r) => r.name)).toEqual([]);
    expect(ROWS.filter((r) => r.class === 'view' && !r.fenced).map((r) => r.name).sort()).toEqual(['board', 'history', 'note_list', 'probe', 'read', 'sequence', 'timer_list']);
  });

  it('the board row: a view, unfenced (its door row is not a write, call 1590), a reader\'s door, no input', () => {
    const r = ROWS.find((x) => x.name === 'board')!;
    expect([r.verb, r.class, r.fenced, r.reader]).toEqual(['overlord.board', 'view', false, true]);
    expect(r.input).toMatchObject({ type: 'object', additionalProperties: false, required: [], properties: {} });
  });

  it('the history row: a view, unfenced (call 1590), a reader\'s door; its verbs are shared/overlordHistory.ts\'s', () => {
    const r = ROWS.find((x) => x.name === 'history')!;
    expect([r.verb, r.class, r.fenced, r.reader]).toEqual(['overlord.history', 'view', false, true]);
    expect([...PROGRAM_HISTORY_VERBS]).toEqual([...HISTORY_VERBS]);
    expect(r.input).toMatchObject({ type: 'object', additionalProperties: false, required: ['verb'], properties: { verb: { enum: [...HISTORY_VERBS] } } });
  });

  it('the sequence row: a view, unfenced (its door row is not a write), never a reader\'s door, its page bound shared/overlord-sequence.ts\'s', () => {
    const r = ROWS.find((x) => x.name === 'sequence')!;
    expect([r.verb, r.class, r.fenced, r.reader]).toEqual(['overlord.sequence', 'view', false, false]);
    expect(PROGRAM_PAGE_MAX).toBe(SEQUENCE_PAGE_MAX);
    expect(r.input).toMatchObject({ type: 'object', additionalProperties: false, required: [],
      properties: { after: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: SEQUENCE_PAGE_MAX } } });
  });

  it('no input schema names an attribution field, at any depth', () => {
    expect([...ATTRIBUTION_FIELDS].sort()).toEqual(['byId', 'byUuid', 'fromId', 'fromUuid']);
    for (const r of ROWS) {
      const names = keysOf(r.input);
      for (const f of ATTRIBUTION_FIELDS) expect(names, `${r.name} names ${f}`).not.toContain(f);
    }
  });

  it('the claim back-off bounds equal shared/continuity-door.ts\'s', () => {
    expect(CLAIM_RETRY_MIN_MS).toBe(shared.CLAIM_RETRY_MIN_MS);
    expect(CLAIM_RETRY_MAX_MS).toBe(shared.CLAIM_RETRY_MAX_MS);
  });

  it('the delta cache\'s refresh and lease equal shared/continuity-door.ts\'s, and the hook\'s byte bound its DELTA_MAX_BYTES', () => {
    expect(DELTA_REFRESH_MS).toBe(shared.DELTA_REFRESH_MS);
    expect(DELTA_LEASE_MS).toBe(shared.DELTA_LEASE_MS);
    const hook = fs.readFileSync(path.join(ROOT, 'ccd/session-hook.sh'), 'utf8');
    expect(/^DOOR_DELTA_MAX_BYTES=(\d+)$/m.exec(hook)?.[1]).toBe(String(shared.DELTA_MAX_BYTES));
  });
});

// THE READERS' CENSUS (board B2, call 1590, ruling point 5): every row marked reader is a view the read tool admits (unfenced), its
// route's Overlord door row is not a write, the marked rows are exactly `READABLE_DOORS`, and the read tool's enum is exactly
// them. A function over the tables passed in, so each mutant below reds a named check on a synthetic table, and the real
// tables read clean. The read tool is rebuilt from the rows through the door process's own `readToolOver`, and admission is
// asked of its own `readableDoorRow`, never a copy of their conditions.
const READABLE_DOORS = ['board', 'history'] as const;
type DoorLike = { group: string; method: string; path: string; write: boolean };
/** Each client row's method and path, from ccrc-api's ROUTES (`[key]='METHOD|/path|…'`). */
function clientRoutes(): Map<string, { method: string; path: string }> {
  const text = fs.readFileSync(path.join(ROOT, 'ccd/ccrc-api'), 'utf8');
  const start = text.indexOf('declare -A ROUTES=(');
  const block = text.slice(start, text.indexOf('\n)\n', start));
  return new Map([...block.matchAll(/^\s+\[([A-Za-z0-9_.-]+)\]='([A-Z]+)\|([^|]+)\|/gm)].map((m) => [m[1]!, { method: m[2]!, path: m[3]!.replace(/\{id\}/g, ':id') }]));
}
function readerCensus(rows: readonly Row[], doors: readonly DoorLike[], routes: ReadonlyMap<string, { method: string; path: string }>): string[] {
  const out: string[] = [];
  const marked = rows.filter((r) => r.reader === true);
  for (const r of marked) {
    if (r.class !== 'view') out.push(`${r.name}: a ${r.class} row marked reader`);
    if (!readableDoorRow(r)) out.push(`${r.name}: marked reader but the read tool does not admit it (a fenced row)`);
    const rt = r.verb === null ? undefined : routes.get(r.verb);
    const ds = rt === undefined ? [] : doors.filter((d) => d.group === 'overlord' && d.method === rt.method && d.path === rt.path);
    if (ds.length === 0) out.push(`${r.name}: marked reader but its route has no Overlord door row`);
    if (ds.some((d) => d.write)) out.push(`${r.name}: marked reader but its door row is a write`);
  }
  const names = marked.map((r) => r.name);
  if (JSON.stringify(names) !== JSON.stringify([...READABLE_DOORS])) out.push(`the rows marked reader are ${names.join(', ') || 'none'}, not ${READABLE_DOORS.join(', ')}`);
  const read = readToolOver(rows.filter((r) => r.name !== 'read')) as unknown as { input: { properties: { door: { enum?: string[] } } } };
  if (JSON.stringify(read.input.properties.door.enum ?? []) !== JSON.stringify(names)) out.push("the read tool's enum is not exactly the rows marked reader");
  return out;
}

describe('the readers\' census (board B2, call 1590): both directions, each check red on a synthetic table', () => {
  const doors = Object.values(OVERLORD_DOORS) as unknown as DoorLike[];
  const routes = clientRoutes();
  const swap = (name: string, over: Partial<Row>): Row[] => ROWS.map((r) => (r.name === name ? { ...r, ...over } as Row : r));

  it('the real tables read clean', () => {
    expect(readerCensus(ROWS, doors, routes)).toEqual([]);
  });
  it('mutant: a fenced row marked reader (the inbox) is named', () => {
    expect(readerCensus(swap('inbox', { reader: true }), doors, routes)).toEqual(expect.arrayContaining([
      'inbox: marked reader but the read tool does not admit it (a fenced row)', 'inbox: marked reader but its door row is a write',
    ]));
  });
  it('mutant: a reader row whose door row is a write (the board fenced again) is named', () => {
    const fencedBoard = doors.map((d) => (d.path === '/api/overlord/board' ? { ...d, write: true } : d));
    expect(readerCensus(ROWS, fencedBoard, routes)).toContain('board: marked reader but its door row is a write');
  });
  it('mutant: a write class row marked reader (acknowledge) is named', () => {
    expect(readerCensus(swap('acknowledge', { reader: true }), doors, routes)).toEqual(expect.arrayContaining([
      'acknowledge: a operate row marked reader', 'acknowledge: marked reader but the read tool does not admit it (a fenced row)',
    ]));
  });
  it('mutant: a readable door left unmarked (history) is named', () => {
    expect(readerCensus(swap('history', { reader: false }), doors, routes)).toContain('the rows marked reader are board, not board, history');
  });
  it('mutant: a marked row the read tool would refuse (the history tool fenced) is named', () => {
    expect(readerCensus(swap('history', { fenced: true }), doors, routes)).toContain('history: marked reader but the read tool does not admit it (a fenced row)');
  });
});
