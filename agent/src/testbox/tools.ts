// D-7408, D-7424, D-7426 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB6; spec §2.10 "Tools in step
// with the fleet host"). L1, pure and clock-free: the tool sync's decisions. Every time is given by the caller, in ms
// since the epoch; every file is read by the caller (`toolsync.ts`, L4) and handed here as text.
//
// The sync's state is `idle`, `syncing` (the status detail names the step the tools unit is on) or `failed` (the
// detail is `<tool>: <why>`, so the status reason reads `tool sync failed (<tool>: <why>)`). A `tools.sync` whose
// release is the installed one and whose six versions are the current set's starts nothing and changes nothing. One
// that arrives while a sync runs waits and runs next, the newest replacing an older one. A failed sync is retried on
// the pristine build's backoff (`CCRC_TESTBOX_PRISTINE_RETRY`, the last delay repeating); a new frame runs at once. A
// sync that replaced the release ends in the takeover (D-7426): the service starts no run, lets the runs in progress
// end, hands the queued ones to the next service and exits to be restarted on the new tree, and no frame starts a sync
// meanwhile: a frame that was waiting when the sync ended, or that comes during the takeover, is kept (the newest
// replacing an older) and handed to the next service with the queued runs, which runs it (D-7559). A run resolves the
// tool set once, so the service names, in each spec, the set every live run started under, and the tools unit keeps
// those; a prepare's set is pinned when its spec is built, before the prepare awaits anything.
import {
  TESTBOX_TOOLS,
  type StatusAnswer, type TestboxSync, type TestboxTool, type TestboxToolVersions, type ToolsSync,
} from '../../../shared/testbox.js';
import path from 'node:path';
import { retryDelay } from './pristine.js';
import { degradedReasons } from './status.js';

/** The three settings the tool sync reads (`config.ts`'s `lines`, through `toolsSettings`). */
export const TOOLS_KNOBS = ['CCRC_TESTBOX_PRISTINE_RETRY', 'CCRC_TESTBOX_REGISTRY_PROXY', 'CCRC_TESTBOX_OS_MIRROR'] as const;

export interface ToolsSettings {
  /** The delays between attempts of a failed sync, the last repeating (the pristine build's). */
  readonly retryMs: readonly number[];
  /** `host:port` of the registry proxy, written into the node install's npmrc and used for npm. */
  readonly proxy: string;
  /** The OS package mirror; empty for the distribution's own. */
  readonly mirror: string;
}

/** The settings from the printer's lines; `duration` is the caller's duration reader (`config.ts#durationMs`). */
export function toolsSettings(
  lines: ReadonlyMap<string, { readonly value: string }>, duration: (key: string, value: string) => number,
): ToolsSettings {
  const v = (k: (typeof TOOLS_KNOBS)[number]): string => {
    const l = lines.get(k);
    if (l === undefined) throw new Error(`the settings printer gave no ${k}`);
    return l.value;
  };
  const words = v('CCRC_TESTBOX_PRISTINE_RETRY').split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) throw new Error('CCRC_TESTBOX_PRISTINE_RETRY names no delay');
  return {
    retryMs: words.map((w) => duration('CCRC_TESTBOX_PRISTINE_RETRY', w)),
    proxy: v('CCRC_TESTBOX_REGISTRY_PROXY'), mirror: v('CCRC_TESTBOX_OS_MIRROR'),
  };
}

/** What the box has: the installed release's tag, the current set's versions and the current set's name. */
export interface BoxTools {
  readonly release: string | null;
  readonly versions: TestboxToolVersions | null;
  readonly set: string | null;
}

export interface ToolsState {
  readonly sync: TestboxSync;
  /** The tools unit is running. */
  readonly running: boolean;
  /** A frame that came while a sync ran: it runs next; during the takeover, the next service runs it. */
  readonly pending: ToolsSync | null;
  /** The frame the running or the failed sync is for; a retry runs it again. */
  readonly last: ToolsSync | null;
  readonly attempts: number;
  readonly nextAt: number | null;
  /** A sync replaced the release: the service is handing over to the new tree. */
  readonly takeover: boolean;
  /** Each live run, and the set that was current when the service first saw it live. */
  readonly runSets: ReadonlyMap<string, string>;
}

export const IDLE_TOOLS: ToolsState = {
  sync: { state: 'idle', detail: null, at: null }, running: false, pending: null, last: null, attempts: 0, nextAt: null,
  takeover: false, runSets: new Map(),
};

/** The release and the six versions are the box's. */
export function sameAsBox(f: ToolsSync, box: BoxTools): boolean {
  if (box.release !== f.release || box.versions === null) return false;
  return TESTBOX_TOOLS.every((t) => box.versions![t] === f.versions[t]);
}

export interface Decision { readonly state: ToolsState; readonly start: ToolsSync | null }

const syncing = (at: string, detail: string | null = null): TestboxSync => ({ state: 'syncing', detail, at });

