// L3 adapter, context C3 (Session Conversation): the ccd adapter of the `SessionHost` port (Overlord spec §3.6 H2, §3.3.11
// H13; W1a renewal act Task 2). It renews a session with `ccd hibernate --roll --fresh`, types the first line through the
// injected send, and reads the context and the receipt from the injected reads. It keeps every distinction ccd's exit
// codes and the link give it: each exit code has its own word, a transport failure and an unmeasured exit are
// `unreachable` (never a refusal, never zero), and the usage and start reads keep their own kinds. It imports no tmux and
// makes no decision beyond naming what it was told; the capability gate sits beside the one `CCD_ARGV.hibernate` call.
import { CCD_ARGV, HIBERNATE_FRESH_CAP, capSupported, ccdCan, sweepDec } from '../ccdargv.js';
import type { RunCcd } from '../coord/ports.js';
import type { FleetState } from '../fleetstate.js';
import type { SendResult } from '../inject/send.js';
import type { UsageRead } from '../usage.js';
import type { StartsRead } from './continuityStore.js';
import type { Reading } from './renewalDue.js';
import type { DeliverResult, ReceiptRead, RenewResult, SessionHost } from './sessionHost.js';

/** What the adapter reaches, each narrow so a test hands fakes. The server binds `send` to `sendPrompt`, `usage` to
 *  `readUsageMeasured` and `startsOf` to the store's member of that name. */
export interface CcdSessionHostDeps {
  readonly runCcd: RunCcd;
  readonly fleetState: Pick<FleetState, 'ccdVerbs'> | undefined;
  readonly send: (sessionId: string, text: string) => Promise<SendResult>;
  readonly usage: (sessionId: string) => Promise<UsageRead>;
  readonly startsOf: (sessionId: string, limit: number) => StartsRead;
  readonly log?: (line: string) => void;
}

/** How many of a session's newest starts `receipt` looks through. */
const RECEIPT_STARTS_LIMIT = 200;
/** ccd's refusal line for a session that cannot be rolled now (`ccd: session-busy: <why>`). */
const SESSION_BUSY = /ccd: session-busy: ?(\S*)/;

const firstLine = (s: string): string => s.split('\n').find((l) => l.trim() !== '')?.trim() ?? '';
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function ccdSessionHost(deps: CcdSessionHostDeps): SessionHost {
  const unmeasured = (why: string): Reading<never> => ({ kind: 'unmeasured', why });

  async function renew(sessionId: string, n: number): Promise<RenewResult> {
    // The token is the gate for the `--roll --fresh` flags; `ccdCan` asks the verb itself, as every other `hibernate` act does.
    if (!capSupported(deps.fleetState, HIBERNATE_FRESH_CAP) || !ccdCan(deps.fleetState, 'hibernate')) return { kind: 'capability-missing' };
    const base = sweepDec(deps.fleetState, 'sweep:renew');
    const dec = base === null ? null : { ...base, reason: `renewal n=${n}` };
    let res;
    try { res = await deps.runCcd(CCD_ARGV.hibernate(sessionId, dec, null, 'fresh')); }
    catch (e) { return { kind: 'unreachable', detail: messageOf(e) }; }
    if (res.ran === false) return { kind: 'unreachable', detail: res.stderr };
    if (res.ok) return { kind: 'started' };
    if (res.exitCode === undefined) return { kind: 'unreachable', detail: 'ccd exit code was not measured' };
    switch (res.exitCode) {
      case 3: return { kind: 'refused', reason: SESSION_BUSY.exec(res.stderr)?.[1] || firstLine(res.stderr) || 'ccd refused the roll (exit 3) and gave no reason' };
      case 4: return { kind: 'wake-failed' };
      case 5: return { kind: 'wake-unrestored' };
      case 6: return { kind: 'kill-failed' };
      case 7: return { kind: 'unproven' };
      default:
        deps.log?.(`ccrc-server: renewal: ccd hibernate --roll --fresh exited ${res.exitCode} for ${sessionId}`);
        return { kind: 'unreachable', detail: `ccd exited ${res.exitCode}` };
    }
  }

  async function deliver(sessionId: string, text: string): Promise<DeliverResult> {
    let r: SendResult;
    try { r = await deps.send(sessionId, text); }
    catch (e) { return { kind: 'unreachable', detail: messageOf(e) }; }
    return r.ok ? { kind: 'sent' } : { kind: 'refused', reason: r.error };
  }

  async function contextUsage(sessionId: string): Promise<Reading<{ readonly tokens: number; readonly window: number }>> {
    let r: UsageRead;
    try { r = await deps.usage(sessionId); }
    catch (e) { return unmeasured(`usage read failed: ${messageOf(e)}`); }
    if (r.kind !== 'reading') return unmeasured(`usage ${r.kind}`);
    if (r.usage.stale) return unmeasured('usage stale');
    const { ctxTokens, ctxWindow } = r.usage;
    if (typeof ctxTokens !== 'number') return unmeasured('usage has no ctxTokens');
    if (typeof ctxWindow !== 'number') return unmeasured('usage has no ctxWindow');
    return { kind: 'measured', value: { tokens: ctxTokens, window: ctxWindow } };
  }

  async function receipt(sessionId: string, sinceStartId: number): Promise<ReceiptRead> {
    let r: StartsRead;
    try { r = deps.startsOf(sessionId, RECEIPT_STARTS_LIMIT); }
    catch (e) { return { kind: 'unreadable', detail: messageOf(e) }; }
    if (!r.ok) return { kind: 'unreadable', detail: r.detail };
    // The rows come newest first by `reportedAt`; a compaction is not a new conversation.
    const hit = r.rows.find((s) => s.id > sinceStartId && s.source !== 'compact');
    return hit === undefined ? { kind: 'none' } : { kind: 'started', startId: hit.id, uuid: hit.uuid };
  }

  return { renew, deliver, contextUsage, receipt };
}
