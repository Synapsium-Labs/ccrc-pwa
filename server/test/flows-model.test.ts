// Flows design §4 and §7: the shape check every read runs, and the publish rules. Each rule has a case that
// goes red when its check is deleted (mutation-table discipline).
import { describe, expect, it } from 'vitest';
import {
  FLOW_LIMITS, FLOW_SCHEMA, PROTOCOL, PROTOCOL_STEPS, briefBlockFor, flowExportJson, flowPhases, parseFlowDoc, readFlowFile, renderFlowPrompt, skeletonFlowDoc,
  validateFlow,
  type FlowBlock, type FlowDoc,
} from '../../shared/flows.js';
import { FLOW_TEMPLATES, findTemplate } from '../src/flows/templates.js';

const clone = (d: FlowDoc): FlowDoc => structuredClone(d);
const ccrc = (): FlowDoc => clone(findTemplate('ccrc')!.doc);
const rules = (d: FlowDoc): number[] => validateFlow(d).map((p) => p.rule);
const block = (d: FlowDoc, id: string): FlowBlock => d.blocks.find((b) => b.id === id)!;

describe('the shipped flows are publishable', () => {
  it('the skeleton has no problem', () => expect(validateFlow(skeletonFlowDoc('x'))).toEqual([]));
  it.each(FLOW_TEMPLATES.map((t) => [`${t.id}@${t.version}`, t.doc] as const))('%s has no problem', (_n, doc) => {
    expect(validateFlow(doc)).toEqual([]);
  });
  it('every protocol step appears once in the skeleton, with exactly its outcomes', () => {
    const doc = skeletonFlowDoc('x');
    for (const step of PROTOCOL_STEPS) {
      const b = doc.blocks.filter((x) => x.step === step);
      expect(b).toHaveLength(1);
      expect(b[0].outcomes).toEqual(PROTOCOL[step].outcomes);
    }
  });
});

describe('parseFlowDoc checks shape, never policy', () => {
  it('round-trips a doc through JSON', () => {
    const doc = ccrc();
    expect(parseFlowDoc(JSON.parse(JSON.stringify(doc)))).toEqual({ ok: true, doc });
  });
  it('reads a doc that breaks every rule but has the right shape', () => {
    const doc = ccrc();
    doc.edges = [];
    expect(validateFlow(doc).length).toBeGreaterThan(0);
    expect(parseFlowDoc(doc).ok).toBe(true);
  });
  it.each([
    ['not an object', null],
    ['an unknown schema', { ...skeletonFlowDoc('x'), schema: 2 }],
    ['an unknown kind', { ...skeletonFlowDoc('x'), blocks: [{ ...skeletonFlowDoc('x').blocks[0], kind: 'script' }] }],
    ['an unknown role', { ...skeletonFlowDoc('x'), blocks: [{ ...skeletonFlowDoc('x').blocks[0], role: 'root' }] }],
    ['a block with no position', { ...skeletonFlowDoc('x'), blocks: [{ ...skeletonFlowDoc('x').blocks[0], at: {} }] }],
    ['an unknown gate', { ...skeletonFlowDoc('x'), blocks: [{ ...skeletonFlowDoc('x').blocks[0], gate: { kind: 'shell' } }] }],
    ['a malformed edge', { ...skeletonFlowDoc('x'), edges: [{ from: 'a' }] }],
    ['a kind named after an object key', { ...skeletonFlowDoc('x'), blocks: [{ ...skeletonFlowDoc('x').blocks[0], kind: 'toString' }] }],
    ['a role named after an object key', { ...skeletonFlowDoc('x'), blocks: [{ ...skeletonFlowDoc('x').blocks[0], role: 'constructor' }] }],
  ])('refuses %s', (_n, v) => expect(parseFlowDoc(v).ok).toBe(false));
  it('keeps no field it was not given', () => {
    const r = parseFlowDoc({ ...skeletonFlowDoc('x'), extra: 1 });
    expect(r.ok && 'extra' in r.doc).toBe(false);
  });
});

describe('phases', () => {
  it('places the build between dispatch and wave-done, though the fix round enters it from review', () => {
    const p = flowPhases(ccrc());
    expect(p.get('brainstorm')).toBe(0);
    expect(p.get('build')).toBe(2);
    expect(p.get('merged')).toBe(4);
  });
});

