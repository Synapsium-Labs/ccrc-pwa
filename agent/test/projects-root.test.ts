// Stage 1 (OSS infra spec §2): the agent's whitelist root was one operator's
// Hetzner volume id, compiled in, no override — the literal that made every
// other install's file reads fail silently. The resolution order is: explicit
// opt (tests, embedders) > CCRC_PROJECTS_ROOT (production, via agent.env) >
// $HOME/projects (the spec's cross-component default).
import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { resolveProjectsRoot } from '../src/server.js';

describe('resolveProjectsRoot', () => {
  it('prefers an explicit option over everything', () => {
    expect(resolveProjectsRoot('/opt/repos', { CCRC_PROJECTS_ROOT: '/env/root' }))
      .toBe('/opt/repos');
  });

  it('falls back to CCRC_PROJECTS_ROOT from the environment', () => {
    expect(resolveProjectsRoot(undefined, { CCRC_PROJECTS_ROOT: '/env/root' }))
      .toBe('/env/root');
  });

  it('defaults to $HOME/projects — never a hardcoded volume path', () => {
    expect(resolveProjectsRoot(undefined, {}))
      .toBe(path.join(os.homedir(), 'projects'));
  });

  it('an empty env var is absent, not a root of ""', () => {
    expect(resolveProjectsRoot(undefined, { CCRC_PROJECTS_ROOT: '' }))
      .toBe(path.join(os.homedir(), 'projects'));
  });
});
