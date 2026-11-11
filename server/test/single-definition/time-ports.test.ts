import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parsedFile } from '../scan/symbols.js';
import { codeOnly, serverRing } from '../rings/ring.js';
import { REPO, walkSrc } from '../rings/walkSrc.js';

describe('the time ports (Overlord spec §11.5, §3.6 H2): one definition, in the clock kernel', () => {
  it('ports.ts is types only, so L2 by its facts, not by its header', () => {
    expect(serverRing('server/src/time/ports.ts')).toEqual({ ring: 'L2', why: 'every top-level statement is a type' });
  });

  it('the two-clock shape is declared once: the lane runner takes Clock and declares no clock of its own', () => {
    const shape = /\binterface\s+\w+\s*\{[^}]*\bwall\(\)\s*:\s*number[^}]*\bmono\(\)\s*:\s*number/;
    const holders = walkSrc({ roots: ['server/src'], min: 150 })
      .filter((f) => shape.test(codeOnly(readFileSync(path.join(REPO, f), 'utf8'))));
    expect(holders).toEqual(['server/src/time/ports.ts']);
    const edge = parsedFile('server/src/laneRunner.ts').imports.find((e) => e.specifier === './time/ports.js');
    expect(edge?.names).toContain('Clock');
  });

  it('the Node timer ceiling is spelled once, in time/rules.ts', () => {
    const spelled = /\b2_?147_?483_?647\b/;
    const holders = walkSrc({ roots: ['server/src', 'shared'], min: 300 })
      .filter((f) => spelled.test(codeOnly(readFileSync(path.join(REPO, f), 'utf8'))));
    expect(holders).toEqual(['server/src/time/rules.ts']);
  });
});
