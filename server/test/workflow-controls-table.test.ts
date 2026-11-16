// The workflow-control table is held equal to its captures (D-5935; spec
// 2026-10-20 §4.2-§4.4). A control exists only as a `WORKFLOW_CONTROLS` row,
// and a row is admitted only on recorded captures in BOTH remote-control modes
// that agree, so no recipe is a guess and the server never reads a mode.
//
// The table is empty until the captures land (D-5939), so over the real table
// every rule holds vacuously. That is why each rule is also run over a fixture
// table built in this file: a passing fixture row proves the check admits what
// it should, and one broken fixture per rule proves the check is alive — a check
// over an empty table that could never red would pass everything.
//
// The capture layout and the record's fields are stated once, in
// `server/src/workflows/controls.ts`. Pane captures are searched raw (`-e`
// keeps SGR codes), never stripped here: the pane reader that strips them
// (`pane/workflowView.ts`, D-5937) owns the replay of each capture.
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorkflowControlAct } from '../../shared/workflows.js';
import {
  WORKFLOW_CONTROLS,
  WORKFLOW_CONTROL_SLOTS,
  type WorkflowControlRecipe,
  type WorkflowControlTable,
} from '../src/workflows/controls.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CAPTURE_ROOT = path.join(here, 'fixtures', 'panes', 'workflow-view');

/** The three acts, and only these: the compile-time check below fails the
 *  build if `WorkflowControlAct` gains a member this list does not name. */
const ACTS = ['stop-run', 'stop-agent', 'skip-agent'] as const satisfies readonly WorkflowControlAct[];
type Missing = Exclude<WorkflowControlAct, (typeof ACTS)[number]>;
const ACTS_COVER_THE_UNION: [Missing] extends [never] ? true : never = true;

const MODES = ['rc', 'plain'] as const;
type Mode = (typeof MODES)[number];
/** One mode's captures: file name → text. */
type ModeCaptures = Readonly<Record<string, string>>;
type VersionCaptures = Partial<Record<Mode, ModeCaptures>>;
type Captures = (version: string) => VersionCaptures;

/** The captures on disk: a mode is present only when its directory is. */
const diskCaptures: Captures = (version) => {
  const out: VersionCaptures = {};
  for (const mode of MODES) {
    const dir = path.join(CAPTURE_ROOT, version, mode);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    const files: Record<string, string> = {};
    for (const f of readdirSync(dir)) if (f.endsWith('.txt')) files[f] = readFileSync(path.join(dir, f), 'utf8');
    out[mode] = files;
  }
  return out;
};

const RECORD_FIELDS = ['act', 'drive', 'command', 'keys', 'inert', 'mid-turn', 'starts-turn', 'view', 'outcome'] as const;
type RecordField = (typeof RECORD_FIELDS)[number];
type Rec = Partial<Record<RecordField, string>>;

/** A `<act>.record.txt`, `field: value` per line; unknown fields are kept out. */
function parseRecord(text: string): Rec {
  const rec: Rec = {};
  for (const line of text.split('\n')) {
    const m = /^([a-z-]+):\s*(.*?)\s*$/.exec(line);
    if (m && (RECORD_FIELDS as readonly string[]).includes(m[1]!)) rec[m[1] as RecordField] = m[2]!;
  }
  return rec;
}

const words = (s: string | undefined): string[] => (s ?? '').split(/\s+/).filter(Boolean);
const yes = (b: boolean): string => (b ? 'yes' : 'no');
const VERSION_RE = /^\d+\.\d+\.\d+$/;

/** The rules, each answering its violations (`version act: why`). */
type Rule = (table: WorkflowControlTable, captures: Captures) => string[];

const each = (table: WorkflowControlTable, fn: (v: string, act: string, r: WorkflowControlRecipe) => string[]): string[] =>
  Object.entries(table).flatMap(([v, acts]) =>
    Object.entries(acts).flatMap(([act, r]) => (r ? fn(v, act, r) : [])));

const recordOf = (c: VersionCaptures, mode: Mode, act: string): Rec | null => {
  const t = c[mode]?.[`${act}.record.txt`];
  return t === undefined ? null : parseRecord(t);
};

