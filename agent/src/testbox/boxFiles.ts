// D-8907, D-8912 (spec docs/superpowers/specs/2026-11-22-test-box-managed-node-design.md §2.2, §2.5, §2.7; plan
// docs/superpowers/plans/2026-11-22-test-box-managed-node.md). L1, pure: the files the box's updater and the test
// service exchange, their names and their text. Nothing here opens a file (`boxFs.ts`, L3, does) and nothing here
// decides (`drain.ts` and `tools.ts` do).
//
// WHY FILES, AND NOT A FRAME (D-8912). Every reader of the test box's frame family refuses a whole frame for one field
// it does not name (`shared/testbox.ts#readTestboxFrame`), so a fact added to the status answer would make every
// released fleet agent refuse the box. And the updater cannot ask the service over its socket: the service does not
// listen on loopback (D-8907). So what the service and the updater tell each other is five small files on the box.
//
// THE FIVE FILES, each with one writer:
//
//   <tools>/node-state/node-id      root (the updater). A box that has it is a MANAGED box: the update act is its
//                                   one mover, and the tool sync starts nothing there (`tools.ts#syncsHere`).
//   <tools>/node-state/tools.json   root (the updater): the six tool versions it measured after the switch, a JSON
//                                   object keyed by the tool's name, each value the version as a frame carries one
//                                   (`22.11.0`, never `v22.11.0`). A key this reader does not name is ignored, and a
//                                   tool that is absent or off its shape reads as not measured, alone.
//   /run/ccrc-testbox-drain/request root (the updater): the drain request, a lease. Lines of `key<TAB>value`:
//                                     act<TAB><the act's id>
//                                     deadline<TAB><seconds since the epoch, on the box's clock>
//   /run/ccrc-testbox/drain         the service: its answer, in its own runtime directory.
//                                     act<TAB><the act's id it answers>
//                                     state<TAB>draining     with  running<TAB><runs in progress>
//                                     state<TAB>idle         with  queued<TAB><queued runs on disk>
//   /run/ccrc-testbox/ready         the service, once it has bound its address:
//                                     release<TAB><the release tag of the tree it runs from>
//                                     pid<TAB><its process id, the unit's main pid>
//
// The `key<TAB>value` form is the box's own (the tools unit's report, `tools.ts#parseReport`): root's shell reads and
// writes it with no JSON tool. Every reader ignores a key it does not name, so a later release may add one.
//
// The other side is root's shell (the updater), which cannot import this file. The text both sides must agree on is
// stated once more, as data, in `agent/test/fixtures/testbox-box-files.json`: `agent/test/testbox-managed-node.test.ts`
// pins this file to it, and the updater's suite pins its shell to the same file.

/** Under the tools directory: the node files the box's updater keeps (spec §2.2). */
export const NODE_STATE_DIR = 'node-state';
/** Under `node-state/`: the node's identity, minted once by the updater and never rewritten. */
export const NODE_ID_FILE = 'node-id';
/** Under `node-state/`: the six tool versions the updater measured (spec §2.6). */
export const TOOLS_JSON_FILE = 'tools.json';

/** The service's own runtime directory: it writes its two files here and nothing else does. */
export const RUNTIME_DIR = '/run/ccrc-testbox';
/** Under the runtime directory: the ready file (spec §2.7). */
export const READY_FILE = 'ready';
/** Under the runtime directory: the drain's answer (spec §2.5). */
export const DRAIN_ANSWER_FILE = 'drain';
/** The drain request, in a root-owned directory the service can only read (spec §2.5). */
export const DRAIN_REQUEST_FILE = '/run/ccrc-testbox-drain/request';

/** No file of these is longer: a longer one is not read. */
export const BOX_FILE_MAX = 4096;

/** Where the service's files and the request are; the entry point's are the fixed ones, a test passes a fixture's. */
export interface BoxPaths { readonly runtimeDir: string; readonly drainRequest: string }
export const BOX_PATHS: BoxPaths = { runtimeDir: RUNTIME_DIR, drainRequest: DRAIN_REQUEST_FILE };

/** One small file as it was read: its text, proven absent, or not readable and why. Three answers, never folded: an
 *  absent file is a fact (no request, no node files), an unreadable one is no information. */
export type SmallRead =
  | { readonly t: 'text'; readonly text: string }
  | { readonly t: 'absent' }
  | { readonly t: 'unreadable'; readonly why: string };

/** `key<TAB>value` lines to their fields. A line with no tab, or with an empty key, is skipped; of a key written twice
 *  the last line stands. */
export function tabFields(text: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of text.split('\n')) {
    const i = line.indexOf('\t');
    if (i > 0) m.set(line.slice(0, i), line.slice(i + 1));
  }
  return m;
}

const lines = (fields: readonly (readonly [string, string | number])[]): string => fields.map(([k, v]) => `${k}\t${String(v)}\n`).join('');

/** The drain request: whose act asks, and until when the request stands (ms since the epoch). */
export interface DrainRequest { readonly actId: string; readonly deadlineMs: number }

/** An act's id, as the updater mints one and the request and the answer carry it. */
export const ACT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const EPOCH_SECONDS = /^[1-9][0-9]{0,11}$/;

/** The request's text to the request, or why it does not read as one. */
export function parseDrainRequest(text: string): { readonly ok: true; readonly request: DrainRequest } | { readonly ok: false; readonly why: string } {
  const f = tabFields(text);
  const act = f.get('act');
  const deadline = f.get('deadline');
  if (act === undefined || !ACT_ID.test(act)) return { ok: false, why: act === undefined ? 'no act line' : 'act is not an act id' };
  if (deadline === undefined || !EPOCH_SECONDS.test(deadline)) return { ok: false, why: deadline === undefined ? 'no deadline line' : 'deadline is not seconds since the epoch' };
  return { ok: true, request: { actId: act, deadlineMs: Number(deadline) * 1000 } };
}

/** The service's answer to a drain request: still waiting for runs to end, or idle with its queue on disk. */
export type DrainAnswer =
  | { readonly act: string; readonly state: 'draining'; readonly running: number }
  | { readonly act: string; readonly state: 'idle'; readonly queued: number };

export function encodeDrainAnswer(a: DrainAnswer): string {
  return lines([['act', a.act], ['state', a.state], a.state === 'idle' ? ['queued', a.queued] : ['running', a.running]]);
}

/** The ready file's text: the release this service runs from and its process id. */
export function encodeReady(r: { readonly release: string; readonly pid: number }): string {
  return lines([['release', r.release], ['pid', r.pid]]);
}
