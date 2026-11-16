// Overlord W1a, the renewal hand-offs, Task 2 (plan `w1a-renewal-handoffs.md`; spec §3.3.11 "Before the message record
// exists"): the console's prompt route answers `409 renewing` for a session whose live generation's `state` is `clearing` or
// `carded`, before anything is typed, so the console keeps the draft. It reads `state`, never `shadowState`: `state` moves
// only while `continuity` is live, so a shadow walk never holds a prompt (ruling R1). A real coord.db and a scripted pane;
// fixture HOMEs only.
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { promptRenewing } from '../src/continuity/renewNow.js';
import { GENERATION_STATES } from '../../shared/continuity.js';
import { PROMPT_ID, generationIn, promptRig } from './continuityPromptRig.js';

const typed = (calls: readonly string[][]): boolean => calls.some((c) => c[1] === 'send-keys');
const prompt = (app: FastifyInstance) => app.inject({ method: 'POST', url: `/api/sessions/${PROMPT_ID}/prompt`, payload: { text: 'hello' } });

describe('promptRenewing (L1)', () => {
  it('answers renewing for clearing and carded only, and for no generation types as today', () => {
    expect(GENERATION_STATES.filter((s) => promptRenewing(s)).sort()).toEqual(['carded', 'clearing']);
    expect(promptRenewing(null)).toBe(false);
  });

  it('checkpointed is deliberately not held (review 2312 F4): the old conversation is live and asked for its handover note', () => {
    expect(promptRenewing('checkpointed')).toBe(false);
  });
});

describe('POST /api/sessions/:id/prompt between conversations (Task 2)', () => {
  for (const state of ['clearing', 'carded'] as const) {
    it(`a live generation in ${state} answers 409 renewing and types nothing`, async () => {
      const { app, coord, calls } = await promptRig();
      generationIn(coord, state);
      const res = await prompt(app);
      expect([res.statusCode, res.json()]).toEqual([409, { ok: false, error: 'renewing' }]);
      expect(typed(calls)).toBe(false);
    });
  }

  for (const state of ['active', 'draining', 'probing'] as const) {
    it(`a live generation in ${state} types as today`, async () => {
      const { app, coord, calls } = await promptRig();
      generationIn(coord, state);
      const res = await prompt(app);
      expect([res.statusCode, res.json()]).toEqual([200, { ok: true }]);
      expect(typed(calls)).toBe(true);
    });
  }

  it('no generation types as today', async () => {
    const { app, calls } = await promptRig();
    const res = await prompt(app);
    expect(res.statusCode).toBe(200);
    expect(typed(calls)).toBe(true);
  });

  for (const shadow of ['carded', 'clearing'] as const) {
    it(`with continuity shadow, a generation whose shadowState is ${shadow} (and state active) types as today`, async () => {
      const { app, coord, calls } = await promptRig();
      generationIn(coord, 'active', shadow);
      const res = await prompt(app);
      expect([res.statusCode, res.json()]).toEqual([200, { ok: true }]);
      expect(typed(calls)).toBe(true);
    });
  }
});