const rules = {
  bothModeDirs: ((table, captures) => Object.keys(table).flatMap((v) => {
    const c = captures(v);
    const bad: string[] = [];
    if (!VERSION_RE.test(v)) bad.push(`${v}: not an X.Y.Z version`);
    for (const mode of MODES) if (!c[mode]) bad.push(`${v}: no ${mode}/ capture directory`);
    return bad;
  })) as Rule,

  modesAgree: ((table, captures) => each(table, (v, act) => {
    const c = captures(v);
    const rc = recordOf(c, 'rc', act);
    const plain = recordOf(c, 'plain', act);
    if (!rc || !plain) return [`${v} ${act}: no ${act}.record.txt in ${!rc ? 'rc/' : 'plain/'}`];
    const differ = RECORD_FIELDS.filter((f) => (rc[f] ?? '') !== (plain[f] ?? ''));
    return differ.length ? [`${v} ${act}: rc/ and plain/ differ on ${differ.join(', ')}`] : [];
  })) as Rule,

  recipeInCaptures: ((table, captures) => each(table, (v, act, r) => MODES.flatMap((mode) => {
    const files = captures(v)[mode];
    const rec = recordOf(captures(v), mode, act);
    if (!files || !rec) return [`${v} ${act}: no ${mode}/ record`];
    const panes = Object.entries(files).filter(([f]) => f.startsWith(`${act}.`) && f !== `${act}.record.txt`);
    const bad: string[] = [];
    if (panes.length === 0) bad.push(`${v} ${act}: no ${mode}/ pane capture`);
    if (rec.act !== act) bad.push(`${v} ${act}: ${mode}/ record names act ${rec.act ?? '(none)'}`);
    if (rec.drive !== r.drive.kind) bad.push(`${v} ${act}: ${mode}/ recorded drive ${rec.drive ?? '(none)'}`);
    if (r.drive.kind === 'command') {
      if (rec.command !== r.drive.template) bad.push(`${v} ${act}: command not the ${mode}/ recorded one`);
      const head = r.drive.template.split('{')[0]!.trim();
      if (!head || !panes.some(([, t]) => t.includes(head))) bad.push(`${v} ${act}: "${head}" in no ${mode}/ pane capture`);
    } else if (words(rec.keys).join(' ') !== r.drive.keys.join(' ')) {
      bad.push(`${v} ${act}: keys not the ${mode}/ recorded ones`);
    }
    return bad;
  }))) as Rule,

  factsRecorded: ((table, captures) => each(table, (v, act, r) => MODES.flatMap((mode) => {
    const rec = recordOf(captures(v), mode, act);
    if (!rec) return [`${v} ${act}: no ${mode}/ record`];
    const bad: string[] = [];
    if (rec['mid-turn'] !== yes(r.midTurn)) bad.push(`${v} ${act}: midTurn not the ${mode}/ recorded one`);
    if (rec['starts-turn'] !== yes(r.startsTurn)) bad.push(`${v} ${act}: startsTurn not the ${mode}/ recorded one`);
    const inert = r.drive.kind === 'view-keys' ? r.drive.inert.join(' ') : '';
    if (words(rec.inert).join(' ') !== inert) bad.push(`${v} ${act}: inert keys not the ${mode}/ recorded ones`);
    return bad;
  }))) as Rule,

  inertOrNotMidTurn: ((table) => each(table, (v, act, r) => {
    const d = r.drive;
    if (d.kind !== 'view-keys') return [];
    const bad: string[] = [];
    const notInert = d.keys.filter((k) => !d.inert.includes(k));
    const stray = d.inert.filter((k) => !d.keys.includes(k));
    if (d.keys.length === 0) bad.push(`${v} ${act}: a view-keys recipe with no keys`);
    if (stray.length) bad.push(`${v} ${act}: inert names keys it never sends: ${stray.join(' ')}`);
    if (notInert.length && r.midTurn) bad.push(`${v} ${act}: mid-turn with keys not inert in the main view: ${notInert.join(' ')}`);
    return bad;
  })) as Rule,

  threeActsAndSlots: ((table) => Object.entries(table).flatMap(([v, acts]) => Object.entries(acts).flatMap(([act, r]) => {
    const bad: string[] = [];
    if (!(ACTS as readonly string[]).includes(act)) bad.push(`${v} ${act}: not one of ${ACTS.join(', ')}`);
    if (r?.drive.kind === 'command') {
      if (!r.drive.template.startsWith('/')) bad.push(`${v} ${act}: a command template that is not a slash command`);
      for (const m of r.drive.template.matchAll(/\{([^}]*)\}/g)) {
        if (!(WORKFLOW_CONTROL_SLOTS as readonly string[]).includes(m[1]!)) bad.push(`${v} ${act}: slot {${m[1]}} takes no validated token`);
      }
    }
    return bad;
  }))) as Rule,
};

