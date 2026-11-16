// Which workflow controls each Claude Code version has, and how each is driven
// (D-5935, #641; spec 2026-10-20 §4.2-§4.4). L1: data and types only. No `fs`,
// no clock, no I/O, and nothing here sends a key.
//
// SERVER-ONLY KNOWLEDGE. The acts are named on the wire (`WorkflowControlAct`,
// `shared/workflows.ts`), but which version has which act, and how it is driven,
// is decided here alone: `shared/` ships in the PWA bundle, and the PWA never
// decides what a version can do. `single-definition.test.ts` pins this table to
// this file.
//
// A CONTROL EXISTS ONLY AS A MEASURED ROW. A recipe is written by hand from the
// captures recorded on a scratch machine that runs no fleet (spec §4.2), and
// `workflow-controls-table.test.ts` holds every row equal to them. The captures
// live under
//
//   server/test/fixtures/panes/workflow-view/<version>/rc/     (--remote-control)
//   server/test/fixtures/panes/workflow-view/<version>/plain/  (without it)
//
// and each mode's directory holds, for each act the row offers, the pane
// captures (`<act>.<step>.txt`, taken with `capture-pane -e -p`) and one
// `<act>.record.txt` that states what those captures showed, one `field: value`
// per line:
//
//   act:          stop-run | stop-agent | skip-agent
//   drive:        command | view-keys
//   command:      the template, slots written {runId} {agentKey} {label} (command)
//   keys:         the tmux key names sent, space-separated, in order    (view-keys)
//   inert:        those keys recorded inert in the main view, idle and mid-turn
//   mid-turn:     yes | no      (spec §4.2 (e))
//   starts-turn:  yes | no      (spec §4.2 (e3))
//   view:         what the view showed, one line ('-' for a command)
//   outcome:      what the act did, one line (killed, kept, resumable)
//
// A row is admitted only when the two modes' records agree in every field (spec
// §4.2 step 2), so the table is keyed by VERSION ONLY and the server never reads
// a session's mode. An act whose two records differ gets no row on that version.
// A version with no row is offered nothing, and a row never covers a later
// version: each version gets its own row, on its own captures.
import type { WorkflowControlAct } from '../../../shared/workflows.js';

/** The slots a `command` template may hold. Each takes only a token checked by
 *  the reader's own pattern (spec §4.3): the run id by `RUN_ID_RE`, the agent
 *  key by `KEY_RE` (`workflows/model.ts`), and a label only when it is printable,
 *  holds no C0/C1 character and is at most 64 characters. A raw label is never
 *  typed. */
export const WORKFLOW_CONTROL_SLOTS = ['runId', 'agentKey', 'label'] as const;
export type WorkflowControlSlot = (typeof WORKFLOW_CONTROL_SLOTS)[number];

/** How an act is driven: one of the two things the keys path can do.
 *  - `command`: type a slash command that names the run or agent by a validated
 *    token, then Enter. Preferred, because it addresses its target by name.
 *  - `view-keys`: the recorded keys, in order (open the view, move to the row,
 *    the act's key, the view's own close key), each verified against the pane
 *    after it is sent. `inert` names the keys recorded inert in the main view,
 *    idle and mid-turn (§4.2 (e2)); any other key is sent only after a fresh
 *    live-word reading and capture show no running turn and the view. */
export type WorkflowControlDrive =
  | { kind: 'command'; template: string }
  | { kind: 'view-keys'; keys: readonly string[]; inert: readonly string[] };

/** One act on one version, as recorded. */
export interface WorkflowControlRecipe {
  drive: WorkflowControlDrive;
  /** The act worked while a main turn was running (§4.2 (e)). False: it is
   *  refused `turn-running` with zero keys while a turn runs. */
  midTurn: boolean;
  /** The act itself started a main turn (§4.2 (e3)), so a plan-time reading of
   *  the live word is stale by the time the close key is due. */
  startsTurn: boolean;
}

/** Version (`X.Y.Z`, exactly as Claude Code reports it) → the acts it offers. */
export type WorkflowControlTable = Readonly<
  Record<string, Readonly<Partial<Record<WorkflowControlAct, WorkflowControlRecipe>>>>
>;

/** The measured table. EMPTY until the captures are recorded (D-5939): until
 *  then no version is offered any control. */
export const WORKFLOW_CONTROLS: WorkflowControlTable = {};
