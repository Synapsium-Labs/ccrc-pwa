// Build capture runner spec docs/superpowers/specs/2026-11-22-build-capture-runner-design.md §2.5, Table 6. L3: the
// production adapter of the capture lane's port (`buildCaptureLane.ts#BuildCaptureTransport`). It sends one job through
// `FleetIO.testboxCapture` and maps what the op came to onto the port's words. It decides nothing about the verdict: an
// answered result is handed on unread, and the lane reads it through `readBuildCaptureResult`. A lane source of its own.
//
// THE MAPPING, every row (a job NEVER SENT counts no attempt, so it answers a not-sent word, `BuildCaptureNotSent`; a job that
// WENT OUT and brought back no verdict answers `unanswered`, which counts one). PR 2 widened the not-sent words, so each
// answer below that sent nothing is its own word, where PR 1 folded four of them into `no-test-box` or `no-runner`:
//   - the seam says `no-op` (an agent that does not list the op, never sent it) ........... unavailable `no-runner`
//   - the seam says `not-started` (the link was down, the frame never left) .............. unavailable `not-started`
//   - the seam says `busy` (the agent's one capture gate is held by another capture, as after
//     a server restart mid-capture) ........................................................ unavailable `busy`
//   - the seam says `unanswered` (a fault, a deadline, a reply off the op's reader) ....... unavailable `unanswered`
//   - outcome `unconfigured`, `unreachable`, `bad-answer` (nothing was sent: no box, no
//     hello, a status answer off its shape) ................................................ unavailable `no-test-box`
//   - outcome `not-taken` (the box closed the connection on the frame: a box that predates
//     the job kind, so it has no runner) ................................................... unavailable `no-runner`
//   - outcome `refused` with `not-test-box` ................................................ unavailable `no-test-box`
//   - outcome `refused` with `no-runner` ................................................... unavailable `no-runner`
//   - outcome `refused` with `build-absent` ................................................ unavailable `build-absent`: the
//     lane's decider then copies the build to the box and sends the job again (spec §2.2, `captureNextAct`)
//   - outcome `refused` with `path-refused` ................................................ unavailable `path-refused`
//   - outcome `refused` with `capture-id-used` ............................................. unavailable `unanswered`: the id
//     is already queued, running or ended, so a job DID go out
//   - outcome `answered` with a result ..................................................... answered, the result unread
//   - outcome `answered` with no result (the box ended with no verdict) .................... unavailable `unanswered`
//   - outcome `unanswered` ................................................................. unavailable `unanswered`
//   - a thrown io call (the member never rejects, and the lane catches too) ............... unavailable `unanswered`
//   - a `refused` reply with no refusal word (the op's reader forbids it) ................. unavailable `unanswered`
//
// THE DROPPED DETAIL (review 3226 F9, capture runner PR 3b): the port carries a word, never the op's `detail`. A refusal's
// detail is its word's own sentence, so nothing is lost there; every other reply that brings back no verdict (the box
// ended with none, the job went unanswered, no box or no hello) is the one place its `detail` says why, so it is written to
// the server's log, one line naming the build and the outcome, before the word is answered.
import type { FleetIO } from './io.js';
import type { BuildCaptureAnswer, BuildCaptureTransport, BuildCaptureUnavailable } from './buildCaptureLane.js';
import type { TestboxCaptureReply } from '../../shared/agent-protocol.js';

const gone = (why: BuildCaptureUnavailable): BuildCaptureAnswer => ({ kind: 'unavailable', why });

function answerOf(r: TestboxCaptureReply): BuildCaptureAnswer {
  switch (r.outcome) {
    case 'unconfigured': case 'unreachable': case 'bad-answer': return gone('no-test-box');
    case 'not-taken': return gone('no-runner');
    case 'refused':
      switch (r.refusal) {
        case 'not-test-box': return gone('no-test-box');
        case 'no-runner': return gone('no-runner');
        case 'build-absent': case 'path-refused': return gone(r.refusal);
        case 'capture-id-used': default: return gone('unanswered');
      }
    case 'answered': return r.result === null ? gone('unanswered') : { kind: 'answered', result: r.result };
    case 'unanswered': return gone('unanswered');
  }
}

/** The log line of a reply whose `detail` the port's word drops (a refusal's detail is its word's sentence, and a verdict is
 *  kept, so neither is logged). */
function logDropped(build: string, r: TestboxCaptureReply): void {
  if (r.detail === null || r.outcome === 'refused' || (r.outcome === 'answered' && r.result !== null)) return;
  console.warn(`ccrc-server: build capture ${build}: ${r.outcome}, no verdict: ${r.detail}`);
}

/** The production adapter: `io` is read at each call, so a rebuilt connection is the one used. */
export function testboxCaptureTransport(io: () => Pick<FleetIO, 'testboxCapture'>): BuildCaptureTransport {
  return {
    capture: async (job) => {
      try {
        const asked = await io().testboxCapture(job.build);
        if (!asked.ok) {
          switch (asked.reason) {
            case 'no-op': return gone('no-runner');
            case 'not-started': case 'busy': return gone(asked.reason);
            case 'unanswered': return gone('unanswered');
          }
        }
        logDropped(job.build, asked.reply);
        return answerOf(asked.reply);
      } catch {
        return gone('unanswered');
      }
    },
  };
}
