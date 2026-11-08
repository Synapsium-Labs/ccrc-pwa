// Browser MCP servers, off by default (D-8121): the words and the readers the Browser tools card, the session's Browser
// sheet and the New session sheet share. Pure, no React, no fetch: L1.
//   * `browserMcpView` is a session's ONE reader: what it asked for (`route.fields.browser`), what its running pane's
//     spawn applied (`FleetSession.browserMcp`, optional on the wire), and whether the two differ until its next start.
//   * `browserBoxOf` reads the fleet node's two box settings off the one `/api/updates` poll (`boxSettingsOf`, the field's
//     one reader), never a request of its own.
//   * `browserFleetCount` counts the running sessions whose pane runs the servers.
import {
  BROWSER_MCP_SERVERS_DEFAULT, type BrowserMcpApplied, type FleetSession, type NodeWire,
} from '../../../shared/api';
import { boxSettingsOf } from './boxSettingsWords';

/** The two words of the `browser` route field (ccd's `ROUTE_BROWSERS`). */
export const BROWSER_WORDS = ['on', 'off'] as const;
export type BrowserWord = (typeof BROWSER_WORDS)[number];
const isBrowserWord = (v: unknown): v is BrowserWord => v === 'on' || v === 'off';

/** What the running pane's spawn applied: the record's word, `none` (no record: a spawn before ccd managed the servers),
 *  or `unknown` (an older server sends no field). */
export type BrowserApplied = BrowserMcpApplied | 'none' | 'unknown';

export interface BrowserMcpView {
  /** The session's own field; null when it has none (the box default decides) or it could not be read. */
  asked: BrowserWord | null;
  /** The route read failed for this field this pass: what it asked is unknown, not "none". */
  askedUnreadable: boolean;
  applied: BrowserApplied;
  /** What its next start applies: its own field, else the box default; null when neither is known. */
  next: BrowserWord | null;
  /** Its next start applies something its running pane does not have: its own field, or the box default it follows
   *  (a pane spawned before ccd managed the servers, `none`, runs them, so a default of off is a change too). */
  queued: boolean;
}

export function browserMcpView(s: Pick<FleetSession, 'route' | 'browserMcp'>, boxDefault: BrowserWord | null = null): BrowserMcpView {
  const route = s.route ?? null;
  // The live frame is cast, not revived: an older server's `route` may lack `unreadable` (`routeView`'s reading).
  const askedUnreadable = (route?.unreadable ?? []).includes('browser');
  const raw = route?.fields.browser;
  const asked = isBrowserWord(raw) ? raw : null;
  const applied: BrowserApplied = s.browserMcp === undefined ? 'unknown' : s.browserMcp === null ? 'none' : s.browserMcp;
  const next = askedUnreadable ? null : asked ?? boxDefault;
  const queued = next !== null
    && (((applied === 'on' || applied === 'off') && next !== applied) || (applied === 'none' && next === 'off'));
  return { asked, askedUnreadable, applied, next, queued };
}

export const BROWSER_APPLIED_TEXT: Readonly<Record<BrowserApplied, string>> = {
  on: 'Browser tools are on in this run.',
  off: 'Browser tools are off in this run.',
  none: 'This run started before ccrc managed browser tools, so it has what its account enables.',
  unreadable: "This run's browser record could not be read.",
  unknown: 'This server does not report browser tools.',
};

/** The sheet's and the inspector's one line about a session. */
export function browserLine(v: BrowserMcpView): string {
  const head = BROWSER_APPLIED_TEXT[v.applied];
  if (v.askedUnreadable) return `${head} What it asked for could not be read.`;
  if (v.queued && v.asked !== null) return `${head} Asked: ${v.asked}, at its next restart.`;
  if (v.queued) return `${head} It follows the box default, ${v.next}, from its next restart.`;
  if (v.asked === null) return `${head} It follows the box default.`;
  return head;
}

/** The box's two settings, as the fleet node reports them: the default (null: not reported, or not read), and whether
 *  the server list is the default one (`custom`: the box sets its own; null: not reported). */
export interface BrowserBox { default: BrowserWord | null; servers: 'default' | 'custom' | null }