describe('validateFlow: each rule', () => {
  it('rule 1: the start must be a block', () => { const d = ccrc(); d.start = 'nope'; expect(rules(d)).toContain(1); });
  it('rule 1: a flow may not start mid-wave', () => { const d = ccrc(); d.start = 'dispatch'; expect(rules(d)).toContain(1); });
  it('rule 1: a block nothing leads to', () => {
    const d = ccrc();
    d.blocks.push({ id: 'orphan', kind: 'instruction', title: 'Orphan', role: 'worker', prompt: 'x', outcomes: ['done'], at: { x: 0, y: 0 } });
    d.edges.push({ from: 'orphan', outcome: 'done', to: 'build' });
    expect(validateFlow(d).some((p) => p.rule === 1 && p.block === 'orphan')).toBe(true);
  });
  it('rule 1: ids are unique and well formed', () => {
    const d = ccrc(); block(d, 'build').id = 'Build!'; expect(rules(d)).toContain(1);
  });
  it('rule 2: an outcome that leads nowhere', () => {
    const d = ccrc(); d.edges = d.edges.filter((e) => !(e.from === 'review' && e.outcome === 'findings'));
    expect(rules(d)).toContain(2);
  });
  it('rule 2: one outcome led to two places', () => {
    const d = ccrc(); d.edges.push({ from: 'build', outcome: 'done', to: 'build' }); expect(rules(d)).toContain(2);
  });
  it('rule 2: an arrow on an outcome the block does not have', () => {
    const d = ccrc(); d.edges.push({ from: 'build', outcome: 'maybe', to: 'verify' }); expect(rules(d)).toContain(2);
  });
  it('rule 2: a non-protocol block with no outcome stops the flow', () => {
    const d = ccrc(); block(d, 'merged').outcomes = []; d.edges = d.edges.filter((e) => e.from !== 'merged');
    expect(rules(d)).toContain(2);
  });
  it('rule 3: a missing protocol step', () => {
    const d = skeletonFlowDoc('x');
    d.blocks = d.blocks.filter((b) => b.step !== 'review');
    d.edges = d.edges.filter((e) => e.to !== 'review' && e.from !== 'review');
    expect(rules(d)).toContain(3);
  });
  it('rule 3: a duplicated protocol step', () => {
    const d = ccrc();
    d.blocks.push({ ...block(d, 'dispatch'), id: 'dispatch-2' });
    d.edges.push({ from: 'dispatch-2', outcome: 'dispatched', to: 'build' });
    expect(rules(d)).toContain(3);
  });
  it('rule 3: skipping review', () => {
    const d = ccrc(); d.edges.find((e) => e.from === 'verify')!.to = 'merged';
    expect(rules(d)).toContain(3);
  });
  it('rule 3: going back further than the build is not a fix round', () => {
    const d = ccrc(); d.edges.find((e) => e.from === 'review' && e.outcome === 'findings')!.to = 'write-plan';
    expect(rules(d)).toContain(3);
  });
  it('rule 3: the fix round back to the build is allowed', () => {
    expect(rules(ccrc())).not.toContain(3);
  });
  it('rule 4: a protocol block may carry no prompt', () => {
    const d = ccrc(); block(d, 'dispatch').prompt = 'skip the brief'; expect(rules(d)).toContain(4);
  });
  it('rule 4: a protocol block answers exactly its outcomes', () => {
    const d = ccrc(); block(d, 'review').outcomes = ['clean']; d.edges = d.edges.filter((e) => e.outcome !== 'findings');
    expect(rules(d)).toContain(4);
  });
  it('rule 5: an approval gate is the operator\'s', () => {
    const d = ccrc(); block(d, 'spec-approved').role = 'coordinator'; expect(rules(d)).toContain(5);
  });
  it('rule 5: a PR gate names a state', () => {
    const d = ccrc(); block(d, 'merged').gate = { kind: 'pr-state' }; expect(rules(d)).toContain(5);
  });
  it('rule 5: a skill block names a skill', () => {
    const d = ccrc(); block(d, 'build').skill = ' '; expect(rules(d)).toContain(5);
  });
  it('rule 6: a variable named after an object key is not a flow variable', () => {
    const d = ccrc(); block(d, 'build').prompt = 'read {{toString}}'; expect(rules(d)).toContain(6);
  });
  it('rule 6: only known variables', () => {
    const d = ccrc(); block(d, 'build').prompt = 'read {{secret.token}}'; expect(rules(d)).toContain(6);
  });
  it('rule 7: prompt size', () => {
    const d = ccrc(); block(d, 'build').prompt = 'x'.repeat(4001); expect(rules(d)).toContain(7);
  });
  it('every problem is a numbered rule of §4', () => {
    const d = ccrc(); d.edges = []; d.start = 'nope';
    for (const p of validateFlow(d)) expect([1, 2, 3, 4, 5, 6, 7]).toContain(p.rule);
  });
});

