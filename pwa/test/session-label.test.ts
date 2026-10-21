// `sessionLabel`'s ladder, rung by rung: `title ?? name ?? branch ?? workspace ?? id` (named workspaces S6, design
// §2.3). Each case fills ONE rung and everything below it, so removing a rung turns exactly its case red.
import { describe, expect, it } from 'vitest';
import { sessionLabel } from '../src/fleet/sessionLabel';
import { fleetSession } from './fleetFixture';

const ladder = { title: 'ENG-1234 - Fix the login flow', name: 'a model name', branch: 'ws/fix-login', workspace: 'quiet-basin' };

describe('sessionLabel', () => {
  it('prefers the operator title over every other rung', () => {
    expect(sessionLabel(fleetSession({ ...ladder }))).toBe('ENG-1234 - Fix the login flow');
  });

  it('falls to the live name when there is no title', () => {
    expect(sessionLabel(fleetSession({ ...ladder, title: null }))).toBe('a model name');
  });

  it('falls to the branch when there is no title or name', () => {
    expect(sessionLabel(fleetSession({ ...ladder, title: null, name: null }))).toBe('ws/fix-login');
  });

  it('falls to the workspace slug when there is no title, name or branch', () => {
    expect(sessionLabel(fleetSession({ ...ladder, title: null, name: null, branch: null }))).toBe('quiet-basin');
  });

  it('falls to the id for a legacy row with nothing else', () => {
    expect(sessionLabel(fleetSession({ id: 'demo-legacy', title: null, name: null, branch: null, workspace: null }))).toBe('demo-legacy');
  });

  it('reads an empty title as the rungs below it read an empty name: `??`, so the one place that drops "" is the registry', () => {
    // server/src/registry.ts maps an empty `.title` file to null before the wire; this function never sees ''.
    expect(sessionLabel(fleetSession({ ...ladder, title: '' }))).toBe('');
    expect(sessionLabel(fleetSession({ ...ladder, title: null, name: '' }))).toBe('');
  });
});
