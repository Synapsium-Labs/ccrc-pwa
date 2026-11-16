// Auto-advance plan W4a (D-8687, D-8692, D-8693): the `models` op's words, its builder, its reader and its bounds are
// declared once, in `shared/agent-protocol.ts`, and the lane regex is applied there alone among the TypeScript sources,
// so a second lane guard cannot grow beside `isModelsLaneId`.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ALL, rel } from './helpers.js';

const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(readFileSync(f, 'utf8'))).map(rel).sort();
const decl = (name: string): RegExp => new RegExp(`^\\s*export (?:const|function|type) ${name}\\b`, 'm');

describe('the models op is declared once (D-8692)', () => {
  it('CONTROL: the pattern sees a declaration and passes over a use', () => {
    expect(decl('MODELS_ACTIONS').test("export const MODELS_ACTIONS = ['show'] as const;")).toBe(true);
    expect(decl('MODELS_ACTIONS').test('for (const a of MODELS_ACTIONS) {}')).toBe(false);
  });

  it.each(['MODELS_ARGV_REFUSALS', 'MODELS_ACTIONS', 'isModelsLaneId', 'buildModelsArgv', 'readModelsOpAnswer',
    'MODELS_SPAWN_TIMEOUT_MS', 'MODELS_OP_REQUEST_TIMEOUT_MS'])('%s is declared only in shared/agent-protocol.ts', (name) => {
    expect(holders(decl(name))).toEqual(['shared/agent-protocol.ts']);
  });

  it('MODELS_LANE_ID_RE is applied only in shared/agent-protocol.ts among the TypeScript sources', () => {
    expect(holders(/MODELS_LANE_ID_RE\.test\(/)).toEqual(['shared/agent-protocol.ts']);
  });
});

describe('the lane advance states are declared once (D-8686, D-5228)', () => {
  it('LANE_ADVANCE_STATES is declared only in shared/models.ts (unexported there: D-TBD-models-ts-pins)', () => {
    expect(holders(new RegExp(String.raw`^\s*(?:export )?const LANE_ADVANCE_STATES\b`, 'm'))).toEqual(['shared/models.ts']);
    expect(holders(decl('LaneAdvanceState'))).toEqual(['shared/models.ts']);
  });
});
