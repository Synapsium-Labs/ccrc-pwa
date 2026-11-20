// Programme work map WM5 (D-8844, review 2975 F1, F2, F6): every coordinator will copy the examples of
// `references/plan.md`'s "Keep the plan" section, so each one, in the order the section gives them, is sent to the real
// plan routes over a real coord.db (the deciders `parsePlanPut`, `diffPlan`, `diffPhases`, `phaseRefVerdict` and
// `ticketDoneVerdict` behind them) and must be accepted as written. The section says its examples run in order on the plan
// the `plan put` example at the top of the file leaves; this file starts from that example, so a refused example, an
// example that names what no earlier one declared, or one deleted or reordered, is red.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { charWorld, openRun, planVerb, CHAR_TOKEN, type CharWorld } from './helpers/planPhasesFixture.js';
import type { PlanView } from '../../shared/plan.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const planMd = readFileSync(path.join(root, 'ccd/coordinator-skill/references/plan.md'), 'utf8');

/** The text of one `## ` section, to the next `## ` heading (or the end of the file). */
const sectionOf = (text: string, heading: string): string => {
  const at = text.indexOf(`\n${heading}\n`);
  expect(at, `no section ${heading}`).toBeGreaterThanOrEqual(0);
  const next = text.indexOf('\n## ', at + 1);
  return text.slice(at, next === -1 ? undefined : next);
};

/** Every executable example of a section, in order: the verb and its body (multi-line JSON allowed, fence indentation too). */
const examplesOf = (section: string): { verb: string; body: Record<string, unknown> }[] =>
  [...section.matchAll(/"\$API" plan ([a-z-]+) <slug> --json - <<JSON\n([\s\S]*?)\n\s*JSON/g)].map((m) => ({
    verb: m[1]!,
    body: JSON.parse(m[2]!.replace(/<home project>/g, 'project-a')) as Record<string, unknown>,
  }));

/** The route each verb of the section is served at, under `/api/programmes/:slug/plan`. */
const SUB: Readonly<Record<string, string>> = { put: '', 'ticket-add': '/tickets', 'phase-ref': '/phases/refs', 'ticket-done': '/tickets/done' };

let w: CharWorld | undefined;
afterEach(async () => { if (w) await w.app.close(); w = undefined; });

describe('the "Keep the plan" examples run in order against the real plan routes (review 2975 F1, F2, F6)', () => {
  const section = sectionOf(planMd, '## Keep the plan: the programme page shows what remains');
  const examples = examplesOf(section);
  const start = examplesOf(sectionOf(planMd, '## plan put'))[0]!;

  it('the section gives its examples in the order put, ticket-add, carry, add, remove, ticket-done', () => {
    expect(examples.map((e) => e.verb === 'phase-ref' ? `${e.verb}:${String(e.body.op)}` : e.verb))
      .toEqual(['put', 'ticket-add', 'phase-ref:carry', 'phase-ref:add', 'phase-ref:remove', 'ticket-done']);
    expect(start.verb).toBe('put');
  });

  it('each one is accepted, on the plan the one before it left', async () => {
    w = await charWorld();
    const first = await planVerb(w, 'prog-a', '', start.body);
    expect(first.statusCode, first.body).toBe(200);
    // a past run that finished the work: a done work run of the programme with no ticket named, so its ticket is the auto one;
    // `ticket-done`'s example names run 1234, which here is this run (the section says the number is the coordinator's own)
    const run = await openRun(w, { title: 'a wave', project: 'project-a', waveOf: 6, homeProject: 'project-a', program: 'prog-a', wave: 1 });
    expect(run.statusCode, run.body).toBe(200);
    const runId = (run.json() as { id: number }).id;
    for (const to of ['dispatched', 'closing', 'done'] as const) expect(w.coord.advance(runId, to, 'test').ok, to).toBe(true);
    for (const [i, e] of examples.entries()) {
      const body = e.verb === 'ticket-done' ? { ...e.body, evidence: { runId } } : e.body;
      const res = await planVerb(w, 'prog-a', SUB[e.verb]!, body);
      expect(res.statusCode, `example ${i + 1} (${e.verb} ${JSON.stringify(e.body)}): ${res.body}`).toBe(200);
    }
    const read = await w.app.inject({ method: 'GET', url: '/api/programmes/prog-a/plan', headers: { 'x-ccrc-mail-token': CHAR_TOKEN } });
    const tickets = (read.json() as { plan: PlanView }).plan.epics.flatMap((e) => e.tickets);
    expect(tickets.find((t) => t.key === 'w1-1')?.state, 'the ticket-done example closes w1-1').toBe('done');
    expect(tickets.map((t) => t.key)).toEqual(expect.arrayContaining(['w1-1', 'w1-2', 'w1-3', 'w2-1']));
  });
});
