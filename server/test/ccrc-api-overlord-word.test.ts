// `ccrc-api` follows `overlord-v1` (Overlord W1, plan 2026-11-25-overlord-w1-overlord-v1.md Task 2, Table 1 rows H10 and H11;
// slug client-word-gate-is-one-table). Two halves:
// - THE CLIENT: every row whose server door is an Overlord door carrying the word joins the client's one table of gated rows,
//   and the table's one check reads every row of it. A CURRENT, well-formed cap file that omits the word refuses
//   `capability-missing`, exit 2, unsent; an absent, stale or torn file sends, as every gate in the client does. A stub server
//   records each request; FIXTURE HOMEs only, the client runs with the contained PATH `ccrcApiClient.ts` builds.
// - THE CENSUS, strict in both directions with no exception list (ruled, F1; call 1358): every Overlord door of the word has a
//   client row (by method and path), a row of the gated table, and a door tool whose verb is that row's key; every gated row of
//   the word is such a row; among the word's doors the tools marked readable are exactly `READABLE_DOORS`, the one hand list;
//   and the read tool admits each of them, asked through the door process's own predicate, `readableDoorRow`. Each reader check
//   is a function over a table passed in, so it is also run on synthetic tables that must go red.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { renderServerCaps, SERVER_CAPS, SERVER_CAPS_FILE } from '../../shared/api.js';
import { DOOR_TOOLS, readableDoorRow } from '../../ccd/door-process.mjs';
import { OVERLORD_DOORS, type OverlordDoorRow } from '../src/coord/overlordDoors.js';
import { CCRC_API, harnessBin } from './ccdWsHelpers.js';
import { clientRoutes, type ClientRoute } from './ccrcApiTable.js';
import { runClient, writeClientHome, type Run } from './ccrcApiClient.js';
import { mkTmp } from './tmpHelpers.js';

const WORD = 'overlord-v1';
const DETAIL = "the server this box talks to does not answer the Overlord's doors yet (it does not advertise overlord-v1); nothing was sent";
/** The census's one hand list: the doors the door-process plan marks readable (its question 9). */
const READABLE_DOORS = ['board', 'history'] as const;

// ── the census ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The client's table of gated rows: the one `case "$key"` block that sets `gate`, read from the client's text as
 *  key -> word. A row of two keys (`a|b)`) is two entries. */
function gatedTable(src: string): Map<string, string> {
  const open = src.indexOf("  local gate='' gate_msg=''\n");
  if (open < 0) throw new Error('the gated table is not where the census reads it');
  const end = src.indexOf('\n  esac\n', open);
  const out = new Map<string, string>();
  let keys: string[] = [];
  for (const line of src.slice(open, end).split('\n')) {
    const head = /^ {4}([a-z][a-z0-9.|-]*)\)$/.exec(line);
    if (head !== null) { keys = head[1]!.split('|'); continue; }
    const gate = /^ {6}gate='([a-z0-9-]+)'$/.exec(line);
    if (gate !== null) for (const k of keys) out.set(k, gate[1]!);
  }
  return out;
}

const wordDoors = (doors: Readonly<Record<string, unknown>>): [string, OverlordDoorRow][] => Object.entries(doors)
  .filter((e): e is [string, OverlordDoorRow] => (e[1] as OverlordDoorRow).group === 'overlord' && (e[1] as OverlordDoorRow).word === WORD);
/** A door's client row: the ROUTES row with its method and path (`{id}` read as `:id`). */
const clientRowOf = (routes: readonly ClientRoute[], d: OverlordDoorRow): ClientRoute | undefined =>
  routes.find((r) => r.method === d.method && r.path.replaceAll('{id}', ':id') === d.path);

interface Tool { readonly name: string; readonly verb: string | null; readonly class: string; readonly fenced: boolean; readonly reader: boolean }

/** The reader check (an equality): among the word's client keys, the tools marked `reader: true` are exactly `readable`. Null
 *  when it holds, else what differs. */
function readerCheck(tools: readonly Tool[], wordKeys: ReadonlySet<string>, readable: readonly string[]): string | null {
  const marked = tools.filter((t) => t.verb !== null && wordKeys.has(t.verb) && t.reader).map((t) => t.name).sort();
  const want = [...readable].sort();
  return JSON.stringify(marked) === JSON.stringify(want) ? null : `readable tools ${JSON.stringify(marked)}, want ${JSON.stringify(want)}`;
}
/** The admit check: the read tool's own predicate admits each `readable` tool. Never a copy of its conditions. */
function admitCheck(tools: readonly Tool[], readable: readonly string[], admits: (row: Tool) => boolean): string | null {
  const refused = readable.filter((n) => { const t = tools.find((x) => x.name === n); return t === undefined || !admits(t); });
  return refused.length === 0 ? null : `the read tool refuses ${refused.join(', ')}`;
}

