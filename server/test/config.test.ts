import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';
import { mungePath } from '../src/munge.js';

describe('loadConfig', () => {
  it('derives all paths from CCRC_HOME', () => {
    const cfg = loadConfig({ CCRC_HOME: '/fake/home' });
    expect(cfg.registryDir).toBe('/fake/home/.cc-sessions');
    expect(cfg.limitsDir).toBe('/fake/home/.cc-limits');
    expect(cfg.ccdBin).toBe('/fake/home/.local/bin/ccd');
    expect(cfg.wrappers['claude2']).toBe('/fake/home/.claude-personal');
    expect(cfg.wrappers['gpt']).toBe('/fake/home/.claude-gpt');
    expect(cfg.host).toBe('127.0.0.1');
    expect(cfg.port).toBe(7788);
  });
  it('honours env overrides', () => {
    const cfg = loadConfig({ CCRC_HOME: '/h', CCRC_HOST: '203.0.113.7', CCRC_PORT: '9000', CCRC_PROJECTS_ROOT: '/data/projects' });
    expect(cfg.host).toBe('203.0.113.7');
    expect(cfg.port).toBe(9000);
    expect(cfg.projectsRoot).toBe('/data/projects');
  });
});

describe('mungePath', () => {
  it('replaces / . _ with - (ccd cmd_swap rule)', () => {
    expect(mungePath('/data/projects/orchard-api')).toBe('-data-projects-orchard-api');
    expect(mungePath('/data/projects/foo/.claude/worktrees/ui')).toBe('-data-projects-foo--claude-worktrees-ui');
    expect(mungePath('/a/b_c.d')).toBe('-a-b-c-d');
  });
});
