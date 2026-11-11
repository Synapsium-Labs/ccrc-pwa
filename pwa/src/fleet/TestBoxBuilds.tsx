// D-8289 (plan docs/superpowers/plans/2026-11-11-new-build-capture.md): Settings › Automation › Test box's list of Claude Code
// builds and their capture verdicts. A build is trusted only when the test box captured its hook and status-file output and
// the replay tests passed; children on any other build are refused approvals. The list reads `GET /api/testbox/builds` through
// the one wire reader (`readClaudeBuildRecords`) once a minute, and a failed build carries the replay output behind a
// disclosure and the operator's one act, **Capture again** (`POST /api/testbox/builds/capture`), whose answer is the re-read
// list.
//
// NOTHING SENT IS SAID AS SUCH. A build the queue tried while no test box answered, or while the box had no capture runner,
// says it was not sent and why (the row's `notSent`), never "sent N times"; and when the queued build tried last sent
// nothing (`captureBlockedBy`), the card says no build can be captured yet, so the operator is not left waiting on it.
//
// ONE LAYOUT AT EVERY WIDTH. Each build is one short row that wraps: the build and its verdict on one line, where it came
// from under it, and for a failure the output (pre-wrapped, so a long line never pushes the card sideways) and the button
// (full width on a phone, its own width otherwise, the card's `data-band`).
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button, elapsedWords, useNow } from '@ccrc/ui';
import { captureBlockedBy, readClaudeBuildRecords, type BuildCaptureNotSent, type ClaudeBuildRecord } from '../../../shared/claudeBuildTrust';
import { ApiError, api, apiErrorText } from '../lib/api';
import { usePoll } from '../lib/usePoll';
import { isRecord } from '../lib/wire';
import { ResultLine, SETTINGS_AMBER_NOTE, UNCONFIRMED_TEXT, useResultLine } from './settingsText';
import type { TestboxBand } from './TestBoxSection';

/** How often the list is read again while the card is open: the queue's own pass is once a minute. */
export const TESTBOX_BUILDS_POLL_MS = 60_000;

export const TESTBOX_BUILDS_TEXT = {
  title: 'Claude Code builds',
  note: 'A build is trusted once the test box has captured its hooks and status files and the replay tests passed. '
    + 'Children on any other build are refused approvals. Each new build the fleet runs is queued for its capture.',
  trusted: 'Trusted',
  trustedNoCwd: 'Trusted, without the working directory check',
  queued: 'Waiting for its capture',
  queuedSent: (n: number) => `Waiting for its capture (sent ${n} ${n === 1 ? 'time' : 'times'})`,
  notSent: {
    'no-test-box': 'Waiting for its capture: not sent, no test box answers',
    'no-runner': 'Waiting for its capture: not sent, the test box has no capture runner',
  } satisfies Record<BuildCaptureNotSent, string>,
  blocked: {
    'no-test-box': 'No test box answers, so no build can be captured: the builds waiting here stay untrusted until one does.',
    'no-runner': 'The test box has no capture runner yet, so no build can be captured: the builds waiting here stay untrusted until it has one.',
  } satisfies Record<BuildCaptureNotSent, string>,
  failed: 'Capture failed, not trusted',
  rig: 'From the rig record',
  seen: (ago: string) => `First seen on the fleet ${ago} ago`,
  output: 'Replay output',
  noOutput: 'The test box sent no output.',
  again: 'Capture again',
  sending: 'Sending',
  queuedAgain: 'Queued again: the test box gets it on the next pass.',
  unread: 'The build list could not be read.',
  empty: 'No build is recorded yet.',
} as const;

const T = TESTBOX_BUILDS_TEXT;

/** A row's verdict in words, and whether it is the amber one. */
export function buildVerdict(r: ClaudeBuildRecord): { readonly text: string; readonly amber: boolean } {
  if (r.capture === 'pass') return { text: r.cwd ? T.trusted : T.trustedNoCwd, amber: false };
  if (r.capture === 'fail') return { text: T.failed, amber: true };
  if (r.notSent !== null) return { text: T.notSent[r.notSent], amber: true };
  return { text: r.attempts === 0 ? T.queued : T.queuedSent(r.attempts), amber: false };
}

/** A refusal's words: the server's detail, else the client's one reading of the error. */
function refusalWords(err: unknown): string {
  const body = err instanceof ApiError && isRecord(err.body) ? err.body : {};
  return typeof body.detail === 'string' && body.detail.trim() !== '' ? body.detail.trim() : apiErrorText(err);
}

export function TestBoxBuilds({ band }: { band: TestboxBand }): ReactNode {
  const now = useNow(30_000);
  const [builds, setBuilds] = useState<readonly ClaudeBuildRecord[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const line = useResultLine();
  const { reload, supersede } = usePoll({
    pollMs: TESTBOX_BUILDS_POLL_MS,
    request: (signal) => api.testboxBuilds({ signal }),
    onOutcome: (outcome) => {
      const read = outcome.ok && isRecord(outcome.raw) ? readClaudeBuildRecords(outcome.raw.claudeBuilds) : null;
      if (read === null) { setFailed(true); return; }
      setBuilds(read);
      setFailed(false);
    },
  });

  const blocked = builds === null ? null : captureBlockedBy(builds);

  const again = (build: string): void => {
    if (sending !== null) return;
    setSending(build);
    line.clear();
    void api.testboxBuildCapture(build)
      .then(
        (answer) => {
          const read = answer === 'unreadable' ? null : readClaudeBuildRecords(answer.claudeBuilds);
          if (read === null) { line.say(UNCONFIRMED_TEXT); reload(); return; }
          supersede();
          setBuilds(read);
          line.say(T.queuedAgain);
        },
        (err: unknown) => { line.say(refusalWords(err), 'refusal'); reload(); },
      )
      .finally(() => { setSending(null); });
  };

  return (
    <div className="testbox-builds" data-testbox="builds">
      <p className="testbox-builds-title">{T.title}</p>
      <p className="settings-note">{T.note}</p>
      {failed && <p className={SETTINGS_AMBER_NOTE} data-testbox="builds-unread">{T.unread}</p>}
      {blocked !== null && <p className={SETTINGS_AMBER_NOTE} data-testbox="builds-blocked">{T.blocked[blocked]}</p>}
      {builds !== null && builds.length === 0 && <p className="settings-note">{T.empty}</p>}
      {builds !== null && builds.length > 0 && (
        <ul className="testbox-build-list" aria-label={T.title}>
          {builds.map((r) => {
            const v = buildVerdict(r);
            return (
              <li key={r.build} className="testbox-build" data-build={r.build} data-capture={r.capture}>
                <p className="testbox-build-head">
                  <span className="testbox-build-name">{r.build}</span>
                  {' '}
                  <span className={v.amber ? 'testbox-build-verdict settings-catalogue--amber' : 'testbox-build-verdict'}>{v.text}</span>
                </p>
                <p className="settings-note">{r.source === 'rig' ? T.rig : T.seen(elapsedWords(Math.max(0, now - r.seenAt)))}</p>
                {r.capture === 'fail' && (
                  <>
                    <details className="testbox-build-output">
                      <summary className="settings-note">{T.output}</summary>
                      <pre className="testbox-build-log">{r.output === null || r.output === '' ? T.noOutput : r.output}</pre>
                    </details>
                    <Button variant="ghost" size={band === 'phone' ? 'full' : 'fit'} className="testbox-build-again" disabled={sending !== null}
                      onClick={() => again(r.build)} data-testbox="capture-again">
                      {sending === r.build ? T.sending : T.again}
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <ResultLine line={line.line} />
    </div>
  );
}
