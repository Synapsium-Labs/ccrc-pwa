// D-8289 (plan docs/superpowers/plans/2026-11-11-new-build-capture.md): Settings › Automation › Test box's list of Claude Code
// builds and their capture verdicts. A build is trusted only when the test box captured its hook and status-file output and
// the replay tests passed; children on any other build are refused approvals. The list reads `GET /api/testbox/builds` through
// the one wire reader (`readClaudeBuildRecords`) once a minute, and a failed build carries the replay output behind a
// disclosure and the operator's one act, **Capture again** (`POST /api/testbox/builds/capture`), whose answer is the re-read
// list.
//
// NOTHING SENT IS SAID AS SUCH. A build the queue tried while no test box answered, or while the box had no capture runner,
// says it was not sent (the row's `notSent`), never "sent N times"; and when the queued build tried last sent nothing
// (`captureBlockedBy`), the card says once, above the list, that no build can be captured yet and why, so the operator is not
// left waiting on it. A row whose reason is that one says only that it was not sent; a row not sent for another reason says
// its own.
//
// THE CARD IS A GLANCE. The list shows the builds that matter: every untrusted one (failed, waiting, not sent) and the newest
// trusted one. Older trusted builds fold behind one disclosure (`Show N older trusted builds`), closed on every mount and
// remembered nowhere.
//
// A FAILED WRITE has one reader, the card's (`testboxFailure`): the server's refusal in the refusal tone, and no answer at
// all (the fetch rejected) as `No answer from the server` in the answer tone.
//
// ONE LAYOUT AT EVERY WIDTH. Each build is one short row that wraps: the build and its verdict on one line, where it came
// from under it, and for a failure the output (pre-wrapped, so a long line never pushes the card sideways) and the button
// (full width on a phone, its own width otherwise, the card's `data-band`).
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button, elapsedWords, useNow } from '@ccrc/ui';
import { captureBlockedBy, readClaudeBuildRecords, type BuildCaptureNotSent, type ClaudeBuildRecord } from '../../../shared/claudeBuildTrust';
import { compareClaudeVersions } from '../../../shared/claudeVersion';
import { api } from '../lib/api';
import { usePoll } from '../lib/usePoll';
import { isRecord } from '../lib/wire';
import { ResultLine, SETTINGS_AMBER_NOTE, UNCONFIRMED_TEXT, useResultLine } from './settingsText';
import type { TestboxBand } from './TestBoxSection';
import { testboxFailure } from './testboxFailure';

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
  /** A not-sent row whose reason the card already says above the list. */
  notSentSaid: 'Waiting for its capture: not sent',
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
  older: (n: number) => `Show ${n} older trusted ${n === 1 ? 'build' : 'builds'}`,
  olderList: 'Older trusted builds',
} as const;

const T = TESTBOX_BUILDS_TEXT;

/** A row's verdict in words, and whether it is the amber one. `said` is the not-sent reason the card already says above the
 *  list (`captureBlockedBy`): a row with that reason does not say it again. */
export function buildVerdict(r: ClaudeBuildRecord, said: BuildCaptureNotSent | null = null): { readonly text: string; readonly amber: boolean } {
  if (r.capture === 'pass') return { text: r.cwd ? T.trusted : T.trustedNoCwd, amber: false };
  if (r.capture === 'fail') return { text: T.failed, amber: true };
  if (r.notSent !== null) return { text: r.notSent === said ? T.notSentSaid : T.notSent[r.notSent], amber: true };
  return { text: r.attempts === 0 ? T.queued : T.queuedSent(r.attempts), amber: false };
}

/** The builds the card shows at a glance (every untrusted one and the newest trusted one), and the older trusted ones it
 *  folds, each in the list's own order. */
export function foldBuilds(builds: readonly ClaudeBuildRecord[]): { readonly shown: ClaudeBuildRecord[]; readonly older: ClaudeBuildRecord[] } {
  const newestTrusted = builds.filter((r) => r.capture === 'pass')
    .reduce<ClaudeBuildRecord | null>((best, r) => (best === null || compareClaudeVersions(r.build, best.build) > 0 ? r : best), null);
  return {
    shown: builds.filter((r) => r.capture !== 'pass' || r === newestTrusted),
    older: builds.filter((r) => r.capture === 'pass' && r !== newestTrusted),
  };
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
  const fold = builds === null ? null : foldBuilds(builds);

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
          setFailed(false);
          line.say(T.queuedAgain);
        },
        (err: unknown) => { const f = testboxFailure(err); line.say(f.text, f.tone); reload(); },
      )
      .finally(() => { setSending(null); });
  };

  const row = (r: ClaudeBuildRecord): ReactNode => {
    const v = buildVerdict(r, blocked);
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
  };

  return (
    <div className="testbox-builds" data-testbox="builds">
      <p className="testbox-builds-title">{T.title}</p>
      <p className="settings-note">{T.note}</p>
      {failed && <p className={SETTINGS_AMBER_NOTE} data-testbox="builds-unread">{T.unread}</p>}
      {blocked !== null && <p className={SETTINGS_AMBER_NOTE} data-testbox="builds-blocked">{T.blocked[blocked]}</p>}
      {builds !== null && builds.length === 0 && <p className="settings-note">{T.empty}</p>}
      {fold !== null && fold.shown.length > 0 && (
        <ul className="testbox-build-list" aria-label={T.title}>{fold.shown.map(row)}</ul>
      )}
      {fold !== null && fold.older.length > 0 && (
        <details className="testbox-builds-older" data-testbox="builds-older">
          <summary className="settings-note">{T.older(fold.older.length)}</summary>
          <ul className="testbox-build-list" aria-label={T.olderList}>{fold.older.map(row)}</ul>
        </details>
      )}
      <ResultLine line={line.line} />
    </div>
  );
}