describe('templates', () => {
  it('findTemplate answers the newest version by default', () => {
    expect(findTemplate('ccrc')?.version).toBe(Math.max(...FLOW_TEMPLATES.filter((t) => t.id === 'ccrc').map((t) => t.version)));
    expect(findTemplate('ccrc', 99)).toBeUndefined();
  });
  it('the schema is the one the parser reads', () => {
    for (const t of FLOW_TEMPLATES) expect(t.doc.schema).toBe(FLOW_SCHEMA);
  });
});

describe('a shared flow file (spec §14.1, wave 1b)', () => {
  it('an export reads back as the same document, its exportedFrom set aside', () => {
    const text = flowExportJson(ccrc(), 3);
    expect(JSON.parse(text).exportedFrom).toEqual({ title: 'ccrc', version: 3 });
    const back = readFlowFile(text);
    expect(back).toEqual({ ok: true, doc: parseFlowDoc(ccrc()).ok ? (parseFlowDoc(ccrc()) as { doc: FlowDoc }).doc : null });
  });
  it('refuses a file over the byte cap before parsing it', () => {
    const big = `{"pad":"${'x'.repeat(FLOW_LIMITS.fileBytes)}"}`;
    expect(readFlowFile(big)).toEqual({ ok: false, reason: `the file is over ${FLOW_LIMITS.fileBytes} bytes` });
  });
  it('counts bytes, not characters', () => {
    const wide = '\u{1F600}'.repeat(Math.ceil(FLOW_LIMITS.fileBytes / 4) + 1);
    expect(wide.length).toBeLessThan(FLOW_LIMITS.fileBytes);
    expect(readFlowFile(wide)).toMatchObject({ ok: false, reason: expect.stringMatching(/over/) });
  });
  it('refuses text that is not JSON, and an unknown schema', () => {
    expect(readFlowFile('{nope')).toEqual({ ok: false, reason: 'the file is not JSON' });
    expect(readFlowFile(JSON.stringify({ ...ccrc(), schema: 9 }))).toEqual({ ok: false, reason: 'unknown schema 9' });
  });
});

describe('the brief a flow composes (wave 2)', () => {
  it('a work dispatch reads the block the dispatch step leads to', () => {
    expect(briefBlockFor(ccrc(), 'work')?.id).toBe('build');
  });
  it('a review carries no prompt: review is a protocol step', () => {
    expect(briefBlockFor(ccrc(), 'review')).toBeNull();
  });
  it('a dispatch that leads to a gate composes nothing', () => {
    const d = ccrc();
    block(d, 'build').kind = 'gate';
    expect(briefBlockFor(d, 'work')).toBeNull();
  });
  it('a skill block names its skill first, and a missing variable stays as written', () => {
    const b: FlowBlock = { ...block(ccrc(), 'build'), skill: 's:x', prompt: 'do {{run.id}} for {{plan.path}}, then {{plan.path}}' };
    expect(renderFlowPrompt(b, { 'run.id': '7' })).toEqual({
      text: 'Run the s:x skill.\n\ndo 7 for {{plan.path}}, then {{plan.path}}', missing: ['plan.path'],
    });
  });
  it('an instruction block renders its prompt alone', () => {
    const b: FlowBlock = { ...block(ccrc(), 'build'), kind: 'instruction', skill: undefined, prompt: 'slug {{programme.slug}}' };
    expect(renderFlowPrompt(b, { 'programme.slug': 'programme-a' })).toEqual({ text: 'slug programme-a', missing: [] });
  });
});
