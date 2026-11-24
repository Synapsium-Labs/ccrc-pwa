// Overlord W1 door process A2 (plan w1-door-process.md Task 5 Step 1): the tool table, DOOR_TOOLS, against what it is held to:
// ccrc-api's ROUTES, the ccrc-overlord skill's door table, the fence's rules and shared/continuity-door.ts.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  DOOR_TOOLS, DOOR_TOOL_PREFIX as PROGRAM_PREFIX, DOOR_ONLY_TOOLS, ATTRIBUTION_FIELDS, CLAIM_RETRY_MIN_MS, CLAIM_RETRY_MAX_MS, DELTA_REFRESH_MS, DELTA_LEASE_MS, TEAM_KEY_SHAPE,
} from '../../ccd/door-process.mjs';
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
  it('has fifteen uniquely named rows, the readers\' `read` last', () => {
    // D-8809: `link_team`, the Overlord's confirm of a team candidate. The inbox piece (Overlord W1): `inbox`, `messages`
    // and `acknowledge`.
    expect(ROWS.map((r) => r.name)).toEqual(['card', 'probe', 'probe_answer', 'note_add', 'note_close', 'note_list', 'note_handover', 'timer_set', 'timer_list', 'timer_cancel', 'inbox', 'messages', 'acknowledge', 'link_team', 'read']);
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

  it('reader is true on no row in B1, so the read tool\'s enum is empty', () => {
    expect(ROWS.filter((r) => r.reader)).toEqual([]);
    const read = ROWS.find((r) => r.name === 'read')!;
    expect(read.class).toBe('view');
    expect(read.fenced).toBe(false);
    expect(JSON.stringify(read.input)).not.toContain('"enum"');
  });

  // The fenced view rows are those whose Overlord door row is a write (`door-tools-argv.test.ts` derives it from the door
  // table): the card, whose recording page records a read, and the inbox piece's two fenced reads (its plan's question 15).
  it('card, inbox and messages are the view rows that are fenced, and every operate row is fenced', () => {
    expect(ROWS.filter((r) => r.class === 'view' && r.fenced).map((r) => r.name)).toEqual(['card', 'inbox', 'messages']);
    expect(ROWS.filter((r) => r.class === 'operate' && !r.fenced).map((r) => r.name)).toEqual([]);
    expect(ROWS.filter((r) => r.class === 'view' && !r.fenced).map((r) => r.name).sort()).toEqual(['note_list', 'probe', 'read', 'timer_list']);
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
