// `sessionLabel` is what every surface calls a session, so its ladder is the
// one place a naming decision becomes visible. Five rungs, each asserted on
// its own — a test that only exercised the happy rung would stay green through
// a reordering, which is the mistake with the highest blast radius here.
import { describe, it, expect } from 'vitest';
import type { FleetSession } from '../../shared/api';
import { sessionLabel } from '../src/fleet/sessionLabel';

const base = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'demo-eng-1234', wrapper: 'claude', home: 'claude', project: 'demo',
  workdir: '/w/demo/eng-1234', workspace: 'eng-1234', name: null, title: null,
  status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false,
  version: null, model: null, effort: null, ultracode: false, branch: 'ws/eng-1234',
  tasks: null, pr: null, archivedAt: null, archivedBytes: null, held: null,
  hookState: null, askSummary: null, subagents: null, unmeasured: [],
  statusUnmeasured: false, lifecycle: null, lifecycleUnmeasured: [], clips: null,
  substrate: null, stopSurface: null, started: true, bucket: 'idle',
  spawnState: null, ...over,
} as FleetSession);

describe('sessionLabel', () => {
  it('the operator’s title outranks everything', () => {
    // THE POINT OF B6. `title` is the only rung a human typed on purpose, and
    // the slug cannot hold it: `_ws_slug_valid` is lowercase, dashes and 31
    // characters, so `ENG-1234 - Fix the login flow` lives beside the slug.
    expect(sessionLabel(base({ title: 'ENG-1234 - Fix the login flow' })))
      .toBe('ENG-1234 - Fix the login flow');
  });

  it('the operator’s title outranks Claude Code’s own name', () => {
    // Two different authors. `name` is a title the model derived from the
    // conversation; `title` is what the operator typed at ws-add. Collapsing
    // them would make "did a human name this?" unanswerable. RED if the two
    // rungs are swapped.
    expect(sessionLabel(base({ title: 'ENG-1234 - Fix login', name: 'Fixing the login bug' })))
      .toBe('ENG-1234 - Fix login');
  });

  it('falls through to the model’s name when nobody named it', () => {
    expect(sessionLabel(base({ name: 'Fixing the login bug' }))).toBe('Fixing the login bug');
  });

  it('then the branch, then the slug, then the id', () => {
    expect(sessionLabel(base())).toBe('ws/eng-1234');
    expect(sessionLabel(base({ branch: null }))).toBe('eng-1234');
    expect(sessionLabel(base({ branch: null, workspace: null }))).toBe('demo-eng-1234');
  });
});
