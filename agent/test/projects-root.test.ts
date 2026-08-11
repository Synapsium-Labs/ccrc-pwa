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

// Review finding (Important, task-4 fix loop): before this task, production's
// projectsRoot was a hardcoded literal that could never coincide with $HOME —
// structurally impossible. This task made it operator-configurable, and
// whitelist.ts's checkPath grants READS under it with a plain prefix check.
// Setting CCRC_PROJECTS_ROOT to $HOME itself (or any ancestor of it, e.g. '/'
// or '/home') — an easy mistake — folds ~/.ssh, ~/.ccrc/agent.env (which
// holds CCRC_AGENT_TOKEN) and every dotfile into the read whitelist. The
// agent's existing posture for invalid security config is refuse to boot
// (whitelist.ts's auditExecWhitelist), so resolveProjectsRoot throws instead
// of warning and continuing. Roots UNDER $HOME — including the $HOME/projects
// default — are unaffected.
describe('resolveProjectsRoot — refuses a dangerous root', () => {
  const home = os.homedir();

  it('throws when an explicit option equals $HOME', () => {
    expect(() => resolveProjectsRoot(home, {})).toThrow(/refus/i);
  });

  it('throws when CCRC_PROJECTS_ROOT equals $HOME', () => {
    expect(() => resolveProjectsRoot(undefined, { CCRC_PROJECTS_ROOT: home })).toThrow(/refus/i);
  });

  it('throws when the root is the filesystem root (an ancestor of everything)', () => {
    expect(() => resolveProjectsRoot('/', {})).toThrow(/refus/i);
  });

  it('throws when the root is an ancestor directory of $HOME', () => {
    const ancestor = path.dirname(home);
    expect(() => resolveProjectsRoot(ancestor, {})).toThrow(/refus/i);
  });

  it('throws when the root is not an absolute path', () => {
    expect(() => resolveProjectsRoot('relative/projects', {})).toThrow(/absolute/i);
  });

  it('stays fine for $HOME/projects — the default itself', () => {
    const root = path.join(home, 'projects');
    expect(resolveProjectsRoot(root, {})).toBe(root);
  });

  it('stays fine for a directory nested deeper under $HOME', () => {
    const deep = path.join(home, 'projects', 'some-repo', 'nested');
    expect(resolveProjectsRoot(deep, {})).toBe(deep);
  });
});