/** A `tools.sync` frame (the update lane's, or the card's **Bring tools up to date**). */
export function requested(s: ToolsState, f: ToolsSync, box: BoxTools, at: string): Decision {
  // D-7559: never dropped; the takeover hands it to the next service.
  if (s.takeover) return { state: { ...s, pending: f }, start: null };
  if (s.running) return { state: { ...s, pending: f }, start: null };
  if (sameAsBox(f, box)) {
    // Nothing to do, and nothing changes on the box; a failed sync for another set is over, since the fleet host
    // now asks for what the box has.
    return { state: { ...s, sync: s.sync.state === 'failed' ? { state: 'idle', detail: null, at } : s.sync, attempts: 0, nextAt: null, last: null }, start: null };
  }
  return { state: { ...s, running: true, sync: syncing(at), last: f, attempts: 0, nextAt: null }, start: f };
}

/** The failed sync whose next attempt has come, or `null`. */
export function retryDue(s: ToolsState, now: number): ToolsSync | null {
  if (s.running || s.takeover || s.sync.state !== 'failed' || s.last === null || s.nextAt === null) return null;
  return s.nextAt <= now ? s.last : null;
}

/** A retry starts: the attempts counted so far are kept. */
export function retryStarted(s: ToolsState, at: string): ToolsState {
  return { ...s, running: true, sync: syncing(at), nextAt: null };
}

/** The tools unit's report, `<tools>/sync-report`: one `key<TAB>value` line each. */
export interface SyncReport {
  readonly result: 'ok' | 'noop' | 'failed' | 'syncing' | null;
  readonly tool: string | null;
  readonly detail: string | null;
  readonly step: string | null;
  readonly release: string | null;
  readonly set: string | null;
  readonly takeover: boolean;
  readonly nodeChanged: boolean;
  readonly chromeSha256: string | null;
}

export function parseReport(text: string | null): SyncReport {
  const m = new Map<string, string>();
  for (const line of (text ?? '').split('\n')) {
    const i = line.indexOf('\t');
    if (i > 0) m.set(line.slice(0, i), line.slice(i + 1));
  }
  const r = m.get('result');
  const word = (k: string): string | null => { const v = m.get(k); return v === undefined || v === '' ? null : v; };
  return {
    result: r === 'ok' || r === 'noop' || r === 'failed' || r === 'syncing' ? r : null,
    tool: word('tool'), detail: word('detail'), step: word('step'), release: word('release'), set: word('set'),
    takeover: m.get('takeover') === '1', nodeChanged: m.get('node-changed') === '1', chromeSha256: word('chrome-sha256'),
  };
}

export interface Ended {
  readonly state: ToolsState;
  /** The release was replaced: hand over to the new tree. */
  readonly takeover: boolean;
  /** The current set's node is another: every pristine key is rebuilt. */
  readonly nodeChanged: boolean;
  /** The frame to run now (one that came during the sync), or `null`. */
  readonly next: ToolsSync | null;
}

/** The tools unit ended with `exit` and left `report`. A pass is exit 0 with an `ok` or `noop` report; anything else
 *  is a failure, named by the report's tool and detail when it gave them. */
export function ended(s: ToolsState, exit: number, report: SyncReport, now: number, retryMs: readonly number[], at: string): Ended {
  const passed = exit === 0 && (report.result === 'ok' || report.result === 'noop');
  const pending = s.pending;
  if (passed) {
    const takeover = report.result === 'ok' && report.takeover;
    return {
      state: { ...s, running: false, pending: takeover ? pending : null, last: null, attempts: 0, nextAt: null, takeover, sync: { state: 'idle', detail: null, at } },
      takeover, nodeChanged: report.result === 'ok' && report.nodeChanged, next: takeover ? null : pending,
    };
  }
  const tool = report.result === 'failed' && report.tool !== null ? report.tool : 'sync';
  const why = report.result === 'failed' && report.detail !== null ? report.detail : `the tools unit exited ${exit}`;
  const attempts = s.attempts + 1;
  return {
    state: { ...s, running: false, pending: null, attempts, nextAt: now + retryDelay(retryMs, attempts), sync: { state: 'failed', detail: `${tool}: ${why}`, at } },
    takeover: false, nodeChanged: false, next: pending,
  };
}

/** The sync's state for the status answer, with the step the running unit reports. */
export function syncNow(s: ToolsState, report: SyncReport): TestboxSync {
  if (s.sync.state !== 'syncing') return s.sync;
  return { ...s.sync, detail: report.result === 'syncing' && report.step !== null ? report.step : s.sync.detail };
}

/** Every run live now, each with the set it started under: the set its spec names (`named`, read from `specs/<k>`),
 *  else the one it was first seen under, else, for a run first seen now whose spec is not written yet, `current`. */
export function seenRuns(
  runSets: ReadonlyMap<string, string>, live: Iterable<string>, current: string | null, named: ReadonlyMap<string, string> = new Map(),
): Map<string, string> {
  const out = new Map<string, string>();
  for (const id of live) {
    const s = named.get(id) ?? runSets.get(id) ?? current;
    if (s !== null) out.set(id, s);
  }
  return out;
}

