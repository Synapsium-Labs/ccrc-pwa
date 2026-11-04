// The reader lab page's words (native Docs reader, the reader lab plan of 2026-11-03, Task 9). Ring L1: strings. The
// verdict words are the result block's own (`result.ts`), so the page and the block never say two things.
import type { LabCheckId } from './checks';
import { LAB_VERDICT_WORDS } from './result';

export const LAB_TEXT = {
  title: 'Reader lab',
  intro: "Checks the Docs reader's safety walls and responsiveness on this device, once. Keep the screen on and the app in "
    + 'front until it says Done, and tap the button in the box when it asks. Then select the result and copy it, or take a '
    + 'screenshot, and send it on. It saves and sends nothing itself.',
  journal: "On a server with sign-in on, each run leaves one or two lines in the server's journal saying it refused a "
    + 'websocket upgrade from a foreign origin. They are this lab\'s own frames, and expected.',
  start: 'Start',
  stop: 'Stop',
  starting: 'Starting…',
  stopping: 'Stopping…',
  done: 'Done.',
  result: 'Result',
  select: 'Select result',
  stage: "The lab's frames run here",
  wallsGroup: 'Walls (E18)',
  responsiveGroup: 'Stays responsive (E17)',
  notRun: 'not run',
  waiting: 'waiting',
  running: 'running…',
  tapLabel: 'Tap here',
  steps: {
    popup: 'Tap the button in the box below.',
    ambient: 'Checking the opaque origin and stored state…',
    cookie: 'Checking that frame requests carry no cookie…',
    battery: 'Running the 27-channel battery…',
    selfNav: 'Checking that a frame cannot navigate itself…',
    busy: 'Running a busy frame…',
    mermaid: 'Drawing Mermaid:',
    strays: 'Sending stray messages to the reader…',
    done: 'Reading the counts…',
  },
  verdict: LAB_VERDICT_WORDS,
  checks: {
    'opaque-origin': 'Opaque origin',
    'no-ambient-state': 'No ambient state',
    'no-cookie': 'No cookie on frame requests',
    'csp-27': 'Frame CSP, 27 channels',
    'no-popup-top-nav': 'No popup, no top navigation',
    'no-self-navigate': 'Frame cannot navigate itself',
    'bridge-strays': 'Bridge ignores stray messages',
    'self-nav-teardown': 'Teardown signal on a blocked navigation',
    'busy-frame': 'Busy frame',
    mermaid: 'Heavy Mermaid page',
  } satisfies Record<LabCheckId, string>,
  failed: {
    'no-door': 'This server has no reader lab door yet. Update it, then try again.',
    refused: 'The server refused to open a lab run. Sign in again, then try again.',
    'unknown-run': 'The lab run was lost before its counts were read: it expired, another replaced it, or the server '
      + 'restarted. Start again.',
    unreadable: "This server's lab door is older than this page. Update the server, then try again.",
    other: 'The lab stopped: ',
  },
} as const;