describe('the client census of overlord-v1 (strict, both directions; ruled F1 and call 1358)', () => {
  const src = fs.readFileSync(CCRC_API, 'utf8');
  const routes = clientRoutes(src);
  const table = gatedTable(src);
  const doors = wordDoors(OVERLORD_DOORS);
  const tools = DOOR_TOOLS as readonly Tool[];

  it('reads the table and the doors it is held to: seven doors on main at this build', () => {
    expect(doors.map(([k]) => k).sort()).toEqual(['acknowledge', 'board', 'history', 'inbox', 'link-team', 'messages', 'sequence']);
    // The plan rows' entries read too, so the parser reads the block it means.
    expect(table.get('plan.phase-ref')).toBe('plan-phases-v1');
    expect(table.get('plan.triage')).toBe('plan-inbound-v1');
  });

  it('every Overlord door of the word has a client row by its method and path, and a gated row of the word', () => {
    for (const [k, d] of doors) {
      const r = clientRowOf(routes, d);
      expect(r, k).toBeDefined();
      expect(table.get(r!.key), `${k} -> ${r!.key}`).toBe(WORD);
    }
  });

  it('every gated row of the word is such a door\'s client row (the other direction)', () => {
    const keys = new Set(doors.map(([, d]) => clientRowOf(routes, d)?.key));
    const gatedWord = [...table].filter(([, w]) => w === WORD).map(([k]) => k);
    expect(gatedWord.length).toBeGreaterThan(0);
    for (const k of gatedWord) expect(keys.has(k), k).toBe(true);
  });

  it('every such row has a door tool whose verb is its key', () => {
    for (const [k, d] of doors) {
      const key = clientRowOf(routes, d)!.key;
      expect(tools.filter((t) => t.verb === key), `${k} -> ${key}`).toHaveLength(1);
    }
  });

  it('among the word\'s doors, the readable tools are exactly READABLE_DOORS, and the read tool admits each', () => {
    const keys = new Set(doors.map(([, d]) => clientRowOf(routes, d)!.key));
    expect(readerCheck(tools, keys, READABLE_DOORS)).toBeNull();
    expect(admitCheck(tools, READABLE_DOORS, readableDoorRow)).toBeNull();
  });

  it('the reader checks go red on synthetic tables: a readable sequence, an unmarked board, a fenced or non-view reader', () => {
    const keys = new Set(doors.map(([, d]) => clientRowOf(routes, d)!.key));
    const swap = (name: string, over: Partial<Tool>): Tool[] => tools.map((t) => (t.name === name ? { ...t, ...over } : t));
    expect(readerCheck(swap('sequence', { reader: true }), keys, READABLE_DOORS)).not.toBeNull();
    expect(readerCheck(swap('messages', { reader: true }), keys, READABLE_DOORS)).not.toBeNull();
    expect(readerCheck(swap('board', { reader: false }), keys, READABLE_DOORS)).not.toBeNull();
    expect(admitCheck(swap('history', { fenced: true }), READABLE_DOORS, readableDoorRow)).not.toBeNull();
    expect(admitCheck(swap('board', { class: 'operate' }), READABLE_DOORS, readableDoorRow)).not.toBeNull();
    expect(admitCheck(swap('board', { reader: false }), READABLE_DOORS, readableDoorRow)).not.toBeNull();
  });
});

// ── the client ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const TOKEN = 'k'.repeat(64);
const PANE_ID = 'lane-a-project-a';
const PANE_UUID = 'u-overlord-1';
/** Each gated Overlord row, by its client key, with an argv that sends (its body on stdin where it takes one). */
const ROWS: Readonly<Record<string, { readonly args: readonly string[]; readonly stdin?: string }>> = {
  'overlord.inbox': { args: ['overlord', 'inbox'] },
  'overlord.messages': { args: ['overlord', 'messages', '12'] },
  'overlord.acknowledge': { args: ['overlord', 'acknowledge', '12'] },
  'overlord.history': { args: ['overlord', 'history', 'search', '--all', 'deploy'] },
  'linking.confirm': { args: ['linking', 'confirm', '--json', '-'], stdin: '{"team":"AAA"}' },
  'overlord.sequence': { args: ['overlord', 'sequence', '--after', '7'] },
  'overlord.board': { args: ['overlord', 'board'] },
};