/** The key `runSets` holds the pristine install's set under (no run id has this shape). */
export const INSTALL_SETS_KEY = '(install)';
/** A tool set's name, as the tools unit makes and checks it (`deploy/testbox/bin/tools-sync`'s `TBT_RE_SET`). */
const SET_NAME = /^s\.[A-Za-z0-9]{6,32}$/;

/** A run's or the install's spec (`specs/<k>`, `specs/install`) to its run id (`null` for the install's) and the set
 *  its `PATH` starts at, `<tools>/sets/<set>/bin`, where `<tools>` is one of `toolsRoots` (the setting, and the path it
 *  resolves to); `set` is `null` when the first entry is no set's. */
export function specSet(text: string, toolsRoots: readonly string[]): { readonly runId: string | null; readonly set: string | null } {
  let runId: string | null = null;
  let first: string | null = null;
  for (const r of text.split('\0')) {
    if (r.startsWith('R') && runId === null) runId = r.slice(1);
    else if (r.startsWith('EPATH=') && first === null) first = r.slice('EPATH='.length).split(':')[0] ?? '';
  }
  return { runId, set: first === null ? null : binSet(first, toolsRoots) };
}

/** A `PATH` entry `<tools>/sets/<set>/bin` to its set, where `<tools>` is one of `toolsRoots`; else `null`. */
export function binSet(first: string, toolsRoots: readonly string[]): string | null {
  if (path.basename(first) !== 'bin') return null;
  const setDir = path.dirname(first);
  const set = path.basename(setDir);
  const sets = path.dirname(setDir);
  return SET_NAME.test(set) && path.basename(sets) === 'sets' && toolsRoots.includes(path.dirname(sets)) ? set : null;
}

/** The sets a live run uses, each once, in name order. */
export function keptSets(runSets: ReadonlyMap<string, string>): string[] {
  return [...new Set(runSets.values())].sort();
}

/** The current set's `versions` file (`<tool><TAB><version>` lines) to the six versions; `null` unless all six. */
export function parseVersions(text: string | null): TestboxToolVersions | null {
  if (text === null) return null;
  const out: Partial<Record<TestboxTool, string>> = {};
  for (const line of text.split('\n')) {
    const [t, v] = line.split('\t');
    if (t !== undefined && v !== undefined && (TESTBOX_TOOLS as readonly string[]).includes(t) && v !== '') out[t as TestboxTool] = v;
  }
  return TESTBOX_TOOLS.every((t) => out[t] !== undefined) ? (out as TestboxToolVersions) : null;
}

/** The spec header the tools unit takes (`deploy/testbox/bin/tools-sync`). */
export const TOOLS_SPEC_HEADER = 'ccrc-testbox-tools-spec';
/** The order the tools unit names the six tools in. */
const SPEC_TOOLS: readonly TestboxTool[] = ['node', 'npm', 'chrome', 'python3', 'git', 'tmux'];

/** `specs/tools`: NUL-separated records, `T` the tools directory, `R` the release, `V<tool>=<version>` six times, `P`
 *  the registry proxy, `O` the OS mirror (empty: the distribution's own), `K` each set a live run uses. */
export function encodeToolsSpec(o: {
  readonly toolsDir: string; readonly frame: ToolsSync; readonly settings: ToolsSettings; readonly keep: readonly string[];
}): Buffer {
  const recs = [
    TOOLS_SPEC_HEADER, `T${o.toolsDir}`, `R${o.frame.release}`,
    ...SPEC_TOOLS.map((t) => `V${t}=${o.frame.versions[t]}`),
    `P${o.settings.proxy}`, `O${o.settings.mirror}`, ...o.keep.map((k) => `K${k}`),
  ];
  for (const r of recs) if (r.includes('\0')) throw new Error('a spec value holds a NUL');
  return Buffer.from(recs.map((r) => `${r}\0`).join(''), 'utf8');
}

/** The service's status answer with the tool sync's state in it. The service's own answer carries an idle sync, and a
 *  sync's reason is the first of the degraded reasons (`status.ts#degradedReasons`), so it is put first; a `down` box
 *  stays `down`, its reason the down reasons alone, as `statusAnswer` reads them. */
export function withSync(a: StatusAnswer, sync: TestboxSync): StatusAnswer {
  const reasons = degradedReasons({
    reflink: { ok: true }, mirrors: [], release: a.release, serviceVersion: a.serviceVersion, tools: a.tools, fleetTools: null,
    sync, inProgress: 0, limit: 0, queueDepth: 0, pristine: [], failedKeys: [], heldRunUsers: [],
  });
  if (reasons.length === 0 || a.state === 'down') return { ...a, sync };
  const own = a.reason === null ? [] : [a.reason];
  return { ...a, sync, state: 'degraded', reason: [...reasons, ...own].join('; ') };
}