// ---------------------------------------------------------------------------
// The fixture: one version with a command row and a view-keys row, recorded the
// same in both modes. Each negative below breaks exactly one thing.

const V = '9.9.9';
const STOP_RUN: WorkflowControlRecipe = { drive: { kind: 'command', template: '/fixture-stop {runId}' }, midTurn: true, startsTurn: false };
const SKIP_AGENT: WorkflowControlRecipe = {
  drive: { kind: 'view-keys', keys: ['Down', 's', 'Escape'], inert: ['Down', 's'] },
  midTurn: false,
  startsTurn: true,
};
const FIXTURE_TABLE: WorkflowControlTable = { [V]: { 'stop-run': STOP_RUN, 'skip-agent': SKIP_AGENT } };

const RECORDS: Record<string, string> = {
  'stop-run.record.txt': [
    'act: stop-run', 'drive: command', 'command: /fixture-stop {runId}', 'inert:', 'mid-turn: yes', 'starts-turn: no',
    'view: -', 'outcome: run killed, done results kept',
  ].join('\n'),
  'stop-run.menu.txt': '\u001b[1m/fixture-stop\u001b[0m   Stop a workflow run\n',
  'skip-agent.record.txt': [
    'act: skip-agent', 'drive: view-keys', 'keys: Down s Escape', 'inert: Down s', 'mid-turn: no', 'starts-turn: yes',
    'view: runs list, agent rows, footer hints', 'outcome: agent skipped, run continues',
  ].join('\n'),
  'skip-agent.view.txt': ' wf_fixture0-001  project-a\n  > agent-a  running\n  s skip  esc close\n',
};

type Edit = (files: Record<string, string>, mode: Mode) => void;
const fixtureCaptures = (edit?: Edit, only?: Mode, omit?: Mode): Captures => (version) => {
  if (version !== V) return {};
  const out: VersionCaptures = {};
  for (const mode of MODES) {
    if (mode === omit) continue;
    const files = { ...RECORDS };
    if (edit && (!only || only === mode)) edit(files, mode);
    out[mode] = files;
  }
  return out;
};
const setField = (file: string, field: RecordField, value: string): Edit => (files) => {
  files[file] = files[file]!.split('\n').map((l) => (l.startsWith(`${field}:`) ? `${field}: ${value}` : l)).join('\n');
};

const ALL_RULES = Object.values(rules);
const run = (table: WorkflowControlTable, captures: Captures, rule?: Rule): string[] =>
  (rule ? [rule] : ALL_RULES).flatMap((r) => r(table, captures));

