import { describe, it, expect } from 'vitest';
import { slashQuery, filterCommands } from '../src/session/slashComplete';
import type { SlashCommand } from '../../shared/api';

const ALL: SlashCommand[] = [
  { name: 'compact', desc: 'summarize', kind: 'builtin' },
  { name: 'effort', desc: 'reasoning effort', kind: 'builtin' },
  { name: 'model', desc: 'switch model', kind: 'builtin' },
  { name: 'clear', desc: 'fresh convo', kind: 'builtin' },
  { name: 'superpowers:brainstorming', desc: 'brainstorm', kind: 'skill' },
  { name: 'superpowers:writing-plans', desc: 'plans', kind: 'skill' },
  { name: 'graphify', desc: 'graph', kind: 'skill' },
];

describe('slashQuery', () => {
  it('is active only for `/` + a whitespace-free run', () => {
    expect(slashQuery('/comp')).toBe('comp');
    expect(slashQuery('/')).toBe('');
    expect(slashQuery('/superpowers:brain')).toBe('superpowers:brain');
    expect(slashQuery('/model gpt')).toBeNull(); // command chosen, typing args
    expect(slashQuery('hello')).toBeNull();
    expect(slashQuery('')).toBeNull();
  });
});

describe('filterCommands', () => {
  it('empty query leads with the built-ins (compact/effort/model first)', () => {
    expect(filterCommands(ALL, '').slice(0, 3).map((c) => c.name)).toEqual(['compact', 'effort', 'model']);
  });
  it('prefix match wins; single hit for a distinctive prefix', () => {
    expect(filterCommands(ALL, 'eff').map((c) => c.name)).toEqual(['effort']);
  });
  it('surfaces skills by name, including the plugin:skill form', () => {
    expect(filterCommands(ALL, 'superpowers').map((c) => c.name)).toEqual([
      'superpowers:brainstorming',
      'superpowers:writing-plans',
    ]);
  });
  it('mid-string matches rank below prefix matches', () => {
    // "brain" matches only inside superpowers:brainstorming (mid-string).
    expect(filterCommands(ALL, 'brain').map((c) => c.name)).toEqual(['superpowers:brainstorming']);
  });
});