let home: string;
let tmp: string;
let server: Server;
let seen: { method: string; url: string }[];

beforeEach(async () => {
  home = mkTmp('ccrc-api-overlord-home-');
  tmp = mkTmp('ccrc-api-overlord-tmp-');
  seen = [];
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    req.on('data', () => undefined);
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '' });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  writeClientHome(home, `http://127.0.0.1:${(server.address() as AddressInfo).port}`, TOKEN);
  fs.writeFileSync(path.join(harnessBin(home), 'tmux'), `#!/bin/sh\nprintf 'cc-${PANE_ID}\\n'\n`, { mode: 0o755 });
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cc-sessions', `${PANE_ID}.uuid`), `${PANE_UUID}\n`);
});

afterEach(async () => {
  await new Promise<void>((r) => { server.close(() => r()); });
});

const run = (args: readonly string[], stdin?: string): Promise<Run> =>
  runClient(home, [...args], stdin, { TMPDIR: tmp, TMUX_PANE: '%7', CCRC_API_STATUS: undefined });
const capFile = (): string => path.join(home, '.ccrc', SERVER_CAPS_FILE);
const nowS = (): number => Math.floor(Date.now() / 1000);
const writeCaps = (words: readonly string[], at = nowS()): void => { fs.writeFileSync(capFile(), renderServerCaps(words, at)); };
const without = (w: string): string[] => SERVER_CAPS.filter((x) => x !== w);

describe('ccrc-api\'s Overlord rows follow overlord-v1 (Task 2 Step 1)', () => {
  it('the rows this file drives are exactly the gated rows of the word', () => {
    const t = gatedTable(fs.readFileSync(CCRC_API, 'utf8'));
    expect(Object.keys(ROWS).sort()).toEqual([...t].filter(([, w]) => w === WORD).map(([k]) => k).sort());
  });

  for (const [key, row] of Object.entries(ROWS)) {
    it(`${key}: a current cap file without the word refuses capability-missing, exit 2, and sends nothing`, async () => {
      writeCaps(without(WORD));
      const r = await run(row.args, row.stdin);
      expect([r.status, JSON.parse(r.stdout)], r.stderr).toEqual([2, { ok: false, error: 'capability-missing', detail: DETAIL }]);
      expect(seen).toEqual([]);
    });

    it(`${key}: a current file with the word sends; so do an absent, a stale and a torn file`, async () => {
      const sends = async (why: string): Promise<void> => {
        seen = [];
        const r = await run(row.args, row.stdin);
        expect([r.status, seen.length], `${why}: ${r.stdout}${r.stderr}`).toEqual([0, 1]);
      };
      writeCaps(SERVER_CAPS);
      await sends('current, with the word');
      fs.rmSync(capFile(), { force: true });
      await sends('absent');
      writeCaps(without(WORD), nowS() - 181);
      await sends('stale');
      fs.writeFileSync(capFile(), 'at 1\ncaps plan-v1\n');
      await sends('torn');
    });
  }

  it('the plan rows\' refusals are unchanged now the check reads the whole table, and the word gates no plan row', async () => {
    writeCaps(without('plan-phases-v1'));
    const r = await run(['plan', 'phase-ref', 'prog-a', '--json', '-'], '{"phase":"p"}');
    expect([r.status, JSON.parse(r.stdout)]).toEqual([2, { ok: false, error: 'capability-missing',
      detail: 'the server this box talks to does not answer this verb yet (it does not advertise plan-phases-v1); nothing was changed' }]);
    expect(seen).toEqual([]);
    writeCaps(without(WORD));
    expect((await run(['plan', 'phase-ref', 'prog-a', '--json', '-'], '{"phase":"p"}')).status).toBe(0);
    expect(seen).toHaveLength(1);
  });

  it('a row the word does not gate sends under a current file without it (the timers, the card)', async () => {
    writeCaps(without(WORD));
    expect((await run(['timer', 'list'])).status).toBe(0);
    expect((await run(['sessions', 'card', PANE_ID])).status).toBe(0);
    expect(seen.map((s) => s.method)).toEqual(['GET', 'GET']);
  });
});