describe('the workflow-control table (D-5935)', () => {
  it('compiles only while the three acts cover WorkflowControlAct', () => {
    expect(ACTS_COVER_THE_UNION).toBe(true);
  });

  it('is empty until the captures are recorded (D-5939), so no version is offered a control', () => {
    expect(WORKFLOW_CONTROLS).toEqual({});
  });

  it('CONTROL: a fixture row recorded the same in both modes passes every rule', () => {
    expect(run(FIXTURE_TABLE, fixtureCaptures())).toEqual([]);
  });

  it('every WORKFLOW_CONTROLS row names a version with both an rc/ and a plain/ capture directory', () => {
    expect(rules.bothModeDirs(WORKFLOW_CONTROLS, diskCaptures)).toEqual([]);
    // CONTROL: a row with no capture directory at all, a row missing one mode, a key that is not a version.
    expect(rules.bothModeDirs({ '9.9.8': { 'stop-run': STOP_RUN } }, diskCaptures)).toEqual([
      '9.9.8: no rc/ capture directory', '9.9.8: no plain/ capture directory',
    ]);
    expect(rules.bothModeDirs(FIXTURE_TABLE, fixtureCaptures(undefined, undefined, 'plain'))).toEqual([
      `${V}: no plain/ capture directory`,
    ]);
    expect(rules.bothModeDirs({ latest: {} }, () => ({ rc: {}, plain: {} }))).toEqual(['latest: not an X.Y.Z version']);
  });

  it('a recipe whose rc/ and plain/ captures differ (view, keys, outcome or mid-turn) is not admitted', () => {
    expect(rules.modesAgree(WORKFLOW_CONTROLS, diskCaptures)).toEqual([]);
    const cases: [string, Edit][] = [
      ['view', setField('skip-agent.record.txt', 'view', 'a different view')],
      ['keys', setField('skip-agent.record.txt', 'keys', 'Down Down s Escape')],
      ['outcome', setField('stop-run.record.txt', 'outcome', 'run killed, results lost')],
      ['mid-turn', setField('stop-run.record.txt', 'mid-turn', 'no')],
    ];
    for (const [field, edit] of cases) {
      expect(rules.modesAgree(FIXTURE_TABLE, fixtureCaptures(edit, 'rc')), field).toEqual([
        expect.stringContaining(`differ on ${field}`),
      ]);
    }
    // CONTROL: one mode with no record for the act.
    expect(rules.modesAgree(FIXTURE_TABLE, fixtureCaptures((f) => { delete f['stop-run.record.txt']; }, 'plain')))
      .toEqual([`${V} stop-run: no stop-run.record.txt in plain/`]);
  });

  it("every recipe's keys or command text appear in that version's captures", () => {
    expect(rules.recipeInCaptures(WORKFLOW_CONTROLS, diskCaptures)).toEqual([]);
    const otherKeys: WorkflowControlTable = { [V]: { 'skip-agent': { ...SKIP_AGENT, drive: { kind: 'view-keys', keys: ['Up', 's', 'Escape'], inert: ['Up', 's'] } } } };
    expect(rules.recipeInCaptures(otherKeys, fixtureCaptures())).toEqual([
      `${V} skip-agent: keys not the rc/ recorded ones`, `${V} skip-agent: keys not the plain/ recorded ones`,
    ]);
    const otherCommand: WorkflowControlTable = { [V]: { 'stop-run': { ...STOP_RUN, drive: { kind: 'command', template: '/guessed {runId}' } } } };
    expect(rules.recipeInCaptures(otherCommand, fixtureCaptures())).toEqual(expect.arrayContaining([
      `${V} stop-run: command not the rc/ recorded one`, `${V} stop-run: "/guessed" in no rc/ pane capture`,
    ]));
    // CONTROL: the record names the command but no pane capture shows it (the slash menu was never captured).
    expect(rules.recipeInCaptures({ [V]: { 'stop-run': STOP_RUN } }, fixtureCaptures((f) => { f['stop-run.menu.txt'] = 'nothing here\n'; }, 'plain')))
      .toEqual([`${V} stop-run: "/fixture-stop" in no plain/ pane capture`]);
    // CONTROL: a record with no pane capture beside it.
    expect(rules.recipeInCaptures({ [V]: { 'skip-agent': SKIP_AGENT } }, fixtureCaptures((f) => { delete f['skip-agent.view.txt']; }, 'rc')))
      .toEqual([`${V} skip-agent: no rc/ pane capture`]);
    // CONTROL: a record whose act: names another act than its file.
    expect(rules.recipeInCaptures({ [V]: { 'stop-run': STOP_RUN } }, fixtureCaptures(setField('stop-run.record.txt', 'act', 'stop-agent'), 'rc')))
      .toEqual([`${V} stop-run: rc/ record names act stop-agent`]);
    // CONTROL: a command recipe whose record says it was driven by view keys.
    expect(rules.recipeInCaptures({ [V]: { 'stop-run': STOP_RUN } }, fixtureCaptures(setField('stop-run.record.txt', 'drive', 'view-keys'), 'plain')))
      .toEqual([`${V} stop-run: plain/ recorded drive view-keys`]);
  });

  it("every recipe's mid-turn, starts-turn and inert facts are the recorded ones", () => {
    expect(rules.factsRecorded(WORKFLOW_CONTROLS, diskCaptures)).toEqual([]);
    // midTurn is the fact that refuses turn-running with zero keys, so it is compared with the record too.
    const notMidTurn: WorkflowControlTable = { [V]: { 'stop-run': { ...STOP_RUN, midTurn: false } } };
    expect(rules.factsRecorded(notMidTurn, fixtureCaptures())).toEqual([
      `${V} stop-run: midTurn not the rc/ recorded one`, `${V} stop-run: midTurn not the plain/ recorded one`,
    ]);
    const flipped: WorkflowControlTable = { [V]: { 'stop-run': { ...STOP_RUN, startsTurn: true } } };
    expect(rules.factsRecorded(flipped, fixtureCaptures())).toEqual([
      `${V} stop-run: startsTurn not the rc/ recorded one`, `${V} stop-run: startsTurn not the plain/ recorded one`,
    ]);
    const moreInert: WorkflowControlTable = { [V]: { 'skip-agent': { ...SKIP_AGENT, drive: { kind: 'view-keys', keys: ['Down', 's', 'Escape'], inert: ['Down', 's', 'Escape'] } } } };
    expect(rules.factsRecorded(moreInert, fixtureCaptures())).toEqual([
      `${V} skip-agent: inert keys not the rc/ recorded ones`, `${V} skip-agent: inert keys not the plain/ recorded ones`,
    ]);
  });

  it('every view-keys recipe either lists every key as inert in the main view or is marked not-mid-turn', () => {
    expect(rules.inertOrNotMidTurn(WORKFLOW_CONTROLS, diskCaptures)).toEqual([]);
    const midTurn: WorkflowControlTable = { [V]: { 'skip-agent': { ...SKIP_AGENT, midTurn: true } } };
    expect(rules.inertOrNotMidTurn(midTurn, fixtureCaptures())).toEqual([
      `${V} skip-agent: mid-turn with keys not inert in the main view: Escape`,
    ]);
    // CONTROL: every key inert may run mid-turn; an inert list naming a key never sent, or no keys, is refused.
    const allInert: WorkflowControlTable = { [V]: { 'skip-agent': { ...SKIP_AGENT, midTurn: true, drive: { kind: 'view-keys', keys: ['Down', 's'], inert: ['Down', 's'] } } } };
    expect(rules.inertOrNotMidTurn(allInert, fixtureCaptures())).toEqual([]);
    const stray: WorkflowControlTable = { [V]: { 'skip-agent': { ...SKIP_AGENT, drive: { kind: 'view-keys', keys: ['s'], inert: ['s', 'q'] } } } };
    expect(rules.inertOrNotMidTurn(stray, fixtureCaptures())).toEqual([`${V} skip-agent: inert names keys it never sends: q`]);
    const none: WorkflowControlTable = { [V]: { 'skip-agent': { ...SKIP_AGENT, drive: { kind: 'view-keys', keys: [], inert: [] } } } };
    expect(rules.inertOrNotMidTurn(none, fixtureCaptures())).toEqual([`${V} skip-agent: a view-keys recipe with no keys`]);
  });

  it('no act outside the three, and a command template holds only validated-token slots', () => {
    expect(rules.threeActsAndSlots(WORKFLOW_CONTROLS, diskCaptures)).toEqual([]);
    const extra = { [V]: { 'kill-all': STOP_RUN } } as unknown as WorkflowControlTable;
    expect(rules.threeActsAndSlots(extra, fixtureCaptures())).toEqual([`${V} kill-all: not one of stop-run, stop-agent, skip-agent`]);
    const rawLabel: WorkflowControlTable = { [V]: { 'stop-agent': { ...STOP_RUN, drive: { kind: 'command', template: '/fixture-stop {rawLabel}' } } } };
    expect(rules.threeActsAndSlots(rawLabel, fixtureCaptures())).toEqual([`${V} stop-agent: slot {rawLabel} takes no validated token`]);
    const notSlash: WorkflowControlTable = { [V]: { 'stop-run': { ...STOP_RUN, drive: { kind: 'command', template: 'stop {runId}' } } } };
    expect(rules.threeActsAndSlots(notSlash, fixtureCaptures())).toEqual([`${V} stop-run: a command template that is not a slash command`]);
  });
});
