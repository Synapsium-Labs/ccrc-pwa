// Build capture runner spec docs/superpowers/specs/2026-11-22-build-capture-runner-design.md §2.5, Table 6. L3: the
// production adapter of the capture lane's port (`buildCaptureLane.ts#BuildCaptureTransport`). It sends one job through
// `FleetIO.testboxCapture` and maps what the op came to onto the port's words. It decides nothing about the verdict: an
// answered result is handed on unread, and the lane reads it through `readBuildCaptureResult`. A lane source of its own.
//
// THE MAPPING, every row (a job NEVER SENT counts no attempt, so it answers `no-test-box` or `no-runner`; a job that WENT
// OUT and brought back no verdict answers `unanswered`, which counts one):
//   - the seam says `no-op` (an agent that does not list the op, never sent it) ........... unavailable `no-runner`
//   - the seam says `not-started` (the link was down, the frame never left) .............. unavailable `no-test-box`, plus
//     one `console.warn` naming the seam's word: no box can be reached through a link that is down
//   - the seam says `busy` (the agent's one capture gate is held by another capture, as after
//     a server restart mid-capture) ........................................................ unavailable `no-runner`, plus
//     one `console.warn` naming the seam's word: the box's runner is taken. Both are folds of the same recorded departure
//     as the refusals below (the not-sent words widen in PR 2); neither counts an attempt (fix round 1, F3)
//   - the seam says `unanswered` (a fault, a deadline, a reply off the op's reader) ....... unavailable `unanswered`
//   - outcome `unconfigured`, `unreachable`, `bad-answer` (nothing was sent: no box, no
//     hello, a status answer off its shape) ................................................ unavailable `no-test-box`
//   - outcome `not-taken` (the box closed the connection on the frame: a box that predates
//     the job kind, so it has no runner) ................................................... unavailable `no-runner`
//   - outcome `refused` with `not-test-box` ................................................ unavailable `no-test-box`
//   - outcome `refused` with `no-runner` ................................................... unavailable `no-runner`
//   - outcome `refused` with `build-absent` or `path-refused` ............................. unavailable `no-runner`, plus
//     one `console.warn` naming the real refusal. A RECORDED DEPARTURE: the record's not-sent words
//     (`BuildCaptureNotSent`: `no-test-box`, `no-runner`) cannot yet carry these two, and a build the box does not hold or a
//     path the guard refuses is a box-side condition nothing server-side can mend. They fold into `no-runner` (nothing was
//     sent, so no attempt counts and the row stays queued) until PR 2 widens the words (the spec's §5, Table 7).
//   - outcome `refused` with `capture-id-used` ............................................. unavailable `unanswered`: the id
//     is already queued, running or ended, so a job DID go out
//   - outcome `answered` with a result ..................................................... answered, the result unread
//   - outcome `answered` with no result (the box ended with no verdict) .................... unavailable `unanswered`
//   - outcome `unanswered` ................................................................. unavailable `unanswered`
//   - a thrown io call (the member never rejects, and the lane catches too) ............... unavailable `unanswered`
//   - a `refused` reply with no refusal word (the op's reader forbids it) ................. unavailable `unanswered`
import type { FleetIO } from './io.js';
import type { BuildCaptureAnswer, BuildCaptureTransport } from './buildCaptureLane.js';
import type { TestboxCaptureReply } from '../../shared/agent-protocol.js';

const gone = (why: 'no-test-box' | 'no-runner' | 'unanswered'): BuildCaptureAnswer => ({ kind: 'unavailable', why });

function answerOf(build: string, r: TestboxCaptureReply): BuildCaptureAnswer {
  switch (r.outcome) {
    case 'unconfigured': case 'unreachable': case 'bad-answer': return gone('no-test-box');
    case 'not-taken': return gone('no-runner');
    case 'refused':
      switch (r.refusal) {
        case 'not-test-box': return gone('no-test-box');
        case 'no-runner': return gone('no-runner');
        case 'build-absent': case 'path-refused':
          console.warn(`ccrc-server: build capture: the test box refused ${build} (${r.refusal}${r.detail === null ? '' : `: ${r.detail}`}) — nothing was sent`);
          return gone('no-runner');
        case 'capture-id-used': default: return gone('unanswered');
      }
    case 'answered': return r.result === null ? gone('unanswered') : { kind: 'answered', result: r.result };
    case 'unanswered': return gone('unanswered');
  }
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
            case 'not-started': case 'busy':
              console.warn(`ccrc-server: build capture: ${job.build} was not sent (${asked.reason === 'busy' ? 'busy: the agent is waiting on another capture' : 'not-started: the agent link is down'})`);
              return gone(asked.reason === 'busy' ? 'no-runner' : 'no-test-box');
            case 'unanswered': return gone('unanswered');
          }
        }
        return answerOf(job.build, asked.reply);
      } catch {
        return gone('unanswered');
      }
    },
  };
}