export function browserBoxOf(nodes: readonly NodeWire[]): BrowserBox {
  const node = nodes.find((n) => n.role === 'fleet' || n.role === 'both');
  const read = node === undefined ? null : boxSettingsOf(node);
  if (read === null || typeof read === 'string' || read.state !== 'ok') return { default: null, servers: null };
  const row = (k: string) => read.doc.settings.find((r) => r.key === k);
  const d = row('CCRC_BROWSER_MCP_DEFAULT');
  const sv = row('CCRC_BROWSER_MCP_SERVERS');
  return {
    default: d !== undefined && d.state === 'ok' && 'value' in d && isBrowserWord(d.value) ? d.value : null,
    servers: sv === undefined || sv.state !== 'ok' ? null : sv.from === 'default' || sv.from === 'empty' ? 'default' : 'custom',
  };
}

/** The default list, one name a line (`CCRC_BROWSER_MCP_SERVERS`' default, `shared/api.ts`). */
export const BROWSER_DEFAULT_SERVERS: readonly string[] = BROWSER_MCP_SERVERS_DEFAULT.split(',');

/** Running sessions (presence `alive`), and how many of them run the servers or have a change waiting for a restart. */
export interface BrowserFleetCount { running: number; using: number; queued: number; unrecorded: number }

/** `using` counts the panes whose record says on; a pane with no record (`unrecorded`) runs what its account enables,
 *  which the console does not see, so it is counted apart rather than as using a browser. `boxDefault` is what a
 *  session with no field of its own applies at its next start (null: not reported). */
export function browserFleetCount(
  sessions: readonly Pick<FleetSession, 'route' | 'browserMcp' | 'presence'>[], boxDefault: BrowserWord | null = null,
): BrowserFleetCount {
  let running = 0, using = 0, queued = 0, unrecorded = 0;
  for (const s of sessions) {
    if (s.presence !== 'alive') continue;
    running++;
    const v = browserMcpView(s, boxDefault);
    if (v.applied === 'on') using++;
    if (v.applied === 'none') unrecorded++;
    if (v.queued) queued++;
  }
  return { running, using, queued, unrecorded };
}

export const BROWSER_TEXT = {
  defaultLegend: 'Box default',
  defaultOn: 'On: every session starts the browser servers its account enables.',
  defaultOff: 'Off: a session starts none of them unless it asks for them.',
  defaultUnknown: "The fleet box has not reported this setting yet (its ccd may be older).",
  setting: 'Set CCRC_BROWSER_MCP_DEFAULT (on or off) in ~/.ccrc/ccrc.env on the fleet box; ccd reads it at every start.',
  serversLegend: 'Servers it turns off',
  countLegend: 'Running sessions',
  serversCustom: 'The fleet box sets its own list (CCRC_BROWSER_MCP_SERVERS).',
  perSession: 'A session turns its own on or off from its menu (Browser tools), a coordinator with a dispatch route of '
    + 'browser=on, and a session itself with ccd route --set browser=on. A running session keeps what it has until its next start.',
  parking: 'Hibernation ends the pane; with Stop leftovers on, it also stops the server processes a pane leaves behind.',
  stopLeftovers: 'Go to Stop leftovers',
  restartLimit: 'There is no restart-now control yet: a change reaches a running session when it next starts.',
} as const;

/** The count line: "N of M running sessions use a browser", plus what is waiting and what predates ccrc's record. */
export function browserCountLine(c: BrowserFleetCount): string {
  const head = `${c.using} of ${c.running} running session${c.running === 1 ? '' : 's'} ${c.using === 1 ? 'uses' : 'use'} a browser.`;
  const parts = [head];
  if (c.unrecorded > 0) {
    parts.push(`${c.unrecorded} more started before ccrc managed browser tools and ${c.unrecorded === 1 ? 'runs' : 'run'} what ${c.unrecorded === 1 ? 'its' : 'their'} account enables.`);
  }
  if (c.queued > 0) parts.push(`${c.queued} will change at ${c.queued === 1 ? 'its' : 'their'} next start.`);
  return parts.join(' ');
}

/** The session sheet's words. */
export const BROWSER_SHEET_TEXT = {
  title: 'Browser tools',
  label: { on: 'On', off: 'Off' } satisfies Record<BrowserWord, string>,
  sublabel: {
    on: 'It starts the browser servers its account enables (Playwright, Chrome DevTools).',
    off: 'It starts none of them; their skills stay.',
  } satisfies Record<BrowserWord, string>,
  foot: 'Applies when the session next starts; a running session keeps what it has.',
  saved: {
    on: 'Browser tools on — from its next start.',
    off: 'Browser tools off — from its next start.',
  } satisfies Record<BrowserWord, string>,
  unsupported: "This fleet box's ccd does not take a browser choice yet; update it first.",
} as const;
